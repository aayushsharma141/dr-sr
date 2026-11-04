import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import {
  ADMIN_MODULE_GROUPS,
  findAdminModuleForPath,
  isOwningAdminLink,
  navigableAdminModules,
  type AdminModule,
  type AdminModuleLink,
} from '../admin/modules'

const LINK_BASE =
  'flex min-h-11 items-center gap-2 rounded-lg border-l-4 px-3 py-2 text-sm font-semibold transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]'
const LINK_ACTIVE = 'border-[#C39A35] bg-[#FFF8E7] text-[#5D0B26]'
const LINK_IDLE = 'border-transparent text-slate-700 hover:bg-slate-50 hover:text-[#5D0B26]'

function SubnavLink({
  link,
  label,
  number,
  active,
  indent,
  onNavigate,
}: {
  link: AdminModuleLink
  label: string
  number?: string
  active: boolean
  indent?: boolean
  onNavigate: () => void
}) {
  return (
    <Link
      to={link.path}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={[LINK_BASE, active ? LINK_ACTIVE : LINK_IDLE, indent ? 'ml-3 font-medium' : ''].join(' ')}
    >
      {number && (
        <span className="w-6 shrink-0 font-mono text-sm text-slate-600" aria-hidden="true">
          {number}
        </span>
      )}
      <span className="min-w-0 flex-1">{label}</span>
    </Link>
  )
}

function ModuleEntry({
  module,
  pathname,
  onNavigate,
}: {
  module: AdminModule
  pathname: string
  onNavigate: () => void
}) {
  if (module.links.length === 1) {
    const link = module.links[0]
    return (
      <li>
        <SubnavLink
          link={link}
          label={module.title}
          number={module.number}
          active={isOwningAdminLink(module, link, pathname)}
          onNavigate={onNavigate}
        />
      </li>
    )
  }

  const headingId = `admin-subnav-module-${module.id}`
  return (
    <li>
      <p
        id={headingId}
        className="flex min-h-11 items-center gap-2 px-4 py-2 text-sm font-bold text-slate-900"
      >
        <span className="w-6 shrink-0 font-mono text-sm text-slate-600" aria-hidden="true">
          {module.number}
        </span>
        <span className="min-w-0 flex-1">{module.title}</span>
      </p>
      <ul aria-labelledby={headingId} className="space-y-0.5">
        {module.links.map((link) => (
          <li key={link.path}>
            <SubnavLink
              link={link}
              label={link.label}
              active={isOwningAdminLink(module, link, pathname)}
              indent
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * Persistent grouped administration sub-navigation driven by the module registry.
 * Desktop (lg+): a vertical column that scrolls independently of the page.
 * Narrow widths: collapses behind a toggle showing the current module.
 */
export function AdminSubnav() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const current = findAdminModuleForPath(pathname)
  const close = () => setOpen(false)

  return (
    <aside
      aria-label="Administration modules"
      className="w-full shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm print:hidden lg:sticky lg:top-0 lg:max-h-[calc(100vh-9rem)] lg:w-72 lg:overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-[#8E1C3D]">Administration</p>
          {current && (
            <p className="truncate text-sm text-slate-600 lg:hidden">
              {current.module.number} {current.module.title}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="admin-subnav-sections"
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:border-[#8E1C3D] hover:text-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] lg:hidden"
        >
          {open ? 'Hide modules' : 'All modules'}
        </button>
      </div>

      <nav
        id="admin-subnav-sections"
        aria-label="Administration sections"
        className={`${open ? 'block' : 'hidden'} space-y-4 px-2 py-3 lg:block`}
      >
        {ADMIN_MODULE_GROUPS.map((group) => {
          const modules = navigableAdminModules(group.id)
          if (modules.length === 0) return null
          const groupHeadingId = `admin-subnav-group-${group.id}`
          return (
            <section key={group.id} aria-labelledby={groupHeadingId}>
              <h2
                id={groupHeadingId}
                className="px-3 pb-1 text-sm font-bold uppercase tracking-wide text-slate-600"
              >
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {modules.map((module) => (
                  <ModuleEntry
                    key={module.id}
                    module={module}
                    pathname={pathname}
                    onNavigate={close}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </nav>
    </aside>
  )
}
