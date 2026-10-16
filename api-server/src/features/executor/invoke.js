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
import { sha256 } from '../../lib/hash.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { cfg } from '../../config.js';
import { check as safetyCheck, circuit } from '../safety/index.js';
import { append as appendAudit } from '../audit/index.js';
import { negativeHit, cacheNegative, recordHalt } from '../safety/circuit.js';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validatorCache = new Map(); // key: `${apiId}:${tool}:v${version}` -> compiled ajv validator

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

function validatorKey(apiId, tool, version) {
  return `${apiId}:${tool}:v${version}`;
}
function getValidator(apiId, tool, version, jsonSchema) {
  const key = validatorKey(apiId, tool, version);
  let v = validatorCache.get(key);
  if (!v) {
    v = ajv.compile(jsonSchema);
    validatorCache.set(key, v);
  }
  return v;
}

function validateArgs(tool, args) {
  const logical = tool.versionObj?.meta?.logicalSchema ?? tool.versionObj?.adapter?._logicalSchema;
  if (!logical) return { ok: true };
  const validate = getValidator(tool.apiId, tool.name, tool.version, logical);
  const ok = validate(args);
  return ok ? { ok: true } : { ok: false, errors: validate.errors ?? [] };
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
  const url = new URL(resolvedPath, baseUrl);
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
  const fields = tool.versionObj?.adapter?.response?.map ?? {};
  if (!fields || Object.keys(fields).length === 0) return response.ok;
  const json = response.json ?? {};
  for (const [logical, path] of Object.entries(fields)) {
    if (getPath(json, path) === undefined) return false;
  }

  return true;
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

// Heal lock (§5.2): only one leader heals per apiId:tool; followers await then
// re-send their own args on the new version (no recursive heal, no data leak).
const healLocks = new Map(); // key -> Promise<{ version: number }>
async function withHealLock(apiId, toolName, healFn, args) {
  const key = `${apiId}:${toolName}`;
  const leader = healLocks.get(key);
  if (leader) {
    await leader;
    // Follower: re-send own args on the new version if it advanced.
    const current = registryStore.current(apiId, toolName);
    if (!current) return { follower: true, result: halt('not_registered', { apiId, tool: toolName }) };
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
      return { follower: true, result: halt('follower_replay_failed', { status: r.status }) };
    } catch (err) {
      return { follower: true, result: mapDomainError(err, tool, args, null) };
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

// Heal loop (§5.3)
async function healAndRetry({ tool, args, first, kind, callId, runId, t0, resolveCredential }) {
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
    if (seen.has(sig)) return halt('loop_detected', { sig });
    seen.add(sig);

    emit({ type: 'diagnosis.started', callId, runId, apiId: tool.apiId, tool: tool.name, round: rounds, kind });

    const proposal = await diagnose({ tool: draft, args, failure, kind });
    if (!proposal) {
      cacheNegative(`${tool.apiId}:${tool.name}:${sha256(JSON.stringify(args))}`);
      const result = halt('no_diagnosis', { kind });
      emit({ type: 'halt', callId, runId, apiId: tool.apiId, tool: tool.name, reason: result.error.details.reason, retryable: false });
      return result;
    }
    const gate = safetyCheck({ proposal, tool: draft, mode: healing.mode ?? 'enforce', apiCfg: apiConfig });
    if (!gate.ok) return halt(gate.reason, gate.details);
    if ((healing.mode ?? 'enforce') === 'log') {
      appendAudit({ decision: 'proposed', apiId: tool.apiId, tool: tool.name, versionBefore: tool.version, tier: proposal.tier, ops: proposal.ops, confidence: proposal.confidence, evidence: proposal.evidence, healId: callId });
      emit({ type: 'halt', callId, runId, apiId: tool.apiId, tool: tool.name, reason: 'drift_unresolved', details: { proposal }, retryable: false });
      return halt('drift_unresolved', { proposal });
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
      return mapDomainError(err, nextDraft, args, first);
    }

    if (r.ok && matchesLogicalResponse(nextDraft, r) && matchesIdentity(nextDraft, args, r)) {
      const commitOps = applied.concat(proposal.ops);
      const committed = registryStore.commit(tool.apiId, tool.name, newAdapter, {
        ops: commitOps,
        tier: proposal.tier,
        confidence: proposal.confidence,
        evidence: proposal.evidence,
        rounds,
        latencyMs: Date.now() - t0,
      });
      emit({ type: 'patch.committed', callId, runId, apiId: tool.apiId, tool: tool.name, version: committed.version, ops: commitOps });
      emit({ type: 'patch.verified', callId, runId, apiId: tool.apiId, tool: tool.name, round: rounds, status: r.status });
      emit({ type: 'heal.finished', callId, runId, healId: callId, apiId: tool.apiId, tool: tool.name, outcome: 'committed', rounds, tier: proposal.tier, ms: Date.now() - t0, tokens: { input: 0, output: 0 } });
      appendAudit({
        decision: 'commit', apiId: tool.apiId, tool: tool.name,
        versionBefore: tool.version, versionAfter: committed.version,
        tier: proposal.tier, ops: commitOps, confidence: proposal.confidence,
        evidence: proposal.evidence, healId: callId, callId,
        latencyMs: Date.now() - t0,
      });
      return success(nextDraft, r, {
        healed: true, rounds, tier: proposal.tier, cacheHit: false,
        latencyMs: Date.now() - t0, healMs: Date.now() - t0, tokens: { input: 0, output: 0 },
        ops: commitOps, version: committed.version,
      });
    }
    if (r.ok && matchesLogicalResponse(nextDraft, r)) return halt('verification_mismatch');
    failure = r;
    draft = nextDraft;
    applied.push(...proposal.ops);
  }
  const result = halt('budget_exhausted', { rounds });
  emit({ type: 'halt', callId, runId, apiId: tool.apiId, tool: tool.name, reason: 'budget_exhausted', retryable: false });
  emit({ type: 'heal.finished', callId, runId, healId: callId, apiId: tool.apiId, tool: tool.name, outcome: 'halted', rounds, ms: Date.now() - t0, tokens: { input: 0, output: 0 } });
  return result;
}

export async function invoke({ apiId, toolName, args, runId }) {
  const callId = newId('c');
  const t0 = Date.now();
  const emitCall = (type, extra) => emit({ type, callId, runId, apiId, tool: toolName, ...extra });

  // G18: never emit raw args on the public stream.
  emitCall('call.started', { argKeys: Object.keys(args ?? {}), argCount: Object.keys(args ?? {}).length });

  const current = registryStore.current(apiId, toolName);
  if (!current) {
    emitCall('call.failed', { reason: 'not_registered' });
    return failure('tool_unavailable', `API/tool not registered: ${apiId}/${toolName}`, false);
  }

  const tool = { ...current, apiId, name: toolName };
  const requestKey = `${apiId}:${toolName}:${sha256(JSON.stringify(args ?? {}))}`;
  const circuitState = circuit.check(apiId, toolName);
  if (!circuitState.ok) {
    emitCall('halt', { reason: circuitState.reason, retryable: false });
    return halt('circuit_open', { until: circuitState.until });
  }
  if (negativeHit(requestKey)) {
    const result = halt('unfixable_contract', { signature: requestKey });
    emitCall('halt', { reason: 'unfixable_contract', retryable: false });
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
    return mapDomainError(err, tool, args, null);
  }

  if (first.ok && matchesLogicalResponse(tool, first)) {
    emitCall('call.succeeded', { version: tool.version, healed: false, data: tool.compiled.extract(first.json ?? {}) });
    return success(tool, first, { healed: false, rounds: 0, tier: 0, latencyMs: Date.now() - t0 });
  }

  const errors = parseErrors(first.json ?? first.text, first.status);
  const kind = classify(errors, first.status);
  const signature = errorSignature(toolName, first);
  emitCall('upstream.request', { phase: 'live', status: first.status, ok: first.ok, ms: Date.now() - t0 });

  if (tool.versionObj.origin === 'dev' && !first.ok) {
    const parentVersion = tool.versionObj.parent;
    const restored = registryStore.rollback(apiId, toolName, parentVersion);
    emitCall('patch.rolledback', { fromVersion: tool.version, toVersion: restored.version, reason: 'watchdog_validation_failure', auto: true });
    appendAudit({ decision: 'rollback', apiId, tool: toolName, versionBefore: tool.version, versionAfter: restored.version, rollbackOf: parentVersion, auto: true, callId });
    const restoredTool = { ...registryStore.current(apiId, toolName), apiId, name: toolName };
    try {
      const replay = await send(restoredTool, args, resolveCredential);
      if (replay.ok && matchesLogicalResponse(restoredTool, replay) && matchesIdentity(restoredTool, args, replay)) {
        return success(restoredTool, replay, { healed: false, rounds: 0, tier: 0, version: restoredTool.version, latencyMs: Date.now() - t0 });
      }
    } catch (err) {
      return mapDomainError(err, restoredTool, args, first);
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
        return mapDomainError(err, tool, args, first);
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
    cacheNegative(requestKey);
    const result = halt('credential_unavailable', { signature, message: 'The upstream requires credentials not configured for this tool' });
    const openedUntil = recordHalt(apiId, toolName);
    if (openedUntil) emit({ type: 'circuit.opened', apiId, tool: toolName, key: `${apiId}:${toolName}`, until: openedUntil });
    emitCall('halt', { reason: 'credential_unavailable', retryable: false });
    appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason: 'credential_unavailable', callId });
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

  const healResult = await withHealLock(apiId, toolName, () =>
    healAndRetry({ tool, args, first, kind, callId, runId, t0, resolveCredential }), args
  );
  const result = healResult.result;

  if (result.ok) {
    emitCall('call.succeeded', { version: result.meta.version, healed: true, rounds: result.meta.rounds, data: result.data });
  } else {
    emitCall('call.failed', { code: result.error.code, reason: result.error.details?.reason });
    if (result.error.code === 'tool_unavailable') {
      appendAudit({ decision: 'halt', apiId, tool: toolName, versionBefore: tool.version, reason: result.error.details?.reason, callId });
      recordHalt(apiId, toolName);
    }
  }
  return result;
}

export { errorSignature, withHealLock, MissingCredential };
