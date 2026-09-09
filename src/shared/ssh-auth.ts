/**
 * Modern SSH authentication & post-quantum transport core (Milestone M10:
 * issues #86 FIDO2 hardware keys, #87 passkeys/resident keys, #88 OpenSSH
 * certificates, #89 post-quantum KEX, #90 agent hygiene).
 *
 * Modern auth is the widest-open lane in the SSH-client market: only Termius
 * ships FIDO2/passkeys (cloud-gated), and post-quantum key exchange became the
 * OpenSSH 10.0 default. This module is the pure, dependency-free heart the rest
 * of the milestone wires to:
 *
 *  - {@link orderKexAlgorithms} / {@link isPostQuantumKex} — offer a PQ-hybrid
 *    key exchange ahead of classical ones (#89), so a session negotiates
 *    "harvest-now-decrypt-later" protection when the server supports it.
 *  - {@link certValidityState} / {@link describeCertValidity} — evaluate an
 *    OpenSSH user certificate's validity window and surface an expiry state (#88).
 *  - {@link agentForwardingAdvice} — turn the well-known agent-hijacking footgun
 *    into a visible recommendation to prefer ProxyJump (#90).
 *  - {@link authMethodInfo} — describe an auth method's security properties
 *    (hardware-backed, phishing-resistant) for the #86/#87 UI.
 *
 * Everything here is pure and deterministic (no `ssh2`, no network, no clock of
 * its own — callers pass `now`) so the precedence and negotiation rules are
 * unit-tested in isolation. The main process supplies the real transport.
 */

// ---------------------------------------------------------------------------
// #89 — Post-quantum key exchange preference
// ---------------------------------------------------------------------------

/**
 * Post-quantum *hybrid* key-exchange algorithms, best-first. Hybrids pair a
 * classical curve with a PQ KEM so security holds if either primitive survives.
 * `mlkem768x25519-sha256` is the OpenSSH 10.0 default; `sntrup761x25519-sha512`
 * is the older OpenSSH hybrid kept as a widely-deployed secondary.
 */
export const PQ_HYBRID_KEX = [
  'mlkem768x25519-sha256',
  'sntrup761x25519-sha512@openssh.com',
] as const

/**
 * Classical fallbacks, best-first — offered *after* the PQ hybrids so a session
 * still connects to servers without PQ support.
 */
export const CLASSICAL_KEX = [
  'curve25519-sha256',
  'curve25519-sha256@libssh.org',
  'ecdh-sha2-nistp256',
  'diffie-hellman-group-exchange-sha256',
] as const

/** True when `name` is a post-quantum hybrid key exchange. */
export function isPostQuantumKex(name: string): boolean {
  return (PQ_HYBRID_KEX as readonly string[]).includes(name.trim())
}

export interface KexOrderOptions {
  /**
   * If provided, restrict the offer to algorithms the peer is known to support,
   * preserving our preference order. An empty result means no overlap.
   */
  serverSupported?: readonly string[]
  /** Drop the classical fallbacks — PQ-only, for a hardened/known-PQ fleet. */
  postQuantumOnly?: boolean
}

/**
 * Build the client's key-exchange offer, PQ hybrids first then classical
 * fallbacks, de-duplicated in preference order. When `serverSupported` is given,
 * only algorithms in that set are offered (still in our preferred order).
 */
export function orderKexAlgorithms(opts: KexOrderOptions = {}): string[] {
  const preferred = opts.postQuantumOnly ? [...PQ_HYBRID_KEX] : [...PQ_HYBRID_KEX, ...CLASSICAL_KEX]
  const allowed = opts.serverSupported ? new Set(opts.serverSupported) : null
  const seen = new Set<string>()
  const out: string[] = []
  for (const alg of preferred) {
    if (seen.has(alg)) continue
    if (allowed && !allowed.has(alg)) continue
    seen.add(alg)
    out.push(alg)
  }
  return out
}

/**
 * Given the KEX the transport actually negotiated, classify the protection:
 * `post-quantum` when a PQ hybrid was used, `classical` for a recognized
 * classical KEX, `unknown` otherwise (surfaced as a neutral state, not a claim).
 */
export function kexProtection(
  negotiated: string | null | undefined,
): 'post-quantum' | 'classical' | 'unknown' {
  if (!negotiated) return 'unknown'
  const name = negotiated.trim()
  if (isPostQuantumKex(name)) return 'post-quantum'
  if ((CLASSICAL_KEX as readonly string[]).includes(name)) return 'classical'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// #88 — OpenSSH certificate validity
// ---------------------------------------------------------------------------

export interface CertValidity {
  /** Unix seconds; certs valid from this time. `0`/undefined = always (from epoch). */
  validAfter?: number
  /** Unix seconds; certs valid until this time. Omit/`Infinity` = forever. */
  validBefore?: number
}

export type CertValidityState = 'not-yet-valid' | 'valid' | 'expiring-soon' | 'expired'

export interface CertValidityOptions {
  /** Current time in Unix seconds (caller-supplied — this module has no clock). */
  now: number
  /** Window (seconds) before `validBefore` at which to warn. Default 24h. */
  expiringWindowSec?: number
}

const DAY_SEC = 24 * 60 * 60

/**
 * Classify an OpenSSH certificate's validity relative to `now`. Short-lived,
 * CA-signed certs are the enterprise direction (Teleport/Vault); TermDesk is a
 * cert *consumer* and must show the user when one is not-yet / soon / already
 * expired rather than failing opaquely at connect time.
 */
export function certValidityState(
  cert: CertValidity,
  opts: CertValidityOptions,
): CertValidityState {
  const { now } = opts
  const window = opts.expiringWindowSec ?? DAY_SEC
  const after = cert.validAfter ?? 0
  const before = cert.validBefore ?? Number.POSITIVE_INFINITY
  if (now < after) return 'not-yet-valid'
  if (now >= before) return 'expired'
  if (Number.isFinite(before) && before - now <= window) return 'expiring-soon'
  return 'valid'
}

/** Seconds until the cert expires (0 if already expired, `Infinity` if no bound). */
export function certSecondsRemaining(cert: CertValidity, now: number): number {
  const before = cert.validBefore ?? Number.POSITIVE_INFINITY
  if (!Number.isFinite(before)) return Number.POSITIVE_INFINITY
  return Math.max(0, before - now)
}

/** A short human label for the validity state (for a badge / tooltip). */
export function describeCertValidity(cert: CertValidity, opts: CertValidityOptions): string {
  const state = certValidityState(cert, opts)
  switch (state) {
    case 'not-yet-valid':
      return 'Not yet valid'
    case 'expired':
      return 'Expired'
    case 'expiring-soon': {
      const secs = certSecondsRemaining(cert, opts.now)
      const mins = Math.round(secs / 60)
      return mins >= 120 ? `Expires in ${Math.round(mins / 60)}h` : `Expires in ${mins}m`
    }
    default:
      return 'Valid'
  }
}

// ---------------------------------------------------------------------------
// #90 — SSH agent hygiene
// ---------------------------------------------------------------------------

export interface AgentForwardingContext {
  /** Whether the user has enabled `ForwardAgent` for this host. */
  agentForwarding: boolean
  /** Whether the host already reaches its target via a ProxyJump chain. */
  hasProxyJump: boolean
}

export interface AgentAdvice {
  level: 'ok' | 'warn'
  /** Stable machine code for the UI to key off / suppress-once. */
  code: 'ok' | 'forwarding-without-proxyjump' | 'forwarding-enabled'
  message: string
}

/**
 * Advise on SSH agent forwarding. Agent forwarding lets root on an intermediate
 * host impersonate you to every downstream host for the life of the session
 * ("agent hijacking"); ProxyJump avoids exposing the agent socket at all. We
 * never block, but we warn — loudest when forwarding is on with no ProxyJump.
 */
export function agentForwardingAdvice(ctx: AgentForwardingContext): AgentAdvice {
  if (!ctx.agentForwarding) {
    return { level: 'ok', code: 'ok', message: 'Agent forwarding is off (recommended).' }
  }
  if (!ctx.hasProxyJump) {
    return {
      level: 'warn',
      code: 'forwarding-without-proxyjump',
      message:
        'Agent forwarding is enabled without a ProxyJump. A compromised intermediate host could use your agent to reach other hosts. Prefer ProxyJump, which never exposes the agent socket.',
    }
  }
  return {
    level: 'warn',
    code: 'forwarding-enabled',
    message:
      'Agent forwarding is enabled. Consider ProxyJump instead, and set a key timeout / lock the agent when idle.',
  }
}

// ---------------------------------------------------------------------------
// #86 / #87 — Auth method model
// ---------------------------------------------------------------------------

export type AuthMethodKind =
  | 'password'
  | 'key' // classic private key file
  | 'agent' // key held by an ssh-agent
  | 'certificate' // OpenSSH user certificate (#88)
  | 'security-key' // FIDO2 hardware key: sk-ed25519 / sk-ecdsa (#86)
  | 'passkey' // resident/platform-authenticator credential (#87)

export interface AuthMethodInfo {
  kind: AuthMethodKind
  label: string
  /** Private key material is held in dedicated hardware / secure enclave. */
  hardwareBacked: boolean
  /** Resistant to credential phishing/replay (bound to origin + user presence). */
  phishingResistant: boolean
  /** Higher = stronger; used only to sort/hint in the UI, never to gate. */
  strength: number
}

/**
 * Describe an auth method's security properties for the connection UI (#86/#87).
 * Hardware-backed FIDO2 and platform passkeys rank highest (private key never
 * leaves the token/enclave and requires user presence); passwords lowest.
 */
export function authMethodInfo(kind: AuthMethodKind): AuthMethodInfo {
  switch (kind) {
    case 'security-key':
      return {
        kind,
        label: 'Hardware security key (FIDO2)',
        hardwareBacked: true,
        phishingResistant: true,
        strength: 5,
      }
    case 'passkey':
      return {
        kind,
        label: 'Passkey (platform authenticator)',
        hardwareBacked: true,
        phishingResistant: true,
        strength: 5,
      }
    case 'certificate':
      return {
        kind,
        label: 'OpenSSH certificate',
        hardwareBacked: false,
        phishingResistant: false,
        strength: 4,
      }
    case 'agent':
      return {
        kind,
        label: 'SSH agent key',
        hardwareBacked: false,
        phishingResistant: false,
        strength: 3,
      }
    case 'key':
      return {
        kind,
        label: 'Private key',
        hardwareBacked: false,
        phishingResistant: false,
        strength: 3,
      }
    default:
      return {
        kind: 'password',
        label: 'Password',
        hardwareBacked: false,
        phishingResistant: false,
        strength: 1,
      }
  }
}

/** `sk-*` OpenSSH key types are hardware-backed FIDO2 credentials (#86/#87). */
export function isSecurityKeyType(keyType: string): boolean {
  const t = keyType.trim().toLowerCase()
  return t.startsWith('sk-') || t.endsWith('-sk') || t.endsWith('-sk@openssh.com')
}
