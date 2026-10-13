import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react'
import { SCENARIOS, type Scenario } from '../data/mock'
import { useDemoEngine } from '../hooks/useDemoEngine'
import JsonPanel from '../components/JsonPanel'
import WorkflowChain from '../components/WorkflowChain'
import { Card, SimulationBadge, TonePill } from '../components/ui'

const LOG_TONE: Record<string, { text: string; dot: string }> = {
  info: { text: 'text-ink-300', dot: 'bg-cyan-400' },
  warn: { text: 'text-amber-300', dot: 'bg-amber-400' },
  error: { text: 'text-red-300', dot: 'bg-red-400' },
  success: { text: 'text-emerald-300', dot: 'bg-emerald-400' },
}

const scenarioTone = (id: Scenario['id']) =>
  id === 'A'
    ? 'border-violet-500/50 bg-violet-500/10'
    : id === 'B'
      ? 'border-cyan-500/50 bg-cyan-500/10'
      : 'border-amber-500/50 bg-amber-500/10'

export default function LiveDemo() {
  const [selectedId, setSelectedId] = useState<Scenario['id']>('A')
  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === selectedId)!,
    [selectedId],
  )
  const { state, start, reset } = useDemoEngine(scenario)

  const running = state.running
  const done = state.done

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <SimulationBadge />
              <TonePill tone={running ? 'violet' : done ? (state.result === 'success' ? 'green' : 'amber') : 'muted'}>
                {running ? 'Simulation running' : done ? (state.result === 'success' ? 'Recovery complete' : 'Escalated') : 'Idle — pick a scenario'}
              </TonePill>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Live Drift Recovery Demo</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-400">
              Watch the agent hit a schema error against a mock API, diagnose the drift, patch
              its own tool definition, and retry — step by step.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-4 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:border-ink-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              Reset Demo
            </button>
            <button
              type="button"
              onClick={start}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {done ? 'Replay Demo' : 'Start Demo'}
                </>
              )}
            </button>
          </div>
        </div>
      </Card>

      {/* Scenario selector */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {SCENARIOS.map((s) => {
          const active = s.id === selectedId
          return (
            <button
              key={s.id}
              type="button"
              disabled={running}
              onClick={() => setSelectedId(s.id)}
              className={[
                'group rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60',
                active ? scenarioTone(s.id) : 'border-ink-700 bg-ink-850 hover:border-ink-600',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-400">
                  Scenario {s.id}
                </span>
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${active ? 'translate-x-0 text-white' : 'text-ink-500 group-hover:translate-x-0.5'}`}
                />
              </div>
              <p className="mt-1.5 text-sm font-semibold text-white">{s.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">{s.tagline}</p>
              <div className="mt-3">
                {s.recoverable ? (
                  <TonePill tone="green">Expected: successful recovery</TonePill>
                ) : (
                  <TonePill tone="red">Expected: human intervention</TonePill>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Workflow chain */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">Recovery Pipeline</h3>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            {scenario.tool} · {scenario.method} {scenario.endpoint}
          </span>
        </div>
        <WorkflowChain stepStates={state.stepStates} />
      </Card>

      {/* Main working area */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Left: schemas + payloads */}
        <div className="space-y-4 xl:col-span-3">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">Schema Context</h3>
              <TonePill tone="amber">{scenario.driftSummary}</TonePill>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <JsonPanel
                title="Expected request (registry)"
                monoLabel={`${scenario.tool}@${scenario.registryVersion}`}
                data={scenario.expectedSchema}
                highlightKeys={scenario.id === 'A' ? ['user_id'] : undefined}
                tone="default"
              />
              <JsonPanel
                title="Actual API schema (live)"
                monoLabel="drifted"
                data={scenario.actualSchema}
                highlightKeys={
                  scenario.id === 'A'
                    ? ['userId']
                    : scenario.id === 'B'
                      ? ['X-Client-Version']
                      : ['region']
                }
                tone="error"
              />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <JsonPanel
                title="Request payload (attempt 1)"
                monoLabel="sent"
                data={state.ui.request}
                emptyText="Click Start Demo to send the first request"
                tone={state.ui.error ? 'error' : 'default'}
                highlightKeys={scenario.id === 'A' ? ['user_id'] : undefined}
              />
              <JsonPanel
                title="Mock API error"
                monoLabel="HTTP 422"
                data={state.ui.error}
                emptyText="No error yet — waiting for the API verdict"
                tone="error"
                highlightKeys={
                  scenario.id === 'A'
                    ? ['user_id', 'userId']
                    : scenario.id === 'B'
                      ? ['X-Client-Version']
                      : ['region']
                }
              />
            </div>
          </Card>

          {/* Diagnosis + Patch */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Drift Diagnosis &amp; Patch</h3>
            <div className="mb-3 rounded-lg border border-ink-700 bg-ink-900 p-3">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Diagnosis
              </p>
              {state.ui.diagnosis ? (
                <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  {state.ui.diagnosis}
                </p>
              ) : (
                <p className="font-mono text-[11px] text-ink-400">
                  Awaiting schema analyzer output…
                </p>
              )}
            </div>
            <JsonPanel
              title="Patch applied to tool definition"
              monoLabel={scenario.patchDescription}
              data={state.ui.patch}
              emptyText="Patch engine idle — no drift detected yet"
              tone={state.ui.patch ? (scenario.recoverable ? 'success' : 'warn') : 'default'}
            />
          </Card>

          {/* Retry + result payload */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Retry &amp; Outcome</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <JsonPanel
                title="Request payload (retry)"
                monoLabel="patched"
                data={state.ui.retryRequest}
                emptyText="Retry will appear after the patch is applied"
                tone="success"
              />
              <JsonPanel
                title="Mock API response"
                monoLabel={state.result === 'success' ? 'HTTP 200' : 'response'}
                data={state.ui.response}
                emptyText={
                  scenario.recoverable
                    ? 'Success response pending'
                    : 'N/A — scenario escalates to a human'
                }
                tone="success"
              />
            </div>
          </Card>
        </div>

        {/* Right: live log + result */}
        <div className="space-y-4 xl:col-span-2">
          <Card className="flex max-h-[520px] min-h-[320px] flex-col">
            <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">Live Event Log</h3>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {state.logs.length} events
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {state.logs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
                  <div className="h-10 w-10 rounded-full border border-dashed border-ink-600" />
                  <p className="text-xs text-ink-400">
                    No events yet.
                    <br />
                    Press <span className="font-mono text-violet-300">Start Demo</span> to begin the simulation.
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {state.logs.map((log, i) => {
                    const tone = LOG_TONE[log.status]
                    return (
                      <li
                        key={`${log.t}-${i}`}
                        className="rounded-lg border border-ink-800 bg-ink-900/70 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          <span className="font-mono text-[10px] text-ink-400">{log.t}</span>
                          <span className={`font-mono text-[10.5px] font-semibold ${tone.text}`}>
                            {log.event}
                          </span>
                        </div>
                        <p className="mt-1 break-all pl-3.5 font-mono text-[10.5px] leading-relaxed text-ink-400">
                          {log.details}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {running && (
              <div className="flex items-center gap-2 border-t border-ink-700 px-4 py-2.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-violet-300">
                  Simulation running…
                </span>
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse-soft" />
              </div>
            )}
          </Card>

          {/* Result panel */}
          {!done && !running && (
            <Card className="border-dashed p-5 text-center">
              <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">
                Result will appear here
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {scenario.id === 'C'
                  ? 'Scenario C ends with a safe escalation.'
                  : 'Scenarios A & B recover automatically.'}
              </p>
            </Card>
          )}

          {done && state.result === 'success' && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 shadow-[0_0_40px_rgba(16,185,129,0.12)]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-tight text-emerald-200">
                    SUCCESS
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-emerald-400/80">
                    Zero-touch recovery complete
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { k: 'Attempts', v: '2' },
                  { k: 'Recovery time', v: '2.4s' },
                  { k: 'Token overhead', v: '320' },
                ].map((x) => (
                  <div key={x.k} className="rounded-lg border border-emerald-500/20 bg-ink-900/50 py-2">
                    <dt className="font-mono text-[9.5px] uppercase tracking-wider text-ink-400">
                      {x.k}
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold text-emerald-300">{x.v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-emerald-200/80">
                The tool registry healed itself: <span className="font-mono">{scenario.tool}</span> was
                patched and the task completed without a human.
              </p>
            </div>
          )}

          {done && state.result === 'human' && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 shadow-[0_0_40px_rgba(245,158,11,0.12)]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20">
                  <XCircle className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-tight text-amber-200">
                    HUMAN INTERVENTION REQUIRED
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-amber-400/80">
                    Recovery stopped safely
                  </p>
                </div>
              </div>
              <ul className="mt-4 space-y-2 text-xs leading-relaxed text-amber-200/90">
                <li className="rounded-lg border border-amber-500/20 bg-ink-900/50 p-2.5">
                  New required field <span className="font-mono text-amber-300">region</span> has no
                  policy-approved value — auto-filling it could corrupt inventory data.
                </li>
                <li className="rounded-lg border border-amber-500/20 bg-ink-900/50 p-2.5">
                  The agent <span className="text-white">did not guess</span>. It paused the tool,
                  logged the incident, and escalated to the on-call engineer.
                </li>
              </ul>
              <button
                type="button"
                onClick={reset}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
              >
                <RotateCcw className="h-4 w-4" />
                Reset &amp; try another scenario
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
