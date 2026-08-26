import {
  duplicateLocalTerminal,
  openLocalTerminalInFolder,
  openLocalTerminalsSideBySide,
  openLocalTerminalTab,
} from '@renderer/lib/local-terminal'
import { useHostsStore } from '@renderer/stores/hosts'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import type { Host } from '@shared/ipc'
import { Command } from 'cmdk'
import {
  BookText,
  Bot,
  Clock,
  Columns2,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderTree,
  Import,
  KeyRound,
  MonitorPlay,
  Moon,
  Network,
  Plus,
  Settings,
  SquareTerminal,
  Sun,
  TerminalSquare,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface CommandPaletteProps {
  open: boolean
  onOpenChange(open: boolean): void
  onAddHost(): void
  onOpenSettings(): void
}

function openTab(host: Host, kind: 'terminal' | 'sftp' | 'vnc'): void {
  const titles = {
    terminal: host.label,
    sftp: `${host.label} — files`,
    vnc: `${host.label} — vnc`,
  } as const
  useTabsStore.getState().openTab({
    id: crypto.randomUUID(),
    kind,
    title: titles[kind],
    closable: true,
    hostId: host.id,
  })
}

/** Ctrl/Cmd+K fuzzy palette: hosts (terminal/SFTP/VNC) and app commands. */
export function CommandPalette({
  open,
  onOpenChange,
  onAddHost,
  onOpenSettings,
}: CommandPaletteProps): React.JSX.Element {
  const hosts = useHostsStore((s) => s.hosts)
  const loadAll = useHostsStore((s) => s.loadAll)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const setCredentialsOpen = useUiStore((s) => s.setCredentialsOpen)
  const setGroupsOpen = useUiStore((s) => s.setGroupsOpen)
  const setTunnelDialogOpen = useUiStore((s) => s.setTunnelDialogOpen)
  const setPromptCreateOpen = useUiStore((s) => s.setPromptCreateOpen)
  const openTabs = useTabsStore((s) => s.tabs)
  const [query, setQuery] = useState('')

  // Hosts you're currently working with (most-recently-opened first) — a quick
  // jump-back list surfaced above the full host list.
  const recentHosts = useMemo(() => {
    const seen = new Set<string>()
    const out: Host[] = []
    for (const t of [...openTabs].reverse()) {
      if (!t.hostId || seen.has(t.hostId)) continue
      seen.add(t.hostId)
      const h = hosts.find((x) => x.id === t.hostId)
      if (h) out.push(h)
    }
    return out.slice(0, 5)
  }, [openTabs, hosts])

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const run = (action: () => void): void => {
    onOpenChange(false)
    action()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className="fixed left-1/2 top-24 z-50 w-[36rem] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
      overlayClassName="fixed inset-0 z-50 bg-black/50"
      loop
    >
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Search hosts and commands…"
        className="h-11 w-full border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-80 overflow-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing found.
        </Command.Empty>
        {recentHosts.length > 0 && (
          <Command.Group
            heading="Recent"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {recentHosts.map((host) => {
              const supportsSsh = host.kind !== 'vnc'
              const Icon = supportsSsh ? TerminalSquare : MonitorPlay
              return (
                <Command.Item
                  key={`recent-${host.id}`}
                  value={`recent ${host.label} ${host.hostname}`}
                  onSelect={() => run(() => openTab(host, supportsSsh ? 'terminal' : 'vnc'))}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span>{host.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {supportsSsh ? `${host.username}@${host.hostname}` : host.hostname}
                  </span>
                </Command.Item>
              )
            })}
          </Command.Group>
        )}
        {hosts.length > 0 && (
          <Command.Group
            heading="Hosts"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {hosts.map((host) => {
              const supportsSsh = host.kind !== 'vnc'
              const primaryKind: 'terminal' | 'vnc' = supportsSsh ? 'terminal' : 'vnc'
              const PrimaryIcon = supportsSsh ? TerminalSquare : MonitorPlay
              const primaryLabel = supportsSsh ? host.label : `${host.label} (VNC)`
              return (
                <Command.Item
                  key={host.id}
                  value={`connect ${host.label} ${host.hostname} ${host.username} ${host.tags.join(' ')}`}
                  onSelect={() => run(() => openTab(host, primaryKind))}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <PrimaryIcon className="size-4 text-muted-foreground" />
                  <span>{primaryLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    {supportsSsh ? `${host.username}@${host.hostname}` : host.hostname}
                  </span>
                </Command.Item>
              )
            })}
            {query.trim() !== '' &&
              hosts
                .filter((h) => h.kind !== 'vnc')
                .map((host) => (
                  <Command.Item
                    key={`${host.id}-sftp`}
                    value={`files sftp ${host.label} ${host.hostname}`}
                    onSelect={() => run(() => openTab(host, 'sftp'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    <FolderOpen className="size-4 text-muted-foreground" />
                    <span>Files on {host.label}</span>
                  </Command.Item>
                ))}
            {query.trim() !== '' &&
              hosts
                .filter((h) => h.kind !== 'ssh')
                .map((host) => (
                  <Command.Item
                    key={`${host.id}-vnc`}
                    value={`vnc desktop ${host.label} ${host.hostname}`}
                    onSelect={() => run(() => openTab(host, 'vnc'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    <MonitorPlay className="size-4 text-muted-foreground" />
                    <span>VNC to {host.label}</span>
                  </Command.Item>
                ))}
          </Command.Group>
        )}
        <Command.Group
          heading="Commands"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <Command.Item
            value="add new host"
            onSelect={() => run(onAddHost)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Plus className="size-4 text-muted-foreground" /> Add host
          </Command.Item>
          <Command.Item
            value="new local terminal shell"
            onSelect={() => run(() => openLocalTerminalTab())}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <SquareTerminal className="size-4 text-muted-foreground" /> New local terminal
          </Command.Item>
          <Command.Item
            value="new prompt prompt book template"
            onSelect={() => run(() => setPromptCreateOpen(true))}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <BookText className="size-4 text-muted-foreground" /> New prompt
          </Command.Item>
          <Command.Item
            value="open terminal in folder directory pick browse cd"
            onSelect={() => run(() => void openLocalTerminalInFolder())}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <FolderOpen className="size-4 text-muted-foreground" /> Open terminal in folder…
          </Command.Item>
          <Command.Item
            value="duplicate current terminal same directory"
            onSelect={() =>
              run(() => {
                const { tabs, activeTabId } = useTabsStore.getState()
                const active = tabs.find((t) => t.id === activeTabId)
                if (active) duplicateLocalTerminal(active)
              })
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Copy className="size-4 text-muted-foreground" /> Duplicate current terminal
          </Command.Item>
          <Command.Item
            value="split panes side by side two terminals dual"
            onSelect={() => run(() => useTabsStore.getState().toggleSplit('horizontal'))}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Columns2 className="size-4 text-muted-foreground" /> Split panes side by side
          </Command.Item>
          <Command.Item
            value="open two directories side by side dual workspace claude grok"
            onSelect={() =>
              run(async () => {
                const a = await window.api.localTerminals.pickDirectory()
                if (!a) return
                const b = await window.api.localTerminals.pickDirectory()
                openLocalTerminalsSideBySide(b ? [a, b] : [a])
              })
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Columns2 className="size-4 text-muted-foreground" /> Open two directories side by side…
          </Command.Item>
          <Command.Item
            value="open in external terminal ghostty warp iterm kitty alacritty wezterm"
            onSelect={() =>
              run(() => {
                const { tabs, activeTabId } = useTabsStore.getState()
                const active = tabs.find((t) => t.id === activeTabId)
                const cwd = active?.kind === 'local-terminal' ? active.cwd : undefined
                void window.api.openExternalTerminal({ cwd })
              })
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <ExternalLink className="size-4 text-muted-foreground" /> Open in external terminal
          </Command.Item>
          <Command.Item
            value="new tunnel port forward socks proxy"
            onSelect={() => run(() => setTunnelDialogOpen(true))}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Network className="size-4 text-muted-foreground" /> New tunnel / port forward
          </Command.Item>
          <Command.Item
            value="automation run command across many hosts fleet"
            onSelect={() =>
              run(() =>
                useTabsStore.getState().openTab({
                  id: 'automation',
                  kind: 'automation',
                  title: 'Automation',
                  closable: true,
                }),
              )
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Zap className="size-4 text-muted-foreground" /> Automation — run across hosts
          </Command.Item>
          <Command.Item
            value="activity logs history audit"
            onSelect={() =>
              run(() =>
                useTabsStore
                  .getState()
                  .openTab({ id: 'logs', kind: 'logs', title: 'Logs', closable: true }),
              )
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Clock className="size-4 text-muted-foreground" /> Activity logs
          </Command.Item>
          <Command.Item
            value="ai activity agent mcp decisions actions"
            onSelect={() =>
              run(() =>
                useTabsStore.getState().openTab({
                  id: 'ai-activity',
                  kind: 'ai-activity',
                  title: 'AI Activity',
                  closable: true,
                }),
              )
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Bot className="size-4 text-muted-foreground" /> AI Activity
          </Command.Item>
          <Command.Item
            value="import ssh config"
            onSelect={() =>
              run(() => {
                void window.api.sshConfig.importFromFile().then(() => loadAll())
              })
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Import className="size-4 text-muted-foreground" /> Import ~/.ssh/config
          </Command.Item>
          <Command.Item
            value="import ssh config from file"
            onSelect={() =>
              run(() => {
                void window.api.sshConfig.importFromPickedFile().then(() => loadAll())
              })
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Import className="size-4 text-muted-foreground" /> Import SSH config from file…
          </Command.Item>
          <Command.Item
            value="groups subgroups organize"
            onSelect={() => run(() => setGroupsOpen(true))}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <FolderTree className="size-4 text-muted-foreground" /> Groups
          </Command.Item>
          <Command.Item
            value="credentials keychain logins"
            onSelect={() => run(() => setCredentialsOpen(true))}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <KeyRound className="size-4 text-muted-foreground" /> Credentials
          </Command.Item>
          <Command.Item
            value="settings preferences"
            onSelect={() => run(onOpenSettings)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            <Settings className="size-4 text-muted-foreground" /> Settings
          </Command.Item>
          <Command.Item
            value="toggle theme dark light"
            onSelect={() =>
              run(() => {
                void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
              })
            }
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            {settings.theme === 'dark' ? (
              <Sun className="size-4 text-muted-foreground" />
            ) : (
              <Moon className="size-4 text-muted-foreground" />
            )}
            Toggle theme
          </Command.Item>
        </Command.Group>
      </Command.List>
      <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          <kbd className="font-mono">↵</kbd> open
        </span>
        <span>
          <kbd className="font-mono">↑↓</kbd> navigate
        </span>
        <span>
          <kbd className="font-mono">esc</kbd> close
        </span>
      </div>
    </Command.Dialog>
  )
}
