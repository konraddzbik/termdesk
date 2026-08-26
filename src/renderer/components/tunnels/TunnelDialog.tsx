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
import { useHostsStore } from '@renderer/stores/hosts'
import { useTunnelsStore } from '@renderer/stores/tunnels'
import { isLoopbackListenHost, type SavedTunnel, type TunnelType } from '@shared/ipc'
import { useEffect, useState } from 'react'

interface TunnelDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Set when editing an existing tunnel. */
  tunnel?: SavedTunnel | null
}

export function TunnelDialog({ open, onOpenChange, tunnel }: TunnelDialogProps): React.JSX.Element {
  const hosts = useHostsStore((s) => s.hosts)
  const sshHosts = hosts.filter((h) => h.kind !== 'vnc')
  const create = useTunnelsStore((s) => s.create)
  const update = useTunnelsStore((s) => s.update)

  const [hostId, setHostId] = useState('')
  const [type, setType] = useState<TunnelType>('local')
  const [name, setName] = useState('')
  const [listenPort, setListenPort] = useState('')
  const [listenHost, setListenHost] = useState('127.0.0.1')
  const [exposeToLan, setExposeToLan] = useState(false)
  const [dstHost, setDstHost] = useState('')
  const [dstPort, setDstPort] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Read the default host imperatively so the form resets only when the dialog
    // (re)opens — not every time the host list changes mid-edit.
    const firstSsh = useHostsStore.getState().hosts.find((h) => h.kind !== 'vnc')?.id
    setHostId(tunnel?.hostId ?? firstSsh ?? '')
    setType(tunnel?.type ?? 'local')
    setName(tunnel?.name ?? '')
    setListenPort(tunnel ? String(tunnel.listenPort) : '')
    setListenHost(tunnel?.listenHost ?? '127.0.0.1')
    setExposeToLan(tunnel ? !isLoopbackListenHost(tunnel.listenHost) : false)
    setDstHost(tunnel?.dstHost ?? '127.0.0.1')
    setDstPort(tunnel?.dstPort != null ? String(tunnel.dstPort) : '')
    setError(null)
  }, [open, tunnel])

  async function handleSave(): Promise<void> {
    const lp = Number(listenPort)
    if (!hostId) return setError('Pick a host')
    if (!Number.isInteger(lp) || lp < 1 || lp > 65535) return setError('Local port must be 1–65535')
    const boundHost = listenHost.trim() || '127.0.0.1'
    if (!isLoopbackListenHost(boundHost) && !exposeToLan) {
      return setError(
        'This listen address is not loopback — tick "Expose on the network" to bind it.',
      )
    }
    const input = {
      hostId,
      type,
      listenHost: boundHost,
      listenPort: lp,
      exposeToLan,
      name: name.trim() || null,
      dstHost: type === 'local' ? dstHost.trim() : null,
      dstPort: type === 'local' ? Number(dstPort) : null,
    }
    if (type === 'local') {
      if (!input.dstHost) return setError('Destination host is required for a local forward')
      if (
        !Number.isInteger(input.dstPort) ||
        (input.dstPort ?? 0) < 1 ||
        (input.dstPort ?? 0) > 65535
      ) {
        return setError('Destination port must be 1–65535')
      }
    }
    try {
      if (tunnel) await update(tunnel.id, input)
      else await create(input)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="tunnel-desc">
        <DialogHeader>
          <DialogTitle>{tunnel ? 'Edit tunnel' : 'New tunnel'}</DialogTitle>
          <DialogDescription id="tunnel-desc">
            Forward a local port over SSH. Local (-L) sends a local port to a remote host:port;
            Dynamic (-D) runs a local SOCKS5 proxy.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tunnel-host">Host (SSH)</Label>
              <Select value={hostId} onValueChange={setHostId}>
                <SelectTrigger id="tunnel-host" className="w-full" aria-label="Host">
                  <SelectValue placeholder="Pick a host" />
                </SelectTrigger>
                <SelectContent>
                  {sshHosts.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tunnel-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TunnelType)}>
                <SelectTrigger id="tunnel-type" className="w-full" aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local (-L)</SelectItem>
                  <SelectItem value="dynamic">Dynamic SOCKS (-D)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tunnel-listenhost">Listen address</Label>
            <Input
              id="tunnel-listenhost"
              value={listenHost}
              onChange={(e) => setListenHost(e.target.value)}
              placeholder="127.0.0.1"
              aria-describedby="tunnel-listenhost-hint"
            />
            {!isLoopbackListenHost(listenHost) && (
              <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <p id="tunnel-listenhost-hint" className="text-xs text-destructive">
                  This binds the forwarded port to a non-loopback address, exposing it to your local
                  network — not just this machine.
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={exposeToLan}
                    onChange={(e) => setExposeToLan(e.target.checked)}
                  />
                  Expose on the network (I understand the risk)
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tunnel-listen">Local port</Label>
              <Input
                id="tunnel-listen"
                type="number"
                min={1}
                max={65535}
                value={listenPort}
                onChange={(e) => setListenPort(e.target.value)}
                placeholder={type === 'dynamic' ? '1080' : '5432'}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tunnel-name">Name (optional)</Label>
              <Input
                id="tunnel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'dynamic' ? 'SOCKS proxy' : 'prod DB'}
              />
            </div>
          </div>

          {type === 'local' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tunnel-dsthost">Destination host</Label>
                <Input
                  id="tunnel-dsthost"
                  value={dstHost}
                  onChange={(e) => setDstHost(e.target.value)}
                  placeholder="127.0.0.1"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tunnel-dstport">Destination port</Label>
                <Input
                  id="tunnel-dstport"
                  type="number"
                  min={1}
                  max={65535}
                  value={dstPort}
                  onChange={(e) => setDstPort(e.target.value)}
                  placeholder="5432"
                />
              </div>
            </div>
          )}

          {type === 'local' ? (
            <p className="text-xs text-muted-foreground">
              Connect a client to{' '}
              <span className="font-mono">127.0.0.1:{listenPort || 'PORT'}</span> → it reaches{' '}
              <span className="font-mono">
                {dstHost || 'host'}:{dstPort || 'port'}
              </span>{' '}
              from the SSH host's network.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Point a SOCKS5 proxy at{' '}
              <span className="font-mono">127.0.0.1:{listenPort || 'PORT'}</span> to route traffic
              through the SSH host.
            </p>
          )}

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()}>{tunnel ? 'Save' : 'Add tunnel'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
