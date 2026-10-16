"use client";

/**
 * Phase 1 Track D: demo-client Drift Control — split-screen Baseline vs Healed.
 * Fixes (FX9): URLs from env, drift events don't flip healed to fail, rounds
 * from meta.rounds, token counters, truth check from /admin/truth, idempotent
 * registration, connection state, baseline mode label.
 */
import { useState, useEffect, useCallback } from 'react';

const CORE = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:8000';
const MOCK = process.env.NEXT_PUBLIC_MOCK_URL || 'http://localhost:5001';
const API_ID = 'demo-users';
const TOOL = { name: 'get_user', path: '/api/users/get', method: 'POST' };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function DriftControl() {
  const [mode, setMode] = useState('idle'); // idle | running | done
  const [mutation, setMutation] = useState(null);
  const [registered, setRegistered] = useState(false);
  const [coreConn, setCoreConn] = useState('disconnected');
  const [mockConn, setMockConn] = useState('disconnected');
  const [baseline, setBaseline] = useState({ status: 'idle', iterations: 0, tokens: { input: 0, output: 0, total: 0 }, elapsed: 0, events: [], data: null, error: null, mode: 'scripted' });
  const [healed, setHealed] = useState({ status: 'idle', iterations: 0, rounds: 0, tokens: { input: 0, output: 0, total: 0 }, elapsed: 0, events: [], data: null, error: null, ops: [], version: null });

  // ---- SSE listeners ----
  useEffect(() => {
    const coreEs = new EventSource(`${CORE}/events`);
    coreEs.onopen = () => setCoreConn('connected');
    coreEs.onerror = () => setCoreConn('disconnected');
    coreEs.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      // Only attribute events to this run by runId.
      if (!ev.runId || !ev.runId.startsWith('h_')) return;
      setHealed((h) => ({ ...h, events: [...h.events.slice(-49), ev] }));
      if (ev.type === 'patch.committed') {
        setHealed((h) => ({ ...h, ops: ev.ops ?? h.ops, version: ev.version }));
      }
      if (ev.type === 'call.succeeded') {
        setHealed((h) => ({ ...h, status: 'ok', data: ev.data, tokens: ev.meta?.tokens ? { ...h.tokens, ...ev.meta.tokens } : h.tokens }));
      }
      // G14: ignore call.failed with code 'drift' — that's the drift event, not failure.
      if (ev.type === 'call.failed' && ev.code !== 'drift') {
        setHealed((h) => ({ ...h, status: 'fail', error: ev }));
      }
      if (ev.type === 'patch.committed' || ev.type === 'halt') {
        setHealed((h) => ({ ...h, status: ev.type === 'halt' ? 'fail' : h.status }));
      }
    };

    const mockEs = new EventSource(`${MOCK}/demo/events`);
    mockEs.onopen = () => setMockConn('connected');
    mockEs.onerror = () => setMockConn('disconnected');
    mockEs.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (!ev.runId || !ev.runId.startsWith('b_')) return;
      setBaseline((b) => ({ ...b, events: [...b.events.slice(-49), ev] }));
      if (ev.type === 'agent.step') {
        setBaseline((b) => ({ ...b, tokens: ev.cumulative ?? b.tokens }));
      }
      if (ev.type === 'agent.final') {
        setBaseline((b) => ({ ...b, status: ev.outcome === 'success' ? 'ok' : 'fail', iterations: ev.iterations, tokens: ev.tokens ?? b.tokens, data: ev.data, error: ev.error, mode: ev.mode ?? 'scripted' }));
      }
    };
    return () => { coreEs.close(); mockEs.close(); };
  }, []);

  const reset = async () => {
    await fetch(`${MOCK}/admin/reset`, { method: 'POST' });
    setMutation(null);
    setRegistered(false);
    setBaseline({ status: 'idle', iterations: 0, tokens: { input: 0, output: 0, total: 0 }, elapsed: 0, events: [], data: null, error: null, mode: 'scripted' });
    setHealed({ status: 'idle', iterations: 0, rounds: 0, tokens: { input: 0, output: 0, total: 0 }, elapsed: 0, events: [], data: null, error: null, ops: [], version: null });
    setMode('idle');
  };

  const mutate = async () => {
    const r = await fetch(`${MOCK}/admin/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'M5' }) });
    const j = await r.json();
    setMutation(j.mutation);
  };

  const registerApi = useCallback(async () => {
    if (registered) return;
    await fetch(`${CORE}/apis`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiId: API_ID, baseUrl: MOCK, specUrl: `${MOCK}/openapi.json`,
        credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
        healing: { enabled: true, maxRounds: 5, tier2: true },
        tools: [{ name: 'get_user', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none',
          parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
          response: { fields: { id: { path: 'result.id', type: 'string' }, name: { path: 'result.name', type: 'string' }, email: { path: 'result.email', type: 'string', format: 'email' } } } },
          { name: 'update_user_email', method: 'POST', path: '/api/users/update-email', risk: 'medium', sideEffects: 'write',
          parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['user_id', 'email'], additionalProperties: false },
          response: { fields: { id: { path: 'result.id', type: 'string' }, email: { path: 'result.email', type: 'string', format: 'email' }, updated_at: { path: 'result.updated_at', type: 'string' } } } }] }),
    });
    setRegistered(true);
  }, [registered]);

  const runBoth = async () => {
    await registerApi();
    setMode('running');
    const t0 = Date.now();

    const bRunId = `b_${Date.now()}`;
    const hRunId = `h_${Date.now()}`;

    const baselinePromise = fetch(`${MOCK}/demo/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiId: API_ID, tool: TOOL, args: { user_id: '123' }, baseUrl: MOCK, runId: bRunId }),
    }).then((r) => r.json());

    const healedPromise = fetch(`${CORE}/apis/${API_ID}/tools/${TOOL.name}/invoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: { user_id: '123' }, runId: hRunId }),
    }).then((r) => r.json());

    const [bres, hres] = await Promise.all([baselinePromise, healedPromise]);
    const elapsed = Date.now() - t0;

    setBaseline((b) => ({ ...b, status: bres.outcome === 'success' ? 'ok' : 'fail', iterations: bres.iterations, elapsed, data: bres.data, error: bres.error }));
    setHealed((h) => ({
      ...h,
      status: hres.ok ? 'ok' : 'fail',
      iterations: hres.meta?.rounds ?? 0,
      rounds: hres.meta?.rounds ?? 0,
      elapsed,
      data: hres.data,
      error: hres.error,
      ops: hres.meta?.ops ?? h.ops,
      version: hres.meta?.version ?? null,
      tokens: hres.meta?.tokens ? { ...h.tokens, ...hres.meta.tokens } : h.tokens,
    }));
    setMode('done');
  };

  // Truth check: fetch from mock /admin/truth/users/123
  const [truth, setTruth] = useState(null);
  useEffect(() => {
    if (mode !== 'done') return;
    fetch(`${MOCK}/admin/truth/users/123`)
      .then((r) => r.json())
      .then(setTruth)
      .catch(() => setTruth({ error: 'unavailable' }));
  }, [mode]);

  const truthOk = (d) => {
    if (!d || !truth) return false;
    const flat = d.id !== undefined ? d : d.result;
    return flat && flat.id === truth.id && flat.name === truth.name && flat.email === truth.email;
  };

  const expectedOps = [
    { op: 'add_header', name: 'X-Tenant' },
    { op: 'move_field', from: 'user_id', to: 'target.user_id' },
    { op: 'rename_field', path: 'target', from: 'user_id', to: 'id' },
    { op: 'coerce_type', path: 'target.id', from: 'string', to: 'integer' },
  ];
  const opsMatch = healed.ops.length === expectedOps.length &&
    healed.ops.every((op, i) => op.op === expectedOps[i].op && op.from === expectedOps[i].from && op.to === expectedOps[i].to);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#0b0c10', color: '#c5c6c7', minHeight: '100vh' }}>
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #1f2833', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', letterSpacing: '0.05em' }}>healr · Drift Control</h1>
        <span style={{ marginLeft: 'auto', fontSize: '0.85rem', fontFamily: 'monospace' }}>core :8000 · mock :5001 · mode {mode}</span>
        <span style={{ background: coreConn === 'connected' ? '#1f2833' : '#5a2a2a', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem' }}>core {coreConn}</span>
        <span style={{ background: mockConn === 'connected' ? '#1f2833' : '#5a2a2a', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem' }}>mock {mockConn}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={reset} disabled={mode === 'running'} style={btnStyle('#45a29e')}>Reset</button>
          <button onClick={mutate} disabled={mode === 'running'} style={btnStyle('#e84855')}>Mutate API (M5)</button>
          <button onClick={runBoth} disabled={mode === 'running'} style={btnStyle('#e84855', '#0b0c10')}>Run both</button>
        </div>
        {mutation && <span style={{ background: '#1f2833', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', border: '1px solid #e84855' }}>mutation: {mutation}</span>}
      </header>

      <main style={{ padding: '20px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <Pane title={`BASELINE (${baseline.mode})`} accent="#e84855" status={baseline.status} iterations={baseline.iterations} tokens={baseline.tokens} elapsed={baseline.elapsed} events={baseline.events} data={baseline.data} error={baseline.error} truthOk={truthOk(baseline.data)} />
        <Pane title="HEALED (self-healing)" accent="#45a29e" status={healed.status} iterations={healed.iterations} rounds={healed.rounds} tokens={healed.tokens} elapsed={healed.elapsed} events={healed.events} data={healed.data} error={healed.error} ops={healed.ops} version={healed.version} truthOk={truthOk(healed.data)} />
      </main>

      {healed.ops.length > 0 && (
        <section style={{ padding: '0 20px 20px', borderTop: '1px solid #1f2833' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '1rem', color: '#66fcf1' }}>
            Committed patch ops ({healed.ops.length} ops {opsMatch ? '✓ matches expected diff' : '⚠ unexpected'})
          </h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {healed.ops.map((op, i) => (
              <div key={i} style={{ background: '#1f2833', border: `1px solid ${opsMatch ? '#66fcf1' : '#e84855'}`, color: opsMatch ? '#66fcf1' : '#e84855', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem', fontFamily: 'monospace' }}>{JSON.stringify(op)}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function btnStyle(accent, bg = accent) {
  return { background: bg, color: accent === '#66fcf1' ? '#0b0c10' : '#fff', border: 'none', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' };
}

function Pane({ title, accent, status, iterations, rounds, tokens, elapsed, events, data, error, truthOk, ops, version }) {
  const ok = status === 'ok';
  const fail = status === 'fail';
  return (
    <section style={{ flex: 1, minWidth: '320px', background: '#111318', border: `1px solid ${accent}`, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: accent, color: '#0b0c10', padding: '8px 12px', fontWeight: 700, fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {title}
        <span style={{ fontSize: '0.7rem', opacity: 0.9 }}>{status === 'idle' ? 'idle' : ok ? 'OK' : fail ? 'FAIL' : 'running'}</span>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', gap: '16px', fontSize: '0.8rem', fontFamily: 'monospace', background: '#0b0c10' }}>
        <div>iterations <b>{iterations}</b></div>
        {rounds > 0 && <div>heal rounds <b>{rounds}</b></div>}
        <div>elapsed <b>{elapsed} ms</b></div>
        <div>tokens <b>{tokens.total || 0}</b></div>
        {version !== null && <div>version <b>{version}</b></div>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', fontSize: '0.72rem', fontFamily: 'menlo, monospace', background: '#0b0c10' }}>
        {events.length === 0 && status === 'idle' ? 'Waiting to run…' : null}
        {events.map((ev, i) => {
          const line = typeof ev.payload !== 'undefined' ? JSON.stringify(ev.payload) : JSON.stringify(ev);
          const color = ev.type === 'call.succeeded' ? '#45a29e' : ev.type === 'call.failed' || ev.type === 'agent.final' ? '#e84855' : ev.type === 'patch.proposed' ? '#66fcf1' : '#c5c6c7';
          return <div key={i} style={{ color, marginBottom: '2px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{ev.type} · {line.slice(0, 200)}</div>;
        })}
        {fail && error && <div style={{ color: '#e84855', marginTop: '6px' }}>final: {JSON.stringify(error)}</div>}
      </div>
      <div style={{ padding: '8px 12px', background: '#111318', borderTop: '1px solid #1f2833', fontSize: '0.8rem' }}>
        {ok && data ? <div>result: {JSON.stringify(data)}<br/>truth check: <span style={{ color: truthOk ? '#45a29e' : '#e84855', fontWeight: 700 }}>{truthOk ? 'MATCH ✓' : 'MISMATCH ✗'}</span></div> : null}
        {!ok && !fail && <div>running…</div>}
      </div>
    </section>
  );
}
