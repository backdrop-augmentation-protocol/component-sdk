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
