import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useCredentialsStore } from '@renderer/stores/credentials'
import { useHostsStore } from '@renderer/stores/hosts'
import type { AuthType, Credential, CredentialInput, CredentialType } from '@shared/ipc'
import { Check, KeyRound, Loader2, MonitorDot, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

const AUTH_LABEL: Record<AuthType, string> = {
  password: 'Password',
  key: 'Private key',
  agent: 'SSH agent',
}

interface CredentialsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

/** Manage reusable SSH credentials ("Keychain") that hosts can share. */
export function CredentialsDialog({
  open,
  onOpenChange,
}: CredentialsDialogProps): React.JSX.Element {
  const credentials = useCredentialsStore((s) => s.credentials)
  const loadAll = useCredentialsStore((s) => s.loadAll)
  const deleteCredential = useCredentialsStore((s) => s.deleteCredential)
  const hosts = useHostsStore((s) => s.hosts)
  const [editing, setEditing] = useState<Credential | { create: CredentialType } | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const usedByCount = (credentialId: string): number =>
    hosts.filter((h) => h.credentialId === credentialId).length

  const sshCreds = credentials.filter((c) => c.type === 'ssh')
  const vncCreds = credentials.filter((c) => c.type === 'vnc')

  function renderRow(cred: Credential): React.JSX.Element {
    const used = usedByCount(cred.id)
    const Icon = cred.type === 'vnc' ? MonitorDot : KeyRound
    const subtitle =
      cred.type === 'vnc'
        ? `${cred.username || '(no username)'} · VNC password`
        : `${cred.username || '(no username)'} · ${AUTH_LABEL[cred.authType]}`
    return (
      <li key={cred.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{cred.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {subtitle}
            {used > 0 && ` · used by ${used} host${used === 1 ? '' : 's'}`}
          </p>
        </div>
        {confirmingId === cred.id ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="text-xs text-destructive">
              {used > 0 ? `${used} host${used === 1 ? '' : 's'} lose this. Delete?` : 'Delete?'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive"
              onClick={() => {
                setConfirmingId(null)
                void deleteCredential(cred.id)
              }}
              aria-label={`Confirm delete ${cred.label}`}
            >
              <Check className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setConfirmingId(null)}
              aria-label="Cancel delete"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setEditing(cred)}
              aria-label={`Edit ${cred.label}`}
              title="Edit"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive"
              onClick={() => setConfirmingId(cred.id)}
              aria-label={`Delete ${cred.label}`}
              title="Delete"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </li>
    )
  }

  useEffect(() => {
    if (open) void loadAll()
  }, [open, loadAll])

  // Reset any open form / pending confirm whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setEditing(null)
      setConfirmingId(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="credentials-description">
        <DialogHeader>
          <DialogTitle>Credentials</DialogTitle>
          <DialogDescription id="credentials-description">
            Saved SSH identities you can assign to multiple hosts. Editing one updates every host
            that uses it.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <CredentialForm
            credential={'create' in editing ? null : editing}
            type={'create' in editing ? editing.create : editing.type}
            onDone={() => setEditing(null)}
          />
        ) : (
          <div className="flex max-h-[28rem] flex-col gap-4 overflow-y-auto">
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <KeyRound className="size-3.5" /> SSH credentials
              </h3>
              <ul className="flex flex-col gap-1">
                {sshCreds.length === 0 && (
                  <li className="px-1 py-3 text-center text-xs text-muted-foreground">
                    No SSH credentials yet. Create one and pick it on a host.
                  </li>
                )}
                {sshCreds.map(renderRow)}
              </ul>
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setEditing({ create: 'ssh' })}
              >
                <Plus /> Add SSH credential
              </Button>
            </section>

            <section className="flex flex-col gap-2 border-t pt-4">
              <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <MonitorDot className="size-3.5" /> VNC credentials
              </h3>
              <p className="text-xs text-muted-foreground">
                Username and password for RealVNC hosts. Assign to direct-mode VNC hosts.
              </p>
              <ul className="flex flex-col gap-1">
                {vncCreds.length === 0 && (
                  <li className="px-1 py-3 text-center text-xs text-muted-foreground">
                    No shared VNC passwords yet. Add one and assign it to a direct-mode VNC host.
                  </li>
                )}
                {vncCreds.map(renderRow)}
              </ul>
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setEditing({ create: 'vnc' })}
              >
                <Plus /> Add VNC credential
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CredentialForm({
  credential,
  type,
  onDone,
}: {
  credential: Credential | null
  type: CredentialType
  onDone(): void
}): React.JSX.Element {
  const createCredential = useCredentialsStore((s) => s.createCredential)
  const updateCredential = useCredentialsStore((s) => s.updateCredential)
  const isEdit = credential != null
  const isVnc = type === 'vnc'

  const [label, setLabel] = useState(credential?.label ?? '')
  const [username, setUsername] = useState(credential?.username ?? '')
  const [authType, setAuthType] = useState<AuthType>(credential?.authType ?? 'password')
  const [keyPath, setKeyPath] = useState(credential?.keyPath ?? '')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [clearPassphrase, setClearPassphrase] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const effectiveAuthType: AuthType = isVnc ? 'password' : authType

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!label.trim()) {
      setError('Label is required')
      return
    }
    if (isVnc && !username.trim()) {
      setError('Username is required for VNC credentials')
      return
    }
    const input: CredentialInput = {
      label: label.trim(),
      type,
      username: username.trim(),
      authType: effectiveAuthType,
      keyPath: !isVnc && authType === 'key' && keyPath.trim() ? keyPath.trim() : null,
    }
    if (effectiveAuthType === 'password') {
      if (clearPassword) input.clearPassword = true
      else if (password) input.password = password
    }
    if (!isVnc && authType === 'key') {
      if (clearPassphrase) input.clearPassphrase = true
      else if (passphrase) input.passphrase = passphrase
    }

    setSubmitting(true)
    try {
      if (credential) await updateCredential(credential.id, input)
      else await createCredential(input)
      onDone()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cred-label">Label</Label>
        <Input
          id="cred-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={isVnc ? 'lab VNC password' : 'prod deploy key'}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cred-username">{isVnc ? 'VNC username' : 'Username (optional)'}</Label>
        <Input
          id="cred-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={
            isVnc ? 'RealVNC account name' : 'deploy — leave blank to use each host’s own username'
          }
        />
      </div>
      {!isVnc && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cred-auth-type">Authentication</Label>
          <Select value={authType} onValueChange={(value) => setAuthType(value as AuthType)}>
            <SelectTrigger id="cred-auth-type" className="w-full" aria-label="Authentication">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="password">Password</SelectItem>
              <SelectItem value="key">Private key</SelectItem>
              <SelectItem value="agent">SSH agent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {(isVnc || authType === 'password') && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cred-password">{isVnc ? 'VNC password' : 'Password'}</Label>
          <Input
            id="cred-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit && credential.hasPassword ? '••• unchanged' : 'Password'}
            disabled={clearPassword}
            autoComplete="off"
          />
          {isEdit && credential.hasPassword && (
            <label
              htmlFor="cred-clear-password"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <input
                id="cred-clear-password"
                type="checkbox"
                checked={clearPassword}
                onChange={(e) => {
                  setClearPassword(e.target.checked)
                  if (e.target.checked) setPassword('')
                }}
                className="size-3.5 accent-primary"
              />
              Clear saved password
            </label>
          )}
        </div>
      )}
      {!isVnc && authType === 'key' && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-key-path">Key path</Label>
            <Input
              id="cred-key-path"
              value={keyPath}
              onChange={(e) => setKeyPath(e.target.value)}
              placeholder="~/.ssh/id_ed25519"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-passphrase">Passphrase</Label>
            <Input
              id="cred-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={isEdit && credential.hasPassphrase ? '••• unchanged' : 'Optional'}
              disabled={clearPassphrase}
              autoComplete="off"
            />
            {isEdit && credential.hasPassphrase && (
              <label
                htmlFor="cred-clear-passphrase"
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <input
                  id="cred-clear-passphrase"
                  type="checkbox"
                  checked={clearPassphrase}
                  onChange={(e) => {
                    setClearPassphrase(e.target.checked)
                    if (e.target.checked) setPassphrase('')
                  }}
                  className="size-3.5 accent-primary"
                />
                Clear saved passphrase
              </label>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
          {isEdit
            ? isVnc
              ? 'Save VNC password'
              : 'Save credential'
            : isVnc
              ? 'Create VNC password'
              : 'Create credential'}
        </Button>
      </div>
    </form>
  )
}
