/**
 * Admin module registry: the single source of truth for the admin sub-navigation, the AppShell
 * admin navigation entries, admin breadcrumbs and the administration dashboard module cards.
 *
 * Status meanings:
 * - 'available': the module has its own page(s) covering its scope.
 * - 'partial':   the module's settings live on other modules' pages, or part of its scope
 *                is not built yet.
 * - 'fixed':     no page; the behaviour is fixed by a requirement until the client decides.
 *                Fixed modules are never shown in the navigation.
 */

export type AdminModuleGroup = 'hospital' | 'system'
export type AdminModuleStatus = 'available' | 'partial' | 'fixed'

export interface AdminModuleLink {
  label: string
  path: string
}

export interface AdminModule {
  id: string
  /** Two-digit display number, '01'..'12'. */
  number: string
  title: string
  description: string
  group: AdminModuleGroup
  status: AdminModuleStatus
  /** Why a module is 'fixed' or 'partial'; shown on dashboard cards. */
  statusReason?: string
  links: AdminModuleLink[]
}

export interface AdminModuleGroupInfo {
  id: AdminModuleGroup
  label: string
}

export const ADMIN_MODULE_GROUPS: readonly AdminModuleGroupInfo[] = [
  { id: 'hospital', label: 'Hospital Administration' },
  { id: 'system', label: 'System Administration' },
]

export const ADMIN_MODULES: readonly AdminModule[] = [
  {
    id: 'dashboard',
    number: '01',
    title: 'Administration Dashboard',
    description: "Today's activity, alerts and the state of every administration module",
    group: 'hospital',
    status: 'available',
    links: [{ label: 'Administration Dashboard', path: '/admin' }],
  },
  {
    id: 'user-authority',
    number: '02',
    title: 'User & Authority',
    description: 'Staff accounts, account actions and the fixed role permission matrix',
    group: 'system',
    status: 'available',
    links: [
      { label: 'User accounts', path: '/admin/users' },
      { label: 'Roles & permissions', path: '/admin/roles' },
    ],
  },
  {
    id: 'hospital-configuration',
    number: '03',
    title: 'Hospital Configuration',
    description: 'Clinic identity, address, contact details and consultation validity',
    group: 'hospital',
    status: 'available',
    links: [{ label: 'Clinic settings', path: '/admin/settings' }],
  },
  {
    id: 'doctor-clinical',
    number: '04',
    title: 'Doctor & Clinical Configuration',
    description: 'Doctor records, registration details and consultation fee schedules',
    group: 'hospital',
    status: 'available',
    links: [{ label: 'Doctors & fees', path: '/admin/doctors' }],
  },
  {
    id: 'appointment-workflow',
    number: '05',
    title: 'Appointment & Workflow Settings',
    description: 'Token queue and appointment workflow rules',
    group: 'hospital',
    status: 'fixed',
    statusReason: 'Fixed by requirement APT-02; configuration awaits client decision',
    links: [],
  },
  {
    id: 'billing-financial',
    number: '06',
    title: 'Billing & Financial',
    description: 'Receipt numbering, payment reversals, consultation fees and outstanding dues',
    group: 'hospital',
    status: 'partial',
    statusReason: 'Payment methods and receipt format are fixed until the client decides',
    links: [
      { label: 'Billing & reversals', path: '/admin/billing' },
      { label: 'Consultation fees', path: '/admin/doctors' },
      { label: 'Receipt numbering cycle', path: '/admin/settings' },
      { label: 'Pending dues', path: '/reception/dues' },
    ],
  },
  {
    id: 'physiotherapy',
    number: '07',
    title: 'Physiotherapy Configuration',
    description: 'Pain scale and treatment catalogue',
    group: 'hospital',
    status: 'fixed',
    statusReason:
      'VAS 0-10 pain scale fixed by requirement; treatment catalogue awaits client decision',
    links: [],
  },
  {
    id: 'prescription-print',
    number: '08',
    title: 'Prescription & Print',
    description: 'Header and footer text printed on prescriptions and receipts',
    group: 'hospital',
    status: 'partial',
    statusReason: 'Print header and footer are edited on the Clinic settings page',
    links: [{ label: 'Print header & footer', path: '/admin/settings' }],
  },
  {
    id: 'security-access',
    number: '09',
    title: 'Security & Access',
    description: 'Active sessions, session revocation and the effective security policy',
    group: 'system',
    status: 'available',
    links: [{ label: 'Security & access', path: '/admin/security' }],
  },
  {
    id: 'audit-compliance',
    number: '10',
    title: 'Audit & Compliance',
    description: 'Search the immutable audit trail of security and operational events',
    group: 'system',
    status: 'available',
    links: [{ label: 'Audit log viewer', path: '/admin/audit' }],
  },
  {
    id: 'backup-data',
    number: '11',
    title: 'Backup, Restore & Data',
    description: 'Backup archives, verified restore and data integrity checks',
    group: 'system',
    status: 'available',
    links: [
      { label: 'Backup & restore', path: '/admin/backups' },
      { label: 'Data integrity', path: '/admin/integrity' },
    ],
  },
  {
    id: 'system-health',
    number: '12',
    title: 'System Health & Maintenance',
    description: 'Server version, database revision, uptime and storage capacity',
    group: 'system',
    status: 'available',
    links: [{ label: 'System health', path: '/admin/system' }],
  },
]

/** Modules shown in navigation: every module with at least one page, never 'fixed' ones. */
export function navigableAdminModules(group?: AdminModuleGroup): AdminModule[] {
  return ADMIN_MODULES.filter(
    (m) => m.status !== 'fixed' && m.links.length > 0 && (group === undefined || m.group === group),
  )
}

export function adminModulesInGroup(group: AdminModuleGroup): AdminModule[] {
  return ADMIN_MODULES.filter((m) => m.group === group)
}

function pathMatches(linkPath: string, pathname: string): boolean {
  if (linkPath === '/admin') return pathname === '/admin'
  return pathname === linkPath || pathname.startsWith(`${linkPath}/`)
}

export interface AdminModuleMatch {
  module: AdminModule
  link: AdminModuleLink
}

/**
 * The module that OWNS a page: the first navigable module (registry order) listing it.
 * Pages are listed by several modules (for example /admin/settings appears in 03, 06 and 08);
 * only the owner marks itself current, so exactly one nav entry is active per page.
 */
export function findAdminModuleForPath(pathname: string): AdminModuleMatch | null {
  for (const module of navigableAdminModules()) {
    const link = module.links.find((l) => pathMatches(l.path, pathname))
    if (link) return { module, link }
  }
  return null
}

/** True when `link` of `module` is the owning entry for `pathname`. */
export function isOwningAdminLink(
  module: AdminModule,
  link: AdminModuleLink,
  pathname: string,
): boolean {
  const match = findAdminModuleForPath(pathname)
  return match !== null && match.module.id === module.id && match.link.path === link.path
}

/** Paths this module owns (it is the first module listing them). */
export function ownedAdminPaths(module: AdminModule): string[] {
  return module.links
    .map((l) => l.path)
    .filter((path) => findAdminModuleForPath(path)?.module.id === module.id)
}
