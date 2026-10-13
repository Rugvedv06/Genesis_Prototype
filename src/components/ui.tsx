import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-ink-700 bg-ink-850 ${className}`}>{children}</div>
  )
}

export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function SimulationBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
      <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-amber-300">
        Simulation Mode — Mock API
      </span>
    </span>
  )
}

export function IllustrativeTag() {
  return (
    <span className="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
      illustrative demo metrics
    </span>
  )
}

const STATUS_TONES: Record<string, string> = {
  green: 'bg-emerald-400',
  cyan: 'bg-cyan-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
  violet: 'bg-violet-400',
}

export function StatusDot({ tone }: { tone: keyof typeof STATUS_TONES }) {
  return (
    <span className="relative flex h-2 w-2">
      <span
        className={`absolute inline-flex h-full w-full rounded-full opacity-40 ${STATUS_TONES[tone]} animate-ping`}
      />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${STATUS_TONES[tone]}`} />
    </span>
  )
}

export function TonePill({
  children,
  tone,
}: {
  children: ReactNode
  tone: 'green' | 'red' | 'amber' | 'cyan' | 'violet' | 'muted'
}) {
  const map = {
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    red: 'border-red-500/30 bg-red-500/10 text-red-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
    muted: 'border-ink-600 bg-ink-800 text-ink-300',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${map[tone]}`}
    >
      {children}
    </span>
  )
}
