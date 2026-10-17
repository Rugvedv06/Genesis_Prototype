'use client';

import { useEffect, useState } from 'react';
import { Activity, Check, RefreshCw, Save, Server, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageLoading, PageError, Field } from '@/components/ui';
import { SectionCard } from '@/components/workspace';
import { useStore } from '@/lib/store';
import { api, CORE, MOCK } from '@/lib/core';
import { useAsync } from '@/lib/hooks';

function PolicySwitch({ checked, onChange, label }) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className="policy-switch"
    data-checked={checked ? '' : undefined}
    onClick={() => onChange(!checked)}
  ><span className="policy-switch-thumb" /></button>;
}

export default function SettingsPage() {
  const { apis, conn, lastId, events } = useStore();
  const [apiId, setApiId] = useState('');
  const configState = useAsync(() => apiId ? api.apiDetail(apiId) : Promise.resolve(null), [apiId]);
  const provider = useAsync(() => api.providerHealth(), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const current = configState.data?.config?.healing ?? {};

  useEffect(() => { if (apis.length && !apis.some((item) => item.apiId === apiId)) setApiId(apis[0].apiId); }, [apis, apiId]);
  useEffect(() => {
    if (configState.data) setForm({ enabled: current.enabled ?? true, confidenceThreshold: current.confidenceThreshold ?? 0.85, maxRounds: current.maxRounds ?? 5, tier2: current.tier2 ?? false, mode: current.mode ?? 'enforce' });
  }, [configState.data, apiId]);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const save = async (event) => {
    event.preventDefault(); if (!form || !apiId) return;
    setSaving(true); setSaveError(''); setMessage('');
    try {
      await api.patchConfig(apiId, { healing: { ...current, ...form } });
      await configState.reload(); setMessage(`Healing policy saved for ${apiId}.`);
    } catch (err) { setSaveError(err.message); }
    finally { setSaving(false); }
  };

  return <>
    <PageHeader title="Settings" purpose="Check service connectivity and tune the healing policy for a registered API." />
    <div className="settings-grid">
      <SectionCard title="Connections" detail="Client endpoints are supplied by environment variables and are read-only here.">
        <div className="connection-list"><div><span><Server size={15} />Core API</span><code title={CORE}>{CORE}</code><b className={`connection-state ${conn}`}>{conn}</b></div><div><span><Activity size={15} />Demo mock</span><code title={MOCK}>{MOCK}</code><b>Configured</b></div><div><span><Activity size={15} />Event stream</span><code>Last event ID: {lastId}</code><b>{events.length} events buffered</b></div></div>
      </SectionCard>

      <SectionCard title="Gemini provider" detail="Provider credentials stay on the core server and are never shown in this client.">
        {provider.loading && !provider.data ? <PageLoading label="Checking provider health" /> : provider.error ? <PageError error={provider.error} onRetry={provider.reload} label="Provider health could not be checked" /> : <div className="space-y-4">
          {['agent', 'diagnoser'].map((role) => { const status = provider.data?.roles?.[role]; return <div className="provider-status" key={role}><span className={`state-indicator ${status?.ok ? 'state-live' : 'state-offline'}`} /><div><strong>{role === 'agent' ? 'Agent' : 'Tier 2 diagnoser'}: {status?.ok ? 'available' : 'unavailable'}</strong><p>{status?.ok ? `Gemini · ${status.model ?? 'configured'}` : status?.code === 'missing_api_key' ? 'Configure GEMINI_API_KEYS in the core environment.' : status?.message ?? status?.code ?? 'Provider unavailable.'}</p></div></div>; })}
          {provider.data?.keyPool && <div className="text-xs"><strong>Gemini key pool</strong><p>{provider.data.keyPool.size} configured · {provider.data.keyPool.healthy} healthy</p><div className="flex flex-wrap gap-2">{provider.data.keyPool.slots?.map((slot) => <span className="rounded border px-2 py-1" key={slot.slot}>Slot {slot.slot + 1}: {slot.state}</span>)}</div></div>}
          {!provider.data?.roles?.agent?.ok || !provider.data?.roles?.diagnoser?.ok ? <p className="text-xs text-muted-foreground">Tier 2 is unavailable. Deterministic Tier 0 and Tier 1 healing remain available.</p> : null}
          <Button variant="outline" size="sm" onClick={provider.reload}><RefreshCw />Refresh</Button>
        </div>}
      </SectionCard>

      <SectionCard title="Healing policy" detail="Settings apply to one API. Existing values are preserved when you save.">
        {!apis.length ? <p className="quiet-note">Register an API before changing its healing policy.</p> : <>
          <Field label="API"><select className="field-control" value={apiId} onChange={(event) => { setApiId(event.target.value); setForm(null); setMessage(''); }} aria-label="Select API configuration">{apis.map((item) => <option key={item.apiId} value={item.apiId}>{item.apiId}</option>)}</select></Field>
          {configState.loading && !configState.data ? <PageLoading label="Loading API configuration" /> : configState.error ? <PageError error={configState.error} onRetry={configState.reload} label="Could not load API configuration" /> : form && <form className="policy-form" onSubmit={save}>
            <div className="switch-field"><span><strong>Healing enabled</strong><small>Allow healr to diagnose contract drift and propose a safe adapter update.</small></span><PolicySwitch checked={!!form.enabled} onChange={(value) => update('enabled', value)} label="Healing enabled" /></div>
            <Field label="Healing mode" hint="Enforce applies verified fixes. Log records proposals without applying them. Off prevents healing."><select className="field-control" value={form.mode} onChange={(event) => update('mode', event.target.value)}><option value="enforce">Enforce</option><option value="log">Log only</option><option value="off">Off</option></select></Field>
            <div className="policy-columns"><Field label="Confidence threshold" hint="Minimum confidence required to apply a fix."><input className="field-control" type="number" min="0" max="1" step="0.01" value={form.confidenceThreshold} onChange={(event) => update('confidenceThreshold', Number(event.target.value))} /></Field><Field label="Maximum heal rounds" hint="Upper bound on diagnosis/replay attempts per call."><input className="field-control" type="number" min="1" max="20" step="1" value={form.maxRounds} onChange={(event) => update('maxRounds', Number(event.target.value))} /></Field></div>
            <div className="switch-field"><span><strong>Allow Tier 2</strong><small>Use the configured provider when deterministic diagnosis cannot resolve drift.</small></span><PolicySwitch checked={!!form.tier2} onChange={(value) => update('tier2', value)} label="Allow Tier 2" /></div>
            {saveError && <p className="form-error" role="alert">{saveError}</p>}{message && <p className="form-success" role="status"><Check size={14} />{message}</p>}
            <Button type="submit" disabled={saving}><Save />{saving ? 'Saving policy…' : 'Save policy'}</Button>
          </form>}
        </>}
      </SectionCard>
      <div className="settings-note"><ShieldCheck size={16} /><p>Changes affect future calls. healr never rewrites previous audit records or adapter versions when policy settings change.</p></div>
    </div>
  </>;
}
