const states = new Map();
const failures = new Map();
const negative = new Map();
const WINDOW_MS = 60_000;
const OPEN_MS = 30_000;
<<<<<<< HEAD
const MAX_LOCAL_SAFETY_KEYS = 1000;
import { readRedisCircuitOpenUntil, recordRedisCircuitFailure, readRedisState, writeRedisState, deleteRedisState, redisMirrorStatus } from '../patch-cache/redis-mirror.js';
=======
<<<<<<< HEAD
const MAX_LOCAL_SAFETY_KEYS = 1000;
import { readRedisCircuitOpenUntil, recordRedisCircuitFailure, readRedisState, writeRedisState, deleteRedisState, redisMirrorStatus } from '../patch-cache/redis-mirror.js';
=======
>>>>>>> origin/main
>>>>>>> origin/main

function key(apiId, tool) {
  return `${apiId}:${tool}`;
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
function boundMap(map) {
  while (map.size > MAX_LOCAL_SAFETY_KEYS) map.delete(map.keys().next().value);
}

<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
export function check(apiId, tool) {
  const state = states.get(key(apiId, tool));
  if (!state) return { ok: true };
  if (state.until > Date.now()) return { ok: false, reason: 'circuit_open', until: state.until };
  states.delete(key(apiId, tool));
  return { ok: true, probe: true };
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
export async function checkAsync(apiId, tool) {
  if (process.env.REDIS_URL) {
    const until = await readRedisCircuitOpenUntil(key(apiId, tool));
    if (until) {
      const k = key(apiId, tool);
      states.set(k, { until: Math.max(until, states.get(k)?.until ?? 0) });
      boundMap(states);
      return { ok: false, reason: 'circuit_open', until };
    }
    const redis = redisMirrorStatus();
    if (!redis.ready || redis.degraded) return { ok: false, reason: 'circuit_state_unavailable' };
  }
  return check(apiId, tool);
}

<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
export function recordHalt(apiId, tool) {
  const k = key(apiId, tool);
  const now = Date.now();
  const recent = (failures.get(k) ?? []).filter((ts) => now - ts < WINDOW_MS);
  recent.push(now);
  failures.set(k, recent);
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  boundMap(failures);
  if (recent.length >= 3) {
    states.set(k, { until: now + OPEN_MS });
    boundMap(states);
<<<<<<< HEAD
=======
=======
  if (recent.length >= 3) {
    states.set(k, { until: now + OPEN_MS });
>>>>>>> origin/main
>>>>>>> origin/main
    return now + OPEN_MS;
  }
  return null;
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
export async function recordHaltAsync(apiId, tool) {
  if (process.env.REDIS_URL) {
    const until = await recordRedisCircuitFailure(key(apiId, tool), Date.now(), WINDOW_MS, OPEN_MS);
    if (until) {
      const k = key(apiId, tool);
      states.set(k, { until: Math.max(until, states.get(k)?.until ?? 0) });
      boundMap(states);
      return until;
    }
  }
  return recordHalt(apiId, tool);
}

<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
export function negativeHit(signature) {
  const cached = negative.get(signature);
  if (!cached) return false;
  if (cached.until <= Date.now()) {
    negative.delete(signature);
    return false;
  }
  return true;
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
export async function negativeResultAsync(signature) {
  if (process.env.REDIS_URL) {
    const cached = await readRedisState('negative', signature);
    if (cached && typeof cached.until === 'number' && cached.until > Date.now()) return cached.result ?? null;
  }
  return negativeResult(signature);
}

export async function negativeHitAsync(signature) {
  return (await negativeResultAsync(signature)) !== null;
}

<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
export function negativeResult(signature) {
  const cached = negative.get(signature);
  return cached && cached.until > Date.now() ? cached.result : null;
}

export function cacheNegative(signature, result = { reason: 'unfixable_contract' }) {
  negative.set(signature, { until: Date.now() + WINDOW_MS, result: structuredClone(result) });
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  boundMap(negative);
}

export async function cacheNegativeAsync(signature, result = { reason: 'unfixable_contract' }) {
  cacheNegative(signature, result);
  if (!process.env.REDIS_URL) return;
  const safe = {
    reason: typeof result?.reason === 'string' && /^[a-z0-9_-]{1,80}$/i.test(result.reason) ? result.reason : 'cached_halt',
    details: Object.fromEntries(Object.entries(result?.details ?? {}).filter(([field, value]) =>
      ['kind', 'reason', 'code', 'ref', 'field'].includes(field) && typeof value === 'string' && value.length <= 160
      && !/(password|secret|token|authorization|cookie)/i.test(value))),
  };
  await writeRedisState('negative', signature, { until: Date.now() + WINDOW_MS, result: safe }, Math.ceil(WINDOW_MS / 1000));
<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
}

export function clearNegativeForApi(apiId) {
  const prefix = `${apiId}:`;
  for (const signature of negative.keys()) {
    if (signature.startsWith(prefix)) negative.delete(signature);
  }
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
export async function clearNegativeForApiAsync(apiId) {
  clearNegativeForApi(apiId);
  // Keys are one-way hashed, so old Redis entries expire naturally. Revisions in
  // each invocation fingerprint make them unreachable after API changes.
  void deleteRedisState('negative-api-marker', apiId).catch(() => {});
}

<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
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
