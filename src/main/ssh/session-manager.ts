import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC_EVENTS, sshDataChannel } from '@shared/channels'
import {
  type HostKeyPrompt,
  hostKeyPromptSchema,
  type SshConnectResult,
  type SshSessionEvent,
  sshSessionEventSchema,
} from '@shared/ipc'
import { and, eq } from 'drizzle-orm'
import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type Prompt,
  type PseudoTtyOptions,
} from 'ssh2'
import { devEnvFlag } from '../app-paths'
import { sanitizeErrorMessage } from '../ipc/hosts'
import { logActivity } from '../store/activity-logger'
import { getDb } from '../store/db'
import {
  findHostRow,
  findHostRowByEndpoint,
  type HostRow,
  type ResolvedHostAuth,
  resolveHostAuth,
} from '../store/hosts-repo'
import { knownHosts } from '../store/schema'
import { decryptSecret } from '../store/secrets'
import { getSettings } from '../store/settings'
import { buildRemoteInitCommand } from '../terminal/terminal-programs'
import { classifyHostKey, fingerprintOf, parseKeyType, parseProxyJump } from './ssh-util'

/**
 * SSH session manager. All ssh2 usage lives here, in the main process.
 *
 * Security invariants:
 * - Vault secrets are decrypted at connect time only; local references are
 *   dropped as soon as ssh2 has consumed them.
 * - Secrets are never logged and never sent over IPC.
 * - Host keys are verified against the known_hosts table for the FINAL TARGET
 *   AND for every ProxyJump intermediate hop, with the same TOFU / mismatch
 *   hard-abort semantics (see connectJumpChain). An unverified hop could MITM
 *   the inner handshake and steal any password sent to the hop, so hops are
 *   never connected without verification.
 * - Every outbound payload to the renderer is owner-scoped: terminal data and
 *   lifecycle events go only to the WebContents that opened the session.
 */

const KEEPALIVE_COUNT_MAX = 3

/** Keepalive interval from settings (seconds → ms); 0 disables keepalives. */
function keepaliveIntervalMs(): number {
  return getSettings().keepaliveSeconds * 1000
}
const READY_TIMEOUT_MS = 20_000
const HOST_KEY_PROMPT_TIMEOUT_MS = 60_000
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
/** Early-output replay buffer cap (per session) — covers MOTD/banner bursts. */
const PRE_ATTACH_BUFFER_BYTES = 256 * 1024

/**
 * Minimal data-sink abstraction over Electron's WebContents so sessions can
 * be driven headlessly (smoke tests). A real WebContents satisfies this
 * interface structurally.
 */
export interface DataSink {
  /** Stable owner identifier (WebContents.id for real windows). */
  readonly id: number
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

interface Session {
  readonly id: string
  readonly hostId: string
  readonly owner: DataSink
  /** Hop clients in chain order; the final target client is last. */
  readonly clients: Client[]
  stream: ClientChannel | null
  /** Set once the session reached 'connected'. */
  connected: boolean
  /** Set when the renderer aborts an in-flight connect. */
  aborted: boolean
  /** Set once the session has been torn down — guards double cleanup. */
  closed: boolean
  /** Set when a hostkey-mismatch event was emitted, to suppress the generic error event. */
  mismatchEmitted: boolean
  /** True once the renderer signalled its terminal subscription is live. */
  attached: boolean
  /** Output buffered before attach; flushed (FIFO) on attach. */
  preAttach: Buffer[]
  preAttachBytes: number
  /** When true, never prompt for an unknown/mismatched host key — fail fast.
   *  Used by batch automation so a run can't spawn N interactive prompts. */
  nonInteractiveHostKey?: boolean
  /** Set by host-key verification (non-interactive mode) to give callers a clear reason. */
  hostKeyError?: string
  /** Set on interactive terminal sessions so their connect/disconnect is logged.
   *  Dedicated (SFTP/VNC) connections leave this unset — their open action is logged instead. */
  logKind?: 'ssh'
}

interface PendingHostKey {
  readonly ownerId: number
  resolve(accept: boolean): void
}

/** Auth material for one client connection. `wipe()` drops secret refs. */
interface AuthMaterial {
  config: Partial<ConnectConfig>
  /** Retained only to answer keyboard-interactive prompts; wiped after auth. */
  password: string | undefined
}

function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function defaultAgent(): string | undefined {
  return process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK
}

/**
 * Builds the ssh2 auth fields from resolved auth material (host's own, or its
 * referenced shared credential — see resolveHostAuth), decrypting at the last
 * moment.
 */
async function buildAuthMaterial(auth: ResolvedHostAuth): Promise<AuthMaterial> {
  // A host using a credential may carry no username of its own, and a credential
  // may be "just a secret" with no username either — guard against connecting as
  // the empty user, which yields a confusing auth failure instead of a clear one.
  if (auth.username.trim() === '') {
    throw new Error('No username configured — set one on the host or its credential')
  }
  switch (auth.authType) {
    case 'password': {
      if (!auth.passwordEnc) throw new Error('No password stored for this host')
      const password = decryptSecret(auth.passwordEnc)
      return { config: { password, tryKeyboard: true }, password }
    }
    case 'key': {
      if (!auth.keyPath) throw new Error('No key path configured for this host')
      const privateKey = await readFile(expandTilde(auth.keyPath))
      const passphrase = auth.passphraseEnc ? decryptSecret(auth.passphraseEnc) : undefined
      return { config: { privateKey, passphrase }, password: undefined }
    }
    case 'agent': {
      const agent = defaultAgent()
      if (!agent) throw new Error('SSH agent not available (SSH_AUTH_SOCK is not set)')
      return { config: { agent }, password: undefined }
    }
  }
}

/** Connects an ssh2 client and resolves on 'ready'. Listeners are detached after settle. */
function connectClient(client: Client, config: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      client.removeListener('ready', onReady)
      client.removeListener('error', onError)
      client.removeListener('close', onClose)
    }
    const onReady = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const onError = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    const onClose = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Connection closed during setup'))
    }
    client.once('ready', onReady)
    client.once('error', onError)
    client.once('close', onClose)
    client.connect(config)
  })
}

function forwardOut(client: Client, dstHost: string, dstPort: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
      if (err) reject(err)
      else resolve(stream)
    })
  })
}

function openShell(client: Client, pty: PseudoTtyOptions): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell(pty, (err, stream) => {
      if (err) reject(err)
      else resolve(stream)
    })
  })
}

/**
 * keyboard-interactive handler that answers ONLY a single non-echo prompt (the
 * real password challenge) with the stored password; any other prompt shape —
 * extra prompts, echoed prompts, or no password configured — gets empty
 * responses. A malicious server otherwise controls the prompts and could phish
 * the stored vault/hop password by simply asking for it under any label.
 */
function answerPasswordPrompt(password: string | undefined) {
  return (
    _name: string,
    _instructions: string,
    _lang: string,
    prompts: Prompt[],
    finish: (responses: string[]) => void,
  ): void => {
    if (password !== undefined && prompts.length === 1 && prompts[0]?.echo === false) {
      finish([password])
    } else {
      finish(prompts.map(() => ''))
    }
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly pendingHostKey = new Map<string, PendingHostKey>()

  /**
   * Opens an SSH shell session to a vault host on behalf of `owner` and
   * starts streaming terminal output to it. Resolves once the shell is open.
   */
  async connect(hostId: string, owner: DataSink): Promise<SshConnectResult> {
    const row = findHostRow(hostId)
    if (!row) throw new Error('Host not found')

    const sessionId = randomUUID()
    const session: Session = {
      id: sessionId,
      hostId,
      owner,
      clients: [],
      stream: null,
      connected: false,
      aborted: false,
      closed: false,
      mismatchEmitted: false,
      attached: false,
      preAttach: [],
      preAttachBytes: 0,
      logKind: 'ssh',
    }
    this.sessions.set(sessionId, session)
    this.emitEvent(session, 'connecting')

    try {
      const sock = await this.connectJumpChain(session, row)
      this.assertNotAborted(session)
      const target = new Client()
      session.clients.push(target)

      const resolved = resolveHostAuth(row)
      const auth = await buildAuthMaterial(resolved)
      this.assertNotAborted(session)
      // Password fallback: some servers only offer keyboard-interactive.
      if (auth.password !== undefined) {
        target.on('keyboard-interactive', answerPasswordPrompt(auth.password))
      }

      const config: ConnectConfig = {
        host: row.hostname,
        port: row.port,
        username: resolved.username,
        keepaliveInterval: keepaliveIntervalMs(),
        keepaliveCountMax: KEEPALIVE_COUNT_MAX,
        readyTimeout: READY_TIMEOUT_MS,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void): void => {
          this.verifyHostKey(session, row, key, verify)
        },
        ...auth.config,
        ...(sock ? { sock } : {}),
      }
      try {
        await connectClient(target, config)
      } finally {
        // Drop local secret references; ssh2 has consumed what it needs.
        auth.password = undefined
        auth.config = {}
      }
      this.assertNotAborted(session)

      const stream = await openShell(target, {
        term: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      })
      session.stream = stream
      this.wireStream(session, target, stream)
      session.connected = true
      this.emitEvent(session, 'connected')
      // Apply the host's default path and/or the chosen terminal program by
      // typing one line into the fresh shell. Best-effort: a missing remote dir
      // or a program absent on the remote both degrade gracefully to a normal
      // shell (see buildRemoteInitCommand).
      const init = buildRemoteInitCommand({
        defaultPath: row.defaultPath,
        program: getSettings().terminalProgram,
      })
      if (init) stream.write(`${init}\n`)
      logActivity({ action: 'connected', kind: 'ssh', hostId })
      return { sessionId }
    } catch (err) {
      const message = session.aborted ? 'Connection aborted' : sanitizeErrorMessage(err)
      if (!session.mismatchEmitted && !session.aborted) this.emitEvent(session, 'error', message)
      if (!session.aborted) logActivity({ action: 'failed', kind: 'ssh', hostId, detail: message })
      this.teardown(session)
      throw new Error(message)
    }
  }

  /**
   * Borrows the live ssh2 Client of a connected terminal session for the same
   * host and owner, or null. Borrowed clients keep their own lifecycle — the
   * borrower must tolerate the client closing underneath it.
   */
  borrowClient(hostId: string, ownerId: number): Client | null {
    for (const session of this.sessions.values()) {
      if (
        session.hostId === hostId &&
        session.owner.id === ownerId &&
        session.connected &&
        !session.closed
      ) {
        return session.clients.at(-1) ?? null
      }
    }
    return null
  }

  /**
   * Establishes a dedicated, shell-less connection (for SFTP). The session is
   * registered like a terminal session, so host-key prompts, owner scoping and
   * teardown behave identically; callers close it via `disconnect()`.
   */
  async connectDedicated(
    hostId: string,
    owner: DataSink,
    opts?: { promptHostKey?: boolean },
  ): Promise<{ sessionId: string; client: Client }> {
    const row = findHostRow(hostId)
    if (!row) throw new Error('Host not found')

    const sessionId = randomUUID()
    const session: Session = {
      id: sessionId,
      hostId,
      owner,
      clients: [],
      stream: null,
      connected: false,
      aborted: false,
      closed: false,
      mismatchEmitted: false,
      attached: false,
      preAttach: [],
      preAttachBytes: 0,
      // Batch callers (automation) opt out of interactive host-key prompts.
      nonInteractiveHostKey: opts?.promptHostKey === false,
    }
    this.sessions.set(sessionId, session)

    try {
      const sock = await this.connectJumpChain(session, row)
      this.assertNotAborted(session)
      const target = new Client()
      session.clients.push(target)

      const resolved = resolveHostAuth(row)
      const auth = await buildAuthMaterial(resolved)
      this.assertNotAborted(session)
      if (auth.password !== undefined) {
        target.on('keyboard-interactive', answerPasswordPrompt(auth.password))
      }
      const config: ConnectConfig = {
        host: row.hostname,
        port: row.port,
        username: resolved.username,
        keepaliveInterval: keepaliveIntervalMs(),
        keepaliveCountMax: KEEPALIVE_COUNT_MAX,
        readyTimeout: READY_TIMEOUT_MS,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void): void => {
          this.verifyHostKey(session, row, key, verify)
        },
        ...auth.config,
        ...(sock ? { sock } : {}),
      }
      try {
        await connectClient(target, config)
      } finally {
        auth.password = undefined
        auth.config = {}
      }
      this.assertNotAborted(session)

      session.connected = true
      target.on('error', (err) => this.finish(session, 'error', sanitizeErrorMessage(err)))
      target.on('close', () => this.finish(session, 'disconnected'))
      for (const hop of session.clients) {
        if (hop === target) continue
        hop.on('error', (err) => this.finish(session, 'error', sanitizeErrorMessage(err)))
        hop.on('close', () => this.finish(session, 'disconnected'))
      }
      return { sessionId, client: target }
    } catch (err) {
      const message = session.aborted
        ? 'Connection aborted'
        : (session.hostKeyError ?? sanitizeErrorMessage(err))
      this.teardown(session)
      throw new Error(message)
    }
  }

  /** Stops an in-flight connect (terminal, SFTP, or VNC bridge) for this owner+host. */
  abortPendingConnect(hostId: string, ownerId: number): void {
    for (const session of [...this.sessions.values()]) {
      if (
        session.hostId !== hostId ||
        session.owner.id !== ownerId ||
        session.connected ||
        session.closed
      ) {
        continue
      }
      session.aborted = true
      for (const pending of this.pendingHostKey.values()) {
        if (pending.ownerId === ownerId) pending.resolve(false)
      }
      this.teardown(session)
    }
  }

  private assertNotAborted(session: Session): void {
    if (session.aborted) throw new Error('Connection aborted')
  }

  /** Establishes the ProxyJump chain (if any) and returns the final hop's tunnel stream. */
  private async connectJumpChain(
    session: Session,
    row: HostRow,
  ): Promise<ClientChannel | undefined> {
    if (!row.proxyJump) return undefined
    const hops = parseProxyJump(row.proxyJump)
    let sock: ClientChannel | undefined

    for (let i = 0; i < hops.length; i++) {
      const hop = hops[i]
      if (!hop) continue
      // Match the hop endpoint by the host's own stored username (what
      // findHostRowByEndpoint compares against) — the connecting host's
      // credential identity must not rename an intermediate jump host.
      const hopUsername = hop.username ?? row.username
      // Reuse vault auth when a stored host matches this hop endpoint; otherwise agent.
      const hopRow = findHostRowByEndpoint(hop.host, hopUsername, hop.port)
      const auth: AuthMaterial = hopRow
        ? await buildAuthMaterial(resolveHostAuth(hopRow))
        : { config: { agent: defaultAgent() }, password: undefined }
      if (!hopRow && auth.config.agent === undefined) {
        throw new Error(
          `No stored credentials for jump host ${hop.host} and no SSH agent available`,
        )
      }

      const client = new Client()
      session.clients.push(client)
      if (auth.password !== undefined) {
        client.on('keyboard-interactive', answerPasswordPrompt(auth.password))
      }
      try {
        await connectClient(client, {
          host: hop.host,
          port: hop.port,
          username: hopUsername,
          keepaliveInterval: keepaliveIntervalMs(),
          keepaliveCountMax: KEEPALIVE_COUNT_MAX,
          readyTimeout: READY_TIMEOUT_MS,
          // Every jump hop is host-key verified with the same TOFU / mismatch
          // hard-abort behavior as the final target. An unverified hop would let
          // a malicious jump host MITM the inner session (and steal any password
          // sent to the hop itself), so we never connect a hop without this.
          hostVerifier: (key: Buffer, verify: (valid: boolean) => void): void => {
            this.verifyHostKey(session, { hostname: hop.host, port: hop.port }, key, verify)
          },
          ...auth.config,
          ...(sock ? { sock } : {}),
        })
      } finally {
        auth.password = undefined
        auth.config = {}
      }

      const next = hops[i + 1]
      const dstHost = next ? next.host : row.hostname
      const dstPort = next ? next.port : row.port
      sock = await forwardOut(client, dstHost, dstPort)
    }
    return sock
  }

  /**
   * Final-target host-key verification against the known_hosts table.
   * - match    → proceed
   * - mismatch → abort with a stern 'hostkey-mismatch' event, never prompt
   * - changed  → prompt, but flagged previouslyKnown so the dialog warns loudly
   *              (endpoint already known, presented an untrusted key/type)
   * - unknown  → prompt the owner (auto-accept under TERMDESK_SMOKE, which
   *              `devEnvFlag` ignores in packaged builds)
   */
  private verifyHostKey(
    session: Session,
    row: { hostname: string; port: number },
    keyBlob: Buffer,
    verify: (valid: boolean) => void,
  ): void {
    try {
      const keyType = parseKeyType(keyBlob)
      const fingerprint = fingerprintOf(keyBlob)
      // Look up ALL trusted keys for this endpoint by (host, port) — NOT scoped
      // by keyType. OpenSSH compares the presented key against every trusted key
      // for a host regardless of algorithm; scoping by type would let a MITM
      // dodge the mismatch alarm by offering a key of a type we haven't seen.
      const knownRows = getDb()
        .select()
        .from(knownHosts)
        .where(and(eq(knownHosts.host, row.hostname), eq(knownHosts.port, row.port)))
        .all()

      const verdict = classifyHostKey(knownRows, keyType, fingerprint)
      if (verdict === 'match') {
        verify(true)
        return
      }

      if (verdict === 'mismatch') {
        // At least one key is trusted for this endpoint, but none matches the
        // presented key (different fingerprint OR different algorithm) → MITM.
        session.mismatchEmitted = true
        const trusted = knownRows.map((k) => `${k.keyType} ${k.fingerprintSha256}`).join(', ')
        if (session.nonInteractiveHostKey) {
          session.hostKeyError = `Host key for ${row.hostname}:${row.port} changed since it was trusted (possible MITM) — refusing to connect.`
        }
        this.emitEvent(
          session,
          'hostkey-mismatch',
          `HOST KEY VERIFICATION FAILED for ${row.hostname}:${row.port}. ` +
            `The server presented a ${keyType} key with fingerprint ${fingerprint}, ` +
            `but the previously trusted key(s) are: ${trusted}. ` +
            'Someone could be intercepting this connection (man-in-the-middle attack), ' +
            'or the server host key may have been changed. The connection was aborted. ' +
            'If the key change is legitimate, remove the stored host key and reconnect.',
        )
        verify(false)
        return
      }

      // Unknown host key.
      //
      // The smoke harnesses connect to a throwaway docker server with no way to
      // answer a dialog, so they auto-trust. `devEnvFlag` — not a bare
      // `process.env` read — is what keeps that out of a shipped installer: a
      // packaged build must never let an environment variable turn the
      // fingerprint prompt into silent trust-on-first-use.
      if (devEnvFlag('SMOKE') !== undefined) {
        this.persistKnownHost(row.hostname, row.port, keyType, fingerprint)
        verify(true)
        return
      }

      // Batch automation never prompts — fail fast with a clear, actionable reason.
      if (session.nonInteractiveHostKey) {
        session.hostKeyError = `Host key for ${row.hostname}:${row.port} is not yet trusted — open a terminal to this host once to verify it, then retry.`
        verify(false)
        return
      }

      const requestId = randomUUID()
      const timer = setTimeout(() => {
        this.pendingHostKey.delete(requestId)
        verify(false)
      }, HOST_KEY_PROMPT_TIMEOUT_MS)
      this.pendingHostKey.set(requestId, {
        ownerId: session.owner.id,
        resolve: (accept: boolean): void => {
          clearTimeout(timer)
          this.pendingHostKey.delete(requestId)
          if (accept) this.persistKnownHost(row.hostname, row.port, keyType, fingerprint)
          verify(accept)
        },
      })
      const prompt: HostKeyPrompt = hostKeyPromptSchema.parse({
        requestId,
        hostId: session.hostId,
        host: row.hostname,
        port: row.port,
        keyType,
        fingerprint,
        // `changed` = endpoint already trusted for another key/type → warn loudly.
        previouslyKnown: verdict === 'changed',
      })
      session.owner.send(IPC_EVENTS.sshHostKeyPrompt, prompt)
    } catch {
      // Any verification failure is a hard deny — never connect on doubt.
      verify(false)
    }
  }

  private persistKnownHost(host: string, port: number, keyType: string, fingerprint: string): void {
    getDb()
      .insert(knownHosts)
      .values({
        id: randomUUID(),
        host,
        port,
        keyType,
        fingerprintSha256: fingerprint,
        addedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run()
  }

  /** Resolves a pending host-key approval prompt. Owner-checked; unknown ids ignored. */
  respondHostKey(requestId: string, accept: boolean, ownerId: number): void {
    const pending = this.pendingHostKey.get(requestId)
    if (pending && pending.ownerId === ownerId) pending.resolve(accept)
  }

  /** Routes terminal output and lifecycle events for an established session. */
  private wireStream(session: Session, client: Client, stream: ClientChannel): void {
    const dataChannel = sshDataChannel(session.id)
    const forward = (chunk: Buffer): void => {
      if (session.owner.isDestroyed()) {
        this.finish(session, 'disconnected')
        return
      }
      if (!session.attached) {
        // Renderer hasn't subscribed yet — buffer so the MOTD/banner isn't lost.
        session.preAttach.push(Buffer.from(chunk))
        session.preAttachBytes += chunk.length
        while (session.preAttachBytes > PRE_ATTACH_BUFFER_BYTES && session.preAttach.length > 0) {
          const dropped = session.preAttach.shift()
          if (dropped) session.preAttachBytes -= dropped.length
        }
        return
      }
      session.owner.send(dataChannel, new Uint8Array(chunk))
    }
    stream.on('data', forward)
    stream.stderr.on('data', forward)
    stream.on('close', () => this.finish(session, 'disconnected'))
    client.on('error', (err) => this.finish(session, 'error', sanitizeErrorMessage(err)))
    client.on('close', () => this.finish(session, 'disconnected'))
    client.on('end', () => this.finish(session, 'disconnected'))
    // A dying hop tears the whole chain down.
    for (const hop of session.clients) {
      if (hop === client) continue
      hop.on('error', (err) => this.finish(session, 'error', sanitizeErrorMessage(err)))
      hop.on('close', () => this.finish(session, 'disconnected'))
    }
  }

  /** Marks the renderer subscription live and flushes buffered output. Owner-checked. */
  attach(sessionId: string, ownerId: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.owner.id !== ownerId || session.attached) return
    session.attached = true
    const dataChannel = sshDataChannel(session.id)
    for (const chunk of session.preAttach) {
      if (session.owner.isDestroyed()) break
      session.owner.send(dataChannel, new Uint8Array(chunk))
    }
    session.preAttach.length = 0
    session.preAttachBytes = 0
  }

  /** Writes keystrokes to a session's shell. Owner-checked. */
  write(sessionId: string, data: string, ownerId: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.owner.id !== ownerId || !session.stream) return
    session.stream.write(data)
  }

  /** Resizes a session's PTY. Owner-checked. */
  resize(sessionId: string, cols: number, rows: number, ownerId: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.owner.id !== ownerId || !session.stream) return
    session.stream.setWindow(rows, cols, 0, 0)
  }

  /** Closes a session at the renderer's request. Owner-checked. */
  disconnect(sessionId: string, ownerId: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.owner.id !== ownerId) return
    this.finish(session, 'disconnected')
  }

  /** Tears down every session owned by the given WebContents id. */
  destroyForOwner(ownerId: number): void {
    for (const session of [...this.sessions.values()]) {
      if (session.owner.id === ownerId) this.finish(session, 'disconnected')
    }
    // Deny (and thereby clear the timer + map entry of) any host-key prompt
    // still outstanding for this owner, so nothing lingers past teardown.
    for (const pending of [...this.pendingHostKey.values()]) {
      if (pending.ownerId === ownerId) pending.resolve(false)
    }
  }

  /** Tears down all sessions (app quit). */
  destroyAll(): void {
    for (const session of [...this.sessions.values()]) {
      this.finish(session, 'disconnected')
    }
    for (const pending of [...this.pendingHostKey.values()]) pending.resolve(false)
  }

  /** Emits a terminal lifecycle event + tears the session down, exactly once. */
  private finish(session: Session, type: 'disconnected' | 'error', message?: string): void {
    if (session.closed) return
    this.emitEvent(session, type, message)
    // Log the end of an established terminal session (dedicated SFTP/VNC
    // connections set no logKind — their open action is logged instead).
    if (session.logKind === 'ssh' && session.connected) {
      logActivity({ action: 'disconnected', kind: 'ssh', hostId: session.hostId, detail: message })
    }
    this.teardown(session)
  }

  private teardown(session: Session): void {
    if (session.closed) return
    session.closed = true
    this.sessions.delete(session.id)
    try {
      session.stream?.end()
    } catch {
      // best-effort
    }
    // End in reverse order: target first, then the jump chain.
    for (const client of [...session.clients].reverse()) {
      try {
        client.removeAllListeners('error')
        client.on('error', () => {
          // Swallow teardown-time socket errors so they cannot crash the main process.
        })
        client.end()
      } catch {
        // best-effort
      }
    }
    session.clients.length = 0
    session.stream = null
  }

  private emitEvent(session: Session, type: SshSessionEvent['type'], message?: string): void {
    if (session.owner.isDestroyed()) return
    const event: SshSessionEvent = sshSessionEventSchema.parse({
      sessionId: session.id,
      type,
      ...(message !== undefined ? { message } : {}),
    })
    session.owner.send(IPC_EVENTS.sshEvent, event)
  }
}

/** Singleton used by the IPC layer and the smoke harness. */
export const sessionManager = new SessionManager()
