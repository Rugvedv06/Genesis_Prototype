'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, Check, Code2, Radio, ShieldCheck, Sparkles } from 'lucide-react';

const stages = [
  { id: 'healthy', label: 'HEALTHY CONNECTION', state: 'CONNECTION HEALTHY', tone: 'healthy', note: 'Expected response received', path: 'current.temperature_2m', data: '24.5 °C' },
  { id: 'drift', label: 'CONTRACT DRIFT DETECTED', state: 'CONTRACT DRIFT DETECTED', tone: 'drift', note: 'Field moved · connection interrupted', path: 'data.current.temp', data: '24.5' },
  { id: 'repair', label: 'CANDIDATE ADAPTER REPAIR', state: 'REPAIR CANDIDATE', tone: 'repair', note: 'Proposed path mapping · awaiting checks', path: 'data.current.temp → current.temperature_2m', data: 'candidate' },
  { id: 'verify', label: 'VERIFICATION AND OUTCOME', state: 'VERIFICATION PASSED · SIMULATED', tone: 'verified', note: 'Normalized output · example data', path: 'temperature', data: '24.5 °C' },
  { id: 'halt', label: 'SAFE HALT', state: 'SAFE HALT — REPAIR NOT COMMITTED', tone: 'halt', note: 'Ambiguous mapping · candidate rejected', path: 'mapping unclear', data: 'no output' },
];

function Node({ kind, active, title, sub, detail, icon: Icon }) {
  return <div className={`kw-node kw-node-${kind}${active ? ' is-active' : ''}`}><div className="kw-node-icon"><Icon size={18} strokeWidth={1.6} /></div><div className="kw-node-copy"><b>{title}</b><span>{sub}</span>{detail && <code>{detail}</code>}{kind === 'runtime' && <div className="kw-runtime-ports"><span>IN</span><i /><span>MAP</span><i /><span>VERIFY</span><i /><span>OUT</span></div>}</div><i className="kw-node-led" /></div>;
}

export default function WorkflowScene() {
  const [stage, setStage] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 3 : 0);
  const [reduced, setReduced] = useState(false);
  const active = stages[stage];

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (reduced) return undefined;
    const timer = window.setInterval(() => setStage((value) => (value + 1) % stages.length), 3600);
    return () => window.clearInterval(timer);
  }, [reduced]);
  const drift = active.id === 'drift';
  const healing = ['repair', 'verify', 'halt'].includes(active.id);
  const Icon = active.id === 'halt' ? AlertTriangle : active.id === 'verify' ? Check : active.id === 'repair' ? Sparkles : active.id === 'drift' ? AlertTriangle : Activity;

  return <div className={`kw-workflow kw-${active.tone}${reduced ? ' kw-paused' : ''}`} role="group" aria-label="Illustrative animated API repair workflow">
    <div className="kw-scene-top"><span><i /> SYSTEM FLOW</span><span className="kw-sim-label">SIMULATED WORKFLOW</span></div>
    <div className="kw-stage-label"><span className="kw-stage-index">0{stage + 1}</span><b>{active.label}</b><span className={`kw-stage-status kw-status-${active.tone}`}><i />{active.state}</span></div>
    <div className={`kw-canvas kw-phase-${active.id}`}>
      <div className="kw-depth-plane kw-depth-back" />
      <svg className="kw-connections" viewBox="0 0 640 300" preserveAspectRatio="none" aria-hidden="true">
        <path className="kw-path-base" d="M 128 142 C 206 142 208 142 282 142" />
        <path className="kw-path-base" d="M 358 142 C 435 142 435 142 513 142" />
        <path className={`kw-path-flow kw-flow-left${drift ? ' is-broken' : ''}`} d="M 128 142 C 206 142 208 142 282 142" />
        <path className={`kw-path-flow kw-flow-right${drift ? ' is-broken' : ''}`} d="M 358 142 C 435 142 435 142 513 142" />
        <circle className="kw-packet kw-packet-one" r="3">{!reduced && <animateMotion dur="3.2s" repeatCount="indefinite" path="M 150 142 C 206 142 208 142 282 142 M 358 142 C 435 142 435 142 490 142" />}</circle><circle className="kw-packet kw-packet-two" r="2">{!reduced && <animateMotion dur="3.2s" begin="-1.6s" repeatCount="indefinite" path="M 150 142 C 206 142 208 142 282 142 M 358 142 C 435 142 435 142 490 142" />}</circle>
        <circle className="kw-break-mark" cx="238" cy="142" r="8" />
      </svg>
      <svg className="kw-mobile-connections" viewBox="0 0 300 330" preserveAspectRatio="none" aria-hidden="true">
        <path className="kw-path-base" d="M 150 110 C 150 132 150 136 150 155" /><path className="kw-path-base" d="M 150 215 C 150 235 150 237 150 254" />
        <path className={`kw-path-flow kw-flow-left${drift ? ' is-broken' : ''}`} d="M 150 110 C 150 132 150 136 150 155" />
        <path className={`kw-path-flow kw-flow-right${drift ? ' is-broken' : ''}`} d="M 150 215 C 150 235 150 237 150 254" />
        <circle className="kw-mobile-packet kw-packet" r="3">{!reduced && <animateMotion dur="2s" repeatCount="indefinite" path="M 150 110 C 150 132 150 136 150 155" />}</circle><circle className="kw-mobile-packet kw-packet-two" r="2">{!reduced && <animateMotion dur="2s" begin="-1s" repeatCount="indefinite" path="M 150 215 C 150 235 150 237 150 254" />}</circle>
        <circle className="kw-mobile-break" cx="150" cy="132" r="7" />
      </svg>
      <div className="kw-orbit kw-orbit-one" /><div className="kw-orbit kw-orbit-two" />
      <Node kind="api" title="Upstream API" sub="EXTERNAL CONTRACT" detail={drift ? 'data.current.temp' : 'current.temperature_2m'} icon={Radio} active={active.id === 'healthy' || drift} />
      <Node kind="runtime" title="Healer" sub="HEALER RUNTIME" icon={ShieldCheck} active={healing} />
      <Node kind="agent" title="Your application" sub="DOWNSTREAM CONSUMER" detail={active.id === 'halt' ? 'OUTPUT BLOCKED' : 'temperature · °C'} icon={Code2} active={active.id === 'healthy' || active.id === 'verify'} />
      <div className="kw-link-label kw-link-left">UPSTREAM RESPONSE</div><div className="kw-link-label kw-link-right">NORMALIZED OUTPUT</div>
      <div className="kw-floating kw-float-diff"><span>CONTRACT DIFF · SIMULATED</span><div><i>EXPECTED</i><code>current.temperature_2m</code></div><div><i>OBSERVED</i><code>data.current.<b>temp</b></code></div></div>
      <div className="kw-floating kw-float-map"><div><Sparkles size={12} /><span>{active.id === 'verify' ? 'VERIFICATION PASSED' : 'REPAIR CANDIDATE'}</span></div><code>data.current.temp</code><ArrowRight size={13} /><code>current.temperature_2m</code><small>{active.id === 'verify' ? 'adapter v1 → v2 · illustrative acceptance' : 'adapter v1 → v2 · uncommitted'}</small></div>
      <div className="kw-floating kw-float-output"><div><Check size={12} /><span>NORMALIZED OUTPUT</span></div><pre>{'{\n  "temperature": 24.5,\n  "unit": "°C"\n}'}</pre></div>
      <div className="kw-floating kw-float-halt"><AlertTriangle size={12} /><span>SAFE HALT · REPAIR NOT COMMITTED</span></div>
    </div>
    <details className="kw-inspector"><summary><Code2 size={12} /> Inspect response diff <span>illustrative JSON</span></summary><div className="kw-inspector-grid"><div><label>EXPECTED · BEFORE</label><pre>{'{\n  "current": {\n    "temperature_2m": 24.5\n  }\n}'}</pre></div><div><label>OBSERVED · AFTER</label><pre>{'{\n  "data": {\n    "current": {\n      "temp": 24.5\n    }\n  }\n}'}</pre></div></div></details>
    <div className="kw-scene-bottom"><div className="kw-stage-caption"><span className="kw-caption-icon"><Icon size={16} /></span><div><b>{active.note}</b><span>{active.id === 'halt' ? 'No adapter version accepted' : active.id === 'verify' ? 'Stable logical output restored' : active.id === 'repair' ? 'Repair is not accepted until verified' : active.id === 'drift' ? 'Upstream changed its response contract' : 'API response reaches the application'}</span></div></div></div>
    <div className="kw-scene-foot"><span><Activity size={12} /> Illustrative data · not live runtime events</span><span>{reduced ? 'Static workflow · reduced motion' : 'Workflow sequence · automatically repeating'}</span></div>
  </div>;
}
