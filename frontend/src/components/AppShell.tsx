import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useClinicBranding } from '../api/branding'
import { Link, useLocation, useNavigate } from 'react-router'
import { useLogout } from '../api/queries'
import type { Role } from '../api/types'
import {
  ADMIN_MODULE_GROUPS,
  ADMIN_MODULES,
  findAdminModuleForPath,
  navigableAdminModules,
  ownedAdminPaths,
  type AdminModule,
} from '../admin/modules'
import { AdminSubnav } from './AdminSubnav'

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
  | 'audit'
  | 'shield'
  | 'server'

interface NavigationItem {
  key: string
  label: string
  description: string
  path: string
  icon: NavigationIcon
  roles: Role[]
  /** Admin module entries: every page the module owns marks the entry active. */
  activePaths?: string[]
  /** Admin module entries: section heading shown above the first entry of each group. */
  sectionStart?: string
}

const ALL_ROLES: Role[] = ['ADMIN', 'RECEPTION', 'DOCTOR']
const ADMIN_RECEPTION: Role[] = ['ADMIN', 'RECEPTION']
const ADMIN_ONLY: Role[] = ['ADMIN']
const DOCTOR_ONLY: Role[] = ['DOCTOR']

// Declared before NAVIGATION: adminModuleNavigation() reads it while NAVIGATION initialises.
const ADMIN_MODULE_ICONS: Record<string, NavigationIcon> = {
  'user-authority': 'users',
  'hospital-configuration': 'settings',
  'doctor-clinical': 'database',
  'security-access': 'shield',
  'audit-compliance': 'audit',
  'backup-data': 'backup',
  'system-health': 'server',
}

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
    roles: ALL_ROLES,
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
    roles: ALL_ROLES,
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

    key: 'billing',
    label: 'Billing & Payments',
    description: 'Patient balances, collections and receipts',
    path: '/reception/dues',
    icon: 'rupee',
    roles: ADMIN_RECEPTION,
  },
  ...adminModuleNavigation(),
]

/**
 * Sidebar entries for ADMIN, generated from the admin module registry so labels match the
 * sub-navigation and breadcrumbs. Only modules that own an /admin/* page get an entry: the
 * dashboard is the Dashboard entry, and modules whose settings live on other modules' pages
 * (06 Billing, 08 Print) are reached through those pages and the admin sub-navigation.
 */
function adminModuleNavigation(): NavigationItem[] {
  const items: NavigationItem[] = []
  for (const group of ADMIN_MODULE_GROUPS) {
    let first = true
    for (const module of navigableAdminModules(group.id)) {
      const owned = ownedAdminPaths(module).filter((p) => p.startsWith('/admin/'))
      if (owned.length === 0) continue
      items.push({
        key: `admin-${module.id}`,
        label: module.title,
        description: module.description,
        path: owned[0],
        icon: ADMIN_MODULE_ICONS[module.id] ?? 'chart',
        roles: ADMIN_ONLY,
        activePaths: owned,
        sectionStart: first ? group.label.toUpperCase() : undefined,
      })
      first = false
    }
  }
  return items
}

const ADMIN_DASHBOARD: AdminModule | undefined = ADMIN_MODULES.find((m) => m.id === 'dashboard')

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
    return (
      pathname === '/reception/patients' ||
      /^\/reception\/patients\/\d+(?:\/print)?$/.test(pathname)
    )
  }

  const paths = item.activePaths ?? [item.path]
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
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
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="11" width="7" height="10" rx="1.5" />
          <rect x="3" y="14" width="8" height="7" rx="1.5" />
        </svg>
      )
    case 'user-plus':
      return (
        <svg {...shared}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5" />
          <path d="M19 8v7M15.5 11.5h7" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...shared}>
          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
          <path d="M3.5 9h17" />
        </svg>
      )
    case 'activity':
      return (
        <svg {...shared}>
          <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />
        </svg>
      )
    case 'calendar':
      return (
        <svg {...shared}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4M17 3v4M3 10h18M7 14h3M7 17h5" />
        </svg>
      )
    case 'calendar-check':
      return (
        <svg {...shared}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4M17 3v4M3 10h18M8 15l2.2 2.2L16 12" />
        </svg>
      )
    case 'rupee':
      return (
        <svg {...shared}>
          <path d="M6 5h12M6 9h12M7 5c5.5 0 6.5 7 0 7H6l10 7" />
          <path d="M6 9h12" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...shared}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      )
    case 'audit':
      return (
        <svg {...shared}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      )
    case 'database':
      return (
        <svg {...shared}>
          <ellipse cx="12" cy="5" rx="8.5" ry="3" />
          <path d="M3.5 5v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5M3.5 12v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-7" />
        </svg>
      )
    case 'users':
      return (
        <svg {...shared}>
          <circle cx="9" cy="8" r="3" />
          <path d="M2.5 20c.6-3 2.8-4.5 6.5-4.5s5.9 1.5 6.5 4.5M16 5.5a3 3 0 0 1 0 5.8M17 15.5c2.5.6 3.8 2.1 4.3 4.5" />
        </svg>
      )
    case 'backup':
      return (
        <svg {...shared}>
          <path d="M12 3v11m-4-4 4 4 4-4" />
          <path d="M5 15v5h14v-5" />
          <path d="M8 3h8" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...shared}>
          <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z" />
          <path d="m9 12 2.2 2.2L15.5 10" />
        </svg>
      )
    case 'server':
      return (
        <svg {...shared}>
          <rect x="3" y="4" width="18" height="7" rx="1.5" />
          <rect x="3" y="13" width="18" height="7" rx="1.5" />
          <path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="3" />
          <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" />
        </svg>
      )
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

function Breadcrumbs({ pathname, role }: { pathname: string; role: Role }) {
  const homePath = dashboardPath(role)
  const homeLabel =
    role === 'ADMIN'
      ? (ADMIN_DASHBOARD?.title ?? 'Administration Dashboard')
      : role === 'DOCTOR'
        ? 'Doctor Station'
        : 'Reception Desk'

  const crumbs: { label: string; href?: string }[] = [{ label: homeLabel, href: homePath }]

  if (pathname === '/reception/patients/new') {
    crumbs.push({ label: 'Patient Registration' })
  } else if (pathname === '/reception/patients') {
    crumbs.push({ label: 'Patient Records' })
  } else if (/^\/reception\/patients\/\d+$/.test(pathname)) {
    crumbs.push({ label: 'Patient Records', href: '/reception/patients' })
    crumbs.push({ label: 'Patient Profile & File' })
  } else if (/^\/reception\/patients\/\d+\/print$/.test(pathname)) {
    crumbs.push({ label: 'Patient Records', href: '/reception/patients' })
    crumbs.push({ label: 'Print Patient Card' })
  } else if (pathname === '/reception/appointments') {
    crumbs.push({ label: 'Appointments & Queue' })
  } else if (pathname === '/reception/dues') {
    crumbs.push({ label: 'Billing & Outstanding Dues' })
  } else if (pathname === '/doctor/treatment-plans') {
    crumbs.push({ label: 'Physiotherapy Treatment Plans' })
  } else if (pathname === '/doctor/encounters/new') {
    crumbs.push({ label: 'Consultation Queue', href: '/doctor' })
    crumbs.push({ label: 'New Clinical Consultation' })
  } else if (/^\/doctor\/encounters\/\d+$/.test(pathname)) {
    crumbs.push({ label: 'Consultation Queue', href: '/doctor' })
    crumbs.push({ label: 'Consultation Record' })
  } else if (pathname === '/doctor/prescriptions/new') {
    crumbs.push({ label: 'Consultation Queue', href: '/doctor' })
    crumbs.push({ label: 'New Prescription' })
  } else if (pathname.startsWith('/admin/')) {
    // Labels come from the admin module registry (owning module of this page).
    const match = findAdminModuleForPath(pathname)
    if (match && match.module.links.length > 1) {
      crumbs.push({ label: match.module.title, href: match.module.links[0].path })
      crumbs.push({ label: match.link.label })
    } else if (match) {
      crumbs.push({ label: match.module.title })
    } else {
      crumbs.push({ label: pathname.split('/')[2] })
    }
  }

  if (crumbs.length <= 1) return null

  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex items-center gap-1.5 text-xs text-slate-600 font-medium print:hidden"
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="text-slate-500 font-bold" aria-hidden="true">
                &rsaquo;
              </span>
            )}
            {isLast || !c.href ? (
              <span className="font-bold text-slate-900" aria-current={isLast ? 'location' : undefined}>
                {c.label}
              </span>
            ) : (
              <Link to={c.href} className="hover:text-[#8E1C3D] hover:underline">
                {c.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export function AppShell({ name, role, children }: AppShellProps) {
  const branding = useClinicBranding()
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
  const showAdminSubnav =
    role === 'ADMIN' &&
    (location.pathname === '/admin' || location.pathname.startsWith('/admin/'))

  const handleSignOut = async () => {
    try {
      await logout.mutateAsync()
    } finally {
      navigate('/login')
    }
  }

  const renderNavigation = (isDesktopSidebar: boolean, onNavigate?: () => void) => (
    <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-2 py-3 lg:px-3">
      <div className="space-y-1">
        {visibleItems.map((item, index) => {
          const href = navigationHref(item, role)
          const active = isNavigationItemActive(item, location.pathname, location.search, role)
          const sectionLabel =
            index === 1
              ? role === 'RECEPTION'
                ? 'RECEPTION DESK'
                : 'PATIENT & CLINICAL WORKFLOW'
              : (item.sectionStart ?? null)
          // Divider before the first admin module entry.
          const startsAdminArea =
            item.activePaths !== undefined && visibleItems[index - 1]?.activePaths === undefined
          return (
            <div key={item.key}>
              {startsAdminArea && (
                <div className={`mx-2 mb-2.5 mt-2.5 border-t border-white/15 ${isDesktopSidebar ? 'hidden lg:block' : ''}`} />
              )}
              {sectionLabel && (
                <div
                  className={`pb-1.5 pt-3.5 text-xs font-bold uppercase tracking-wider text-rose-100 ${
                    isDesktopSidebar ? 'hidden lg:block px-3' : 'px-3'
                  }`}
                >
                  {sectionLabel}
                </div>
              )}
              <Link
                to={href}
                onClick={onNavigate}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={[
                  'group relative flex min-h-11 items-center gap-3 rounded-lg py-2 text-xs font-semibold transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300',
                  active
                    ? 'bg-[#8E1C3D] text-white shadow-xs'
                    : 'text-rose-100 hover:bg-white/10 hover:text-white',
                  isDesktopSidebar
                    ? 'justify-center px-2 lg:justify-start lg:px-3'
                    : 'px-3',
                ].join(' ')}
              >
                {active && (
                  <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-[#C39A35]" />
                )}
                <NavIcon name={item.icon} />
                <span
                  className={
                    isDesktopSidebar
                      ? 'hidden min-w-0 flex-1 truncate lg:inline'
                      : 'min-w-0 flex-1 truncate'
                  }
                >
                  {item.label}
                </span>
                {active && (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[#E8C76A] ${
                      isDesktopSidebar ? 'hidden lg:block' : ''
                    }`}
                  />
                )}
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
        'flex h-full flex-col bg-[#5D0B26] text-white transition-all duration-200',
        mobile
          ? 'w-[min(84vw,300px)] shadow-2xl'
          : 'w-16 lg:w-64 shrink-0',
      ].join(' ')}
      aria-label="Hospital workspace navigation"
    >
      {/* Brand Header */}
      <div
        className={`flex min-h-[64px] items-center border-b border-white/15 ${
          mobile
            ? 'gap-3 px-4'
            : 'justify-center px-2 lg:justify-start lg:gap-3 lg:px-4'
        }`}
      >
        <img
          src="/kalyan-hospital-crest.webp"
          alt="Sri Vashishtha Kalyan Trust crest"
          className="h-10 w-10 shrink-0 rounded-full border-2 border-[#C39A35] bg-white object-contain shadow-xs"
          width={40}
          height={40}
        />
        <div className={mobile ? 'min-w-0' : 'hidden lg:block min-w-0'}>
          <p className="truncate text-sm font-extrabold leading-tight text-white">
            कल्याण हॉस्पीटल
          </p>
          <p className="truncate text-xs font-bold tracking-wide text-amber-200">
            KALYAN HOSPITAL
          </p>
          <p className="truncate text-xs text-rose-100 font-medium">
            Physiotherapy Department
          </p>
        </div>
      </div>

      {renderNavigation(!mobile, mobile ? () => setMobileOpen(false) : undefined)}

      {/* Network Status & Version */}
      <div className={`border-t border-white/15 p-2.5 ${mobile ? 'px-4' : 'lg:p-3'}`}>
        <div
          className={`flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1.5 ${
            mobile ? 'justify-start' : 'justify-center lg:justify-start'
          }`}
          title="Local clinic network active"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className={`text-xs font-semibold text-emerald-100 ${mobile ? 'inline' : 'hidden lg:inline'}`}>
            Local clinic network
          </span>
        </div>
        <p className={`mt-1.5 text-xs text-rose-100 font-medium text-center ${mobile ? 'block' : 'hidden lg:block'}`}>
          Kalyan Hospital · v3.0 LAN
        </p>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible flex-col bg-[#F5F7FA] text-slate-900">
      {/* Pinned Desktop Header */}
      <header className="relative z-20 shrink-0 print:hidden border-b border-slate-200 bg-white shadow-2xs">
        <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-hospital-navigation"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-[#5D0B26] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] md:hidden"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <img
              src="/kalyan-hospital-crest.webp"
              alt=""
              aria-hidden="true"
              className="hidden h-9 w-9 shrink-0 rounded-full border-2 border-[#C39A35] bg-white object-contain shadow-2xs sm:block"
              width={36}
              height={36}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-extrabold text-[#5D0B26] sm:text-base">
                  {branding.trustNameEn}
                </span>
                <span className="hidden lg:inline text-xs font-semibold text-slate-600">
                  &bull; <span lang="hi">{branding.trustNameHi}</span> · {branding.hospitalName.toUpperCase()}
                </span>
              </div>
              <p className="truncate text-xs font-medium text-slate-600">{branding.address}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <div className="hidden text-right lg:block">
              <p className="text-xs font-bold text-slate-800">{clock}</p>
              <p className="text-xs text-slate-600 font-medium">{branding.locationLine}</p>
            </div>
            <div className="hidden sm:block text-right border-l border-slate-200 pl-3">
              <p className="max-w-40 truncate text-xs font-bold text-slate-900">{name}</p>
              <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-950 border border-rose-200">
                {role}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={logout.isPending}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-300 px-3.5 text-xs font-bold text-slate-800 hover:border-[#8E1C3D] hover:text-[#5D0B26] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-2xs"
            >
              <span className="hidden sm:inline">
                {logout.isPending ? 'Signing out…' : 'Sign out'}
              </span>
              <span className="sm:hidden" aria-hidden="true">
                ↗
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Persistent Body Container */}
      <div className="flex min-h-0 flex-1 overflow-hidden print:overflow-visible">
        {/* Desktop Persistent Sidebar */}
        <div className="hidden md:flex h-full shrink-0 print:hidden">{renderSidebar()}</div>

        {/* Scrollable Main Content Workspace */}
        <main className="min-w-0 flex-1 overflow-y-auto print:overflow-visible px-4 py-5 sm:px-6 xl:px-8">
          <div className="mx-auto w-full max-w-[1720px] space-y-5">
            <Breadcrumbs pathname={location.pathname} role={role} />
            {showAdminSubnav ? (
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                <AdminSubnav />
                <div className="min-w-0 flex-1 space-y-5">{children}</div>
              </div>
            ) : (
              children
            )}
          </div>
          <footer className="mx-auto mt-8 flex max-w-[1720px] flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3.5 pb-6 text-xs text-slate-600 font-medium">
            <span>Kalyan Hospital · Local clinical workspace</span>
            <span>Patient information is available according to your role permissions.</span>
          </footer>
        </main>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          id="mobile-hospital-navigation"
          className="fixed inset-0 z-50 flex md:hidden"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/60"
            aria-label="Close navigation menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 h-full">{renderSidebar(true)}</div>
        </div>
      )}
    </div>
  )
}
