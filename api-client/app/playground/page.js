'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Play, RotateCcw, TriangleAlert, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, PageLoading, EmptyState, Field, Modal, OutcomePill } from '@/components/ui';
import { SectionCard } from '@/components/workspace';
import { useStore, refreshState } from '@/lib/store';
import { api, mock, MOCK } from '@/lib/core';
import { useAsync } from '@/lib/hooks';
import { haltReason } from '@/lib/labels';

function exampleArgs(tool) {
  const schema = tool?.parameters ?? tool?.meta?.logicalSchema;
  if (!schema?.properties) return '{}';
  const values = Object.entries(schema.properties).map(([key, value]) => {
    const sample = key === 'user_id' ? '111' : key === 'email' ? 'dev@example.com' : value.type === 'number' || value.type === 'integer' ? 1 : value.type === 'boolean' ? true : value.type === 'object' ? {} : value.type === 'array' ? [] : 'example';
    return [key, sample];
  });
  return JSON.stringify(Object.fromEntries(values), null, 2);
}

export default function PlaygroundPage() {
  const { apis, bootstrapped } = useStore();
  const [apiId, setApiId] = useState('');
  const [toolName, setToolName] = useState('');
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState(null);
  const [lastRunId, setLastRunId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [mutationBusy, setMutationBusy] = useState('');
  const selectedApi = apis.find((item) => item.apiId === apiId) ?? apis[0];
  const selectedTool = selectedApi?.tools?.find((item) => item.name === toolName) ?? selectedApi?.tools?.[0];
  const isDemo = selectedApi?.baseUrl === MOCK;
  const mutations = useAsync(() => isDemo ? mock.mutations() : Promise.resolve({ mutations: [] }), [isDemo]);

  useEffect(() => {
    if (!apis.length) { setApiId(''); setToolName(''); return; }
    if (!apis.some((item) => item.apiId === apiId)) setApiId(apis[0].apiId);
  }, [apis, apiId]);
  useEffect(() => {
    const apiEntry = apis.find((item) => item.apiId === apiId);
    if (!apiEntry?.tools?.some((tool) => tool.name === toolName)) {
      const firstTool = apiEntry?.tools?.[0];
      setToolName(firstTool?.name ?? '');
      setArgs(exampleArgs(firstTool)); setResult(null);
    }
  }, [apis, apiId, toolName]);

  const invoke = async () => {
    setError(''); setResult(null);
    let parsed;
    try { parsed = JSON.parse(args); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Arguments must be a JSON object.'); }
    catch (err) { setError(err.message); return; }
    setBusy(true);
    const runId = `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setLastRunId(runId);
    try { setResult(await api.invoke(selectedApi.apiId, selectedTool.name, parsed, runId)); await refreshState(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); setConfirmWrite(false); }
  };
  const submit = () => {
    if (selectedTool?.sideEffects === 'write' || selectedTool?.sideEffects === 'external') setConfirmWrite(true);
    else invoke();
  };
  const applyMutation = async (id) => {
    setMutationBusy(id || 'reset');
    try { if (id) await mock.mutate(id); else await mock.reset(); toast.success(id ? `Demo mutation ${id} enabled` : 'Demo mock reset'); }
    catch (err) { toast.error(err.message); }
    finally { setMutationBusy(''); mutations.reload(); setConfirmReset(false); }
  };

  return <>
    <PageHeader title="Playground" purpose="Invoke a registered tool with your own arguments and inspect the response healr produces." />
    {!bootstrapped ? <PageLoading label="Loading registered tools" /> : !apis.length ? <Card><CardContent><EmptyState title="Register an API to get started" action={<Button render={<Link href="/apis" />}>Open API registry <ArrowUpRight /></Button>}>The playground runs calls through the same gateway your agents use.</EmptyState></CardContent></Card> : <div className="playground-grid">
      <SectionCard title="Invoke a tool" detail="Requests go through healr core and reach the configured upstream.">
        <div className="playground-form">
          <Field label="API"><select className="field-control" value={selectedApi?.apiId ?? ''} onChange={(event) => { setApiId(event.target.value); setToolName(''); setResult(null); }} aria-label="Select API">{apis.map((item) => <option key={item.apiId} value={item.apiId}>{item.apiId}</option>)}</select></Field>
          <Field label="Tool"><select className="field-control" value={selectedTool?.name ?? ''} onChange={(event) => { const next = selectedApi.tools.find((tool) => tool.name === event.target.value); setToolName(event.target.value); setArgs(exampleArgs(next)); setResult(null); }} aria-label="Select tool">{(selectedApi?.tools ?? []).map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select></Field>
          {selectedTool?.sideEffects && <div className="tool-effect"><span>Side effects</span><strong>{selectedTool.sideEffects}</strong>{selectedTool.risk && <span>Risk: {selectedTool.risk}</span>}</div>}
          <Field label="Arguments" hint="Enter a JSON object that matches the registered tool schema."><Textarea className="json-editor args-editor" value={args} onChange={(event) => setArgs(event.target.value)} spellCheck="false" aria-label="Tool arguments JSON" /></Field>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button disabled={busy || !selectedTool} onClick={submit}><Play />{busy ? 'Calling tool…' : 'Send request'}</Button>
        </div>
        {result && <div className="invoke-result"><div className="result-heading"><h3>Result</h3><OutcomePill outcome={result.ok ? result.meta?.cacheHit ? 'cache' : result.meta?.healed ? 'healed' : 'passthrough' : result.error?.code === 'upstream_rejected' ? 'rejected' : result.error?.details?.reason ? 'halted' : 'failed'} />{result.meta?.version && <span>Adapter v{result.meta.version}</span>}</div>
          {result.ok ? <><pre className="code">{JSON.stringify(result.data, null, 2)}</pre><dl className="detail-grid"><dt>Healed</dt><dd>{result.meta?.healed ? 'Yes' : 'No'}</dd><dt>Rounds</dt><dd>{result.meta?.rounds ?? 0}</dd><dt>Tier</dt><dd>{result.meta?.tier ?? '—'}</dd><dt>Latency</dt><dd>{result.meta?.latencyMs != null ? `${result.meta.latencyMs} ms` : '—'}</dd></dl></> : <><p className="reason-box">{result.error?.details?.reason ? haltReason(result.error.details.reason) : result.error?.message ?? result.error?.code ?? 'The call failed.'}</p><pre className="code">{JSON.stringify(result.error, null, 2)}</pre></>}
          {lastRunId && <p className="quiet-note">Run ID: <code>{lastRunId}</code> · <Link href={`/traffic?runId=${encodeURIComponent(lastRunId)}`}>Open in live traffic <ArrowUpRight size={12} /></Link></p>}
        </div>}
      </SectionCard>

      <SectionCard title="Demo mock controls" detail="These controls change only the local demo mock service, not your registered production API.">
        {!isDemo ? <EmptyState icon={Wrench} title="Select the demo API">Mutation controls are available when the selected API uses the configured demo mock URL.</EmptyState> : mutations.loading && !mutations.data ? <PageLoading label="Loading available demo mutations" /> : mutations.error ? <div className="mock-offline"><TriangleAlert /><strong>Demo mock is unavailable</strong><p>{mutations.error.message}. Start the demo server to use mutation controls.</p></div> : <>
          <div className="mutation-list">{(mutations.data?.mutations ?? []).map((mutation) => <div className="mutation-row" key={mutation.id}><div><strong>{mutation.id}</strong><p>{mutation.label}</p><small>{typeof mutation.route === 'string' ? mutation.route : mutation.route ? `${mutation.route.method ?? 'GET'} ${mutation.route.path ?? ''}` : 'Route unavailable'}</small></div><span className={`health-tag ${mutation.expected === 'halt' ? 'halted' : 'healed'}`}>Expected: {mutation.expected}</span><Button size="sm" variant="outline" disabled={!!mutationBusy} onClick={() => applyMutation(mutation.id)}>{mutationBusy === mutation.id ? 'Applying…' : 'Apply'}</Button></div>)}</div>
          <div className="mock-reset"><Button variant="outline" disabled={!!mutationBusy} onClick={() => setConfirmReset(true)}><RotateCcw />{mutationBusy === 'reset' ? 'Resetting…' : 'Reset mock'}</Button><p>After changing the mock, send a request above to see healr respond.</p></div>
        </>}
      </SectionCard>
    </div>}
    <Modal open={confirmWrite} onClose={() => setConfirmWrite(false)} title="Run a tool with side effects?" actions={<><Button variant="outline" onClick={() => setConfirmWrite(false)}>Cancel</Button><Button disabled={busy} onClick={invoke}>{busy ? 'Calling…' : 'Run request'}</Button></>}>
      <p>This tool is marked as <strong>{selectedTool?.sideEffects}</strong> and may change data in its upstream service. Review the arguments before continuing.</p><pre className="code">{args}</pre>
    </Modal>
    <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset the demo mock?" actions={<><Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="destructive" disabled={!!mutationBusy} onClick={() => applyMutation('')}>{mutationBusy === 'reset' ? 'Resetting…' : 'Reset demo mock'}</Button></>}>
      <p>This clears the active mutation and resets demo mock write history. It does not change registered API settings or upstream services.</p>
    </Modal>
  </>;
}
