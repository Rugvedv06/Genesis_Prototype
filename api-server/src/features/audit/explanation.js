import { sha256, stableStringify } from '../../lib/hash.js';

const MAX_TEXT = 500;
const MAX_ITEMS = 16;
const MAX_ASSUMPTIONS = 16;
const MAX_SOURCES = 16;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const OP_NAMES = new Set(['rename_field', 'move_field', 'coerce_type', 'add_field', 'add_header', 'set_enum_map', 'remap_response_path', 'unknown']);
const CHECK_NAMES = new Set(['confidence_threshold', 'policy_gate', 'replay_verification', 'logical_response', 'identity', 'write_echo']);

function safeText(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function safePath(value) {
  return typeof value === 'string' && value.length <= 256 ? value : null;
}

function operationPaths(operation) {
  if (!operation || typeof operation !== 'object') return null;
  if (operation.op === 'rename_field') {
    const prefix = operation.path ? `${operation.path}.` : '';
    return { before: `${prefix}${operation.from}`, after: `${prefix}${operation.to}` };
  }
  if (operation.op === 'move_field') return { before: operation.from, after: operation.to };
  if (operation.op === 'coerce_type' || operation.op === 'set_enum_map' || operation.op === 'remap_response_path') {
    return { before: operation.path, after: operation.path };
  }
  if (operation.op === 'add_field' || operation.op === 'add_header') return { before: null, after: operation.path ?? operation.name };
  return null;
}

function safeOperation(operation) {
  if (!operation || typeof operation !== 'object' || typeof operation.op !== 'string') return { op: 'unknown' };
  const paths = operationPaths(operation);
  return {
    op: operation.op,
    ...(paths ? { paths: { before: safePath(paths.before), after: safePath(paths.after) } } : {}),
    ...(typeof operation.from === 'string' ? { from: safePath(operation.from) } : {}),
    ...(typeof operation.to === 'string' ? { to: safePath(operation.to) } : {}),
  };
}

function safeEvidence(item) {
  if (typeof item === 'string') return { kind: 'diagnostic', quote: safeText(item) };
  if (!item || typeof item !== 'object') return { kind: 'diagnostic' };
  return {
    ...(typeof item.kind === 'string' ? { kind: item.kind.slice(0, 80) } : {}),
    ...(typeof item.source === 'string' ? { source: item.source.slice(0, 80) } : {}),
    ...(typeof item.pointer === 'string' ? { pointer: safePath(item.pointer) } : {}),
    ...(typeof item.spec === 'string' ? { spec: safeText(item.spec) } : {}),
    ...(typeof item.quote === 'string' ? { quote: safeText(item.quote) } : {}),
    ...(typeof item.logicalValue === 'string' ? { logicalValue: safeText(item.logicalValue) } : {}),
    ...(typeof item.mapped === 'string' ? { mapped: safeText(item.mapped) } : {}),
  };
}

function hashes(adapter) {
  return adapter && typeof adapter === 'object' ? sha256(stableStringify(adapter)) : null;
}

function boundedText(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f]/.test(value)
    ? safeText(value)
    : null;
}

function boundedPath(value) {
  return typeof value === 'string' && value.length <= 256
    && !/[\u0000-\u001f]/.test(value)
    && !/(secret|token|password|credential|apikey|authorization|cookie)/i.test(value)
    ? safePath(value)
    : null;
}

function sanitizeOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return { op: 'unknown' };
  const op = OP_NAMES.has(operation.op) ? operation.op : 'unknown';
  const paths = operation.paths && typeof operation.paths === 'object' && !Array.isArray(operation.paths)
    ? {
      ...(boundedPath(operation.paths.before) !== null ? { before: boundedPath(operation.paths.before) } : {}),
      ...(boundedPath(operation.paths.after) !== null ? { after: boundedPath(operation.paths.after) } : {}),
    }
    : null;
  return {
    op,
    ...(paths && Object.keys(paths).length ? { paths } : {}),
    ...(boundedPath(operation.from) !== null ? { from: boundedPath(operation.from) } : {}),
    ...(boundedPath(operation.to) !== null ? { to: boundedPath(operation.to) } : {}),
  };
}

function sanitizeEvidence(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { kind: 'diagnostic' };
  const result = {};
  for (const key of ['kind', 'source']) {
    const value = boundedText(item[key], 80);
    if (value !== null) result[key] = value;
  }
  for (const key of ['pointer']) {
    const value = boundedPath(item[key]);
    if (value !== null) result[key] = value;
  }
  for (const key of ['spec', 'quote', 'logicalValue', 'mapped']) {
    const value = boundedText(item[key]);
    if (value !== null) result[key] = value;
  }
  return result;
}

function sanitizeCheck(check) {
  if (!check || typeof check !== 'object' || Array.isArray(check)
    || !CHECK_NAMES.has(check.name) || typeof check.passed !== 'boolean') return null;
  const detail = check.detail === null || check.detail === undefined
    ? null
    : (typeof check.detail === 'number' && Number.isFinite(check.detail)
      ? check.detail
      : boundedText(check.detail, 120));
  return { name: check.name, passed: check.passed, detail };
}

/**
 * Sanitize explanation data at persistence boundaries. This is intentionally
 * independent from the builder so callers cannot bypass the storage contract.
 */
export function sanitizePatchExplanation(explanation) {
  if (!explanation || typeof explanation !== 'object' || Array.isArray(explanation)
    || explanation.schemaVersion !== 1) return null;
  const adapter = explanation.adapter;
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) return null;
  const version = (value) => value === null || (Number.isSafeInteger(value) && value >= 1) ? value : null;
  const hash = (value) => value === null || (typeof value === 'string' && HASH_PATTERN.test(value)) ? value : null;
  if (version(adapter.beforeVersion) === null && adapter.beforeVersion !== null) return null;
  if (version(adapter.afterVersion) === null && adapter.afterVersion !== null) return null;
  if (hash(adapter.beforeHash) === null && adapter.beforeHash !== null) return null;
  if (hash(adapter.afterHash) === null && adapter.afterHash !== null) return null;
  const provenance = explanation.provenance && typeof explanation.provenance === 'object' && !Array.isArray(explanation.provenance)
    ? explanation.provenance : {};
  const policy = explanation.policy && typeof explanation.policy === 'object' && !Array.isArray(explanation.policy)
    ? explanation.policy : {};
  const threshold = policy.threshold === null || policy.threshold === undefined
    ? null : (typeof policy.threshold === 'number' && Number.isFinite(policy.threshold) ? policy.threshold : null);
  const decision = boundedText(policy.decision, 80);
  const mode = boundedText(policy.mode, 40);
  const risk = boundedText(policy.risk, 40);
  const checks = Array.isArray(explanation.checks) ? explanation.checks.slice(0, MAX_ITEMS).map(sanitizeCheck).filter(Boolean) : [];
  return {
    schemaVersion: 1,
    adapter: {
      beforeVersion: version(adapter.beforeVersion),
      afterVersion: version(adapter.afterVersion),
      beforeHash: hash(adapter.beforeHash),
      afterHash: hash(adapter.afterHash),
    },
    changes: Array.isArray(explanation.changes) ? explanation.changes.slice(0, MAX_ITEMS).map(sanitizeOperation) : [],
    evidenceItems: Array.isArray(explanation.evidenceItems) ? explanation.evidenceItems.slice(0, MAX_ITEMS).map(sanitizeEvidence) : [],
    provenance: {
      tier: Number.isSafeInteger(provenance.tier) && provenance.tier >= 0 ? provenance.tier : null,
      provider: boundedText(provenance.provider, 100),
      model: boundedText(provenance.model, 100),
      sources: Array.isArray(provenance.sources)
        ? [...new Set(provenance.sources.slice(0, MAX_SOURCES).map((value) => boundedText(value, 80)).filter(Boolean))]
        : [],
    },
    assumptions: Array.isArray(explanation.assumptions)
      ? explanation.assumptions.slice(0, MAX_ASSUMPTIONS).map((value) => boundedText(value, MAX_TEXT)).filter(Boolean)
      : [],
    checks,
    policy: { mode, threshold, decision: decision ?? 'rejected', risk },
  };
}

export function buildPatchExplanation({
  beforeAdapter,
  afterAdapter,
  beforeVersion,
  afterVersion,
  proposal = {},
  gate = {},
  verification = {},
  policy = {},
  provenance = {},
}) {
  const operations = (proposal.ops ?? []).slice(0, MAX_ITEMS).map(safeOperation);
  const evidence = (proposal.evidence ?? []).slice(0, MAX_ITEMS).map(safeEvidence);
  const threshold = policy.threshold ?? null;
  const checks = [
    { name: 'confidence_threshold', passed: threshold == null || Number(proposal.confidence) >= Number(threshold), detail: threshold == null ? null : threshold },
    { name: 'policy_gate', passed: gate.ok === true, detail: gate.reason ?? null },
    { name: 'replay_verification', passed: verification.replay === true },
    { name: 'logical_response', passed: verification.logicalResponse === true },
    { name: 'identity', passed: verification.identity === true },
    ...(verification.writeEcho === undefined ? [] : [{ name: 'write_echo', passed: verification.writeEcho === true }]),
  ];
  const assumptions = [
    'Only allowlisted adapter operations were proposed.',
    ...(provenance.observedNames ? ['Operation names were observed in the request, error, or contract context.'] : []),
    ...(verification.replay === true ? ['The proposed adapter was replay-verified against the upstream response.'] : []),
  ];
  return {
    schemaVersion: 1,
    adapter: {
      beforeVersion: beforeVersion ?? null,
      afterVersion: afterVersion ?? null,
      beforeHash: hashes(beforeAdapter),
      afterHash: hashes(afterAdapter),
    },
    changes: operations,
    evidenceItems: evidence,
    provenance: {
      tier: proposal.tier ?? null,
      provider: typeof proposal.provider === 'string' ? proposal.provider.slice(0, 100) : null,
      model: typeof proposal.model === 'string' ? proposal.model.slice(0, 100) : null,
      sources: [...new Set(evidence.map((item) => item.source ?? item.kind).filter(Boolean))],
    },
    assumptions,
    checks,
    policy: {
      mode: policy.mode ?? null,
      threshold,
      decision: gate.ok === true ? 'commit' : gate.reason ?? 'rejected',
      risk: policy.risk ?? null,
    },
  };
}
