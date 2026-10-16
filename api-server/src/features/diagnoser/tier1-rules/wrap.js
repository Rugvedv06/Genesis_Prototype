// Phase 1 Track A: wrap rule (§6 Phase 1).
// Error 'missing' at a top-level path P plus an 'extra' leaf L at root level:
// propose move_field L -> P.L (nest the extra leaf inside the missing object).
// The next round's error (P.id missing, P.L extra) triggers rename inside the wrapper.
// Converges in 3-4 rounds against a layered validator.
import { nameScore } from './rename.js';

export function wrapRule({ errors, request }) {
  const missing = errors.filter((e) => e.kind === 'missing');
  const extra = errors.filter((e) => e.kind === 'extra');
  if (!missing.length || !extra.length) return null;

  for (const m of missing) {
    // P must be a single top-level key (the object to nest into)
    if (m.path.length !== 1) continue;
    for (const x of extra) {
      // L must be a single top-level key, different from P
      if (x.path.length !== 1) continue;
      if (x.path[0] === m.path[0]) continue;
      // Near-identical names indicate a rename rather than a new wrapper.
      if (nameScore(m.path[0], x.path[0]) >= 0.75) continue;
      return {
        tier: 1,
        confidence: 0.9,
        ops: [{ op: 'move_field', from: x.path[0], to: `${m.path[0]}.${x.path[0]}` }],
        evidence: [m.raw, x.raw],
      };
    }
  }
  return null;
}
