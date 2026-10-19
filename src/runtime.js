import { assertManifest } from './manifest.js';
import { PostMessageClient } from './post-message-client.js';

export class ComponentRuntime {
  constructor({ manifest, mode, client = null, config = {}, root = null } = {}) {
    assertManifest(manifest);
    if (!['embedded', 'standalone'].includes(mode)) throw new TypeError('mode must be embedded or standalone');
    this.manifest = manifest; this.mode = mode; this.client = client; this.root = root;
    this.state = 'created'; this.config = globalThis.structuredClone ? globalThis.structuredClone(config) : { ...config }; this.configListeners = new Set();
    this.lifecycleListeners = new Map();
  }
  onLifecycle(state, listener) { if (!this.lifecycleListeners.has(state)) this.lifecycleListeners.set(state, new Set()); this.lifecycleListeners.get(state).add(listener); return () => this.lifecycleListeners.get(state)?.delete(listener); }
  async start() { if (this.state !== 'created' && this.state !== 'stopped') return; await this._transition('starting'); await this._transition('running'); }
  async pause() { if (this.state === 'running') await this._transition('paused'); }
  async resume() { if (this.state === 'paused') await this._transition('running'); }
  async stop() { if (this.state !== 'stopped') { await this._transition('stopping'); await this._transition('stopped'); this.client?.close(); } }
  async _transition(state) { this.state = state; for (const listener of this.lifecycleListeners.get(state) || []) await listener({ state, runtime: this }); this.client?.notify(`component.${state}`, { id: this.manifest.id }); }
  getConfig(key) { return key === undefined ? this.config : this.config[key]; }
  async setConfig(patch) { this.config = { ...this.config, ...patch }; for (const listener of this.configListeners) await listener(this.config); this.client?.notify('component.configChanged', this.config); return this.config; }
  onConfigChange(listener) { this.configListeners.add(listener); return () => this.configListeners.delete(listener); }
  hostRequest(method, params) { if (!this.client) return Promise.reject(new Error('Host API is unavailable in standalone mode')); return this.client.request(method, params); }
}

export function createEmbeddedEntry(options) { return createEntry({ ...options, mode: 'embedded' }); }
export function createStandaloneEntry(options) { return createEntry({ ...options, mode: 'standalone' }); }
function createEntry({ manifest, mode, root = globalThis.document?.body, client, config } = {}) {
  if (mode === 'embedded' && !client && globalThis.window?.parent && globalThis.window.parent !== globalThis.window) {
    client = new PostMessageClient({ target: globalThis.window.parent, receiveWindow: globalThis.window });
  }
  const runtime = new ComponentRuntime({ manifest, mode, root, client, config });
  return { runtime, start: () => runtime.start(), pause: () => runtime.pause(), resume: () => runtime.resume(), stop: () => runtime.stop() };
}
