import { loadEnv } from '../lib/env.js';
loadEnv();

import { getPool, closePool } from './pool.js';
import { migrationStatus } from './migrate.js';
import { withTransaction } from './transaction.js';
import { getLocalWorkspaceId } from './workspace.js';
import { startInvocationInTransaction, finishInvocationInTransaction } from './invocation-repository.js';
import { appendGatewayEventInTransaction } from './event-repository.js';
import { appendAuditInTransaction } from './audit-repository.js';

const DEFAULT_COUNT = 1_000;
const CHUNK_SIZE = 100;
const MAX_COUNT = 10_000;
const DATASET_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;

function parseArgs(argv) {
  const options = { apply: false, count: DEFAULT_COUNT, days: 30, dataset: 'm15-demo-v1', apiId: null, toolName: null };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--count=')) options.count = Number(arg.slice(8));
    else if (arg.startsWith('--days=')) options.days = Number(arg.slice(7));
    else if (arg.startsWith('--dataset=')) options.dataset = arg.slice(10);
    else if (arg.startsWith('--api=')) options.apiId = arg.slice(6);
    else if (arg.startsWith('--tool=')) options.toolName = arg.slice(7);
    else throw new TypeError(`Unknown option: ${arg.split('=')[0]}`);
  }
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > MAX_COUNT) throw new TypeError(`--count must be between 1 and ${MAX_COUNT}`);
  if (!Number.isSafeInteger(options.days) || options.days < 1 || options.days > 3650) throw new TypeError('--days must be between 1 and 3650');
  if (!DATASET_RE.test(options.dataset)) throw new TypeError('--dataset has invalid characters or length');
  return options;
}

function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function seedFor(dataset, index) {
  let hash = 2166136261;
  for (const char of `${dataset}:${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function describeOutcome(random) {
  const draw = random();
  if (draw < 0.84) return { outcome: 'succeeded', event: 'call.succeeded', decision: 'demo_data.seeded_call_succeeded', httpStatus: 200, errorCode: null, haltReason: null };
  if (draw < 0.91) return { outcome: 'rejected', event: 'call.failed', decision: 'demo_data.seeded_call_rejected', httpStatus: 422, errorCode: 'upstream_rejected', haltReason: null };
  if (draw < 0.97) return { outcome: 'halted', event: 'call.failed', decision: 'demo_data.seeded_call_halted', httpStatus: null, errorCode: 'tool_unavailable', haltReason: 'contract_drift_unresolved' };
  return { outcome: 'failed', event: 'call.failed', decision: 'demo_data.seeded_call_failed', httpStatus: 502, errorCode: 'upstream_error', haltReason: null };
}

function sampleCall(index, options, tool, random, now) {
  const startedAt = new Date(now - random() * options.days * 86_400_000);
  const durationMs = Math.round(35 + random() ** 2 * 4_500);
  const result = describeOutcome(random);
  const callId = `demo:m15:${options.dataset}:${String(index).padStart(6, '0')}`;
  const finalVersion = Number(tool.current_version);
  const started = { type: 'call.started', callId, runId: `run:${options.dataset}:${String(index).padStart(6, '0')}`, apiId: tool.api_id, tool: tool.tool_name, ts: startedAt.getTime(), sampleData: true };
  const terminal = {
    type: result.event, callId, runId: started.runId, apiId: tool.api_id, tool: tool.tool_name,
    ts: startedAt.getTime() + durationMs, sampleData: true,
    ...(result.outcome === 'succeeded' ? { version: finalVersion, healed: false } : { code: result.errorCode, reason: result.haltReason ?? result.errorCode }),
  };
  return { callId, started, terminal, startedAt, durationMs, finalVersion, result };
}

async function loadTarget(pool, options) {
  const workspaceId = await getLocalWorkspaceId(pool);
  const { rows } = await pool.query(
    `SELECT a.api_id, t.tool_name, t.current_version, a.config->'healing'->>'mode' AS healing_mode
     FROM apis a JOIN tools t USING (workspace_id, api_id)
     WHERE a.workspace_id = $1 AND a.deleted_at IS NULL AND t.deleted_at IS NULL
       AND ($2::text IS NULL OR a.api_id = $2) AND ($3::text IS NULL OR t.tool_name = $3)
     ORDER BY a.api_id, t.tool_name LIMIT 1`,
    [workspaceId, options.apiId, options.toolName],
  );
  if (!rows[0]) throw new Error('No active API/tool matches; register an API first or pass --api and --tool');
  return rows[0];
}

export async function seedDemoData({ pool = getPool(), options = parseArgs(process.argv.slice(2)) } = {}) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; demo data is written only to PostgreSQL');
  const lockClient = await pool.connect();
  const lockName = `healr:seed:${options.dataset}`;
  let locked = false;
  try {
    await lockClient.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName]);
    locked = true;
    return await seedDemoDataLocked(pool, options);
  } finally {
    try { if (locked) await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]); }
    finally { lockClient.release(); }
  }
}

async function seedDemoDataLocked(pool, options) {
  const migrations = await migrationStatus(pool);
  if (!migrations.ok) throw new Error('Database migrations are missing or inconsistent');
  const target = await loadTarget(pool, options);
  const runPrefix = `demo:m15:${options.dataset}:`;
  const { rows: existingRows } = await pool.query(
    `SELECT call_id, outcome FROM invocations WHERE left(call_id, length($1)) = $1 ORDER BY call_id`, [runPrefix],
  );
  const existing = existingRows.length;
  for (let index = 0; index < existingRows.length; index += 1) {
    const expectedId = `${runPrefix}${String(index).padStart(6, '0')}`;
    if (existingRows[index].call_id !== expectedId || existingRows[index].outcome === 'running') {
      throw new Error('Seed namespace has a gap or incomplete invocation; refusing to extend it');
    }
  }
  if (existing > options.count) throw new Error(`Seed namespace already contains ${existing} records, greater than requested count ${options.count}`);
  const plan = {
    ok: true, mode: options.apply ? 'apply' : 'dry-run', dataset: options.dataset,
    apiId: target.api_id, tool: target.tool_name, targetCurrentVersion: Number(target.current_version),
    requestedCalls: options.count, existingCalls: existing, callsToAdd: options.count - existing,
    estimatedEvents: (options.count - existing) * 2, estimatedAuditEntries: options.count - existing,
    periodDays: options.days, synthetic: true,
  };
  if (!options.apply || existing === options.count) return { ...plan, applied: options.apply && existing === options.count ? 0 : undefined, alreadySeeded: existing === options.count };

  const now = Date.now();
  let applied = 0;
  for (let start = existing; start < options.count; start += CHUNK_SIZE) {
    const end = Math.min(options.count, start + CHUNK_SIZE);
    await withTransaction(async (client) => {
      for (let index = start; index < end; index += 1) {
        const call = sampleCall(index, options, target, prng(seedFor(options.dataset, index)), now);
        const { rows: duplicate } = await client.query('SELECT outcome FROM invocations WHERE call_id = $1 FOR UPDATE', [call.callId]);
        if (duplicate[0]) {
          if (duplicate[0].outcome === 'running') throw new Error(`Seed invocation ${index} is incomplete`);
          continue;
        }
        await startInvocationInTransaction(client, {
          callId: call.callId, runId: call.started.runId, apiId: target.api_id, toolName: target.tool_name,
          initialVersion: Number(target.current_version), healingMode: target.healing_mode ?? 'enforce',
          startedAt: call.startedAt, summary: { sampleData: true, dataset: options.dataset, cohort: ['web', 'mobile', 'batch'][index % 3] },
        });
        await appendGatewayEventInTransaction(client, call.started);
        await finishInvocationInTransaction(client, {
          callId: call.callId, outcome: call.result.outcome, finishedAt: new Date(call.startedAt.getTime() + call.durationMs),
          finalVersion: call.finalVersion, httpStatus: call.result.httpStatus, errorCode: call.result.errorCode,
          haltReason: call.result.haltReason, durationMs: call.durationMs,
          rounds: 0, cacheHit: index % 17 === 0, inputTokens: 0, outputTokens: 0,
          summary: { sampleData: true, dataset: options.dataset },
        });
        await appendGatewayEventInTransaction(client, call.terminal);
        await appendAuditInTransaction(client, {
          decision: call.result.decision, apiId: target.api_id, tool: target.tool_name,
          callId: call.callId, versionBefore: Number(target.current_version), versionAfter: call.finalVersion,
          reason: call.result.haltReason ?? call.result.errorCode ?? 'sample_success', sampleData: true, dataset: options.dataset,
        });
        applied += 1;
      }
    }, { pool });
  }
  return { ...plan, applied, existingCalls: existing, completedCalls: existing + applied };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await seedDemoData();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: 'db_seed_failed', message: error.message }));
    process.exitCode = 1;
  } finally {
    try { await closePool(); } catch { process.exitCode = 1; }
  }
}
