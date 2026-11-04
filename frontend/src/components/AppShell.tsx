import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useLogout } from '../api/queries'
import type { Role } from '../api/types'

interface AppShellProps {
  name: string
  role: Role
  children: ReactNode
}

type NavigationIcon =
  | 'dashboard'
  | 'user-plus'
  | 'folder'
  | 'activity'
  | 'calendar'
  | 'calendar-check'
  | 'rupee'
  | 'chart'
  | 'database'
  | 'users'
  | 'backup'
  | 'settings'

interface NavigationItem {
  key: string
  label: string
  description: string
  path: string
  icon: NavigationIcon
  roles: Role[]
}

const ALL_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'DOCTOR']
const ADMIN_RECEPTION: Role[] = ['ADMIN', 'RECEPTION']
const ADMIN_ONLY: Role[] = ['ADMIN']
const DOCTOR_ONLY: Role[] = ['DOCTOR']

const NAVIGATION: NavigationItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Role-specific clinic overview',
    path: '',
    icon: 'dashboard',
    roles: ALL_ROLES,
  },
  {
    key: 'patient-registration',
    label: 'Patient Registration',
    description: 'Register a new patient and issue a URN',
    path: '/reception/patients/new',
    icon: 'user-plus',
    roles: ['RECEPTION'],
  },
  {
    key: 'patient-records',
    label: 'Patient Records',
    description: 'Search and inspect patient records',
    path: '/reception/patients',
    icon: 'folder',
    roles: ['RECEPTION', 'DOCTOR'],
  },
  {
    key: 'physiotherapy',
    label: 'Physiotherapy Treatment',
    description: 'Treatment plans and session records',
    path: '/doctor/treatment-plans',
    icon: 'activity',
    roles: DOCTOR_ONLY,
  },
  {
    key: 'appointments',
    label: 'Appointments',
    description: "Today's token queue and appointment booking",
    path: '/reception/appointments?tab=today',
    icon: 'calendar',
    roles: ['RECEPTION', 'DOCTOR'],
  },
  {
    key: 'followups',
    label: 'Follow-up & Visits',
    description: 'Prescription-directed clinical follow-ups',
    path: '/reception/appointments?tab=followup',
    icon: 'calendar-check',
    roles: DOCTOR_ONLY,
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'Clinic identity and system configuration',
    path: '/admin/settings',
    icon: 'settings',
    roles: ADMIN_ONLY,
  },
  {
    key: 'master-data',
    label: 'Master Data',
    description: 'Doctors and fee schedules',
    path: '/admin/doctors',
    icon: 'database',
    roles: ADMIN_ONLY,
  },
  {
    key: 'departments',
    label: 'Departments',
    description: 'Specialties and doctor assignments',
    path: '/admin/departments',
    icon: 'folder',
    roles: ADMIN_ONLY,
  },
  {
    key: 'users',
    label: 'Users & Permissions',
    description: 'Accounts, roles and access controls',
    path: '/admin/users',
    icon: 'users',
    roles: ADMIN_ONLY,
  },
  {
    key: 'billing',
    label: 'Billing & Payments',
    description: 'Patient balances, collections and receipts',
    path: '/reception/dues',
    icon: 'rupee',
    roles: ADMIN_RECEPTION,
  },
  {
    key: 'reports',
    label: 'System Integrity',
    description: 'Clinical, financial and storage integrity checks',
    path: '/admin/integrity',
    icon: 'chart',
    roles: ADMIN_ONLY,
  },
  {
    key: 'audit',
    label: 'Audit & Compliance',
    description: 'Security and operational event history',
    path: '/admin/audit',
    icon: 'chart',
    roles: ADMIN_ONLY,
  },
  {
    key: 'backup',
    label: 'Backup & Restore',
    description: 'Local backup archives and recovery',
    path: '/admin/backups',
    icon: 'backup',
    roles: ADMIN_ONLY,
  },
]

function dashboardPath(role: Role) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'DOCTOR') return '/doctor'
  return '/reception'
}

function navigationHref(item: NavigationItem, role: Role) {
  return item.key === 'dashboard' ? dashboardPath(role) : item.path
}

function isNavigationItemActive(
  item: NavigationItem,
  pathname: string,
  search: string,
  role: Role,
) {
  if (item.key === 'dashboard') return pathname === dashboardPath(role)

  if (item.key === 'appointments' || item.key === 'followups') {
    if (pathname !== '/reception/appointments') return false
    const tab = new URLSearchParams(search).get('tab') || 'today'
    if (item.key === 'followups') return role === 'DOCTOR' && tab === 'followup'
    return tab !== 'followup' || role !== 'DOCTOR'
  }

  if (item.key === 'patient-registration') {
    return pathname === '/reception/patients/new'
  }

  if (item.key === 'patient-records') {
    return pathname === '/reception/patients'
      || /^\/reception\/patients\/\d+(?:\/print)?$/.test(pathname)
  }

  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}

function NavIcon({ name }: { name: NavigationIcon }) {
  const shared = {
    className: 'h-5 w-5 shrink-0',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (name) {
    case 'dashboard':
      return <svg {...shared}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="11" width="7" height="10" rx="1.5" /><rect x="3" y="14" width="8" height="7" rx="1.5" /></svg>
    case 'user-plus':
      return <svg {...shared}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5" /><path d="M19 8v7M15.5 11.5h7" /></svg>
    case 'folder':
      return <svg {...shared}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /><path d="M3.5 9h17" /></svg>
    case 'activity':
      return <svg {...shared}><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></svg>
    case 'calendar':
      return <svg {...shared}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M7 14h3M7 17h5" /></svg>
    case 'calendar-check':
      return <svg {...shared}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 15l2.2 2.2L16 12" /></svg>
    case 'rupee':
      return <svg {...shared}><path d="M6 5h12M6 9h12M7 5c5.5 0 6.5 7 0 7H6l10 7" /><path d="M6 9h12" /></svg>
    case 'chart':
      return <svg {...shared}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
    case 'database':
      return <svg {...shared}><ellipse cx="12" cy="5" rx="8.5" ry="3" /><path d="M3.5 5v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5M3.5 12v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-7" /></svg>
    case 'users':
      return <svg {...shared}><circle cx="9" cy="8" r="3" /><path d="M2.5 20c.6-3 2.8-4.5 6.5-4.5s5.9 1.5 6.5 4.5M16 5.5a3 3 0 0 1 0 5.8M17 15.5c2.5.6 3.8 2.1 4.3 4.5" /></svg>
    case 'backup':
      return <svg {...shared}><path d="M12 3v11m-4-4 4 4 4-4" /><path d="M5 15v5h14v-5" /><path d="M8 3h8" /></svg>
    case 'settings':
      return <svg {...shared}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" /></svg>
  }
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function AppShell({ name, role, children }: AppShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useLogout()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [clock, setClock] = useState(() => formatClock(new Date()))

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatClock(new Date())), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const visibleItems = useMemo(
    () => NAVIGATION.filter((item) => item.roles.includes(role)),
    [role],
  )

  const handleSignOut = async () => {
    try {
      await logout.mutateAsync()
    } finally {
      navigate('/login')
    }
  }

  const renderNavigation = (compact: boolean, onNavigate?: () => void) => (
    <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4">
      <div className="space-y-1">
        {visibleItems.map((item, index) => {
          const href = navigationHref(item, role)
          const active = isNavigationItemActive(item, location.pathname, location.search, role)
          const sectionLabel =
            role === 'ADMIN' && item.key === 'billing' ? 'FINANCIAL ADMINISTRATION'
              : role === 'ADMIN' && item.key === 'reports' ? 'SECURITY & COMPLIANCE'
                : index === 1
                  ? role === 'ADMIN' ? 'HOSPITAL ADMINISTRATION'
                    : role === 'RECEPTION' ? 'RECEPTION DESK' : 'PATIENT & CLINICAL WORKFLOW'
                  : null
          return (
            <div key={item.key}>
              {sectionLabel && (
                <div className={`pb-2 pt-4 text-[10px] font-bold tracking-[0.12em] text-rose-100/65 ${compact ? 'hidden xl:block xl:px-3 xl:text-left' : 'px-3'}`}>
                  {sectionLabel}
                </div>
              )}
              {item.key === 'reports' && (
                <div className="mx-2 mb-3 mt-3 border-t border-white/15" />
              )}
              <Link
                to={href}
                onClick={onNavigate}
                title={compact ? item.label : item.description}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={[
                  'group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300',
                  active
                    ? 'bg-[#8E1C3D] text-white shadow-sm'
                    : 'text-rose-50/90 hover:bg-white/10 hover:text-white',
                  compact ? 'justify-center px-0 xl:justify-start xl:px-3' : '',
                ].join(' ')}
              >
                {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-[#C39A35]" />}
                <NavIcon name={item.icon} />
                <span className={compact ? 'hidden min-w-0 flex-1 truncate xl:inline' : 'min-w-0 flex-1 truncate'}>{item.label}</span>
                {active && <span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[#E8C76A] ${compact ? 'hidden xl:block' : ''}`} />}
              </Link>
            </div>
          )
        })}
      </div>
    </nav>
  )

  const renderSidebar = (mobile = false) => (
    <aside
      className={[
        'flex h-full flex-col bg-[#5D0B26] text-white',
        mobile ? 'w-[min(84vw,300px)] shadow-2xl' : 'w-[68px] shrink-0 xl:w-[240px]',
      ].join(' ')}
      aria-label="Hospital workspace navigation"
    >
      <div className={`flex min-h-[82px] items-center border-b border-white/15 ${mobile ? 'gap-3 px-4' : 'justify-center px-2 xl:justify-start xl:gap-3 xl:px-4'}`}>
        <img
          src="/kalyan-hospital-crest.webp"
          alt="Sri Vashishtha Kalyan Trust crest"
          className="h-11 w-11 shrink-0 rounded-full border-2 border-[#C39A35] bg-white object-contain shadow-sm"
          width={44}
          height={44}
        />
        <div className={mobile ? 'min-w-0' : 'hidden min-w-0 xl:block'}>
          <p className="truncate text-sm font-extrabold leading-tight">कल्याण हॉस्पीटल</p>
          <p className="mt-0.5 truncate text-[11px] font-bold tracking-wide text-white">KALYAN HOSPITAL</p>
          <p className="mt-1 truncate text-[9px] font-semibold tracking-[0.08em] text-rose-100/80">PHYSIOTHERAPY DEPARTMENT</p>
          <p className="mt-0.5 truncate text-[9px] text-rose-100/65">श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित</p>
        </div>
      </div>

      {renderNavigation(!mobile, mobile ? () => setMobileOpen(false) : undefined)}

      <div className={`border-t border-white/15 p-3 ${mobile ? 'px-4' : ''}`}>
        <div className={`flex items-center gap-2 rounded-lg bg-white/8 px-2 py-2 ${!mobile ? 'justify-center xl:justify-start' : ''}`}>
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className={!mobile ? 'hidden text-[10px] font-semibold text-emerald-100 xl:inline' : 'text-[11px] font-semibold text-emerald-100'}>
            Local clinic network
          </span>
        </div>
        <p className={`mt-2 text-[10px] text-rose-100/55 ${!mobile ? 'hidden text-center xl:block' : ''}`}>Kalyan Hospital · v3.0</p>
      </div>
    </aside>
  )

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F7FA] text-slate-900">
      <header className="relative z-20 border-b border-slate-200 bg-white">
        <div className="flex min-h-[68px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-hospital-navigation"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-[#5D0B26] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] md:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <img
              src="/kalyan-hospital-crest.webp"
              alt=""
              aria-hidden="true"
              className="hidden h-11 w-11 shrink-0 rounded-full border-2 border-[#C39A35] bg-white object-contain shadow-sm sm:block"
              width={44}
              height={44}
            />
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold leading-tight text-[#5D0B26] sm:text-lg">Sri Vashishtha Kalyan Trust</p>
              <p className="truncate text-xs font-semibold text-slate-700">श्री वशिष्ठ कल्याण ट्रस्ट · KALYAN HOSPITAL</p>
              <p className="hidden truncate text-[10px] font-medium tracking-wide text-slate-500 sm:block">PHYSIOTHERAPY DEPARTMENT · सेवा • सहयोग • संस्कार</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div className="hidden text-right lg:block">
              <p className="text-xs font-semibold text-slate-700">{clock}</p>
              <p className="text-[10px] text-slate-500">Ara · Bhojpur · Bihar</p>
            </div>
            <div className="hidden text-right sm:block">
              <p className="max-w-36 truncate text-xs font-bold text-slate-800">{name}</p>
              <p className="text-[10px] font-semibold tracking-wide text-slate-500">{role}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={logout.isPending}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="hidden sm:inline">{logout.isPending ? 'Signing out…' : 'Sign out'}</span>
              <span className="sm:hidden" aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-[#4A081E] px-4 py-2 text-[11px] text-white sm:px-6">
          <span className="inline-flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" /><circle cx="12" cy="9" r="2.2" />
            </svg>
            <span>स्टेशन रोड, नवादा थाना के सामने वाली गली, आरा, भोजपुर, बिहार - 802301</span>
          </span>
          <span className="font-semibold text-amber-100">{clock}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden md:flex">{renderSidebar()}</div>
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 xl:px-7">
          <div className="mx-auto w-full max-w-[1600px] space-y-4">
            {children}
          </div>
          <footer className="mx-auto mt-8 flex max-w-[1600px] flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
            <span>Kalyan Hospital · Local clinical workspace</span>
            <span>Patient information is available according to your role permissions.</span>
          </footer>
        </main>
      </div>

      {mobileOpen && (
        <div id="mobile-hospital-navigation" className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50"
            aria-label="Close navigation menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 h-full">
            {renderSidebar(true)}
          </div>
        </div>
      )}
    </div>
  )
}
