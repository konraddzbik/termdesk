import { runRoutineInteractive } from '@renderer/lib/run-routine'
import { useRoutinesStore } from '@renderer/stores/routines'
import { useEffect } from 'react'

/**
 * Bridges the main-process scheduler to the renderer: when a scheduled routine
 * is due, main sends it here and we run it (interactive runs need a renderer
 * terminal). Renders nothing. The freshest prompt is fetched at fire time so an
 * edited prompt body is honoured.
 */
export function RoutineTriggerListener(): null {
  const markRan = useRoutinesStore((s) => s.markRan)

  useEffect(() => {
    return window.api.routines.onTrigger((routine) => {
      void window.api.prompts.list().then((prompts) => {
        const prompt = prompts.find((p) => p.id === routine.promptId)
        if (!prompt) return
        runRoutineInteractive(routine, prompt)
        markRan(routine.id, Date.now())
      })
    })
  }, [markRan])

  return null
}
