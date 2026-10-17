<<<<<<< HEAD
// IDs are durable across process restarts and unique across concurrent workers.
import { randomUUID } from 'node:crypto';

export function newId(prefix = 'x') {
  if (typeof prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(prefix)) throw new TypeError('ID prefix is invalid');
  return `${prefix}_${randomUUID()}`;
}

// Kept for source compatibility; UUID generation has no process-local state.
export function resetIds() {}
=======
<<<<<<< HEAD
// IDs are durable across process restarts and unique across concurrent workers.
import { randomUUID } from 'node:crypto';

export function newId(prefix = 'x') {
  if (typeof prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(prefix)) throw new TypeError('ID prefix is invalid');
  return `${prefix}_${randomUUID()}`;
}

// Kept for source compatibility; UUID generation has no process-local state.
export function resetIds() {}
=======
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
>>>>>>> origin/main
>>>>>>> origin/main
