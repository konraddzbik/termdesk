import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import {
  Bot,
  FolderTree,
  Keyboard,
  MonitorPlay,
  Network,
  Server,
  TerminalSquare,
} from 'lucide-react'
import { useState } from 'react'

const isMac = navigator.platform.toUpperCase().includes('MAC')
const mod = isMac ? '⌘' : 'Ctrl'

interface Slide {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}

/** First-run feature tour shown once. Keep slides short — one idea each. */
const SLIDES: readonly Slide[] = [
  {
    icon: Server,
    title: 'Welcome to TermDesk',
    body: 'Your SSH, SFTP and VNC sessions in one place. Here’s a quick tour of what you can do — it only shows once.',
  },
  {
    icon: Server,
    title: 'Add & organize hosts',
    body: 'Add hosts from the sidebar, or import your ~/.ssh/config. Credentials are encrypted locally and never leave your machine. Group and tag hosts to find them fast.',
  },
  {
    icon: TerminalSquare,
    title: 'Terminals & split view',
    body: 'Open a host for a full terminal. Alt-click a tab — or use the split buttons — to view two sessions side by side, and drag the divider to resize.',
  },
  {
    icon: FolderTree,
    title: 'Browse files over SFTP',
    body: 'Open SFTP on any SSH host to drag-and-drop files, edit them in place with your local editor, and track transfers in the drawer.',
  },
  {
    icon: MonitorPlay,
    title: 'Remote desktops via VNC',
    body: 'Connect to VNC servers — tunneled over SSH by default, so the remote VNC port never has to be exposed to the network.',
  },
  {
    icon: Network,
    title: 'Tunnels & port forwards',
    body: 'Create local (-L) and dynamic SOCKS (-D) forwards from the GUI and start or stop them with one click.',
  },
  {
    icon: Bot,
    title: 'AI agent over MCP',
    body: 'Optionally expose TermDesk to an AI agent over MCP — off by default, per-host opt-in, every action approval-gated and audited. Turn it on in Settings → AI Agent.',
  },
  {
    icon: Keyboard,
    title: 'Move fast',
    body: `Switch tabs with ${mod}+1–9 and Ctrl+Tab. Open the command palette with ${mod}+K. Press ? any time for the full keyboard cheat-sheet.`,
  },
]

interface WelcomeTourProps {
  open: boolean
  /** Called on finish, skip, or dismiss — the caller persists "seen". */
  onClose(): void
}

/** One-time, dismissible welcome carousel walking through the main features. */
export function WelcomeTour({ open, onClose }: WelcomeTourProps): React.JSX.Element {
  const [step, setStep] = useState(0)
  const isLast = step === SLIDES.length - 1
  const slide = SLIDES[Math.min(step, SLIDES.length - 1)] as Slide
  const Icon = slide.icon

  const next = (): void => {
    if (isLast) onClose()
    else setStep((s) => Math.min(SLIDES.length - 1, s + 1))
  }
  const back = (): void => setStep((s) => Math.max(0, s - 1))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg" aria-describedby="welcome-body">
        <div className="flex flex-col items-center gap-4 pt-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="size-7" />
          </div>
          <h2 className="text-lg font-semibold">{slide.title}</h2>
          <p id="welcome-body" className="max-w-sm text-sm text-muted-foreground">
            {slide.body}
          </p>
        </div>

        <div className="mt-2 flex items-center justify-center gap-1.5" aria-hidden="true">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === step
                  ? 'w-4 bg-primary'
                  : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
              )}
              tabIndex={-1}
            />
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Skip
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={back}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {isLast ? 'Get started' : 'Next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
