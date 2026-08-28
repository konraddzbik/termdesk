import { describe, expect, it } from 'vitest'
import {
  AI_DISABLED,
  type AiBackendConfig,
  defaultBaseUrl,
  describeBackend,
  isAiEnabled,
  isLocalBackend,
  resolveChatEndpoint,
  validateAiBackend,
} from './ai-backend'

describe('isAiEnabled', () => {
  it('is off by default (kind none)', () => {
    expect(isAiEnabled(AI_DISABLED)).toBe(false)
    expect(
      isAiEnabled({ kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3' }),
    ).toBe(true)
  })
})

describe('validateAiBackend', () => {
  it('accepts none unconditionally', () => {
    expect(validateAiBackend({ kind: 'none' })).toEqual({ ok: true })
  })

  it('applies the kind default so Ollama needs no explicit baseUrl', () => {
    expect(validateAiBackend({ kind: 'ollama', model: 'x' })).toEqual({ ok: true })
  })

  it('requires a valid http(s) baseUrl when there is no default (openai-compatible)', () => {
    expect(validateAiBackend({ kind: 'openai-compatible', model: 'x' })).toEqual({
      ok: false,
      error: 'baseUrl must be an http(s) URL',
    })
    expect(validateAiBackend({ kind: 'ollama', baseUrl: 'ftp://x', model: 'x' }).ok).toBe(false)
  })

  it('requires a model', () => {
    expect(validateAiBackend({ kind: 'openai-compatible', baseUrl: 'https://api.x.com' })).toEqual({
      ok: false,
      error: 'model is required',
    })
  })

  it('accepts a complete config', () => {
    expect(
      validateAiBackend({ kind: 'openai-compatible', baseUrl: 'https://api.x.com', model: 'm' }),
    ).toEqual({ ok: true })
  })
})

describe('resolveChatEndpoint', () => {
  it('builds the Ollama endpoint (defaulting the base URL)', () => {
    expect(resolveChatEndpoint({ kind: 'ollama', model: 'llama3' })).toBe(
      'http://localhost:11434/api/chat',
    )
  })

  it('builds the OpenAI-compatible endpoint and trims trailing slashes', () => {
    expect(
      resolveChatEndpoint({ kind: 'openai-compatible', baseUrl: 'https://api.x.com/', model: 'm' }),
    ).toBe('https://api.x.com/v1/chat/completions')
  })

  it('returns null when disabled or invalid', () => {
    expect(resolveChatEndpoint({ kind: 'none' })).toBeNull()
    expect(resolveChatEndpoint({ kind: 'ollama', baseUrl: 'nope', model: 'm' })).toBeNull()
  })
})

describe('isLocalBackend', () => {
  it('treats Ollama and loopback endpoints as local', () => {
    expect(isLocalBackend({ kind: 'ollama', model: 'x' })).toBe(true) // default localhost
    expect(
      isLocalBackend({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', model: 'x' }),
    ).toBe(true)
    // Whole 127.0.0.0/8 range, not just .1.
    expect(
      isLocalBackend({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.2:8080', model: 'x' }),
    ).toBe(true)
  })

  it('treats remote endpoints as non-local', () => {
    expect(
      isLocalBackend({ kind: 'openai-compatible', baseUrl: 'https://api.openai.com', model: 'x' }),
    ).toBe(false)
    expect(isLocalBackend({ kind: 'none' })).toBe(false)
  })
})

describe('config carries no secret', () => {
  it('has no apiKey field — only hasApiKey (secret stays in the vault)', () => {
    const cfg: AiBackendConfig = {
      kind: 'openai-compatible',
      baseUrl: 'https://api.x.com',
      model: 'm',
      hasApiKey: true,
    }
    // The renderer-facing shape must never carry the key itself.
    expect(Object.keys(cfg)).not.toContain('apiKey')
    expect('apiKey' in cfg).toBe(false)
  })
})

describe('describeBackend / defaultBaseUrl', () => {
  it('describes disabled and local backends', () => {
    expect(describeBackend({ kind: 'none' })).toMatchObject({ enabled: false, label: 'Disabled' })
    const d = describeBackend({ kind: 'ollama', model: 'llama3' })
    expect(d.enabled).toBe(true)
    expect(d.local).toBe(true)
    expect(d.label).toContain('llama3')
  })

  it('defaults the Ollama base URL only', () => {
    expect(defaultBaseUrl('ollama')).toBe('http://localhost:11434')
    expect(defaultBaseUrl('openai-compatible')).toBeUndefined()
  })
})
