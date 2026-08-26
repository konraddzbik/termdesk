/**
 * Lightweight diagnostic logging for the RDP path (manager + RDCleanPath proxy).
 * Low volume: lifecycle events + byte totals, never per-chunk and never secrets.
 */
export function rdpLog(message: string, detail?: Record<string, unknown>): void {
  if (detail && Object.keys(detail).length > 0) console.log(`[rdp] ${message}`, detail)
  else console.log(`[rdp] ${message}`)
}
