// Phase 1 Track B: event ring buffer (§4.6, §5.2).
// Last 500 events, monotonically increasing id, replay via since/Last-Event-ID.
const MAX_EVENTS = 500;
let nextId = 1;
const buffer = [];
const listeners = new Set();
const MAX_DURABLE_PENDING = 1000;
let persistEvent;
let persistenceQueue = Promise.resolve();
let persistenceFailure;
let durablePending = 0;
let durableDropped = 0;

export function configureEventPersistence(writer) {
  if (writer !== null && typeof writer !== 'function') throw new TypeError('event persistence writer must be a function or null');
  persistEvent = writer ?? undefined;
  persistenceQueue = Promise.resolve();
  persistenceFailure = undefined;
  durablePending = 0;
  durableDropped = 0;
}

export function durableEventStatus() {
  return { pending: durablePending, dropped: durableDropped };
}

export async function flushDurableEvents() {
  await persistenceQueue;
  if (persistenceFailure) {
    const error = persistenceFailure;
    persistenceFailure = undefined;
    throw error;
  }
}

export function emit(event) {
  const e = { id: nextId++, ts: Date.now(), ...event };
  buffer.push(e);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  for (const cb of listeners) cb(e);
  if (persistEvent && !['call.succeeded', 'call.failed', 'patch.committed', 'registry.rollback', 'api.registered', 'api.removed', 'config.changed'].includes(e.type)) {
    if (durablePending >= MAX_DURABLE_PENDING) {
      durableDropped += 1;
      persistenceFailure ??= Object.assign(new Error('durable_event_queue_full'), { code: 'durable_event_queue_full' });
    } else {
      durablePending += 1;
      persistenceQueue = persistenceQueue.then(() => persistEvent(e))
        .catch((error) => { persistenceFailure ??= error; })
        .finally(() => { durablePending -= 1; });
    }
  }
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
}

export function size() {
  return buffer.length;
}

export const bus = { emit, since, on, clear, size, configureEventPersistence, flushDurableEvents, durableEventStatus };
