'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Boxes, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, PageLoading, PageError, EmptyState, Modal } from '@/components/ui';
import { demoRegistration } from '@/lib/demo-registration';
import { api } from '@/lib/core';
import { refreshState, useStore } from '@/lib/store';
import { toolHealth } from '@/lib/derive';
import { toast } from 'sonner';

export default function APIsPage() {
  const router = useRouter();
  const { apis, calls: callMap, order, bootstrapped, error } = useStore();
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState(() => JSON.stringify(demoRegistration(), null, 2));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [registrationTab, setRegistrationTab] = useState('manual');
  const [importSource, setImportSource] = useState('url');
  const [specUrl, setSpecUrl] = useState('');
  const [specText, setSpecText] = useState('');
  const [preview, setPreview] = useState(null);
  const [selectedTools, setSelectedTools] = useState([]);
  const [identitySuggestions, setIdentitySuggestions] = useState([]);
  const [importApiId, setImportApiId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [credentialHeader, setCredentialHeader] = useState('');
  const [credentialEnv, setCredentialEnv] = useState('');
  const calls = order.map((id) => callMap.get(id)).filter(Boolean);
  const health = toolHealth(apis, calls);

  const registerPayload = async (payload) => {
    setBusy(true); setMessage('');
    try {
      await api.register(payload);
      await refreshState(); setOpen(false); toast.success(`Registered ${payload.apiId}`);
      if (payload.tools?.[0]?.name) router.push(`/apis/${encodeURIComponent(payload.apiId)}/tools/${encodeURIComponent(payload.tools[0].name)}`);
    }
    catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };
  const resetRegistration = () => {
    setMessage(''); setJson(JSON.stringify(demoRegistration(), null, 2)); setRegistrationTab('manual');
    setImportSource('url'); setSpecUrl(''); setSpecText(''); setPreview(null); setSelectedTools([]); setIdentitySuggestions([]);
    setImportApiId(''); setBaseUrl(''); setCredentialHeader(''); setCredentialEnv('');
  };
  const loadPreview = async () => {
    setBusy(true); setMessage(''); setPreview(null);
    try {
      const result = await api.previewOpenApi(importSource === 'url' ? { url: specUrl } : { spec: specText });
      setPreview(result); setSelectedTools(result.tools.map((tool) => tool.name)); setIdentitySuggestions([]);
      setBaseUrl(result.baseUrlSuggestion ?? '');
      setImportApiId(String(result.title ?? 'imported-api').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };
  const registerImported = async () => {
    const tools = (preview?.tools ?? []).filter((tool) => selectedTools.includes(tool.name)).map(({ identitySuggestion, ...tool }) => ({ ...tool, ...(identitySuggestion && identitySuggestions.includes(tool.name) ? { identity: identitySuggestion } : {}) }));
    if (!importApiId.trim() || !baseUrl.trim() || !tools.length) { setMessage('Enter an API id and base URL, and select at least one operation.'); return; }
    let credentials;
    if (credentialHeader.trim() || credentialEnv.trim()) {
      if (!credentialHeader.trim() || !credentialEnv.trim()) { setMessage('Complete both credential mapping fields or leave them blank.'); return; }
      credentials = { [credentialHeader.trim()]: { env: credentialEnv.trim() } };
    }
    await registerPayload({ apiId: importApiId.trim(), baseUrl: baseUrl.trim(), ...(preview.sourceUrl ? { specUrl: preview.sourceUrl } : {}), ...(credentials ? { credentials } : {}), tools });
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
    <PageHeader title="APIs" purpose="Manage the upstream services and tool contracts registered with healr." actions={<Button onClick={() => { resetRegistration(); setOpen(true); }}><Plus />Register API</Button>} />
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

    <Modal open={open} onClose={() => setOpen(false)} title="Register an API" actions={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>{registrationTab === 'manual' ? <Button disabled={busy} onClick={register}>{busy ? 'Registering…' : 'Register API'}</Button> : preview && <Button disabled={busy} onClick={registerImported}>{busy ? 'Registering…' : 'Register reviewed API'}</Button>}</>}>
      <div className="segmented-tabs" role="tablist" aria-label="Registration method">
        <button type="button" role="tab" aria-selected={registrationTab === 'manual'} className={registrationTab === 'manual' ? 'selected' : ''} onClick={() => { setRegistrationTab('manual'); setMessage(''); }}>Manual JSON</button>
        <button type="button" role="tab" aria-selected={registrationTab === 'import'} className={registrationTab === 'import' ? 'selected' : ''} onClick={() => { setRegistrationTab('import'); setMessage(''); }}>Import OpenAPI</button>
      </div>
      {registrationTab === 'manual' ? <>
        <p className="dialog-copy">Provide the registration payload used by <code>POST /apis</code>. Credentials should reference environment variables, not contain secret values.</p>
        <Textarea className="json-editor" value={json} onChange={(event) => setJson(event.target.value)} spellCheck="false" aria-label="API registration JSON" />
        <div className="modal-tools"><Button variant="link" size="sm" onClick={() => setJson(JSON.stringify(demoRegistration(), null, 2))}>Load demo registration</Button><Link href="/settings">Check core and mock connection details <ArrowUpRight size={13} /></Link></div>
      </> : <div className="space-y-3">
        {!preview ? <>
          <p className="dialog-copy">Preview a JSON OpenAPI 3.0 or 3.1 document. Preview does not register or change any tools.</p>
          <div className="segmented-tabs" role="tablist" aria-label="OpenAPI source"><button type="button" role="tab" aria-selected={importSource === 'url'} className={importSource === 'url' ? 'selected' : ''} onClick={() => setImportSource('url')}>URL</button><button type="button" role="tab" aria-selected={importSource === 'paste'} className={importSource === 'paste' ? 'selected' : ''} onClick={() => setImportSource('paste')}>Paste JSON</button></div>
          {importSource === 'url' ? <label className="form-field"><span>OpenAPI URL</span><input className="field-control" type="url" value={specUrl} onChange={(event) => setSpecUrl(event.target.value)} placeholder="https://api.example.com/openapi.json" /></label> : <Textarea className="json-editor" value={specText} onChange={(event) => setSpecText(event.target.value)} spellCheck="false" aria-label="OpenAPI JSON document" />}
          <Button disabled={busy || (importSource === 'url' ? !specUrl.trim() : !specText.trim())} onClick={loadPreview}>{busy ? 'Loading preview…' : 'Preview OpenAPI'}</Button>
        </> : <>
          <p className="dialog-copy">Review the selected operations, base URL and API id before registering.</p>
          <div className="grid gap-3 sm:grid-cols-2"><label className="form-field"><span>API id</span><input className="field-control" value={importApiId} onChange={(event) => setImportApiId(event.target.value)} /></label><label className="form-field"><span>Base URL <strong aria-hidden="true">*</strong></span><input className="field-control" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label></div>
          <div className="table-scroll max-h-64 overflow-auto"><table className="native-table"><thead><tr><th>Import</th><th>Operation</th><th>Risk</th><th>Side effects</th></tr></thead><tbody>{preview.tools.map((tool) => <tr key={tool.name}><td><input type="checkbox" checked={selectedTools.includes(tool.name)} aria-label={`Import ${tool.name}`} onChange={(event) => setSelectedTools((current) => event.target.checked ? [...current, tool.name] : current.filter((name) => name !== tool.name))} /></td><td><strong>{tool.name}</strong><br /><span className="faint mono">{tool.method} {tool.path}</span>{tool.identitySuggestion && <label className="mt-1 flex items-center gap-1 text-xs"><input type="checkbox" checked={identitySuggestions.includes(tool.name)} aria-label={`Use suggested identity mapping for ${tool.name}`} onChange={(event) => setIdentitySuggestions((current) => event.target.checked ? [...current, tool.name] : current.filter((name) => name !== tool.name))} />Suggestion: identity {Object.entries(tool.identitySuggestion).map(([from, to]) => `${from} → ${to}`).join(', ')}</label>}</td><td><select className="field-control" value={tool.risk} onChange={(event) => setPreview((current) => ({ ...current, tools: current.tools.map((item) => item.name === tool.name ? { ...item, risk: event.target.value } : item) }))}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></td><td><select className="field-control" value={tool.sideEffects} onChange={(event) => setPreview((current) => ({ ...current, tools: current.tools.map((item) => item.name === tool.name ? { ...item, sideEffects: event.target.value } : item) }))}><option value="none">none</option><option value="write">write</option></select></td></tr>)}</tbody></table></div>
          {preview.warnings.map((warning) => <p className="faint" key={warning} role="status">Warning: {warning}</p>)}
          {preview.skipped.length > 0 && <details><summary>{preview.skipped.length} skipped operations</summary><ul>{preview.skipped.map((item, index) => <li key={`${item.method}:${item.path}:${index}`}><code>{item.method} {item.path}</code>: {item.reason}</li>)}</ul></details>}
          <div className="grid gap-3 sm:grid-cols-2"><label className="form-field"><span>Credential header (optional)</span><input className="field-control" value={credentialHeader} onChange={(event) => setCredentialHeader(event.target.value)} placeholder="X-Tenant" /></label><label className="form-field"><span>Environment variable name</span><input className="field-control" value={credentialEnv} onChange={(event) => setCredentialEnv(event.target.value)} placeholder="TENANT_ID" /></label></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setPreview(null)}>Back to source</Button><span className="faint">{preview.title} · {preview.tools.length} supported operations</span></div>
        </>}
      </div>}
      {message && <p className="form-error" role="alert">{message}</p>}
    </Modal>

    <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title={`Remove ${removeTarget?.apiId ?? 'API'}?`} actions={<><Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button><Button variant="destructive" disabled={confirmBusy} onClick={remove}>{confirmBusy ? 'Removing…' : 'Remove API'}</Button></>}>
      <p>This removes the API and its registered tools from the core registry. Existing audit records remain in the audit chain.</p>
    </Modal>
  </>;
}
