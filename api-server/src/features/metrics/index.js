import { on } from '../events/bus.js';

const buckets = [];
<<<<<<< HEAD
const totals = { calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, tokensByTier: {}, tokensByRole: {}, tier2Outcomes: { accepted: 0, rejectedQuote: 0, rejectedSchema: 0, timeout: 0, unavailable: 0, noProposal: 0 } };
=======
<<<<<<< HEAD
const totals = { calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, tokensByTier: {}, tokensByRole: {}, tier2Outcomes: { accepted: 0, rejectedQuote: 0, rejectedSchema: 0, timeout: 0, unavailable: 0, noProposal: 0 } };
=======
const totals = { calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0 };
>>>>>>> origin/main
>>>>>>> origin/main
const MAX_BUCKETS = 3600;

function bucket() {
  const t = Math.floor(Date.now() / 1000);
  let current = buckets.at(-1);
  if (!current || current.t !== t) {
<<<<<<< HEAD
    current = { t, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, tokensByTier: {}, tokensByRole: {}, healMsSamples: [] };
=======
<<<<<<< HEAD
    current = { t, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, tokensByTier: {}, tokensByRole: {}, healMsSamples: [] };
=======
    current = { t, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, healMsSamples: [] };
>>>>>>> origin/main
>>>>>>> origin/main
    buckets.push(current);
    while (buckets.length > MAX_BUCKETS) buckets.shift();
  }
  return current;
}

on((event) => {
  const current = bucket();
  if (event.type === 'call.started') { current.calls += 1; totals.calls += 1; }
  if (event.type === 'call.succeeded') {
    current.ok += 1; totals.ok += 1;
    if (event.healed) { current.healed += 1; totals.healed += 1; }
  }
  if (event.type === 'call.failed') {
    if (event.code === 'tool_unavailable') { current.halted += 1; totals.halted += 1; }
    if (event.code === 'upstream_rejected') { current.rejected += 1; totals.rejected += 1; }
  }
  if (event.type === 'cache.hit') { current.cacheHits += 1; totals.cacheHits += 1; }
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  if (event.type === 'heal.finished') {
    const input = Number(event.tokens?.input ?? event.tokens?.inputTokens ?? 0);
    const output = Number(event.tokens?.output ?? event.tokens?.outputTokens ?? 0);
    current.tokensIn += input; current.tokensOut += output;
    totals.tokensIn += input; totals.tokensOut += output;
    const tier = String(event.tier ?? 0);
    const byTier = totals.tokensByTier[tier] ??= { input: 0, output: 0 };
    byTier.input += input; byTier.output += output;
    const bucketTier = current.tokensByTier[tier] ??= { input: 0, output: 0 };
    bucketTier.input += input; bucketTier.output += output;
    for (const [role, usage] of Object.entries(event.tokensByRole ?? {})) {
      const roleInput = Number(usage?.input ?? 0); const roleOutput = Number(usage?.output ?? 0);
      const totalRole = totals.tokensByRole[role] ??= { input: 0, output: 0 };
      totalRole.input += roleInput; totalRole.output += roleOutput;
      const bucketRole = current.tokensByRole[role] ??= { input: 0, output: 0 };
      bucketRole.input += roleInput; bucketRole.output += roleOutput;
    }
  }
  if (event.type === 'agent.final') {
    const input = Number(event.tokens?.input ?? event.tokens?.inputTokens ?? 0);
    const output = Number(event.tokens?.output ?? event.tokens?.outputTokens ?? 0);
    current.tokensIn += input; current.tokensOut += output;
    totals.tokensIn += input; totals.tokensOut += output;
    const totalRole = totals.tokensByRole.agent ??= { input: 0, output: 0 };
    totalRole.input += input; totalRole.output += output;
    const bucketRole = current.tokensByRole.agent ??= { input: 0, output: 0 };
    bucketRole.input += input; bucketRole.output += output;
  }
  if (event.type === 'patch.committed' && event.tier === 2) totals.tier2Outcomes.accepted += 1;
  if (event.type === 'halt' && event.reason === 'tier2_timeout') totals.tier2Outcomes.timeout += 1;
  if (event.type === 'halt' && event.reason === 'tier2_unavailable') totals.tier2Outcomes.unavailable += 1;
  if (event.type === 'halt' && event.reason === 'tier2_no_proposal') totals.tier2Outcomes.noProposal += 1;
  if (event.type === 'halt' && event.reason === 'tier2_invalid_output') {
    if (event.details?.detailReason === 'evidence_not_quoted') totals.tier2Outcomes.rejectedQuote += 1;
    else totals.tier2Outcomes.rejectedSchema += 1;
  }
<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
});

export function record() {
  return snapshot();
}

export function snapshot() {
<<<<<<< HEAD
  return { ...totals, tokensByTier: structuredClone(totals.tokensByTier), tokensByRole: structuredClone(totals.tokensByRole), tier2Outcomes: { ...totals.tier2Outcomes }, buckets: buckets.map((item) => ({ ...item, tokensByTier: structuredClone(item.tokensByTier), tokensByRole: structuredClone(item.tokensByRole), healMsSamples: [...item.healMsSamples] })) };
=======
<<<<<<< HEAD
  return { ...totals, tokensByTier: structuredClone(totals.tokensByTier), tokensByRole: structuredClone(totals.tokensByRole), tier2Outcomes: { ...totals.tier2Outcomes }, buckets: buckets.map((item) => ({ ...item, tokensByTier: structuredClone(item.tokensByTier), tokensByRole: structuredClone(item.tokensByRole), healMsSamples: [...item.healMsSamples] })) };
=======
  return { ...totals, buckets: buckets.map((item) => ({ ...item, healMsSamples: [...item.healMsSamples] })) };
>>>>>>> origin/main
>>>>>>> origin/main
}

export function timeseries(window = 300, step = 5) {
  const cutoff = Math.floor(Date.now() / 1000) - window;
  const selected = buckets.filter((item) => item.t >= cutoff);
  const grouped = new Map();
  for (const item of selected) {
    const key = Math.floor(item.t / step) * step;
<<<<<<< HEAD
    const target = grouped.get(key) ?? { t: key, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0 };
    for (const field of ['calls', 'ok', 'healed', 'halted', 'rejected', 'cacheHits', 'tokensIn', 'tokensOut']) target[field] += item[field];
=======
<<<<<<< HEAD
    const target = grouped.get(key) ?? { t: key, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0 };
    for (const field of ['calls', 'ok', 'healed', 'halted', 'rejected', 'cacheHits', 'tokensIn', 'tokensOut']) target[field] += item[field];
=======
    const target = grouped.get(key) ?? { t: key, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0 };
    for (const field of ['calls', 'ok', 'healed', 'halted', 'rejected', 'cacheHits']) target[field] += item[field];
>>>>>>> origin/main
>>>>>>> origin/main
    grouped.set(key, target);
  }
  return [...grouped.values()];
}
