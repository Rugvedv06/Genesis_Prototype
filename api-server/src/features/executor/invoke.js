// Phase 1 Track A: invoke() + heal loop (§5.1-5.3, §6 Phase 1).
// Full heal vertical: validate -> send -> classify -> diagnose -> patch -> replay -> commit.
// Fixes: G10 heal lock, G11 credential, G12/G13 error mapping, G14 runId, G15 version, G17 budgets, G18 redaction.
import { registryStore } from '../registry/store.js';
import { parseErrors, classify } from '../classifier/index.js';
import { run as diagnose } from '../diagnoser/index.js';
import { apply as applyPatch } from '../patch-engine/apply.js';
import { compileAdapter, ProvenanceError, NotLossless } from '../registry/compile.js';
import { emit } from '../events/bus.js';
import { newId } from '../../lib/ids.js';
import { getPath } from '../../lib/paths.js';
import { iso } from '../../lib/time.js';
import { sha256, stableStringify } from '../../lib/hash.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { cfg } from '../../config.js';
import { check as safetyCheck, circuit } from '../safety/index.js';
import { append as appendFileAudit } from '../audit/index.js';
import { withTransaction } from '../../db/transaction.js';
import { getPool } from '../../db/pool.js';
import { appendAuditInTransaction } from '../../db/audit-repository.js';
import { appendGatewayEventInTransaction } from '../../db/event-repository.js';
import { startInvocationInTransaction, finishInvocationInTransaction } from '../../db/invocation-repository.js';
import { commitFromCache, rollbackFromCache } from '../../db/registry-service.js';
import { findVerifiedPatchCandidate, invalidateVerifiedPatchCandidate, saveVerifiedPatchCandidate } from '../../db/registry-service.js';
import { flushDurableEvents } from '../events/bus.js';
import { negativeHit, negativeResult, cacheNegative, recordHalt, negativeHitAsync, negativeResultAsync, cacheNegativeAsync, recordHaltAsync } from '../safety/circuit.js';
import { validateUpstreamUrl } from '../http/url-policy.js';
import { checkResponse } from '../drift-detector/index.js';
import { log } from '../../lib/log.js';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validatorCache = new Map(); // schema-fingerprinted key -> compiled ajv validator
const MAX_CACHED_VALIDATORS = 256;
const reportedDomainHalts = new WeakSet();

async function appendAudit(input) {
  if (!process.env.DATABASE_URL) return appendFileAudit(input);
  return withTransaction((client) => appendAuditInTransaction(client, input));
}

function cachedValidator(key, schema) {
  let validator = validatorCache.get(key);
  if (validator) {
    validatorCache.delete(key);
    validatorCache.set(key, validator);
    return validator;
  }
  validator = ajv.compile(schema);
  validatorCache.set(key, validator);
  if (validatorCache.size > MAX_CACHED_VALIDATORS) {
    validatorCache.delete(validatorCache.keys().next().value);
  }
  return validator;
}

class MissingCredential extends Error {
  constructor(ref) {
    super(`credential_unavailable: ${ref}`);
    this.ref = ref;
    this.code = 'credential_unavailable';
  }
}

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'config_error';
  }
}

function validatorKey(apiId, tool, version, schema) {
  return `${apiId}:${tool}:v${version}:args:${sha256(stableStringify(schema))}`;
}
function responseValidatorKey(apiId, tool, version, schema) {
  return `${apiId}:${tool}:v${version}:response:${sha256(stableStringify(schema))}`;
}
function getValidator(apiId, tool, version, jsonSchema) {
  const key = validatorKey(apiId, tool, version, jsonSchema);
  return cachedValidator(key, jsonSchema);
}

function validateArgs(tool, args) {
  const logical = tool.versionObj?.meta?.logicalSchema ?? tool.versionObj?.adapter?._logicalSchema;
  if (!logical) return { ok: true };
  const validate = getValidator(tool.apiId, tool.name, tool.version, logical);
  const ok = validate(args);
  return ok ? { ok: true } : { ok: false, errors: validate.errors ?? [] };
}

function validateResponse(tool, response) {
  const schema = tool.versionObj?.meta?.responseSchema;
  if (!schema) {
    const fields = tool.versionObj?.adapter?.response?.map ?? {};
    const json = response.json ?? {};
    const missing = Object.entries(fields)
      .filter(([, path]) => getPath(json, path) === undefined)
      .map(([logical, path]) => ({ keyword: 'required', instancePath: `/${logical}`, params: { path } }));
    return { ok: missing.length === 0, errors: missing };
  }
  const extracted = tool.compiled.extract(response.json ?? {});
  const key = responseValidatorKey(tool.apiId, tool.name, tool.version, schema);
  const validate = cachedValidator(key, schema);
  const ok = validate(extracted);
  return { ok, errors: ok ? [] : (validate.errors ?? []) };
}

function credentialResolver(apiId) {
  const config = registryStore.config(apiId) ?? {};
  const credentials = config.credentials ?? {};
  return (ref) => {
    const credentialKey = Object.keys(credentials).find((key) => key.toLowerCase() === String(ref).toLowerCase());
    const cred = credentialKey ? credentials[credentialKey] : undefined;
    if (cred && cred.env) {
      const v = process.env[cred.env];
      if (v === undefined || v === null || v === '') throw new MissingCredential(ref);
      return String(v);
    }
    const v = process.env[ref];
    if (v === undefined || v === null || v === '') throw new MissingCredential(ref);
    return String(v);
  };
}

async function send(tool, args, resolveCredential) {
  const config = registryStore.config(tool.apiId) ?? {};
  const baseUrl = config.baseUrl;
  if (!baseUrl) throw new ConfigError(`no baseUrl configured for API ${tool.apiId}`);

  const { body, headers } = tool.compiled.buildRequest(args, resolveCredential);
  const adapter = tool.versionObj?.adapter ?? {};
  const meta = tool.versionObj?.meta ?? {};
  const reqPath = meta.path ?? adapter._path;
  const method = meta.method ?? adapter._method ?? 'POST';
  const pathValues = { ...args };
  const resolvedPath = String(reqPath).replace(/\{([^}]+)\}/g, (_, key) => {
    if (pathValues[key] === undefined) throw new ConfigError(`missing path argument ${key}`);
    delete pathValues[key];
    return encodeURIComponent(String(args[key]));
  });
  const upstream = validateUpstreamUrl(baseUrl, { allowLocal: cfg.allowLocalUpstreams });
  const url = new URL(resolvedPath, upstream);
  if (method.toUpperCase() === 'GET') {
    for (const [key, value] of Object.entries(pathValues)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    let json;
    try { json = await resp.json(); } catch { json = null; }
    return { ok: resp.ok, status: resp.status, json, text: resp.status === 204 ? '' : JSON.stringify(json ?? null) };
  } catch (err) {
    clearTimeout(timeout);
    // Re-throw domain errors (provenance, credential, config) so the caller can map them.
    if (err instanceof ProvenanceError || err instanceof NotLossless || err instanceof MissingCredential || err instanceof ConfigError) throw err;
    return { ok: false, status: 0, json: null, text: err.message, error: err };
  }
}

function matchesLogicalResponse(tool, response) {
  return response.ok && validateResponse(tool, response).ok;
}

function matchesIdentity(tool, args, response) {
  const identity = tool.versionObj?.meta?.identity ?? {};
  const extracted = tool.compiled.extract(response.json ?? {});
  return Object.entries(identity).every(([arg, field]) => String(extracted[field]) === String(args?.[arg]));
}

function errorSignature(toolName, res) {
  const normalized = JSON.stringify(res.json ?? res.text)
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '<uuid>')
    .replace(/\d+/g, '<n>');
  return `${toolName}|${res.status}|${sha256(normalized).slice(0, 12)}`;
}

function failure(code, message, retryable, details) {
  return { ok: false, error: { code, message, retryable: !!retryable, details: details ?? {} }, healed: false };
}

function success(tool, response, meta) {
  return {
    ok: true,
    data: tool.compiled.extract(response.json ?? {}),
    meta: {
      version: tool.version,
      healed: meta.healed ?? false,
      rounds: meta.rounds ?? 0,
      tier: meta.tier ?? 0,
      cacheHit: meta.cacheHit ?? false,
      latencyMs: meta.latencyMs ?? 0,
      healMs: meta.healMs ?? 0,
      tokens: meta.tokens ?? { input: 0, output: 0 },
      ...meta,
    },
  };
}

function halt(reason, details) {
  return failure('tool_unavailable', `Contract changed and no safe fix found: ${reason}`, false, { reason, ...details });
}

// Map thrown domain errors to structured halts.
function mapDomainError(err, tool, args, first) {
  if (err instanceof MissingCredential) {
    return halt('credential_unavailable', { ref: err.ref, field: err.ref });
  }
  if (err instanceof NotLossless) {
    return halt('not_lossless', { field: err.message, value: err.value, from: err.from, to: err.to });
  }
  if (err instanceof ProvenanceError) {
    return halt('provenance_violation', { field: err.path });
  }
  if (err instanceof ConfigError) {
    return halt('config_error', { message: err.message });
  }
  return failure('upstream_error', err.message ?? 'internal', false);
}

async function reportDomainHalt({ tool, result, callId, runId, t0 }) {
  if (result?.error?.code !== 'tool_unavailable') return result;
  const reason = result.error.details?.reason ?? 'domain_error';
  const fields = { callId, runId, apiId: tool.apiId, tool: tool.name };
  emit({ type: 'call.failed', ...fields, code: 'tool_unavailable', reason });
  emit({ type: 'halt', ...fields, reason, retryable: false });
  await appendAudit({ decision: 'halt', apiId: tool.apiId, tool: tool.name, versionBefore: tool.version, reason, callId });
  const openedUntil = process.env.DATABASE_URL ? await recordHaltAsync(tool.apiId, tool.name) : recordHalt(tool.apiId, tool.name);
  if (openedUntil) emit({ type: 'circuit.opened', apiId: tool.apiId, tool: tool.name, key: `${tool.apiId}:${tool.name}`, until: openedUntil });
  emit({ type: 'heal.finished', ...fields, healId: callId, outcome: 'halted', rounds: 0, ms: Date.now() - t0, tier: 0, tokens: { input: 0, output: 0 } });
  reportedDomainHalts.add(result);
  return result;
}

async function finishHealHalt({ tool, callId, runId, reason, details, t0, rounds = 0, tier = 0 }) {
  const fields = { callId, runId, apiId: tool.apiId, tool: tool.name };
  emit({ type: 'halt', ...fields, reason, details, retryable: false });
  emit({ type: 'heal.finished', ...fields, healId: callId, outcome: 'halted', rounds, ms: Date.now() - t0, tier, tokens: { input: 0, output: 0 } });
  return halt(reason, details);
}

// Heal lock (§5.2): only one leader heals per apiId:tool; followers await then
// re-send their own args on the new version (no recursive heal, no data leak).
const healLocks = new Map(); // key -> Promise<{ version: number }>
async function withHealLock(apiId, toolName, healFn, args, context) {
  const key = `${apiId}:${toolName}`;
  const leader = healLocks.get(key);
  if (leader) {
    await leader;
    // Follower: re-send own args on the new version if it advanced.
    const current = registryStore.current(apiId, toolName);
    if (!current) {
      const tool = { apiId, name: toolName, version: 0 };
      return {
        follower: true,
        result: await reportDomainHalt({
          tool,
          result: halt('not_registered', { apiId, tool: toolName }),
          ...context,
        }),
      };
    }
    const resolvedCredential = credentialResolver(apiId);
    const tool = { ...current, apiId, name: toolName };
    try {
      const r = await send(tool, args, resolvedCredential);
      if (r.ok && matchesLogicalResponse(tool, r)) {
        // The call only succeeded because the leader's heal landed — report it
        // as healed with the committed change so callers see consistent meta.
        const change = current.versionObj?.change ?? {};
        const healedViaCommit = current.versionObj?.origin === 'heal';
        return {
          follower: true,
          result: success(tool, r, {
            healed: healedViaCommit,
            rounds: change.rounds ?? 0,
            tier: change.tier ?? 1,
            latencyMs: 0,
            cacheHit: false,
            tokens: { input: 0, output: 0 },
            ops: change.ops ?? [],
            version: current.version,
          }),
        };
      }
      const result = await reportDomainHalt({
        tool,
        result: halt('follower_replay_failed', { status: r.status }),
        ...context,
      });
      return { follower: true, result };
    } catch (err) {
      const result = await reportDomainHalt({ tool, result: mapDomainError(err, tool, args, null), ...context });
      return { follower: true, result };
    }
  }
  let release;
  const p = new Promise((r) => (release = r));
  healLocks.set(key, p);
  try {
    const result = await healFn();
    return { follower: false, result };
  } finally {
    healLocks.delete(key);
    release();
  }
}

function candidateIdentity(tool, signature) {
  const adapterFingerprint = sha256(stableStringify(tool.versionObj.adapter));
  const logicalSchema = tool.versionObj.meta?.logicalSchema ?? {};
  const schemaFingerprint = sha256(stableStringify(logicalSchema));
  const cacheKey = sha256(stableStringify({
    scope: 'exact', apiId: tool.apiId, tool: tool.name, apiEpoch: tool.epoch, configRevision: tool.configRevision,
    adapterFingerprint, schemaFingerprint, signature,
  }));
  return { cacheKey, adapterFingerprint, schemaFingerprint };
}

async function replayVerifiedCandidate({ tool, args, signature, resolveCredential, apiConfig, callId, runId, t0 }) {
  const method = String(tool.versionObj.meta?.method ?? 'POST').toUpperCase();
  // Replays can cause duplicate side effects. Candidate reuse is restricted to
  // methods that are safe to retry after the original request failed.
  const sideEffects = tool.versionObj.meta?.sideEffects ?? tool.versionObj.adapter?.sideEffects ?? 'write';
  if (!['GET', 'HEAD'].includes(method) || !['read', 'none'].includes(sideEffects)) return null;
  const identity = candidateIdentity(tool, signature);
  const candidate = await findVerifiedPatchCandidate({
    ...identity,
  });
  if (!candidate) return null;
  const tier = Number(candidate.evidence_summary?.tier);
  const confidence = Number(candidate.evidence_summary?.confidence);
  const ops = candidate.operations;
  const proposal = { tier, confidence, ops, evidence: [] };
  const cacheSafeOps = Array.isArray(ops) && ops.every((operation) => operation && typeof operation === 'object'
    && !Array.isArray(operation)
    && Object.keys(operation).every((key) => ['op', 'path', 'from', 'to', 'name', 'type', 'source'].includes(key))
    && (operation.source === undefined || (operation.source && typeof operation.source === 'object'
      && !Array.isArray(operation.source) && operation.source.type === 'credential'
      && Object.keys(operation.source).every((key) => ['type', 'ref'].includes(key))
      && typeof operation.source.ref === 'string'
      && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(operation.source.ref)
      && !/(secret|token|password|credential|apikey|authorization|cookie)/i.test(operation.source.ref)))
    && ['op', 'path', 'from', 'to', 'name', 'type'].every((key) => operation[key] === undefined
      || (typeof operation[key] === 'string' && operation[key].length <= 256
        && /^[A-Za-z0-9_$.[\]{}\/-]+$/.test(operation[key]) && !/\d{4,}/.test(operation[key])
        && !/(secret|token|password|credential|apikey|authorization|cookie)/i.test(operation[key]))));
  if (!Number.isInteger(tier) || !Number.isFinite(confidence) || !Array.isArray(ops) || ops.length === 0
    || !cacheSafeOps || candidate.scope !== 'exact' || candidate.source_api_id !== tool.apiId
    || candidate.source_tool_name !== tool.name || candidate.evidence_class !== `tier${tier}`
    || candidate.evidence_summary?.replayVerified !== true
    || candidate.operation_signature !== sha256(stableStringify(ops))) {
    await invalidateVerifiedPatchCandidate(identity.cacheKey);
    return null;
  }
  const requirements = candidate.provenance_requirements;
  const sourceRequirement = Array.isArray(requirements) ? requirements.find((item) => item?.method === method) : null;
  if (!sourceRequirement || sourceRequirement.apiEpoch !== tool.epoch
    || sourceRequirement.configRevision !== tool.configRevision) {
    await invalidateVerifiedPatchCandidate(identity.cacheKey);
    return null;
  }
  const gate = safetyCheck({ proposal, tool, mode: apiConfig.healing?.mode ?? 'enforce', apiCfg: apiConfig });
  if (!gate.ok || apiConfig.healing?.mode === 'log') {
    await invalidateVerifiedPatchCandidate(identity.cacheKey);
    return null;
  }
  let adapter;
  let compiled;
  try {
    adapter = applyPatch(tool.versionObj.adapter, ops);
    compiled = compileAdapter(adapter, resolveCredential);
  } catch {
    await invalidateVerifiedPatchCandidate(identity.cacheKey);
    return null;
  }
  const candidateTool = { ...tool, versionObj: { ...tool.versionObj, adapter }, compiled };
  let replay;
  try { replay = await send(candidateTool, args, resolveCredential); }
  catch {
    await invalidateVerifiedPatchCandidate(identity.cacheKey);
    return null;
  }
  if (!replay.ok || !matchesLogicalResponse(candidateTool, replay) || !matchesIdentity(candidateTool, args, replay)) {
    await invalidateVerifiedPatchCandidate(identity.cacheKey);
    return null;
  }
  const change = { ops, tier, confidence, evidence: [], rounds: 1, cacheHit: true, callId, runId };
  const committed = process.env.DATABASE_URL
    ? (await commitFromCache({ apiId: tool.apiId, toolName: tool.name, adapter, change, origin: 'heal', current: tool })).value
    : registryStore.commit(tool.apiId, tool.name, adapter, change);
  emit({ type: 'patch.verified', callId, runId, apiId: tool.apiId, tool: tool.name, status: replay.status, cacheHit: true });
  emit({ type: 'patch.committed', callId, runId, apiId: tool.apiId, tool: tool.name, version: committed.version, ops, cacheHit: true });
  emit({ type: 'heal.finished', callId, runId, healId: callId, apiId: tool.apiId, tool: tool.name, outcome: 'committed', rounds: 1, tier, ms: Date.now() - t0, tokens: { input: 0, output: 0 }, cacheHit: true });
  return success({ ...candidateTool, version: committed.version }, replay, {
    healed: true, rounds: 1, tier, cacheHit: true, latencyMs: Date.now() - t0,
    healMs: Date.now() - t0, tokens: { input: 0, output: 0 }, ops, version: committed.version,
  });
}

// Heal loop (§5.3)
async function healAndRetry({ tool, args, first, kind, callId, runId, t0, resolveCredential, requestKey }) {
  const apiConfig = registryStore.config(tool.apiId) ?? {};
  const healing = apiConfig.healing ?? {};
  const maxRounds = healing.maxRounds ?? cfg.maxHealRounds;
  const healTimeoutMs = healing.timeoutMs ?? cfg.healTimeoutMs;
  const deadline = Date.now() + healTimeoutMs;
  const seen = new Set();
  let draft = { ...tool, compiled: tool.compiled, versionObj: tool.versionObj };
  let failure = first;
  const applied = [];
  let rounds = 0;

  while (rounds < maxRounds && Date.now() < deadline) {
    rounds += 1;
    const sig = errorSignature(tool.name, failure);
    if (seen.has(sig)) return finishHealHalt({ tool, callId, runId, reason: 'loop_detected', details: { sig }, t0, rounds });
    seen.add(sig);

    emit({ type: 'diagnosis.started', callId, runId, apiId: tool.apiId, tool: tool.name, round: rounds, kind });

    if (process.env.DATABASE_URL && rounds === 1 && !applied.length) {
      const cached = await replayVerifiedCandidate({ tool, args, signature: sig, resolveCredential, apiConfig, callId, runId, t0 });
      if (cached) return cached;
    }

    const proposal = await diagnose({ tool: draft, args, failure, kind });
    if (!proposal) {
      if (process.env.DATABASE_URL) await cacheNegativeAsync(requestKey, { reason: 'no_diagnosis', details: { kind } });
      else cacheNegative(requestKey, { reason: 'no_diagnosis', details: { kind } });
      return finishHealHalt({ tool, callId, runId, reason: 'no_diagnosis', details: { kind }, t0, rounds });
    }
    const gate = safetyCheck({ proposal, tool: draft, mode: healing.mode ?? 'enforce', apiCfg: apiConfig });
    if (!gate.ok) {
      return finishHealHalt({ tool, callId, runId, reason: gate.reason, details: gate.details, t0, rounds, tier: proposal.tier });
    }
    if ((healing.mode ?? 'enforce') === 'log') {
      await appendAudit({ decision: 'proposed', apiId: tool.apiId, tool: tool.name, versionBefore: tool.version, tier: proposal.tier, ops: proposal.ops, confidence: proposal.confidence, evidence: proposal.evidence, healId: callId });
      return finishHealHalt({ tool, callId, runId, reason: 'drift_unresolved', details: { proposal }, t0, rounds, tier: proposal.tier });
    }

    const newAdapter = applyPatch(draft.versionObj.adapter, proposal.ops);
    const newCompiled = compileAdapter(newAdapter, resolveCredential);

    const nextDraft = {
      ...draft,
      versionObj: { ...draft.versionObj, adapter: newAdapter },
      compiled: newCompiled,
    };

    emit({ type: 'patch.proposed', callId, runId, apiId: tool.apiId, tool: tool.name, round: rounds, tier: proposal.tier, ops: proposal.ops, confidence: proposal.confidence, evidence: proposal.evidence });

    let r;
    try {
      r = await send(nextDraft, args, resolveCredential);
    } catch (err) {
      return reportDomainHalt({ tool: nextDraft, result: mapDomainError(err, nextDraft, args, first), callId, runId, t0 });
    }

    if (r.ok && matchesLogicalResponse(nextDraft, r) && matchesIdentity(nextDraft, args, r)) {
      const commitOps = applied.concat(proposal.ops);
      const change = {
        ops: commitOps, tier: proposal.tier, confidence: proposal.confidence,
        evidence: proposal.evidence, rounds, latencyMs: Date.now() - t0, callId, runId,
      };
      const committed = process.env.DATABASE_URL
        ? (await commitFromCache({ apiId: tool.apiId, toolName: tool.name, adapter: newAdapter, change, origin: 'heal', current: tool })).value
        : registryStore.commit(tool.apiId, tool.name, newAdapter, change);
      emit({ type: 'patch.committed', callId, runId, apiId: tool.apiId, tool: tool.name, version: committed.version, ops: commitOps });
      emit({ type: 'patch.verified', callId, runId, apiId: tool.apiId, tool: tool.name, round: rounds, status: r.status });
      emit({ type: 'heal.finished', callId, runId, healId: callId, apiId: tool.apiId, tool: tool.name, outcome: 'committed', rounds, tier: proposal.tier, ms: Date.now() - t0, tokens: { input: 0, output: 0 } });
      if (!process.env.DATABASE_URL) await appendAudit({
        decision: 'commit', apiId: tool.apiId, tool: tool.name,
        versionBefore: tool.version, versionAfter: committed.version,
        tier: proposal.tier, ops: commitOps, confidence: proposal.confidence,
        evidence: proposal.evidence, healId: callId, callId,
        latencyMs: Date.now() - t0,
      });
      if (process.env.DATABASE_URL && rounds === 1 && !applied.length
        && ['GET', 'HEAD'].includes(String(tool.versionObj.meta?.method ?? 'POST').toUpperCase())
        && ['read', 'none'].includes(tool.versionObj.meta?.sideEffects ?? tool.versionObj.adapter?.sideEffects ?? 'write')) {
        const method = String(tool.versionObj.meta?.method ?? 'POST').toUpperCase();
        const identity = candidateIdentity(tool, sig);
        try {
          await saveVerifiedPatchCandidate({
            ...identity, scope: 'exact', sourceApiId: tool.apiId, sourceToolName: tool.name,
            sourceVersion: tool.version, operationSignature: sha256(stableStringify(commitOps)),
            operations: commitOps, evidenceClass: `tier${proposal.tier}`,
            evidenceSummary: { tier: proposal.tier, confidence: proposal.confidence, kind, replayVerified: true },
            provenanceRequirements: [{ apiEpoch: tool.epoch, configRevision: tool.configRevision, method }],
          });
        } catch (error) {
          log({ level: 'warn', code: 'patch_candidate_persist_failed', apiId: tool.apiId, tool: tool.name, errorClass: error.name ?? 'Error' });
        }
      }
      return success(nextDraft, r, {
        healed: true, rounds, tier: proposal.tier, cacheHit: false,
        latencyMs: Date.now() - t0, healMs: Date.now() - t0, tokens: { input: 0, output: 0 },
        ops: commitOps, version: committed.version,
      });
    }
    if (r.ok && matchesLogicalResponse(nextDraft, r)) return finishHealHalt({ tool, callId, runId, reason: 'verification_mismatch', t0, rounds, tier: proposal.tier });
    failure = r;
    draft = nextDraft;
    applied.push(...proposal.ops);
  }
  const result = halt('budget_exhausted', { rounds });
  emit({ type: 'halt', callId, runId, apiId: tool.apiId, tool: tool.name, reason: 'budget_exhausted', retryable: false });
  emit({ type: 'heal.finished', callId, runId, healId: callId, apiId: tool.apiId, tool: tool.name, outcome: 'halted', rounds, ms: Date.now() - t0, tokens: { input: 0, output: 0 } });
  return result;
}

async function invokeCore({ apiId, toolName, args, runId, callId = newId('c') }) {
  const t0 = Date.now();
  const emitCall = (type, extra) => emit({ type, callId, runId, apiId, tool: toolName, ...extra });

  // G18: never emit raw args on the public stream.
  emitCall('call.started', { argKeys: Object.keys(args ?? {}), argCount: Object.keys(args ?? {}).length });
  if (process.env.DATABASE_URL) {
    try { await flushDurableEvents(); }
    catch (error) { error.beforeUpstream = true; throw error; }
  }

  const current = registryStore.current(apiId, toolName);
  if (!current) {
    emitCall('call.failed', { reason: 'not_registered' });
    return failure('tool_unavailable', `API/tool not registered: ${apiId}/${toolName}`, false);
  }

  const tool = { ...current, apiId, name: toolName };
  const apiConfig = registryStore.config(apiId) ?? {};
  const credentials = apiConfig.credentials ?? {};
  const credentialRefs = (tool.versionObj.adapter.request ?? [])
    .filter((op) => op.source?.type === 'credential')
    .map((op) => op.source.ref);
  const credentialState = credentialRefs.map((ref) => {
    const key = Object.keys(credentials).find((name) => name.toLowerCase() === String(ref).toLowerCase());
    const env = (key && credentials[key]?.env) || ref;
    return { ref, env, valueHash: sha256(String(process.env[env] ?? '')) };
  });
  const requestKey = `${apiId}:${toolName}:v${tool.version}:${sha256(stableStringify({
    epoch: current.epoch,
    args: args ?? {},
    config: apiConfig,
    credentialState,
    adapter: tool.versionObj.adapter,
    schema: tool.versionObj.meta?.logicalSchema,
  }))}`;
  const circuitState = process.env.DATABASE_URL ? await circuit.checkAsync(apiId, toolName) : circuit.check(apiId, toolName);
  if (!circuitState.ok) {
    emitCall('call.failed', { code: 'tool_unavailable', reason: circuitState.reason });
    emitCall('halt', { reason: circuitState.reason, retryable: false });
    await appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason: circuitState.reason, callId });
    emit({ type: 'heal.finished', callId, runId, healId: callId, apiId, tool: toolName, outcome: 'halted', rounds: 0, ms: Date.now() - t0, tier: 0, tokens: { input: 0, output: 0 } });
    return halt('circuit_open', { until: circuitState.until });
  }
  const hasNegativeHit = process.env.DATABASE_URL ? await negativeHitAsync(requestKey) : negativeHit(requestKey);
  if (hasNegativeHit) {
    const cached = (process.env.DATABASE_URL ? await negativeResultAsync(requestKey) : negativeResult(requestKey)) ?? { reason: 'unfixable_contract' };
    const result = halt(cached.reason, { ...cached.details, signature: requestKey });
    emitCall('call.failed', { code: 'tool_unavailable', reason: cached.reason, cacheHit: true });
    emitCall('halt', { reason: cached.reason, retryable: false, cacheHit: true });
    await appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason: cached.reason, callId, cacheHit: true });
    emit({ type: 'heal.finished', callId, runId, healId: callId, apiId, tool: toolName, outcome: 'halted', rounds: 0, ms: Date.now() - t0, tier: 0, tokens: { input: 0, output: 0 } });
    return result;
  }

  const check = validateArgs(tool, args);
  if (!check.ok) {
    emitCall('call.failed', { code: 'invalid_arguments' });
    return failure('invalid_arguments', 'Logical schema violation — never healed', false, { errors: check.errors });
  }

  const resolveCredential = credentialResolver(apiId);
  let first;
  try {
    first = await send(tool, args, resolveCredential);
  } catch (err) {
    const result = mapDomainError(err, tool, args, null);
    if (err instanceof MissingCredential) {
      const details = { ref: err.ref, field: err.ref };
      if (process.env.DATABASE_URL) await cacheNegativeAsync(requestKey, { reason: 'credential_unavailable', details });
      else cacheNegative(requestKey, { reason: 'credential_unavailable', details });
    }
    return reportDomainHalt({ tool, result, callId, runId, t0 });
  }

  if (first.ok && matchesLogicalResponse(tool, first)) {
    emitCall('call.succeeded', { version: tool.version, healed: false, data: tool.compiled.extract(first.json ?? {}) });
    return success(tool, first, { healed: false, rounds: 0, tier: 0, latencyMs: Date.now() - t0 });
  }

  // A 200 response has already happened, so response-only drift is diagnosed
  // from that payload and is never replayed (especially for writes).
  if (first.ok) {
    const responseCheck = validateResponse(tool, first);
    const proposal = checkResponse({ tool, response: first });
    const mode = apiConfig.healing?.mode ?? 'enforce';
    const fields = { callId, runId, apiId, tool: toolName };
    if (proposal.ok) {
      const gate = safetyCheck({ proposal: { ...proposal, tier: 1, confidence: 0.9 }, tool, mode, apiCfg: apiConfig });
      if (gate.ok && mode !== 'log') {
        const remapped = { ...tool, versionObj: { ...tool.versionObj, adapter: proposal.adapter } };
        remapped.compiled = compileAdapter(proposal.adapter, resolveCredential);
        if (matchesLogicalResponse(remapped, first) && matchesIdentity(remapped, args, first)) {
          const change = {
            ops: proposal.ops, tier: 1, confidence: 0.9, evidence: proposal.evidence,
            rounds: 0, responseOnly: true, verified: true, callId, runId,
          };
          const committed = process.env.DATABASE_URL
            ? (await commitFromCache({ apiId, toolName, adapter: proposal.adapter, change, origin: 'heal', current })).value
            : registryStore.commit(apiId, toolName, proposal.adapter, change);
          emit({ type: 'drift.silent', ...fields, ops: proposal.ops, errors: responseCheck.errors ?? [] });
          emit({ type: 'patch.verified', ...fields, status: first.status, responseOnly: true });
          emit({ type: 'patch.committed', ...fields, version: committed.version, ops: proposal.ops, responseOnly: true });
          if (!process.env.DATABASE_URL) await appendAudit({ decision: 'commit', apiId, tool: toolName, versionBefore: tool.version, versionAfter: committed.version, tier: 1, ops: proposal.ops, evidence: proposal.evidence, responseOnly: true, callId });
          emitCall('call.succeeded', { version: committed.version, healed: true, rounds: 0, data: remapped.compiled.extract(first.json) });
          return success({ ...remapped, version: committed.version }, first, {
            healed: true, rounds: 0, tier: 1, cacheHit: false, latencyMs: Date.now() - t0,
            healMs: Date.now() - t0, ops: proposal.ops, version: committed.version,
          });
        }
        emit({ type: 'drift.silent', ...fields, ops: proposal.ops, errors: responseCheck.errors ?? [], outcome: 'identity_or_type_mismatch' });
      } else if (mode === 'log' && gate.ok) {
        await appendAudit({ decision: 'proposed', apiId, tool: toolName, versionBefore: tool.version, tier: 1, ops: proposal.ops, evidence: proposal.evidence, responseOnly: true, callId });
      }
    }
    const details = { reason: proposal.reason ?? 'response_drift_unresolved', fields: responseCheck.errors ?? [] };
    emit({ type: 'drift.silent', ...fields, errors: details.fields, outcome: 'halted' });
    emitCall('call.failed', { code: 'tool_unavailable', reason: details.reason });
    emit({ type: 'halt', ...fields, reason: details.reason, retryable: false });
    emit({ type: 'heal.finished', ...fields, healId: callId, outcome: 'halted', rounds: 0, ms: Date.now() - t0, tier: 1, tokens: { input: 0, output: 0 } });
    await appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason: details.reason, responseOnly: true, callId });
    return halt(details.reason, details);
  }

  let errors = parseErrors(first.json ?? first.text, first.status);
  let kind = classify(errors, first.status);
  if (first.ok) {
    const responseCheck = validateResponse(tool, first);
    if (!responseCheck.ok) {
      errors = responseCheck.errors;
      kind = 'response_drift';
      emitCall('drift.detected', { kind, errors });
    }
  }
  const signature = errorSignature(toolName, first);
  emitCall('upstream.request', { phase: 'live', status: first.status, ok: first.ok, ms: Date.now() - t0 });

  if (tool.versionObj.origin === 'dev' && !first.ok) {
    const parentVersion = tool.versionObj.parent;
    const restored = process.env.DATABASE_URL
      ? (await rollbackFromCache({ apiId, toolName, toVersion: parentVersion, origin: 'watchdog_rollback', current: tool, callId, runId })).value
      : registryStore.rollback(apiId, toolName, parentVersion);
    emitCall('patch.rolledback', { fromVersion: tool.version, toVersion: restored.version, reason: 'watchdog_validation_failure', auto: true });
    if (!process.env.DATABASE_URL) await appendAudit({ decision: 'rollback', apiId, tool: toolName, versionBefore: tool.version, versionAfter: restored.version, rollbackOf: parentVersion, auto: true, callId });
    const restoredTool = { ...registryStore.current(apiId, toolName), apiId, name: toolName };
    try {
      const replay = await send(restoredTool, args, resolveCredential);
      if (replay.ok && matchesLogicalResponse(restoredTool, replay) && matchesIdentity(restoredTool, args, replay)) {
        emitCall('call.succeeded', {
          version: restoredTool.version,
          healed: false,
          data: restoredTool.compiled.extract(replay.json ?? {}),
        });
        return success(restoredTool, replay, { healed: false, rounds: 0, tier: 0, version: restoredTool.version, latencyMs: Date.now() - t0 });
      }
    } catch (err) {
      return reportDomainHalt({ tool: restoredTool, result: mapDomainError(err, restoredTool, args, first), callId, runId, t0 });
    }
  }

  // G13: network errors (status 0) are not "other4xx".
  if (kind === 'network') {
    emitCall('call.failed', { code: 'upstream_error', reason: 'network' });
    return failure('upstream_error', 'Network failure', false);
  }

  if (kind === 'transient') {
    // G13: retry once only for reads (sideEffects !== 'write').
    const sideEffects = tool.versionObj?.adapter?.sideEffects ?? 'write';
    if (sideEffects !== 'write') {
      await new Promise((res) => setTimeout(res, 300));
      let r;
      try {
        r = await send(tool, args, resolveCredential);
      } catch (err) {
        return reportDomainHalt({ tool, result: mapDomainError(err, tool, args, first), callId, runId, t0 });
      }
      if (r.ok && matchesLogicalResponse(tool, r)) {
        emitCall('call.succeeded', { version: tool.version, healed: false, data: tool.compiled.extract(r.json ?? {}) });
        return success(tool, r, { healed: false, rounds: 0, tier: 0, latencyMs: Date.now() - t0 });
      }
    }
    emitCall('call.failed', { code: 'upstream_error', reason: 'transient' });
    return failure('upstream_error', 'Transient upstream failure after retry', false);
  }
  if (kind === 'auth4xx') {
    const details = { signature, message: 'The upstream requires credentials not configured for this tool' };
    if (process.env.DATABASE_URL) await cacheNegativeAsync(requestKey, { reason: 'credential_unavailable', details });
    else cacheNegative(requestKey, { reason: 'credential_unavailable', details });
    const result = halt('credential_unavailable', details);
    const openedUntil = process.env.DATABASE_URL ? await recordHaltAsync(apiId, toolName) : recordHalt(apiId, toolName);
    if (openedUntil) emit({ type: 'circuit.opened', apiId, tool: toolName, key: `${apiId}:${toolName}`, until: openedUntil });
    emitCall('call.failed', { code: 'tool_unavailable', reason: 'credential_unavailable' });
    emitCall('halt', { reason: 'credential_unavailable', retryable: false });
    await appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason: 'credential_unavailable', callId });
    emit({ type: 'heal.finished', callId, runId, healId: callId, apiId, tool: toolName, outcome: 'halted', rounds: 0, ms: Date.now() - t0, tier: 0, tokens: { input: 0, output: 0 } });
    return result;
  }
  if (kind === 'other4xx') {
    emitCall('call.failed', { code: 'upstream_rejected' });
    return failure('upstream_rejected', first.json ?? first.text, false);
  }
  if (kind === 'value_rejected') {
    emitCall('call.failed', { code: 'upstream_rejected' });
    return failure('upstream_rejected', first.json ?? first.text, false);
  }

  emitCall('call.failed', { code: 'drift', kind });
  const healingConfig = apiConfig.healing ?? {};
  if (healingConfig.enabled === false || healingConfig.mode === 'off') {
    const reason = 'healing_disabled';
    const result = halt(reason);
    emitCall('halt', { reason, retryable: false });
    emit({ type: 'heal.finished', callId, runId, healId: callId, apiId, tool: toolName, outcome: 'halted', rounds: 0, ms: Date.now() - t0, tier: 0, tokens: { input: 0, output: 0 } });
    await appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason, callId });
    return result;
  }

  const healResult = await withHealLock(
    apiId,
    toolName,
    () => healAndRetry({ tool, args, first, kind, callId, runId, t0, resolveCredential, requestKey }),
    args,
    { callId, runId, t0 },
  );
  const result = healResult.result;

  if (result.ok) {
    emitCall('call.succeeded', { version: result.meta.version, healed: true, rounds: result.meta.rounds, data: result.data });
  } else {
    if (reportedDomainHalts.has(result)) return result;
    emitCall('call.failed', { code: result.error.code, reason: result.error.details?.reason });
    if (result.error.code === 'tool_unavailable') {
      await appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason: result.error.details?.reason, callId });
      if (process.env.DATABASE_URL) await recordHaltAsync(apiId, toolName);
      else recordHalt(apiId, toolName);
    }
  }
  return result;
}

export async function invoke({ apiId, toolName, args, runId }) {
  if (!process.env.DATABASE_URL) return invokeCore({ apiId, toolName, args, runId });

  const callId = newId('c');
  const startedAt = new Date();
  const initial = registryStore.current(apiId, toolName);
  const sideEffects = initial?.versionObj?.meta?.sideEffects ?? initial?.versionObj?.adapter?.sideEffects ?? 'write';
  const started = Date.now();
  try {
    await withTransaction(async (client) => {
      await startInvocationInTransaction(client, {
        callId, runId, apiId, toolName, initialVersion: initial?.version,
        healingMode: registryStore.config(apiId)?.healing?.mode,
        startedAt,
      });
    });
  } catch (error) {
    return failure('persistence_unavailable', 'Call was not sent because durable invocation storage is unavailable', false, { code: error.code ?? 'database_unavailable' });
  }

  let result;
  let thrown;
  try { result = await invokeCore({ apiId, toolName, args, runId, callId }); }
  catch (error) { thrown = error; }
  let intermediateEventFailure;
  try { await flushDurableEvents(); }
  catch (error) { intermediateEventFailure = error; }
  if (thrown) {
    result = thrown.beforeUpstream
      ? failure('persistence_unavailable', 'Call was not sent because its start event could not be persisted', false)
      : failure('internal_error', 'Invocation failed before a durable outcome was recorded', false);
  }

  const outcome = thrown?.beforeUpstream ? 'failed' : thrown
    ? 'outcome_uncertain'
    : result.ok ? (result.meta?.healed ? 'healed' : 'succeeded')
      : result.error.code === 'invalid_arguments' ? 'rejected'
        : result.error.code === 'tool_unavailable' ? 'halted' : 'failed';
  try {
    await withTransaction(async (client) => {
      await finishInvocationInTransaction(client, {
        callId, outcome, finalVersion: result.ok ? result.meta?.version : initial?.version,
        errorCode: result.ok ? null : result.error?.code,
        haltReason: result.ok ? null : result.error?.details?.reason,
        tier: result.meta?.tier, rounds: result.meta?.rounds,
        durationMs: Date.now() - started, cacheHit: result.meta?.cacheHit,
        summary: {
          healed: Boolean(result.ok && result.meta?.healed),
          ...(intermediateEventFailure ? { eventPersistenceDegraded: true } : {}),
        },
      });
      await appendAuditInTransaction(client, {
        decision: outcome, apiId, tool: toolName, callId,
        versionBefore: initial?.version, versionAfter: result.ok ? result.meta?.version : undefined,
        reason: result.ok ? undefined : result.error?.details?.reason ?? result.error?.code,
        ...(intermediateEventFailure ? { eventPersistenceDegraded: true } : {}),
        rounds: result.meta?.rounds ?? 0, tier: result.meta?.tier ?? 0,
      });
      await appendGatewayEventInTransaction(client, {
        type: result.ok ? 'call.succeeded' : 'call.failed', callId, runId, apiId, tool: toolName,
        outcome, version: result.ok ? result.meta?.version : initial?.version,
        code: result.ok ? undefined : result.error?.code,
      });
    });
  } catch (error) {
    if (sideEffects !== 'read' && sideEffects !== 'none') {
      return failure('outcome_uncertain', 'The upstream write may have completed, but Healr could not durably record its outcome. Do not retry automatically.', false, { callId });
    }
    return failure('persistence_unavailable', 'Healr could not durably record the call outcome', false, { callId, code: error.code ?? 'database_unavailable' });
  }
  if (thrown?.beforeUpstream) return result;
  if (thrown) {
    if (sideEffects !== 'read' && sideEffects !== 'none') {
      return failure('outcome_uncertain', 'The upstream write may have completed, but Healr encountered an internal failure while recording its outcome. Do not retry automatically.', false, { callId });
    }
    return result;
  }
  return result;
}

export { errorSignature, withHealLock, MissingCredential, validateResponse };
