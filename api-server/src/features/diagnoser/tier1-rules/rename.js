// Phase 1 Track A: rename rule (§6 Phase 1). Pairs a single 'missing' field with
// a single 'extra' field by name similarity; forced pairing by elimination when
// singleton. Returns null when ambiguous (escalates to Tier 2).
export const tokens = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[a.length][b.length];
}

export function nameScore(a, b) {
  const ta = tokens(a), tb = tokens(b);
  const shared = ta.filter((t) => tb.includes(t)).length;
  const jac = shared / new Set([...ta, ...tb]).size;
  const sim = 1 - lev(a.toLowerCase(), b.toLowerCase()) / Math.max(a.length, b.length, 1);
  return Math.max(jac, sim);
}

export function renameRule({ errors, request }) {
  const missing = errors.filter((e) => e.kind === 'missing');
  const extra = errors.filter((e) => e.kind === 'extra');
  if (!missing.length || !extra.length) return null;

  const pairs = [];
  for (const m of missing) {
    for (const x of extra) {
      pairs.push({ m, x, score: nameScore(m.path.at(-1) ?? '', x.path.at(-1) ?? '') });
    }
  }
  pairs.sort((p, q) => q.score - p.score);
  const best = pairs[0];
  const second = pairs[1];

  const singleton = missing.length === 1 && extra.length === 1; // forced pairing by elimination
  const margin = second ? best.score - second.score : 1;
  const confident = singleton
    ? 0.86
    : best.score >= 0.6 && margin >= 0.15
      ? 0.7 + Math.min(best.score, 1) * 0.25
      : 0;
  if (!confident) return null; // ambiguous -> Tier 2

  const parent = best.m.path.slice(0, -1).join('.');
  return {
    tier: 1,
    confidence: Math.min(confident, 0.95),
    ops: [{ op: 'rename_field', path: parent, from: best.x.path.at(-1), to: best.m.path.at(-1) }],
    evidence: [best.m.raw, best.x.raw],
  };
}
