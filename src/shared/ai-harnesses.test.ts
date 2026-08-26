import { describe, expect, it } from 'vitest'
import {
  AI_HARNESSES,
  composeHeadlessArgv,
  composeInteractiveCommand,
  findHarness,
  shellSingleQuote,
} from './ai-harnesses'

function harness(id: string) {
  const h = findHarness(id)
  if (!h) throw new Error(`no built-in harness ${id}`)
  return h
}
const claude = harness('claude')
const opencode = harness('opencode')
const codex = harness('codex')

describe('shellSingleQuote', () => {
  it('wraps plain text', () => {
    expect(shellSingleQuote('hello world')).toBe("'hello world'")
  })
  it('escapes embedded single quotes', () => {
    expect(shellSingleQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('composeInteractiveCommand', () => {
  it('uses the prompt flag for flag-delivery harnesses', () => {
    expect(composeInteractiveCommand(claude, 'do it')).toBe("claude -p 'do it'")
  })

  it('uses the run subcommand and positional prompt for opencode', () => {
    expect(composeInteractiveCommand(opencode, 'do it')).toBe("opencode run 'do it'")
  })

  it('quotes shell metacharacters so they cannot break out', () => {
    const cmd = composeInteractiveCommand(claude, '; rm -rf / $(whoami) `id`')
    expect(cmd).toBe("claude -p '; rm -rf / $(whoami) `id`'")
    // The whole prompt sits inside one single-quoted argument.
    expect(cmd.startsWith("claude -p '")).toBe(true)
    expect(cmd.endsWith("'")).toBe(true)
  })

  it('omits auto-approve args unless autonomy is opted in', () => {
    expect(composeInteractiveCommand(claude, 'x')).not.toContain('--dangerously-skip-permissions')
    expect(composeInteractiveCommand(claude, 'x', { autonomy: true })).toContain(
      '--dangerously-skip-permissions',
    )
  })

  it('includes codex sandbox policy only under autonomy', () => {
    expect(composeInteractiveCommand(codex, 'x')).toBe("codex exec 'x'")
    expect(composeInteractiveCommand(codex, 'x', { autonomy: true })).toBe(
      "codex exec --sandbox workspace-write 'x'",
    )
  })

  it('uses a safe heredoc for stdin-delivery harnesses', () => {
    const stdinHarness = { id: 's', label: 'S', bin: 'agent', promptDelivery: 'stdin' } as const
    const cmd = composeInteractiveCommand(stdinHarness, 'line1\nline2')
    expect(cmd).toBe("agent <<'TERMDESK_PROMPT'\nline1\nline2\nTERMDESK_PROMPT")
  })

  it('picks a non-colliding heredoc delimiter when the prompt contains the default', () => {
    const stdinHarness = { id: 's', label: 'S', bin: 'agent', promptDelivery: 'stdin' } as const
    const cmd = composeInteractiveCommand(stdinHarness, 'has TERMDESK_PROMPT inside')
    expect(cmd).toContain("<<'TERMDESK_PROMPT_0'")
  })
})

describe('composeHeadlessArgv', () => {
  it('builds an argv with the prompt as a discrete element (no shell)', () => {
    expect(composeHeadlessArgv(claude, '; rm -rf /')).toEqual({
      argv: ['claude', '--output-format', 'text', '-p', '; rm -rf /'],
    })
  })

  it('puts the prompt on stdin for stdin-delivery harnesses', () => {
    const stdinHarness = { id: 's', label: 'S', bin: 'agent', promptDelivery: 'stdin' } as const
    expect(composeHeadlessArgv(stdinHarness, 'the prompt')).toEqual({
      argv: ['agent'],
      stdin: 'the prompt',
    })
  })

  it('adds autonomy args only when opted in', () => {
    expect(composeHeadlessArgv(claude, 'x', { autonomy: true }).argv).toContain(
      '--dangerously-skip-permissions',
    )
  })
})

describe('AI_HARNESSES registry', () => {
  it('has unique ids and a bin for each', () => {
    const ids = AI_HARNESSES.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const h of AI_HARNESSES) expect(h.bin).toBeTruthy()
  })
})
