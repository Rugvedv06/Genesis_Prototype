// Phase 1 Track A: type rule (§6 Phase 1). Lossless type coercion only.
// '007' -> 7 is NOT lossless, so it halts (§5.4 coerceLossless).
// The error body may not carry the offending value (pydantic-v1 omits `input`),
// so we infer the wire types from the error type name and validate losslessness
// against coerceLossless at build time (which throws NotLossless -> halt).
import { coerceLossless } from '../../registry/compile.js';

export function typeRule({ errors, request }) {
  const typeErrs = errors.filter((e) => e.kind === 'type');
  if (!typeErrs.length) return null;

  const err = typeErrs.find((e) => e.path.length > 0);
  if (!err) return null;

  const path = err.path.join('.');
  const t = String(err.raw?.type ?? err.raw?.msg ?? '');

  let to = null;
  if (t.includes('integer')) to = 'integer';
  else if (t.includes('string')) to = 'string';
  if (!to) return null;

  // Inferred "from" type: the received value if present, else assume string
  // (body params arrive as strings in the wire JSON).
  const from = err.received !== null && err.received !== undefined ? typeof err.received : 'string';

  // Validate losslessness against the received value when available;
  // otherwise the build-time coerceLossless will throw NotLossless -> halt.
  if (err.received !== null && err.received !== undefined) {
    try {
      coerceLossless(err.received, from, to);
    } catch {
      return null; // not lossless -> halt rather than invent
    }
  }

  return {
    tier: 1,
    confidence: 0.95,
    ops: [{ op: 'coerce_type', path, from, to }],
    evidence: [err.raw],
  };
}
