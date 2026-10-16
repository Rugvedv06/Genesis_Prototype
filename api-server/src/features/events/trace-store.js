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

export function traceFromEvents(callId, events, { cursor = 0, hasMore = false, nextCursor = null } = {}) {
  if (!events.length) return null;
  const first = events.find((event) => event.type === 'call.started');
  const start = Number(first?.ts ?? Date.now());
  const terminal = events.some((event) => ['call.succeeded', 'call.failed'].includes(event.type));
  const orderedSequences = events.map((event) => event.sequenceInCall).filter(Number.isSafeInteger).sort((a, b) => a - b);
  const firstSequence = orderedSequences[0];
  const sequenceGap = (Number.isSafeInteger(firstSequence) && firstSequence > cursor)
    || orderedSequences.some((sequence, index) => sequence !== firstSequence + index);
  const spans = events
    .filter((event) => ['upstream.request', 'diagnosis.started', 'diagnosis.finished', 'patch.proposed', 'patch.verified', 'patch.committed', 'halt', 'call.succeeded', 'call.failed'].includes(event.type))
    .map((event) => ({
      type: event.type, round: event.round, tier: event.tier, ms: event.ms, status: event.status,
      startOffsetMs: Math.max(0, Number(event.ts ?? start) - start),
    }));
  const retentionBoundary = cursor === 0 && Number.isSafeInteger(firstSequence) && firstSequence > 0;
  const complete = Boolean(cursor === 0 && first && terminal && !sequenceGap && !hasMore && !retentionBoundary);
  const incompleteReason = retentionBoundary || (cursor > 0 && Number.isSafeInteger(firstSequence) && firstSequence > cursor)
    ? 'retention_boundary'
    : sequenceGap ? 'event_sequence_gap'
      : hasMore ? 'page_truncated'
        : cursor > 0 ? 'page_continues'
          : !first ? 'start_event_missing'
            : !terminal ? 'terminal_event_missing' : undefined;
  return {
    callId,
    startedAt: start,
    updatedAt: Number(events.at(-1)?.ts ?? start),
    spans,
    complete,
    incomplete: !complete,
    cursor: String(cursor),
    nextCursor,
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

export function clear() {
  traces.clear();
}

on(addSpan);
