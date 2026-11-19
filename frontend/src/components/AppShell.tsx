import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { sendHeartbeat } from '../api/admin-data-ops'
import { useClinicBranding } from '../api/branding'
import { useMyDepartments, type SpecialtyCode } from '../api/specialty'
import { useMyUnfinishedConsultations, useMyWaitingQueueCount } from '../api/consultations'
import { Link, useLocation, useNavigate } from 'react-router'
import { useLatestIntegrityRun } from '../api/integrity'
import { useLogout } from '../api/queries'
import { EmergencyAlertBanner } from './EmergencyAlertBanner'
import { GlobalSearchBar } from './GlobalSearchBar'
import { LANStatusPill } from './LANStatusPill'
import { countBySeverity, groupFindings } from '../admin/integrity'
import type { Role } from '../api/types'
import {
  ADMIN_MODULE_GROUPS,
  adminModulesInGroup,
  findAdminModuleForPath,
} from '../admin/modules'
import {
  IconArchive,
  IconBuildingHospital,
  IconChevronDown,
  IconDashboard,
  IconDatabase,
  IconDeviceDesktop,
  IconGitMerge,
  IconHistory,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPrinter,
  IconReceipt,
  IconReportAnalytics,
  IconReportMedical,
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
  overview: IconDashboard,
  'hospital-settings': IconSettings,
  'print-templates': IconPrinter,
  'doctors-fees': IconStethoscope,
  departments: IconBuildingHospital,
  'patient-records': IconReportMedical,
  'patient-correct': IconUserEdit,
  'referral-report': IconReportAnalytics,
  'patient-duplicates': IconGitMerge,
  'patient-archive': IconArchive,
  'billing-reversals': IconReceipt,
  'pending-dues': IconWallet,
  'user-accounts': IconUsers,
  'roles-matrix': IconKey,
  'security-sessions': IconShieldLock,
  'audit-trail': IconHistory,
  'backups-restore': IconDatabase,
  'data-integrity': IconShieldCheck,
  workstations: IconDeviceDesktop,
  'system-health': IconServer,
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
  | 'home'
  | 'queue'
  | 'user-plus'
  | 'ticket'
  | 'folder'
  | 'activity'
  | 'calendar'
  | 'calendar-check'
  | 'rupee'
  | 'consultation'
  | 'settings'
  | 'receipt'
  | 'report'

interface NavigationItem {
  key: string
  label: string
  description: string
  /** Shown to a doctor only when they belong to this department; fail closed until departments load. */
  specialty?: SpecialtyCode
  path: string
  icon: NavigationIcon
}

/*
 * One menu per role, in the order of the working day. Each job has exactly one tab, and each
 * tab's label is the title of the page it opens. The Administrator's menu is the module
 * registry in admin/modules.ts, rendered by renderAdminSidebar.
 */
// Reception order: Dashboard -> Appointments -> Waiting Room -> Billing & Checkout -> Patient Records.
// The full registration form opens from Appointments and Patient Records.
const RECEPTION_NAVIGATION: NavigationItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: "Today's overview: the queue, doctor workload and what needs attention",
    path: '/reception',
    icon: 'dashboard',
  },
  {
    key: 'appointments',
    label: 'Appointments',
    description: 'Check in patients, issue OPD tokens, and manage bookings by date and doctor',
    path: '/reception/appointments',
    icon: 'calendar',
  },
  {
    key: 'waiting-room',
    label: 'Waiting Room',
    description: 'Today’s queue by doctor: order the waiting patients, reassign or cancel a waiting consultation',
    path: '/reception/waiting',
    icon: 'activity',
  },
  {
    key: 'billing',
    label: 'Billing & Checkout',
    description: 'Counter checkout, visit payments, receipts desk, pending dues and daily closing report',
    path: '/reception/billing',
    icon: 'rupee',
  },
  {
    key: 'patient-records',
    label: 'Patient Records',
    description: 'Search, view, edit and print patient records; full registration form',
    path: '/reception/patients',
    icon: 'folder',
  },
]

const DOCTOR_NAVIGATION: NavigationItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: "Operational overview, daily workload, and treatment plans",
    path: '/doctor',
    icon: 'home',
  },
  {
    key: 'my-queue',
    label: 'My Queue',
    description: 'Your patients for today: call the next one and start the consultation',
    path: '/doctor/queue',
    icon: 'queue',
  },
  {
    // Shown only while a consultation is open or one is left unfinished; see visibleItems.
    key: 'consultation',
    label: 'Continue Consultation',
    description: 'Return to the consultation you have open or left unfinished',
    path: '/doctor/encounters',
    icon: 'consultation',
  },
  {
    key: 'followups',
    label: 'Follow-ups',
    description: 'Return dates recorded on your prescriptions',
    path: '/reception/appointments?tab=followup',
    icon: 'calendar-check',
  },
  {
    key: 'physiotherapy',
    label: 'Physiotherapy Treatment',
    description: 'Treatment packages and session records',
    path: '/doctor/treatment-plans',
    icon: 'activity',
    specialty: 'PHYSIOTHERAPY',
  },
  {
    key: 'patient-records',
    label: 'Patient Records',
    description: 'Search and view patient records',
    path: '/reception/patients',
    icon: 'folder',
  },
  {
    key: 'doctor-settings',
    label: 'My Settings',
    description: 'Consultation fee, pace, and prescription letterhead',
    path: '/doctor/settings',
    icon: 'settings',
  },
]

function dashboardPath(role: Role) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'DOCTOR') return '/doctor'
  return '/reception'
}

/** True when the page at `pathname` belongs to this sidebar item. */
function isNavigationItemActive(item: NavigationItem, pathname: string) {
  switch (item.key) {
    case 'dashboard':
      return pathname === item.path
    case 'my-queue':
      // A prescription is written from a patient in the queue.
      return pathname === item.path || pathname.startsWith('/doctor/prescriptions/')
    case 'patient-records':
      // The full registration form opens from Patient Records (and from Appointments).
      // The role-neutral Visit Workspace (/patients/:id/visits/:visitId) also belongs here.
      return (
        pathname === '/reception/patients' ||
        pathname === '/reception/patients/new' ||
        /^\/reception\/patients\/\d+(?:\/print|\/edit)?$/.test(pathname) ||
        /^\/patients\/\d+\/visits\/\d+$/.test(pathname)
      )
    case 'appointments':
    case 'followups':
      // Reception uses Appointments as the unified check-in & booking workspace; a doctor sees Follow-ups.
      return pathname === '/reception/appointments'
    case 'billing':
      // Reception financial desk includes checkout, receipts and daily reports.
      return (
        pathname === '/reception/billing' ||
        pathname === '/reception/receipts' ||
        pathname === '/reception/reports'
      )
    default: {
      const base = item.path.split('?')[0]
      return pathname === base || pathname.startsWith(`${base}/`)
    }
  }
}

function NavIcon({ name, active = false }: { name: NavigationIcon; active?: boolean }) {
  const shared = {
    className: `h-5 w-5 shrink-0 ${active ? 'text-white' : 'text-white/75 group-hover:text-white'}`.trim(),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (name) {
    case 'home':
      return (
        <svg {...shared}>
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      )
    case 'queue':
      return (
        <svg {...shared}>
          <circle cx="7" cy="7" r="2.5" />
          <circle cx="17" cy="7" r="2.5" />
          <circle cx="7" cy="17" r="2.5" />
          <circle cx="17" cy="17" r="2.5" />
        </svg>
      )
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
    case 'consultation':
      return (
        <svg {...shared}>
          <path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="2" width="6" height="4" rx="1" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="13" y2="16" />
        </svg>
      )
    case 'receipt':
      return (
        <svg {...shared}>
          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
          <path d="M14 8H8" />
          <path d="M16 12H8" />
          <path d="M13 16H8" />
        </svg>
      )
    case 'report':
      return (
        <svg {...shared}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
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
function breadcrumbsFor(pathname: string, search: string, role: Role): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: dashboardPath(role) }]

  if (pathname === '/reception/patients/new') {
    crumbs.push({ label: 'Patient Registration' })
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
  } else if (/^\/patients\/\d+\/visits\/\d+$/.test(pathname)) {
    const patientId = pathname.split('/')[2]
    crumbs.push({ label: 'Patient Records', href: '/reception/patients' })
    crumbs.push({ label: 'Patient Profile', href: `/reception/patients/${patientId}` })
    crumbs.push({ label: 'Visit Workspace' })
  } else if (pathname === '/reception/appointments') {
    // Same tab rule as the page: a doctor sees Follow-ups unless they chose Schedule.
    const tab = new URLSearchParams(search).get('tab')
    crumbs.push({ label: role === 'DOCTOR' ? (tab === 'today' ? 'Schedule' : 'Follow-ups') : 'Appointments' })
  } else if (pathname === '/reception/waiting') {
    crumbs.push({ label: 'Waiting Room' })
  } else if (pathname === '/reception/billing') {
    crumbs.push({ label: 'Billing & Checkout' })
  } else if (pathname === '/reception/receipts') {
    crumbs.push({ label: 'Billing & Checkout', href: '/reception/billing' })
    crumbs.push({ label: 'Receipts Desk' })
  } else if (pathname === '/reception/reports') {
    crumbs.push({ label: 'Billing & Checkout', href: '/reception/billing' })
    crumbs.push({ label: 'Daily Report' })
  } else if (pathname === '/doctor/queue') {
    crumbs.push({ label: 'My Queue' })
  } else if (pathname === '/doctor/treatment-plans' || /^\/doctor\/treatment-plans\/\d+$/.test(pathname)) {
    crumbs.push({ label: 'Physiotherapy Treatment' })
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
    const crumbs = breadcrumbsFor(location.pathname, location.search, role)
    const page = crumbs[crumbs.length - 1].label
    document.title = `${page} – Kalyan Hospital`
  }, [location.pathname, location.search, role])

  // Phase 23: Periodic 30s LAN workstation heartbeat
  useEffect(() => {
    if (typeof window === 'undefined' || import.meta.env.MODE === 'test') return

    const sendPing = () => {
      let wsId = ''
      try {
        wsId = localStorage.getItem('kalyan_workstation_id') || ''
        if (!wsId) {
          wsId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
          localStorage.setItem('kalyan_workstation_id', wsId)
        }
      } catch {
        wsId = 'term'
      }

      sendHeartbeat({
        hostname: `ws-${wsId}-${role.toLowerCase()}`,
        terminal_name: `${roleLabel} (${wsId})`,
        app_version: '3.0.0',
      }).catch(() => {
        // Non-blocking in offline / network disconnected conditions
      })
    }

    sendPing()
    const timer = setInterval(sendPing, 30000)
    return () => clearInterval(timer)
  }, [role, roleLabel])

  // A doctor's open consultation, or the newest one left unfinished, gets its own sidebar link.
  const unfinishedConsultations = useMyUnfinishedConsultations(role === 'DOCTOR')
  const waitingCount = useMyWaitingQueueCount(role === 'DOCTOR')
  const onConsultationPage = location.pathname.startsWith('/doctor/encounters/')

  const visibleItems = useMemo(() => {
    const codes = new Set(myDepartments.map((d) => d.code))
    const menu = role === 'DOCTOR' ? DOCTOR_NAVIGATION : RECEPTION_NAVIGATION
    return menu.filter((item) => {
      if (item.key === 'consultation') return onConsultationPage || unfinishedConsultations.length > 0
      // Fail closed: specialty items appear only when the doctor's department assignment confirms them.
      return !item.specialty || codes.has(item.specialty)
    })
  }, [role, myDepartments, onConsultationPage, unfinishedConsultations.length])

  const navigationHref = (item: NavigationItem) => {
    if (item.key !== 'consultation') return item.path
    if (onConsultationPage) return `${location.pathname}${location.search}`
    return `/doctor/encounters/${unfinishedConsultations[0].id}`
  }

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
    inline: isDrawer ? 'inline' : sidebarCollapsed ? 'sr-only' : 'sr-only lg:not-sr-only lg:inline',
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
        className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 lg:inline-flex ${sidebarCollapsed ? '' : 'ml-auto'}`}
      >
        {sidebarCollapsed ? (
          <IconLayoutSidebarLeftExpand size={20} aria-hidden="true" />
        ) : (
          <IconLayoutSidebarLeftCollapse size={20} aria-hidden="true" />
        )}
      </button>
    )
  }

  const renderSidebarFooter = (isDrawer: boolean) => {
    const iconOnly = !isDrawer && sidebarCollapsed
    const isAccountActive = location.pathname === '/account'
    return (
      <div className="shrink-0 border-t border-white/10 bg-black/15">
        <div className="p-2">
          <Link
            to="/account"
            onClick={() => isDrawer && setMobileOpen(false)}
            aria-current={isAccountActive ? 'page' : undefined}
            title="My account · Profile, password, sessions"
            className={`group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold leading-snug tracking-[0.01em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 ${iconOnly ? 'justify-center' : ''
              } ${isAccountActive
                ? 'bg-white/15 text-white border-l-[3px] border-gold-400 font-semibold'
                : 'text-white/85 hover:bg-white/10 hover:text-white'
              }`}
          >
            <svg className={`h-4 w-4 shrink-0 ${isAccountActive ? 'text-white' : 'text-white/75 group-hover:text-white'}`.trim()} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className={iconOnly ? 'sr-only' : 'truncate'}>My account</span>
          </Link>
        </div>
      </div>
    )
  }

  const renderAdminSidebar = (isDrawer = false) => {
    const cls = sidebarClasses(isDrawer)
    const iconOnly = !isDrawer && sidebarCollapsed
    // A module path may carry a tab (Dues opens /reception/billing?tab=dues); the page decides the match.
    const moduleActive = (path: string | undefined) => {
      if (!path) return false
      const base = path.split('?')[0]
      if (base === '/admin') return location.pathname === '/admin'
      if (base === '/reception/patients' && /^\/patients\/\d+\/visits\/\d+$/.test(location.pathname)) {
        return true
      }
      return location.pathname === base || location.pathname.startsWith(`${base}/`)
    }
    return (
      <aside
        aria-label="Administrative navigation"
        className={`flex h-full flex-col bg-brand-900 border-r border-brand-900 text-white transition-all duration-200 ${cls.width}`}
      >
        {/* Sidebar Brand Header */}
        <div className={`flex min-h-[60px] sm:min-h-[64px] shrink-0 items-center border-b border-white/10 ${cls.brand}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-400 border border-white/15 shadow-2xs ${!isDrawer && sidebarCollapsed ? 'hidden' : 'flex'}`}
              title="Administration Panel"
              aria-hidden="true"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className={`min-w-0 ${cls.block}`}>
              <p className="truncate text-xs font-medium leading-tight tracking-wide text-white/80">
                Control Console
              </p>
              <p className="truncate text-sm font-bold leading-tight tracking-tight text-white">
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 text-sm leading-none text-white/85 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
            >
              ✕
            </button>
          )}
        </div>

        {/* Scrollable Navigation Items */}
        <nav
          aria-label="Primary navigation"
          className={`custom-scrollbar-dark flex-1 overflow-y-auto py-4 ${iconOnly ? 'space-y-2 px-2' : 'space-y-4 px-3'}`}
        >
          {/* Dashboard (Home) */}
          <Link
            to="/admin"
            onClick={() => isDrawer && setMobileOpen(false)}
            aria-current={location.pathname === '/admin' ? 'page' : undefined}
            title="Management Overview"
            className={`group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold leading-snug tracking-[0.01em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 ${cls.justify} ${location.pathname === '/admin'
              ? 'bg-white/15 text-white border-l-[3px] border-gold-400 font-semibold'
              : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
          >
            <svg className={`h-4 w-4 shrink-0 ${location.pathname === '/admin' ? 'text-white' : 'text-white/75 group-hover:text-white'}`.trim()} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className={cls.inline}>Overview</span>
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
                      className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-white/75"
                    >
                      <span className="truncate">{group.navLabel}</span>
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
                        className={`group relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium leading-snug tracking-[0.01em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 ${cls.justify} ${active
                          ? 'bg-white/15 text-white border-l-[3px] border-gold-400 font-semibold'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                      >
                        <ModIcon size={18} className={`shrink-0 ${active ? 'text-white' : 'text-white/75 group-hover:text-white'}`.trim()} aria-hidden="true" />
                        <span className={`truncate ${cls.inline}`}>{mod.navLabel ?? mod.title}</span>
                        {mod.id === 'data-integrity' && integrityProblems > 0 && (
                          <span
                            className={`inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-red-100 ring-1 ring-red-300/80 px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums text-red-900 ${iconOnly ? 'absolute right-0.5 top-0.5' : `ml-auto ${cls.inline}`}`}
                          >
                            <span aria-hidden="true">{integrityProblems}</span>
                            <span className="sr-only">
                              , {integrityProblems} {integrityProblems === 1 ? 'problem' : 'problems'}
                            </span>
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {renderSidebarFooter(isDrawer)}
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
        className={`flex h-full flex-col bg-brand-900 border-r border-brand-900 text-white transition-all duration-200 ${cls.width}`}
      >
        {/* Sidebar Brand Header */}
        <div
          className={`flex min-h-[60px] sm:min-h-[64px] shrink-0 items-center border-b border-white/10 ${cls.brand}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-400 border border-white/15 shadow-2xs ${!isDrawer && sidebarCollapsed ? 'hidden' : 'flex'}`}
              title={role === 'RECEPTION' ? 'Reception Desk' : (myDepartmentLabel || 'Clinical Consultation')}
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
              {role !== 'RECEPTION' && (
                <p className="truncate text-xs font-medium leading-tight tracking-wide text-white/80">
                  Workspace
                </p>
              )}
              <p className="truncate text-sm font-bold leading-tight tracking-tight text-white">
                {role === 'RECEPTION'
                  ? 'Reception Desk'
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 text-sm leading-none text-white/85 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
            >
              ✕
            </button>
          )}
        </div>

        {/* Scrollable Navigation Items */}
        <nav
          aria-label="Primary navigation"
          className="custom-scrollbar-dark flex-1 space-y-1 overflow-y-auto px-2.5 py-4"
        >
          {visibleItems.map((item, index) => {
            const href = navigationHref(item)
            const active = isNavigationItemActive(item, location.pathname)
            // Reception's header already says "Reception Desk", so items start cleanly at the top.
            // A doctor's first item is home; the rest follow the day's work under one heading.
            const sectionLabel =
              role === 'RECEPTION'
                ? null
                : index === 1
                  ? 'Clinical workflow'
                  : null
            const draftCount = item.key === 'consultation' ? unfinishedConsultations.length : 0
            const queueCount = item.key === 'my-queue' ? waitingCount : 0
            const iconOnly = !isDrawer && sidebarCollapsed

            return (
              <div key={item.key}>
                {sectionLabel && (
                  <div
                    className={`pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wider text-white/75 ${cls.block} px-3`}
                  >
                    {sectionLabel}
                  </div>
                )}
                <Link
                  to={href}
                  onClick={() => isDrawer && setMobileOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  title={item.description}
                  className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold leading-snug tracking-[0.01em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 ${cls.justify} ${active
                    ? 'bg-white/15 text-white border-l-[3px] border-gold-400 font-semibold'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <NavIcon name={item.icon} active={active} />
                  <span className={`truncate ${cls.inline}`}>
                    {item.label}
                  </span>
                  {queueCount > 0 && (
                    <span
                      title={`${queueCount} patients waiting in queue`}
                      className={`inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-300/80 px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums text-amber-950 ${iconOnly ? 'absolute right-0.5 top-0.5' : `ml-auto ${cls.inline}`}`}
                    >
                      <span aria-hidden="true">{queueCount}</span>
                      <span className="sr-only">, {queueCount} waiting</span>
                    </span>
                  )}
                  {draftCount > 1 && (
                    <span
                      title={`${draftCount} unfinished consultations; this opens the newest. All of them are listed on My Queue.`}
                      className={`inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-300/80 px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums text-amber-950 ${iconOnly ? 'absolute right-0.5 top-0.5' : `ml-auto ${cls.inline}`}`}
                    >
                      <span aria-hidden="true">{draftCount}</span>
                      <span className="sr-only">, {draftCount} unfinished</span>
                    </span>
                  )}
                </Link>
              </div>
            )
          })}
        </nav>

        {renderSidebarFooter(isDrawer)}
      </aside>
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden print:h-auto print:overflow-visible flex-col bg-[#F4F6F9] text-slate-900">
      {/* Top Banner Header */}
      <header className="relative z-20 shrink-0 print:hidden border-t-2 border-t-brand-700 border-b border-b-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="flex min-h-[54px] sm:min-h-[58px] items-center justify-between gap-2.5 px-3 py-2 sm:gap-4 sm:px-6">
          {/* Left section: Crest | कल्याण हॉस्पिटल | श्री वशिष्ठ कल्याण ट्रस्ट */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-hospital-navigation"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 md:hidden"
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
              className="h-7 w-7 sm:h-9 sm:w-9 shrink-0 rounded-full border border-slate-200 bg-white object-contain shadow-2xs p-0.5"
              width={36}
              height={36}
              onError={(e) => {
                ; (e.target as HTMLImageElement).src = '/kalyan-hospital-crest.webp'
              }}
            />
            <div className="hidden sm:block h-4 w-px bg-slate-300 shrink-0" aria-hidden="true" />
            <span
              className="truncate text-sm sm:text-lg font-bold leading-tight tracking-tight text-brand-800"
              lang="hi"
            >
              {branding.hospitalNameHi || 'कल्याण हॉस्पिटल'}
            </span>
            <div className="hidden sm:block h-4 w-px bg-slate-300 shrink-0" aria-hidden="true" />
            <span
              className="hidden sm:inline truncate text-xs sm:text-sm font-semibold leading-tight text-slate-800"
              lang="hi"
            >
              {branding.trustNameHi || 'श्री वशिष्ठ कल्याण ट्रस्ट'}
            </span>
          </div>

          {/* Middle section: Global search across all tabs */}
          <div className="flex-1 max-w-md xl:max-w-xl mx-2 sm:mx-6 hidden sm:block">
            <GlobalSearchBar />
          </div>

          {/* Right section: Location | Clock | LAN | User Pill | Sign Out */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Short location; the full address is on hover and on every printed letterhead. */}
            <div
              className="hidden xl:flex items-center gap-1.5 text-xs font-medium text-slate-600"
              title={branding.address || undefined}
            >
              <svg className="h-3.5 w-3.5 text-brand-700 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              <span className="truncate max-w-56">{branding.locationLine || branding.address}</span>
            </div>

            <div className="hidden xl:block h-4 w-px bg-slate-200 shrink-0" aria-hidden="true" />

            {/* Clock, icon in the same maroon as the location pin */}
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <svg className="h-3.5 w-3.5 text-brand-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="tabular-nums whitespace-nowrap">{clock}</span>
            </div>

            <div className="hidden sm:block h-4 w-px bg-slate-200 shrink-0" aria-hidden="true" />

            {/* LAN status pill visible across all screens (OD-F option-b) */}
            <LANStatusPill />

            <div className="hidden sm:block h-4 w-px bg-slate-200 shrink-0" aria-hidden="true" />

            {/* Signed-in staff identity: links to My account */}
            <Link
              to="/account"
              className="hidden sm:flex min-h-9 items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-slate-50"
              title={`My account · Signed in as ${name}`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 border border-brand-200 font-bold" aria-hidden="true">
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </span>
              <span className="leading-snug">
                <span className="block text-slate-600">Signed in · {roleLabel}</span>
                <span className="block max-w-44 truncate font-semibold tracking-tight text-slate-900">{name}</span>
              </span>
            </Link>

            {/* Sign out button (preserves minimum 44px min-h-11 touch target) */}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={logout.isPending}
              aria-label="Sign out"
              title="Sign out of hospital workspace"
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-brand-700 hover:text-brand-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-2xs"
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
              {role === 'DOCTOR' && <EmergencyAlertBanner />}
              {children}
            </div>
          </main>
          <footer className="flex h-14 shrink-0 items-center border-t border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 sm:px-6 xl:px-8">
            <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between gap-2">
              <span className="truncate"><span className="font-semibold text-brand-800">Kalyan Hospital</span> · Local clinical workspace</span>
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
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px] transition-opacity duration-200"
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
