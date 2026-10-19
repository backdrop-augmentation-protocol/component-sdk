import test from 'node:test';
import assert from 'node:assert/strict';
import { assertManifest, validateManifest, ComponentRuntime } from '../src/index.js';

const manifest = { manifestVersion: '0.1', id: 'example.clock', name: 'Example Clock', version: '0.1.0', entry: { embedded: './embedded.js', standalone: './standalone.js' } };

test('validates the component manifest', () => { assert.equal(validateManifest(manifest).valid, true); assert.equal(assertManifest(manifest), manifest); });
test('reports invalid manifest fields', () => { const result = validateManifest({ ...manifest, id: 'Bad ID', entry: { embedded: '' } }); assert.equal(result.valid, false); assert.ok(result.errors.some((error) => error.includes('id'))); assert.ok(result.errors.some((error) => error.includes('entry.standalone'))); });
test('runtime provides lifecycle and config APIs', async () => { const runtime = new ComponentRuntime({ manifest, mode: 'standalone', config: { color: 'cyan' } }); const states = []; runtime.onLifecycle('running', ({ state }) => states.push(state)); await runtime.start(); assert.equal(runtime.state, 'running'); assert.deepEqual(states, ['running']); await runtime.setConfig({ size: 2 }); assert.equal(runtime.getConfig('size'), 2); await runtime.pause(); assert.equal(runtime.state, 'paused'); await runtime.resume(); await runtime.stop(); assert.equal(runtime.state, 'stopped'); });
