import { withTransaction } from './transaction.js';
import { getPool } from './pool.js';
import { getLocalWorkspaceId } from './workspace.js';
import { finishInvocationInTransaction } from './invocation-repository.js';
import { appendGatewayEventInTransaction } from './event-repository.js';
import { appendAuditInTransaction } from './audit-repository.js';

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function checkedAge(value) {
  const age = Number(value ?? process.env.HEALR_STALE_INVOCATION_SECONDS ?? 300);
  if (!Number.isSafeInteger(age) || age < 30 || age > MAX_AGE_SECONDS) throw new TypeError('stale invocation age must be 30 seconds to 30 days');
  return age;
}

async function staleRows(queryable, workspaceId, ageSeconds) {
  const { rows } = await queryable.query(
    `SELECT i.call_id, i.api_id, i.tool_name, i.run_id, i.started_at, i.initial_version,
       v.metadata->>'method' AS method,
       COALESCE(v.metadata->>'sideEffects', v.adapter->>'sideEffects', 'write') AS side_effects
     FROM invocations i
     LEFT JOIN adapter_versions v ON v.workspace_id = i.workspace_id AND v.api_id = i.api_id
       AND v.tool_name = i.tool_name AND v.version = i.initial_version
     WHERE i.workspace_id = $1 AND i.outcome = 'running'
       AND i.started_at < now() - ($2::double precision * interval '1 second')
     ORDER BY i.started_at, i.call_id`, [workspaceId, ageSeconds],
  );
  return rows;
}

function isSafeRead(row) {
  return ['GET', 'HEAD'].includes(String(row.method ?? '').toUpperCase())
    && ['read', 'none'].includes(row.side_effects);
}

export async function inspectStaleInvocations({ queryable = getPool(), ageSeconds } = {}) {
  const age = checkedAge(ageSeconds);
  const workspaceId = await getLocalWorkspaceId(queryable);
  const rows = await staleRows(queryable, workspaceId, age);
  return {
    ageSeconds: age,
    count: rows.length,
    safeReadFailures: rows.filter(isSafeRead).length,
    uncertainWrites: rows.filter((row) => !isSafeRead(row)).length,
  };
}

export async function reconcileStaleInvocations({ pool = getPool(), ageSeconds } = {}) {
  const age = checkedAge(ageSeconds);
  const workspaceId = await getLocalWorkspaceId(pool);
  const candidates = await staleRows(pool, workspaceId, age);
  let reconciled = 0;
  for (const candidate of candidates) {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT call_id, api_id, tool_name, run_id, started_at, initial_version
         FROM invocations WHERE workspace_id = $1 AND call_id = $2 AND outcome = 'running'
           AND started_at < now() - ($3::double precision * interval '1 second') FOR UPDATE`,
        [workspaceId, candidate.call_id, age],
      );
      const stale = rows[0];
      if (!stale) return;
      const readOnly = isSafeRead(candidate);
      const outcome = readOnly ? 'failed' : 'outcome_uncertain';
      const errorCode = readOnly ? 'process_interrupted' : 'outcome_uncertain';
      const reason = readOnly ? 'process_interrupted_read_only' : 'upstream_write_outcome_unknown';
      const finishedAt = new Date();
      await finishInvocationInTransaction(client, {
        callId: stale.call_id, outcome, finishedAt, finalVersion: stale.initial_version,
        errorCode, haltReason: reason,
        durationMs: Math.max(0, finishedAt.getTime() - new Date(stale.started_at).getTime()),
      });
      await appendGatewayEventInTransaction(client, {
        type: 'call.failed', callId: stale.call_id, runId: stale.run_id,
        apiId: stale.api_id, tool: stale.tool_name, code: errorCode, reason,
        outcomeUncertain: !readOnly, ts: finishedAt.getTime(),
      });
      await appendAuditInTransaction(client, {
        decision: 'invocation_reconciled', callId: stale.call_id, apiId: stale.api_id,
        tool: stale.tool_name, versionBefore: stale.initial_version,
        reason, outcome,
      });
      reconciled += 1;
    }, { pool });
  }
  return { ageSeconds: age, inspected: candidates.length, reconciled };
}
