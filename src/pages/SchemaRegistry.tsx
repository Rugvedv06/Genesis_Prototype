import { useEffect, useMemo, useState } from 'react'
import {
  Braces,
  CheckCircle2,
  GitCompare,
  Server,
  X,
  XCircle,
} from 'lucide-react'
import { REGISTRY_TOOLS, type RegistryTool } from '../data/mock'
import JsonPanel from '../components/JsonPanel'
import { Card, SimulationBadge, TonePill } from '../components/ui'

const STATUS_MAP: Record<RegistryTool['status'], { tone: 'green' | 'red' | 'amber' | 'cyan'; label: string }> = {
  healthy: { tone: 'green', label: 'Healthy' },
  patched: { tone: 'cyan', label: 'Healed' },
  drifted: { tone: 'amber', label: 'Drifted' },
  escalated: { tone: 'red', label: 'Escalated' },
}

type DiffKind = 'added' | 'removed' | 'unchanged'

function diffSchemas(expected: Record<string, unknown>, actual: Record<string, unknown>) {
  const expProps = (expected.properties ?? {}) as Record<string, unknown>
  const actProps = (actual.properties ?? {}) as Record<string, unknown>
  const rows: { field: string; kind: DiffKind; note: string }[] = []

  const expReq = (expected.required ?? []) as string[]
  const actReq = (actual.required ?? []) as string[]

  const allKeys = [...new Set([...Object.keys(expProps), ...Object.keys(actProps)])]
  for (const key of allKeys) {
    const inExp = key in expProps
    const inAct = key in actProps
    if (inExp && inAct) {
      rows.push({
        field: key,
        kind: 'unchanged',
        note: `${expReq.includes(key) ? 'required' : 'optional'} · unchanged`,
      })
    } else if (inAct && !inExp) {
      rows.push({
        field: key,
        kind: 'added',
        note: actReq.includes(key) ? 'NEW required property — breaks old payloads' : 'new optional property',
      })
    } else {
      rows.push({
        field: key,
        kind: 'removed',
        note: expReq.includes(key) ? 'REMOVED required property — registry is stale' : 'removed optional property',
      })
    }
  }

  const expHeaders = (expected.headers ?? {}) as Record<string, unknown>
  const actHeaders = (actual.headers ?? {}) as Record<string, unknown>
  const headerKeys = [...new Set([...Object.keys(expHeaders), ...Object.keys(actHeaders)])]
  for (const key of headerKeys) {
    const inExp = key in expHeaders
    const inAct = key in actHeaders
    if (inExp && inAct) {
      rows.push({ field: `header: ${key}`, kind: 'unchanged', note: 'unchanged' })
    } else if (inAct) {
      const req = !!(actHeaders[key] as { required?: boolean } | undefined)?.required
      rows.push({
        field: `header: ${key}`,
        kind: 'added',
        note: req ? 'NEW required header — requests fail without it' : 'new optional header',
      })
    } else {
      rows.push({ field: `header: ${key}`, kind: 'removed', note: 'header no longer sent by API' })
    }
  }

  return rows
}

export default function SchemaRegistry() {
  const [selected, setSelected] = useState<RegistryTool | null>(null)
  const [compare, setCompare] = useState(false)

  const diffs = useMemo(
    () => (selected ? diffSchemas(selected.expectedSchema, selected.actualSchema) : []),
    [selected],
  )
  const hasDrift = diffs.some((d) => d.kind !== 'unchanged')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCompare(false)
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-2">
          <SimulationBadge />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-white">Tool Registry</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Every tool the agent can call, with the schema it believes in versus what the live
          API actually accepts. Click a tool to inspect and compare.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-900/60 text-[10px] uppercase tracking-wider text-ink-400">
                <th className="px-4 py-3 font-medium">Tool</th>
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium">Schema version</th>
                <th className="px-4 py-3 font-medium">Calls (24h)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Drift note</th>
              </tr>
            </thead>
            <tbody>
              {REGISTRY_TOOLS.map((tool) => {
                const st = STATUS_MAP[tool.status]
                return (
                  <tr
                    key={tool.name}
                    onClick={() => {
                      setSelected(tool)
                      setCompare(false)
                    }}
                    className="cursor-pointer border-b border-ink-800/80 transition-colors last:border-0 hover:bg-violet-500/5"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Braces className="h-4 w-4 text-violet-400" />
                        <span className="font-mono text-xs font-medium text-white">{tool.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-[11px] text-ink-400">
                        {tool.method} {tool.endpoint}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-cyan-300">{tool.version}</td>
                    <td className="px-4 py-3.5 font-mono text-xs text-ink-300">
                      {tool.calls24h.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5">
                      <TonePill tone={st.tone}>{st.label}</TonePill>
                    </td>
                    <td className="max-w-xs px-4 py-3.5 text-xs text-ink-400">{tool.driftNote}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Drawer */}
      {selected && (
        <>
          <div
            className="fade-in fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <aside className="drawer-in fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-ink-700 bg-ink-900 shadow-2xl">
            <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-cyan-400" />
                    <h2 className="font-mono text-base font-semibold text-white">{selected.name}</h2>
                    <TonePill tone={STATUS_MAP[selected.status].tone}>
                      {STATUS_MAP[selected.status].label}
                    </TonePill>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-400">
                    {selected.method} {selected.endpoint} · v{selected.version}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between border-b border-ink-700 bg-ink-850/60 px-5 py-3">
                <p className="text-xs text-ink-300">{selected.driftNote}</p>
                <button
                  type="button"
                  onClick={() => setCompare((c) => !c)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/20"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  {compare ? 'Hide comparison' : 'Compare Schemas'}
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {compare ? (
                  <>
                    <div className="flex items-center gap-2">
                      {hasDrift ? (
                        <>
                          <XCircle className="h-4 w-4 text-red-400" />
                          <h3 className="text-sm font-semibold text-red-300">
                            Drift detected — {diffs.filter((d) => d.kind !== 'unchanged').length} change(s)
                          </h3>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <h3 className="text-sm font-semibold text-emerald-300">
                            No drift — schemas match
                          </h3>
                        </>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-xl border border-ink-700">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-ink-700 bg-ink-850 text-[10px] uppercase tracking-wider text-ink-400">
                            <th className="px-3 py-2 font-medium">Field</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diffs.map((d) => (
                            <tr
                              key={d.field}
                              className={
                                d.kind === 'added'
                                  ? 'bg-emerald-500/5'
                                  : d.kind === 'removed'
                                    ? 'bg-red-500/5'
                                    : ''
                              }
                            >
                              <td className="px-3 py-2.5 font-mono text-[11px] text-white">{d.field}</td>
                              <td className="px-3 py-2.5">
                                {d.kind === 'added' && <TonePill tone="green">added</TonePill>}
                                {d.kind === 'removed' && <TonePill tone="red">removed</TonePill>}
                                {d.kind === 'unchanged' && <TonePill tone="muted">same</TonePill>}
                              </td>
                              <td className="px-3 py-2.5 text-[11px] text-ink-400">{d.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    <JsonPanel
                      title="Registry (expected) schema"
                      monoLabel={`${selected.name}@${selected.version}`}
                      data={selected.expectedSchema}
                    />
                    <JsonPanel
                      title="Live API (actual) schema"
                      monoLabel="drifted contract"
                      data={selected.actualSchema}
                      tone={hasDrift ? 'error' : 'default'}
                    />
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
    </div>
  )
}
