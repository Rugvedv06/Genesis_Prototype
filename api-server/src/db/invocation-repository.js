import { getLocalWorkspaceId } from './workspace.js';

const TERMINAL_OUTCOMES = new Set(['succeeded', 'healed', 'halted', 'rejected', 'failed', 'outcome_uncertain']);
const BLOCKED_SUMMARY_KEYS = /credential|secret|password|authorization|cookie|token|args|request|response|body|prompt|data|error.?detail/i;

function safeSummary(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key, value]) =>
    !BLOCKED_SUMMARY_KEYS.test(key) && ['string', 'number', 'boolean'].includes(typeof value)));
}

function requireIdentifier(value, field) {
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 256 || !value.trim() || value.includes('\0'))) {
    throw new TypeError(`${field} must be a string no longer than 256 characters`);
  }
}

export async function startInvocationInTransaction(client, input) {
  const { callId, runId, apiId, toolName, initialVersion, healingMode, startedAt = new Date(), summary = {} } = input ?? {};
  if (typeof callId !== 'string' || !callId.trim()) throw new TypeError('callId is required');
  requireIdentifier(runId, 'runId');
  requireIdentifier(apiId, 'apiId');
  requireIdentifier(toolName, 'toolName');
  if (initialVersion !== undefined && initialVersion !== null && (!Number.isSafeInteger(initialVersion) || initialVersion < 1)) {
    throw new TypeError('initialVersion must be a positive safe integer');
  }
  if (Number.isNaN(new Date(startedAt).getTime())) throw new TypeError('startedAt must be a valid timestamp');
  const workspaceId = await getLocalWorkspaceId(client);
  const safe = safeSummary({ ...summary, ...(healingMode ? { healingMode } : {}) });
  await client.query(
    `INSERT INTO invocations
     (call_id, run_id, workspace_id, api_id, tool_name, started_at, outcome, initial_version, healing_mode, summary)
     VALUES ($1, $2, $3, $4, $5, $6, 'running', $7, $8, $9::jsonb)`,
    [callId, runId ?? null, workspaceId, apiId ?? null, toolName ?? null, startedAt,
      initialVersion ?? null, healingMode ?? null, JSON.stringify(safe)],
  );
  return { callId, workspaceId, startedAt };
}

/** Finish exactly once; event and audit writes belong in this same transaction. */
export async function finishInvocationInTransaction(client, input) {
  const {
    callId, outcome, finishedAt = new Date(), finalVersion, httpStatus, errorCode,
<<<<<<< HEAD
    haltReason, tier, rounds, durationMs, cacheHit, inputTokens, outputTokens, tokenUsage, summary = {},
=======
    haltReason, tier, rounds, durationMs, cacheHit, inputTokens, outputTokens, summary = {},
>>>>>>> origin/main
  } = input ?? {};
  if (typeof callId !== 'string' || !callId.trim()) throw new TypeError('callId is required');
  if (!TERMINAL_OUTCOMES.has(outcome)) throw new TypeError('invalid terminal invocation outcome');
  if (Number.isNaN(new Date(finishedAt).getTime())) throw new TypeError('finishedAt must be a valid timestamp');
  if (durationMs !== undefined && durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs < 0)) throw new TypeError('durationMs must be a non-negative safe integer');
  const workspaceId = await getLocalWorkspaceId(client);
  const safe = safeSummary(summary);
  const { rows } = await client.query(
    `UPDATE invocations SET
       finished_at = $3, outcome = $4, final_version = $5, http_status = $6, error_code = $7,
       halt_reason = $8, tier = $9, rounds = COALESCE($10, rounds), duration_ms = $11,
       cache_hit = COALESCE($12, cache_hit), input_tokens = COALESCE($13, input_tokens),
<<<<<<< HEAD
       output_tokens = COALESCE($14, output_tokens), summary = summary || $15::jsonb,
       token_usage = COALESCE($16::jsonb, token_usage)
=======
       output_tokens = COALESCE($14, output_tokens), summary = summary || $15::jsonb
>>>>>>> origin/main
     WHERE workspace_id = $1 AND call_id = $2 AND outcome = 'running'
     RETURNING call_id, outcome, finished_at`,
    [workspaceId, callId, finishedAt, outcome, finalVersion ?? null, httpStatus ?? null,
      errorCode ?? null, haltReason ?? null, tier ?? null, rounds ?? null, durationMs ?? null,
<<<<<<< HEAD
      cacheHit ?? null, inputTokens ?? null, outputTokens ?? null, JSON.stringify(safe), tokenUsage ? JSON.stringify(tokenUsage) : null],
=======
      cacheHit ?? null, inputTokens ?? null, outputTokens ?? null, JSON.stringify(safe)],
>>>>>>> origin/main
  );
  if (rows[0]) return { ...rows[0], alreadyFinished: false };
  const { rows: existing } = await client.query(
    'SELECT call_id, outcome, finished_at FROM invocations WHERE workspace_id = $1 AND call_id = $2 FOR UPDATE',
    [workspaceId, callId],
  );
  if (existing[0] && existing[0].outcome === outcome) return { ...existing[0], alreadyFinished: true };
  const error = new Error(existing[0] ? 'Invocation already has a different terminal outcome' : 'Invocation does not exist');
  error.code = existing[0] ? 'invocation_already_finished' : 'invocation_not_found';
  throw error;
}

export async function getInvocation(queryable, callId) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT call_id, run_id, api_id, tool_name, started_at, finished_at, outcome,
       initial_version, final_version, http_status, error_code, halt_reason,
<<<<<<< HEAD
       healing_mode, tier, rounds, duration_ms, cache_hit, input_tokens, output_tokens, token_usage, summary
=======
       healing_mode, tier, rounds, duration_ms, cache_hit, input_tokens, output_tokens, summary
>>>>>>> origin/main
     FROM invocations WHERE workspace_id = $1 AND call_id = $2`,
    [workspaceId, callId],
  );
  return rows[0] ?? null;
}
