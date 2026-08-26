import type { Versions } from '@shared/ipc'
import { useEffect, useState } from 'react'

export function useVersions(): Versions | null {
  const [versions, setVersions] = useState<Versions | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .getVersions()
      .then((v) => {
        if (!cancelled) setVersions(v)
      })
      .catch((err) => {
        // The welcome view renders fine without versions — just log it.
        console.error('getVersions failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return versions
}
