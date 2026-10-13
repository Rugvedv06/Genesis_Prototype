import { useCallback, useEffect, useRef, useState } from 'react'
import {
  INITIAL_STEP_STATES,
  WORKFLOW_STEPS,
  nextLogTimestamp,
  type LogEntry,
  type Scenario,
  type StepId,
  type StepState,
} from '../data/mock'

export type DemoResult = null | 'success' | 'human'

export interface DemoUiState {
  request: unknown
  error: unknown
  diagnosis: string | null
  patch: unknown
  retryRequest: unknown
  response: unknown
}

const EMPTY_UI: DemoUiState = {
  request: null,
  error: null,
  diagnosis: null,
  patch: null,
  retryRequest: null,
  response: null,
}

export interface DemoState {
  running: boolean
  done: boolean
  result: DemoResult
  stepIndex: number
  stepStates: Record<StepId, StepState>
  logs: LogEntry[]
  ui: DemoUiState
}

function freshState(): DemoState {
  return {
    running: false,
    done: false,
    result: null,
    stepIndex: 0,
    stepStates: { ...INITIAL_STEP_STATES },
    logs: [],
    ui: { ...EMPTY_UI },
  }
}

export function useDemoEngine(scenario: Scenario) {
  const [state, setState] = useState<DemoState>(freshState)
  const [activeScenario, setActiveScenario] = useState(scenario)
  const runToken = useRef(0)

  // Reset simulation state when the selected scenario changes
  if (activeScenario !== scenario) {
    setActiveScenario(scenario)
    setState(freshState())
  }

  const stop = useCallback(() => {
    runToken.current += 1
  }, [])

  const reset = useCallback(() => {
    runToken.current += 1
    setState(freshState())
  }, [])

  const start = useCallback(() => {
    const token = ++runToken.current
    setState(freshState())

    void (async () => {
      // small pause so "running" state paints first
      await new Promise((r) => setTimeout(r, 60))
      if (runToken.current !== token) return
      setState((s) => ({ ...s, running: true }))

      for (const frame of scenario.frames) {
        await new Promise((r) => setTimeout(r, frame.wait))
        if (runToken.current !== token) return

        const t = frame.log ? nextLogTimestamp() : undefined

        setState((s) => {
          const next: DemoState = { ...s }
          if (frame.step) {
            const idx = WORKFLOW_STEPS.findIndex((w) => w.id === frame.step)
            if (idx >= 0) next.stepIndex = idx
            if (frame.stepState) {
              next.stepStates = { ...s.stepStates, [frame.step!]: frame.stepState }
            }
          }
          if (frame.log) {
            next.logs = [...s.logs, { ...frame.log, t: t! }]
          }
          if (frame.ui) {
            next.ui = { ...s.ui, ...frame.ui }
          }
          if (frame.finish) {
            next.done = true
            next.running = false
            next.result = frame.finish
          }
          return next
        })
      }
    })()
  }, [scenario])

  // Cancel any in-flight run when the scenario changes or on unmount
  useEffect(() => {
    return () => {
      runToken.current += 1
    }
  }, [scenario])

  return { state, start, reset, stop }
}
