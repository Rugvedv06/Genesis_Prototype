import { NavLink } from 'react-router-dom'
import {
  Activity,
  Database,
  LayoutDashboard,
  Play,
  ScrollText,
  ShieldCheck,
  Workflow as WorkflowIcon,
} from 'lucide-react'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/demo', label: 'Live Demo', icon: Play },
  { to: '/workflow', label: 'Workflow', icon: WorkflowIcon },
  { to: '/registry', label: 'Schema Registry', icon: Database },
  { to: '/logs', label: 'Logs & Metrics', icon: ScrollText },
]

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-ink-700 bg-ink-900">
      <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 shadow-lg shadow-violet-600/25">
          <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            SchemaHeal
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-widest text-ink-400">
            v0.9 · prototype
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-violet-600/15 text-violet-300 ring-1 ring-violet-500/30'
                  : 'text-ink-300 hover:bg-ink-800 hover:text-white',
              ].join(' ')
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-ink-700 p-4">
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
              Environment
            </span>
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-ink-300">
            No backend · No real API
            <br />
            All responses simulated
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-amber-300">
              Simulation Mode — Mock API
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
