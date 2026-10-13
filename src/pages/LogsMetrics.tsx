import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, Info, ScrollText } from 'lucide-react'
import { COMPARISON_DATA, MOCK_EVENT_LOG } from '../data/mock'
import { Card, SimulationBadge, TonePill } from '../components/ui'

const LOG_TONE: Record<string, { text: string; dot: string; pill: 'green' | 'red' | 'amber' | 'cyan' | 'muted' }> = {
  info: { text: 'text-cyan-300', dot: 'bg-cyan-400', pill: 'cyan' },
  warn: { text: 'text-amber-300', dot: 'bg-amber-400', pill: 'amber' },
  error: { text: 'text-red-300', dot: 'bg-red-400', pill: 'red' },
  success: { text: 'text-emerald-300', dot: 'bg-emerald-400', pill: 'green' },
}

const FILTERS = ['all', 'error', 'warn', 'success', 'info'] as const

export default function LogsMetrics() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const rows = MOCK_EVENT_LOG.filter((l) => filter === 'all' || l.status === filter)

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-2">
          <SimulationBadge />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-white">Logs &amp; Metrics</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Simulated event stream from the self-healing loop, plus an illustrative comparison
          against a baseline agent with no recovery mechanism.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Log table */}
        <Card className="overflow-hidden xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-white">Event Log</h3>
            </div>
            <div className="flex items-center gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={[
                    'rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                    filter === f
                      ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40'
                      : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200',
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700/70 text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Event</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log, i) => {
                  const tone = LOG_TONE[log.status]
                  return (
                    <tr
                      key={`${log.t}-${i}`}
                      className="border-b border-ink-800/80 transition-colors last:border-0 hover:bg-ink-800/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-ink-400">
                        {log.t}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          <span className={`font-mono text-[11px] font-semibold ${tone.text}`}>
                            {log.event}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <TonePill tone={tone.pill}>{log.status}</TonePill>
                      </td>
                      <td className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-400">
                        {log.details}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-700 px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
              {rows.length} of {MOCK_EVENT_LOG.length} events · all simulated
            </p>
          </div>
        </Card>

        {/* Chart */}
        <Card className="p-4 xl:col-span-2">
          <div className="mb-1 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Baseline vs Self-Healing</h3>
          </div>
          <p className="mb-4 text-xs text-ink-400">
            Illustrative comparison over 50 simulated drift incidents.
          </p>
          <div className="space-y-5">
            {COMPARISON_DATA.map((row) => {
              const max = Math.max(row.baseline, row.selfHealing, 1)
              return (
                <div key={row.metric}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-ink-300">{row.metric}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-ink-500">
                        baseline
                      </span>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-ink-800">
                        <div
                          className="h-full rounded bg-gradient-to-r from-red-600/80 to-red-400/80 transition-all duration-700"
                          style={{ width: `${(row.baseline / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-red-300">
                        {row.baseline}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-ink-500">
                        healing
                      </span>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-ink-800">
                        <div
                          className="h-full rounded bg-gradient-to-r from-emerald-600/80 to-cyan-400/80 transition-all duration-700"
                          style={{ width: `${(row.selfHealing / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-emerald-300">
                        {row.selfHealing}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-5 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <p className="text-[11px] leading-relaxed text-ink-300">
                All values on this page are simulated for demonstration purposes. No real
                production traffic, LLM calls, or external APIs are involved.
              </p>
            </div>
          </div>

          {/* small recharts sparkline-style bar chart */}
          <div className="mt-5">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-400">
              Task success % by incident class (simulated)
            </p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={COMPARISON_DATA} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c1c2a" vertical={false} />
                  <XAxis
                    dataKey="metric"
                    tick={{ fill: '#7c7c94', fontSize: 9 }}
                    axisLine={{ stroke: '#1c1c2a' }}
                    tickLine={false}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={44}
                  />
                  <YAxis
                    tick={{ fill: '#7c7c94', fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(139,92,246,0.06)' }}
                    contentStyle={{
                      background: '#101018',
                      border: '1px solid #262637',
                      borderRadius: 8,
                      fontSize: 11,
                      color: '#d0d0dd',
                    }}
                  />
                  <Bar dataKey="baseline" name="Baseline" radius={[3, 3, 0, 0]}>
                    {COMPARISON_DATA.map((_, i) => (
                      <Cell key={i} fill="#7f1d1d" />
                    ))}
                  </Bar>
                  <Bar dataKey="selfHealing" name="Self-Healing" radius={[3, 3, 0, 0]}>
                    {COMPARISON_DATA.map((_, i) => (
                      <Cell key={i} fill="#10b981" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                <span className="h-2 w-2 rounded-sm bg-[#7f1d1d]" /> Baseline agent
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Self-healing agent
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
