import { parseErrors } from '../classifier/index.js';

const JSON_CONTENT_TYPE = /(?:^|\/)(?:json|.+\+json)(?:;|$)/i;
const MAX_REASON_LENGTH = 160;

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) ?? '';
  return headers[name] ?? headers[name.toLowerCase()] ?? '';
}

function sanitizedReason(value) {
  return String(value ?? 'upstream response classified')
    .replace(/authorization\s*:\s*\S+/gi, 'authorization: <redacted>')
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_REASON_LENGTH);
}

function retryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(date - now, 30_000));
}

function isStructuredContractEvidence(errors) {
  return errors.length > 0 && errors.length <= 32
    && errors.every((error) => ['missing', 'extra', 'type', 'enum', 'value', 'missing_header'].includes(error.kind));
}

export function classifyUpstream(response) {
  const status = response?.status ?? 0;
  const errors = parseErrors(response?.json ?? response?.text, status);
  const retryAfter = retryAfterMs(headerValue(response?.headers, 'retry-after'));
  const base = {
    status: status || null,
    retryAfterMs: retryAfter,
    errors,
    schemaDiagnosisAllowed: false,
    retryable: false,
    reason: 'upstream response classified',
  };

  if (response?.error || status === 0) {
    return { ...base, classification: 'transport_error', retryable: true, reason: sanitizedReason(response?.error?.message ?? response?.text ?? 'transport failure') };
  }
  if (status === 401 || status === 403 || errors.some((error) => error.kind === 'auth')) {
    return { ...base, classification: 'auth_error', reason: 'upstream authentication or authorization failed' };
  }
  if (status === 429) {
    return { ...base, classification: 'rate_limited', retryable: true, reason: retryAfter === null ? 'upstream rate limit reached' : 'upstream rate limit reached; retry-after provided' };
  }
  if (status >= 500 && status <= 599) {
    return { ...base, classification: 'upstream_error', retryable: true, reason: `upstream server error (${status})` };
  }
  if (status >= 400 && status <= 499) {
    if ((status === 400 || status === 422) && isStructuredContractEvidence(errors)) {
      return { ...base, classification: 'request_contract_drift', schemaDiagnosisAllowed: true, reason: 'structured upstream contract validation evidence' };
    }
    return { ...base, classification: 'request_error', reason: `upstream rejected the request (${status})` };
  }

  const contentType = headerValue(response?.headers, 'content-type');
  const bodyText = String(response?.bodyText ?? response?.text ?? '');
  if (response?.json === null && bodyText.trim() !== '' && contentType && !JSON_CONTENT_TYPE.test(contentType)) {
    return { ...base, classification: 'invalid_upstream_response', reason: `unexpected upstream content type (${sanitizedReason(contentType)})` };
  }
  if (response?.json === null && bodyText.trim() !== '') {
    return { ...base, classification: 'invalid_upstream_response', reason: 'upstream returned malformed JSON' };
  }
  if (status === 204 || bodyText.trim() === '' || response?.json === null) {
    return { ...base, classification: 'valid_empty_response', reason: 'upstream returned an explicitly empty response' };
  }
  return { ...base, classification: 'successful_response', reason: 'upstream returned a parseable response' };
}

export function retryDelayMs(classification, retryCount, { maxDelayMs = 5_000, random = Math.random } = {}) {
  if (classification.retryAfterMs !== null && classification.retryAfterMs !== undefined) {
    return Math.min(classification.retryAfterMs, maxDelayMs);
  }
  const exponential = Math.min(maxDelayMs, 100 * (2 ** retryCount));
  return Math.floor(exponential * (0.5 + random()));
}

export function isRetryableOperation(tool) {
  const method = String(tool?.versionObj?.meta?.method ?? tool?.versionObj?.adapter?._method ?? 'POST').toUpperCase();
  const sideEffects = tool?.versionObj?.meta?.sideEffects ?? tool?.versionObj?.adapter?.sideEffects ?? 'write';
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) || ['read', 'none'].includes(sideEffects);
}
