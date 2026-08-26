import '@xterm/xterm/css/xterm.css'
import { normalizePastedText, sanitizeCopiedText } from '@renderer/lib/clipboard'
import { schemeBackground, TERMINAL_THEMES } from '@renderer/lib/terminal-themes'
import { useSettingsStore } from '@renderer/stores/settings'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'

const isMac = navigator.platform.toUpperCase().includes('MAC')

/** Byte-stream transport for the xterm surface — SSH or local PTY. */
export interface TerminalTransport {
  write(sessionId: string, data: string): void
  onData(sessionId: string, cb: (data: string | Uint8Array) => void): () => void
  attach(sessionId: string): void
  resize(sessionId: string, cols: number, rows: number): void
}

const sshTransport: TerminalTransport = {
  write: (id, data) => window.api.ssh.write(id, data),
  onData: (id, cb) => window.api.ssh.onData(id, cb),
  attach: (id) => window.api.ssh.attach(id),
  resize: (id, cols, rows) => {
    void window.api.ssh.resize(id, cols, rows).catch(() => {})
  },
}

interface TerminalViewProps {
  sessionId: string
  /** Defaults to the SSH transport; local terminals pass a PTY transport. */
  transport?: TerminalTransport
}

/** xterm.js surface bound to one session's byte stream (SSH or local PTY). */
export function TerminalView({
  sessionId,
  transport = sshTransport,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const colorScheme = useSettingsStore((s) => s.settings.terminalColorScheme)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { terminalFontSize, terminalFontFamily, terminalColorScheme, terminalRightClickPaste } =
      useSettingsStore.getState().settings
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      scrollback: 10_000,
      fontSize: terminalFontSize,
      fontFamily: terminalFontFamily,
      theme: TERMINAL_THEMES[terminalColorScheme] ?? TERMINAL_THEMES.default,
    })
    termRef.current = term

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    searchAddonRef.current = searchAddon
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    // Main denies window.open navigation and routes the URL to the OS browser.
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)))

    term.open(container)

    // WebGL renderer when available; fall back to the canvas/DOM renderer.
    let webgl: WebglAddon | null = null
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl?.dispose()
        webgl = null
      })
      term.loadAddon(webgl)
    } catch {
      webgl?.dispose()
      webgl = null
    }

    // Renderer→PTY keystrokes and PTY→renderer output. attach() flushes any
    // output main buffered before this subscription existed (MOTD/banner).
    const dataDisposable = term.onData((data) => transport.write(sessionId, data))
    const unsubData = transport.onData(sessionId, (data) => term.write(data))
    transport.attach(sessionId)

    // Fit to container and keep the remote PTY size in sync.
    let lastCols = 0
    let lastRows = 0
    const fitAndResize = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return // hidden tab
      try {
        fitAddon.fit()
      } catch {
        return
      }
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols
        lastRows = term.rows
        transport.resize(sessionId, term.cols, term.rows)
      }
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(fitAndResize, 50)
    })
    observer.observe(container)
    requestAnimationFrame(fitAndResize)

    // Copy/paste & search shortcuts. Returning false stops xterm from also
    // turning the keystroke into PTY input.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const mod = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && event.shiftKey && key === 'c') {
        const selection = term.getSelection()
        if (selection) void navigator.clipboard.writeText(sanitizeCopiedText(selection))
        return false
      }
      if ((mod && event.shiftKey && key === 'v') || (isMac && event.metaKey && key === 'v')) {
        void navigator.clipboard.readText().then((text) => {
          if (text) transport.write(sessionId, normalizePastedText(text))
        })
        return false
      }
      if (mod && !event.shiftKey && key === 'f') {
        setSearchOpen(true)
        return false
      }
      return true
    })

    // Right-click paste is opt-in (off by default): an unconditional paste runs
    // on the next newline, a destructive surprise in an SSH session. When off,
    // the browser's native context menu is left intact (copy/paste/select-all).
    let onContextMenu: ((event: MouseEvent) => void) | null = null
    if (terminalRightClickPaste) {
      onContextMenu = (event: MouseEvent): void => {
        event.preventDefault()
        void navigator.clipboard.readText().then((text) => {
          if (text) transport.write(sessionId, normalizePastedText(text))
        })
      }
      container.addEventListener('contextmenu', onContextMenu)
    }

    term.focus()

    return () => {
      if (onContextMenu) container.removeEventListener('contextmenu', onContextMenu)
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      observer.disconnect()
      unsubData()
      dataDisposable.dispose()
      searchAddonRef.current = null
      termRef.current = null
      term.dispose() // disposes loaded addons too
    }
  }, [sessionId, transport])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const closeSearch = (): void => {
    setSearchOpen(false)
    termRef.current?.focus()
  }

  return (
    <div
      className="relative h-full w-full"
      style={{ backgroundColor: schemeBackground(colorScheme) }}
    >
      <div ref={containerRef} className="h-full w-full pl-2 pt-1" />
      {searchOpen && (
        <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border bg-card p-1 shadow-md">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search…"
            className="h-7 w-48 rounded-sm bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                const value = event.currentTarget.value
                if (!value) return
                if (event.shiftKey) searchAddonRef.current?.findPrevious(value)
                else searchAddonRef.current?.findNext(value)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                closeSearch()
              }
            }}
          />
          <button
            type="button"
            className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={closeSearch}
            aria-label="Close search"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
