'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, GitCompareArrows, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, PageLoading, PageError, Modal, Pill, OpChip } from '@/components/ui';
import { CodeBlock } from '@/components/ui';
import { SectionCard, stamp } from '@/components/workspace';
import { api } from '@/lib/core';
import { useAsync } from '@/lib/hooks';
import { useStore, refreshState } from '@/lib/store';
import { describeOp } from '@/lib/labels';

export default function ToolDetailPage() {
  const params = useParams();
  const apiId = params.apiId;
  const toolName = params.tool;
  const { apis, bootstrapped } = useStore();
  const currentApi = apis.find((item) => item.apiId === apiId);
  const currentTool = currentApi?.tools?.find((item) => item.name === toolName);
  const history = useAsync(() => api.versions(apiId, toolName), [apiId, toolName]);
  const [diff, setDiff] = useState(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adapterTab, setAdapterTab] = useState('request');
  const versions = history.data?.versions ?? [];
  const currentVersion = versions.find((version) => version.version === currentTool?.version) ?? versions.at(-1);
  const selectedAdapter = currentVersion?.adapter ?? {};
  const adapterValue = adapterTab === 'request' ? selectedAdapter.request : adapterTab === 'response' ? selectedAdapter.response : currentVersion?.meta?.logicalSchema;

  const loadDiff = async (version) => {
    if (!version.parent) return;
    setDiffBusy(true); setError('');
    try { const result = await api.diff(apiId, toolName, version.parent, version.version); setDiff({ version: version.version, ...result }); }
    catch (err) { setError(err.message); }
    finally { setDiffBusy(false); }
  };
  const rollback = async () => {
    if (!target) return;
    setBusy(true); setError('');
    try { await api.rollback(apiId, toolName, target.version); await refreshState(); await history.reload(); setTarget(null); }
    catch (err) { setError(err.message); setTarget(null); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader title={`${apiId} / ${toolName}`} purpose="Inspect the adapter versions applied to this tool and compare or restore a previous version." actions={<Button variant="outline" onClick={history.reload}><RotateCcw />Refresh history</Button>} />
    {error && <div className="page-error" role="alert"><p>{error}</p></div>}
    {!bootstrapped || history.loading && !history.data ? <PageLoading label="Loading tool history" /> : history.error ? <PageError error={history.error} onRetry={history.reload} label="Could not load tool history" /> : !currentTool ? <PageError label="Tool is not registered" error={{ message: `No current registry entry was found for ${apiId}/${toolName}. Return to APIs and choose a registered tool.` }} /> : <>
      <div className="tool-summary-grid"><Card><CardContent><span className="summary-label">Current version</span><strong>v{currentTool.version}</strong><small>Changes create a new version. Rollback never deletes history.</small></CardContent></Card><Card><CardContent><span className="summary-label">Risk / side effects</span><strong>{currentVersion?.meta?.risk ?? currentTool.risk ?? 'Unspecified'}</strong><small>{currentVersion?.meta?.sideEffects ?? 'Side effects not supplied'}</small></CardContent></Card><Card><CardContent><span className="summary-label">Upstream operation</span><strong className="mono">{currentVersion?.meta?.method ?? 'POST'} {currentVersion?.meta?.path ?? 'Path unavailable'}</strong><small>{currentApi?.baseUrl ?? 'API endpoint unavailable'}</small></CardContent></Card></div>

      <div className="tool-detail-grid">
        <SectionCard title="Version history" detail={`${versions.length} immutable ${versions.length === 1 ? 'version' : 'versions'} recorded`}>
          {versions.length <= 1 && <p className="quiet-note">No drift has touched this tool. A new version appears after a fix is verified and committed.</p>}
          <ol className="version-list">{[...versions].reverse().map((version) => <li className="version-item" key={version.version}><span className="version-marker" /><div className="version-body"><div className="version-heading"><strong>v{version.version}</strong><Pill tone={version.origin === 'rollback' ? 'halted' : version.origin === 'heal' ? 'healed' : 'dim'}>{version.origin ?? 'register'}</Pill>{version.version === currentTool.version && <Pill tone="live">Current</Pill>}</div><time>{stamp(version.createdAt)}</time>{version.rollbackOf && <p>Restored adapter from v{version.rollbackOf}. This rollback is recorded as a new version.</p>}{version.change && <div className="version-change"><div className="version-meta">{version.change.tier ? `Tier ${version.change.tier}` : 'Adapter update'}{version.change.confidence != null ? ` · ${Math.round(version.change.confidence * 100)}% confidence` : ''}{version.change.latencyMs != null ? ` · ${version.change.latencyMs} ms` : ''}</div>{version.change.ops?.length ? <ul>{version.change.ops.map((op, index) => <li key={`${op.op}-${index}`}><OpChip op={op} /><span>{describeOp(op)}</span></li>)}</ul> : <p>Version changed without recorded operation details.</p>}</div>}
            <div className="version-actions">{version.parent && <Button variant="outline" size="sm" disabled={diffBusy} onClick={() => loadDiff(version)}><GitCompareArrows />{diff?.version === version.version ? 'Refresh diff' : 'View diff'}</Button>}{version.version !== currentTool.version && <Button variant="outline" size="sm" onClick={() => setTarget(version)}><ArrowDownLeft />Restore this version</Button>}</div>
            {diff?.version === version.version && <div className="diff-panel"><h4>v{version.parent} → v{version.version}</h4><div className="diff-columns"><div><strong>Added</strong>{diff.added?.length ? diff.added.map((op, i) => <p key={i} className="diff-added">+ {describeOp(op)}</p>) : <p className="quiet-note">No request operations added.</p>}</div><div><strong>Removed</strong>{diff.removed?.length ? diff.removed.map((op, i) => <p key={i} className="diff-removed">− {describeOp(op)}</p>) : <p className="quiet-note">No request operations removed.</p>}</div></div></div>}
          </div></li>)}</ol>
        </SectionCard>

        <SectionCard title="Current adapter" detail="The active request/response mapping and logical input contract.">
          <div className="segmented-tabs" role="tablist" aria-label="Adapter sections">{[['request', 'Request'], ['response', 'Response'], ['schema', 'Input schema']].map(([value, label]) => <button key={value} role="tab" aria-selected={adapterTab === value} className={adapterTab === value ? 'selected' : ''} onClick={() => setAdapterTab(value)}>{label}</button>)}</div>
          {adapterValue ? <CodeBlock value={adapterValue} label={`${adapterTab} adapter JSON`} /> : <p className="quiet-note">No {adapterTab} mapping is recorded for this version.</p>}
          <div className="adapter-hash"><span>Adapter hash</span><code className="mono break-all">{currentVersion?.adapterHash ?? 'Not available'}</code></div>
        </SectionCard>
      </div>
    </>}
    <Modal open={!!target} onClose={() => setTarget(null)} title={`Restore adapter from v${target?.version ?? ''}?`} actions={<><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button><Button disabled={busy} onClick={rollback}>{busy ? 'Restoring…' : 'Create rollback version'}</Button></>}>
      <div className="confirm-copy"><ShieldAlert /><p>This creates a new version that restores v{target?.version}’s adapter. Existing history remains intact. If the upstream contract still has drift, later calls may detect it again.</p></div>
    </Modal>
  </>;
}
