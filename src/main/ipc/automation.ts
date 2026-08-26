import { IPC, IPC_EVENTS } from '@shared/channels'
import { automationJobInputSchema, automationRunInputSchema } from '@shared/ipc'
import { redactSecrets } from '@shared/redact'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { automationRunner } from '../automation/automation-runner'
import type { DataSink } from '../ssh/session-manager'
import { logActivity } from '../store/activity-logger'
import {
  createAutomationJob,
  deleteAutomationJob,
  listAutomationJobs,
  updateAutomationJob,
} from '../store/automation-repo'

export function registerAutomationIpc(): void {
  ipcMain.handle(IPC.automationJobsList, () => listAutomationJobs())

  ipcMain.handle(IPC.automationJobCreate, (_event, rawInput: unknown) =>
    createAutomationJob(automationJobInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.automationJobUpdate, (_event, rawId: unknown, rawInput: unknown) =>
    updateAutomationJob(z.string().parse(rawId), automationJobInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.automationJobDelete, (_event, rawId: unknown) => {
    deleteAutomationJob(z.string().parse(rawId))
  })

  ipcMain.handle(IPC.automationRun, (event, rawInput: unknown) => {
    const { command, hostIds } = automationRunInputSchema.parse(rawInput)
    // Redact secret-bearing tokens before the command first-line touches the
    // (local, unencrypted) activity log, so passwords/tokens aren't persisted.
    const firstLine = redactSecrets(command.split('\n')[0]?.slice(0, 80) ?? '')
    logActivity({
      action: 'automation',
      kind: 'automation',
      hostLabel: `${hostIds.length} host${hostIds.length === 1 ? '' : 's'}`,
      detail: firstLine,
    })
    // WebContents structurally satisfies DataSink (id, send, isDestroyed).
    const owner = event.sender as unknown as DataSink
    return automationRunner.start(owner, hostIds, command, (automationEvent) => {
      if (!owner.isDestroyed()) owner.send(IPC_EVENTS.automationEvent, automationEvent)
    })
  })

  ipcMain.handle(IPC.automationCancel, (event, rawRunId: unknown) => {
    automationRunner.cancel(z.string().parse(rawRunId), event.sender.id)
  })
}
