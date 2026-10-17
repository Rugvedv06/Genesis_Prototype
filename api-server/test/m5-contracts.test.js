import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contract = async (name) => JSON.parse(await readFile(new URL(`../../contracts/${name}`, import.meta.url), 'utf8'));

test('M5 contracts describe Tier 2 usage, latency, review proposals and metrics dimensions', async () => {
  const [sse, audit, endpoints] = await Promise.all(['sse.event.envelope.json', 'audit.record.json', 'core.endpoints.json'].map(contract));
  assert.equal(sse.example.type, 'patch.proposed');
  assert.equal(sse.example.provider, 'gemini');
  assert.ok(sse.example.usage.totalTokens > 0);
  assert.ok(Number.isFinite(sse.example.latencyMs));
  assert.ok(sse.haltDetails.needsOperator);
  assert.ok(Array.isArray(sse.haltDetails.proposal.ops));
  assert.equal(audit.provider, 'gemini');
  assert.ok(audit.usage.totalTokens > 0);
  assert.ok(Number.isFinite(audit.latencyMs));
  assert.match(endpoints.endpoints.find((item) => item.path === '/metrics').description, /tokensByRole.*tokensByTier.*Tier 2 outcome/);
});

test('mock contract covers M11 and active, stale, unavailable OpenAPI modes', async () => {
  const [mock, endpoints] = await Promise.all(['mock.admin.api.json', 'core.endpoints.json'].map(contract));
  assert.deepEqual(mock.specModes, ['active', 'stale', 'unavailable']);
  assert.equal(mock.endpoints.find((item) => item.path === '/admin/config').body.specStale, false);
  assert.match(mock.domain.endpoints.join(' '), /M11/);
  assert.ok(endpoints.endpoints.some((item) => item.path === '/apis/import/openapi/preview' && item.status === 'live'));
});
