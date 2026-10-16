'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Database, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/core';
import { PageHeader, PageError, PageLoading, StatTile, EmptyState } from '@/components/ui';
import { StackedBars, Legend } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const number = (value) => Number(value ?? 0).toLocaleString();
const time = (value) => value ? new Date(value * 1000).toLocaleTimeString() : '—';

function TracePage({ trace, loading, error, onNext }) {
  if (loading) return <PageLoading label="Loading durable trace" />;
  if (error) return <PageError error={error} label="Could not load trace" />;
  if (!trace) return <EmptyState icon={Activity} title="No trace selected">Enter a call ID to read its persisted event trace.</EmptyState>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={trace.complete ? 'default' : 'secondary'}>{trace.complete ? 'Complete trace' : 'Incomplete trace'}</Badge>
      {!trace.complete && <span className="text-xs text-muted-foreground">{trace.incompleteReason ?? 'Trace page is incomplete'}</span>}
      <span className="ml-auto text-xs text-muted-foreground">Cursor {trace.cursor ?? '0'}{trace.retentionFloor != null ? ` · retention floor ${trace.retentionFloor}` : ''}</span>
    </div>
    {trace.spans?.length ? <ol className="space-y-2">
      {trace.spans.map((span, index) => <li key={`${span.type}-${span.round ?? ''}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
        <strong>{span.type}</strong><span className="text-muted-foreground">{span.round ? `Round ${span.round} · ` : ''}{span.tier ?? ''}{span.status != null ? ` · HTTP ${span.status}` : ''}</span>
        <span className="num text-muted-foreground">+{number(span.startOffsetMs)} ms</span>
      </li>)}
    </ol> : <p className="text-xs text-muted-foreground">No retained spans in this page.</p>}
    {trace.nextCursor != null && <div className="flex justify-end"><Button size="sm" onClick={onNext}>Load next page <span aria-hidden>→</span></Button></div>}
  </div>;
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState(null);
  const [series, setSeries] = useState([]);
  const [cache, setCache] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [callId, setCallId] = useState('');
  const [trace, setTrace] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, timeSeries, cachePage] = await Promise.all([api.metrics(), api.series(3600, 60), api.cache()]);
      setMetrics(snapshot);
      setSeries(timeSeries.series ?? []);
      setCache(cachePage);
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadTrace = async (cursor = 0) => {
    if (!callId.trim()) return;
    setTraceLoading(true);
    setTraceError(null);
    try { setTrace(await api.trace(callId.trim(), { cursor, limit: 100 })); }
    catch (err) { setTrace(null); setTraceError(err); }
    finally { setTraceLoading(false); }
  };

  const refreshCache = async (cursor) => {
    try {
      const next = await api.cache({ limit: 100, cursor });
      setCache((previous) => cursor && previous
        ? { ...next, candidates: [...previous.candidates, ...next.candidates] }
        : next);
    }
    catch (err) { setError(err); }
  };
  const invalidateCandidate = async (cacheKey) => {
    try { await api.invalidateCacheKey(cacheKey); await refreshCache(); }
    catch (err) { setError(err); }
  };
  const clearCandidates = async () => {
    if (!window.confirm('Invalidate all verified patch candidates for this workspace?')) return;
    try { await api.clearCache(); await refreshCache(); }
    catch (err) { setError(err); }
  };

  const barData = series.map((point) => ({ ...point, passthrough: Math.max(0, (point.ok ?? 0) - (point.healed ?? 0)) }));
  const tiers = metrics?.tierCounts ?? {};
  return <>
    <PageHeader title="Metrics & traces" purpose="Inspect PostgreSQL-backed aggregate metrics and page through durable call traces." actions={<Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw />Refresh metrics</Button>} />

    {error && <PageError error={error} onRetry={refresh} label="Could not load durable metrics" />}
    {loading && !metrics ? <PageLoading label="Loading PostgreSQL metrics" /> : <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Persisted calls" value={number(metrics?.calls)} hint={`${number(metrics?.running)} running`} icon={Activity} />
        <StatTile label="Healed" value={number(metrics?.healed)} hint={`${number(metrics?.cacheHits)} cache hits`} />
        <StatTile label="Average duration" value={metrics?.averageDurationMs == null ? '—' : `${Math.round(metrics.averageDurationMs)} ms`} hint={`p50 ${Math.round(metrics?.p50LatencyMs ?? 0)} ms · p95 ${Math.round(metrics?.p95LatencyMs ?? 0)} ms`} />
        <StatTile label="Tokens in / out" value={`${number(metrics?.tokensIn)} / ${number(metrics?.tokensOut)}`} hint={`${number(metrics?.rounds)} total diagnosis rounds`} />
      </div>

      <Card className="mt-4">
        <CardHeader className="border-b border-border"><CardTitle className="text-[13px]">Persisted request outcomes</CardTitle><p className="text-[11px] text-muted-foreground">Last hour · one-minute buckets from the metrics time-series API</p></CardHeader>
        <CardContent className="space-y-3 pt-4">
          {barData.length ? <><StackedBars data={barData} /><Legend /></> : <p className="py-5 text-center text-xs text-muted-foreground">No persisted calls in the selected window.</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground"><span>{number(metrics?.halted)} halted</span><span>{number(metrics?.rejected)} rejected</span><span>{number(metrics?.failed)} failed</span><span>Tier T0/T1/T2: {number(tiers.T0)}/{number(tiers.T1)}/{number(tiers.T2)}</span></div>
          {series.length > 0 && <p className="mb-0 text-[10px] text-muted-foreground">Bucket range: {time(series[0].t)}–{time(series.at(-1).t)} · {series.length} populated buckets</p>}
        </CardContent>
      </Card>
    </>}

    <Card className="mt-4">
      <CardHeader className="border-b border-border"><CardTitle className="text-[13px]">Durable call trace</CardTitle><p className="text-[11px] text-muted-foreground">Trace pages report completeness and retention gaps from persisted event truth.</p></CardHeader>
      <CardContent className="space-y-4 pt-4">
        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); loadTrace(0); }}>
          <label className="sr-only" htmlFor="trace-call-id">Call ID</label><input id="trace-call-id" className="min-w-0 grow rounded-md border border-border bg-background px-3 py-2 text-xs" value={callId} onChange={(event) => setCallId(event.target.value)} placeholder="Paste a call ID" />
          <Button type="submit" size="sm" disabled={traceLoading || !callId.trim()}><Search />Load trace</Button>
        </form>
        <TracePage trace={trace} loading={traceLoading} error={traceError} onNext={() => loadTrace(Number(trace?.nextCursor))} />
      </CardContent>
    </Card>

    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center gap-3 border-b border-border">
        <div className="min-w-0 grow"><CardTitle className="text-[13px]">Verified patch cache</CardTitle><p className="text-[11px] text-muted-foreground">PostgreSQL is authoritative; Redis is a bounded mirror.</p></div>
        {cache?.mirror && <Badge variant={cache.mirror.ready ? 'default' : 'secondary'}>{cache.mirror.ready ? 'Redis ready' : cache.mirror.configured ? 'Redis degraded' : 'Redis disabled'}</Badge>}
        <Button variant="destructive" size="sm" onClick={clearCandidates} disabled={!cache}><Trash2 />Clear verified</Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {cache?.candidates?.length ? <div className="space-y-2">{cache.candidates.map((candidate) => <div key={candidate.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
          <Database size={14} className="text-muted-foreground" aria-hidden />
          <strong>{candidate.source_api_id}/{candidate.source_tool_name}</strong>
          <span className="text-muted-foreground">v{candidate.source_version} · {candidate.scope} · used {candidate.use_count}×</span>
          <code className="ml-auto text-[10px] text-muted-foreground">{candidate.cache_key?.slice(0, 12)}…</code>
          <Badge variant={candidate.state === 'verified' ? 'secondary' : 'outline'}>{candidate.state}</Badge>
          {candidate.state === 'verified' && <Button variant="ghost" size="sm" onClick={() => invalidateCandidate(candidate.cache_key)} aria-label={`Invalidate candidate ${candidate.cache_key}`}><Trash2 />Invalidate</Button>}
        </div>)}</div> : <p className="py-4 text-center text-xs text-muted-foreground">No patch candidates in this workspace.</p>}
        {cache?.nextCursor && <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => refreshCache(cache.nextCursor)}>Load next candidates <span aria-hidden>→</span></Button></div>}
      </CardContent>
    </Card>
  </>;
}
