import { on } from './bus.js';

const MAX_TRACES = 200;
const traces = new Map();

function traceFor(callId) {
  let trace = traces.get(callId);
  if (!trace) {
    trace = { callId, spans: [], updatedAt: Date.now() };
    traces.set(callId, trace);
    while (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value);
  }
  return trace;
}

function addSpan(event) {
  if (!event.callId) return;
  const trace = traceFor(event.callId);
  trace.updatedAt = Date.now();
  const start = event._traceStart ?? trace.startedAt ?? trace.updatedAt;
  trace.startedAt ??= start;
  if (event.type === 'call.started') {
    trace.startedAt = event.ts;
    return;
  }
  if (!['upstream.request', 'diagnosis.started', 'diagnosis.finished', 'patch.proposed', 'patch.verified', 'patch.committed', 'halt', 'call.succeeded', 'call.failed'].includes(event.type)) return;
  trace.spans.push({
    type: event.type,
    round: event.round,
    tier: event.tier,
    ms: event.ms,
    status: event.status,
    startOffsetMs: Math.max(0, event.ts - trace.startedAt),
  });
}

export function get(callId) {
  const trace = traces.get(callId);
  return trace ? structuredClone(trace) : null;
}

export function clear() {
  traces.clear();
}

on(addSpan);
