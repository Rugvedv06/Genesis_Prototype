const states = new Map();
const failures = new Map();
const negative = new Map();
const WINDOW_MS = 60_000;
const OPEN_MS = 30_000;

function key(apiId, tool) {
  return `${apiId}:${tool}`;
}

export function check(apiId, tool) {
  const state = states.get(key(apiId, tool));
  if (!state) return { ok: true };
  if (state.until > Date.now()) return { ok: false, reason: 'circuit_open', until: state.until };
  states.delete(key(apiId, tool));
  return { ok: true, probe: true };
}

export function recordHalt(apiId, tool) {
  const k = key(apiId, tool);
  const now = Date.now();
  const recent = (failures.get(k) ?? []).filter((ts) => now - ts < WINDOW_MS);
  recent.push(now);
  failures.set(k, recent);
  if (recent.length >= 3) {
    states.set(k, { until: now + OPEN_MS });
    return now + OPEN_MS;
  }
  return null;
}

export function negativeHit(signature) {
  const until = negative.get(signature);
  if (!until) return false;
  if (until <= Date.now()) {
    negative.delete(signature);
    return false;
  }
  return true;
}

export function cacheNegative(signature) {
  negative.set(signature, Date.now() + WINDOW_MS);
}

export function reset() {
  states.clear();
  failures.clear();
  negative.clear();
}

export function snapshot() {
  const now = Date.now();
  return {
    open: [...states.entries()]
      .filter(([, state]) => state.until > now)
      .map(([key, state]) => ({ key, until: state.until })),
    negativeEntries: [...negative.values()].filter((until) => until > now).length,
  };
}
