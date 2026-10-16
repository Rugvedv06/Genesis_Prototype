'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { api, CORE } from './core';
import { connectSSE } from './sse';
import { newCall, foldEvent } from './derive';

const MAX_EVENTS = 2000;
const MAX_CALLS = 1000;
const REFRESH_ON = new Set(['api.registered', 'api.removed', 'patch.committed', 'registry.rollback', 'config.changed', 'audit.appended']);

const s = {
  conn: 'connecting',          // connecting | live | reconnecting | offline
  bootstrapped: false,
  error: null,
  lastId: '0',
  events: [],                  // newest first
  calls: new Map(),            // callId -> call
  order: [],                   // callIds, newest first
  apis: [], metrics: null, audit: null, cache: null, circuit: [],
};
let snapshot = { ...s };
const listeners = new Set();
let pending = [];
let flushTimer = null;
let refreshTimer = null;
let started = false;
let sseStarted = false;

function decimalCursor(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : '0';
  return typeof value === 'string' && /^\d{1,19}$/.test(value) ? value : '0';
}

function newerCursor(left, right) {
  try { return BigInt(decimalCursor(right)) > BigInt(decimalCursor(left)) ? decimalCursor(right) : decimalCursor(left); }
  catch { return decimalCursor(left); }
}

const publish = () => { snapshot = { ...s }; listeners.forEach((l) => l()); };

function flush() {
  flushTimer = null;
  if (!pending.length) return;
  const batch = pending; pending = [];
  let needRefresh = false;
  for (const e of batch) {
    s.lastId = newerCursor(s.lastId, e.id);
    if (REFRESH_ON.has(e.type)) needRefresh = true;
    if (e.callId) {
      const prev = s.calls.get(e.callId);
      if (!prev) { s.order.unshift(e.callId); if (s.order.length > MAX_CALLS) s.calls.delete(s.order.pop()); }
      s.calls.set(e.callId, foldEvent(prev ?? newCall(e), e));
    }
  }
  s.events = [...batch.reverse(), ...s.events].slice(0, MAX_EVENTS);
  publish();
  if (needRefresh) scheduleRefresh(400);
}

async function refresh(includeHistory = false) {
  try {
    const [st, history] = await Promise.all([
      api.state(),
      sseStarted && !includeHistory ? Promise.resolve(null) : api.recentEvents(),
    ]);
    Object.assign(s, { apis: st.apis ?? [], metrics: st.metrics ?? null, audit: st.audit ?? null, cache: st.cache ?? null, circuit: st.circuit ?? [], bootstrapped: true, error: null });
    if (history) {
      const calls = new Map();
      const order = [];
      for (const event of history.events ?? []) {
        if (!event.callId) continue;
        const previous = calls.get(event.callId);
        if (!previous) order.push(event.callId);
        calls.set(event.callId, foldEvent(previous ?? newCall(event), event));
      }
      order.reverse();
      while (order.length > MAX_CALLS) calls.delete(order.pop());
      s.calls = calls;
      s.order = order;
      s.events = [...(history.events ?? [])].reverse().slice(0, MAX_EVENTS);
      s.lastId = decimalCursor(history.lastEventId);
    }
    if (s.conn === 'offline') s.conn = 'reconnecting';
  } catch (err) {
    s.error = err.message; s.conn = 'offline'; s.bootstrapped = true;
  }
  publish();
}
function scheduleRefresh(ms) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, ms); }

export function startStore() {
  if (started || typeof window === 'undefined') return;
  started = true;
  setInterval(refresh, 5000);
  refresh().finally(() => {
    if (sseStarted) return;
    sseStarted = true;
    connectSSE({
      url: `${CORE}/events`,
      getLastId: () => s.lastId,
      onOpen: () => { s.conn = 'live'; publish(); },
      onError: () => { if (s.conn !== 'offline') s.conn = 'reconnecting'; publish(); },
      onEvent: (e) => { pending.push(e); if (!flushTimer) flushTimer = setTimeout(flush, 120); },
      onReset: (_data, eventId) => { s.lastId = decimalCursor(eventId); pending = []; refresh(true); },
    });
  });
}

export function useStore() {
  useEffect(() => { startStore(); }, []);
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => snapshot,
    () => snapshot,
  );
}
export const refreshState = () => refresh();
