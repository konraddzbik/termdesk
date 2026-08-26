import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { useSftpSession } from '@renderer/hooks/useSftpSession'
import { formatBytes, formatDate, formatMode } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import { useHostsStore } from '@renderer/stores/hosts'
import type { SessionTab } from '@renderer/stores/tabs'
import type { SftpEntry } from '@shared/ipc'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Eye,
  EyeOff,
  File,
  FileEdit,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type SortKey = 'name' | 'size' | 'mtimeMs'

interface SftpTabProps {
  tab: SessionTab
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

function parentOf(path: string): string {
  if (path === '/' || path === '') return '/'
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

/** Remote file browser bound to one SFTP session. */
export function SftpTab({ tab }: SftpTabProps): React.JSX.Element {
  // Select just this tab's host so host CRUD elsewhere doesn't re-render the tab.
  const host = useHostsStore((s) => s.hosts.find((h) => h.id === tab.hostId))
  const supportsSsh = host?.kind !== 'vnc'

  // Hooks must run unconditionally (rules of hooks); the VNC-only guard is applied
  // to the rendered output below, after every hook has been called.
  const { sftpId, homeDir, startDir, status, error, reconnect, abortConnect } = useSftpSession(
    tab.hostId ?? '',
  )

  if (!supportsSsh) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-destructive">
        This host is configured as VNC-only and does not support SFTP file transfers.
        <br />
        Edit the host and choose "SSH only" or "Both" to enable file browsing.
      </div>
    )
  }

  if (status !== 'ready' || !sftpId || !homeDir) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        {status === 'connecting' ? (
          <>
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Opening SFTP session…</span>
            <Button variant="outline" size="sm" onClick={abortConnect}>
              Abort
            </Button>
          </>
        ) : status === 'aborted' ? (
          <>
            <span className="max-w-md text-center text-muted-foreground">{error}</span>
            <Button variant="secondary" size="sm" onClick={reconnect}>
              Retry
            </Button>
          </>
        ) : (
          <>
            <span className="max-w-md text-center text-destructive">{error}</span>
            <Button variant="secondary" size="sm" onClick={reconnect}>
              Retry
            </Button>
          </>
        )}
      </div>
    )
  }
  return <SftpBrowser sftpId={sftpId} homeDir={homeDir} startDir={startDir ?? homeDir} />
}

function SftpBrowser({
  sftpId,
  startDir,
}: {
  sftpId: string
  homeDir: string
  startDir: string
}): React.JSX.Element {
  const [path, setPath] = useState(startDir)
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [dialog, setDialog] = useState<
    | { kind: 'mkdir'; value: string }
    | { kind: 'rename'; entry: SftpEntry; value: string }
    | { kind: 'chmod'; entry: SftpEntry; value: string }
    | { kind: 'delete'; entry: SftpEntry }
    | null
  >(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setListError(null)
    try {
      setEntries(await window.api.sftp.list(sftpId, path))
    } catch (err) {
      setListError(toMessage(err))
    } finally {
      setLoading(false)
    }
  }, [sftpId, path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = entries
    .filter((e) => showHidden || !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      const dir = sortAsc ? 1 : -1
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir
      return (a[sortKey] - b[sortKey]) * dir
    })

  const toggleSort = (key: SortKey): void => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    setActionError(null)
    try {
      await action()
      setDialog(null)
      await refresh()
    } catch (err) {
      setActionError(toMessage(err))
    }
  }

  const onDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    setDragOver(false)
    const paths = [...event.dataTransfer.files]
      .map((file) => window.api.sftp.getPathForFile(file))
      .filter((p) => p !== '')
    if (paths.length === 0) return
    try {
      await window.api.sftp.upload(sftpId, paths, path)
    } catch (err) {
      setListError(toMessage(err))
    }
  }

  const breadcrumbs = ((): Array<{ label: string; target: string }> => {
    const parts = path.split('/').filter((p) => p !== '')
    const crumbs = [{ label: '/', target: '/' }]
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      crumbs.push({ label: part, target: current })
    }
    return crumbs
  })()

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop target wrapping the whole pane; not keyboard-interactive
    <div
      className={cn('flex h-full flex-col', dragOver && 'ring-2 ring-inset ring-ring')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.target} className="flex shrink-0 items-center gap-1">
              {i > 1 && <span className="text-muted-foreground">/</span>}
              <button
                type="button"
                className="rounded px-1 py-0.5 hover:bg-accent"
                onClick={() => setPath(crumb.target)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowHidden((v) => !v)}
          aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
        >
          {showHidden ? <EyeOff /> : <Eye />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDialog({ kind: 'mkdir', value: '' })}
          aria-label="New folder"
          title="New folder"
        >
          <FolderPlus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void refresh()}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      {listError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm">
          <span className="max-w-md text-center text-destructive">{listError}</span>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th
                  className="px-3 py-1.5"
                  aria-sort={sortKey === 'name' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('name')}
                  >
                    Name {sortKey === 'name' && (sortAsc ? '↑' : '↓')}
                  </button>
                </th>
                <th
                  className="w-24 px-2 py-1.5 text-right"
                  aria-sort={sortKey === 'size' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('size')}
                  >
                    Size {sortKey === 'size' && (sortAsc ? '↑' : '↓')}
                  </button>
                </th>
                <th
                  className="w-40 px-2 py-1.5"
                  aria-sort={
                    sortKey === 'mtimeMs' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('mtimeMs')}
                  >
                    Modified {sortKey === 'mtimeMs' && (sortAsc ? '↑' : '↓')}
                  </button>
                </th>
                <th className="w-24 px-2 py-1.5 font-mono">Mode</th>
                <th className="w-36 px-2 py-1.5" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {path !== '/' && (
                <tr
                  className="cursor-pointer border-b border-border/40 hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
                  tabIndex={0}
                  aria-label="Go to parent directory"
                  onDoubleClick={() => setPath(parentOf(path))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setPath(parentOf(path))
                    }
                  }}
                >
                  <td className="px-3 py-1.5 text-muted-foreground" colSpan={5}>
                    <span className="flex items-center gap-2">
                      <Folder className="size-4" /> ..
                    </span>
                  </td>
                </tr>
              )}
              {visible.map((entry) => (
                <tr
                  key={entry.path}
                  className="group cursor-default border-b border-border/40 hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
                  tabIndex={0}
                  aria-label={
                    entry.type === 'dir' ? `Open folder ${entry.name}` : `Download ${entry.name}`
                  }
                  onDoubleClick={() => {
                    if (entry.type === 'dir') setPath(entry.path)
                    else if (entry.type === 'file')
                      void window.api.sftp.download(sftpId, entry.path)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (entry.type === 'dir') setPath(entry.path)
                    else if (entry.type === 'file')
                      void window.api.sftp.download(sftpId, entry.path)
                  }}
                >
                  <td className="max-w-0 truncate px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      {entry.type === 'dir' ? (
                        <Folder className="size-4 shrink-0 text-blue-400" />
                      ) : entry.type === 'symlink' ? (
                        <Link2 className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <File className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{entry.name}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {entry.type === 'file' ? formatBytes(entry.size) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{formatDate(entry.mtimeMs)}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                    {formatMode(entry.mode)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      {entry.type === 'file' && (
                        <>
                          <IconAction
                            label={`Download ${entry.name}`}
                            onClick={() => void window.api.sftp.download(sftpId, entry.path)}
                          >
                            <ArrowDownToLine className="size-3.5" />
                          </IconAction>
                          <IconAction
                            label={`Edit ${entry.name}`}
                            onClick={() =>
                              void window.api.sftp
                                .editOpen(sftpId, entry.path)
                                .catch((err) => setListError(toMessage(err)))
                            }
                          >
                            <FileEdit className="size-3.5" />
                          </IconAction>
                        </>
                      )}
                      <IconAction
                        label={`Rename ${entry.name}`}
                        onClick={() => setDialog({ kind: 'rename', entry, value: entry.name })}
                      >
                        <Pencil className="size-3.5" />
                      </IconAction>
                      <IconAction
                        label={`Permissions of ${entry.name}`}
                        onClick={() =>
                          setDialog({
                            kind: 'chmod',
                            entry,
                            value: entry.mode.toString(8).padStart(3, '0'),
                          })
                        }
                      >
                        <Shield className="size-3.5" />
                      </IconAction>
                      <IconAction
                        label={`Delete ${entry.name}`}
                        onClick={() => setDialog({ kind: 'delete', entry })}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </IconAction>
                    </span>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && !loading && (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>
                    Empty directory — drop files here to upload
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex h-7 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        <ArrowUpFromLine className="size-3" />
        <span>Drop files or folders anywhere to upload to {path}</span>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          {dialog?.kind === 'mkdir' && (
            <>
              <DialogHeader>
                <DialogTitle>New folder</DialogTitle>
              </DialogHeader>
              <Input
                value={dialog.value}
                placeholder="folder name"
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                autoFocus
              />
              {actionError && <p className="text-xs text-destructive">{actionError}</p>}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={dialog.value.trim() === '' || dialog.value.includes('/')}
                  onClick={() =>
                    void runAction(() =>
                      window.api.sftp.mkdir(sftpId, `${path === '/' ? '' : path}/${dialog.value}`),
                    )
                  }
                >
                  Create
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === 'rename' && (
            <>
              <DialogHeader>
                <DialogTitle>Rename {dialog.entry.name}</DialogTitle>
              </DialogHeader>
              <Input
                value={dialog.value}
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                autoFocus
              />
              {actionError && <p className="text-xs text-destructive">{actionError}</p>}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={dialog.value.trim() === '' || dialog.value.includes('/')}
                  onClick={() =>
                    void runAction(() =>
                      window.api.sftp.rename(
                        sftpId,
                        dialog.entry.path,
                        `${parentOf(dialog.entry.path) === '/' ? '' : parentOf(dialog.entry.path)}/${dialog.value}`,
                      ),
                    )
                  }
                >
                  Rename
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === 'chmod' && (
            <>
              <DialogHeader>
                <DialogTitle>Permissions of {dialog.entry.name}</DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-3">
                <Input
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  className="w-24 font-mono"
                  maxLength={4}
                  autoFocus
                />
                <span className="font-mono text-sm text-muted-foreground">
                  {/^[0-7]{3,4}$/.test(dialog.value)
                    ? formatMode(Number.parseInt(dialog.value, 8))
                    : '—'}
                </span>
              </div>
              {actionError && <p className="text-xs text-destructive">{actionError}</p>}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!/^[0-7]{3,4}$/.test(dialog.value)}
                  onClick={() =>
                    void runAction(() =>
                      window.api.sftp.chmod(
                        sftpId,
                        dialog.entry.path,
                        Number.parseInt(dialog.value, 8),
                      ),
                    )
                  }
                >
                  Apply
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === 'delete' && (
            <>
              <DialogHeader>
                <DialogTitle>Delete {dialog.entry.name}?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {dialog.entry.type === 'dir'
                  ? 'The directory and everything inside it will be deleted on the remote host.'
                  : 'The file will be deleted on the remote host.'}{' '}
                This cannot be undone.
              </p>
              {actionError && <p className="text-xs text-destructive">{actionError}</p>}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    void runAction(() => window.api.sftp.remove(sftpId, dialog.entry.path))
                  }
                >
                  Delete
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick(): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="rounded p-1 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
