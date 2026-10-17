'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Clock3, Copy, ExternalLink, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Drawer, HashChip, OutcomePill, Pill } from './ui';
import { EVENT_LABEL, haltReason, describeOp, tierLabel } from '../lib/labels';
import { durationMs, timeAgo } from '../lib/derive';

export const stamp = (value) => value ? new Date(value).toLocaleString() : '—';
export const duration = (value) => value == null ? '—' : `${Math.max(0, Math.round(value))} ms`;

export function CallDrawer({ call, open, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!call) return null;
  const events = [...(call.events ?? [])].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const copyId = async () => {
    try { await navigator.clipboard.writeText(call.callId); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* Clipboard access is optional. */ }
  };
  return <Drawer open={open} onClose={onClose} title={`${call.apiId ?? 'Call'} · ${call.tool ?? 'request'}`}>
    <div className="detail-stack">
      <div className="detail-title"><OutcomePill outcome={call.outcome} /><Button variant="outline" size="sm" onClick={copyId}><Copy />{copied ? 'Copied' : 'Copy call ID'}</Button></div>
      <dl className="detail-grid"><dt>Call ID</dt><dd className="mono break-all">{call.callId}</dd><dt>Started</dt><dd>{stamp(call.startedAt)}</dd><dt>Duration</dt><dd>{duration(durationMs(call))}</dd><dt>Adapter version</dt><dd>{call.version ? `v${call.version}` : '—'}</dd><dt>Heal tier</dt><dd>{tierLabel(call.tier)}</dd><dt>Rounds</dt><dd>{call.rounds ?? 0}</dd></dl>
      {call.needsReview && <section className="detail-section"><h3>Needs review</h3><p>This proposal was recorded for operator review and was not committed.</p><ul className="plain-list">{call.reviewOps.map((op, i) => <li key={`${op.op}-${i}`}>{describeOp(op)}</li>)}</ul></section>}
      {call.reason && <div className="reason-box"><strong>Why healr stopped</strong><p>{haltReason(call.reason)}</p><code>{call.reason}</code></div>}
      {call.ops?.length > 0 && <section className="detail-section"><h3><Wrench size={14} />Applied changes</h3><ul className="plain-list">{call.ops.map((op, i) => <li key={`${op.op}-${i}`}>{describeOp(op)}</li>)}</ul></section>}
      {call.proposals?.length > 0 && <section className="detail-section"><h3>Diagnosis evidence</h3>{call.proposals.map((proposal, i) => <div className="proposal" key={i}><div className="proposal-meta">Round {proposal.round ?? i + 1} · {tierLabel(proposal.tier)}{proposal.confidence != null && ` · ${Math.round(proposal.confidence * 100)}% confidence`}</div>{proposal.tier === 2 && <p>{proposal.provider ?? 'gemini'} · {proposal.model ?? 'model unavailable'} · {proposal.usage?.inputTokens ?? 0} in / {proposal.usage?.outputTokens ?? 0} out tokens · {duration(proposal.latencyMs)}</p>}{proposal.evidence?.length > 0 ? <ul className="plain-list">{proposal.evidence.map((item, j) => <li key={j}><strong>{item?.source ?? 'Evidence'}:</strong> {item?.quote ?? (typeof item === 'string' ? item : JSON.stringify(item))}</li>)}</ul> : <p>No evidence was included in this event.</p>}</div>)}</section>}
      <section className="detail-section"><h3><Clock3 size={14} />Call timeline</h3>{events.length ? <ol className="timeline">{events.map((event, i) => <li key={`${event.id ?? i}-${event.ts}`}><strong>{EVENT_LABEL[event.type] ?? 'Gateway activity'}</strong><span>{stamp(event.ts)}</span>{event.reason && <small>{haltReason(event.reason)}</small>}{event.status != null && <small>Upstream status {event.status}{event.ms != null ? ` · ${duration(event.ms)}` : ''}</small>}</li>)}</ol> : <p>Detailed call events are no longer in the live buffer.</p>}</section>
      {call.data !== null && <section className="detail-section"><h3>Response payload</h3><pre className="code">{JSON.stringify(call.data, null, 2)}</pre></section>}
      {call.error && <section className="detail-section"><h3>Call error</h3><pre className="code">{JSON.stringify(call.error, null, 2)}</pre></section>}
      <div className="detail-links"><Link href={`/apis/${encodeURIComponent(call.apiId)}/tools/${encodeURIComponent(call.tool)}`}>Open tool history <ArrowUpRight size={14} /></Link></div>
    </div>
  </Drawer>;
}

export function CallsTable({ calls, onSelect, empty = 'No calls match these filters.' }) {
  if (!calls.length) return <div className="table-empty">{empty}</div>;
  return <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Call</TableHead><TableHead>API / tool</TableHead><TableHead>Outcome</TableHead><TableHead>Version</TableHead><TableHead>Duration</TableHead></TableRow></TableHeader><TableBody>
    {calls.map((call) => <TableRow key={call.callId} className="interactive-row" onClick={() => onSelect(call)}>
      <TableCell><button className="table-link mono" onClick={(event) => { event.stopPropagation(); onSelect(call); }}>{call.callId}</button><div className="table-sub">{timeAgo(call.startedAt)}</div></TableCell>
      <TableCell><strong>{call.apiId}</strong><div className="table-sub">{call.tool}</div></TableCell><TableCell><OutcomePill outcome={call.outcome} /></TableCell><TableCell>{call.version ? `v${call.version}` : '—'}</TableCell><TableCell className="num">{duration(durationMs(call))}</TableCell>
    </TableRow>)}
  </TableBody></Table></div>;
}

export function RecordTable({ records, onSelect, onRollback }) {
  if (!records.length) return <div className="table-empty">No audit records match these filters.</div>;
  return <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Time</TableHead><TableHead>Decision</TableHead><TableHead>API / tool</TableHead><TableHead>Version</TableHead><TableHead>Applied version hash</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>
    {records.map((record) => <TableRow key={record.index} className="interactive-row" onClick={() => onSelect(record)}><TableCell className="mono">{record.index}</TableCell><TableCell>{stamp(record.ts)}</TableCell><TableCell><Pill tone={record.decision === 'halt' ? 'halted' : record.decision === 'commit' ? 'healed' : record.decision === 'proposed' ? 'drift' : 'dim'}>{record.decision}</Pill></TableCell><TableCell><strong>{record.apiId}</strong><div className="table-sub">{record.tool}</div></TableCell><TableCell>{record.versionAfter ? `v${record.versionBefore ?? '—'} → v${record.versionAfter}` : record.versionBefore ? `v${record.versionBefore}` : '—'}</TableCell><TableCell><div className="version-hash-cell"><HashChip hash={record.adapterHash} n={12} />{record.isLive && <Pill tone="live">Live</Pill>}</div></TableCell><TableCell>{record.rollbackTarget && <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); onRollback(record); }}>Rollback</Button>}</TableCell></TableRow>)}
  </TableBody></Table></div>;
}

export function RecordDrawer({ record, open, onClose }) {
  if (!record) return null;
  return <Drawer open={open} onClose={onClose} title={`Audit record #${record.index}`}><div className="detail-stack"><Pill tone={record.decision === 'halt' ? 'halted' : record.decision === 'commit' ? 'healed' : 'drift'}>{record.decision}</Pill>  <dl className="detail-grid"><dt>Timestamp</dt><dd>{stamp(record.ts)}</dd><dt>API / tool</dt><dd>{record.apiId} / {record.tool}</dd><dt>Call ID</dt><dd className="mono break-all">{record.callId ?? record.healId ?? '—'}</dd><dt>Version</dt><dd>{record.versionAfter ? `v${record.versionBefore ?? '—'} → v${record.versionAfter}` : record.versionBefore ? `v${record.versionBefore}` : '—'}</dd><dt>Applied version hash</dt><dd className="mono break-all">{record.adapterHash ?? '—'}</dd><dt>Tier / confidence</dt><dd>{record.tier ?? '—'}{record.confidence != null ? ` / ${Math.round(record.confidence * 100)}%` : ''}</dd><dt>Previous hash</dt><dd className="mono break-all">{record.prevHash ?? 'Genesis'}</dd><dt>Record hash</dt><dd className="mono break-all">{record.hash ?? '—'}</dd></dl>
    {record.reason && <div className="reason-box"><strong>Why healr stopped</strong><p>{haltReason(record.reason)}</p><code>{record.reason}</code></div>}
    {record.ops?.length > 0 && <section className="detail-section"><h3>Recorded changes</h3><ul className="plain-list">{record.ops.map((op, i) => <li key={`${op.op}-${i}`}>{describeOp(op)}</li>)}</ul></section>}
    {record.explanation && <section className="detail-section"><h3>Repair explanation</h3><dl className="detail-grid">
      <dt>Adapter</dt><dd>v{record.explanation.adapter?.beforeVersion ?? '—'} → v{record.explanation.adapter?.afterVersion ?? '—'}</dd>
      <dt>Policy</dt><dd>{record.explanation.policy?.decision ?? '—'}{record.explanation.policy?.mode ? ` · ${record.explanation.policy.mode}` : ''}</dd>
      <dt>Checks</dt><dd>{record.explanation.checks?.filter((check) => check.passed).length ?? 0}/{record.explanation.checks?.length ?? 0} passed</dd>
    </dl>
      {record.explanation.changes?.length > 0 && <><h4>Before / after paths</h4><ul className="plain-list">{record.explanation.changes.map((change, i) => <li key={i}><strong>{change.op}</strong>{change.paths && ` · ${change.paths.before ?? 'new'} → ${change.paths.after ?? 'removed'}`}</li>)}</ul></>}
      {record.explanation.evidenceItems?.length > 0 && <><h4>Evidence and provenance</h4><ul className="plain-list">{record.explanation.evidenceItems.map((item, i) => <li key={i}>{item.pointer ?? item.source ?? item.kind ?? 'evidence'}{item.quote ? `: ${item.quote}` : ''}</li>)}</ul></>}
      {record.explanation.assumptions?.length > 0 && <><h4>Assumptions</h4><ul className="plain-list">{record.explanation.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
    </section>}
    {record.evidence?.length > 0 && <section className="detail-section"><h3>Diagnosis evidence</h3><ul className="plain-list">{record.evidence.map((item, i) => <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul></section>}
    <div className="detail-links"><Link href={`/apis/${encodeURIComponent(record.apiId)}/tools/${encodeURIComponent(record.tool)}`}>Open tool history <ArrowUpRight size={14} /></Link></div><section className="detail-section"><h3>Signed record</h3><pre className="code">{JSON.stringify(record, null, 2)}</pre></section></div></Drawer>;
}

export function SectionCard({ title, detail, action, children }) {
  return <Card className="min-w-0"><CardHeader className="section-card-head"><div className="min-w-0"><CardTitle>{title}</CardTitle>{detail && <p>{detail}</p>}</div>{action}</CardHeader><CardContent className="min-w-0">{children}</CardContent></Card>;
}

export function FilterSelect({ label, value, onChange, options }) {
  return <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function TextFilter({ value, onChange, placeholder = 'Search' }) {
  return <label className="filter-search"><span className="sr-only">{placeholder}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

export function RelativeTime({ value }) {
  return <time dateTime={value ?? undefined} title={stamp(value)}>{timeAgo(value)}</time>;
}

export function RouteLink({ href, children }) {
  return <Link className="text-link" href={href}>{children}<ExternalLink size={13} /></Link>;
}
