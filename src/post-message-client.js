import { BAP_PROTOCOL, createErrorResponse, createEvent, createRequest, createResponse, isProtocolMessage } from './protocol.js';

export class BapProtocolError extends Error {
  constructor(error) {
    super(error?.message || 'BAP protocol error');
    this.name = 'BapProtocolError';
    Object.assign(this, error);
  }
}

export class PostMessageClient {
  constructor({ target, targetOrigin = '*', receiveWindow = globalThis.window, timeoutMs = 5000, sessionId } = {}) {
    if (!target || typeof target.postMessage !== 'function') throw new TypeError('target must support postMessage');
    this.target = target; this.targetOrigin = targetOrigin; this.receiveWindow = receiveWindow; this.timeoutMs = timeoutMs; this.sessionId = sessionId;
    this.pending = new Map(); this.listeners = new Map(); this.requestHandler = null; this.peerOrigin = null; this._onMessage = (event) => this._receive(event);
    this.receiveWindow?.addEventListener?.('message', this._onMessage);
  }
  hello({ identity, capabilities = [], permissions = [], role = 'component' } = {}) {
    return this.request('hello', { role, identity, protocolVersions: [BAP_PROTOCOL.version], capabilities, requestedPermissions: permissions });
  }
  request(method, payload = {}) {
    const request = createRequest(method, payload, { sessionId: this.sessionId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request.id); reject(new BapProtocolError({ code: 'TIMEOUT', message: `BAP request timed out: ${method}`, retryable: true })); }, this.timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer }); this.target.postMessage(request, this.targetOrigin);
    });
  }
  notify(event, payload = {}, options = {}) { this.target.postMessage(createEvent(event, payload, { ...options, sessionId: options.sessionId || this.sessionId }), this.targetOrigin); }
  on(event, listener) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(listener); return () => this.listeners.get(event)?.delete(listener); }
  onRequest(handler) { this.requestHandler = handler; return () => { if (this.requestHandler === handler) this.requestHandler = null; }; }
  _receive(event) {
    if (event.source && event.source !== this.target) return;
    const message = event.data;
    if (!isProtocolMessage(message)) return;
    if (this.peerOrigin !== null && event.origin !== this.peerOrigin) return;
    if (message.kind === 'request' && this.requestHandler) {
      if (this.sessionId && message.method !== 'hello' && message.sessionId !== this.sessionId) return;
      if (this.peerOrigin === null && message.method === 'hello') this.peerOrigin = event.origin ?? 'null';
      void Promise.resolve().then(() => this.requestHandler(message)).then(
        (result) => this._reply(createResponse(message, result, { sessionId: this.sessionId })),
        (error) => this._reply(createErrorResponse(message, error?.code || 'INTERNAL_ERROR', error?.message || 'Component request failed', { sessionId: this.sessionId }))
      );
      return;
    }
    if (this.sessionId && message.sessionId !== this.sessionId) return;
    if (message.kind === 'response' && message.correlationId && this.pending.has(message.correlationId)) {
      const pending = this.pending.get(message.correlationId); this.pending.delete(message.correlationId); clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result); else pending.reject(new BapProtocolError(message.error));
    } else if (message.kind === 'event') for (const listener of this.listeners.get(message.event) || []) listener(message.payload, message);
  }
  _reply(message) { this.target.postMessage(message, this.targetOrigin); }
  close() { this.receiveWindow?.removeEventListener?.('message', this._onMessage); for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new BapProtocolError({ code: 'INTERNAL_ERROR', message: 'BAP client closed' })); } this.pending.clear(); }
}
