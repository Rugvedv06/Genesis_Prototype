"use client";

import { useEffect, useState } from 'react';

const CORE = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:8000';

function Metric({ label, value, tone = '' }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

export default function Home() {
  const [state, setState] = useState(null);
  const [events, setEvents] = useState([]);
  const [connection, setConnection] = useState('connecting');

  useEffect(() => {
    let source;
    fetch(`${CORE}/state`).then((response) => response.json()).then(setState).catch(() => setConnection('offline'));
    try {
      source = new EventSource(`${CORE}/events`);
      source.onopen = () => setConnection('live');
      source.onerror = () => setConnection('reconnecting');
      source.onmessage = (message) => setEvents((current) => [JSON.parse(message.data), ...current].slice(0, 30));
    } catch {
      setConnection('offline');
    }
    return () => source?.close();
  }, []);

  const metrics = state?.metrics ?? {};
  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand"><span className="brand-mark">H</span><span>healr</span></div>
        <nav><a className="active" href="/">Overview</a><a href="#traffic">Live traffic</a><a href="#apis">APIs</a><a href="#heals">Heals</a><a href="#audit">Audit chain</a><a href="#settings">Settings</a></nav>
        <div className={`connection ${connection}`}><i /> {connection}</div>
      </aside>
      <section className="content">
        <header className="topbar"><div><p className="eyebrow">CONTROL PLANE / OVERVIEW</p><h1>Operational health</h1></div><span className="timestamp">Live · {new Date().toLocaleTimeString()}</span></header>
        <div className="metrics">
          <Metric label="Calls" value={metrics.calls ?? 0} />
          <Metric label="Successful" value={metrics.ok ?? 0} tone="good" />
          <Metric label="Healed" value={metrics.healed ?? 0} tone="accent" />
          <Metric label="Halted" value={metrics.halted ?? 0} tone="bad" />
        </div>
        <div className="grid">
          <section className="card wide" id="apis"><div className="card-heading"><h2>Registered APIs</h2><span>{state?.apis?.length ?? 0} connected</span></div>
            {state?.apis?.length ? state.apis.map((api) => <div className="api-row" key={api.apiId}><div><strong>{api.apiId}</strong><small>{api.baseUrl}</small></div><span className="status"><i /> {api.mode}</span><b>{api.tools.length} tools</b></div>) : <div className="empty">Register an API to see traffic and healing health.</div>}
          </section>
          <section className="card" id="heals"><div className="card-heading"><h2>Event stream</h2><span className="mono">{events.length} recent</span></div>
            <div className="feed">{events.length ? events.map((event) => <div className="event" key={event.id}><span className="event-dot" /><div><strong>{event.type}</strong><small>{event.tool ?? event.apiId ?? 'system'} · {new Date(event.ts).toLocaleTimeString()}</small></div></div>) : <div className="empty">Waiting for gateway events…</div>}</div>
          </section>
        </div>
      </section>
    </main>
  );
}
