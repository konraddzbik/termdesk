import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import {
  DEFAULT_MODEL,
  estimateTokens,
  MODEL_RATES,
  matchesAudit,
  rateFor,
  summarizeUsage,
} from '@renderer/lib/ai-usage'
import { useAiAuditStore } from '@renderer/stores/aiAudit'
import type { AiAuditEntry } from '@shared/ipc'
import { Bot, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

// Alpha-based fills so the badges read correctly in BOTH light and dark themes.
const VERDICT_STYLE: Record<AiAuditEntry['verdict'], string> = {
  allow: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  'needs-approval': 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
  deny: 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
}

const OUTCOME_LABEL: Record<AiAuditEntry['outcome'], string> = {
  ok: 'ok',
  auto: 'auto-allowed',
  approved: 'approved',
  denied: 'denied',
  error: 'error',
}

const NUM = new Intl.NumberFormat()

function Row({ entry }: { entry: AiAuditEntry }): React.JSX.Element {
  const time = new Date(entry.ts).toLocaleTimeString()
  const tokens = estimateTokens(entry.inBytes) + estimateTokens(entry.outBytes)
  return (
    <div className="flex flex-col gap-1 border-b px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${VERDICT_STYLE[entry.verdict]}`}
        >
          {entry.verdict}
        </span>
        <span className="font-mono text-xs text-foreground">{entry.tool}</span>
        {entry.hostLabel && (
          <span className="text-xs text-muted-foreground">on {entry.hostLabel}</span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{time}</span>
      </div>
      <div className="truncate text-xs text-muted-foreground" title={entry.summary}>
        {entry.summary}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {entry.client && <span>client: {entry.client}</span>}
        <span>· {OUTCOME_LABEL[entry.outcome]}</span>
        {entry.detail && (
          <span className="truncate" title={entry.detail}>
            · {entry.detail}
          </span>
        )}
        {entry.durationMs != null && <span>· {entry.durationMs}ms</span>}
        {tokens > 0 && (
          <span title="Approximate — I/O relayed through TermDesk">
            · ≈{NUM.format(tokens)} tok
          </span>
        )}
      </div>
    </div>
  )
}

/** A live, searchable view of every AI agent action (MCP audit log), with an
 *  approximate local usage/cost estimate. */
export function AiActivityTab(): React.JSX.Element {
  const entries = useAiAuditStore((s) => s.entries)
  const load = useAiAuditStore((s) => s.load)
  const clear = useAiAuditStore((s) => s.clear)

  const [query, setQuery] = useState('')
  const [verdict, setVerdict] = useState<'all' | AiAuditEntry['verdict']>('all')
  const [model, setModel] = useState(DEFAULT_MODEL)

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () =>
      entries.filter((e) => (verdict === 'all' || e.verdict === verdict) && matchesAudit(e, query)),
    [entries, verdict, query],
  )

  const rate = rateFor(model)
  const usage = useMemo(() => summarizeUsage(filtered, rate), [filtered, rate])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-semibold">AI Activity</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          every decision &amp; action an AI agent takes through TermDesk
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void clear()}
          disabled={entries.length === 0}
        >
          <Trash2 className="size-4" />
          Clear
        </Button>
      </div>

      {/* Search + filters */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="flex min-w-40 flex-1 items-center gap-2 rounded-md border bg-background px-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search host, command, client…"
            aria-label="Search AI activity"
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Select value={verdict} onValueChange={(v) => setVerdict(v as typeof verdict)}>
          <SelectTrigger className="h-8 w-40" aria-label="Filter by verdict">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verdicts</SelectItem>
            <SelectItem value="allow">Allowed</SelectItem>
            <SelectItem value="needs-approval">Needs approval</SelectItem>
            <SelectItem value="deny">Denied</SelectItem>
          </SelectContent>
        </Select>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="h-8 w-40" aria-label="Cost estimate model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MODEL_RATES).map(([key, r]) => (
              <SelectItem key={key} value={key}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Usage estimate strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-2 text-xs">
        <span className="font-medium text-foreground">{NUM.format(usage.actions)} actions</span>
        <span className="text-muted-foreground">
          ≈ {NUM.format(usage.inTokens)} in / {NUM.format(usage.outTokens)} out tokens
        </span>
        <span className="font-medium text-foreground">≈ ${usage.costUsd.toFixed(4)}</span>
        <span
          className="text-muted-foreground/80"
          title="TermDesk is an MCP server — it can't see the provider's real token usage. This is a rough estimate from the I/O relayed through TermDesk × the selected model's list price, not an actual bill."
        >
          · approximate (relayed I/O × {rate.label} list price — not a provider bill)
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No AI activity yet. Enable the MCP server in Settings → AI Agent to let an agent
            connect.
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No activity matches your search or filter.
          </div>
        ) : (
          filtered.map((e) => <Row key={e.id} entry={e} />)
        )}
      </ScrollArea>
    </div>
  )
}
