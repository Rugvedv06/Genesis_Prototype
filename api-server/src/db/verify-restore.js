import { loadEnv } from '../lib/env.js';
loadEnv();

import { getPool, closePool } from './pool.js';
import { migrationStatus } from './migrate.js';
import { verifyAuditChain } from './audit-repository.js';
import { getLocalWorkspaceId } from './workspace.js';

try {
  const databaseName = process.env.RESTORE_DATABASE_NAME;
  if (!databaseName || !/^healr_restore_[a-zA-Z0-9_]{1,48}$/.test(databaseName)) throw new Error('A safe isolated restore database name is required');
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.toString();
  const pool = getPool();
  const migrations = await migrationStatus(pool);
  const workspaceId = await getLocalWorkspaceId(pool);
  const [audit, countsResult, pointers, eventCursor] = await Promise.all([
    verifyAuditChain(pool),
    pool.query(
      `SELECT (SELECT count(*) FROM apis WHERE workspace_id = $1) AS apis,
        (SELECT count(*) FROM tools WHERE workspace_id = $1) AS tools,
        (SELECT count(*) FROM adapter_versions WHERE workspace_id = $1) AS versions,
        (SELECT count(*) FROM invocations WHERE workspace_id = $1) AS invocations,
        (SELECT count(*) FROM gateway_events WHERE workspace_id = $1) AS events`, [workspaceId]),
    pool.query(
      `SELECT count(*) AS invalid FROM tools t
       LEFT JOIN adapter_versions v ON v.workspace_id = t.workspace_id AND v.api_id = t.api_id
         AND v.tool_name = t.tool_name AND v.version = t.current_version
       WHERE t.workspace_id = $1 AND v.version IS NULL`, [workspaceId]),
    pool.query(
      `SELECT c.last_committed_id::text AS cursor, COALESCE(max(e.id), 0)::text AS max_event
       FROM gateway_event_cursors c LEFT JOIN gateway_events e ON e.workspace_id = c.workspace_id
       WHERE c.workspace_id = $1 GROUP BY c.last_committed_id`, [workspaceId]),
  ]);
  const counts = countsResult.rows[0];
  const cursor = eventCursor.rows[0];
  const ok = migrations.ok && audit.ok && Number(pointers.rows[0]?.invalid ?? 1) === 0
    && cursor && BigInt(cursor.cursor) >= BigInt(cursor.max_event);
  console.log(JSON.stringify({ ok, database: databaseName, migrations, audit,
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])),
    activePointerFailures: Number(pointers.rows[0]?.invalid ?? 0), eventCursor: cursor }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: 'restore_verification_failed', errorClass: error.name ?? 'Error' }));
  process.exitCode = 1;
} finally {
  try { await closePool(); } catch { process.exitCode = 1; }
}
