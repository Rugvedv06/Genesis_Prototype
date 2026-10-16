// IDs are durable across process restarts and unique across concurrent workers.
import { randomUUID } from 'node:crypto';

export function newId(prefix = 'x') {
  if (typeof prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(prefix)) throw new TypeError('ID prefix is invalid');
  return `${prefix}_${randomUUID()}`;
}

// Kept for source compatibility; UUID generation has no process-local state.
export function resetIds() {}
