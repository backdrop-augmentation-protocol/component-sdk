const REQUEST = 'bap.component.request';
const RESPONSE = 'bap.component.response';
const EVENT = 'bap.component.event';

export class PostMessageClient {
  constructor({ target, targetOrigin = '*', receiveWindow = globalThis.window, timeoutMs = 5000 } = {}) {
    if (!target || typeof target.postMessage !== 'function') throw new TypeError('target must support postMessage');
    this.target = target;
    this.targetOrigin = targetOrigin;
    this.receiveWindow = receiveWindow;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.listeners = new Map();
    this._id = 0;
    this._onMessage = (event) => {
      if (event.source && event.source !== this.target) return;
      const message = event.data;
      if (!message || message.channel !== 'bap' || message.protocol !== '0.1') return;
      if (message.type === RESPONSE && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message), message.error));
        else pending.resolve(message.result);
      } else if (message.type === EVENT) {
        for (const listener of this.listeners.get(message.name) || []) listener(message.payload, message);
      }
    };
    this.receiveWindow?.addEventListener?.('message', this._onMessage);
  }

  request(method, params) {
    const id = `${Date.now().toString(36)}-${++this._id}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`BAP request timed out: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.target.postMessage({ channel: 'bap', protocol: '0.1', type: REQUEST, id, method, params }, this.targetOrigin);
    });
  }

  notify(name, payload) { this.target.postMessage({ channel: 'bap', protocol: '0.1', type: EVENT, name, payload }, this.targetOrigin); }
  on(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
    return () => this.listeners.get(name)?.delete(listener);
  }
  close() { this.receiveWindow?.removeEventListener?.('message', this._onMessage); for (const pending of this.pending.values()) pending.reject(new Error('BAP client closed')); this.pending.clear(); }
}
