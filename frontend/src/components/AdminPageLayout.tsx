import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AppShell } from './AppShell'

interface AdminPageLayoutProps {
  title: string
  description: string
  name?: string
  actions?: ReactNode
  children: ReactNode
}

export function AdminPageLayout({
  title,
  description,
  name = 'Admin',
  actions,
  children,
}: AdminPageLayoutProps) {
  return (
    <AppShell name={name} role="ADMIN">
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <Link to="/admin" className="transition-colors hover:text-[#8E1C3D]">
                Administration
              </Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page" className="text-slate-700">{title}</span>
            </nav>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </header>
        <div className="space-y-6">
          {children}
        </div>
      </div>
    </AppShell>
  )
}
