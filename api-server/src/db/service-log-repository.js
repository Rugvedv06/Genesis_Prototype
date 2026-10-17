import { getLocalWorkspaceId } from './workspace.js';

const CONTEXT_KEYS = new Set(['port', 'version', 'signal', 'apiId', 'tool', 'errorClass', 'count']);

export async function appendServiceLog(queryable, record) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const context = Object.fromEntries(Object.entries(record ?? {}).filter(([key, value]) =>
    CONTEXT_KEYS.has(key) && ((typeof value === 'string' && value.length <= 160)
      || (typeof value === 'number' && Number.isFinite(value)))));
  const level = ['info', 'warn', 'error', 'fatal'].includes(record?.level) ? record.level : 'info';
  const service = ['api-server', 'api-client', 'demo-server', 'demo-client'].includes(record?.service) ? record.service : 'api-server';
  const code = typeof record?.code === 'string' ? record.code : 'service_event';
  const message = typeof record?.msg === 'string' ? record.msg : code;
  const { rows } = await queryable.query(
    `INSERT INTO service_logs(service, level, code, message, workspace_id, context)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [service, level, code, message, workspaceId, JSON.stringify(context)],
  );
  return rows[0]?.id ?? null;
}

export async function searchServiceLogs(queryable, { limit = 100, beforeId, level, code } = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 500)) : 100;
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT id, occurred_at, service, level, code, message, call_id, run_id, api_id, tool_name, context
     FROM service_logs
     WHERE (workspace_id = $1 OR workspace_id IS NULL)
       AND ($2::bigint IS NULL OR id < $2)
       AND ($3::text IS NULL OR level = $3)
       AND ($4::text IS NULL OR code = $4)
     ORDER BY id DESC LIMIT $5`,
    [workspaceId, beforeId ?? null, level ?? null, code ?? null, safeLimit],
  );
  return rows;
}
