import type { ReactNode } from 'react'

interface AdminPageHeaderProps {
  title: string
  description?: string
  eyebrow?: string
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Shared heading block for every screen inside the app shell.
 * One compact row: title (and an optional one-line note) on the left, page actions
 * or section links on the right, vertically centred so nothing adds stray top space.
 */
export function AdminPageHeader({ title, description, eyebrow, icon, actions, className = '' }: AdminPageHeaderProps) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}>
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-red-900">{eyebrow}</p>}
        <div className="flex items-center gap-2.5">
          {icon}
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        </div>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
