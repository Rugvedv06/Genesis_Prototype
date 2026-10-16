import { getLocalWorkspaceId } from './workspace.js';

const FINGERPRINT = /^[a-f0-9]{64}$/i;
const SCOPES = new Set(['exact', 'convention']);

function requireFingerprint(value, label) {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) throw new TypeError(`${label} must be a SHA-256 fingerprint`);
  return value.toLowerCase();
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('candidate is required');
  if (!SCOPES.has(candidate.scope)) throw new TypeError('candidate scope is invalid');
  if (!Array.isArray(candidate.operations) || candidate.operations.length === 0) throw new TypeError('candidate operations must be non-empty');
  if (typeof candidate.cacheKey !== 'string' || !FINGERPRINT.test(candidate.cacheKey)) throw new TypeError('cacheKey must be a SHA-256 fingerprint');
  if (!Number.isSafeInteger(candidate.sourceVersion) || candidate.sourceVersion < 1) throw new TypeError('sourceVersion must be a positive integer');
  if (typeof candidate.sourceApiId !== 'string' || !candidate.sourceApiId.trim()) throw new TypeError('sourceApiId is required');
  if (typeof candidate.sourceToolName !== 'string' || !candidate.sourceToolName.trim()) throw new TypeError('sourceToolName is required');
  if (typeof candidate.operationSignature !== 'string' || !candidate.operationSignature) throw new TypeError('operationSignature is required');
  if (!FINGERPRINT.test(candidate.operationSignature)) throw new TypeError('operationSignature must be a SHA-256 fingerprint');
  if (typeof candidate.evidenceClass !== 'string' || !candidate.evidenceClass) throw new TypeError('evidenceClass is required');
  if (!Array.isArray(candidate.provenanceRequirements)) throw new TypeError('provenanceRequirements must be an array');
  if (!candidate.evidenceSummary || typeof candidate.evidenceSummary !== 'object' || Array.isArray(candidate.evidenceSummary)
    || !Number.isInteger(candidate.evidenceSummary.tier) || !Number.isFinite(candidate.evidenceSummary.confidence)
    || candidate.evidenceSummary.confidence < 0 || candidate.evidenceSummary.confidence > 1
    || typeof candidate.evidenceSummary.kind !== 'string' || !/^[a-z0-9_-]{1,48}$/i.test(candidate.evidenceSummary.kind)
    || candidate.evidenceSummary.replayVerified !== true) throw new TypeError('candidate evidence summary is invalid');
  if (candidate.provenanceRequirements.length > 8 || candidate.provenanceRequirements.some((requirement) =>
    !requirement || typeof requirement !== 'object' || Array.isArray(requirement)
    || !Number.isSafeInteger(requirement.apiEpoch) || requirement.apiEpoch < 1
    || !Number.isSafeInteger(requirement.configRevision) || requirement.configRevision < 1
    || !['GET', 'HEAD'].includes(requirement.method))) throw new TypeError('candidate provenance requirements are invalid');
  if (candidate.operations.some((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return true;
    const keys = Object.keys(operation);
    if (keys.some((key) => !['op', 'path', 'from', 'to', 'name', 'type', 'source'].includes(key))) return true;
    for (const key of ['op', 'path', 'from', 'to', 'name', 'type']) {
      if (operation[key] !== undefined && (typeof operation[key] !== 'string' || operation[key].length > 256
        || !/^[A-Za-z0-9_$.[\]{}\/-]+$/.test(operation[key]) || /\d{4,}/.test(operation[key])
        || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(operation[key]))) return true;
    }
    if (operation.source !== undefined && (!operation.source || typeof operation.source !== 'object' || Array.isArray(operation.source)
      || Object.keys(operation.source).some((key) => !['type', 'ref'].includes(key))
      || operation.source.type !== 'credential' || typeof operation.source.ref !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(operation.source.ref)
      || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(operation.source.ref))) return true;
    return false;
  })) throw new TypeError('candidate operations contain values that are not safe to persist');
  return {
    ...candidate,
    cacheKey: candidate.cacheKey.toLowerCase(),
    adapterFingerprint: requireFingerprint(candidate.adapterFingerprint, 'adapterFingerprint'),
    schemaFingerprint: requireFingerprint(candidate.schemaFingerprint, 'schemaFingerprint'),
  };
}

export async function putVerifiedCandidateInTransaction(client, input) {
  const candidate = validateCandidate(input);
  const workspaceId = await getLocalWorkspaceId(client);
  const { rows } = await client.query(
    `INSERT INTO patch_candidates
      (workspace_id, cache_key, scope, source_api_id, source_tool_name, source_version,
       adapter_fingerprint, schema_fingerprint, operation_signature, operations,
       evidence_class, evidence_summary, provenance_requirements, state, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,'verified',now())
     ON CONFLICT (workspace_id, cache_key) DO UPDATE SET
       scope = EXCLUDED.scope, source_api_id = EXCLUDED.source_api_id,
       source_tool_name = EXCLUDED.source_tool_name, source_version = EXCLUDED.source_version,
       adapter_fingerprint = EXCLUDED.adapter_fingerprint, schema_fingerprint = EXCLUDED.schema_fingerprint,
       operation_signature = EXCLUDED.operation_signature, operations = EXCLUDED.operations,
       evidence_class = EXCLUDED.evidence_class, evidence_summary = EXCLUDED.evidence_summary,
       provenance_requirements = EXCLUDED.provenance_requirements, state = 'verified',
       verified_at = now(), invalidated_at = NULL, updated_at = now()
     RETURNING id, cache_key, scope, source_api_id, source_tool_name, source_version,
       adapter_fingerprint, schema_fingerprint, operation_signature, operations,
       evidence_class, evidence_summary, provenance_requirements, state, verified_at`,
    [workspaceId, candidate.cacheKey, candidate.scope, candidate.sourceApiId, candidate.sourceToolName,
      candidate.sourceVersion, candidate.adapterFingerprint, candidate.schemaFingerprint,
      candidate.operationSignature, JSON.stringify(candidate.operations), candidate.evidenceClass,
      JSON.stringify(candidate.evidenceSummary ?? {}), JSON.stringify(candidate.provenanceRequirements)],
  );
  return rows[0] ?? null;
}

/** PostgreSQL is authoritative; this query never trusts a Redis payload. */
export async function findVerifiedCandidateInTransaction(client, input) {
  const cacheKey = requireFingerprint(input?.cacheKey, 'cacheKey');
  const adapterFingerprint = requireFingerprint(input?.adapterFingerprint, 'adapterFingerprint');
  const schemaFingerprint = requireFingerprint(input?.schemaFingerprint, 'schemaFingerprint');
  const workspaceId = await getLocalWorkspaceId(client);
  const { rows } = await client.query(
    `UPDATE patch_candidates SET use_count = use_count + 1, last_used_at = now(), updated_at = now()
     WHERE workspace_id = $1 AND cache_key = $2 AND state = 'verified'
       AND adapter_fingerprint = $3 AND schema_fingerprint = $4
     RETURNING id, cache_key, scope, source_api_id, source_tool_name, source_version,
       adapter_fingerprint, schema_fingerprint, operation_signature, operations,
       evidence_class, evidence_summary, provenance_requirements, state, verified_at`,
    [workspaceId, cacheKey, adapterFingerprint, schemaFingerprint],
  );
  return rows[0] ?? null;
}

export async function listPatchCandidates(queryable, { limit = 100, cursor = null } = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 100;
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT id, cache_key, scope, source_api_id, source_tool_name, source_version,
       adapter_fingerprint, schema_fingerprint, operation_signature, operations,
       evidence_class, evidence_summary, provenance_requirements, state, verified_at,
       invalidated_at, use_count, last_used_at, created_at
     FROM patch_candidates WHERE workspace_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid)
     ORDER BY id LIMIT $3`,
    [workspaceId, cursor, safeLimit],
  );
  return rows;
}

export async function invalidatePatchCandidatesInTransaction(client, { cacheKey } = {}) {
  const workspaceId = await getLocalWorkspaceId(client);
  const params = [workspaceId];
  let filter = '';
  if (cacheKey !== undefined) {
    params.push(requireFingerprint(cacheKey, 'cacheKey'));
    filter = ` AND cache_key = $${params.length}`;
  }
  const { rowCount } = await client.query(
    `UPDATE patch_candidates SET state = 'invalidated', invalidated_at = now(), updated_at = now()
     WHERE workspace_id = $1 AND state = 'verified'${filter}`,
    params,
  );
  return rowCount;
}
