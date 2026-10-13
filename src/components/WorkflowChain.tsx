import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Loader2,
  XCircle,
} from 'lucide-react'
import { WORKFLOW_STEPS, type StepState } from '../data/mock'

const STATE_STYLE: Record<
  StepState,
  { ring: string; icon: ReactNode; label: string; caption: string }
> = {
  pending: {
    ring: 'border-ink-600 bg-ink-850',
    icon: <CircleDot className="h-4 w-4 text-ink-400" />,
    label: 'text-ink-400',
    caption: 'text-ink-400/70',
  },
  active: {
    ring: 'border-violet-500/70 bg-violet-500/10 shadow-[0_0_24px_rgba(139,92,246,0.25)]',
    icon: <Loader2 className="h-4 w-4 animate-spin text-violet-300" />,
    label: 'text-white',
    caption: 'text-violet-300/80',
  },
  success: {
    ring: 'border-emerald-500/50 bg-emerald-500/10',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    label: 'text-emerald-200',
    caption: 'text-emerald-400/70',
  },
  error: {
    ring: 'border-red-500/60 bg-red-500/10 shadow-[0_0_24px_rgba(239,68,68,0.2)]',
    icon: <XCircle className="h-4 w-4 text-red-400" />,
    label: 'text-red-200',
    caption: 'text-red-400/80',
  },
  blocked: {
    ring: 'border-amber-500/60 bg-amber-500/10 shadow-[0_0_24px_rgba(245,158,11,0.2)]',
    icon: <AlertTriangle className="h-4 w-4 text-amber-400" />,
    label: 'text-amber-200',
    caption: 'text-amber-400/80',
  },
}

const connectorTone = (state: StepState) => {
  if (state === 'success') return 'bg-emerald-500/60'
  if (state === 'error') return 'bg-red-500/60'
  if (state === 'blocked') return 'bg-amber-500/60'
  if (state === 'active') return 'bg-violet-400/70'
  return 'bg-ink-600'
}

export default function WorkflowChain({
  stepStates,
}: {
  stepStates: Record<string, StepState>
}) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-1 py-1">
        {WORKFLOW_STEPS.map((step, i) => {
          const state = (stepStates[step.id] ?? 'pending') as StepState
          const style = STATE_STYLE[state]
          return (
            <div key={step.id} className="flex items-center">
              <div
                className={`flex w-[108px] flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-all duration-300 ${style.ring}`}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-700/60 bg-ink-900">
                  {style.icon}
                </div>
                <p className={`text-center text-[11px] font-semibold leading-tight ${style.label}`}>
                  {step.label}
                </p>
                <p className={`text-center text-[9.5px] leading-tight ${style.caption}`}>
                  {step.caption}
                </p>
              </div>
              {i < WORKFLOW_STEPS.length - 1 && (
                <div className="flex w-6 items-center justify-center">
                  <div
                    className={`h-[2px] w-full rounded-full transition-colors duration-300 ${connectorTone(
                      state,
                    )}`}
                  />
                  <ArrowRight
                    className={`-ml-1 h-3 w-3 shrink-0 transition-colors duration-300 ${
                      state === 'success'
                        ? 'text-emerald-400'
                        : state === 'error'
                          ? 'text-red-400'
                          : state === 'blocked'
                            ? 'text-amber-400'
                            : state === 'active'
                              ? 'text-violet-400'
                              : 'text-ink-600'
                    }`}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
