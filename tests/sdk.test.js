import test from 'node:test';
import assert from 'node:assert/strict';
import { assertManifest, validateManifest, ComponentRuntime, PostMessageClient, BAP_PROTOCOL, createResponse, createErrorResponse } from '../src/index.js';

const manifest = {
  protocol: BAP_PROTOCOL,
  id: 'example.clock',
  name: 'Example Clock',
  version: '0.1.0',
  role: 'component',
  capabilities: [],
  modes: ['standalone', 'embedded'],
  entrypoints: { default: './component.js', embedded: './component.js', standalone: './component.js' },
  configScopes: ['global', 'wallpaper']
};

test('validates the formal dual-mode component manifest', () => {
  assert.equal(validateManifest(manifest).valid, true);
  assert.equal(assertManifest(manifest), manifest);
  assert.equal(validateManifest({ ...manifest, manifestVersion: '0.1' }).valid, false);
  assert.equal(validateManifest({ ...manifest, modes: ['embedded'], entrypoints: { default: './component.js' } }).valid, false);
});

test('postMessage client correlates non-Core request/response envelopes', async () => {
  const sent = [];
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const target = { postMessage(message) {
    sent.push(message);
    const result = { acknowledged: true };
    queueMicrotask(() => receiveWindow.listener({ source: target, data: createResponse(message, result, { sessionId: 'session-test' }) }));
  } };
  const client = new PostMessageClient({ target, receiveWindow });
  const result = await client.request('component.get-state');
  assert.equal(result.acknowledged, true);
  assert.equal(sent[0].kind, 'request');
  assert.equal(sent[0].method, 'component.get-state');
  assert.deepEqual(sent[0].protocol, BAP_PROTOCOL);
  assert.ok(sent[0].timestamp);
  client.close();
});

test('embedded runtime responds to Host hello and lifecycle without initiating requests', async () => {
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const sent = [];
  const target = { postMessage(message) { sent.push(message); } };
  const client = new PostMessageClient({ target, receiveWindow });
  const runtime = new ComponentRuntime({ manifest, mode: 'embedded', client, config: { color: 'cyan' } });
  const events = [];
  runtime.onLifecycle('initialized', ({ state }) => events.push(state));
  await runtime.start();
  assert.equal(sent.length, 0);
  let requestNumber = 0;
  const dispatch = async (method, sessionId, expectedOk = true) => {
    const request = { protocol: BAP_PROTOCOL, kind: 'request', id: `req-${method}-${++requestNumber}`, timestamp: new Date().toISOString(), method, payload: method === 'hello' ? { role: 'host', identity: { id: 'example.host', name: 'Host', version: '0.1.0' }, protocolVersions: ['0.1.0'], capabilities: [], requestedPermissions: [] } : {}, ...(sessionId ? { sessionId } : {}) };
    receiveWindow.listener({ source: target, origin: 'https://host.test', data: request });
    await new Promise(resolve => setTimeout(resolve, 0));
    const response = sent.find(message => message.kind === 'response' && message.correlationId === request.id);
    assert.equal(response?.ok, expectedOk);
    return response;
  };
  const hello = await dispatch('hello');
  assert.equal(sent[0].kind, 'response');
  assert.equal(hello.result.role, 'component');
  assert.equal('selectedExtensions' in hello.result, false);
  const sessionId = hello.sessionId;
  await dispatch('initialize', sessionId);
  const invalidStop = await dispatch('stop', sessionId, false);
  assert.equal(invalidStop.error.code, 'INVALID_STATE');
  assert.equal(runtime.state, 'initialized');
  await dispatch('start', sessionId);
  assert.deepEqual(events, ['initialized']);
  assert.equal(runtime.state, 'running');
  await dispatch('pause', sessionId);
  await dispatch('resume', sessionId);
  await dispatch('stop', sessionId);
  assert.equal(runtime.state, 'stopped');
  await dispatch('initialize', sessionId);
  await dispatch('start', sessionId);
  assert.deepEqual(events, ['initialized', 'initialized']);
  assert.equal(runtime.state, 'running');
  client.close();
});

test('negotiates exact extensions and applies only fresh events for the active component instance', async () => {
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const sent = [];
  const target = { postMessage(message) { sent.push(message); } };
  const client = new PostMessageClient({ target, receiveWindow });
  const runtime = new ComponentRuntime({
    manifest, mode: 'embedded', client, config: { theme: 'old' },
    extensions: [
      { id: 'org.bap.composition', versions: ['0.1.0'] },
      { id: 'org.bap.component-config', versions: ['0.1.0'] },
      { id: 'org.bap.presentation', versions: ['0.1.0'] }
    ]
  });
  const configChanges = []; const presentationChanges = [];
  runtime.onConfigChange(value => configChanges.push(value));
  runtime.onPresentationChange(value => presentationChanges.push(value));
  const helloRequest = { protocol: BAP_PROTOCOL, kind: 'request', id: 'hello-extended', timestamp: new Date().toISOString(), method: 'hello', payload: {
    role: 'host', identity: { id: 'example.host', name: 'Host', version: '0.2.0' }, protocolVersions: ['0.1.0'], capabilities: [], requestedPermissions: [], instanceId: 'clock-left',
    extensions: [
      { id: 'org.bap.composition', versions: ['0.2.0', '0.1.0'] },
      { id: 'org.bap.component-config', versions: ['0.1.0'] },
      { id: 'org.bap.presentation', versions: ['0.1.0'] },
      { id: 'org.bap.unknown', versions: ['9.9.9'] }
    ]
  } };
  receiveWindow.listener({ source: target, origin: 'https://host.test', data: helloRequest });
  await new Promise(resolve => setTimeout(resolve, 0));
  const helloAck = sent.find(message => message.correlationId === helloRequest.id);
  assert.deepEqual(helloAck.result.selectedExtensions, [
    { id: 'org.bap.composition', version: '0.1.0' },
    { id: 'org.bap.component-config', version: '0.1.0' },
    { id: 'org.bap.presentation', version: '0.1.0' }
  ]);
  assert.equal(runtime.instanceId, 'clock-left');

  const sendEvent = (name, payload) => receiveWindow.listener({ source: target, origin: 'https://host.test', data: {
    protocol: BAP_PROTOCOL, kind: 'event', id: `evt-${name}-${Math.random()}`, timestamp: new Date().toISOString(), sessionId: helloAck.sessionId, event: name, payload
  } });
  sendEvent('component.config.changed', { instanceId: 'clock-left', revision: 2, config: { theme: 'blue' } });
  sendEvent('component.config.changed', { instanceId: 'clock-left', revision: 1, config: { theme: 'stale' } });
  sendEvent('component.config.changed', { instanceId: 'clock-right', revision: 3, config: { theme: 'other-instance' } });
  assert.deepEqual(runtime.getConfig(), { theme: 'blue' });
  assert.deepEqual(configChanges, [{ theme: 'blue' }]);

  sendEvent('presentation.visibility.changed', { instanceId: 'clock-left', visible: false });
  sendEvent('presentation.scene.changed', { instanceId: 'clock-left', sceneId: 'lock-screen', revision: 4, reason: 'scene-transition' });
  sendEvent('presentation.scene.changed', { instanceId: 'clock-left', sceneId: 'stale-scene', revision: 3 });
  sendEvent('presentation.visibility.changed', { instanceId: 'clock-right', visible: true });
  assert.equal(runtime.presentation.visible, false);
  assert.equal(runtime.presentation.sceneId, 'lock-screen');
  assert.equal(runtime.presentation.sceneRevision, 4);
  assert.equal(presentationChanges.length, 2);
  client.close();
});

test('rejects duplicate Host extension IDs instead of selecting ambiguous versions', async () => {
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const sent = []; const target = { postMessage(message) { sent.push(message); } };
  const client = new PostMessageClient({ target, receiveWindow });
  const runtime = new ComponentRuntime({ manifest, mode: 'embedded', client, extensions: [{ id: 'org.bap.presentation', versions: ['0.1.0'] }] });
  const request = { protocol: BAP_PROTOCOL, kind: 'request', id: 'bad-hello', timestamp: new Date().toISOString(), method: 'hello', payload: {
    role: 'host', identity: { id: 'example.host', name: 'Host', version: '0.2.0' }, protocolVersions: ['0.1.0'], capabilities: [], requestedPermissions: [],
    extensions: [{ id: 'org.bap.presentation', versions: ['0.1.0'] }, { id: 'org.bap.presentation', versions: ['0.2.0'] }]
  } };
  receiveWindow.listener({ source: target, origin: 'https://host.test', data: request });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sent.find(message => message.correlationId === request.id)?.error.code, 'INVALID_MESSAGE');
  client.close();
});

test('standalone runtime remains usable without a host or companion', async () => {
  const runtime = new ComponentRuntime({ manifest, mode: 'standalone', config: { color: 'cyan' } });
  const states = [];
  for (const state of ['connected', 'initialized', 'running', 'stopped']) runtime.onLifecycle(state, () => states.push(state));
  await runtime.start();
  assert.equal(runtime.state, 'running');
  await runtime.setConfig({ size: 2 });
  assert.equal(runtime.getConfig('size'), 2);
  await runtime.pause();
  await runtime.resume();
  await runtime.stop();
  assert.equal(runtime.state, 'stopped');
  await runtime.start();
  assert.equal(runtime.state, 'running');
  assert.deepEqual(states, ['connected', 'initialized', 'running', 'running', 'stopped', 'initialized', 'running']);
});

test('protocol errors preserve stable error codes', async () => {
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const target = { postMessage(message) { queueMicrotask(() => receiveWindow.listener({ source: target, data: createErrorResponse(message, 'INVALID_STATE', 'not allowed') })); } };
  const client = new PostMessageClient({ target, receiveWindow });
  await assert.rejects(client.request('pause'), (error) => error.code === 'INVALID_STATE');
});
