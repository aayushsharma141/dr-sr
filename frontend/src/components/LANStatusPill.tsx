import { useState, useEffect } from 'react'
import { useHealth } from '../api/health'

export function LANStatusPill() {
  const [isBrowserOnline, setIsBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const { data, isError, isLoading, refetch, isFetching } = useHealth(15000)

  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true)
      refetch()
    }
    const handleOffline = () => {
      setIsBrowserOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refetch])

  const isConnected = isBrowserOnline && !isError && data?.status === 'ok'

  if (isLoading && !data) {
    return (
      <div
        role="status"
        aria-label="Checking local LAN server connection"
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 select-none shadow-2xs"
      >
        <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
        <span className="hidden sm:inline">LAN:</span>
        <span>Checking...</span>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={() => refetch()}
        role="status"
        aria-live="polite"
        aria-label="LAN status: Disconnected. Click to retry connecting to local clinic server."
        title="Local server unreachable. Check LAN cable / Wi-Fi. Click to retry."
        className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 transition-colors cursor-pointer shadow-2xs"
      >
        <span className="h-2 w-2 rounded-full bg-rose-600" aria-hidden="true" />
        <span className="hidden sm:inline">LAN:</span>
        <span>Disconnected</span>
        {isFetching && <span className="text-xs text-rose-700 animate-spin">⟳</span>}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => refetch()}
      role="status"
      aria-label="LAN status: Connected to local clinic server. Click to refresh."
      title="Connected to local clinic server (100% LAN). Click to verify connection."
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 transition-colors cursor-pointer shadow-2xs"
    >
      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
      <span className="hidden sm:inline">LAN:</span>
      <span>Online</span>
      {isFetching && <span className="text-xs text-emerald-700 animate-spin">⟳</span>}
    </button>
  )
}
