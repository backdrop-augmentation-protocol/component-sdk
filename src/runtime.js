import { assertManifest } from './manifest.js';
import { PostMessageClient } from './post-message-client.js';
import { BAP_PROTOCOL, createId } from './protocol.js';

export class ComponentRuntime {
  constructor({ manifest, mode, client = null, config = {}, root = null, extensions = [] } = {}) {
    assertManifest(manifest);
    if (!['embedded', 'standalone'].includes(mode)) throw new TypeError('mode must be embedded or standalone');
    validateExtensionOffers(extensions);
    this.manifest = manifest; this.mode = mode; this.client = client; this.root = root; this.extensionOffers = clone(extensions);
    this.state = 'created'; this.sessionId = null; this.instanceId = null; this.selectedExtensions = []; this.config = clone(config); this.configRevision = -1; this.configListeners = new Set();
    this.presentation = { visible: true, sceneId: null, sceneRevision: -1 };
    this.presentationListeners = new Set();
    this.lifecycleListeners = new Map();
    if (this.mode === 'embedded' && this.client) {
      this.client.onRequest((message) => this._hostRequest(message));
      this.client.on('component.config.changed', payload => this._hostConfigChanged(payload));
      this.client.on('presentation.visibility.changed', payload => this._visibilityChanged(payload));
      this.client.on('presentation.scene.changed', payload => this._sceneChanged(payload));
    }
  }
  onLifecycle(state, listener) { if (!this.lifecycleListeners.has(state)) this.lifecycleListeners.set(state, new Set()); this.lifecycleListeners.get(state).add(listener); return () => this.lifecycleListeners.get(state)?.delete(listener); }
  onPresentationChange(listener) { this.presentationListeners.add(listener); return () => this.presentationListeners.delete(listener); }
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
      const offered = validateHostExtensionOffers(payload.extensions ?? []);
      const selectedExtensions = negotiateExtensions(offered, this.extensionOffers);
      if (selectedExtensions.some(extension => extension.id === 'org.bap.composition')) {
        if (typeof payload.instanceId !== 'string' || !payload.instanceId.trim()) {
          const error = new Error('Composition handshake requires an instanceId'); error.code = 'INVALID_MESSAGE'; throw error;
        }
        this.instanceId = payload.instanceId;
      }
      this.sessionId = createId(); this.client.sessionId = this.sessionId;
      this.selectedExtensions = selectedExtensions;
      await this._transition('connected');
      return { selectedProtocol: BAP_PROTOCOL, role: 'component', capabilities: this.manifest.capabilities.filter(value => payload.capabilities.includes(value)), permissions: (this.manifest.permissions || []).filter(value => payload.requestedPermissions.includes(value)), ...(selectedExtensions.length ? { selectedExtensions } : {}) };
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
  _hasExtension(id) { return this.selectedExtensions.some(extension => extension.id === id); }
  _hostConfigChanged(payload) {
    if (!this._hasExtension('org.bap.component-config') || !this._matchesInstance(payload) || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || !isRecord(payload.config) || payload.revision <= this.configRevision) return;
    this.config = clone(payload.config); this.configRevision = payload.revision;
    for (const listener of this.configListeners) listener(this.config);
  }
  _visibilityChanged(payload) {
    if (!this._hasExtension('org.bap.presentation') || !this._matchesInstance(payload) || typeof payload.visible !== 'boolean') return;
    if (payload.visible === this.presentation.visible) return;
    this.presentation = { ...this.presentation, visible: payload.visible };
    this._notifyPresentation();
  }
  _sceneChanged(payload) {
    if (!this._hasExtension('org.bap.presentation') || !this._matchesInstance(payload) || typeof payload.sceneId !== 'string' || !payload.sceneId.trim() || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || payload.revision <= this.presentation.sceneRevision) return;
    this.presentation = { ...this.presentation, sceneId: payload.sceneId, sceneRevision: payload.revision, ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}) };
    this._notifyPresentation();
  }
  _matchesInstance(payload) { return !!payload && typeof payload === 'object' && typeof this.instanceId === 'string' && payload.instanceId === this.instanceId; }
  _notifyPresentation() { const state = { ...this.presentation }; for (const listener of this.presentationListeners) listener(state); }
  hostRequest(method, params) { if (!this.client) return Promise.reject(new Error('Host API is unavailable in standalone mode')); return this.client.request(method, params); }
}

export function createEmbeddedEntry(options) { return createEntry({ ...options, mode: 'embedded' }); }
export function createStandaloneEntry(options) { return createEntry({ ...options, mode: 'standalone' }); }
function createEntry({ manifest, mode, root = globalThis.document?.body, client, config, extensions = [], targetOrigin = '*' } = {}) {
  if (mode === 'embedded' && !client && globalThis.window?.parent && globalThis.window.parent !== globalThis.window) {
    client = new PostMessageClient({ target: globalThis.window.parent, targetOrigin, receiveWindow: globalThis.window });
  }
  const runtime = new ComponentRuntime({ manifest, mode, root, client, config, extensions });
  return { runtime, start: () => runtime.start(), pause: () => runtime.pause(), resume: () => runtime.resume(), stop: () => runtime.stop() };
}

function clone(value) { return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validateExtensionOffers(offers) {
  if (!Array.isArray(offers)) throw new TypeError('extensions must be an array');
  const ids = new Set();
  for (const offer of offers) {
    if (!isRecord(offer) || typeof offer.id !== 'string' || !offer.id || ids.has(offer.id) || !Array.isArray(offer.versions) || !offer.versions.length || offer.versions.some(version => typeof version !== 'string' || !version)) throw new TypeError('Invalid extension offer');
    ids.add(offer.id);
  }
}
function validateHostExtensionOffers(offers) {
  try { validateExtensionOffers(offers); }
  catch (cause) { const error = new Error(cause.message); error.code = 'INVALID_MESSAGE'; throw error; }
  return offers;
}
function negotiateExtensions(hostOffers, componentOffers) {
  const selected = [];
  for (const hostOffer of hostOffers) {
    const componentOffer = componentOffers.find(offer => offer.id === hostOffer.id);
    const version = hostOffer.versions.find(candidate => componentOffer?.versions.includes(candidate));
    if (version) selected.push({ id: hostOffer.id, version });
  }
  return selected;
}
