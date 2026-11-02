import { Link, useLocation } from 'react-router'

const ADMIN_TABS = [
  { label: 'Doctors & Fees', path: '/admin/doctors', shortLabel: 'Doctors' },
  { label: 'Users & Roles', path: '/admin/users', shortLabel: 'Users' },
  { label: 'Audit Logs', path: '/admin/audit', shortLabel: 'Audit' },
  { label: 'Backup & Restore', path: '/admin/backups', shortLabel: 'Backups' },
  { label: 'System Integrity', path: '/admin/integrity', shortLabel: 'Integrity' },
  { label: 'Clinic Settings', path: '/admin/settings', shortLabel: 'Settings' },
]

export function AdminNavTabs() {
  const { pathname } = useLocation()

  return (
    <section
      aria-label="Administration workspace navigation"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8E1C3D]">
            Administration & Safety
          </p>
          <h2 className="text-sm font-bold text-slate-900">Hospital management</h2>
        </div>
        <p className="text-xs text-slate-500">Administrative access · ADMIN</p>
      </div>

      <nav
        aria-label="Administration sections"
        className="flex gap-1 overflow-x-auto px-2 py-2 sm:px-3"
      >
        {ADMIN_TABS.map((tab) => {
          const active = pathname === tab.path || pathname.startsWith(`${tab.path}/`)
          return (
            <Link
              key={tab.path}
              to={tab.path}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              className={[
                'inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border-b-2 px-3 text-xs font-semibold transition-colors sm:px-4',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]',
                active
                  ? 'border-[#C39A35] bg-[#FFF8E7] text-[#5D0B26]'
                  : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-[#5D0B26]',
              ].join(' ')}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </Link>
          )
        })}
      </nav>
    </section>
  )
}
