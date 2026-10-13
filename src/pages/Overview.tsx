import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Clock,
  Play,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react'
import {
  METRICS,
  RECENT_INCIDENTS,
  RECOVERY_ACTIVITY,
  SYSTEM_STATUS,
} from '../data/mock'
import { Card, IllustrativeTag, SectionTitle, SimulationBadge, StatusDot, TonePill } from '../components/ui'

const TONE_TEXT: Record<string, string> = {
  violet: 'text-violet-300',
  cyan: 'text-cyan-300',
  green: 'text-emerald-300',
  amber: 'text-amber-300',
}

export default function Overview() {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-60" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SimulationBadge />
              <TonePill tone="violet">PS 01 · Self-Healing Tool Registries</TonePill>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white lg:text-3xl">
              Agents keep working when{' '}
              <span className="bg-gradient-to-r from-violet-400 to-cyan-300 bg-clip-text text-transparent">
                API schemas drift
              </span>
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">
              When a live API silently changes its contract — renamed fields, new required
              headers, new parameters — agents usually break. This prototype shows a tool
              registry that <span className="text-white">detects the drift, diagnoses the
              diff, patches the tool definition, and retries</span> — all without a human.
              When no safe patch exists, it stops and escalates instead of guessing.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                to="/demo"
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-transform hover:scale-[1.02]"
              >
                <Play className="h-4 w-4" />
                Start Demo
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                to="/workflow"
                className="inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-4 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:border-ink-500 hover:text-white"
              >
                <Activity className="h-4 w-4 text-cyan-400" />
                View Workflow
              </Link>
            </div>
          </div>

          <div className="grid w-full shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:w-72">
            {SYSTEM_STATUS.map((s) => (
              <div
                key={s.label}
                className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <StatusDot tone={s.tone} />
                  <span className="text-xs text-ink-300">{s.label}</span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Metrics */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle
            title="Fleet Metrics"
            subtitle="How the self-healing registry performed against simulated drift"
          />
          <IllustrativeTag />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((m) => (
            <Card key={m.label} className="p-4 transition-colors hover:border-ink-600">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                {m.label}
              </p>
              <p className={`mt-2 text-3xl font-semibold tracking-tight ${TONE_TEXT[m.tone]}`}>
                {m.value}
              </p>
              <p className="mt-1.5 text-xs text-ink-300">{m.delta}</p>
              <p className="mt-3 border-t border-ink-700/70 pt-2 text-[11px] text-ink-400">
                {m.hint}
              </p>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Incidents */}
        <Card className="overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-white">Recent Incidents</h3>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
              last 24h · simulated
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700/70 text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2.5 font-medium">Incident</th>
                  <th className="px-4 py-2.5 font-medium">Tool</th>
                  <th className="px-4 py-2.5 font-medium">Drift</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">MTTR</th>
                  <th className="px-4 py-2.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_INCIDENTS.map((inc) => (
                  <tr
                    key={inc.id}
                    className="border-b border-ink-800/80 transition-colors last:border-0 hover:bg-ink-800/50"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-violet-300">{inc.id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-200">{inc.tool}</td>
                    <td className="px-4 py-3 text-xs text-ink-300">{inc.drift}</td>
                    <td className="px-4 py-3">
                      {inc.status === 'Resolved' ? (
                        <TonePill tone="green">Resolved</TonePill>
                      ) : (
                        <TonePill tone="amber">Escalated</TonePill>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-300">{inc.mttR}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-400">{inc.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Activity feed */}
        <Card>
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Recent Recovery Activity</h3>
            </div>
          </div>
          <ul className="divide-y divide-ink-800">
            {RECOVERY_ACTIVITY.map((a, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-1.5 font-mono text-[10px] text-ink-400">{a.time}</span>
                <StatusDot tone={a.tone} />
                <p className="flex-1 text-xs leading-relaxed text-ink-300">{a.label}</p>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-700 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <Clock className="h-3.5 w-3.5" />
              <span>All timestamps simulated for demonstration</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Why it matters strip */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          {
            icon: TrendingUp,
            title: 'The problem',
            body: 'APIs evolve weekly. A renamed field or new required header turns a working agent call into an instant HTTP 422.',
            tone: 'text-red-400',
          },
          {
            icon: ShieldCheck,
            title: 'The mechanism',
            body: 'Detect error → diff live schema vs registry → generate a policy-safe patch → hot-reload tool def → retry once.',
            tone: 'text-violet-400',
          },
          {
            icon: Activity,
            title: 'The outcome',
            body: '92% of drift incidents recover in ~2.4s with zero human touch. The rest escalate safely instead of guessing.',
            tone: 'text-emerald-400',
          },
        ].map(({ icon: Icon, title, body, tone }) => (
          <Card key={title} className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Icon className={`h-4 w-4 ${tone}`} />
              <h4 className="text-sm font-semibold text-white">{title}</h4>
            </div>
            <p className="text-xs leading-relaxed text-ink-300">{body}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
