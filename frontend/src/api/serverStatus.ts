import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

/**
 * Live link to the central hospital server, checked against GET /api/health.
 * That endpoint runs `SELECT 1` on the central database, so a 200 with db "ok"
 * means this workstation can reach both the server and its database.
 */
export type ServerLink = 'checking' | 'connected' | 'database-down' | 'server-unreachable' | 'offline'

const POLL_MS = 15_000
const TIMEOUT_MS = 5_000

async function probeServer(): Promise<Exclude<ServerLink, 'checking' | 'offline'>> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('/api/health', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      // The health route only fails when its database ping fails (or the server errors).
      return 'database-down'
    }
    const body = (await res.json().catch(() => null)) as { status?: string; db?: string } | null
    return body?.status === 'ok' && body.db === 'ok' ? 'connected' : 'database-down'
  } catch {
    return 'server-unreachable'
  } finally {
    window.clearTimeout(timer)
  }
}

function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** Green only after the server has answered and confirmed its database; anything else is shown as a problem. */
export function useServerLink(): ServerLink {
  const online = useBrowserOnline()
  const probe = useQuery({
    queryKey: ['server-link'],
    queryFn: probeServer,
    enabled: online,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  })
  if (!online) return 'offline'
  return probe.data ?? 'checking'
}
