import { composeInteractiveCommand, findHarness } from '@shared/ai-harnesses'
import type { Prompt, Routine } from '@shared/ipc'
import { renderTemplate } from '@shared/template'
import { openLocalTerminalTab } from './local-terminal'

/**
 * Runs a routine interactively: render its prompt with the routine's preset
 * variables, compose the harness command (honouring the routine's autonomy
 * opt-in), open a local terminal in the routine's directory that runs it, and
 * record the launch. Returns the composed command (also useful for tests).
 *
 * "Interactive" means the agent runs in a visible terminal the user can watch
 * and stop — the M3 default. Headless capture is M5.
 */
export function runRoutineInteractive(routine: Routine, prompt: Prompt): string {
  // No fallback harness on purpose. `harnessId` is persisted as a free string
  // and the registry is expected to change as CLIs evolve, so a stale id must
  // fail loudly: substituting Claude Code would swap a sandboxed agent
  // (`codex exec --sandbox workspace-write`) for one whose autonomy flag is
  // `--dangerously-skip-permissions`, silently escalating what the user
  // consented to.
  const harness = findHarness(routine.harnessId)
  if (!harness) {
    throw new Error(
      `Routine "${routine.name}" refers to an AI agent that no longer exists (${routine.harnessId}). Edit the routine and pick an agent.`,
    )
  }

  const rendered = renderTemplate(prompt.body, routine.variables)
  const command = composeInteractiveCommand(harness, rendered, { autonomy: routine.autonomy })

  openLocalTerminalTab({ cwd: routine.cwd, title: routine.name, runOnOpen: command })
  void window.api.routines.recordRun({ routineId: routine.id, status: 'launched', command })
  return command
}
