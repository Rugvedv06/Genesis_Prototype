// A "call" is every event sharing a callId, folded into one record.
export function newCall(e) {
  return {
    callId: e.callId, runId: e.runId ?? null, apiId: e.apiId, tool: e.tool,
    startedAt: e.ts, endedAt: null, outcome: 'inflight',
    drift: false, driftKind: null, silent: false, rounds: 0, tier: null,
    proposals: [], ops: [], version: null, cacheHit: false, reason: null, code: null, needsReview: false, reviewOps: [],
    healMs: null, upstream: [], data: null, events: [],
  };
}

export function foldEvent(call, e) {
  const c = { ...call, events: [...call.events, e] };
  switch (e.type) {
    case 'upstream.request': c.upstream = [...c.upstream, { phase: e.phase, status: e.status, ms: e.ms, ts: e.ts }]; break;
    case 'call.failed':
      if (e.code === 'drift') { c.drift = true; c.driftKind = e.kind ?? null; }
      else { c.outcome = e.code === 'upstream_rejected' ? 'rejected' : 'failed'; c.code = e.code; c.endedAt = e.ts; }
      break;
    case 'drift.silent': c.drift = true; c.silent = true; break;
    case 'diagnosis.started': c.rounds = Math.max(c.rounds, e.round ?? 0); break;
    case 'patch.proposed': c.tier = e.tier ?? c.tier; c.proposals = [...c.proposals, { round: e.round, tier: e.tier, ops: e.ops ?? [], confidence: e.confidence, evidence: e.evidence ?? [], provider: e.provider, model: e.model, usage: e.usage, latencyMs: e.latencyMs }]; break;
    case 'patch.committed': c.version = e.version ?? c.version; c.ops = e.ops ?? c.ops; break;
    case 'cache.hit': c.cacheHit = true; break;
    case 'heal.finished': c.healMs = e.ms ?? c.healMs; c.tier = e.tier ?? c.tier; c.rounds = e.rounds ?? c.rounds; break;
    case 'call.succeeded':
      c.outcome = c.cacheHit ? 'cache' : e.healed ? 'healed' : 'passthrough';
      c.version = e.version ?? c.version; c.rounds = e.rounds ?? c.rounds; c.data = e.data ?? null; c.endedAt = e.ts; break;
    case 'halt': c.outcome = 'halted'; c.reason = e.reason; c.needsReview = Boolean(e.details?.needsOperator); c.reviewOps = e.details?.proposal?.ops ?? []; c.endedAt = e.ts; break;
    default: break;
  }
  return c;
}

export const durationMs = (c) => {
  if (!c.endedAt || !c.startedAt) return null;
  const start = typeof c.startedAt === 'number' ? c.startedAt : Date.parse(c.startedAt);
  const end = typeof c.endedAt === 'number' ? c.endedAt : Date.parse(c.endedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
};

// Tool health from calls + registry. /state.status is hardcoded "healthy" (G1), so ignore it.
export function toolHealth(apis, calls) {
  const out = [];
  for (const a of apis) {
    for (const t of a.tools) {
      const mine = calls.filter((c) => c.apiId === a.apiId && c.tool === t.name);
      const last = mine.find((c) => c.outcome !== 'inflight');
      const lastDrift = mine.find((c) => c.drift || c.outcome === 'halted');
      let status = 'healthy';
      if (last?.outcome === 'halted') status = 'halted';
      else if (t.version > 1) status = 'healed';
      out.push({ apiId: a.apiId, tool: t.name, version: t.version, risk: t.risk, sideEffects: t.sideEffects, status, lastDriftAt: lastDrift?.startedAt ?? null, calls: mine.length });
    }
  }
  return out;
}

// /metrics/timeseries is sparse (G3) and ok includes healed (G2).
export function fillSeries(series, windowSec, stepSec, nowSec = Math.floor(Date.now() / 1000)) {
  const end = Math.floor(nowSec / stepSec) * stepSec;
  const byT = new Map(series.map((p) => [Math.floor(p.t / stepSec) * stepSec, p]));
  const out = [];
  for (let t = end - windowSec + stepSec; t <= end; t += stepSec) {
    const p = byT.get(t);
    const healed = p?.healed ?? 0;
    out.push({ t, passthrough: Math.max(0, (p?.ok ?? 0) - healed), healed, rejected: p?.rejected ?? 0, halted: p?.halted ?? 0, calls: p?.calls ?? 0 });
  }
  return out;
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function timeAgo(ts, now = Date.now()) {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
