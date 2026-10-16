'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, Check, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageLoading, PageError, EmptyState, Pill } from '@/components/ui';
import { FilterSelect, RecordTable, RecordDrawer, SectionCard, TextFilter } from '@/components/workspace';
import { HashChip } from '@/components/ui';
import { usePolling } from '@/lib/hooks';
import { api } from '@/lib/core';

export default function AuditPage() {
  const audit = usePolling(() => api.auditRecent(200), 7000);
  const [decision, setDecision] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const records = (audit.data?.records ?? []).filter((record) => (decision === 'all' || record.decision === decision) && `${record.apiId} ${record.tool} ${record.decision} ${record.reason ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const runVerify = async () => {
    setVerifying(true); setVerifyError('');
    try { setVerify(await api.auditVerify()); }
    catch (err) { setVerifyError(err.message); }
    finally { setVerifying(false); }
  };
  const exportRecords = async () => {
    setExporting(true); setVerifyError('');
    try {
      const response = await fetch(api.auditExportUrl);
      if (!response.ok) throw new Error(`Export failed with HTTP ${response.status}`);
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'healr-audit.ndjson'; anchor.click(); URL.revokeObjectURL(url);
    } catch (err) { setVerifyError(err.message); }
    finally { setExporting(false); }
  };

  return <>
    <PageHeader title="Audit chain" purpose="Verify the tamper-evident record of fixes, proposals, halts, and rollbacks." actions={<><Button variant="outline" disabled={verifying} onClick={runVerify}><ShieldCheck />{verifying ? 'Verifying…' : 'Verify chain'}</Button><Button disabled={exporting} onClick={exportRecords}><ArrowDownToLine />{exporting ? 'Preparing export…' : 'Export NDJSON'}</Button></>} />
    {verifyError && <div className="page-error" role="alert"><p>{verifyError}</p></div>}
    {verify && <div className={`verify-banner ${verify.ok ? 'verified' : 'broken'}`} role="status">{verify.ok ? <Check /> : <ShieldAlert />}<div><strong>{verify.ok ? 'Chain verified' : `Chain verification failed${verify.brokenAt != null ? ` at block #${verify.brokenAt}` : ''}`}</strong><p>{verify.ok ? `${verify.count} records verified against the hash chain and head anchor.` : verify.reason === 'tail_truncated' ? 'Records were removed from the end of the chain. The stored head anchor does not match.' : 'A record hash or previous-hash link does not match the chain.'}</p></div></div>}
    {audit.loading && !audit.data ? <PageLoading label="Loading audit records" /> : audit.error ? <PageError error={audit.error} onRetry={audit.reload} label="Could not load the audit chain" /> : <>
      <div className="audit-summary-grid"><div><span>Records</span><strong>{audit.data?.count ?? 0}</strong></div><div><span>Head hash</span><strong><HashChip hash={audit.data?.headHash} n={12} /></strong></div><div><span>Current status</span><Pill tone={verify ? verify.ok ? 'ok' : 'bad' : audit.data?.verified ? 'ok' : 'drift'}>{verify ? verify.ok ? 'Verified' : 'Broken' : audit.data?.verified ? 'Verified' : 'Not verified'}</Pill></div></div>
      {(audit.data?.records?.length ?? 0) > 0 ? <>
        <SectionCard title="Chain blocks" detail="The newest 30 loaded records are shown in sequence. Scroll horizontally to inspect hashes.">
          <div className="chain" aria-label="Audit chain blocks">{audit.data.records.slice(-30).map((record, index, list) => <div className="chain-segment" key={record.index}><button type="button" className="block chain-block" data-broken={verify?.brokenAt === record.index} onClick={() => setSelected(record)}><span className="mono">#{record.index}</span><Pill tone={record.decision === 'halt' ? 'halted' : record.decision === 'commit' ? 'healed' : 'dim'}>{record.decision}</Pill><strong>{record.apiId}/{record.tool}</strong><small>{record.hash?.slice(0, 12)}</small></button>{index < list.length - 1 && <span className="chain-link" />}</div>)}</div>
        </SectionCard>
        <SectionCard title="Audit records" detail="Filter decisions and open any record to inspect the signed fields.">
          <div className="filter-bar"><TextFilter value={query} onChange={setQuery} placeholder="Search API, tool, or reason" /><FilterSelect label="Decision" value={decision} onChange={setDecision} options={[{ value: 'all', label: 'All decisions' }, ...['proposed', 'commit', 'halt', 'rollback'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} /></div>
          <RecordTable records={records.slice().reverse()} onSelect={setSelected} />
        </SectionCard>
      </> : <SectionCard title="Audit records" detail="Each verified fix, proposal, halt, and rollback is stored in the chain."><EmptyState icon={ShieldCheck} title="The audit chain is empty">The first heal decision or rollback creates a record here. Try a tool in the playground to generate a decision.</EmptyState><div className="empty-actions"><Button render={<Link href="/playground" />}>Open playground</Button></div></SectionCard>}
    </>}
    <RecordDrawer record={selected} open={!!selected} onClose={() => setSelected(null)} />
  </>;
}
