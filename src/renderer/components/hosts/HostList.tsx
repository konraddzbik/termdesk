import { Button } from '@renderer/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import { buildGroupTree } from '@renderer/lib/group-tree'
import { cn } from '@renderer/lib/utils'
import { useHostsStore } from '@renderer/stores/hosts'
import { useSessionsStore } from '@renderer/stores/sessions'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Host } from '@shared/ipc'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  Loader2,
  MonitorPlay,
  Pencil,
  Plug,
  Plus,
  SearchX,
  Server,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'

interface HostListProps {
  onAddHost(): void
  onEditHost(host: Host): void
  onDuplicateHost(host: Host): void
}

type TestState =
  | { status: 'testing' }
  | { status: 'ok'; latencyMs: number }
  | { status: 'error'; error: string }

/** Flattened, indentation-aware rows for the nested group tree. */
type RenderRow =
  | {
      kind: 'group'
      key: string
      name: string
      color: string | null
      depth: number
      count: number
      collapsed: boolean
    }
  | { kind: 'host'; key: string; host: Host; depth: number }
  | { kind: 'empty'; key: string; depth: number }

const FALLBACK_DOT = '#52525b'
const UNGROUPED_KEY = '__ungrouped__'

function hostMatches(host: Host, needle: string): boolean {
  return [host.label, host.hostname, host.username, ...host.tags].some((value) =>
    value.toLowerCase().includes(needle),
  )
}

function byLabel(a: Host, b: Host): number {
  return a.label.localeCompare(b.label)
}

/** Opens a new terminal tab for the host; the terminal view drives the SSH connect. */
function openTerminalTab(host: Host): void {
  useTabsStore.getState().openTab({
    id: crypto.randomUUID(),
    kind: 'terminal',
    title: host.label,
    closable: true,
    hostId: host.id,
  })
}

/** Opens an embedded VNC viewer tab for the host (tunnelled over SSH by default). */
function openVncTab(host: Host): void {
  useTabsStore.getState().openTab({
    id: crypto.randomUUID(),
    kind: 'vnc',
    title: `${host.label} — vnc`,
    closable: true,
    hostId: host.id,
  })
}

/** Opens an embedded RDP viewer tab for the host (IronRDP over the in-process proxy). */
function openRdpTab(host: Host): void {
  useTabsStore.getState().openTab({
    id: crypto.randomUUID(),
    kind: 'rdp',
    title: `${host.label} — rdp`,
    closable: true,
    hostId: host.id,
  })
}

/** Opens an SFTP browser tab for the host (reuses a live SSH connection when possible). */
function openSftpTab(host: Host): void {
  useTabsStore.getState().openTab({
    id: crypto.randomUUID(),
    kind: 'sftp',
    title: `${host.label} — files`,
    closable: true,
    hostId: host.id,
  })
}

function IconButton({
  label,
  className,
  ...props
}: React.ComponentProps<'button'> & { label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

interface HostRowProps {
  host: Host
  test: TestState | undefined
  confirming: boolean
  depth: number
  dragging: boolean
  connected: boolean
  /** Host owns the focused session pane (primary or secondary when split). */
  active: boolean
  onDragStartHost(): void
  onDragEndHost(): void
  onConnect(): void
  onSftp(): void
  onVnc(): void
  onRdp(): void
  onTest(): void
  onEdit(): void
  onDuplicate(): void
  onDeleteRequest(): void
  onDeleteConfirm(): void
  onDeleteCancel(): void
}

function HostRow({
  host,
  test,
  confirming,
  depth,
  dragging,
  connected,
  active,
  onDragStartHost,
  onDragEndHost,
  onConnect,
  onSftp,
  onVnc,
  onRdp,
  onTest,
  onEdit,
  onDuplicate,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: HostRowProps): React.JSX.Element {
  const supportsSsh = host.kind === 'ssh' || host.kind === 'both'
  const supportsVnc = host.kind === 'vnc' || host.kind === 'both'
  const supportsRdp = host.kind === 'rdp'
  const subtitle = supportsSsh
    ? `${host.username}@${host.hostname}:${host.port}`
    : supportsRdp
      ? `${host.username}@${host.hostname}:${host.rdpPort ?? 3389} (RDP)`
      : `${host.hostname}:${host.vncPort ?? 5900} (VNC)`
  const primaryAction = supportsSsh ? onConnect : supportsRdp ? onRdp : onVnc

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', host.id)
            onDragStartHost()
          }}
          onDragEnd={onDragEndHost}
          className={cn(
            'group relative flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60',
            active && 'bg-emerald-500/20 ring-1 ring-emerald-500/25',
            dragging && 'opacity-50',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <button
            type="button"
            onClick={primaryAction}
            aria-label={
              supportsSsh
                ? `Open terminal for ${host.label}`
                : supportsRdp
                  ? `Open RDP for ${host.label}`
                  : `Open VNC for ${host.label}`
            }
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 text-left',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded',
            )}
          >
            <span
              aria-hidden="true"
              title={connected ? 'Connected' : undefined}
              className={cn(
                'size-2 shrink-0 rounded-full',
                connected && 'bg-emerald-500 ring-2 ring-emerald-500/30',
              )}
              style={connected ? undefined : { backgroundColor: host.color ?? FALLBACK_DOT }}
            />
            <span
              aria-hidden="true"
              title={
                supportsRdp
                  ? 'RDP'
                  : supportsSsh && supportsVnc
                    ? 'SSH + VNC'
                    : supportsVnc
                      ? 'VNC'
                      : 'SSH'
              }
              className="flex shrink-0 items-center gap-0.5 text-muted-foreground"
            >
              {supportsSsh && <TerminalSquare className="size-3.5" />}
              {supportsVnc && <MonitorPlay className="size-3.5" />}
              {supportsRdp && <MonitorPlay className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-tight">{host.label}</p>
              <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
            </div>
          </button>
          {test?.status === 'testing' && (
            <Loader2
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
              aria-label="Testing connection"
              role="status"
            />
          )}
          {test?.status === 'ok' && (
            <span className="shrink-0 text-[10px] font-medium text-emerald-500">
              {test.latencyMs} ms
            </span>
          )}
          {test?.status === 'error' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="max-w-16 shrink-0 cursor-default truncate text-[10px] text-destructive">
                  failed
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 break-words">{test.error}</TooltipContent>
            </Tooltip>
          )}
          <div
            className={cn(
              'shrink-0 items-center gap-0.5',
              confirming ? 'flex' : 'hidden group-focus-within:flex group-hover:flex',
            )}
          >
            {confirming ? (
              <>
                <span className="text-xs text-destructive">Delete?</span>
                <IconButton
                  label={`Confirm delete ${host.label}`}
                  className="text-destructive hover:text-destructive"
                  onClick={onDeleteConfirm}
                >
                  <Check className="size-3.5" />
                </IconButton>
                <IconButton label="Cancel delete" onClick={onDeleteCancel}>
                  <X className="size-3.5" />
                </IconButton>
              </>
            ) : (
              <>
                {supportsSsh && (
                  <IconButton label={`Connect to ${host.label}`} onClick={onConnect}>
                    <TerminalSquare className="size-3.5" />
                  </IconButton>
                )}
                {supportsSsh && (
                  <IconButton label={`Browse files on ${host.label}`} onClick={onSftp}>
                    <FolderOpen className="size-3.5" />
                  </IconButton>
                )}
                {supportsVnc && (
                  <IconButton label={`Open VNC desktop for ${host.label}`} onClick={onVnc}>
                    <MonitorPlay className="size-3.5" />
                  </IconButton>
                )}
                {supportsRdp && (
                  <IconButton label={`Open RDP desktop for ${host.label}`} onClick={onRdp}>
                    <MonitorPlay className="size-3.5" />
                  </IconButton>
                )}
                <IconButton
                  label={`Test connection to ${host.label}`}
                  onClick={onTest}
                  disabled={test?.status === 'testing'}
                >
                  <Plug className="size-3.5" />
                </IconButton>
                <IconButton label={`Edit ${host.label}`} onClick={onEdit}>
                  <Pencil className="size-3.5" />
                </IconButton>
                <IconButton label={`Delete ${host.label}`} onClick={onDeleteRequest}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </>
            )}
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {supportsSsh && (
          <ContextMenuItem onSelect={onConnect}>
            <TerminalSquare /> Open terminal
          </ContextMenuItem>
        )}
        {supportsSsh && (
          <ContextMenuItem onSelect={onSftp}>
            <FolderOpen /> Browse files
          </ContextMenuItem>
        )}
        {supportsVnc && (
          <ContextMenuItem onSelect={onVnc}>
            <MonitorPlay /> Open VNC
          </ContextMenuItem>
        )}
        {supportsRdp && (
          <ContextMenuItem onSelect={onRdp}>
            <MonitorPlay /> Open RDP
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onTest}>
          <Plug /> Test connection
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onEdit}>
          <Pencil /> Edit settings…
        </ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicate}>
          <Copy /> Duplicate…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDeleteRequest}>
          <Trash2 /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function HostList({
  onAddHost,
  onEditHost,
  onDuplicateHost,
}: HostListProps): React.JSX.Element {
  const hosts = useHostsStore((s) => s.hosts)
  const groups = useHostsStore((s) => s.groups)
  const query = useHostsStore((s) => s.query)
  const loading = useHostsStore((s) => s.loading)
  const deleteHost = useHostsStore((s) => s.deleteHost)
  const setHostGroup = useHostsStore((s) => s.setHostGroup)
  const sessions = useSessionsStore((s) => s.sessions)
  const openTabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const secondaryTabId = useTabsStore((s) => s.secondaryTabId)
  const focusedPane = useTabsStore((s) => s.focusedPane)

  // A host is "live" when any of its open tabs (terminal/SFTP/VNC) reports a
  // connected session. Drives the green status dot in the list.
  const connectedHostIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of openTabs) {
      if (t.hostId && sessions[t.id]?.status === 'connected') set.add(t.hostId)
    }
    return set
  }, [openTabs, sessions])

  const activeHostId = useMemo(() => {
    const focusedTabId =
      focusedPane === 'secondary' && secondaryTabId ? secondaryTabId : activeTabId
    return openTabs.find((t) => t.id === focusedTabId)?.hostId ?? null
  }, [openTabs, activeTabId, secondaryTabId, focusedPane])

  // Drag-and-drop: which host is being dragged, and which group header is hovered.
  const [draggingHostId, setDraggingHostId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  function dropOnGroup(key: string): void {
    if (draggingHostId) {
      void setHostGroup(draggingHostId, key === UNGROUPED_KEY ? null : key)
    }
    setDraggingHostId(null)
    setDragOverKey(null)
  }

  const [tests, setTests] = useState<Record<string, TestState>>({})
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function testKey(host: Host): string {
    return `${host.id}:${host.hostname}:${host.port}`
  }

  function toggleGroup(key: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filtering = query.trim().length > 0

  const { rows, visibleCount } = useMemo<{ rows: RenderRow[]; visibleCount: number }>(() => {
    const needle = query.trim().toLowerCase()
    const visible = needle ? hosts.filter((h) => hostMatches(h, needle)) : hosts
    const hostsOf = (groupId: string): Host[] =>
      visible.filter((h) => h.groupId === groupId).sort(byLabel)

    // Count of visible hosts in a group's whole subtree — drives the badge and,
    // while searching, prunes branches that contain no matches.
    const subtreeCount = new Map<string, number>()
    const tree = buildGroupTree(groups)
    const countNode = (node: (typeof tree)[number]): number => {
      const total =
        hostsOf(node.group.id).length + node.children.reduce((s, c) => s + countNode(c), 0)
      subtreeCount.set(node.group.id, total)
      return total
    }
    for (const node of tree) countNode(node)

    const out: RenderRow[] = []
    const walk = (node: (typeof tree)[number]): void => {
      const count = subtreeCount.get(node.group.id) ?? 0
      if (needle && count === 0) return // hide non-matching branch while searching
      const isCollapsed = !needle && collapsed.has(node.group.id)
      out.push({
        kind: 'group',
        key: node.group.id,
        name: node.group.name,
        color: node.group.color,
        depth: node.depth,
        count,
        collapsed: isCollapsed,
      })
      if (isCollapsed) return
      for (const child of node.children) walk(child)
      for (const host of hostsOf(node.group.id)) {
        out.push({ kind: 'host', key: host.id, host, depth: node.depth + 1 })
      }
      // Only a truly empty leaf shows an "Empty" placeholder — a parent whose
      // emptiness is already conveyed by its (empty) child groups does not.
      if (count === 0 && node.children.length === 0) {
        out.push({ kind: 'empty', key: `${node.group.id}:empty`, depth: node.depth + 1 })
      }
    }
    for (const node of tree) walk(node)

    const ids = new Set(groups.map((g) => g.id))
    const ungrouped = visible.filter((h) => h.groupId === null || !ids.has(h.groupId)).sort(byLabel)
    if (ungrouped.length > 0) {
      const isCollapsed = !needle && collapsed.has(UNGROUPED_KEY)
      out.push({
        kind: 'group',
        key: UNGROUPED_KEY,
        name: 'Ungrouped',
        color: null,
        depth: 0,
        count: ungrouped.length,
        collapsed: isCollapsed,
      })
      if (!isCollapsed) {
        for (const host of ungrouped) out.push({ kind: 'host', key: host.id, host, depth: 1 })
      }
    }

    return { rows: out, visibleCount: visible.length }
  }, [hosts, groups, query, collapsed])

  async function runTest(host: Host): Promise<void> {
    const key = testKey(host)
    setTests((prev) => ({ ...prev, [key]: { status: 'testing' } }))
    try {
      const result = await window.api.hosts.test(host.id)
      setTests((prev) => ({
        ...prev,
        [key]: result.ok
          ? { status: 'ok', latencyMs: Math.round(result.latencyMs ?? 0) }
          : { status: 'error', error: result.error ?? 'Connection failed' },
      }))
    } catch (error) {
      setTests((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    setConfirmingId(null)
    await deleteHost(id)
  }

  if (loading && hosts.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span className="text-sm">Loading hosts…</span>
      </div>
    )
  }

  if (hosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
        <Server className="size-6 text-muted-foreground/60" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No hosts yet</p>
        <Button variant="secondary" size="sm" onClick={onAddHost}>
          <Plus />
          Add your first host
        </Button>
        <p className="text-xs text-muted-foreground/70">or import from ~/.ssh/config below</p>
      </div>
    )
  }

  if (filtering && visibleCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
        <SearchX className="size-5 text-muted-foreground/60" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No hosts match</p>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="Hosts" className="px-1 pb-2">
        <ul className="flex flex-col gap-px">
          {rows.map((row) => {
            if (row.kind === 'group') {
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(row.key)}
                    aria-expanded={!row.collapsed}
                    onDragOver={(e) => {
                      // Allow the drop only while a host is being dragged.
                      if (draggingHostId) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dragOverKey !== row.key) setDragOverKey(row.key)
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      dropOnGroup(row.key)
                    }}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-2 pt-2.5 pb-1 text-left hover:bg-accent/40',
                      draggingHostId &&
                        dragOverKey === row.key &&
                        'bg-accent/60 ring-1 ring-ring ring-inset',
                    )}
                    style={{ paddingLeft: 8 + row.depth * 14 }}
                  >
                    {row.collapsed ? (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color ?? FALLBACK_DOT }}
                    />
                    <span className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {row.name}
                    </span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {row.count}
                    </span>
                  </button>
                </li>
              )
            }
            if (row.kind === 'empty') {
              return (
                <li
                  key={row.key}
                  className="px-2 pb-1 text-xs text-muted-foreground"
                  style={{ paddingLeft: 8 + row.depth * 14 }}
                >
                  Empty
                </li>
              )
            }
            const host = row.host
            return (
              <HostRow
                key={row.key}
                host={host}
                depth={row.depth}
                test={tests[testKey(host)]}
                confirming={confirmingId === host.id}
                connected={connectedHostIds.has(host.id)}
                active={activeHostId === host.id}
                dragging={draggingHostId === host.id}
                onDragStartHost={() => setDraggingHostId(host.id)}
                onDragEndHost={() => {
                  setDraggingHostId(null)
                  setDragOverKey(null)
                }}
                onConnect={() => openTerminalTab(host)}
                onSftp={() => openSftpTab(host)}
                onVnc={() => openVncTab(host)}
                onRdp={() => openRdpTab(host)}
                onTest={() => void runTest(host)}
                onEdit={() => onEditHost(host)}
                onDuplicate={() => onDuplicateHost(host)}
                onDeleteRequest={() => setConfirmingId(host.id)}
                onDeleteConfirm={() => void confirmDelete(host.id)}
                onDeleteCancel={() => setConfirmingId(null)}
              />
            )
          })}
        </ul>
      </nav>
    </TooltipProvider>
  )
}
