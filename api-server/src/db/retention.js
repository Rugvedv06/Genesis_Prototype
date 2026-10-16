import { loadEnv } from '../lib/env.js';
loadEnv();

import { getPool, closePool } from './pool.js';
import { migrationStatus } from './migrate.js';
import { withTransaction } from './transaction.js';
import { getLocalWorkspaceId } from './workspace.js';
import { appendAuditInTransaction } from './audit-repository.js';

const MAX_BATCH_SIZE = 10_000;

function parseArgs(argv) {
  const options = { apply: false, logDays: 90, eventDays: 180, batchSize: 1000 };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--log-days=')) options.logDays = Number(arg.slice(11));
    else if (arg.startsWith('--event-days=')) options.eventDays = Number(arg.slice(13));
    else if (arg.startsWith('--batch-size=')) options.batchSize = Number(arg.slice(13));
    else throw new TypeError(`Unknown option: ${arg.split('=')[0]}`);
  }
  for (const key of ['logDays', 'eventDays']) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > 3650) throw new TypeError(`${key} must be between 1 and 3650`);
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > MAX_BATCH_SIZE) throw new TypeError(`batch size must be between 1 and ${MAX_BATCH_SIZE}`);
  return options;
}

async function preview(pool, options) {
  const workspaceId = await getLocalWorkspaceId(pool);
  const [logs, events] = await Promise.all([
    pool.query('SELECT count(*) AS count FROM service_logs WHERE occurred_at < now() - ($2::double precision * interval \'1 day\') AND (workspace_id = $1 OR workspace_id IS NULL)', [workspaceId, options.logDays]),
    pool.query('SELECT count(*) AS count FROM gateway_events WHERE workspace_id = $1 AND occurred_at < now() - ($2::double precision * interval \'1 day\')', [workspaceId, options.eventDays]),
  ]);
  return { logs: Number(logs.rows[0].count), events: Number(events.rows[0].count) };
}

async function deleteLogsBatch(pool, workspaceId, options) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `WITH victims AS (
         SELECT id FROM service_logs WHERE (workspace_id = $1 OR workspace_id IS NULL)
           AND occurred_at < now() - ($2::double precision * interval '1 day')
         ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED
       ) DELETE FROM service_logs s USING victims v WHERE s.id = v.id RETURNING s.id`,
      [workspaceId, options.logDays, options.batchSize],
    );
    if (rows.length) await appendAuditInTransaction(client, {
      decision: 'retention_pruned', category: 'service_logs', rows: rows.length, retentionDays: options.logDays,
    });
    return rows.length;
  }, { pool });
}

async function deleteEventsBatch(pool, workspaceId, options) {
  return withTransaction(async (client) => {
    // The SSE cursor can only express a pruned prefix. Find the first event
    // inside the retention window, then prune every earlier local event ID;
    // this may expire some newer rows that preceded that boundary in commit
    // order, but it never leaves a hidden cursor gap.
    const { rows: boundaryRows } = await client.query(
      `SELECT min(id) AS first_retained_id FROM gateway_events
       WHERE workspace_id = $1 AND occurred_at >= now() - ($2::double precision * interval '1 day')`,
      [workspaceId, options.eventDays],
    );
    const { rows: headRows } = await client.query(
      'SELECT last_committed_id FROM gateway_event_cursors WHERE workspace_id = $1 FOR UPDATE', [workspaceId],
    );
    if (!headRows[0]) throw new Error('Durable event cursor state is missing');
    const firstRetained = headRows[0].last_committed_id === '0' || boundaryRows[0].first_retained_id === null
      ? null : BigInt(boundaryRows[0].first_retained_id);
    const safeFloor = firstRetained === null ? BigInt(headRows[0].last_committed_id) : firstRetained - 1n;
    const { rows } = await client.query(
      `WITH victims AS (
         SELECT id FROM gateway_events WHERE workspace_id = $1 AND id <= $2::bigint
         ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED
       ) DELETE FROM gateway_events e USING victims v WHERE e.id = v.id RETURNING e.id`,
      [workspaceId, safeFloor.toString(), options.batchSize],
    );
    if (!rows.length) return 0;
    const lastDeleted = rows.reduce((max, row) => BigInt(row.id) > max ? BigInt(row.id) : max, 0n);
    await client.query(
      `UPDATE gateway_event_cursors SET retention_floor = GREATEST(retention_floor, $2::bigint), updated_at = now()
       WHERE workspace_id = $1`, [workspaceId, lastDeleted.toString()],
    );
    await appendAuditInTransaction(client, {
      decision: 'retention_pruned', category: 'gateway_events', rows: rows.length,
      retentionDays: options.eventDays, retentionFloor: lastDeleted.toString(),
    });
    return rows.length;
  }, { pool });
}

export async function runRetention({ pool = getPool(), options = parseArgs(process.argv.slice(2)) } = {}) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const migrations = await migrationStatus(pool);
  if (!migrations.ok) throw new Error('Database migrations are missing or inconsistent');
  const workspaceId = await getLocalWorkspaceId(pool);
  const before = await preview(pool, options);
  if (!options.apply) return { ok: true, mode: 'dry-run', ...options, apply: undefined, wouldDelete: before, auditRetention: 'permanent' };
  let logsDeleted = 0;
  let eventsDeleted = 0;
  while (logsDeleted < before.logs) {
    const count = await deleteLogsBatch(pool, workspaceId, options);
    logsDeleted += count;
    if (!count) break;
  }
  // Re-evaluate after each transaction because every deletion advances the
  // durable retention floor and concurrent inserts may arrive during the job.
  while (eventsDeleted < before.events) {
    const count = await deleteEventsBatch(pool, workspaceId, options);
    eventsDeleted += count;
    if (!count) break;
  }
  const after = await preview(pool, options);
  return { ok: true, mode: 'apply', deleted: { logs: logsDeleted, events: eventsDeleted }, remainingEligible: after, auditRetention: 'permanent' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { console.log(JSON.stringify(await runRetention())); }
  catch (error) {
    console.error(JSON.stringify({ ok: false, code: 'retention_failed', errorClass: error.name ?? 'Error' }));
    process.exitCode = 1;
  } finally {
    try { await closePool(); } catch { process.exitCode = 1; }
  }
}
