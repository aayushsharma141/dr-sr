import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useClinicBranding } from '../api/branding'
import { useMyDepartments, type SpecialtyCode } from '../api/specialty'
import { Link, useLocation, useNavigate } from 'react-router'
import { useLatestIntegrityRun } from '../api/integrity'
import { useLogout } from '../api/queries'
import { countBySeverity, groupFindings } from '../admin/integrity'
import type { Role } from '../api/types'
import {
  ADMIN_MODULE_GROUPS,
  adminModulesInGroup,
  findAdminModuleForPath,
} from '../admin/modules'

interface AppShellProps {
  name: string
  role: Role
  children: ReactNode
}

type NavigationIcon =
  | 'dashboard'
  | 'user-plus'
  | 'ticket'
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
  /** Shown to a doctor only when they belong to this department; shown to all while unknown. */
  specialty?: SpecialtyCode
  path: string
  icon: NavigationIcon
  roles: Role[]
  activePaths?: string[]
  sectionStart?: string
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
  // Patient & Clinical Workflow
  {
    key: 'patient-registration',
    label: 'Patient Registration',
    description: 'Register a new patient and issue a URN',
    path: '/reception/patients/new',
    icon: 'user-plus',
    roles: ['RECEPTION'],
    sectionStart: 'PATIENT & CLINICAL WORKFLOW',
  },
  {
    key: 'token-generation',
    label: 'Token Desk',
    description: 'Register visit and issue queue token',
    path: '/reception/tokens',
    icon: 'ticket',
    roles: ['RECEPTION', 'ADMIN'],
  },
  {
    key: 'patient-records',
    label: 'Patient Records',
    description: 'Search and inspect patient records',
    path: '/reception/patients',
    icon: 'folder',
    roles: ALL_ROLES,
    sectionStart: 'PATIENT & CLINICAL WORKFLOW',
  },
  {
    key: 'physiotherapy',
    label: 'Physiotherapy Treatment',
    description: 'Treatment plans and session records',
    path: '/doctor/treatment-plans',
    icon: 'activity',
    roles: DOCTOR_ONLY,
    specialty: 'PHYSIOTHERAPY',
  },
  {
    key: 'appointments',
    label: 'Appointments',
    description: "Daily token schedule and waiting hall queue",
    path: '/reception/appointments?tab=today',
    icon: 'ticket',
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
    description: 'Patient checkout, collections, receipts and dues',
    path: '/reception/dues',
    icon: 'rupee',
    roles: ADMIN_RECEPTION,
    activePaths: ['/reception/dues', '/reception/billing'],
  },
  // Hospital Administration
  {
    key: 'hospital-configuration',
    label: 'Hospital Configuration',
    description: 'Clinic identity, address, contact details and consultation validity',
    path: '/admin/settings',
    icon: 'settings',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/settings'],
    sectionStart: 'HOSPITAL ADMINISTRATION',
  },
  {
    key: 'doctor-clinical',
    label: 'Doctor & Clinical Configuration',
    description: 'Doctor records, registration details and fee schedules',
    path: '/admin/doctors',
    icon: 'database',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/doctors', '/admin/departments'],
  },
  {
    key: 'billing-financial',
    label: 'Billing & Financial',
    description: 'Receipt numbering cycle, fee schedules and payment reversals',
    path: '/admin/billing',
    icon: 'rupee',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/billing'],
  },
  // System Administration
  {
    key: 'user-authority',
    label: 'User & Authority',
    description: 'Staff accounts, roles and permission matrix',
    path: '/admin/users',
    icon: 'users',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/users', '/admin/roles'],
    sectionStart: 'SYSTEM ADMINISTRATION',
  },
  {
    key: 'security-access',
    label: 'Security & Access',
    description: 'Active sessions and security policy',
    path: '/admin/security',
    icon: 'shield',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/security'],
  },
  {
    key: 'audit-compliance',
    label: 'Audit & Compliance',
    description: 'Search immutable event audit trail',
    path: '/admin/audit',
    icon: 'audit',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/audit'],
  },
  {
    key: 'backup-data',
    label: 'Backup, Restore & Data',
    description: 'Backup archives, recovery and integrity checks',
    path: '/admin/backups',
    icon: 'backup',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/backups', '/admin/integrity'],
  },
  {
    key: 'system-health',
    label: 'System Health & Maintenance',
    description: 'Server revision, uptime and storage',
    path: '/admin/system',
    icon: 'server',
    roles: ADMIN_ONLY,
    activePaths: ['/admin/system'],
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
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      )
    case 'ticket':
      return (
        <svg {...shared}>
          <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
          <line x1="13" y1="5" x2="13" y2="7" />
          <line x1="13" y1="17" x2="13" y2="19" />
          <line x1="13" y1="11" x2="13" y2="13" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...shared}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      )
    case 'activity':
      return (
        <svg {...shared}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      )
    case 'calendar':
      return (
        <svg {...shared}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    case 'calendar-check':
      return (
        <svg {...shared}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <path d="m9 16 2 2 4-4" />
        </svg>
      )
    case 'rupee':
      return (
        <svg {...shared}>
          <path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a4 4 0 0 0 0-8" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...shared}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      )
    case 'database':
      return (
        <svg {...shared}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      )
    case 'users':
      return (
        <svg {...shared}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    case 'backup':
      return (
        <svg {...shared}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
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
    case 'shield':
      return (
        <svg {...shared}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )
    case 'server':
      return (
        <svg {...shared}>
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      )
    case 'settings':
    default:
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

type Crumb = { label: string; href?: string }

/**
 * The path to the current page, in the same words as the sidebar and the page title.
 * The last crumb also names the browser tab, so every page is told apart in the tab bar.
 */
function breadcrumbsFor(pathname: string, role: Role): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: dashboardPath(role) }]

  if (pathname === '/reception/patients/new') {
    crumbs.push({ label: 'Patient Registration' })
  } else if (pathname === '/reception/tokens') {
    crumbs.push({ label: 'Token Desk' })
  } else if (pathname === '/reception/patients') {
    crumbs.push({ label: 'Patient Records' })
  } else if (/^\/reception\/patients\/\d+$/.test(pathname)) {
    crumbs.push({ label: 'Patient Records', href: '/reception/patients' })
    crumbs.push({ label: 'Patient Record' })
  } else if (/^\/reception\/patients\/\d+\/print$/.test(pathname)) {
    crumbs.push({ label: 'Patient Records', href: '/reception/patients' })
    crumbs.push({ label: 'Registration Card' })
  } else if (pathname === '/reception/appointments') {
    crumbs.push({ label: 'Appointments' })
  } else if (pathname === '/reception/billing') {
    crumbs.push({ label: 'Billing & Payments' })
  } else if (pathname === '/reception/dues') {
    crumbs.push({ label: 'Billing & Payments', href: '/reception/billing' })
    crumbs.push({ label: 'Pending Dues' })
  } else if (pathname === '/doctor/treatment-plans') {
    crumbs.push({ label: 'Treatment Plans' })
  } else if (pathname === '/doctor/encounters/new') {
    crumbs.push({ label: 'New Consultation' })
  } else if (/^\/doctor\/encounters\/\d+$/.test(pathname)) {
    crumbs.push({ label: 'Consultation' })
  } else if (pathname === '/doctor/prescriptions/new') {
    crumbs.push({ label: 'New Prescription' })
  } else if (pathname.startsWith('/admin/')) {
    const match = findAdminModuleForPath(pathname)
    if (match && match.action.path !== match.module.canonicalPath) {
      if (match.module.canonicalPath) {
        crumbs.push({ label: match.module.title, href: match.module.canonicalPath })
      } else {
        crumbs.push({ label: match.module.title })
      }
      crumbs.push({ label: match.action.label })
    } else if (match) {
      crumbs.push({ label: match.module.title })
    } else {
      crumbs.push({ label: pathname.split('/')[2] })
    }
  }

  return crumbs
}

function Breadcrumbs({ pathname, role }: { pathname: string; role: Role }) {
  const crumbs = breadcrumbsFor(pathname, role)
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
              <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'font-bold text-slate-900' : ''}>
                {c.label}
              </span>
            ) : (
              <Link to={c.href} className="text-[#8E1C3D] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8E1C3D]">
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
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useLogout()
  const branding = useClinicBranding()
  const myDepartments = useMyDepartments()
  const myDepartmentLabel = myDepartments.map((d) => d.name_en).join(' · ')
  // Problems from the last stored integrity run, shown beside Data Integrity in the sidebar.
  const latestIntegrity = useLatestIntegrityRun({ enabled: role === 'ADMIN' })
  const integrityProblems = countBySeverity(groupFindings(latestIntegrity.data)).ERROR
  const [mobileOpen, setMobileOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileOpen])

  const clock = useMemo(() => formatClock(now), [now])

  useEffect(() => {
    const crumbs = breadcrumbsFor(location.pathname, role)
    const page = crumbs[crumbs.length - 1].label
    document.title = `${page} – Kalyan Hospital`
  }, [location.pathname, role])

  const visibleItems = useMemo(() => {
    const codes = new Set(myDepartments.map((d) => d.code))
    return NAVIGATION.filter(
      (item) =>
        item.roles.includes(role) &&
        // Until the doctor's departments are known, keep every item rather than hide work.
        (!item.specialty || role !== 'DOCTOR' || codes.size === 0 || codes.has(item.specialty)),
    )
  }, [role, myDepartments])

  const handleSignOut = async () => {
    try {
      await logout.mutateAsync()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  const renderAdminSidebar = (isDrawer = false) => {
    const isDesktopSidebar = !isDrawer
    return (
      <aside
        aria-label="Primary navigation"
        className={`flex h-full flex-col bg-[#5D0B26] text-white transition-all duration-200 ${isDrawer ? 'w-72 max-w-[85vw] shadow-2xl' : 'w-16 lg:w-64 shrink-0'
          }`}
      >
        {/* Sidebar Brand Header */}
        <div
          className={`flex min-h-[64px] shrink-0 items-center border-b border-white/15 ${isDesktopSidebar ? 'justify-center px-2 lg:justify-start lg:gap-3 lg:px-4' : 'justify-between px-4'
            }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/api/assets/active-logo"
              alt="Sri Vashishtha Kalyan Trust crest"
              className="h-10 w-10 shrink-0 rounded-full border border-[#C39A35] bg-white object-contain shadow-xs"
              width={40}
              height={40}
              onError={(e) => {
                ;(e.target as HTMLImageElement).src = '/kalyan-hospital-crest.webp'
              }}
            />
            <div className={`min-w-0 ${isDesktopSidebar ? 'hidden lg:block' : 'block'}`}>
              <div className="truncate text-sm font-extrabold tracking-wide text-white" lang="hi">
                कल्याण हॉस्पीटल
              </div>
              <p className="truncate text-xs font-semibold text-rose-100/90 tracking-wider">
                KALYAN HOSPITAL
              </p>
              <p className="truncate text-xs text-amber-200 font-medium">
                Administration Panel
              </p>
            </div>
          </div>
          {isDrawer && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Scrollable Navigation Items */}
        <nav
          aria-label="Primary navigation"
          className="flex-1 space-y-3 overflow-y-auto px-3 py-4 custom-scrollbar-dark"
        >
          {/* Dashboard (Home) */}
          <Link
            to="/admin"
            onClick={() => isDrawer && setMobileOpen(false)}
            aria-current={location.pathname === '/admin' ? 'page' : undefined}
            title="Management Overview"
            className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${isDesktopSidebar ? 'justify-center lg:justify-start' : 'justify-start'
              } ${location.pathname === '/admin'
                ? 'bg-white text-[#5D0B26] font-bold shadow-sm'
                : 'text-rose-100 hover:bg-white/10 hover:text-white'
              }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className={`${isDesktopSidebar ? 'hidden lg:inline' : 'inline'}`}>
              Management Overview
            </span>
            {location.pathname === '/admin' && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-2 bottom-2 w-1.5 rounded-r bg-[#C39A35]"
              />
            )}
          </Link>

          {/* Five Canonical Admin Sections */}
          {ADMIN_MODULE_GROUPS.map((group) => {
            const modules = adminModulesInGroup(group.id)
            return (
              <div key={group.id} className="space-y-1">
                <div
                  role="heading"
                  aria-level={3}
                  className={`px-3 py-2 text-xs font-bold uppercase tracking-wider text-rose-200 ${isDesktopSidebar ? 'hidden lg:block' : 'block'
                    }`}
                >
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {modules.map((mod) => {
                    const active =
                      mod.canonicalPath === '/admin'
                        ? location.pathname === '/admin'
                        : Boolean(
                          mod.canonicalPath &&
                          (location.pathname === mod.canonicalPath ||
                            location.pathname.startsWith(`${mod.canonicalPath}/`)),
                        )
                    return (
                      <Link
                        key={mod.id}
                        to={mod.canonicalPath!}
                        onClick={() => isDrawer && setMobileOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        title={mod.title}
                        className={`group relative flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${isDesktopSidebar ? 'justify-center lg:justify-start' : 'justify-start'
                          } ${active
                            ? 'bg-white text-[#5D0B26] font-bold shadow-sm'
                            : 'text-rose-100 hover:bg-white/10 hover:text-white'
                          }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-[#5D0B26]' : 'bg-rose-200/60'
                            }`}
                          aria-hidden="true"
                        />
                        <span className={`truncate ${isDesktopSidebar ? 'hidden lg:inline' : 'inline'}`}>
                          {mod.title}
                        </span>
                        {mod.id === 'data-integrity' && integrityProblems > 0 && (
                          <span
                            className={`ml-auto shrink-0 rounded-full bg-red-700 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white ${isDesktopSidebar ? 'hidden lg:inline' : 'inline'
                              }`}
                          >
                            <span aria-hidden="true">{integrityProblems}</span>
                            <span className="sr-only">
                              , {integrityProblems} {integrityProblems === 1 ? 'problem' : 'problems'}
                            </span>
                          </span>
                        )}
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-2 bottom-2 w-1.5 rounded-r bg-[#C39A35]"
                          />
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Sidebar Footer Context */}
        <div
          className={`border-t border-white/15 p-3 text-xs text-rose-100/80 shrink-0 ${isDesktopSidebar ? 'hidden lg:block' : 'block'
            }`}
        >
          <p className="font-semibold text-white">Local clinic network</p>
          <p className="mt-0.5 text-xs text-rose-200">Kalyan Hospital · v3.0 LAN</p>
        </div>
      </aside>
    )
  }

  const renderSidebar = (isDrawer = false) => {
    if (role === 'ADMIN') {
      return renderAdminSidebar(isDrawer)
    }
    const isDesktopSidebar = !isDrawer
    return (
      <aside
        aria-label="Hospital workspace navigation"
        className={`flex h-full flex-col bg-[#5D0B26] text-white transition-all duration-200 ${isDrawer ? 'w-72 max-w-[85vw] shadow-2xl' : 'w-16 lg:w-64 shrink-0'
          }`}
      >
        {/* Sidebar Brand Header */}
        <div
          className={`flex min-h-[64px] shrink-0 items-center border-b border-white/15 ${isDesktopSidebar ? 'justify-center px-2 lg:justify-start lg:gap-3 lg:px-4' : 'justify-between px-4'
            }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/api/assets/active-logo"
              alt="Sri Vashishtha Kalyan Trust crest"
              className="h-10 w-10 shrink-0 rounded-full border border-[#C39A35] bg-white object-contain shadow-xs"
              width={40}
              height={40}
              onError={(e) => {
                ;(e.target as HTMLImageElement).src = '/kalyan-hospital-crest.webp'
              }}
            />
            <div className={`min-w-0 ${isDesktopSidebar ? 'hidden lg:block' : 'block'}`}>
              <div className="truncate text-sm font-extrabold tracking-wide text-white" lang="hi">
                कल्याण हॉस्पीटल
              </div>
              <p className="truncate text-xs font-semibold text-rose-100/90 tracking-wider">
                KALYAN HOSPITAL
              </p>
              <p className="truncate text-xs text-amber-200 font-medium">
                {role === 'RECEPTION'
                  ? 'Reception & Registration'
                  : myDepartmentLabel || 'Clinical Consultation'}
              </p>
            </div>
          </div>
          {isDrawer && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Scrollable Navigation Items */}
        <nav
          aria-label="Primary navigation"
          className="flex-1 space-y-1 overflow-y-auto px-2 py-4 custom-scrollbar-dark"
        >
          {visibleItems.map((item, index) => {
            const href = navigationHref(item, role)
            const active = isNavigationItemActive(item, location.pathname, location.search, role)

            const sectionLabel =
              index === 1
                ? role === 'RECEPTION'
                  ? 'RECEPTION DESK'
                  : 'PATIENT & CLINICAL WORKFLOW'
                : item.sectionStart && item.sectionStart !== 'PATIENT & CLINICAL WORKFLOW'
                  ? item.sectionStart
                  : null

            const isSectionDivider =
              item.sectionStart && index > 1 && item.sectionStart !== visibleItems[index - 1]?.sectionStart

            return (
              <div key={item.key}>
                {isSectionDivider && (
                  <div className={`mx-2 mb-2 mt-3 border-t border-white/15 ${isDesktopSidebar ? 'hidden lg:block' : ''}`} />
                )}
                {sectionLabel && (
                  <div
                    className={`pb-1.5 pt-2.5 text-xs font-bold uppercase tracking-wider text-rose-200 ${isDesktopSidebar ? 'hidden lg:block px-3' : 'px-3'
                      }`}
                  >
                    {sectionLabel}
                  </div>
                )}
                <Link
                  to={href}
                  onClick={() => isDrawer && setMobileOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  title={item.description}
                  className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${isDesktopSidebar ? 'justify-center lg:justify-start' : 'justify-start'
                    } ${active
                      ? 'bg-white text-[#5D0B26] shadow-sm font-bold'
                      : 'text-rose-100 hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <NavIcon name={item.icon} />
                  <span className={`truncate ${isDesktopSidebar ? 'hidden lg:inline' : 'inline'}`}>
                    {item.label}
                  </span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-2 bottom-2 w-1.5 rounded-r bg-[#C39A35]"
                    />
                  )}
                </Link>
              </div>
            )
          })}
        </nav>

        {/* Sidebar Footer Context */}
        <div
          className={`border-t border-white/15 p-3 text-xs text-rose-100/80 shrink-0 ${isDesktopSidebar ? 'hidden lg:block' : 'block'
            }`}
        >
          <p className="font-semibold text-white">Local clinic network</p>
          <p className="mt-0.5 text-xs text-rose-200">Kalyan Hospital · v3.0 LAN</p>
        </div>
      </aside>
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden print:h-auto print:overflow-visible flex-col bg-[#F5F7FA] text-slate-900">
      {/* Top Banner Header */}
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
              src="/api/assets/active-logo"
              alt=""
              aria-hidden="true"
              className="hidden h-9 w-9 shrink-0 rounded-full border-2 border-[#C39A35] bg-white object-contain shadow-2xs sm:block"
              width={36}
              height={36}
              onError={(e) => {
                ;(e.target as HTMLImageElement).src = '/kalyan-hospital-crest.webp'
              }}
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
                {role === 'ADMIN' ? 'Administrator' : role === 'RECEPTION' ? 'Reception' : 'Doctor'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={logout.isPending}
              aria-label="Sign out"
              title="Sign out of hospital workspace"
              className="inline-flex min-h-11 min-w-11 sm:min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 text-xs font-bold text-slate-800 hover:border-[#8E1C3D] hover:text-[#5D0B26] hover:bg-rose-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-2xs"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 text-slate-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="hidden sm:inline">
                {logout.isPending ? 'Signing out…' : 'Sign out'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Persistent Body Container */}
      <div className="flex min-h-0 flex-1 overflow-hidden print:overflow-visible">
        {/* Desktop Single Primary Sidebar */}
        <div className="hidden md:flex h-full shrink-0 print:hidden">{renderSidebar()}</div>

        {/* Scrollable Main Content Workspace */}
        <main className="min-w-0 flex-1 overflow-y-auto print:overflow-visible px-4 py-5 sm:px-6 xl:px-8 flex flex-col justify-between">
          <div className="mx-auto w-full max-w-[1720px] space-y-5 flex-1">
            <Breadcrumbs pathname={location.pathname} role={role} />
            {children}
          </div>
          <footer className="mx-auto mt-8 flex w-full max-w-[1720px] flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3.5 pb-6 text-xs text-slate-600 font-medium shrink-0">
            <span>Kalyan Hospital · Local clinical workspace</span>
            <span>Patient information is available according to your role permissions.</span>
          </footer>
        </main>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          id="mobile-hospital-navigation"
          role="dialog"
          aria-modal="true"
          aria-label="Hospital workspace navigation"
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
