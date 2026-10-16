// Phase 1 Track C: demo-server event ring buffer + SSE (mirrors core's events bus).
const MAX_EVENTS = 500;
let nextId = 1;
const buffer = [];
const listeners = new Set();

export function emit(event) {
  const e = { id: nextId++, ts: Date.now(), ...event };
  buffer.push(e);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  for (const cb of listeners) cb(e);
  return e;
}

export function since(id) {
  const n = Number(id) ?? 0;
  return buffer.filter((e) => e.id > n);
}

export function on(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clear() {
  buffer.length = 0;
  nextId = 1;
  listeners.clear();
}

export const bus = { emit, since, on, clear };
