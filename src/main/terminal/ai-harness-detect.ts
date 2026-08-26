import { AI_HARNESSES, type AiHarness } from '@shared/ai-harnesses'
import type { DetectedHarness } from '@shared/ipc'
import { probeProgram } from './terminal-programs'

/**
 * Probes each built-in harness's binary on PATH (concurrently; results cached
 * by `probeProgram`). Detection never runs the tool with a real prompt — only
 * `--version` — so probing can't trigger an agent action.
 */
export async function detectAiHarnesses(): Promise<DetectedHarness[]> {
  return Promise.all(
    AI_HARNESSES.map(async (h: AiHarness) => ({
      id: h.id,
      label: h.label,
      available: await probeProgram(h.bin),
    })),
  )
}
