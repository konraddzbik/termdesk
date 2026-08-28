/**
 * Local-first AI backend abstraction (issue #46).
 *
 * The whole "Local-first AI" milestone hinges on one contract: AI features
 * (NL→command, explain-failed-command, completion ranking) must run against a
 * backend the *user* chooses — a local Ollama, any OpenAI-compatible endpoint,
 * or nothing — with **no TermDesk cloud, no account, and AI off by default**.
 * That is exactly the position Warp (mandatory login, telemetry) and iTerm2
 * (post-backlash: users demanded Ollama / OpenAI-compatible / self-hosted) map
 * out for us.
 *
 * This is the pure config core: the renderer-facing shape (which deliberately
 * carries `hasApiKey`, never the key — the key lives in the main-process vault,
 * mirroring how hosts expose `hasPassword`), validation, endpoint resolution,
 * and a "is this local?" predicate for the privacy indicator. No network here.
 */

export type AiBackendKind = 'none' | 'ollama' | 'openai-compatible'

/**
 * Renderer-safe AI backend config. Contains NO secret: the API key is stored in
 * the vault (safeStorage) and only `hasApiKey` crosses to the renderer, exactly
 * like `Host.hasPassword`. `kind: 'none'` = AI disabled (the default).
 */
export interface AiBackendConfig {
  kind: AiBackendKind
  /** Base URL for 'ollama' / 'openai-compatible'. Ignored for 'none'. */
  baseUrl?: string
  /** Model id, e.g. 'llama3.1' or 'gpt-4o-mini'. */
  model?: string
  /** Whether an API key is stored in the vault. NEVER the key itself. */
  hasApiKey?: boolean
}

export const AI_DISABLED: AiBackendConfig = { kind: 'none' }

/** True when AI features should be active at all. `none` (the default) → false. */
export function isAiEnabled(config: AiBackendConfig): boolean {
  return config.kind !== 'none'
}

/** Sensible default base URL for a kind (Ollama's local daemon). */
export function defaultBaseUrl(kind: AiBackendKind): string | undefined {
  return kind === 'ollama' ? 'http://localhost:11434' : undefined
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validate a config. `none` always passes; the others require a valid base URL
 * (the kind's default is applied first, so Ollama needs no explicit URL) and a model.
 */
export function validateAiBackend(config: AiBackendConfig): ValidationResult {
  if (config.kind === 'none') return { ok: true }
  const effectiveBaseUrl = config.baseUrl ?? defaultBaseUrl(config.kind)
  if (!isHttpUrl(effectiveBaseUrl)) {
    return { ok: false, error: 'baseUrl must be an http(s) URL' }
  }
  if (!config.model || config.model.trim() === '') {
    return { ok: false, error: 'model is required' }
  }
  return { ok: true }
}

/**
 * True when the backend runs on the user's own machine (Ollama, or any endpoint
 * on loopback). Drives the "local only — nothing leaves your machine" indicator.
 */
export function isLocalBackend(config: AiBackendConfig): boolean {
  if (config.kind === 'none') return false
  if (config.kind === 'ollama' && !config.baseUrl) return true
  const host = safeHostname(config.baseUrl)
  if (host === null) return false
  // Whole 127.0.0.0/8 loopback range, not just 127.0.0.1, plus IPv6 loopback.
  return host === 'localhost' || /^127\./.test(host) || host === '::1' || host === '[::1]'
}

function safeHostname(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Resolve the chat-completions endpoint URL for the backend, or null when
 * disabled/invalid. Ollama → `/api/chat`; OpenAI-compatible → `/v1/chat/completions`.
 */
export function resolveChatEndpoint(config: AiBackendConfig): string | null {
  if (validateAiBackend(config).ok === false) return null
  const base = (config.baseUrl ?? defaultBaseUrl(config.kind))?.replace(/\/+$/, '')
  if (!base) return null
  if (config.kind === 'ollama') return `${base}/api/chat`
  if (config.kind === 'openai-compatible') return `${base}/v1/chat/completions`
  return null
}

export interface BackendDescription {
  label: string
  local: boolean
  enabled: boolean
}

/** Human-facing description for settings UI. */
export function describeBackend(config: AiBackendConfig): BackendDescription {
  const enabled = isAiEnabled(config)
  const local = isLocalBackend(config)
  const label =
    config.kind === 'none'
      ? 'Disabled'
      : config.kind === 'ollama'
        ? `Ollama${config.model ? ` · ${config.model}` : ''}${local ? ' (local)' : ''}`
        : `OpenAI-compatible${config.model ? ` · ${config.model}` : ''}${local ? ' (local)' : ''}`
  return { label, local, enabled }
}
