'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Boxes, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, PageLoading, PageError, EmptyState, Modal } from '@/components/ui';
import { demoRegistration } from '@/lib/demo-registration';
import { api } from '@/lib/core';
import { refreshState, useStore } from '@/lib/store';
import { toolHealth } from '@/lib/derive';

export default function APIsPage() {
  const { apis, calls: callMap, order, bootstrapped, error } = useStore();
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState(() => JSON.stringify(demoRegistration(), null, 2));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const calls = order.map((id) => callMap.get(id)).filter(Boolean);
  const health = toolHealth(apis, calls);

  const registerPayload = async (payload) => {
    setBusy(true); setMessage('');
    try { await api.register(payload); await refreshState(); setOpen(false); }
    catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };
  const register = async (event) => {
    event.preventDefault(); setMessage('');
    let payload;
    try { payload = JSON.parse(json); } catch (err) { setMessage(`Invalid JSON: ${err.message}`); return; }
    if (!payload.apiId || !payload.baseUrl || !Array.isArray(payload.tools) || !payload.tools.length) { setMessage('Registration needs apiId, baseUrl, and at least one tool.'); return; }
    await registerPayload(payload);
  };

  const remove = async () => {
    if (!removeTarget) return;
    setConfirmBusy(true);
    try { await api.remove(removeTarget.apiId); await refreshState(); setRemoveTarget(null); }
    catch (err) { setMessage(err.message); setRemoveTarget(null); }
    finally { setConfirmBusy(false); }
  };

  return <>
    <PageHeader title="APIs" purpose="Manage the upstream services and tool contracts registered with healr." actions={<Button onClick={() => { setMessage(''); setJson(JSON.stringify(demoRegistration(), null, 2)); setOpen(true); }}><Plus />Register API</Button>} />
    {message && <div className="page-error" role="alert"><p>{message}</p></div>}
    {!bootstrapped ? <PageLoading label="Loading registered APIs" /> : error && !apis.length ? <PageError error={{ message: error }} label="Could not load APIs" /> : apis.length === 0 ? <Card><CardContent><EmptyState icon={Boxes} title="No APIs registered">Register your contract to route tool calls through healr. For a working local example, register the demo-users API against the mock service.</EmptyState><div className="empty-actions"><Button disabled={busy} onClick={() => registerPayload(demoRegistration())}>{busy ? 'Registering demo API…' : 'Register demo API'}</Button><Button variant="outline" onClick={() => { setMessage(''); setOpen(true); }}>Use my registration JSON</Button></div></CardContent></Card> : <div className="api-card-list">{apis.map((item) => {
      const tools = item.tools ?? [];
      const detail = tools.map((tool) => health.find((entry) => entry.apiId === item.apiId && entry.tool === tool.name));
      return <Card key={item.apiId} className="api-card">
        <CardHeader className="api-card-head"><div className="api-card-title"><div className="api-symbol"><Boxes size={16} /></div><div className="min-w-0"><CardTitle>{item.apiId}</CardTitle><p className="mono trunc" title={item.baseUrl}>{item.baseUrl}</p></div></div><div className="api-card-actions"><span className="mode-label">Mode: <strong>{item.mode ?? 'enforce'}</strong></span><Button variant="outline" size="sm" onClick={() => setRemoveTarget(item)}><Trash2 />Remove</Button></div></CardHeader>
        <CardContent><div className="table-scroll"><table className="native-table"><thead><tr><th>Tool</th><th>Risk</th><th>Side effects</th><th>Version</th><th>Observed health</th></tr></thead><tbody>{tools.map((tool, index) => {
          const status = detail[index]?.status ?? 'healthy';
          return <tr key={tool.name}><td><Link className="table-link" href={`/apis/${encodeURIComponent(item.apiId)}/tools/${encodeURIComponent(tool.name)}`}>{tool.name}<ArrowUpRight size={13} /></Link></td><td>{tool.risk ?? '—'}</td><td>{tool.sideEffects ?? '—'}</td><td>v{tool.version}</td><td><span className={`health-tag ${status}`}>{status === 'healthy' ? 'No issue observed' : status === 'halted' ? 'Last call halted' : 'Adapter healed'}</span></td></tr>;
        })}</tbody></table></div><p className="api-footnote">Health uses observed calls and adapter history. Core registry status is not treated as a live upstream health check.</p></CardContent>
      </Card>;
    })}</div>}

    <Modal open={open} onClose={() => setOpen(false)} title="Register an API" actions={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy} onClick={register}>{busy ? 'Registering…' : 'Register API'}</Button></>}>
      <p className="dialog-copy">Provide the registration payload used by <code>POST /apis</code>. Credentials should reference environment variables, not contain secret values.</p>
      <Textarea className="json-editor" value={json} onChange={(event) => setJson(event.target.value)} spellCheck="false" aria-label="API registration JSON" />
      {message && <p className="form-error" role="alert">{message}</p>}
      <div className="modal-tools"><Button variant="link" size="sm" onClick={() => setJson(JSON.stringify(demoRegistration(), null, 2))}>Load demo registration</Button><Link href="/settings">Check core and mock connection details <ArrowUpRight size={13} /></Link></div>
    </Modal>

    <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title={`Remove ${removeTarget?.apiId ?? 'API'}?`} actions={<><Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button><Button variant="destructive" disabled={confirmBusy} onClick={remove}>{confirmBusy ? 'Removing…' : 'Remove API'}</Button></>}>
      <p>This removes the API and its registered tools from the core registry. Existing audit records remain in the audit chain.</p>
    </Modal>
  </>;
}
