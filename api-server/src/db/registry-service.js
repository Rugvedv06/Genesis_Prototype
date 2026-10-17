import { getPool } from './pool.js';
import { withTransaction } from './transaction.js';
import {
  commitAdapterInTransaction, getApiRevisions, loadRegistryFromDatabase, StaleAdapterError,
  registerApiInTransaction, rollbackAdapterInTransaction, softDeleteApiInTransaction,
  updateApiConfigInTransaction,
} from './registry-repository.js';
import { appendAuditInTransaction } from './audit-repository.js';
import { appendGatewayEventInTransaction } from './event-repository.js';
import { registryStore } from '../features/registry/store.js';
import { clearNegativeForApiAsync } from '../features/safety/circuit.js';
import { putVerifiedCandidateInTransaction, findVerifiedCandidateInTransaction, invalidatePatchCandidatesInTransaction, invalidateAllPatchCandidatesInTransaction, getPatchCandidate, transitionPatchCandidateInTransaction } from './patch-candidate-repository.js';
import { readCandidateMirror, writeCandidateMirror, deleteCandidateMirror } from '../features/patch-cache/redis-mirror.js';

let registryMutationQueue = Promise.resolve();

export async function refreshRegistryCache() {
  const registry = await loadRegistryFromDatabase(getPool());
  registryStore.replaceFromDatabase(registry);
  return registry;
}

async function persistChangeNow(work, publish) {
  const result = await withTransaction(async (client) => {
    const value = await work(client);
    const auditInput = publish.audit?.(value);
    const eventInput = publish.event?.(value);
    const auditRecord = auditInput ? await appendAuditInTransaction(client, auditInput) : null;
    const event = eventInput ? await appendGatewayEventInTransaction(client, eventInput) : null;
    const registry = await loadRegistryFromDatabase(client);
    return { value, auditRecord, event, registry };
  });
  registryStore.replaceFromDatabase(result.registry);
  return result;
}

function persistChange(work, publish) {
  const operation = registryMutationQueue.then(() => persistChangeNow(work, publish));
  registryMutationQueue = operation.catch(() => {});
  return operation;
}

export async function registerApi(payload) {
  return persistChange(
    (client) => registerApiInTransaction(client, payload),
    {
      audit: ({ apiId, epoch, tools }) => ({ decision: 'register', apiId, epoch, toolCount: tools.length }),
      event: ({ apiId, epoch, tools }) => ({ type: 'api.registered', apiId, epoch, toolCount: tools.length }),
    },
  );
}

export async function updateApiConfig(apiId, patch) {
  return persistChange(
    async (client) => {
      const before = await getApiRevisions(client, apiId);
      const config = await updateApiConfigInTransaction(client, apiId, patch);
      if (!config) return null;
      const after = await getApiRevisions(client, apiId);
      return { apiId, config, changed: before?.config_revision !== after?.config_revision };
    },
    {
      audit: (value) => value?.changed && ({ decision: 'config_changed', apiId, changedKeys: Object.keys(patch ?? {}).sort() }),
      event: (value) => value?.changed && ({ type: 'config.changed', apiId, config: publicConfig(value.config) }),
    },
  );
}

export async function removeApi(apiId) {
  const result = await persistChange(
    async (client) => ({ apiId, removed: await softDeleteApiInTransaction(client, apiId) }),
    {
      audit: ({ removed }) => removed ? ({ decision: 'api_removed', apiId }) : null,
      event: ({ removed }) => removed ? ({ type: 'api.removed', apiId }) : null,
    },
  );
  if (result.value?.removed) await clearNegativeForApiAsync(apiId);
  return result;
}

export async function commitAdapter({ apiId, toolName, adapter, change, origin = 'heal', expectedVersion, expectedEpoch, expectedConfigRevision, expectedCredentialRevision }) {
  return persistChange(
    async (client) => {
      const committed = await commitAdapterInTransaction(client, {
        apiId, toolName, adapter, change, origin, expectedVersion, expectedEpoch, expectedConfigRevision, expectedCredentialRevision,
      });
      return committed;
    },
    {
      audit: (committed) => ({
        decision: 'commit',
        apiId,
        tool: toolName,
        versionBefore: committed.parent,
        versionAfter: committed.version,
        adapterHash: committed.adapterHash,
        origin,
        ops: committed.change?.ops ?? change?.ops,
        evidence: committed.change?.evidence ?? change?.evidence,
        explanation: committed.change?.explanation ?? change?.explanation,
      }),
      event: (committed) => ({ type: 'patch.committed', apiId, tool: toolName, callId: change?.callId, runId: change?.runId, version: committed.version, ops: change?.ops, origin }),
    },
  );
}

export async function rollbackAdapter({ apiId, toolName, toVersion, origin = 'manual_rollback', expectedVersion, expectedEpoch, expectedConfigRevision, callId, runId }) {
  return persistChange(
    async (client) => rollbackAdapterInTransaction(client, {
      apiId, toolName, toVersion, origin, expectedVersion, expectedEpoch, expectedConfigRevision,
    }),
    {
      audit: (committed) => ({ decision: 'rollback', apiId, tool: toolName, versionBefore: committed.parent, versionAfter: committed.version, adapterHash: committed.adapterHash, rollbackOf: committed.rollbackOf }),
      event: (committed) => ({ type: 'registry.rollback', apiId, tool: toolName, callId, runId, version: committed.version, rollbackOf: committed.rollbackOf }),
    },
  );
}

export async function commitFromCache({ apiId, toolName, adapter, change, origin = 'heal', current }) {
  const revisions = await getApiRevisions(getPool(), apiId);
  if (!revisions || !current) throw new StaleAdapterError();
  return commitAdapter({
    apiId, toolName, adapter, change, origin,
    expectedVersion: current.version,
    expectedEpoch: current.epoch,
    expectedConfigRevision: current.configRevision ?? revisions.config_revision,
    expectedCredentialRevision: current.credentialRevision ?? revisions.credential_revision,
  });
}

function mirrorShape(candidate) {
  return {
    cacheKey: candidate.cache_key,
    scope: candidate.scope,
    sourceApiId: candidate.source_api_id,
    sourceToolName: candidate.source_tool_name,
    sourceVersion: candidate.source_version,
    adapterFingerprint: candidate.adapter_fingerprint,
    schemaFingerprint: candidate.schema_fingerprint,
    operationSignature: candidate.operation_signature,
    operations: candidate.operations,
    evidenceClass: candidate.evidence_class,
    evidenceSummary: candidate.evidence_summary,
    provenanceRequirements: candidate.provenance_requirements,
    state: candidate.state,
  };
}

export async function saveVerifiedPatchCandidate(candidate) {
  const row = await withTransaction((client) => putVerifiedCandidateInTransaction(client, candidate));
  if (row) await writeCandidateMirror(mirrorShape(row));
  return row;
}

export async function findVerifiedPatchCandidate(input) {
  const mirror = await readCandidateMirror(input.cacheKey);
  const row = await withTransaction((client) => findVerifiedCandidateInTransaction(client, input));
  if (!row) {
    if (mirror) await deleteCandidateMirror(input.cacheKey);
    return null;
  }
  const durable = mirrorShape(row);
  // Redis is a hint only. A mismatched, stale, or old envelope is replaced
  // from the row that was just revalidated in PostgreSQL.
  if (!mirror || mirror.operationSignature !== durable.operationSignature
    || mirror.adapterFingerprint !== durable.adapterFingerprint
    || mirror.schemaFingerprint !== durable.schemaFingerprint
    || mirror.sourceVersion !== durable.sourceVersion) await writeCandidateMirror(durable);
  return row;
}

export async function invalidateVerifiedPatchCandidate(cacheKey) {
  const changed = await withTransaction((client) => invalidatePatchCandidatesInTransaction(client, { cacheKey }));
  if (changed) await deleteCandidateMirror(cacheKey);
  return changed;
}

export async function invalidateAllVerifiedPatchCandidates() {
  const keys = await withTransaction(invalidateAllPatchCandidatesInTransaction);
  await Promise.all(keys.map((cacheKey) => deleteCandidateMirror(cacheKey)));
  return keys.length;
}

export async function updatePatchCandidateRollout(id, state, reason, metrics) {
  return withTransaction(async (client) => {
    const candidate = await transitionPatchCandidateInTransaction(client, { id, state, reason, metrics });
    if (candidate) {
      await appendAuditInTransaction(client, {
        decision: 'patch_rollout',
        candidateId: candidate.id,
        cacheKey: candidate.cache_key,
        apiId: candidate.source_api_id,
        tool: candidate.source_tool_name,
        sourceVersion: candidate.source_version,
        rolloutState: candidate.rollout_state,
        reason: reason ?? null,
        metrics: metrics ?? {},
      });
    }
    return candidate;
  });
}

export async function promotePatchCandidate(id) {
  const candidate = await getPatchCandidate(getPool(), id);
  if (!candidate) return null;
  if (!['candidate', 'regression_verified', 'shadow', 'canary'].includes(candidate.rollout_state)) {
    const error = new Error('candidate is not eligible for promotion');
    error.code = 'candidate_not_promotable';
    throw error;
  }
  if (!candidate.adapter) {
    const error = new Error('candidate has no staged adapter');
    error.code = 'candidate_adapter_missing';
    throw error;
  }
  const current = registryStore.current(candidate.source_api_id, candidate.source_tool_name);
  if (!current || current.version !== candidate.source_version) {
    const error = new Error('candidate source version is no longer live');
    error.code = 'stale_candidate_source';
    throw error;
  }
  const committed = (await commitFromCache({
    apiId: candidate.source_api_id,
    toolName: candidate.source_tool_name,
    adapter: candidate.adapter,
    change: { ops: candidate.operations, candidateId: candidate.id, rollout: true },
    origin: 'candidate_promotion',
    current,
  })).value;
  const rollout = await updatePatchCandidateRollout(id, 'promoted', 'operator_promoted', { promotedVersion: committed.version });
  return { committed, rollout };
}

export async function rollbackFromCache({ apiId, toolName, toVersion, origin = 'manual_rollback', current, callId, runId }) {
  const revisions = await getApiRevisions(getPool(), apiId);
  if (!revisions || !current) throw new Error('API or tool is no longer registered');
  return rollbackAdapter({
    apiId, toolName, toVersion, origin,
    expectedVersion: current.version,
    expectedEpoch: current.epoch,
    expectedConfigRevision: current.configRevision ?? revisions.config_revision,
    callId, runId,
  });
}

function publicConfig(config) {
  const { credentials: _credentials, ...safe } = config ?? {};
  return safe;
}
