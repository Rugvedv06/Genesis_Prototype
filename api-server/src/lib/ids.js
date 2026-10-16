// Phase 0: id generators (callId, runId, event id, ...)
const counters = new Map();
let processNonce = Math.floor(Math.random() * 1e6);

export function newId(prefix = 'x', len = 6) {
  const n = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, n);
  return `${prefix}_${processNonce}${String(n).padStart(len, '0')}`;
}

export function resetIds() {
  counters.clear();
  processNonce = (processNonce + 1) % 1e6;
}
