import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUpstream, isRetryableOperation } from '../src/features/upstream-classifier/index.js';

function response(status, body, headers = { 'content-type': 'application/json' }) {
  const bodyText = typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: typeof body === 'string' ? null : body, bodyText, text: bodyText, headers };
}

test('classifies transport, auth, rate limit, upstream, and request failures', () => {
  assert.equal(classifyUpstream({ status: 0, error: new Error('timeout') }).classification, 'transport_error');
  assert.equal(classifyUpstream(response(401, { error: 'unauthorized' })).classification, 'auth_error');
  assert.equal(classifyUpstream(response(429, { error: 'slow down' }, { 'retry-after': '2' })).classification, 'rate_limited');
  assert.equal(classifyUpstream(response(503, { error: 'unavailable' })).classification, 'upstream_error');
  assert.equal(classifyUpstream(response(422, { error: 'invalid request' })).classification, 'request_error');
});

test('classifies empty, malformed, and valid responses without assuming drift', () => {
  assert.equal(classifyUpstream(response(204, '')).classification, 'valid_empty_response');
  assert.equal(classifyUpstream(response(200, '<html>bad gateway</html>', { 'content-type': 'text/html' })).classification, 'invalid_upstream_response');
  assert.equal(classifyUpstream(response(200, '{"broken"', { 'content-type': 'application/json' })).classification, 'invalid_upstream_response');
  assert.equal(classifyUpstream(response(200, { result: { temperature: 24.5 } })).classification, 'successful_response');
});

test('allows structured contract evidence while rejecting generic validation errors', () => {
  const renamed = classifyUpstream(response(422, {
    detail: [{ loc: ['body', 'temperature'], msg: 'field required', type: 'missing' }],
  }));
  assert.equal(renamed.classification, 'request_contract_drift');
  assert.equal(renamed.schemaDiagnosisAllowed, true);
  assert.equal(classifyUpstream(response(422, { detail: [{ msg: 'value is not valid' }] })).classification, 'request_error');
});

test('only idempotent or explicitly read operations are retryable', () => {
  assert.equal(isRetryableOperation({ versionObj: { meta: { method: 'GET' } }}), true);
  assert.equal(isRetryableOperation({ versionObj: { meta: { method: 'POST', sideEffects: 'write' } }}), false);
});
