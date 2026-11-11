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
 * Shared heading block for administration screens.
 * Keeps the title, its one-line purpose and any page actions in one place so
 * every admin page reads the same way.
 */
export function AdminPageHeader({ title, description, eyebrow, icon, actions, className = '' }: AdminPageHeaderProps) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`.trim()}>
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-red-900">{eyebrow}</p>}
        <div className="flex items-center gap-2.5">
          {icon}
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-700">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
