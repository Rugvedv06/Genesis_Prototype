'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageLoading, PageError, EmptyState, Modal, HashChip } from '@/components/ui';
import { RecordTable, RecordDrawer, FilterSelect, TextFilter, SectionCard } from '@/components/workspace';
import { useAsync, usePolling } from '@/lib/hooks';
import { api } from '@/lib/core';
import { useStore, refreshState } from '@/lib/store';

export default function HealsPage() {
  const audit = usePolling(() => api.auditRecent(200), 7000);
  const { apis } = useStore();
  const [decision, setDecision] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rollbackError, setRollbackError] = useState('');
  const versionKey = (audit.data?.records ?? []).filter((record) => record.apiId && record.tool).map((record) => `${record.apiId}\0${record.tool}`).join('|');
  const versionHistory = useAsync(async () => {
    const keys = [...new Set(versionKey.split('|').filter(Boolean))];
    const entries = await Promise.all(keys.map(async (key) => {
      const [apiId, tool] = key.split('\0');
      return [key, (await api.versions(apiId, tool)).versions ?? []];
    }));
    return Object.fromEntries(entries);
  }, [versionKey]);
  const records = (audit.data?.records ?? []).filter((record) => (decision === 'all' || record.decision === decision) && `${record.apiId} ${record.tool} ${record.reason ?? ''} ${record.decision}`.toLowerCase().includes(query.toLowerCase())).reverse();
  const liveRecordIndexes = new Set();
  const liveKeys = new Set();
  for (const record of records) {
    const key = `${record.apiId}\0${record.tool}`;
    const liveVersion = apis.find((item) => item.apiId === record.apiId)?.tools?.find((item) => item.name === record.tool)?.version;
    if (!liveKeys.has(key) && record.versionAfter != null && record.versionAfter === liveVersion) {
      liveRecordIndexes.add(record.index);
      liveKeys.add(key);
    }
  }
  const decoratedRecords = records.map((record) => {
    const versions = versionHistory.data?.[`${record.apiId}\0${record.tool}`] ?? [];
    const applied = versions.find((version) => version.version === record.versionAfter);
    const targetVersion = versions.find((version) => version.version === record.versionBefore);
    const liveVersion = apis.find((item) => item.apiId === record.apiId)?.tools?.find((item) => item.name === record.tool)?.version;
    return {
      ...record,
      adapterHash: record.adapterHash ?? applied?.adapterHash,
      liveVersion,
      isLive: liveRecordIndexes.has(record.index),
      rollbackTarget: targetVersion && targetVersion.version !== liveVersion ? targetVersion : null,
    };
  });
  const rollback = async () => {
    if (!target?.rollbackTarget) return;
    setBusy(true); setRollbackError('');
    try {
      await api.rollback(target.apiId, target.tool, target.rollbackTarget.version);
      await Promise.all([audit.reload(), versionHistory.reload(), refreshState()]);
      setTarget(null);
    } catch (error) {
      setRollbackError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <PageHeader title="Drift events" purpose="Review the contract changes healr detected, the fixes it proposed, and the calls it stopped safely." actions={<Button variant="outline" render={<Link href="/playground" />}>Trigger a demo change <ArrowUpRight /></Button>} />
    <div className="status-banner"><span className="state-indicator state-live" /><strong>Persistent history</strong><span>Committed fixes, proposals, halts, and rollbacks are loaded from the audit chain.</span></div>
    <SectionCard title="Heal decisions" detail={`${audit.data?.count ?? 0} records in the chain`}>
      {audit.loading && !audit.data ? <PageLoading label="Loading heal history" /> : audit.error ? <PageError error={audit.error} onRetry={audit.reload} label="Could not load heal history" /> : <>
        <div className="filter-bar"><TextFilter value={query} onChange={setQuery} placeholder="Search API, tool, or reason" /><FilterSelect label="Decision" value={decision} onChange={setDecision} options={[{ value: 'all', label: 'All decisions' }, ...['proposed', 'commit', 'halt', 'rollback'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} /></div>
        {decoratedRecords.length ? <RecordTable records={decoratedRecords} onSelect={setSelected} onRollback={setTarget} /> : audit.data.records?.length ? <div className="table-empty">No decisions match these filters.</div> : <EmptyState icon={ShieldAlert} title="No drift events recorded">When healr detects a contract change, the decision and evidence appear here. Try a mutation in the playground to see the workflow.</EmptyState>}
      </>}
    </SectionCard>
    <RecordDrawer record={selected} open={!!selected} onClose={() => setSelected(null)} />
    <Modal open={!!target} onClose={() => { if (!busy) { setTarget(null); setRollbackError(''); } }} title={`Rollback ${target?.apiId ?? ''}/${target?.tool ?? ''}?`} actions={<><Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>Cancel</Button><Button disabled={busy} onClick={rollback}><RotateCcw />{busy ? 'Rolling back…' : 'Approve rollback'}</Button></>}>
      <div className="confirm-copy"><ShieldAlert /><p>This will make v{target?.rollbackTarget?.version ?? '—'} the live adapter by creating a new immutable rollback version. The existing history is preserved.</p><div className="rollback-target"><span>Target version hash</span><HashChip hash={target?.rollbackTarget?.adapterHash} n={16} /></div>{rollbackError && <p className="rollback-error" role="alert">{rollbackError}</p>}</div>
    </Modal>
  </>;
}
