'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageLoading, PageError, EmptyState } from '@/components/ui';
import { RecordTable, RecordDrawer, FilterSelect, TextFilter, SectionCard } from '@/components/workspace';
import { usePolling } from '@/lib/hooks';
import { api } from '@/lib/core';

export default function HealsPage() {
  const audit = usePolling(() => api.auditRecent(200), 7000);
  const [decision, setDecision] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const records = (audit.data?.records ?? []).filter((record) => (decision === 'all' || record.decision === decision) && `${record.apiId} ${record.tool} ${record.reason ?? ''} ${record.decision}`.toLowerCase().includes(query.toLowerCase())).reverse();
  return <>
    <PageHeader title="Drift events" purpose="Review the contract changes healr detected, the fixes it proposed, and the calls it stopped safely." actions={<Button variant="outline" render={<Link href="/playground" />}>Trigger a demo change <ArrowUpRight /></Button>} />
    <div className="status-banner"><span className="state-indicator state-live" /><strong>Persistent history</strong><span>Committed fixes, proposals, halts, and rollbacks are loaded from the audit chain.</span></div>
    <SectionCard title="Heal decisions" detail={`${audit.data?.count ?? 0} records in the chain`}>
      {audit.loading && !audit.data ? <PageLoading label="Loading heal history" /> : audit.error ? <PageError error={audit.error} onRetry={audit.reload} label="Could not load heal history" /> : <>
        <div className="filter-bar"><TextFilter value={query} onChange={setQuery} placeholder="Search API, tool, or reason" /><FilterSelect label="Decision" value={decision} onChange={setDecision} options={[{ value: 'all', label: 'All decisions' }, ...['proposed', 'commit', 'halt', 'rollback'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} /></div>
        {records.length ? <RecordTable records={records} onSelect={setSelected} /> : audit.data.records?.length ? <div className="table-empty">No decisions match these filters.</div> : <EmptyState icon={ShieldAlert} title="No drift events recorded">When healr detects a contract change, the decision and evidence appear here. Try a mutation in the playground to see the workflow.</EmptyState>}
      </>}
    </SectionCard>
    <RecordDrawer record={selected} open={!!selected} onClose={() => setSelected(null)} />
  </>;
}
