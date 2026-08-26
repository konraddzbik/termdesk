import { CredentialsDialog } from '@renderer/components/credentials/CredentialsDialog'
import { GroupsDialog } from '@renderer/components/groups/GroupsDialog'
import { DuplicateHostDialog } from '@renderer/components/hosts/DuplicateHostDialog'
import { HostFormDialog } from '@renderer/components/hosts/HostFormDialog'
import { HostList } from '@renderer/components/hosts/HostList'
import { ImportSshConfigButton } from '@renderer/components/hosts/ImportSshConfigButton'
import { ImportVncButton } from '@renderer/components/hosts/ImportVncButton'
import { PromptBookPanel } from '@renderer/components/prompts/PromptBookPanel'
import { RoutinesPanel } from '@renderer/components/routines/RoutinesPanel'
import { SnippetsPanel } from '@renderer/components/snippets/SnippetsPanel'
import { LocalTerminalsPanel } from '@renderer/components/terminal/LocalTerminalsPanel'
import { WorkspacesPanel } from '@renderer/components/terminal/WorkspacesPanel'
import { TunnelsPanel } from '@renderer/components/tunnels/TunnelsPanel'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { openLocalTerminalInFolder, openLocalTerminalTab } from '@renderer/lib/local-terminal'
import { useHostsStore } from '@renderer/stores/hosts'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import {
  Bot,
  Clock,
  FolderOpen,
  FolderTree,
  KeyRound,
  Plus,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  SquareTerminal,
  Zap,
} from 'lucide-react'
import { useEffect } from 'react'

export function Sidebar(): React.JSX.Element {
  const query = useHostsStore((s) => s.query)
  const setQuery = useHostsStore((s) => s.setQuery)
  const loadAll = useHostsStore((s) => s.loadAll)
  const error = useHostsStore((s) => s.error)
  const hostDialogOpen = useUiStore((s) => s.hostDialogOpen)
  const editingHost = useUiStore((s) => s.editingHost)
  const openHostDialog = useUiStore((s) => s.openHostDialog)
  const setHostDialogOpen = useUiStore((s) => s.setHostDialogOpen)
  const openDuplicateHost = useUiStore((s) => s.openDuplicateHost)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const credentialsOpen = useUiStore((s) => s.credentialsOpen)
  const setCredentialsOpen = useUiStore((s) => s.setCredentialsOpen)
  const groupsOpen = useUiStore((s) => s.groupsOpen)
  const setGroupsOpen = useUiStore((s) => s.setGroupsOpen)
  const sections = useSettingsStore((s) => s.settings.sidebarSections)

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card/50">
      {/* Branding row — keeps the wordmark and the always-available Settings
          button on one uncluttered line so neither gets clipped. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-semibold tracking-tight">TermDesk</span>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Settings className="size-4" />
        </button>
      </div>
      {/* Action toolbar — the feature launchers, on their own row. Wraps so the
          full set (now 8 icons) never clips the last button in the 256px sidebar;
          the SVG glyphs are shrink-0 so they keep their size instead of squashing. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5 [&_svg]:shrink-0">
        <button
          type="button"
          onClick={() => openLocalTerminalTab()}
          aria-label="New local terminal"
          title="New local terminal"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <SquareTerminal className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void openLocalTerminalInFolder()}
          aria-label="Open terminal in folder…"
          title="Open terminal in folder…"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <FolderOpen className="size-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            useTabsStore.getState().openTab({
              id: 'automation',
              kind: 'automation',
              title: 'Automation',
              closable: true,
            })
          }
          aria-label="Automation"
          title="Automation — run a snippet on multiple hosts"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Zap className="size-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            useTabsStore.getState().openTab({
              id: 'logs',
              kind: 'logs',
              title: 'Logs',
              closable: true,
            })
          }
          aria-label="Logs"
          title="Activity logs"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Clock className="size-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            useTabsStore.getState().openTab({
              id: 'ai-activity',
              kind: 'ai-activity',
              title: 'AI Activity',
              closable: true,
            })
          }
          aria-label="AI Activity"
          title="AI Activity — what AI agents do through TermDesk"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Bot className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setGroupsOpen(true)}
          aria-label="Groups"
          title="Manage groups & subgroups"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <FolderTree className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setCredentialsOpen(true)}
          aria-label="Credentials"
          title="Credentials (saved logins)"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <KeyRound className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Customize sidebar"
          title="Customize sidebar — show or hide sections"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </div>
      {/* The search box only filters hosts, so it hides together with them. */}
      {sections.hosts && (
        <div className="shrink-0 p-2">
          <div className="flex items-center gap-2 rounded-md border bg-background px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search hosts…  (⌘K)"
              aria-label="Search hosts"
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      )}
      {sections.hosts && (
        <ScrollArea className="min-h-0 flex-1">
          <HostList
            onAddHost={() => openHostDialog()}
            onEditHost={(host) => {
              const fresh = useHostsStore.getState().hosts.find((h) => h.id === host.id) ?? host
              openHostDialog(fresh)
            }}
            onDuplicateHost={(host) => openDuplicateHost(host)}
          />
        </ScrollArea>
      )}
      {/* Bounded, scrollable stack so these panels can never push the footer
          (Add host / import) off-screen under height pressure. Each section is
          individually toggleable from Settings → Sidebar sections. */}
      <div className="flex min-h-0 shrink flex-col overflow-y-auto">
        {sections.localTerminals && <LocalTerminalsPanel />}
        {sections.workspaces && <WorkspacesPanel />}
        {sections.tunnels && <TunnelsPanel />}
        {sections.snippets && <SnippetsPanel />}
        {sections.promptBook && <PromptBookPanel />}
        {sections.routines && <RoutinesPanel />}
      </div>
      {/* With the host list hidden, nothing else grows — this spacer keeps the
          footer pinned to the bottom instead of floating up. */}
      {!sections.hosts && <div className="min-h-0 flex-1" />}
      <div className="shrink-0 border-t p-2">
        {error && (
          <p role="alert" title={error} className="truncate px-1 pb-1 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-1">
          <Button variant="secondary" size="sm" onClick={() => openHostDialog()}>
            <Plus />
            Add host
          </Button>
          <div className="flex items-center gap-0.5">
            <ImportSshConfigButton />
            <ImportVncButton />
          </div>
        </div>
      </div>
      <HostFormDialog open={hostDialogOpen} onOpenChange={setHostDialogOpen} host={editingHost} />
      <DuplicateHostDialog />
      <CredentialsDialog open={credentialsOpen} onOpenChange={setCredentialsOpen} />
      <GroupsDialog open={groupsOpen} onOpenChange={setGroupsOpen} />
    </aside>
  )
}
