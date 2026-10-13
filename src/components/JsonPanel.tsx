import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'

type Tone = 'default' | 'error' | 'success' | 'warn'

const TONE_RING: Record<Tone, string> = {
  default: 'border-ink-700',
  error: 'border-red-500/40',
  success: 'border-emerald-500/40',
  warn: 'border-amber-500/40',
}

const TONE_TITLE: Record<Tone, string> = {
  default: 'text-ink-300',
  error: 'text-red-300',
  success: 'text-emerald-300',
  warn: 'text-amber-300',
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightJson(json: string, highlightKeys: string[] = []) {
  const escaped = escapeHtml(json)
  return escaped.replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'text-cyan-300'
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          const key = match.slice(1, -2)
          cls = highlightKeys.includes(key) ? 'text-red-400 font-semibold' : 'text-violet-300'
        } else {
          cls = 'text-emerald-300'
        }
      } else if (/^(true|false)$/.test(match)) {
        cls = 'text-amber-300'
      } else if (/^null$/.test(match)) {
        cls = 'text-ink-400'
      }
      return `<span class="${cls}">${match}</span>`
    },
  )
}

interface Props {
  title: string
  data: unknown
  tone?: Tone
  highlightKeys?: string[]
  emptyText?: string
  defaultOpen?: boolean
  monoLabel?: string
}

export default function JsonPanel({
  title,
  data,
  tone = 'default',
  highlightKeys,
  emptyText = 'Waiting for demo…',
  defaultOpen = true,
  monoLabel,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)

  const json = useMemo(
    () => (data === null || data === undefined ? null : JSON.stringify(data, null, 2)),
    [data],
  )

  const html = useMemo(
    () => (json ? highlightJson(json, highlightKeys) : ''),
    [json, highlightKeys],
  )

  const copy = async () => {
    if (!json) return
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable in prototype */
    }
  }

  return (
    <div className={`overflow-hidden rounded-xl border bg-ink-850 ${TONE_RING[tone]}`}>
      <div className="flex items-center justify-between border-b border-ink-700/70 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          )}
          <span className={`truncate font-mono text-[11px] uppercase tracking-wider ${TONE_TITLE[tone]}`}>
            {title}
          </span>
          {monoLabel && (
            <span className="ml-1 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
              {monoLabel}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {json && (
            <button
              type="button"
              onClick={copy}
              className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
              title="Copy JSON"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="max-h-64 overflow-auto px-3 py-2.5">
          {json ? (
            <pre
              className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p className="py-2 text-center font-mono text-[11px] text-ink-400">{emptyText}</p>
          )}
        </div>
      )}
    </div>
  )
}
