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
import { flattenGroupTree } from '@renderer/lib/group-tree'
import { useCredentialsStore } from '@renderer/stores/credentials'
import { useHostsStore } from '@renderer/stores/hosts'
import { useUiStore } from '@renderer/stores/ui'
import type { AuthType, Host, HostInput, HostKind, VncMode } from '@shared/ipc'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/** Strips Electron IPC wrapper prefix from error messages. */
function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

const NO_GROUP = '__none__'
/** Sentinel for "enter auth manually" in the credential picker. */
const NO_CREDENTIAL = '__inline__'

/** Radix Select value: show the saved credential id once it exists in the list. */
function managedCredentialValue(credentialId: string | null, pool: { id: string }[]): string {
  if (credentialId != null && pool.some((c) => c.id === credentialId)) {
    return credentialId
  }
  return NO_CREDENTIAL
}

/** Label for the managed-credential trigger (Radix needs a matching item or explicit text). */
function managedCredentialLabel(
  credentialId: string | null,
  pool: { id: string; label: string }[],
): string {
  if (credentialId == null) return 'Enter manually'
  return pool.find((c) => c.id === credentialId)?.label ?? 'Saved credential'
}

interface HostFormDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Host being edited; null/undefined means create mode. */
  host?: Host | null
}

interface FormErrors {
  label?: string
  hostname?: string
  port?: string
  username?: string
}

function ClearSecretCheckbox({
  id,
  checked,
  onChange,
  children,
}: {
  id: string
  checked: boolean
  onChange(checked: boolean): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-primary"
      />
      {children}
    </label>
  )
}

export function HostFormDialog({
  open,
  onOpenChange,
  host,
}: HostFormDialogProps): React.JSX.Element {
  const hosts = useHostsStore((s) => s.hosts)
  const groups = useHostsStore((s) => s.groups)
  const createHost = useHostsStore((s) => s.createHost)
  const updateHost = useHostsStore((s) => s.updateHost)
  const credentials = useCredentialsStore((s) => s.credentials)
  const loadCredentials = useCredentialsStore((s) => s.loadAll)
  const credentialsOpen = useUiStore((s) => s.credentialsOpen)
  const setCredentialsOpen = useUiStore((s) => s.setCredentialsOpen)
  const setGroupsOpen = useUiStore((s) => s.setGroupsOpen)
  // Always bind the form to the latest host row (credentialId etc. after save).
  const resolvedHost = host?.id != null ? (hosts.find((h) => h.id === host.id) ?? host) : host
  const isEdit = resolvedHost != null
  const prevCredentialsOpen = useRef(false)

  const [label, setLabel] = useState('')
  const [hostname, setHostname] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [proxyJump, setProxyJump] = useState('')
  const [defaultPath, setDefaultPath] = useState('')
  const [groupId, setGroupId] = useState<string>(NO_GROUP)
  const [authType, setAuthType] = useState<AuthType>('password')
  const [kind, setKind] = useState<HostKind>('ssh')
  const [credentialId, setCredentialId] = useState<string | null>(null)
  // Secrets live only in this component's local state and are passed straight
  // to the IPC call on submit — they never enter the zustand store.
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [keyPath, setKeyPath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [clearPassphrase, setClearPassphrase] = useState(false)
  const [vncPort, setVncPort] = useState('')
  const [vncMode, setVncMode] = useState<VncMode>('tunnel')
  const [vncPassword, setVncPassword] = useState('')
  const [clearVncPassword, setClearVncPassword] = useState(false)
  const [rdpPort, setRdpPort] = useState('')
  const [domain, setDomain] = useState('')
  const [rdpPassword, setRdpPassword] = useState('')
  const [showSecrets, setShowSecrets] = useState(false)
  const [clearRdpPassword, setClearRdpPassword] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Reset the form every time the dialog opens or closes.
  useEffect(() => {
    if (!open) {
      // Clear secrets immediately on close — component stays mounted in Sidebar.
      setPassword('')
      setPassphrase('')
      setVncPassword('')
      setRdpPassword('')
      return
    }
    let cancelled = false
    void (async () => {
      // Load credentials before binding the managed-credential dropdown so the
      // saved credentialId resolves to a label instead of "Enter manually".
      await loadCredentials()
      if (cancelled) return
      setLabel(resolvedHost?.label ?? '')
      setHostname(resolvedHost?.hostname ?? '')
      setPort(String(resolvedHost?.port ?? 22))
      setUsername(resolvedHost?.username ?? '')
      setProxyJump(resolvedHost?.proxyJump ?? '')
      setDefaultPath(resolvedHost?.defaultPath ?? '')
      setGroupId(resolvedHost?.groupId ?? NO_GROUP)
      setAuthType(resolvedHost?.authType ?? 'password')
      setKind(resolvedHost?.kind ?? 'ssh')
      setCredentialId(resolvedHost?.credentialId ?? null)
      setPassword('')
      setClearPassword(false)
      setKeyPath(resolvedHost?.keyPath ?? '')
      setPassphrase('')
      setClearPassphrase(false)
      setVncPort(resolvedHost?.vncPort != null ? String(resolvedHost.vncPort) : '')
      // A VNC-only host can never tunnel; coerce legacy/edited values to direct.
      setVncMode(resolvedHost?.kind === 'vnc' ? 'direct' : (resolvedHost?.vncMode ?? 'tunnel'))
      setVncPassword('')
      setClearVncPassword(false)
      setRdpPort(resolvedHost?.rdpPort != null ? String(resolvedHost.rdpPort) : '')
      setDomain(resolvedHost?.domain ?? '')
      setRdpPassword('')
      setClearRdpPassword(false)
      setErrors({})
      setFormError(null)
      setSubmitting(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, resolvedHost, loadCredentials])

  // Refresh the credential list after closing Manage… so new/edited entries appear.
  useEffect(() => {
    if (prevCredentialsOpen.current && !credentialsOpen && open) {
      void loadCredentials()
    }
    prevCredentialsOpen.current = credentialsOpen
  }, [credentialsOpen, open, loadCredentials])

  // The credential_id slot holds EITHER an SSH credential (SSH side) or a VNC
  // credential (direct-VNC side) — never both. These derive the active context.
  const selectedCredential = credentialId
    ? (credentials.find((c) => c.id === credentialId) ?? null)
    : null
  const sshCredentials = credentials.filter((c) => c.type === 'ssh')
  const vncCredentials = credentials.filter((c) => c.type === 'vnc')
  const sshCredentialSelected = selectedCredential?.type === 'ssh'
  const vncCredentialSelected = selectedCredential?.type === 'vnc'
  // A shared VNC password applies only to a direct-mode VNC-capable host.
  const showVncCredentialPicker = kind !== 'ssh' && vncMode === 'direct'

  // Switching kind clears the secrets/fields that no longer apply, so stale
  // values can never linger in component state or be sent over IPC on submit.
  function handleKindChange(next: HostKind): void {
    setKind(next)
    if (next === 'vnc') {
      // Pure VNC: no SSH secrets, and tunnel mode is impossible without SSH creds.
      setPassword('')
      setClearPassword(false)
      setPassphrase('')
      setClearPassphrase(false)
      setVncMode('direct')
      // An SSH credential can't serve a pure-VNC host — release the slot.
      if (sshCredentialSelected) setCredentialId(null)
    } else if (next === 'ssh') {
      // Pure SSH: no VNC secret, and no VNC credential.
      setVncPassword('')
      setClearVncPassword(false)
      if (vncCredentialSelected) setCredentialId(null)
    }
    if (next === 'rdp') {
      // Pure RDP: no SSH/VNC secrets or credential; it authenticates on its own.
      setPassword('')
      setClearPassword(false)
      setPassphrase('')
      setClearPassphrase(false)
      setVncPassword('')
      setClearVncPassword(false)
      if (credentialId) setCredentialId(null)
    } else {
      // Leaving RDP: drop the RDP password.
      setRdpPassword('')
      setClearRdpPassword(false)
    }
  }

  // A VNC credential only applies in direct mode; drop it when leaving direct.
  function handleVncModeChange(next: VncMode): void {
    setVncMode(next)
    if (next !== 'direct' && vncCredentialSelected) setCredentialId(null)
  }

  function validate(): FormErrors {
    const next: FormErrors = {}
    if (!label.trim()) next.label = 'Label is required'
    if (!hostname.trim()) next.hostname = 'Hostname is required'
    // A username is required for SSH hosts unless the chosen SSH credential
    // supplies one (a credential may be "just a secret" with no username).
    const credHasUsername =
      sshCredentialSelected && (selectedCredential?.username ?? '').trim() !== ''
    const requiresSsh = kind !== 'vnc' && !credHasUsername
    if (requiresSsh && !username.trim()) next.username = 'Username is required'
    const portNumber = Number(port.trim())
    if (!/^\d+$/.test(port.trim()) || portNumber < 1 || portNumber > 65535) {
      next.port = 'Port must be between 1 and 65535'
    }
    return next
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const input: HostInput = {
      label: label.trim(),
      hostname: hostname.trim(),
      port: Number(port.trim()),
      username: kind === 'vnc' ? '' : username.trim() || '',
      kind,
      authType,
      // One slot holds either an SSH or a VNC credential; the backend type-guards.
      credentialId,
      keyPath: kind !== 'vnc' && authType === 'key' && keyPath.trim() ? keyPath.trim() : null,
      proxyJump: proxyJump.trim() ? proxyJump.trim() : null,
      // Remote path is an SSH/SFTP concept — never stored for a pure-VNC host.
      defaultPath: kind !== 'vnc' && defaultPath.trim() ? defaultPath.trim() : null,
      groupId: groupId === NO_GROUP ? null : groupId,
      tags: resolvedHost?.tags ?? [],
      color: resolvedHost?.color ?? null,
      vncPort: /^\d+$/.test(vncPort.trim()) ? Number(vncPort.trim()) : null,
      vncMode,
      rdpPort: kind === 'rdp' && /^\d+$/.test(rdpPort.trim()) ? Number(rdpPort.trim()) : null,
      // RDP tunnel awaits a combined SSH+RDP kind; pure-RDP hosts are direct.
      rdpMode: 'direct',
      domain: kind === 'rdp' && domain.trim() ? domain.trim() : null,
    }
    // Secrets are sent only for the capability the selected kind actually has,
    // mirroring the server-side enforcement in hosts-repo. A host using a shared
    // credential carries no inline secret of its own (for that capability).
    if (kind !== 'ssh' && !vncCredentialSelected) {
      if (clearVncPassword) input.clearVncPassword = true
      else if (vncPassword) input.vncPassword = vncPassword
    }
    const inlineSsh = kind !== 'vnc' && !sshCredentialSelected
    if (inlineSsh && authType === 'password') {
      if (clearPassword) input.clearPassword = true
      else if (password) input.password = password
    }
    if (inlineSsh && authType === 'key') {
      if (clearPassphrase) input.clearPassphrase = true
      else if (passphrase) input.passphrase = passphrase
    }
    if (kind === 'rdp') {
      if (clearRdpPassword) input.clearRdpPassword = true
      else if (rdpPassword) input.rdpPassword = rdpPassword
    }

    setSubmitting(true)
    try {
      await (resolvedHost ? updateHost(resolvedHost.id, input) : createHost(input))
      onOpenChange(false)
    } catch (err) {
      setFormError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="host-form-description">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit host' : 'Add host'}</DialogTitle>
          <DialogDescription id="host-form-description">
            {isEdit
              ? 'Update connection details. Saved secrets stay unchanged unless you replace or clear them.'
              : kind === 'ssh'
                ? 'SSH host with optional terminal and SFTP.'
                : kind === 'vnc'
                  ? 'VNC host (direct or via SSH tunnel for security).'
                  : kind === 'rdp'
                    ? 'Windows RDP host (NLA/CredSSP) via an in-app proxy.'
                    : 'Host with both SSH (terminal/SFTP) and VNC desktop access.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="host-label">Label</Label>
            <Input
              id="host-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="prod-web-1"
              aria-invalid={errors.label ? true : undefined}
              aria-describedby={errors.label ? 'host-label-error' : undefined}
              autoFocus
            />
            {errors.label && (
              <p id="host-label-error" className="text-xs text-destructive">
                {errors.label}
              </p>
            )}
          </div>
          {/* VNC-only hosts have no SSH service, so the SSH port field is hidden —
              the VNC port lives in the VNC section below. */}
          <div
            className={
              kind === 'vnc' || kind === 'rdp'
                ? 'flex flex-col gap-1.5'
                : 'grid grid-cols-[1fr_5.5rem] gap-3'
            }
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="host-hostname">Hostname</Label>
              <Input
                id="host-hostname"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="example.com"
                aria-invalid={errors.hostname ? true : undefined}
                aria-describedby={errors.hostname ? 'host-hostname-error' : undefined}
              />
              {errors.hostname && (
                <p id="host-hostname-error" className="text-xs text-destructive">
                  {errors.hostname}
                </p>
              )}
            </div>
            {(kind === 'ssh' || kind === 'both') && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="host-port">Port</Label>
                <Input
                  id="host-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  aria-invalid={errors.port ? true : undefined}
                  aria-describedby={errors.port ? 'host-port-error' : undefined}
                />
              </div>
            )}
            {(kind === 'ssh' || kind === 'both') && errors.port && (
              <p id="host-port-error" className="col-span-2 -mt-2 text-xs text-destructive">
                {errors.port}
              </p>
            )}
          </div>
          {kind !== 'vnc' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="host-username">Username</Label>
              <Input
                id="host-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
                aria-invalid={errors.username ? true : undefined}
                aria-describedby={errors.username ? 'host-username-error' : undefined}
              />
              {errors.username && (
                <p id="host-username-error" className="text-xs text-destructive">
                  {errors.username}
                </p>
              )}
            </div>
          )}
          {/* Host kind selector — makes SSH or VNC (or both) first-class and optional */}
          <fieldset className="flex flex-col gap-1.5 border-0 p-0 m-0">
            <legend className="mb-1.5 text-sm font-medium">Host kind</legend>
            <div className="flex gap-2">
              {(
                [
                  { value: 'ssh' as const, label: 'SSH only', hint: 'Terminal + SFTP' },
                  { value: 'vnc' as const, label: 'VNC only', hint: 'Desktop' },
                  { value: 'rdp' as const, label: 'RDP', hint: 'Windows' },
                  { value: 'both' as const, label: 'Both', hint: 'SSH + VNC' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleKindChange(opt.value)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-left text-sm transition ${
                    kind === opt.value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border hover:bg-accent/60'
                  }`}
                  aria-pressed={kind === opt.value}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground">{opt.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Choose capabilities. Secrets and fields are scoped to the selected kind.
            </p>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="host-proxy-jump">ProxyJump</Label>
            <Input
              id="host-proxy-jump"
              value={proxyJump}
              onChange={(e) => setProxyJump(e.target.value)}
              placeholder="user@jump-host[:port][,next-hop]"
              aria-describedby="host-proxy-jump-help"
            />
            <p id="host-proxy-jump-help" className="text-xs text-muted-foreground">
              Optional jump host chain, OpenSSH ProxyJump syntax.
            </p>
          </div>
          {(kind === 'ssh' || kind === 'both') && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="host-default-path">Default remote path</Label>
              <Input
                id="host-default-path"
                value={defaultPath}
                onChange={(e) => setDefaultPath(e.target.value)}
                placeholder="/var/www/app"
                aria-describedby="host-default-path-help"
              />
              <p id="host-default-path-help" className="text-xs text-muted-foreground">
                Optional. SFTP opens here and the terminal cd's here on connect (falls back to home
                if missing).
              </p>
            </div>
          )}
          {/* Group is purely organizational and applies to every kind, so it lives
              outside the SSH-only block (HostList groups VNC-only hosts too). */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="host-group">Group</Label>
            <div className="flex items-center gap-2">
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="host-group" className="w-full" aria-label="Group">
                  <SelectValue placeholder="No group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>No group</SelectItem>
                  {flattenGroupTree(groups).map(({ group, depth }) => (
                    <SelectItem
                      key={group.id}
                      value={group.id}
                      style={{ paddingLeft: 8 + depth * 14 }}
                    >
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setGroupsOpen(true)}>
                Manage…
              </Button>
            </div>
          </div>
          {(kind === 'ssh' || kind === 'both') && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="host-credential">Credential</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={managedCredentialValue(credentialId, sshCredentials)}
                    onValueChange={(value) => {
                      setCredentialId(value === NO_CREDENTIAL ? null : value)
                      // A credential may supply the username — drop any stale
                      // "username required" error so it doesn't contradict the new state.
                      setErrors((prev) => ({ ...prev, username: undefined }))
                    }}
                  >
                    <SelectTrigger id="host-credential" className="w-full" aria-label="Credential">
                      <SelectValue placeholder="Enter manually">
                        {managedCredentialLabel(credentialId, sshCredentials)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CREDENTIAL}>Enter manually</SelectItem>
                      {sshCredentials.map((cred) => (
                        <SelectItem key={cred.id} value={cred.id}>
                          {cred.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCredentialsOpen(true)}
                  >
                    Manage…
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Reuse a saved login across hosts, or enter credentials just for this host.
                </p>
              </div>
              {credentialId === null && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="host-auth-type">Authentication</Label>
                    <Select
                      value={authType}
                      onValueChange={(value) => setAuthType(value as AuthType)}
                    >
                      <SelectTrigger
                        id="host-auth-type"
                        className="w-full"
                        aria-label="Authentication"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="password">Password</SelectItem>
                        <SelectItem value="key">Private key</SelectItem>
                        <SelectItem value="agent">SSH agent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {authType === 'password' && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="host-password">Password</Label>
                      <Input
                        id="host-password"
                        type={showSecrets ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={
                          isEdit && resolvedHost.hasPassword ? '••• unchanged' : 'Password'
                        }
                        disabled={clearPassword}
                        autoComplete="off"
                      />
                      {isEdit && resolvedHost.hasPassword && (
                        <ClearSecretCheckbox
                          id="host-clear-password"
                          checked={clearPassword}
                          onChange={(checked) => {
                            setClearPassword(checked)
                            if (checked) setPassword('')
                          }}
                        >
                          Clear saved password
                        </ClearSecretCheckbox>
                      )}
                    </div>
                  )}
                  {authType === 'key' && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="host-key-path">Key path</Label>
                        <Input
                          id="host-key-path"
                          value={keyPath}
                          onChange={(e) => setKeyPath(e.target.value)}
                          placeholder="~/.ssh/id_ed25519"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="host-passphrase">Passphrase</Label>
                        <Input
                          id="host-passphrase"
                          type={showSecrets ? 'text' : 'password'}
                          value={passphrase}
                          onChange={(e) => setPassphrase(e.target.value)}
                          placeholder={
                            isEdit && resolvedHost.hasPassphrase ? '••• unchanged' : 'Optional'
                          }
                          disabled={clearPassphrase}
                          autoComplete="off"
                        />
                        {isEdit && resolvedHost.hasPassphrase && (
                          <ClearSecretCheckbox
                            id="host-clear-passphrase"
                            checked={clearPassphrase}
                            onChange={(checked) => {
                              setClearPassphrase(checked)
                              if (checked) setPassphrase('')
                            }}
                          >
                            Clear saved passphrase
                          </ClearSecretCheckbox>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {(kind === 'vnc' || kind === 'both') && (
            <fieldset className="flex flex-col gap-3 rounded-md border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                {kind === 'vnc' ? 'VNC' : 'VNC (optional)'}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="host-vnc-port">VNC port</Label>
                  <Input
                    id="host-vnc-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={vncPort}
                    onChange={(e) => setVncPort(e.target.value)}
                    placeholder="5900"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="host-vnc-mode">Connection</Label>
                  <Select
                    value={vncMode}
                    onValueChange={(value) => handleVncModeChange(value as VncMode)}
                  >
                    <SelectTrigger
                      id="host-vnc-mode"
                      className="w-full"
                      aria-label="VNC connection"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Tunnel needs SSH credentials, which a VNC-only host doesn't have. */}
                      <SelectItem value="tunnel" disabled={kind === 'vnc'}>
                        {kind === 'vnc'
                          ? 'SSH tunnel (needs SSH or Both)'
                          : 'SSH tunnel (recommended)'}
                      </SelectItem>
                      <SelectItem value="direct">Direct TCP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Shared VNC password source — only meaningful for direct mode. */}
              {showVncCredentialPicker && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="host-vnc-credential">VNC credential</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={managedCredentialValue(credentialId, vncCredentials)}
                      onValueChange={(value) =>
                        setCredentialId(value === NO_CREDENTIAL ? null : value)
                      }
                    >
                      <SelectTrigger
                        id="host-vnc-credential"
                        className="w-full"
                        aria-label="VNC credential"
                      >
                        <SelectValue placeholder="Enter manually">
                          {managedCredentialLabel(credentialId, vncCredentials)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CREDENTIAL}>Enter manually</SelectItem>
                        {vncCredentials.map((cred) => (
                          <SelectItem key={cred.id} value={cred.id}>
                            {cred.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCredentialsOpen(true)}
                    >
                      Manage…
                    </Button>
                  </div>
                </div>
              )}
              {!vncCredentialSelected ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="host-vnc-password">VNC password</Label>
                  <Input
                    id="host-vnc-password"
                    type={showSecrets ? 'text' : 'password'}
                    value={vncPassword}
                    onChange={(e) => setVncPassword(e.target.value)}
                    placeholder={
                      isEdit && resolvedHost.hasVncPassword ? '••• unchanged' : 'Optional'
                    }
                    disabled={clearVncPassword}
                    autoComplete="off"
                  />
                  {kind === 'vnc' && (
                    <p className="text-xs text-muted-foreground">
                      RealVNC hosts usually need a username too — use a managed VNC credential above
                      instead of entering only a password here.
                    </p>
                  )}
                  {isEdit && resolvedHost.hasVncPassword && (
                    <ClearSecretCheckbox
                      id="host-clear-vnc-password"
                      checked={clearVncPassword}
                      onChange={(checked) => {
                        setClearVncPassword(checked)
                        if (checked) setVncPassword('')
                      }}
                    >
                      Clear saved VNC password
                    </ClearSecretCheckbox>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Using managed VNC credential “{selectedCredential?.label}”
                  {selectedCredential?.username
                    ? ` (${selectedCredential.username})`
                    : ' — add a username in Credentials for RealVNC hosts'}
                  .
                </p>
              )}
            </fieldset>
          )}
          {kind === 'rdp' && (
            <fieldset className="flex flex-col gap-3 rounded-md border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">RDP</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="host-rdp-port">RDP port</Label>
                  <Input
                    id="host-rdp-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={rdpPort}
                    onChange={(e) => setRdpPort(e.target.value)}
                    placeholder="3389"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="host-rdp-domain">Domain</Label>
                  <Input
                    id="host-rdp-domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="CORP (optional)"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="host-rdp-password">Password</Label>
                <Input
                  id="host-rdp-password"
                  type={showSecrets ? 'text' : 'password'}
                  value={rdpPassword}
                  onChange={(e) => setRdpPassword(e.target.value)}
                  placeholder={isEdit && resolvedHost.hasRdpPassword ? '••• unchanged' : 'Password'}
                  disabled={clearRdpPassword}
                  autoComplete="off"
                />
                {isEdit && resolvedHost.hasRdpPassword && (
                  <ClearSecretCheckbox
                    id="host-clear-rdp-password"
                    checked={clearRdpPassword}
                    onChange={(checked) => {
                      setClearRdpPassword(checked)
                      if (checked) setRdpPassword('')
                    }}
                  >
                    Clear saved RDP password
                  </ClearSecretCheckbox>
                )}
                <p className="text-xs text-muted-foreground">
                  Connects to Windows RDP (NLA/CredSSP) via an in-app proxy. Leave the password
                  blank to enter it at the Windows logon screen.
                </p>
              </div>
            </fieldset>
          )}
          {formError && (
            <div role="alert" className="text-xs">
              <span className="text-destructive">{formError}</span>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showSecrets}
              onChange={(e) => setShowSecrets(e.target.checked)}
            />
            Show secrets while typing
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isEdit ? 'Save changes' : 'Add host'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
