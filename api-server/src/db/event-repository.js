import { getLocalWorkspaceId } from './workspace.js';

const EVENT_APPEND_LOCK_KEY = 741903212;
const MAX_CURSOR = 9_223_372_036_854_775_807n;
const DROP_KEYS = new Set([
  'args', 'arguments', 'data', 'request', 'requestbody', 'response', 'responsebody', 'body',
  'prompt', 'evidence', 'errors', 'error', 'message', 'headers', 'cookies', 'authorization',
  'credential', 'credentials', 'password', 'secret', 'token', 'apikey', 'accesstoken', 'refreshtoken',
  'url', 'baseurl', 'specurl', 'details',
]);

function normalizedKey(key) {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function safeEventValue(value, key = '') {
  const normalized = normalizedKey(key);
  if (DROP_KEYS.has(normalized) || normalized.includes('authorization') || normalized.includes('password')
    || normalized.includes('secret') || normalized.includes('credential') || normalized.includes('cookie')
    || normalized.includes('apikey') || normalized.includes('accesstoken') || normalized.includes('refreshtoken')) return undefined;
  if (key === 'ops' && Array.isArray(value)) {
    return value.map((operation) => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return { op: 'unknown' };
      const safe = {};
      for (const field of ['op', 'path', 'from', 'to', 'type', 'name']) {
        const candidate = operation[field];
        if (typeof candidate === 'string' && candidate.length <= 256
          && /^[A-Za-z0-9_$.[\]{}\/-]+$/.test(candidate) && !/\d{4,}/.test(candidate)
          && !/(secret|token|password|credential|apikey|authorization|cookie)/i.test(candidate)) safe[field] = candidate;
      }
      if (operation.source && typeof operation.source === 'object') {
        safe.source = Object.fromEntries(['type', 'ref'].filter((field) => typeof operation.source[field] === 'string'
          && /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(operation.source[field])
          && !/(secret|token|password|credential|apikey|authorization|cookie)/i.test(operation.source[field]))
          .map((field) => [field, operation.source[field]]));
      }
      return safe;
    });
  }
  if (Array.isArray(value)) return value.map((item) => safeEventValue(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, child]) => [childKey, safeEventValue(child, childKey)])
      .filter(([, child]) => child !== undefined));
  }
  if (['string', 'number', 'boolean'].includes(typeof value) || value === null) return value;
  return undefined;
}

function parseCursor(cursor = '0') {
  if (typeof cursor === 'number') {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError('event cursor must be a non-negative safe integer or decimal string');
    return BigInt(cursor);
  }
  if (typeof cursor !== 'string' || !/^\d{1,19}$/.test(cursor)) throw new TypeError('event cursor must be a non-negative decimal string');
  const value = BigInt(cursor);
  if (value > MAX_CURSOR) throw new TypeError('event cursor exceeds PostgreSQL BIGINT range');
  return value;
}

function eventTimestamp(value) {
  if (value === undefined || value === null) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('event timestamp is invalid');
  return date;
}

/** Insert into PostgreSQL before publishing to SSE. Call inside the domain UoW. */
export async function appendGatewayEventInTransaction(client, event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || !event.type) {
    throw new TypeError('event type is required');
  }
  const workspaceId = await getLocalWorkspaceId(client);
  if (event.callId != null) {
    const { rows } = await client.query('SELECT call_id FROM invocations WHERE workspace_id = $1 AND call_id = $2 FOR UPDATE', [workspaceId, event.callId]);
    if (!rows[0]) throw new Error('Call events require a durable invocation row');
  }
  // A transaction-scoped lock makes committed cursor IDs monotonic in commit
  // order; sequence allocation alone can otherwise let a late commit fall
  // behind a cursor already sent to a client.
  await client.query('SELECT pg_advisory_xact_lock($1)', [EVENT_APPEND_LOCK_KEY]);
  let sequenceInCall = null;
  if (event.callId != null) {
    const { rows } = await client.query(
      'SELECT COALESCE(MAX(sequence_in_call), -1) + 1 AS next_sequence FROM gateway_events WHERE call_id = $1',
      [event.callId],
    );
    sequenceInCall = rows[0].next_sequence;
  }
  const { rows: idRows } = await client.query("SELECT nextval(pg_get_serial_sequence('gateway_events', 'id')) AS id");
  const id = String(idRows[0].id);
  const ts = event.ts ?? Date.now();
  const occurredAt = eventTimestamp(ts);
  const payload = safeEventValue({ ...event, id, ts }) ?? {};
  payload.id = id;
  payload.ts = ts;
  await client.query(
    `INSERT INTO gateway_events
     (id, event_id, call_id, run_id, workspace_id, api_id, tool_name, event_type, occurred_at, sequence_in_call, payload)
     OVERRIDING SYSTEM VALUE
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [id, id, event.callId ?? null, event.runId ?? null, workspaceId, event.apiId ?? null,
      event.tool ?? null, event.type, occurredAt, sequenceInCall, JSON.stringify(payload)],
  );
  await client.query(
    `INSERT INTO gateway_event_cursors(workspace_id, last_committed_id)
     VALUES ($1, $2) ON CONFLICT (workspace_id) DO UPDATE SET
       last_committed_id = GREATEST(gateway_event_cursors.last_committed_id, EXCLUDED.last_committed_id),
       updated_at = now()`,
    [workspaceId, id],
  );
  return payload;
}

export async function readEventsAfter(queryable, cursor = '0', { apiId, types, limit = 500 } = {}) {
  const cursorValue = parseCursor(cursor);
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 1000)) : 500;
  const workspaceId = await getLocalWorkspaceId(queryable);
  const eventTypes = types ? [...types].filter((type) => typeof type === 'string' && type.length <= 128) : null;
  const { rows } = await queryable.query(
    `WITH cursor_state AS (
       SELECT retention_floor::text, last_committed_id::text
       FROM gateway_event_cursors WHERE workspace_id = $1
     ), event_page AS (
       SELECT id, payload FROM gateway_events
       WHERE workspace_id = $1 AND id > $2::bigint
         AND ($3::text IS NULL OR api_id = $3)
         AND ($4::text[] IS NULL OR event_type = ANY($4::text[]))
       ORDER BY id LIMIT $5
     )
     SELECT cursor_state.retention_floor, cursor_state.last_committed_id, event_page.id::text AS id, event_page.payload
     FROM cursor_state LEFT JOIN event_page ON true ORDER BY event_page.id`,
    [workspaceId, cursorValue.toString(), apiId ?? null, eventTypes, safeLimit],
  );
  if (!rows.length) throw new Error('Durable event cursor state is missing for the workspace');
  const retentionFloor = BigInt(rows[0].retention_floor);
  const highWater = BigInt(rows[0].last_committed_id);
  const resetReason = cursorValue < retentionFloor ? 'cursor_expired' : (cursorValue > highWater ? 'cursor_ahead' : null);
  return {
    events: resetReason ? [] : rows.filter((row) => row.id !== null).map((row) => row.payload),
    highWaterId: highWater.toString(),
    retentionFloor: retentionFloor.toString(),
    resetReason,
  };
}

// Return a bounded, newest-first history snapshot and its high-water cursor
// from one SQL statement so the client can hydrate and then resume SSE without
// a gap between the snapshot and the live stream.
export async function listRecentEvents(queryable, limit = 5000) {
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 10_000)) : 5000;
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `WITH cursor_state AS (
       SELECT last_committed_id::text AS high_water_id, retention_floor::text AS retention_floor
       FROM gateway_event_cursors WHERE workspace_id = $1
     ), recent AS (
       SELECT id, payload FROM gateway_events
       WHERE workspace_id = $1 ORDER BY id DESC LIMIT $2
     )
     SELECT cursor_state.high_water_id, cursor_state.retention_floor, recent.id::text AS id, recent.payload
     FROM cursor_state LEFT JOIN recent ON true ORDER BY recent.id`,
    [workspaceId, safeLimit],
  );
  if (!rows.length) throw new Error('Durable event cursor state is missing for the workspace');
  return {
    lastEventId: rows[0].high_water_id,
    retentionFloor: rows[0].retention_floor,
    events: rows.filter((row) => row.id !== null).map((row) => row.payload),
  };
}

export async function listCallEvents(queryable, callId) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT payload, sequence_in_call FROM gateway_events
     WHERE workspace_id = $1 AND call_id = $2 ORDER BY id`, [workspaceId, callId],
  );
  return rows.map((row) => ({ ...row.payload, sequenceInCall: row.sequence_in_call }));
}

export async function getEventCursor(queryable) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT last_committed_id::text AS last_event_id, retention_floor::text AS retention_floor
     FROM gateway_event_cursors WHERE workspace_id = $1`, [workspaceId],
  );
  if (!rows[0]) throw new Error('Durable event cursor state is missing for the workspace');
  return rows[0];
}
