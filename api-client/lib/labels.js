export const OUTCOME = {
  inflight:    { tone: 'drift',    label: 'In flight',  hint: 'Call is still running' },
  passthrough: { tone: 'ok',       label: 'Passed',     hint: 'API accepted the call unchanged' },
  healed:      { tone: 'healed',   label: 'Healed',     hint: 'API changed. healr fixed the call and proved it with a replay' },
  cache:       { tone: 'cache',    label: 'Cache hit',  hint: 'A previously proven fix was reused' },
  rejected:    { tone: 'rejected', label: 'Rejected',   hint: 'The API refused the input itself. Nothing to heal' },
  halted:      { tone: 'halted',   label: 'Halted',     hint: 'healr could not prove a safe fix and stopped on purpose' },
  failed:      { tone: 'bad',      label: 'Failed',     hint: 'Unexpected error' },
};

export const HALT_REASON = {
  credential_unavailable: 'A required credential is not configured, so healr will not guess it.',
  not_lossless: 'The fix would change the value (for example "abc" to a number). healr only applies lossless fixes.',
  provenance_violation: 'The fix would send a value that did not come from the caller, the spec, or a credential.',
  low_confidence: 'The proposed fix was below the confidence threshold.',
  max_rounds: 'The heal budget ran out before the call succeeded.',
  circuit_open: 'Too many failed heals. healr paused this tool.',
<<<<<<< HEAD
  requires_approval: 'A high-risk proposal is waiting for operator review. It was not committed.',
  tier2_no_proposal: 'Tier 2 could not make a validated proposal. Review the evidence before taking action.',
  tier2_timeout: 'Tier 2 exceeded its request budget. Deterministic healing remains available.',
  tier2_unavailable: 'Gemini was unavailable for this diagnosis. Deterministic healing remains available.',
  tier2_invalid_output: 'Tier 2 output failed validation and was not applied.',
};
export const haltReason = (r) => HALT_REASON[r] ?? `Stopped: ${r}`;

export const TIER_LABEL = Object.freeze({ 0: 'Tier 0 · OpenAPI spec', 1: 'Tier 1 · deterministic', 2: 'Tier 2 · Gemini', cache: 'Verified cache' });
export const tierLabel = (tier) => TIER_LABEL[tier] ?? (tier == null ? 'No diagnosis tier' : `Tier ${tier}`);

=======
};
export const haltReason = (r) => HALT_REASON[r] ?? `Stopped: ${r}`;

>>>>>>> origin/main
export const EVENT_LABEL = {
  'call.started': 'Call started', 'upstream.request': 'Sent to API', 'call.failed': 'API rejected the call',
  'diagnosis.started': 'Diagnosing', 'patch.proposed': 'Fix proposed', 'patch.verified': 'Fix verified by replay',
  'patch.committed': 'Fix committed', 'call.succeeded': 'Call succeeded', 'heal.started': 'Heal started',
  'heal.finished': 'Heal finished', halt: 'Halted safely', 'cache.hit': 'Cache hit', 'drift.silent': 'Silent drift detected',
  'registry.rollback': 'Rolled back', 'api.registered': 'API registered', 'api.removed': 'API removed',
};

// Human sentence for a typed patch op. Used by OpChip, call drawer, version timeline.
export function describeOp(op) {
  switch (op.op) {
    case 'add_header':    return `Add header ${op.name}`;
    case 'move_field':    return `Move ${op.from} to ${op.to}`;
    case 'rename_field':  return `Rename ${op.from} to ${op.to}${op.path ? ` (inside ${op.path})` : ''}`;
    case 'coerce_type':   return `Convert ${op.path} from ${op.from} to ${op.to}`;
    case 'add_field':     return `Add field ${op.path}`;
    case 'set_enum_map':  return `Map enum values at ${op.path}`;
    case 'remap_response_path': return `Read ${op.logical} from ${op.to}`;
    default:              return op.op;
  }
}
export const opSource = (op) => op.source ? `${op.source.type}:${op.source.ref ?? ''}` : null;
