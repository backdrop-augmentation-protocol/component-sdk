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

test('postMessage client uses hello/helloAck-compatible request/response envelopes', async () => {
  const sent = [];
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const target = { postMessage(message) {
    sent.push(message);
    const result = message.method === 'hello' ? { sessionId: 'session-test', protocol: BAP_PROTOCOL, grantedCapabilities: [], grantedPermissions: [] } : {};
    queueMicrotask(() => receiveWindow.listener({ source: target, data: createResponse(message, result, { sessionId: 'session-test' }) }));
  } };
  const client = new PostMessageClient({ target, receiveWindow });
  const result = await client.hello({ identity: { id: manifest.id, name: manifest.name, version: manifest.version } });
  assert.equal(result.sessionId, 'session-test');
  assert.equal(sent[0].kind, 'request');
  assert.equal(sent[0].method, 'hello');
  assert.deepEqual(sent[0].protocol, BAP_PROTOCOL);
  assert.ok(sent[0].timestamp);
  client.close();
});

test('embedded runtime completes handshake and lifecycle through the formal contract', async () => {
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const methods = [];
  const target = { postMessage(message) {
    methods.push(message.method);
    const result = message.method === 'hello' ? { sessionId: 'session-runtime', protocol: BAP_PROTOCOL, grantedCapabilities: [], grantedPermissions: [] } : {};
    queueMicrotask(() => receiveWindow.listener({ source: target, data: createResponse(message, result, { sessionId: 'session-runtime' }) }));
  } };
  const client = new PostMessageClient({ target, receiveWindow });
  const runtime = new ComponentRuntime({ manifest, mode: 'embedded', client, config: { color: 'cyan' } });
  const events = [];
  runtime.onLifecycle('initialized', ({ state }) => events.push(state));
  await runtime.start();
  assert.deepEqual(methods.filter(Boolean), ['hello', 'initialize', 'start']);
  assert.deepEqual(events, ['initialized']);
  assert.equal(runtime.state, 'running');
  await runtime.pause();
  await runtime.resume();
  await runtime.stop();
  assert.deepEqual(methods.filter(Boolean), ['hello', 'initialize', 'start', 'pause', 'resume', 'stop']);
});

test('standalone runtime remains usable without a host or companion', async () => {
  const runtime = new ComponentRuntime({ manifest, mode: 'standalone', config: { color: 'cyan' } });
  await runtime.start();
  assert.equal(runtime.state, 'running');
  await runtime.setConfig({ size: 2 });
  assert.equal(runtime.getConfig('size'), 2);
  await runtime.pause();
  await runtime.resume();
  await runtime.stop();
  assert.equal(runtime.state, 'stopped');
});

test('protocol errors preserve stable error codes', async () => {
  const receiveWindow = { addEventListener: (_name, listener) => { receiveWindow.listener = listener; }, removeEventListener() {} };
  const target = { postMessage(message) { queueMicrotask(() => receiveWindow.listener({ source: target, data: createErrorResponse(message, 'INVALID_STATE', 'not allowed') })); } };
  const client = new PostMessageClient({ target, receiveWindow });
  await assert.rejects(client.request('pause'), (error) => error.code === 'INVALID_STATE');
});
