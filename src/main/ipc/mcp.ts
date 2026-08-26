import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { resolveApproval } from '../mcp/approvals'
import { mcpStatus, syncMcpFromSettings } from '../mcp/server'
import { clearAiAudit, listAiAudit } from '../store/ai-audit-repo'
import { updateSettings } from '../store/settings'

export function registerMcpIpc(): void {
  ipcMain.handle(IPC.mcpStatus, () => mcpStatus())

  ipcMain.handle(IPC.mcpSetEnabled, async (_event, rawEnabled: unknown) => {
    const enabled = z.boolean().parse(rawEnabled)
    updateSettings({ mcpEnabled: enabled })
    await syncMcpFromSettings()
    return mcpStatus()
  })

  ipcMain.handle(IPC.mcpAuditList, () => listAiAudit())

  ipcMain.handle(IPC.mcpAuditClear, () => {
    clearAiAudit()
  })

  ipcMain.handle(IPC.mcpApprove, (_event, rawId: unknown, rawApprove: unknown) => {
    resolveApproval(z.string().parse(rawId), z.boolean().parse(rawApprove))
  })
}
