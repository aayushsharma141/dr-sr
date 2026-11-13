import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useClinicBranding } from '../api/branding'
import { useMyDepartments, type SpecialtyCode } from '../api/specialty'
import { Link, useLocation, useNavigate } from 'react-router'
import { useLatestIntegrityRun } from '../api/integrity'
import { useLogout } from '../api/queries'
import { useServerLink, type ServerLink } from '../api/serverStatus'
import { countBySeverity, groupFindings } from '../admin/integrity'
import type { Role } from '../api/types'
import {
  ADMIN_MODULE_GROUPS,
  adminModulesInGroup,
  findAdminModuleForPath,
} from '../admin/modules'
import {
  IconChevronDown,
  IconDatabase,
  IconHistory,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPrinter,
  IconReceipt,
  IconServer,
  IconSettings,
  IconShieldCheck,
  IconShieldLock,
  IconStethoscope,
  IconUserEdit,
  IconUsers,
  IconWallet,
} from './icons'

type SidebarIcon = typeof IconSettings

/** One icon per admin module so the collapsed (icon-only) rail stays readable. */
const ADMIN_MODULE_ICONS: Record<string, SidebarIcon> = {
  'hospital-settings': IconSettings,
  'print-templates': IconPrinter,
  'doctors-fees': IconStethoscope,
  'patient-correct': IconUserEdit,
  'billing-reversals': IconReceipt,
  'pending-dues': IconWallet,
  'user-accounts': IconUsers,
  'roles-matrix': IconKey,
  'security-sessions': IconShieldLock,
  'audit-trail': IconHistory,
  'backups-restore': IconDatabase,
  'data-integrity': IconShieldCheck,
  'system-health': IconServer,
}

/** How each server-link state reads in the sidebar (label), phone header (short) and tooltip (detail). */
const SERVER_LINK_VIEW: Record<ServerLink, { label: string; short: string; detail: string; tone: 'ok' | 'pending' | 'problem' }> = {
  connected: {
    label: 'LAN connected',
    short: 'LAN',
    detail: 'Central server and database answering',
    tone: 'ok',
  },
  checking: {
    label: 'Checking server…',
    short: 'Checking',
    detail: 'Contacting the central hospital server',
    tone: 'pending',
  },
  'database-down': {
    label: 'Database unavailable',
    short: 'DB down',
    detail: 'The central server answered but could not reach its database. Saving will fail until it is back.',
    tone: 'problem',
  },
  'server-unreachable': {
    label: 'Server unreachable',
    short: 'No server',
    detail: 'This workstation cannot reach the central hospital server. Check the LAN cable or the server PC.',
    tone: 'problem',
  },
  offline: {
    label: 'Offline',
    short: 'Offline',
    detail: 'This workstation has no network connection.',
    tone: 'problem',
  },
}

const SIDEBAR_COLLAPSED_KEY = 'kh.sidebar.collapsed'
const SIDEBAR_CLOSED_GROUPS_KEY = 'kh.sidebar.closedGroups'

/** Per-workstation sidebar preference; storage may be blocked, so failures fall back to the default. */
function readSidebarPref(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeSidebarPref(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked: the preference simply lasts for this page view.
  }
}

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
    key: 'doctor-settings',
    label: 'My Settings',
    description: 'Personal consultation fee and preferences',
    path: '/doctor/settings',
    icon: 'settings',
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
      /^\/reception\/patients\/\d+(?:\/print|\/edit)?$/.test(pathname)
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
  } else if (/^\/reception\/patients\/\d+\/edit$/.test(pathname)) {
    crumbs.push({ label: 'Patient Records', href: '/reception/patients' })
    crumbs.push({ label: 'Edit Patient' })
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
  } else if (pathname === '/doctor/settings') {
    crumbs.push({ label: 'My Settings' })
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readSidebarPref(SIDEBAR_COLLAPSED_KEY) === true)
  const [closedGroups, setClosedGroups] = useState<string[]>(() => {
    const stored = readSidebarPref(SIDEBAR_CLOSED_GROUPS_KEY)
    return Array.isArray(stored) ? stored.filter((g): g is string => typeof g === 'string') : []
  })
  const [now, setNow] = useState(() => new Date())
  // Green only when the central server answers and confirms its database (GET /api/health).
  const serverLink = useServerLink()
  const link = SERVER_LINK_VIEW[serverLink]
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const origOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const drawerEl = drawerRef.current
    const focusables = drawerEl?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (focusables && focusables.length > 0) {
      focusables[0].focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMobileOpen(false)
        mobileMenuButtonRef.current?.focus()
        return
      }
      if (e.key === 'Tab' && drawerEl && focusables && focusables.length > 0) {
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = origOverflow
      window.removeEventListener('keydown', handleKeyDown)
      mobileMenuButtonRef.current?.focus()
    }
  }, [mobileOpen])

  const clock = useMemo(() => formatClock(now), [now])
  const roleLabel = role === 'ADMIN' ? 'Administrator' : role === 'RECEPTION' ? 'Reception' : 'Doctor'

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

  /** Class sets for sidebar labels: the drawer always shows labels; the desktop rail hides them when collapsed. */
  const sidebarClasses = (isDrawer: boolean) => ({
    width: isDrawer ? 'w-72 max-w-[85vw] shadow-2xl' : sidebarCollapsed ? 'w-16 shrink-0' : 'w-16 lg:w-64 shrink-0',
    inline: isDrawer ? 'inline' : sidebarCollapsed ? 'hidden' : 'hidden lg:inline',
    block: isDrawer ? 'block' : sidebarCollapsed ? 'hidden' : 'hidden lg:block',
    justify: isDrawer ? 'justify-start' : sidebarCollapsed ? 'justify-center' : 'justify-center lg:justify-start',
    brand: isDrawer
      ? 'justify-between px-4'
      : sidebarCollapsed
        ? 'justify-center px-2'
        : 'justify-center px-2 lg:justify-start lg:gap-2 lg:px-3',
  })

  // Preferences are written only on an explicit toggle, so browser storage stays empty until staff choose a layout.
  const toggleAdminGroup = (groupId: string) => {
    const next = closedGroups.includes(groupId) ? closedGroups.filter((g) => g !== groupId) : [...closedGroups, groupId]
    setClosedGroups(next)
    writeSidebarPref(SIDEBAR_CLOSED_GROUPS_KEY, next)
  }

  const toggleSidebarCollapsed = () => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    writeSidebarPref(SIDEBAR_COLLAPSED_KEY, next)
  }

  /** Desktop-only icon button in the sidebar's top bar; folds the rail to icons and back. */
  const renderCollapseToggle = (isDrawer: boolean) => {
    if (isDrawer) return null
    const label = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
    return (
      <button
        type="button"
        onClick={toggleSidebarCollapsed}
        aria-label={label}
        aria-expanded={!sidebarCollapsed}
        title={label}
        className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-rose-100 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white lg:inline-flex ${sidebarCollapsed ? '' : 'ml-auto'}`}
      >
        {sidebarCollapsed ? (
          <IconLayoutSidebarLeftExpand size={20} aria-hidden="true" />
        ) : (
          <IconLayoutSidebarLeftCollapse size={20} aria-hidden="true" />
        )}
      </button>
    )
  }

  /** Central server status pinned to the foot of the sidebar; problems are announced to screen readers. */
  const renderConnectionStatus = (isDrawer: boolean) => {
    const iconOnly = !isDrawer && sidebarCollapsed
    const tone = link.tone === 'ok' ? 'bg-white/10 text-rose-50' : link.tone === 'pending' ? 'bg-white/10 text-rose-100' : 'bg-amber-100 text-amber-950'
    const dot = link.tone === 'ok' ? 'bg-emerald-400 animate-pulse' : link.tone === 'pending' ? 'bg-slate-300' : 'bg-amber-600'
    return (
      <div className="flex h-14 shrink-0 items-center border-t border-white/15 px-3">
        <div
          role={link.tone === 'problem' ? 'status' : undefined}
          aria-live={link.tone === 'problem' ? 'polite' : undefined}
          title={link.detail}
          className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${iconOnly ? 'justify-center' : ''} ${tone}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          <span className={iconOnly ? 'sr-only' : 'truncate'}>{link.label}</span>
        </div>
      </div>
    )
  }

  const renderAdminSidebar = (isDrawer = false) => {
    const cls = sidebarClasses(isDrawer)
    const iconOnly = !isDrawer && sidebarCollapsed
    const moduleActive = (path: string | undefined) =>
      path === '/admin'
        ? location.pathname === '/admin'
        : Boolean(path && (location.pathname === path || location.pathname.startsWith(`${path}/`)))
    return (
      <aside
        aria-label="Primary navigation"
        className={`flex h-full flex-col bg-[#5D0B26] text-white transition-all duration-200 ${cls.width}`}
      >
        {/* Sidebar Brand Header */}
        <div className={`flex min-h-[60px] sm:min-h-[64px] shrink-0 items-center border-b border-white/15 ${cls.brand}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-amber-300 border border-white/15 shadow-2xs ${!isDrawer && sidebarCollapsed ? 'hidden' : 'flex'}`}
              title="Administration Panel"
              aria-hidden="true"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className={`min-w-0 ${cls.block}`}>
              <p className="truncate text-xs font-bold uppercase tracking-wide text-amber-200">
                Control Console
              </p>
              <p className="truncate text-xs font-bold text-white">
                Administration Panel
              </p>
            </div>
          </div>
          {renderCollapseToggle(isDrawer)}
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
          className={`flex-1 overflow-y-auto py-4 custom-scrollbar-dark ${iconOnly ? 'space-y-2 px-2' : 'space-y-3 px-3'}`}
        >
          {/* Dashboard (Home) */}
          <Link
            to="/admin"
            onClick={() => isDrawer && setMobileOpen(false)}
            aria-current={location.pathname === '/admin' ? 'page' : undefined}
            title="Management Overview"
            className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${cls.justify} ${location.pathname === '/admin'
                ? 'bg-white text-[#5D0B26] font-bold shadow-sm'
                : 'text-rose-100 hover:bg-white/10 hover:text-white'
              }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className={cls.inline}>Overview</span>
            {location.pathname === '/admin' && (
              <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1.5 rounded-r bg-[#C39A35]" />
            )}
          </Link>

          {/* Five Canonical Admin Sections — each heading folds its group open or closed */}
          {ADMIN_MODULE_GROUPS.map((group) => {
            const modules = adminModulesInGroup(group.id)
            const holdsActive = modules.some((m) => moduleActive(m.canonicalPath))
            // The group holding the current page always stays open, so the active link is never hidden.
            const open = iconOnly || isDrawer || holdsActive || !closedGroups.includes(group.id)
            const listId = `${isDrawer ? 'drawer' : 'rail'}-admin-group-${group.id}`
            return (
              <div key={group.id} className="space-y-1">
                {iconOnly ? (
                  <div className="mx-2 border-t border-white/15" aria-hidden="true" />
                ) : (
                  <h3 className={cls.block}>
                    <button
                      type="button"
                      onClick={() => !isDrawer && toggleAdminGroup(group.id)}
                      aria-expanded={open}
                      aria-controls={listId}
                      disabled={isDrawer || holdsActive}
                      title={holdsActive ? `${group.label} (contains the current page)` : open ? `Collapse ${group.label}` : `Expand ${group.label}`}
                      className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-rose-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-rose-200"
                    >
                      <span>{group.navLabel}</span>
                      {!isDrawer && (
                        <IconChevronDown
                          size={16}
                          aria-hidden="true"
                          className={`shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'} ${holdsActive ? 'opacity-40' : ''}`}
                        />
                      )}
                    </button>
                  </h3>
                )}
                <div id={listId} className={`space-y-0.5 ${open ? '' : 'lg:hidden'}`}>
                  {modules.map((mod) => {
                    const active = moduleActive(mod.canonicalPath)
                    const ModIcon = ADMIN_MODULE_ICONS[mod.id] ?? IconSettings
                    return (
                      <Link
                        key={mod.id}
                        to={mod.canonicalPath!}
                        onClick={() => isDrawer && setMobileOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        title={mod.title}
                        className={`group relative flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${cls.justify} ${active
                            ? 'bg-white text-[#5D0B26] font-bold shadow-sm'
                            : 'text-rose-100 hover:bg-white/10 hover:text-white'
                          }`}
                      >
                        <ModIcon size={18} className="shrink-0" aria-hidden="true" />
                        <span className={`truncate ${cls.inline}`}>{mod.navLabel ?? mod.title}</span>
                        {mod.id === 'data-integrity' && integrityProblems > 0 && (
                          <span
                            className={`shrink-0 rounded-full bg-red-700 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white ${iconOnly ? 'absolute right-0.5 top-0.5' : `ml-auto ${cls.inline}`}`}
                          >
                            <span aria-hidden="true">{integrityProblems}</span>
                            <span className="sr-only">
                              , {integrityProblems} {integrityProblems === 1 ? 'problem' : 'problems'}
                            </span>
                          </span>
                        )}
                        {active && (
                          <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1.5 rounded-r bg-[#C39A35]" />
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {renderConnectionStatus(isDrawer)}
      </aside>
    )
  }

  const renderSidebar = (isDrawer = false) => {
    if (role === 'ADMIN') {
      return renderAdminSidebar(isDrawer)
    }
    const cls = sidebarClasses(isDrawer)
    return (
      <aside
        aria-label="Hospital workspace navigation"
        className={`flex h-full flex-col bg-[#5D0B26] text-white transition-all duration-200 ${cls.width}`}
      >
        {/* Sidebar Brand Header */}
        <div
          className={`flex min-h-[60px] sm:min-h-[64px] shrink-0 items-center border-b border-white/15 ${cls.brand}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-amber-300 border border-white/15 shadow-2xs ${!isDrawer && sidebarCollapsed ? 'hidden' : 'flex'}`}
              title={role === 'RECEPTION' ? 'Reception & Registration' : (myDepartmentLabel || 'Clinical Consultation')}
              aria-hidden="true"
            >
              {role === 'RECEPTION' ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              )}
            </div>
            <div className={`min-w-0 ${cls.block}`}>
              <p className="truncate text-xs font-bold uppercase tracking-wide text-amber-200">
                Workspace
              </p>
              <p className="truncate text-xs font-bold text-white">
                {role === 'RECEPTION'
                  ? 'Reception & Registration'
                  : myDepartmentLabel || 'Clinical Consultation'}
              </p>
            </div>
          </div>
          {renderCollapseToggle(isDrawer)}
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
                  <div className={`mx-2 mb-2 mt-3 border-t border-white/15 ${cls.block}`} />
                )}
                {sectionLabel && (
                  <div
                    className={`pb-1.5 pt-2.5 text-xs font-bold uppercase tracking-wider text-rose-200 ${cls.block} px-3`}
                  >
                    {sectionLabel}
                  </div>
                )}
                <Link
                  to={href}
                  onClick={() => isDrawer && setMobileOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  title={item.description}
                  className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${cls.justify} ${active
                      ? 'bg-white text-[#5D0B26] shadow-sm font-bold'
                      : 'text-rose-100 hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <NavIcon name={item.icon} />
                  <span className={`truncate ${cls.inline}`}>
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

        {renderConnectionStatus(isDrawer)}
      </aside>
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden print:h-auto print:overflow-visible flex-col bg-[#F5F7FA] text-slate-900">
      {/* Top Banner Header */}
      <header className="relative z-20 shrink-0 print:hidden border-b border-slate-200 bg-white shadow-2xs">
        {/* Bottom-left crimson accent line matching mockup */}
        <div className="absolute bottom-0 left-0 w-36 sm:w-44 h-[2.5px] bg-[#8E1C3D]" aria-hidden="true" />

        <div className="flex min-h-[50px] sm:min-h-[54px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
          {/* Left section: Crest | कल्याण हॉस्पिटल | श्री वशिष्ठ कल्याण ट्रस्ट */}
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-hospital-navigation"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-[#5D0B26] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] md:hidden"
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
              alt="Kalyan Hospital crest"
              className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-full border border-[#C39A35] bg-white object-contain shadow-2xs p-0.5"
              width={36}
              height={36}
              onError={(e) => {
                ;(e.target as HTMLImageElement).src = '/kalyan-hospital-crest.webp'
              }}
            />
            <div className="h-4 w-px bg-slate-300 shrink-0" aria-hidden="true" />
            <span
              className="truncate text-base sm:text-lg font-bold tracking-wide text-[#8E1C3D]"
              lang="hi"
            >
              {branding.hospitalNameHi || 'कल्याण हॉस्पिटल'}
            </span>
            <div className="hidden sm:block h-4 w-px bg-slate-300 shrink-0" aria-hidden="true" />
            <span
              className="hidden sm:inline truncate text-xs sm:text-sm font-semibold text-slate-800"
              lang="hi"
            >
              {branding.trustNameHi || 'श्री वशिष्ठ कल्याण ट्रस्ट'}
            </span>
          </div>

          {/* Right section: Location | Clock | LAN | User Pill | Sign Out */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Short location; the full address is on hover and on every printed letterhead. */}
            <div
              className="hidden xl:flex items-center gap-1.5 text-xs font-medium text-slate-600"
              title={branding.address || undefined}
            >
              <svg className="h-3.5 w-3.5 text-rose-700 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              <span className="truncate max-w-56">{branding.locationLine || branding.address}</span>
            </div>

            <div className="hidden xl:block h-4 w-px bg-slate-200 shrink-0" aria-hidden="true" />

            {/* Clock, icon in the same rose as the location pin */}
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <svg className="h-3.5 w-3.5 text-rose-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{clock}</span>
            </div>

            {/* LAN badge: phones only; from md up the sidebar shows connection status at its foot. */}
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-semibold border md:hidden ${
                link.tone === 'ok'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-300'
                  : link.tone === 'pending'
                    ? 'text-slate-700 bg-slate-50 border-slate-300'
                    : 'text-amber-900 bg-amber-50 border-amber-300'
              }`}
              role={link.tone === 'problem' ? 'status' : undefined}
              aria-live={link.tone === 'problem' ? 'polite' : undefined}
              title={link.detail}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${link.tone === 'ok' ? 'bg-emerald-500 animate-pulse' : link.tone === 'pending' ? 'bg-slate-400' : 'bg-amber-500'}`}
                aria-hidden="true"
              />
              {link.short}
            </span>

            <div className="hidden sm:block h-4 w-px bg-slate-200 shrink-0" aria-hidden="true" />

            {/* Signed-in staff identity: plain text, not a pill, so it doesn't read as a second button beside Sign out. */}
            <div className="hidden sm:flex items-center gap-2 text-xs" title={`Signed in as ${name}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-700" aria-hidden="true">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </span>
              <span className="leading-tight">
                <span className="block text-slate-600">Signed in · {roleLabel}</span>
                <span className="block max-w-44 truncate font-semibold text-slate-900">{name}</span>
              </span>
            </div>

            {/* Sign out button (preserves minimum 44px min-h-11 touch target) */}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={logout.isPending}
              aria-label="Sign out"
              title="Sign out of hospital workspace"
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-2xs"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 text-slate-600 shrink-0"
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

        {/* Content column: only the workspace scrolls; the footer stays fixed, level with the sidebar's status bar. */}
        <div className="flex min-w-0 flex-1 flex-col print:block">
          <main className="min-h-0 flex-1 overflow-y-auto print:overflow-visible px-4 pt-4 pb-6 sm:px-6 xl:px-8">
            <div className="mx-auto w-full max-w-[1720px] space-y-5">
              {children}
            </div>
          </main>
          <footer className="flex h-14 shrink-0 items-center border-t border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 sm:px-6 xl:px-8">
            <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between gap-2">
              <span className="truncate">Kalyan Hospital · Local clinical workspace</span>
              <span className="hidden truncate sm:inline">Patient information is available according to your role permissions.</span>
            </div>
          </footer>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          ref={drawerRef}
          id="mobile-hospital-navigation"
          role="dialog"
          aria-modal="true"
          aria-label="Hospital workspace navigation"
          className="fixed inset-0 z-50 flex md:hidden"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/60 transition-opacity duration-200"
            aria-label="Close navigation menu"
            onClick={() => {
              setMobileOpen(false)
              mobileMenuButtonRef.current?.focus()
            }}
          />
          <div className="relative z-10 h-full animate-in slide-in-from-left duration-200 ease-out">{renderSidebar(true)}</div>
        </div>
      )}
    </div>
  )
}
