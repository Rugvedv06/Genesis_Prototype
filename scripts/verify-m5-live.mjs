#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadEnv } from '../api-server/src/lib/env.js';
import { parseKeys } from '@healr/llm';
import { tier2SampleStatus } from './verify-m5-live-utils.js';

loadEnv();
const keys = parseKeys(process.env);
const outputPath = resolve(process.env.M5_LIVE_RESULTS ?? 'artifacts/m5-live-results.json');
const core = process.env.CORE_URL ?? 'http://localhost:8000';
const mock = process.env.MOCK_URL ?? 'http://localhost:5001';
const results = { createdAt: new Date().toISOString(), status: 'in_progress', configuredKeyCount: keys.length, expectedKeyCount: 4, checks: [], slotCalls: {}, tier2LatencyMs: [], outputFile: outputPath };

async function save() {
  results.status = results.checks.some((check) => check.status === 'failed') ? 'failed' : results.checks.some((check) => check.status === 'pending') ? 'incomplete' : results.checks.some((check) => check.status === 'skipped') ? 'skipped' : 'passed';
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write('\nM5 live verification\n');
  process.stdout.write(`Check                         Result\n`);
  for (const check of results.checks) process.stdout.write(`${check.name.padEnd(30)} ${check.status}${check.detail ? ` · ${check.detail}` : ''}\n`);
  process.stdout.write(`Gemini keys configured       ${results.configuredKeyCount}/${results.expectedKeyCount}\n`);
  if (results.tier2LatencyMs.length) process.stdout.write(`Tier 2 latency p50 / p95     ${percentile(results.tier2LatencyMs, 0.5)} / ${percentile(results.tier2LatencyMs, 0.95)} ms\n`);
  process.stdout.write(`JSON results                 ${outputPath}\n`);
}

function add(name, status, detail) {
  const normalized = status === true ? 'passed' : status === false ? 'failed' : status;
  results.checks.push({ name, status: normalized, ...(detail ? { detail: String(detail).slice(0, 300) } : {}) });
}
function percentile(values, p) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null; }

if (!keys.length) {
  add('Gemini credentials', 'skipped', 'Set GEMINI_API_KEYS or GEMINI_API_KEY to run live provider checks.');
  await save();
  process.stdout.write('SKIP: Gemini credentials are not configured.\n');
  process.exitCode = 0;
} else {
  try {
    const { propose } = await import('../api-server/src/features/diagnoser/tier2-llm/index.js');
    const healthResponse = await fetch(`${core}/provider/health`, { signal: AbortSignal.timeout(6000) });
    const health = await healthResponse.json();
    for (const role of ['agent', 'diagnoser']) add(`${role} provider health`, health.roles?.[role]?.ok ? 'passed' : 'failed', health.roles?.[role]?.code ?? health.roles?.[role]?.model ?? 'unavailable');
    const mockHealth = await fetch(`${mock}/health`, { signal: AbortSignal.timeout(6000) });
    add('Mock API health', mockHealth.ok ? 'passed' : 'failed', `HTTP ${mockHealth.status}`);
    if (!healthResponse.ok || !mockHealth.ok) throw new Error('Core provider and mock health endpoints must be available.');

    for (let index = 0; index < 5; index += 1) {
      const started = Date.now();
      const proposal = await propose({
        tool: { apiId: 'm5-live-probe', name: 'update_user_email', risk: 'medium', sideEffects: 'write', version: 1, versionObj: { meta: { logicalSchema: { properties: { user_id: {}, email: {} } } } } },
        args: { user_id: '123', email: 'live-check@example.com' },
        failure: { text: 'subscriber_ref is required' },
        kind: 'body422', specExcerpt: 'contact_address is required', budgetMs: 2500,
      });
      const elapsed = Math.max(0, Math.round(proposal.latencyMs ?? Date.now() - started));
      if (!proposal.failure) results.tier2LatencyMs.push(elapsed);
      if (Number.isInteger(proposal.keySlot)) results.slotCalls[proposal.keySlot] = (results.slotCalls[proposal.keySlot] ?? 0) + 1;
      if (proposal.failure) add(`Tier 2 sample ${index + 1}`, tier2SampleStatus(proposal), `${proposal.failure}${proposal.errorCode ? ` (${proposal.errorCode})` : ''}${proposal.providerMessage ? `: ${proposal.providerMessage}` : ''}`);
      else add(`Tier 2 sample ${index + 1}`, 'passed', `slot ${proposal.keySlot}`);
    }
    const seenSlots = Object.keys(results.slotCalls).length;
    add('Four-key round robin', seenSlots === Math.min(4, keys.length) && keys.length >= 4 ? 'passed' : 'failed', `${seenSlots} slots observed across ${keys.length} configured keys`);

    const request = async (url, body, method = 'POST') => {
      const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(70_000) });
      const json = await response.json();
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: json.error ?? json.code ?? 'http_error' });
      return json;
    };
    const tools = [
      { name: 'get_user', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none', parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false }, response: { fields: { id: { path: 'result.id', type: 'string' }, name: { path: 'result.name', type: 'string' }, email: { path: 'result.email', type: 'string', format: 'email' } } } },
      { name: 'update_user_email', method: 'POST', path: '/api/users/update-email', risk: 'medium', sideEffects: 'write', parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['user_id', 'email'], additionalProperties: false }, response: { fields: { id: { path: 'result.id', type: 'string' }, email: { path: 'result.email', type: 'string', format: 'email' }, updated_at: { path: 'result.updated_at', type: 'string' } } } },
      { name: 'set_user_status', method: 'POST', path: '/api/users/set-status', risk: 'medium', sideEffects: 'write', parameters: { type: 'object', properties: { user_id: { type: 'string' }, status: { type: 'string' } }, required: ['user_id', 'status'], additionalProperties: false }, response: { fields: { id: { path: 'result.id', type: 'string' }, status: { path: 'result.status', type: 'string' } } } },
    ];
    await request(`${mock}/admin/reset`);
    await fetch(`${core}/apis/demo-users`, { method: 'DELETE', signal: AbortSignal.timeout(6000) });
    await request(`${core}/apis`, { apiId: 'demo-users', baseUrl: mock, specUrl: `${mock}/openapi.json`, credentials: { 'X-Tenant': { env: 'TENANT_ID' } }, healing: { enabled: true, maxRounds: 5, tier2: true }, tools });
    const taskPrompt = 'Fetch user 123, update their email to asha.new@example.com, then fetch the user again and report the user name and email.';
    const compare = async (mutation, runPrefix) => {
      await request(`${mock}/admin/mutate`, { id: mutation });
      const runId = `${runPrefix}_${Date.now()}`;
      const [healed, baseline] = await Promise.all([
        request(`${core}/tasks`, { apiId: 'demo-users', prompt: taskPrompt, wait: true, runId: `h_${runId}` }),
        request(`${mock}/demo/run`, { apiId: 'demo-users', prompt: taskPrompt, runId: `b_${runId}` }),
      ]);
      return { healed, baseline };
    };
    const m5 = await compare('M5', 'm5');
    add('M5 healed agent task', m5.healed.outcome === 'completed' ? 'passed' : 'failed', `${m5.healed.outcome}${m5.healed.error?.code ? ` (${m5.healed.error.code})` : ''}`);
    add('M5 baseline honest outcome', ['completed', 'step_limit'].includes(m5.baseline.outcome) ? 'passed' : 'failed', `${m5.baseline.mode}:${m5.baseline.outcome}${m5.baseline.error?.code ? ` (${m5.baseline.error.code})` : ''}`);
    add('M5 same provider and model', m5.baseline.mode === 'llm' && m5.baseline.provider === m5.healed.provider && m5.baseline.model === m5.healed.model ? 'passed' : 'failed', `${m5.baseline.provider}:${m5.baseline.model} / ${m5.healed.provider}:${m5.healed.model}`);

    await request(`${mock}/admin/mutate`, { id: 'M8' });
    await request(`${mock}/admin/config`, { specAvailable: false, specStale: false });
    const m8 = await request(`${core}/apis/demo-users/tools/set_user_status/invoke`, { args: { user_id: '123', status: 'active' }, runId: `m8_${Date.now()}` });
    add('M8 Tier 2 with unavailable spec', m8.meta?.tier === 2 || m8.error?.details?.tier === 2, m8.ok ? 'request completed' : m8.error?.details?.reason ?? m8.error?.code);

    await request(`${mock}/admin/mutate`, { id: 'M11' });
    await request(`${mock}/admin/config`, { specAvailable: false, specStale: false });
    const m11 = await request(`${core}/apis/demo-users/tools/update_user_email/invoke`, { args: { user_id: '123', email: 'm11-live@example.com' }, runId: `m11_${Date.now()}` });
    add('M11 Tier 2 update', m11.meta?.tier === 2 || m11.error?.details?.tier === 2 || m11.error?.details?.proposal?.tier === 2, m11.ok ? 'request completed' : m11.error?.details?.reason ?? m11.error?.code);

    const m10 = await compare('M10', 'm10');
    const truth = await request(`${mock}/admin/truth/users/123`, undefined, 'GET');
    const isTruth = (data) => { const row = data?.id !== undefined ? data : data?.result ?? data; return Boolean(row && String(row.id) === String(truth.id) && String(row.name) === String(truth.name) && String(row.email) === String(truth.email)); };
    add('M10 baseline wrong data', m10.baseline.outcome === 'completed' && Boolean(m10.baseline.data) && !isTruth(m10.baseline.data), isTruth(m10.baseline.data) ? 'baseline matched truth' : 'completed with data that differs from canonical truth');
    add('M10 healed correct data', isTruth(m10.healed.data), isTruth(m10.healed.data) ? 'healed data matches truth' : 'healed data did not match truth');
    const audit = await request(`${core}/audit/verify`, undefined, 'GET');
    add('Audit chain verification', audit.ok === true, audit.ok ? 'valid' : audit.reason ?? 'invalid');
  } catch (error) {
    add('Live run', 'failed', error.code ?? error.message ?? 'unknown error');
    process.exitCode = 1;
  }
  await save();
  if (results.status !== 'passed') process.exitCode = 1;
}
