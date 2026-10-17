'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { useStore } from '@/lib/store';
import { PageHeader, PageLoading, PageError, EmptyState } from '@/components/ui';
import { CallsTable, CallDrawer, FilterSelect, TextFilter, SectionCard } from '@/components/workspace';

export default function TrafficPage() {
  const { conn, calls: map, order, apis, bootstrapped, error } = useStore();
  const [apiId, setApiId] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get('runId');
    if (runId) setQuery(runId);
  }, []);
  const calls = order.map((id) => map.get(id)).filter(Boolean);
  const filtered = calls.filter((call) => (apiId === 'all' || call.apiId === apiId) && (outcome === 'all' || call.outcome === outcome) && `${call.callId} ${call.runId ?? ''} ${call.apiId} ${call.tool}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageHeader title="Live traffic" purpose="Follow each tool call through the gateway and inspect the exact steps healr took." />
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
    <div className="status-banner"><span className={`state-indicator ${conn === 'live' ? 'state-live' : conn === 'offline' ? 'state-offline' : 'state-pending'}`} /><strong>{conn === 'live' ? 'Event stream connected' : conn === 'offline' ? 'Core service unavailable' : conn === 'reconnecting' ? 'Reconnecting to event stream' : 'Connecting to event stream'}</strong><span>{calls.length} calls loaded from persisted history</span></div>
    {!bootstrapped && <PageLoading label="Connecting to live traffic" />}
    {conn === 'offline' && <PageError label="Live traffic is unavailable" error={{ message: error ?? 'Start healr core to stream and inspect calls.' }} />}
    <SectionCard title="Calls" detail="Persisted gateway events are loaded from PostgreSQL and updated live.">
<<<<<<< HEAD
=======
=======
    <div className="status-banner"><span className={`state-indicator ${conn === 'live' ? 'state-live' : conn === 'offline' ? 'state-offline' : 'state-pending'}`} /><strong>{conn === 'live' ? 'Event stream connected' : conn === 'offline' ? 'Core service unavailable' : conn === 'reconnecting' ? 'Reconnecting to event stream' : 'Connecting to event stream'}</strong><span>{calls.length} calls buffered in this session</span></div>
    {!bootstrapped && <PageLoading label="Connecting to live traffic" />}
    {conn === 'offline' && <PageError label="Live traffic is unavailable" error={{ message: error ?? 'Start healr core to stream and inspect calls.' }} />}
    <SectionCard title="Calls" detail="The event stream is held in memory by core. Older calls may no longer be available after a restart.">
>>>>>>> origin/main
>>>>>>> origin/main
      <div className="filter-bar"><TextFilter value={query} onChange={setQuery} placeholder="Search call, API, or tool" /><FilterSelect label="API" value={apiId} onChange={setApiId} options={[{ value: 'all', label: 'All APIs' }, ...apis.map((item) => ({ value: item.apiId, label: item.apiId }))]} /><FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'all', label: 'All outcomes' }, ...['inflight', 'passthrough', 'healed', 'rejected', 'halted', 'failed', 'cache'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} /></div>
      {!bootstrapped && !calls.length ? null : calls.length ? <CallsTable calls={filtered} onSelect={setSelected} /> : <EmptyState icon={Activity} title="Waiting for the first call">Calls appear here as agents invoke tools through healr.</EmptyState>}
    </SectionCard>
    <CallDrawer call={selected} open={!!selected} onClose={() => setSelected(null)} />
  </>;
}
