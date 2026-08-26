import { initAiAuditSubscription } from '@renderer/stores/aiAudit'
import { initAutomationSubscription } from '@renderer/stores/automation'
import { initLogsSubscription } from '@renderer/stores/logs'
import { initTunnelsSubscription } from '@renderer/stores/tunnels'
import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'

export function App(): React.JSX.Element {
  // Stream automation run progress into the store for the whole app session,
  // so results keep updating even when the Automation tab isn't focused.
  useEffect(() => initAutomationSubscription(), [])

  // Stream activity-log entries so the Logs view stays live.
  useEffect(() => initLogsSubscription(), [])

  // Stream live tunnel status (running/error/throughput) into the store.
  useEffect(() => initTunnelsSubscription(), [])

  // Stream AI agent (MCP) decisions/actions so the AI Activity view stays live.
  useEffect(() => initAiAuditSubscription(), [])

  return <AppLayout />
}
