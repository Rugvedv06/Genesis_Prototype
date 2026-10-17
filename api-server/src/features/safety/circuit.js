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
  const cached = negative.get(signature);
  if (!cached) return false;
  if (cached.until <= Date.now()) {
    negative.delete(signature);
    return false;
  }
  return true;
}

export function negativeResult(signature) {
  const cached = negative.get(signature);
  return cached && cached.until > Date.now() ? cached.result : null;
}

export function cacheNegative(signature, result = { reason: 'unfixable_contract' }) {
  negative.set(signature, { until: Date.now() + WINDOW_MS, result: structuredClone(result) });
}

export function clearNegativeForApi(apiId) {
  const prefix = `${apiId}:`;
  for (const signature of negative.keys()) {
    if (signature.startsWith(prefix)) negative.delete(signature);
  }
}

// The database-backed executor uses the async interface so callers can later
// move this state to a shared store without changing their control flow. Keep
// the current in-process cache behavior consistent with the sync interface.
export async function negativeHitAsync(signature) {
  return negativeHit(signature);
}

export async function negativeResultAsync(signature) {
  return negativeResult(signature);
}

export async function cacheNegativeAsync(signature, result) {
  return cacheNegative(signature, result);
}

export async function clearNegativeForApiAsync(apiId) {
  return clearNegativeForApi(apiId);
}

export async function recordHaltAsync(apiId, tool) {
  return recordHalt(apiId, tool);
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
    negativeEntries: [...negative.values()].filter(({ until }) => until > now).length,
  };
}
