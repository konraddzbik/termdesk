import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { descendantIds, flattenGroupTree } from '@renderer/lib/group-tree'
import { cn } from '@renderer/lib/utils'
import { type HostRunStatus, type RunState, useAutomationStore } from '@renderer/stores/automation'
import { useHostsStore } from '@renderer/stores/hosts'
import { useSnippetsStore } from '@renderer/stores/snippets'
import type { AutomationJob, Host } from '@shared/ipc'
import { Loader2, Play, Plus, Save, Square, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const STATUS_META: Record<HostRunStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
  running: { label: 'Running', className: 'bg-blue-500/15 text-blue-400' },
  success: { label: 'Exit 0', className: 'bg-emerald-500/15 text-emerald-400' },
  failed: { label: 'Failed', className: 'bg-amber-500/15 text-amber-400' },
  error: { label: 'Error', className: 'bg-destructive/15 text-destructive' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
}

function StatusBadge({ status, exitCode }: { status: HostRunStatus; exitCode: number | null }) {
  const meta = STATUS_META[status]
  const label = status === 'failed' && exitCode !== null ? `Exit ${exitCode}` : meta.label
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', meta.className)}>
      {status === 'running' && <Loader2 className="mr-1 inline size-2.5 animate-spin" />}
      {label}
    </span>
  )
}

function HostResultRow({
  host,
  state,
}: {
  host: Host | undefined
  state: RunState['hosts'][string]
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const title = host?.label ?? state.hostId
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/50"
      >
        <StatusBadge status={state.status} exitCode={state.exitCode} />
        <span className="truncate text-sm">{title}</span>
        {host && (
          <span className="truncate text-xs text-muted-foreground">
            {host.username}@{host.hostname}
          </span>
        )}
      </button>
      {open && (state.output || state.error) && (
        <pre className="max-h-64 overflow-auto border-t bg-background px-2 py-1.5 font-mono text-xs whitespace-pre-wrap">
          {state.output}
          {state.error && <span className="text-destructive">{state.error}</span>}
        </pre>
      )}
    </div>
  )
}

function HostCheckRow({
  host,
  checked,
  onToggle,
  indent = 6,
}: {
  host: Host
  checked: boolean
  onToggle(): void
  indent?: number
}): React.JSX.Element {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/60"
      style={{ paddingLeft: indent }}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{host.label}</span>
    </label>
  )
}

export function AutomationTab(): React.JSX.Element {
  const hosts = useHostsStore((s) => s.hosts)
  const groups = useHostsStore((s) => s.groups)
  const loadHosts = useHostsStore((s) => s.loadAll)
  const snippets = useSnippetsStore((s) => s.snippets)
  const loadSnippets = useSnippetsStore((s) => s.load)

  const jobs = useAutomationStore((s) => s.jobs)
  const loadJobs = useAutomationStore((s) => s.loadJobs)
  const createJob = useAutomationStore((s) => s.createJob)
  const updateJob = useAutomationStore((s) => s.updateJob)
  const deleteJob = useAutomationStore((s) => s.deleteJob)
  const startRun = useAutomationStore((s) => s.startRun)
  const cancelRun = useAutomationStore((s) => s.cancelRun)
  const currentRunId = useAutomationStore((s) => s.currentRunId)
  const runs = useAutomationStore((s) => s.runs)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadHosts()
    void loadSnippets()
    void loadJobs()
  }, [loadHosts, loadSnippets, loadJobs])

  // SSH-capable hosts only (a pure-VNC host can't run commands).
  const sshHosts = useMemo(() => hosts.filter((h) => h.kind !== 'vnc'), [hosts])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sshHosts
    return sshHosts.filter((h) =>
      [h.label, h.hostname, h.username].some((v) => v.toLowerCase().includes(q)),
    )
  }, [sshHosts, search])
  const hostById = useMemo(() => new Map(hosts.map((h) => [h.id, h])), [hosts])

  // Group selection: flattened (indented) group list, the SSH hosts directly in
  // each group, and the full id set per group (including nested subgroups) so a
  // group's checkbox selects everything beneath it.
  const groupTree = useMemo(() => flattenGroupTree(groups), [groups])
  const validGroupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups])
  const directHosts = useMemo(() => {
    const map = new Map<string | null, Host[]>()
    for (const h of sshHosts) {
      const key = h.groupId && validGroupIds.has(h.groupId) ? h.groupId : null
      const arr = map.get(key)
      if (arr) arr.push(h)
      else map.set(key, [h])
    }
    return map
  }, [sshHosts, validGroupIds])
  const groupHostIds = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const { group } of groupTree) {
      const descendants = descendantIds(groups, group.id)
      map.set(
        group.id,
        sshHosts.filter((h) => h.groupId && descendants.has(h.groupId)).map((h) => h.id),
      )
    }
    return map
  }, [groupTree, groups, sshHosts])

  const groupChecked = (groupId: string): boolean => {
    const ids = groupHostIds.get(groupId) ?? []
    return ids.length > 0 && ids.every((id) => selected.has(id))
  }
  const toggleGroup = (groupId: string): void => {
    const ids = groupHostIds.get(groupId) ?? []
    if (ids.length === 0) return
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }
  const ungrouped = directHosts.get(null) ?? []

  const run = currentRunId ? runs[currentRunId] : undefined
  const isRunning =
    run !== undefined &&
    Object.values(run.hosts).some((h) => h.status === 'running' || h.status === 'pending')

  function toggleHost(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetForm(): void {
    setEditingJobId(null)
    setName('')
    setCommand('')
    setSelected(new Set())
  }

  function loadJobIntoForm(job: AutomationJob): void {
    setEditingJobId(job.id)
    setName(job.name)
    setCommand(job.command)
    setSelected(new Set(job.hostIds))
  }

  async function handleRun(): Promise<void> {
    setError(null)
    if (!command.trim()) return setError('Enter a command or pick a snippet.')
    if (selected.size === 0) return setError('Select at least one host.')
    setBusy(true)
    try {
      await startRun(command, [...selected])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(): Promise<void> {
    setError(null)
    if (!name.trim()) return setError('Name the job to save it.')
    if (!command.trim()) return setError('Enter a command to save.')
    setBusy(true)
    try {
      const input = { name: name.trim(), command, hostIds: [...selected] }
      if (editingJobId) await updateJob(editingJobId, input)
      else await createJob(input)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* Left: saved jobs + host selection */}
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="border-b p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Saved jobs</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={resetForm}
              title="New run"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="flex flex-col gap-0.5">
            {jobs.length === 0 && (
              <p className="px-1 text-xs text-muted-foreground">No saved jobs yet.</p>
            )}
            {jobs.map((job) => (
              <div
                key={job.id}
                className={cn(
                  'group flex items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-accent/60',
                  editingJobId === job.id && 'bg-accent',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => loadJobIntoForm(job)}
                  title={`${job.hostIds.length} host(s)`}
                >
                  {job.name}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {job.hostIds.length}
                  </span>
                </button>
                <button
                  type="button"
                  className="hidden text-muted-foreground hover:text-foreground group-hover:block group-focus-within:block"
                  title="Run job"
                  onClick={() => void startRun(job.command, job.hostIds)}
                >
                  <Play className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="hidden text-muted-foreground hover:text-destructive group-hover:block group-focus-within:block"
                  title="Delete job"
                  onClick={() => void deleteJob(job.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-xs font-semibold text-muted-foreground">
            Hosts ({selected.size} selected)
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(new Set(sshHosts.map((h) => h.id)))}
            >
              All
            </button>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(new Set())}
            >
              None
            </button>
          </div>
        </div>
        <div className="px-2 py-1.5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter hosts…"
            className="h-8"
          />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {search.trim() ? (
              // While filtering, a flat list is easier to scan than nested groups.
              filtered.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground">No matching hosts.</p>
              ) : (
                filtered.map((h) => (
                  <HostCheckRow
                    key={h.id}
                    host={h}
                    checked={selected.has(h.id)}
                    onToggle={() => toggleHost(h.id)}
                  />
                ))
              )
            ) : (
              <>
                {groupTree.map(({ group, depth }) => {
                  const count = (groupHostIds.get(group.id) ?? []).length
                  return (
                    <div key={group.id}>
                      <label
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs font-medium hover:bg-accent/60"
                        style={{ paddingLeft: 6 + depth * 12 }}
                      >
                        <input
                          type="checkbox"
                          checked={groupChecked(group.id)}
                          disabled={count === 0}
                          onChange={() => toggleGroup(group.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{group.name}</span>
                        <span className="text-[10px] text-muted-foreground">{count}</span>
                      </label>
                      {(directHosts.get(group.id) ?? []).map((h) => (
                        <HostCheckRow
                          key={h.id}
                          host={h}
                          checked={selected.has(h.id)}
                          onToggle={() => toggleHost(h.id)}
                          indent={6 + (depth + 1) * 12}
                        />
                      ))}
                    </div>
                  )
                })}
                {ungrouped.length > 0 && (
                  <div>
                    <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
                      Ungrouped
                    </div>
                    {ungrouped.map((h) => (
                      <HostCheckRow
                        key={h.id}
                        host={h}
                        checked={selected.has(h.id)}
                        onToggle={() => toggleHost(h.id)}
                        indent={18}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right: command + run + results */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b p-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Job name (to save)"
              className="h-8"
            />
            <Select
              value=""
              onValueChange={(id) => {
                const s = snippets.find((sn) => sn.id === id)
                if (s) setCommand(s.command)
              }}
            >
              <SelectTrigger className="h-8 w-44" aria-label="Insert snippet">
                <SelectValue placeholder="From snippet…" />
              </SelectTrigger>
              <SelectContent>
                {snippets.length === 0 && (
                  <SelectItem value="__none" disabled>
                    No snippets
                  </SelectItem>
                )}
                {snippets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Label htmlFor="automation-command" className="sr-only">
            Command
          </Label>
          <textarea
            id="automation-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Command / script to run on each selected host…"
            spellCheck={false}
            className="min-h-20 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={() => void handleRun()} disabled={busy}>
              <Play className="size-4" />
              Run on {selected.size} host{selected.size === 1 ? '' : 's'}
            </Button>
            {isRunning && currentRunId && (
              <Button variant="outline" onClick={() => void cancelRun(currentRunId)}>
                <Square className="size-4" />
                Cancel
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={() => void handleSave()} disabled={busy}>
              <Save className="size-4" />
              {editingJobId ? 'Update job' : 'Save job'}
            </Button>
            {editingJobId && (
              <Button variant="ghost" size="icon" onClick={resetForm} title="New run">
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 p-3">
            {!run && (
              <p className="text-sm text-muted-foreground">
                Select hosts, enter a command (or pick a snippet), and Run. Results stream here per
                host.
              </p>
            )}
            {run?.hostIds.map((hostId) => {
              const hostState = run.hosts[hostId]
              if (!hostState) return null
              return <HostResultRow key={hostId} host={hostById.get(hostId)} state={hostState} />
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
