/**
 * Renders an agent-supplied command for the approval dialog.
 *
 * The dialog is the only thing standing between an MCP client and a remote
 * shell, so the preview has to be *hard to hide things in*. Two padding tricks
 * matter: a long run of spaces pushes the payload off the right edge, and a run
 * of newlines pushes it below the fold. Both are collapsed into a visible
 * marker, and the caller is given the true size so it can be stated outright.
 *
 * Pure and unit-tested — no truncation happens here, and none should happen
 * downstream either.
 */

/** Runs of this many blanks or newlines are replaced by a visible marker. */
const BLANK_RUN = 8
const NEWLINE_RUN = 3

export interface CommandPreview {
  /** The full command, with padding runs made visible. Never truncated. */
  text: string
  chars: number
  lines: number
  /** True when padding was collapsed — worth saying so in the UI. */
  collapsed: boolean
}

export function previewCommand(command: string): CommandPreview {
  const chars = command.length
  const lines = command === '' ? 0 : command.split('\n').length
  let collapsed = false

  const text = command
    .replace(new RegExp(`\\n{${NEWLINE_RUN},}`, 'g'), (run) => {
      collapsed = true
      return `\n⏎×${run.length}\n`
    })
    .replace(new RegExp(`[ \\t]{${BLANK_RUN},}`, 'g'), (run) => {
      collapsed = true
      return ` ␣×${run.length} `
    })

  return { text, chars, lines, collapsed }
}
