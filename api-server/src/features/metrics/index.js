import { on } from '../events/bus.js';

const buckets = [];
const totals = { calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0 };
const MAX_BUCKETS = 3600;

function bucket() {
  const t = Math.floor(Date.now() / 1000);
  let current = buckets.at(-1);
  if (!current || current.t !== t) {
    current = { t, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, healMsSamples: [] };
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
});

export function record() {
  return snapshot();
}

export function snapshot() {
  return { ...totals, buckets: buckets.map((item) => ({ ...item, healMsSamples: [...item.healMsSamples] })) };
}

export function timeseries(window = 300, step = 5) {
  const cutoff = Math.floor(Date.now() / 1000) - window;
  const selected = buckets.filter((item) => item.t >= cutoff);
  const grouped = new Map();
  for (const item of selected) {
    const key = Math.floor(item.t / step) * step;
    const target = grouped.get(key) ?? { t: key, calls: 0, ok: 0, healed: 0, halted: 0, rejected: 0, cacheHits: 0 };
    for (const field of ['calls', 'ok', 'healed', 'halted', 'rejected', 'cacheHits']) target[field] += item[field];
    grouped.set(key, target);
  }
  return [...grouped.values()];
}
