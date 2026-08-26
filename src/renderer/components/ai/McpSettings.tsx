import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useHostsStore } from '@renderer/stores/hosts'
import { useSettingsStore } from '@renderer/stores/settings'
import type { McpStatus } from '@shared/ipc'
import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

function CopyField({ label, value }: { label: string; value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded border bg-muted px-2 py-1 font-mono text-xs">
          {value}
        </code>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          <Copy className="size-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

/** Settings panel: enable the MCP server, gating mode, connection info, per-host opt-in. */
export function McpSettings(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const hosts = useHostsStore((s) => s.hosts)
  const loadHosts = useHostsStore((s) => s.loadAll)
  const [status, setStatus] = useState<McpStatus | null>(null)

  useEffect(() => {
    void window.api.mcp.status().then(setStatus)
    void loadHosts()
    return window.api.mcp.onStatus(setStatus)
  }, [loadHosts])

  const setEnabled = async (enabled: boolean): Promise<void> => {
    setStatus(await window.api.mcp.setEnabled(enabled))
  }

  const toggleHost = (id: string, field: 'mcpReadHostIds' | 'mcpExecHostIds'): void => {
    const set = new Set(settings[field])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    void update({ [field]: [...set] })
  }

  const claudeCmd = status?.url
    ? `claude mcp add --transport http termdesk ${status.url} --header "Authorization: Bearer ${status.token}"`
    : ''

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.mcpEnabled}
          onChange={(e) => void setEnabled(e.target.checked)}
          className="size-4 accent-[var(--primary)]"
        />
        <span className="font-medium">Let AI agents use TermDesk over MCP</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Exposes a local, token-gated server so an agent (Claude, Cursor, Grok…) can list hosts and
        run commands you approve. The agent never sees your credentials, and every action is shown
        in the <span className="font-medium">AI Activity</span> view. Off by default.
      </p>

      {settings.mcpEnabled && status?.running && status.url && status.token && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <CopyField label="Server URL" value={status.url} />
          <CopyField label="Bearer token (rotates each time you re-enable)" value={status.token} />
          <CopyField label="Add to Claude Code" value={claudeCmd} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Approval</span>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="mcp-approval"
            checked={settings.mcpApprovalMode === 'always'}
            onChange={() => void update({ mcpApprovalMode: 'always' })}
          />
          Ask me to approve every command (recommended)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="mcp-approval"
            checked={settings.mcpApprovalMode === 'allowlist'}
            onChange={() => void update({ mcpApprovalMode: 'allowlist' })}
          />
          Auto-allow commands matching my allow-list (deny rules still apply)
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Per-host access</span>
        <p className="text-xs text-muted-foreground">
          Agents can only touch hosts you enable here. Default: none.
        </p>
        <ScrollArea className="max-h-44 rounded-md border">
          {hosts.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No hosts yet.</div>
          ) : (
            hosts.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 border-b px-3 py-1.5 text-sm last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate">{h.label}</span>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={settings.mcpReadHostIds.includes(h.id)}
                    onChange={() => toggleHost(h.id, 'mcpReadHostIds')}
                  />
                  read
                </label>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={settings.mcpExecHostIds.includes(h.id)}
                    onChange={() => toggleHost(h.id, 'mcpExecHostIds')}
                  />
                  exec
                </label>
              </div>
            ))
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
