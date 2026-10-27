import { assertManifest } from './manifest.js';
import { PostMessageClient } from './post-message-client.js';
import { BAP_PROTOCOL, createId } from './protocol.js';

export class ComponentRuntime {
  constructor({ manifest, mode, client = null, config = {}, root = null } = {}) {
    assertManifest(manifest);
    if (!['embedded', 'standalone'].includes(mode)) throw new TypeError('mode must be embedded or standalone');
    this.manifest = manifest; this.mode = mode; this.client = client; this.root = root;
    this.state = 'created'; this.sessionId = null; this.config = globalThis.structuredClone ? globalThis.structuredClone(config) : { ...config }; this.configListeners = new Set();
    this.lifecycleListeners = new Map();
    if (this.mode === 'embedded' && this.client) this.client.onRequest((message) => this._hostRequest(message));
  }
  onLifecycle(state, listener) { if (!this.lifecycleListeners.has(state)) this.lifecycleListeners.set(state, new Set()); this.lifecycleListeners.get(state).add(listener); return () => this.lifecycleListeners.get(state)?.delete(listener); }
  async start() {
    if (this.mode === 'embedded') {
      if (!this.client) throw new Error('Embedded mode requires a Host session channel');
      return;
    }
    if (this.state === 'running') return;
    if (this.state !== 'created' && this.state !== 'stopped') throw this._invalidState('start');
    if (this.state === 'created') {
      this.sessionId = `standalone-${Date.now().toString(36)}`;
      await this._transition('connected'); await this._requestLifecycle('initialize'); await this._transition('initialized');
    } else { await this._requestLifecycle('initialize'); await this._transition('initialized'); }
    await this._requestLifecycle('start'); await this._transition('running');
  }
  async pause() { if (this.state === 'paused') return; if (this.state !== 'running') throw this._invalidState('pause'); await this._requestLifecycle('pause'); await this._transition('paused'); }
  async resume() { if (this.state === 'paused') { await this._requestLifecycle('resume'); await this._transition('running'); } }
  async stop() { if (this.state === 'stopped') return; if (!['running', 'paused'].includes(this.state)) throw this._invalidState('stop'); await this._requestLifecycle('stop'); await this._transition('stopped'); }
  async _requestLifecycle(method) { if (this.client) await this.client.request(method, { componentId: this.manifest.id, mode: this.mode }); }
  _invalidState(method) { const error = new Error(`Cannot ${method} from ${this.state}`); error.code = 'INVALID_STATE'; return error; }
  async _hostRequest(message) {
    const { method, payload } = message;
    if (method === 'hello') {
      if (this.state !== 'created') throw this._invalidState('hello');
      if (message.protocol?.name !== BAP_PROTOCOL.name || message.protocol.profile !== BAP_PROTOCOL.profile) {
        const error = new Error('Unsupported Core profile'); error.code = 'UNSUPPORTED_PROFILE'; throw error;
      }
      if (payload?.role !== 'host' || !payload.identity?.id || !Array.isArray(payload.protocolVersions) || !Array.isArray(payload.capabilities) || !Array.isArray(payload.requestedPermissions)) {
        const error = new Error('Invalid hello payload'); error.code = 'INVALID_MESSAGE'; throw error;
      }
      if (!payload.protocolVersions.includes(BAP_PROTOCOL.version) || message.protocol.version !== BAP_PROTOCOL.version) {
        const error = new Error('Unsupported protocol version'); error.code = 'UNSUPPORTED_VERSION'; throw error;
      }
      this.sessionId = createId(); this.client.sessionId = this.sessionId;
      await this._transition('connected');
      return { selectedProtocol: BAP_PROTOCOL, role: 'component', capabilities: this.manifest.capabilities.filter(value => payload.capabilities.includes(value)), permissions: (this.manifest.permissions || []).filter(value => payload.requestedPermissions.includes(value)) };
    }
    if (!this.sessionId || message.sessionId !== this.sessionId) {
      const error = new Error('Missing or invalid session'); error.code = 'UNAUTHORIZED'; throw error;
    }
    if (method === 'initialize' && (this.state === 'connected' || this.state === 'stopped')) { await this._transition('initialized'); return { state: this.state }; }
    if (method === 'start' && this.state === 'initialized') { await this._transition('running'); return { state: this.state }; }
    if (method === 'pause' && this.state === 'running') { await this._transition('paused'); return { state: this.state }; }
    if (method === 'resume' && this.state === 'paused') { await this._transition('running'); return { state: this.state }; }
    if (method === 'stop' && ['running', 'paused'].includes(this.state)) { await this._transition('stopped'); return { state: this.state }; }
    if ((method === 'pause' && this.state === 'paused') || (method === 'resume' && this.state === 'running') || (method === 'stop' && this.state === 'stopped')) return { state: this.state };
    if (['initialize', 'start', 'pause', 'resume', 'stop'].includes(method)) throw this._invalidState(method);
    const error = new Error(`Unknown method: ${method}`); error.code = 'NOT_FOUND'; throw error;
  }
  async _transition(state) { this.state = state; for (const listener of this.lifecycleListeners.get(state) || []) await listener({ state, runtime: this }); if (state !== 'connected') this.client?.notify('state.changed', { role: 'component', state, id: this.manifest.id }, { sessionId: this.sessionId }); }
  getConfig(key) { return key === undefined ? this.config : this.config[key]; }
  async setConfig(patch) { if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('config patch must be an object'); this.config = { ...this.config, ...patch }; for (const listener of this.configListeners) await listener(this.config); this.client?.notify('config.changed', { scope: 'wallpaper', config: this.config }, { sessionId: this.sessionId }); return this.config; }
  onConfigChange(listener) { this.configListeners.add(listener); return () => this.configListeners.delete(listener); }
  hostRequest(method, params) { if (!this.client) return Promise.reject(new Error('Host API is unavailable in standalone mode')); return this.client.request(method, params); }
}

export function createEmbeddedEntry(options) { return createEntry({ ...options, mode: 'embedded' }); }
export function createStandaloneEntry(options) { return createEntry({ ...options, mode: 'standalone' }); }
function createEntry({ manifest, mode, root = globalThis.document?.body, client, config, targetOrigin = '*' } = {}) {
  if (mode === 'embedded' && !client && globalThis.window?.parent && globalThis.window.parent !== globalThis.window) {
    client = new PostMessageClient({ target: globalThis.window.parent, targetOrigin, receiveWindow: globalThis.window });
  }
  const runtime = new ComponentRuntime({ manifest, mode, root, client, config });
  return { runtime, start: () => runtime.start(), pause: () => runtime.pause(), resume: () => runtime.resume(), stop: () => runtime.stop() };
}
