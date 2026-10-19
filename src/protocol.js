export const BAP_PROTOCOL = Object.freeze({ name: 'bap', version: '0.1.0', profile: 'core' });
export const CORE_METHODS = Object.freeze(['hello', 'initialize', 'start', 'pause', 'resume', 'stop']);
export const ERROR_CODES = Object.freeze([
  'INVALID_MESSAGE', 'UNSUPPORTED_VERSION', 'UNSUPPORTED_PROFILE', 'UNAUTHORIZED',
  'CAPABILITY_DENIED', 'INVALID_STATE', 'NOT_FOUND', 'CONFLICT', 'TIMEOUT', 'INTERNAL_ERROR'
]);

export function timestamp() { return new Date().toISOString(); }

export function createRequest(method, payload = {}, { id = createId(), sessionId } = {}) {
  return withSession({ protocol: BAP_PROTOCOL, kind: 'request', id, timestamp: timestamp(), method, payload }, sessionId);
}

export function createResponse(request, result = {}, { sessionId } = {}) {
  return withSession({ protocol: BAP_PROTOCOL, kind: 'response', id: createId(), correlationId: request.id, timestamp: timestamp(), ok: true, result }, sessionId);
}

export function createErrorResponse(request, code, message, { details, retryable = false, sessionId } = {}) {
  if (!ERROR_CODES.includes(code)) throw new TypeError(`Unsupported BAP error code: ${code}`);
  const error = { code, message, retryable };
  if (details !== undefined) error.details = details;
  return withSession({ protocol: BAP_PROTOCOL, kind: 'response', id: createId(), correlationId: request.id, timestamp: timestamp(), ok: false, error }, sessionId);
}

export function createEvent(event, payload = {}, { id = createId(), sessionId, correlationId } = {}) {
  const message = { protocol: BAP_PROTOCOL, kind: 'event', id, timestamp: timestamp(), event, payload };
  if (correlationId) message.correlationId = correlationId;
  return withSession(message, sessionId);
}

export function createId() { return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

export function isProtocolMessage(message) {
  return Boolean(message && typeof message === 'object' && message.protocol?.name === 'bap' &&
    typeof message.protocol.version === 'string' && message.protocol.profile === 'core' &&
    ['request', 'response', 'event'].includes(message.kind) && typeof message.id === 'string' &&
    typeof message.timestamp === 'string');
}

function withSession(message, sessionId) {
  if (sessionId) message.sessionId = sessionId;
  return message;
}
