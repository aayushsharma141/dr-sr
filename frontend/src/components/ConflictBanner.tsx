import { useEffect, useRef } from 'react'

interface ConflictBannerProps {
  onReload: () => void
  isReloading?: boolean
}

export function ConflictBanner({ onReload, isReloading = false }: ConflictBannerProps) {
  const bannerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bannerRef.current?.focus()
  }, [])

  return (
    <div
      ref={bannerRef}
      role="alert"
      tabIndex={-1}
      className="p-4 bg-amber-50 border border-amber-300 rounded-md text-amber-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 focus:outline-hidden"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">Record was modified by another user</span>
      </div>
      <button
        type="button"
        onClick={onReload}
        disabled={isReloading}
        className="px-3 py-2 text-sm font-medium text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-amber-800 disabled:opacity-50 cursor-pointer"
      >
        {isReloading ? 'Reloading...' : 'Reload latest'}
      </button>
    </div>
  )
}
