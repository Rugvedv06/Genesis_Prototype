import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Database,
  RefreshCw,
  ScanSearch,
  Server,
  Wrench,
} from 'lucide-react'
import { Card, SectionTitle, SimulationBadge } from '../components/ui'

const ICONS: Record<string, ReactNode> = {
  bot: <Bot className="h-5 w-5 text-violet-400" />,
  database: <Database className="h-5 w-5 text-cyan-400" />,
  server: <Server className="h-5 w-5 text-cyan-300" />,
  alert: <AlertTriangle className="h-5 w-5 text-red-400" />,
  scan: <ScanSearch className="h-5 w-5 text-amber-400" />,
  wrench: <Wrench className="h-5 w-5 text-violet-300" />,
  refresh: <RefreshCw className="h-5 w-5 text-emerald-400" />,
}

interface NodeDef {
  id: string
  title: string
  desc: string
  icon: string
  detail: string
  tone: string
}

const NODES: NodeDef[] = [
  {
    id: 'agent',
    title: 'AI Agent',
    desc: 'Executes tool calls to complete user goals',
    icon: 'bot',
    detail:
      'The agent plans a task and invokes registered tools. It never hand-writes HTTP calls — it trusts the tool definitions in the registry, which is exactly what makes schema drift fatal.',
    tone: 'border-violet-500/40',
  },
  {
    id: 'registry',
    title: 'Tool Registry',
    desc: 'Versioned, policy-guarded tool definitions',
    icon: 'database',
    detail:
      'Single source of truth for request shapes, headers and endpoints. Patches are versioned (e.g. get_user 3.2.0 → 3.2.1) and hot-reloaded by the agent without a restart.',
    tone: 'border-cyan-500/40',
  },
  {
    id: 'api',
    title: 'Mock API',
    desc: 'Live service whose schema drifts at runtime',
    icon: 'server',
    detail:
      'In this prototype the API is fully simulated. It validates payloads against the drifted contract and returns HTTP 422 when the agent sends the old shape.',
    tone: 'border-cyan-500/40',
  },
  {
    id: 'detector',
    title: 'Error Detector',
    desc: 'Intercepts 4xx / validation failures inline',
    icon: 'alert',
    detail:
      'Watches every tool call response. A 422 (or a schema-validation error in a 200 body) triggers the healing loop instead of surfacing a failure to the user.',
    tone: 'border-red-500/40',
  },
  {
    id: 'analyzer',
    title: 'Schema Analyzer',
    desc: 'Diffs registry schema vs live API contract',
    icon: 'scan',
    detail:
      'Fetches the live OpenAPI fragment, diffs it against the registry definition, and classifies each change: rename, added header, added required field, type change, enum change.',
    tone: 'border-amber-500/40',
  },
  {
    id: 'patcher',
    title: 'Patch Engine',
    desc: 'Applies policy-safe patches to tool defs',
    icon: 'wrench',
    detail:
      'Renames and known-header fills are auto-applied. New required fields with no approved value are BLOCKED — the engine escalates rather than guessing.',
    tone: 'border-violet-500/40',
  },
  {
    id: 'retry',
    title: 'Retry Controller',
    desc: 'Replays the call with the healed schema',
    icon: 'refresh',
    detail:
      'Rebuilds the payload from the patched definition and retries once (2/2). If the retry still fails, the incident is escalated and the tool is paused.',
    tone: 'border-emerald-500/40',
  },
]

function Arrow({ label, tone = 'text-ink-500' }: { label?: string; tone?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-1">
      <ArrowRight className={`h-5 w-5 ${tone}`} />
      {label && (
        <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-ink-400">
          {label}
        </span>
      )}
    </div>
  )
}

function NodeCard({
  node,
  active,
  onClick,
}: {
  node: NodeDef
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-44 shrink-0 rounded-xl border bg-ink-850 p-3 text-left transition-all',
        node.tone,
        active ? 'bg-ink-800 shadow-[0_0_30px_rgba(139,92,246,0.18)] ring-1 ring-violet-500/40' : 'hover:bg-ink-800',
      ].join(' ')}
    >
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-ink-700 bg-ink-900">
        {ICONS[node.icon]}
      </div>
      <p className="text-sm font-semibold text-white">{node.title}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-400">{node.desc}</p>
    </button>
  )
}

export default function WorkflowPage() {
  const [activeId, setActiveId] = useState('agent')
  const active = NODES.find((n) => n.id === activeId)!

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2">
              <SimulationBadge />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              Self-Healing Recovery Loop
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-400">
              Seven components form the recovery pipeline. Click any node to read what it does.
              The same loop runs live on the{' '}
              <span className="text-violet-300">Live Demo</span> page with animated state.
            </p>
          </div>
        </div>
      </Card>

      {/* Diagram */}
      <Card className="overflow-x-auto p-6">
        <div className="min-w-max">
          {/* Row 1: normal flow */}
          <div className="flex items-center">
            <NodeCard node={NODES[0]} active={activeId === 'agent'} onClick={() => setActiveId('agent')} />
            <Arrow tone="text-violet-400" />
            <NodeCard node={NODES[1]} active={activeId === 'registry'} onClick={() => setActiveId('registry')} />
            <Arrow tone="text-cyan-400" label="tool call" />
            <NodeCard node={NODES[2]} active={activeId === 'api'} onClick={() => setActiveId('api')} />
            <div className="ml-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                HTTP 200 → task done
              </p>
            </div>
          </div>

          {/* Loop connector */}
          <div className="flex items-center gap-2 py-3 pl-48">
            <div className="h-6 w-[2px] rounded-full bg-red-500/50" />
            <div className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1">
              <AlertTriangle className="h-3 w-3 text-red-400" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-red-300">
                HTTP 422 — schema mismatch detected → enter healing loop
              </span>
            </div>
          </div>

          {/* Row 2: healing loop */}
          <div className="flex items-center">
            <div className="w-44 shrink-0" />
            <Arrow tone="text-red-400" />
            <NodeCard node={NODES[3]} active={activeId === 'detector'} onClick={() => setActiveId('detector')} />
            <Arrow tone="text-amber-400" label="diff" />
            <NodeCard node={NODES[4]} active={activeId === 'analyzer'} onClick={() => setActiveId('analyzer')} />
            <Arrow tone="text-violet-400" label="patch" />
            <NodeCard node={NODES[5]} active={activeId === 'patcher'} onClick={() => setActiveId('patcher')} />
            <Arrow tone="text-emerald-400" label="replay" />
            <NodeCard node={NODES[6]} active={activeId === 'retry'} onClick={() => setActiveId('retry')} />
            <Arrow tone="text-emerald-400" />
            <NodeCard node={NODES[0]} active={activeId === 'agent'} onClick={() => setActiveId('agent')} />
          </div>
        </div>
      </Card>

      {/* Detail panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            {ICONS[active.icon]}
            <h3 className="text-base font-semibold text-white">{active.title}</h3>
          </div>
          <p className="text-sm leading-relaxed text-ink-300">{active.detail}</p>
        </Card>
        <Card className="p-5">
          <SectionTitle title="Loop guarantees" />
          <ul className="space-y-3 text-xs leading-relaxed text-ink-300">
            {[
              'At most one retry per incident — no infinite loops.',
              'Only policy-safe patches (renames, known headers) auto-apply.',
              'Every patch is versioned and auditable in the registry.',
              'Unsafe changes halt the tool and page a human instead of guessing.',
            ].map((g) => (
              <li key={g} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                {g}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
