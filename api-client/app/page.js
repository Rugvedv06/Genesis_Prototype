'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Check, CircleAlert, Clock3, Layers3, Radio, ShieldCheck, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
<<<<<<< HEAD
import { useStore } from '@/lib/store';
import { EVENT_LABEL, UPSTREAM_CLASSIFICATION_LABEL } from '@/lib/labels';
=======
<<<<<<< HEAD
import { PrinciplesCarousel } from '@/components/PrinciplesCarousel';
import { useStore } from '@/lib/store';
=======

const CORE = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:8000';
>>>>>>> origin/main
>>>>>>> origin/main

function Metric({ label, value, detail, icon: Icon }) {
  return <Card><CardContent className="px-4 py-4"><div className="flex items-center justify-between"><span className="tile-label">{label}</span><Icon size={15} className="text-muted-foreground" aria-hidden /></div><div className="tile-value num">{value}</div><div className="tile-hint">{detail}</div></CardContent></Card>;
}

function PanelTitle({ title, detail, href, linkLabel }) {
  return <CardHeader className="flex w-full min-w-0 flex-row items-center gap-3 border-b px-4 py-3"><div className="min-w-0 flex-1"><CardTitle className="text-[13px] font-semibold">{title}</CardTitle>{detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}</div>{href && <Button className="shrink-0" variant="ghost" size="sm" render={<Link href={href} />}>{linkLabel}<ArrowUpRight /></Button>}</CardHeader>;
}

export default function Home() {
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  const { apis, metrics: storedMetrics, events, conn: connection, bootstrapped, error } = useStore();
  const [provider, setProvider] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let disposed = false;
    const refreshProvider = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:8000'}/provider/health`);
        const nextProvider = await response.json();
        if (!disposed) setProvider(nextProvider);
      } catch { if (!disposed) setProvider({ ok: false, code: 'provider_unavailable' }); }
    };
    refreshProvider();
    const timer = setInterval(refreshProvider, 10000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  useEffect(() => { if (connection === 'live') setUpdatedAt(new Date()); }, [connection, storedMetrics, apis]);
  const metrics = storedMetrics ?? {};
<<<<<<< HEAD
=======
=======
  const [state, setState] = useState(null);
  const [provider, setProvider] = useState(null);
  const [events, setEvents] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let source;
    let disposed = false;
    const refresh = async () => {
      try {
        const [stateResponse, providerResponse] = await Promise.all([
          fetch(`${CORE}/state`), fetch(`${CORE}/provider/health`),
        ]);
        if (!stateResponse.ok || !providerResponse.ok) throw new Error('Core service returned an error');
        const [nextState, nextProvider] = await Promise.all([stateResponse.json(), providerResponse.json()]);
        if (!disposed) { setState(nextState); setProvider(nextProvider); setUpdatedAt(new Date()); }
      } catch { if (!disposed) setConnection('offline'); }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    try {
      source = new EventSource(`${CORE}/events`);
      source.onopen = () => setConnection('live');
      source.onerror = () => setConnection('reconnecting');
      source.onmessage = (message) => {
        try { setEvents((current) => [JSON.parse(message.data), ...current].slice(0, 30)); } catch { /* Ignore malformed frames. */ }
      };
    } catch { setConnection('offline'); }
    return () => { disposed = true; clearInterval(timer); source?.close(); };
  }, []);

  const metrics = state?.metrics ?? {};
  const apis = state?.apis ?? [];
>>>>>>> origin/main
>>>>>>> origin/main
  const successRate = metrics.calls ? `${Math.round((metrics.ok / metrics.calls) * 100)}%` : '—';
  const connectionLabel = { live: 'Streaming', connecting: 'Connecting', reconnecting: 'Reconnecting', offline: 'Core offline' }[connection];
  const healthTone = connection === 'live' ? 'default' : connection === 'offline' ? 'destructive' : 'secondary';

  return <>
    <header className="page-head">
      <div className="grow"><div className="section-label mb-2">CONTROL PLANE / OVERVIEW</div><h1>System overview</h1><p>Monitor API traffic, healing outcomes, and the services your agents depend on.</p></div>
      <div className="flex min-w-0 items-center gap-3"><span className="hidden min-w-0 text-[11px] text-muted-foreground sm:inline">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Waiting for first update'}</span><Button render={<Link href="/playground" />}>Open playground<ArrowUpRight /></Button></div>
    </header>

    <div className="overview-metrics">
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
      <Metric label="API calls" value={bootstrapped ? (metrics.calls ?? 0) : '—'} detail="Persisted calls" icon={Activity} />
      <Metric label="Passed through" value={bootstrapped ? (metrics.ok ?? 0) : '—'} detail={`${successRate} success rate`} icon={Check} />
      <Metric label="Requests healed" value={bootstrapped ? (metrics.healed ?? 0) : '—'} detail="Schema drift corrected" icon={Wrench} />
      <Metric label="Safety halts" value={bootstrapped ? (metrics.halted ?? 0) : '—'} detail="Review required" icon={ShieldCheck} />
    </div>

<<<<<<< HEAD
=======
    <PrinciplesCarousel />

=======
      <Metric label="API calls" value={metrics.calls ?? 0} detail="Since service start" icon={Activity} />
      <Metric label="Passed through" value={metrics.ok ?? 0} detail={`${successRate} success rate`} icon={Check} />
      <Metric label="Requests healed" value={metrics.healed ?? 0} detail="Schema drift corrected" icon={Wrench} />
      <Metric label="Safety halts" value={metrics.halted ?? 0} detail="Review required" icon={ShieldCheck} />
    </div>

>>>>>>> origin/main
>>>>>>> origin/main
    <div className="overview-grid">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="overflow-hidden">
          <PanelTitle title="Registered APIs" detail="Endpoints connected to the healr gateway" href="/apis" linkLabel="Manage APIs" />
          {apis.length ? apis.map((api) => <div className="resource-row" key={api.apiId}>
            <div className="resource-primary"><strong>{api.apiId}</strong><small title={api.baseUrl}>{api.baseUrl}</small></div>
            <Badge variant="secondary" className="gap-1.5 font-normal"><span className="size-1.5 rounded-full bg-[var(--ok)]" />{api.mode ?? 'active'}</Badge>
            <span className="resource-meta">{api.tools?.length ?? 0} tools</span>
<<<<<<< HEAD
          </div>) : !bootstrapped ? <div className="empty"><div className="empty-icon"><Layers3 size={18} /></div><h3>Loading registered APIs</h3><p>Reading the registry from PostgreSQL.</p></div> : error ? <div className="empty"><div className="empty-icon"><CircleAlert size={18} /></div><h3>Could not load registered APIs</h3><p>{error}</p></div> : <div className="empty"><div className="empty-icon"><Layers3 size={18} /></div><h3>No APIs registered</h3><p>Connect an API to start routing calls and detecting schema drift.</p><Button render={<Link href="/apis" />}>Register an API<ArrowUpRight /></Button></div>}
=======
<<<<<<< HEAD
          </div>) : !bootstrapped ? <div className="empty"><div className="empty-icon"><Layers3 size={18} /></div><h3>Loading registered APIs</h3><p>Reading the registry from PostgreSQL.</p></div> : error ? <div className="empty"><div className="empty-icon"><CircleAlert size={18} /></div><h3>Could not load registered APIs</h3><p>{error}</p></div> : <div className="empty"><div className="empty-icon"><Layers3 size={18} /></div><h3>No APIs registered</h3><p>Connect an API to start routing calls and detecting schema drift.</p><Button render={<Link href="/apis" />}>Register an API<ArrowUpRight /></Button></div>}
=======
          </div>) : <div className="empty"><div className="empty-icon"><Layers3 size={18} /></div><h3>No APIs registered</h3><p>Connect an API to start routing calls and detecting schema drift.</p><Button render={<Link href="/apis" />}>Register an API<ArrowUpRight /></Button></div>}
>>>>>>> origin/main
>>>>>>> origin/main
        </Card>

        <Card className="overflow-hidden" id="traffic">
          <PanelTitle title="Recent activity" detail="Live events from the gateway" href="/traffic" linkLabel="View traffic" />
<<<<<<< HEAD
          {events.length ? <div className="feed">{events.slice(0, 30).map((event, index) => <div className="event" key={event.id ?? `${event.ts}-${index}`}><span className="event-dot" /><div className="min-w-0"><strong>{event.classification ? (UPSTREAM_CLASSIFICATION_LABEL[event.classification] ?? event.classification) : (EVENT_LABEL[event.type] ?? event.type ?? 'Gateway event')}</strong><small>{event.tool ?? event.apiId ?? 'system'} · {event.ts ? new Date(event.ts).toLocaleTimeString() : 'just now'}</small>{(event.reason ?? event.code ?? event.status) && <em>{event.reason ?? event.code ?? event.status}</em>}</div></div>)}</div> : <div className="flex items-center gap-3 px-4 py-6 text-xs text-muted-foreground"><Radio size={15} />{connection === 'offline' ? 'Start the core service to receive gateway events.' : 'Waiting for the first gateway event.'}</div>}
=======
<<<<<<< HEAD
          {events.length ? <div className="feed">{events.slice(0, 30).map((event, index) => <div className="event" key={event.id ?? `${event.ts}-${index}`}><span className="event-dot" /><div className="min-w-0"><strong>{event.type ?? 'Gateway event'}</strong><small>{event.tool ?? event.apiId ?? 'system'} · {event.ts ? new Date(event.ts).toLocaleTimeString() : 'just now'}</small>{(event.reason ?? event.code ?? event.status) && <em>{event.reason ?? event.code ?? event.status}</em>}</div></div>)}</div> : <div className="flex items-center gap-3 px-4 py-6 text-xs text-muted-foreground"><Radio size={15} />{connection === 'offline' ? 'Start the core service to receive gateway events.' : 'Waiting for the first gateway event.'}</div>}
=======
          {events.length ? <div className="feed">{events.map((event, index) => <div className="event" key={event.id ?? `${event.ts}-${index}`}><span className="event-dot" /><div className="min-w-0"><strong>{event.type ?? 'Gateway event'}</strong><small>{event.tool ?? event.apiId ?? 'system'} · {event.ts ? new Date(event.ts).toLocaleTimeString() : 'just now'}</small>{(event.reason ?? event.code ?? event.status) && <em>{event.reason ?? event.code ?? event.status}</em>}</div></div>)}</div> : <div className="flex items-center gap-3 px-4 py-6 text-xs text-muted-foreground"><Radio size={15} />{connection === 'offline' ? 'Start the core service to receive gateway events.' : 'Waiting for the first gateway event.'}</div>}
>>>>>>> origin/main
>>>>>>> origin/main
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <PanelTitle title="Service health" detail="Live connection status" />
          <CardContent className="p-0">
<<<<<<< HEAD
            <div className="health-row"><span className={`health-dot ${connection === 'live' ? 'is-live' : connection === 'offline' ? 'is-offline' : 'is-pending'}`} /><div className="health-copy"><div className="text-xs font-medium">Gateway</div><div className="mt-1 text-[11px] text-muted-foreground">{connection === 'offline' ? 'Core service is unavailable' : 'PostgreSQL state and event stream'}</div></div><Badge variant={healthTone}>{connectionLabel}</Badge></div>
=======
<<<<<<< HEAD
            <div className="health-row"><span className={`health-dot ${connection === 'live' ? 'is-live' : connection === 'offline' ? 'is-offline' : 'is-pending'}`} /><div className="health-copy"><div className="text-xs font-medium">Gateway</div><div className="mt-1 text-[11px] text-muted-foreground">{connection === 'offline' ? 'Core service is unavailable' : 'PostgreSQL state and event stream'}</div></div><Badge variant={healthTone}>{connectionLabel}</Badge></div>
=======
            <div className="health-row"><span className={`health-dot ${connection === 'live' ? 'is-live' : connection === 'offline' ? 'is-offline' : 'is-pending'}`} /><div className="health-copy"><div className="text-xs font-medium">Gateway</div><div className="mt-1 text-[11px] text-muted-foreground">{connection === 'offline' ? `Unable to reach ${CORE}` : 'Event stream and state polling'}</div></div><Badge variant={healthTone}>{connectionLabel}</Badge></div>
>>>>>>> origin/main
>>>>>>> origin/main
            <div className="health-row"><span className={`health-dot ${provider?.ok ? 'is-live' : 'is-pending'}`} /><div className="health-copy"><div className="text-xs font-medium">Healing provider</div><div className="mt-1 text-[11px] text-muted-foreground">{provider?.ok ? `${provider.model ?? 'Provider'} is available` : provider?.code ?? 'Checking provider availability'}</div></div><Badge variant={provider?.ok ? 'secondary' : 'outline'}>{provider?.ok ? 'Available' : 'Standby'}</Badge></div>
          </CardContent>
        </Card>

        <Card>
          <PanelTitle title="At a glance" detail="Operational counters" />
          <CardContent className="space-y-0 p-0">
<<<<<<< HEAD
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 size={14} />Registered APIs</span><span className="num text-xs font-medium">{bootstrapped ? apis.length : '—'}</span></div>
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Activity size={14} />Cache hits</span><span className="num text-xs font-medium">{bootstrapped ? (metrics.cacheHits ?? 0) : '—'}</span></div>
=======
<<<<<<< HEAD
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 size={14} />Registered APIs</span><span className="num text-xs font-medium">{bootstrapped ? apis.length : '—'}</span></div>
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Activity size={14} />Cache hits</span><span className="num text-xs font-medium">{bootstrapped ? (metrics.cacheHits ?? 0) : '—'}</span></div>
=======
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 size={14} />Registered APIs</span><span className="num text-xs font-medium">{apis.length}</span></div>
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Activity size={14} />Cache hits</span><span className="num text-xs font-medium">{metrics.cacheHits ?? 0}</span></div>
>>>>>>> origin/main
>>>>>>> origin/main
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 size={14} />Audit chain</span><Button variant="link" size="sm" className="h-auto p-0" render={<Link href="/audit" />}>Inspect chain<ArrowUpRight /></Button></div>
          </CardContent>
        </Card>

<<<<<<< HEAD
        {error && <Card className="border-destructive/40 bg-destructive/5"><CardContent className="flex gap-3 p-4"><CircleAlert size={16} className="mt-0.5 text-destructive" /><div><div className="text-xs font-medium">Could not load PostgreSQL-backed gateway state</div><p className="mb-0 mt-1 text-[11px] text-muted-foreground">{error}</p></div></CardContent></Card>}
=======
<<<<<<< HEAD
        {error && <Card className="border-destructive/40 bg-destructive/5"><CardContent className="flex gap-3 p-4"><CircleAlert size={16} className="mt-0.5 text-destructive" /><div><div className="text-xs font-medium">Could not load PostgreSQL-backed gateway state</div><p className="mb-0 mt-1 text-[11px] text-muted-foreground">{error}</p></div></CardContent></Card>}
=======
        {connection === 'offline' && <Card className="border-destructive/40 bg-destructive/5"><CardContent className="flex gap-3 p-4"><CircleAlert size={16} className="mt-0.5 text-destructive" /><div><div className="text-xs font-medium">Gateway connection unavailable</div><p className="mb-0 mt-1 text-[11px] text-muted-foreground">Check that the core service is running and the client URL is configured correctly.</p></div></CardContent></Card>}
>>>>>>> origin/main
>>>>>>> origin/main
      </div>
    </div>
  </>;
}
