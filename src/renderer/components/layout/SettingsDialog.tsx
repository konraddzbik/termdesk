import { McpSettings } from '@renderer/components/ai/McpSettings'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { SIDEBAR_SECTIONS } from '@renderer/lib/sidebar-sections'
import { TERMINAL_THEME_LABELS } from '@renderer/lib/terminal-themes'
import { useSettingsStore } from '@renderer/stores/settings'
import type {
  DetectedHarness,
  ExternalTerminalInfo,
  SidebarSections,
  TerminalColorScheme,
  TerminalProgramId,
  TerminalProgramInfo,
} from '@shared/ipc'
import { useEffect, useState } from 'react'

interface SettingsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

/** Helper text under the terminal-program picker, tuned to the current choice. */
function terminalProgramHint(
  program: TerminalProgramId,
  programs: TerminalProgramInfo[] | null,
): string {
  if (program === 'default') {
    return 'Launches your default login shell — no multiplexer or shell override.'
  }
  const info = programs?.find((p) => p.id === program)
  if (programs && info && !info.available) {
    return `${info.label} is not installed here — new local terminals fall back to your login shell; still applied to SSH hosts that have it.`
  }
  if (info?.kind === 'multiplexer') {
    return `Runs shells inside ${info.label} (local + remote); sessions persist across reconnects.`
  }
  const label = info?.label ?? program
  return `Opens ${label} instead of your login shell (local + SSH hosts that have it).`
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)

  const [theme, setTheme] = useState(settings.theme)
  const [fontSize, setFontSize] = useState(String(settings.terminalFontSize))
  const [fontFamily, setFontFamily] = useState(settings.terminalFontFamily)
  const [keepalive, setKeepalive] = useState(String(settings.keepaliveSeconds))
  const [colorScheme, setColorScheme] = useState<TerminalColorScheme>(settings.terminalColorScheme)
  const [rightClickPaste, setRightClickPaste] = useState(settings.terminalRightClickPaste)
  const [updateChannel, setUpdateChannel] = useState(settings.updateChannel)
  const [terminalProgram, setTerminalProgram] = useState<TerminalProgramId>(
    settings.terminalProgram,
  )
  /** null until the local program-detection probe resolves. */
  const [programs, setPrograms] = useState<TerminalProgramInfo[] | null>(null)
  const [externalTerminal, setExternalTerminal] = useState(settings.externalTerminal)
  /** null until the external-emulator detection probe resolves. */
  const [externalTerminals, setExternalTerminals] = useState<ExternalTerminalInfo[] | null>(null)
  const [defaultHarnessId, setDefaultHarnessId] = useState(settings.defaultHarnessId)
  const [routineSchedulerEnabled, setRoutineSchedulerEnabled] = useState(
    settings.routineSchedulerEnabled,
  )
  /** null until the AI-harness detection probe resolves. */
  const [harnesses, setHarnesses] = useState<DetectedHarness[] | null>(null)
  const [sidebarSections, setSidebarSections] = useState<SidebarSections>(settings.sidebarSections)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTheme(settings.theme)
    setFontSize(String(settings.terminalFontSize))
    setFontFamily(settings.terminalFontFamily)
    setKeepalive(String(settings.keepaliveSeconds))
    setColorScheme(settings.terminalColorScheme)
    setRightClickPaste(settings.terminalRightClickPaste)
    setUpdateChannel(settings.updateChannel)
    setTerminalProgram(settings.terminalProgram)
    setExternalTerminal(settings.externalTerminal)
    setDefaultHarnessId(settings.defaultHarnessId)
    setRoutineSchedulerEnabled(settings.routineSchedulerEnabled)
    setSidebarSections(settings.sidebarSections)
    setError(null)
  }, [open, settings])

  // Probe which terminal programs / external emulators are installed when opened.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.api.detectTerminals().then((list) => {
      if (!cancelled) setPrograms(list)
    })
    void window.api.detectExternalTerminals().then((list) => {
      if (!cancelled) setExternalTerminals(list)
    })
    void window.api.detectHarnesses().then((list) => {
      if (!cancelled) setHarnesses(list)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleSave(): Promise<void> {
    const size = Number(fontSize)
    const keepaliveSeconds = Number(keepalive)
    if (!Number.isInteger(size) || size < 8 || size > 32) {
      setError('Font size must be between 8 and 32')
      return
    }
    if (!Number.isInteger(keepaliveSeconds) || keepaliveSeconds < 0 || keepaliveSeconds > 300) {
      setError('Keepalive must be between 0 and 300 seconds')
      return
    }
    try {
      await update({
        theme,
        terminalFontSize: size,
        terminalFontFamily: fontFamily.trim() || undefined,
        keepaliveSeconds,
        terminalColorScheme: colorScheme,
        terminalRightClickPaste: rightClickPaste,
        updateChannel,
        terminalProgram,
        externalTerminal,
        defaultHarnessId,
        routineSchedulerEnabled,
        sidebarSections,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        aria-describedby="settings-description"
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription id="settings-description">Application settings</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="min-h-[22rem]">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="ai">AI Agent</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          {/* --- General --- */}
          <TabsContent value="general" className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-theme">Theme</Label>
                <Select value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
                  <SelectTrigger id="settings-theme" className="w-full" aria-label="Theme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-font-size">Terminal font size</Label>
                <Input
                  id="settings-font-size"
                  type="number"
                  min={8}
                  max={32}
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-font-family">Terminal font family</Label>
              <Input
                id="settings-font-family"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                placeholder="ui-monospace, Menlo, monospace"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-color-scheme">Terminal color scheme</Label>
                <Select
                  value={colorScheme}
                  onValueChange={(v) => setColorScheme(v as TerminalColorScheme)}
                >
                  <SelectTrigger
                    id="settings-color-scheme"
                    className="w-full"
                    aria-label="Terminal color scheme"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TERMINAL_THEME_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-keepalive">SSH keepalive (seconds, 0 = off)</Label>
                <Input
                  id="settings-keepalive"
                  type="number"
                  min={0}
                  max={300}
                  value={keepalive}
                  onChange={(e) => setKeepalive(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rightClickPaste}
                onChange={(e) => setRightClickPaste(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Paste on right-click in the terminal
              <span className="text-xs text-muted-foreground">(off = native context menu)</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-terminal-program">Terminal program</Label>
              <Select
                value={terminalProgram}
                onValueChange={(v) => setTerminalProgram(v as TerminalProgramId)}
              >
                <SelectTrigger
                  id="settings-terminal-program"
                  className="w-full"
                  aria-label="Terminal program"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default shell</SelectItem>
                  {(programs ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={!p.available}>
                      {p.available ? p.label : `${p.label} (not installed)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {terminalProgramHint(terminalProgram, programs)}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-external-terminal">Open in external terminal</Label>
              {/* Radix forbids an empty Select value, so '' (system default) maps to a sentinel. */}
              <Select
                value={externalTerminal === '' ? 'system' : externalTerminal}
                onValueChange={(v) => setExternalTerminal(v === 'system' ? '' : v)}
              >
                <SelectTrigger
                  id="settings-external-terminal"
                  className="w-full"
                  aria-label="Open in external terminal"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System default</SelectItem>
                  {(externalTerminals ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id} disabled={!t.available}>
                      {t.available ? t.label : `${t.label} (not installed)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Which GUI terminal the “Open in external terminal” action (⌘K, or a terminal tab’s
                button) launches — Ghostty, Warp, iTerm2, kitty and more, when installed.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-default-harness">Default AI agent</Label>
              {/* Radix forbids an empty Select value, so '' (ask each time) maps to a sentinel. */}
              <Select
                value={defaultHarnessId === '' ? 'ask' : defaultHarnessId}
                onValueChange={(v) => setDefaultHarnessId(v === 'ask' ? '' : v)}
              >
                <SelectTrigger
                  id="settings-default-harness"
                  className="w-full"
                  aria-label="Default AI agent"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ask">Ask each time</SelectItem>
                  {(harnesses ?? []).map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.available ? h.label : `${h.label} (not installed)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Which agent the Prompt Book’s “Run in agent” action selects by default (claude,
                aider, opencode, codex, gemini) — when installed.
              </span>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={routineSchedulerEnabled}
                onChange={(e) => setRoutineSchedulerEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Run scheduled routines
                <span className="block text-xs text-muted-foreground">
                  When off, no routine fires on its schedule (you can still run routines manually).
                  Routines only fire while TermDesk is open; missed runs catch up on next launch.
                </span>
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <Label>Sidebar sections</Label>
              <div className="flex flex-col gap-1.5 rounded-md border p-2.5">
                {SIDEBAR_SECTIONS.map((section) => (
                  <label
                    key={section.id}
                    className="flex items-center gap-2 text-sm"
                    title={section.hint}
                  >
                    <input
                      type="checkbox"
                      checked={sidebarSections[section.id]}
                      onChange={(e) =>
                        setSidebarSections((prev) => ({ ...prev, [section.id]: e.target.checked }))
                      }
                      className="size-4 accent-[var(--primary)]"
                    />
                    {section.label}
                    <span className="text-xs text-muted-foreground">{section.hint}</span>
                  </label>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                Choose which sections appear in the left sidebar. Unchecked sections are hidden
                until you re-enable them here.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-update-channel">Update channel</Label>
              <Select
                value={updateChannel}
                onValueChange={(v) => setUpdateChannel(v as typeof updateChannel)}
              >
                <SelectTrigger
                  id="settings-update-channel"
                  className="w-full"
                  aria-label="Update channel"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">Stable</SelectItem>
                  <SelectItem value="beta">Beta (early releases)</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Beta opts into prerelease builds. Auto-update runs on Windows and Linux; macOS
                updates are manual for now.
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Terminal preferences apply to new sessions; theme changes apply immediately.
            </p>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()}>Save</Button>
            </DialogFooter>
          </TabsContent>

          {/* --- AI Agent (MCP) --- */}
          <TabsContent value="ai">
            <McpSettings />
          </TabsContent>

          {/* --- About --- */}
          <TabsContent value="about">
            <div className="text-xs text-muted-foreground">
              <div className="font-medium text-foreground mb-1">About TermDesk</div>
              <div>Author: Konrad Dzbik</div>
              <div className="mt-1">
                Open source under the MIT Licence. Distributed binary installers are additionally
                covered by EULA.txt.
              </div>
              <div className="mt-2">
                Auto-updates run in packaged builds on Windows and Linux from this project's GitHub
                Releases; pick the Stable or Beta channel under General. The app checks on launch,
                and an in-app banner lets you download and restart to apply. macOS updates are
                manual until the app is code-signed.
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
