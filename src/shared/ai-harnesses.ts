/**
 * Data-described registry of AI-agent CLIs ("harnesses") plus the pure logic
 * that turns a prompt into a runnable invocation. Kept in `shared/` (no I/O) so
 * both the renderer (composing a `runOnOpen` string for a visible terminal) and
 * the main process (building a `child_process` argv for a headless run) use one
 * source of truth. Availability probing (which/where on PATH) lives in main.
 *
 * Security: prompt text is **never** concatenated into a shell string. For the
 * interactive path it is passed as a single POSIX-quoted argument (or a quoted
 * heredoc for stdin harnesses); for the headless path it is an argv element or
 * piped on stdin. A prompt full of `;`, backticks or `$( )` is therefore inert.
 */

/** How a harness receives the prompt on its command line. */
export type PromptDelivery = 'flag' | 'positional' | 'stdin'

export interface AiHarness {
  id: string
  label: string
  /** Executable name looked up on PATH. */
  bin: string
  promptDelivery: PromptDelivery
  /** Flag that precedes the prompt when `promptDelivery === 'flag'`. */
  promptFlag?: string
  /** Sub-command inserted before the prompt (e.g. `run`, `exec`). */
  runSubcommand?: string
  /** Extra args always appended (e.g. a sandbox policy). */
  extraArgs?: string[]
  /**
   * Args that make the harness run WITHOUT approval prompts. Included only when
   * a caller explicitly opts into autonomy — never by default.
   */
  autoApproveArgs?: string[]
  /** Args selecting a non-interactive/print output mode (headless capture). */
  outputArgs?: string[]
}

/**
 * Built-in harness profiles. Flags reflect each tool's documented headless
 * entry point as of 2026. Users can add
 * a `custom` profile; keep this list easy to update as CLIs evolve.
 */
export const AI_HARNESSES: readonly AiHarness[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    promptDelivery: 'flag',
    promptFlag: '-p',
    autoApproveArgs: ['--dangerously-skip-permissions'],
    outputArgs: ['--output-format', 'text'],
  },
  {
    id: 'aider',
    label: 'Aider',
    bin: 'aider',
    promptDelivery: 'flag',
    promptFlag: '--message',
    autoApproveArgs: ['--yes'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    promptDelivery: 'positional',
    runSubcommand: 'run',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    bin: 'codex',
    promptDelivery: 'positional',
    runSubcommand: 'exec',
    autoApproveArgs: ['--sandbox', 'workspace-write'],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    promptDelivery: 'flag',
    promptFlag: '-p',
  },
]

export function findHarness(id: string): AiHarness | undefined {
  return AI_HARNESSES.find((h) => h.id === id)
}

/** POSIX single-quote: wrap in quotes, escaping embedded quotes via `'\''`. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** A delimiter guaranteed absent from the prompt, for a safe heredoc. */
function heredocDelimiter(prompt: string): string {
  let tag = 'TERMDESK_PROMPT'
  let n = 0
  while (prompt.includes(tag)) tag = `TERMDESK_PROMPT_${n++}`
  return tag
}

export interface ComposeOptions {
  /** Opt-in: include the harness's auto-approve args (autonomy). Off by default. */
  autonomy?: boolean
}

/**
 * Builds the shell command string to type into a PTY (used as a terminal's
 * `runOnOpen`) to run `prompt` through `harness`. The prompt is always quoted
 * or heredoc'd — never interpolated raw — so shell metacharacters in it are
 * inert.
 */
export function composeInteractiveCommand(
  harness: AiHarness,
  prompt: string,
  options: ComposeOptions = {},
): string {
  const parts: string[] = [harness.bin]
  if (harness.runSubcommand) parts.push(harness.runSubcommand)
  if (harness.extraArgs) parts.push(...harness.extraArgs)
  if (options.autonomy && harness.autoApproveArgs) parts.push(...harness.autoApproveArgs)

  if (harness.promptDelivery === 'stdin') {
    const tag = heredocDelimiter(prompt)
    // Quote the tag so the shell does not expand `$…` inside the prompt body.
    return `${parts.join(' ')} <<'${tag}'\n${prompt}\n${tag}`
  }
  if (harness.promptDelivery === 'flag' && harness.promptFlag) parts.push(harness.promptFlag)
  parts.push(shellSingleQuote(prompt))
  return parts.join(' ')
}

export interface HeadlessInvocation {
  argv: string[]
  /** When set, write this to the child's stdin instead of passing it as an arg. */
  stdin?: string
}

/**
 * Builds an argv (+ optional stdin) for spawning `harness` headlessly via
 * `child_process` WITHOUT a shell. The prompt is an argv element or stdin, so
 * there is no shell to inject into. `outputArgs` are included to capture output.
 */
export function composeHeadlessArgv(
  harness: AiHarness,
  prompt: string,
  options: ComposeOptions = {},
): HeadlessInvocation {
  const argv: string[] = []
  if (harness.runSubcommand) argv.push(harness.runSubcommand)
  if (harness.extraArgs) argv.push(...harness.extraArgs)
  if (harness.outputArgs) argv.push(...harness.outputArgs)
  if (options.autonomy && harness.autoApproveArgs) argv.push(...harness.autoApproveArgs)

  if (harness.promptDelivery === 'stdin') {
    return { argv: [harness.bin, ...argv], stdin: prompt }
  }
  if (harness.promptDelivery === 'flag' && harness.promptFlag) argv.push(harness.promptFlag)
  argv.push(prompt)
  return { argv: [harness.bin, ...argv] }
}
