interface TableSkeletonProps {
  /** Loading message announced to screen readers. */
  label: string
  rows?: number
  columns?: number
  className?: string
}

/**
 * Placeholder shown while an admin table or list is loading.
 * The message stays available to assistive technology through role="status".
 */
export function TableSkeleton({ label, rows = 4, columns = 4, className = '' }: TableSkeletonProps) {
  return (
    <div role="status" className={`overflow-hidden rounded-lg border border-neutral-200 bg-white ${className}`.trim()}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="divide-y divide-neutral-100">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <span
                key={columnIndex}
                className="h-3 flex-1 animate-pulse rounded bg-neutral-200"
                style={{ animationDelay: `${(rowIndex * columns + columnIndex) * 60}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
