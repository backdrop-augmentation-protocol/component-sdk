import { assertManifest } from './manifest.js';
import { PostMessageClient } from './post-message-client.js';

export class ComponentRuntime {
  constructor({ manifest, mode, client = null, config = {}, root = null } = {}) {
    assertManifest(manifest);
    if (!['embedded', 'standalone'].includes(mode)) throw new TypeError('mode must be embedded or standalone');
    this.manifest = manifest; this.mode = mode; this.client = client; this.root = root;
    this.state = 'created'; this.sessionId = null; this.config = globalThis.structuredClone ? globalThis.structuredClone(config) : { ...config }; this.configListeners = new Set();
    this.lifecycleListeners = new Map();
  }
  onLifecycle(state, listener) { if (!this.lifecycleListeners.has(state)) this.lifecycleListeners.set(state, new Set()); this.lifecycleListeners.get(state).add(listener); return () => this.lifecycleListeners.get(state)?.delete(listener); }
  async start() {
    if (this.state === 'running') return;
    if (this.state !== 'created' && this.state !== 'stopped') throw this._invalidState('start');
    if (this.state === 'created') {
      if (this.client) {
        const hello = await this.client.hello({ identity: { id: this.manifest.id, name: this.manifest.name, version: this.manifest.version }, capabilities: this.manifest.capabilities, permissions: this.manifest.permissions || [] });
        this.sessionId = hello.sessionId; this.client.sessionId = this.sessionId;
      } else this.sessionId = `standalone-${Date.now().toString(36)}`;
      await this._transition('connected'); await this._requestLifecycle('initialize'); await this._transition('initialized');
    } else await this._requestLifecycle('initialize');
    await this._requestLifecycle('start'); await this._transition('running');
  }
  async pause() { if (this.state === 'paused') return; if (this.state !== 'running') throw this._invalidState('pause'); await this._requestLifecycle('pause'); await this._transition('paused'); }
  async resume() { if (this.state === 'paused') { await this._requestLifecycle('resume'); await this._transition('running'); } }
  async stop() { if (this.state === 'stopped') return; if (!['running', 'paused'].includes(this.state)) throw this._invalidState('stop'); await this._requestLifecycle('stop'); await this._transition('stopped'); this.client?.close(); }
  async _requestLifecycle(method) { if (this.client) await this.client.request(method, { componentId: this.manifest.id, mode: this.mode }); }
  _invalidState(method) { const error = new Error(`Cannot ${method} from ${this.state}`); error.code = 'INVALID_STATE'; return error; }
  async _transition(state) { this.state = state; for (const listener of this.lifecycleListeners.get(state) || []) await listener({ state, runtime: this }); this.client?.notify('state.changed', { role: 'component', state, id: this.manifest.id }, { sessionId: this.sessionId }); }
  getConfig(key) { return key === undefined ? this.config : this.config[key]; }
  async setConfig(patch) { if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('config patch must be an object'); this.config = { ...this.config, ...patch }; for (const listener of this.configListeners) await listener(this.config); this.client?.notify('config.changed', { scope: 'wallpaper', config: this.config }, { sessionId: this.sessionId }); return this.config; }
  onConfigChange(listener) { this.configListeners.add(listener); return () => this.configListeners.delete(listener); }
  hostRequest(method, params) { if (!this.client) return Promise.reject(new Error('Host API is unavailable in standalone mode')); return this.client.request(method, params); }
}

export function createEmbeddedEntry(options) { return createEntry({ ...options, mode: 'embedded' }); }
export function createStandaloneEntry(options) { return createEntry({ ...options, mode: 'standalone' }); }
function createEntry({ manifest, mode, root = globalThis.document?.body, client, config, targetOrigin = globalThis.location?.origin || '*' } = {}) {
  if (mode === 'embedded' && !client && globalThis.window?.parent && globalThis.window.parent !== globalThis.window) {
    client = new PostMessageClient({ target: globalThis.window.parent, targetOrigin, receiveWindow: globalThis.window });
  }
  const runtime = new ComponentRuntime({ manifest, mode, root, client, config });
  return { runtime, start: () => runtime.start(), pause: () => runtime.pause(), resume: () => runtime.resume(), stop: () => runtime.stop() };
}
