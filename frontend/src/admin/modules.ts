/**
 * Single source of truth for the Administration module registry.
 * Drives Administration dashboard cards, route mappings, status notices,
 * and canonical permissions.
 */

export type AdminModuleGroup = 'hospital' | 'system'
export type AdminModuleStatus = 'available' | 'partial' | 'fixed'

export interface AdminModuleAction {
  label: string
  path: string
}

export interface AdminModule {
  id: string
  title: string
  description: string
  group: AdminModuleGroup
  canonicalPath?: string
  requiredPermission?: string
  displayOrder: number
  status: AdminModuleStatus
  statusReason?: string
  actions: AdminModuleAction[]
  /** Backwards compatibility alias for actions (optional) */
  links?: AdminModuleAction[]
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
  // --- Hospital Administration ---
  {
    id: 'hospital-configuration',
    title: 'Hospital Configuration',
    description: 'Clinic identity, address, contact details and consultation validity',
    group: 'hospital',
    canonicalPath: '/admin/settings',
    requiredPermission: 'settings:read',
    displayOrder: 1,
    status: 'available',
    actions: [{ label: 'Clinic settings', path: '/admin/settings' }],
  },
  {
    id: 'doctor-clinical',
    title: 'Doctor & Clinical Configuration',
    description: 'Doctor records, registration details and consultation fee schedules',
    group: 'hospital',
    canonicalPath: '/admin/doctors',
    requiredPermission: 'doctors:read',
    displayOrder: 2,
    status: 'available',
    actions: [{ label: 'Doctors & fees', path: '/admin/doctors' }],
  },
  {
    id: 'billing-financial',
    title: 'Billing & Financial',
    description: 'Receipt numbering, payment reversals, consultation fees and outstanding dues',
    group: 'hospital',
    canonicalPath: '/admin/billing',
    requiredPermission: 'billing:read',
    displayOrder: 3,
    status: 'available',
    actions: [
      { label: 'Billing & reversals', path: '/admin/billing' },
      { label: 'Pending dues', path: '/reception/dues' },
    ],
  },
  {
    id: 'appointment-workflow',
    title: 'Appointment & Workflow Settings',
    description: 'Token queue and appointment workflow rules',
    group: 'hospital',
    displayOrder: 4,
    status: 'fixed',
    statusReason: 'Fixed by requirement APT-02; configuration awaits client decision',
    actions: [],
  },
  {
    id: 'physiotherapy',
    title: 'Physiotherapy Configuration',
    description: 'Pain scale and treatment catalogue',
    group: 'hospital',
    displayOrder: 5,
    status: 'fixed',
    statusReason: 'VAS 0-10 pain scale fixed by requirement; treatment catalogue awaits client decision',
    actions: [],
  },
  {
    id: 'prescription-print',
    title: 'Prescription & Print',
    description: 'Header and footer text printed on prescriptions and receipts',
    group: 'hospital',
    canonicalPath: '/admin/settings',
    requiredPermission: 'settings:read',
    displayOrder: 6,
    status: 'partial',
    statusReason: 'Print header and footer are edited on the Clinic settings page',
    actions: [{ label: 'Print header & footer', path: '/admin/settings' }],
  },

  // --- System Administration ---
  {
    id: 'user-authority',
    title: 'User & Authority',
    description: 'Staff accounts, account actions and role permissions matrix',
    group: 'system',
    canonicalPath: '/admin/users',
    requiredPermission: 'users:read',
    displayOrder: 7,
    status: 'available',
    actions: [
      { label: 'User accounts', path: '/admin/users' },
      { label: 'Roles & permissions', path: '/admin/roles' },
    ],
  },
  {
    id: 'security-access',
    title: 'Security & Access',
    description: 'Active sessions, session revocation and effective security policy',
    group: 'system',
    canonicalPath: '/admin/security',
    requiredPermission: 'security:read',
    displayOrder: 8,
    status: 'available',
    actions: [{ label: 'Security & access', path: '/admin/security' }],
  },
  {
    id: 'audit-compliance',
    title: 'Audit & Compliance',
    description: 'Search the immutable audit trail of security and operational events',
    group: 'system',
    canonicalPath: '/admin/audit',
    requiredPermission: 'audit:read',
    displayOrder: 9,
    status: 'available',
    actions: [{ label: 'Audit log viewer', path: '/admin/audit' }],
  },
  {
    id: 'backup-data',
    title: 'Backup, Restore & Data',
    description: 'Backup archives, verified restore and data integrity checks',
    group: 'system',
    canonicalPath: '/admin/backups',
    requiredPermission: 'backups:read',
    displayOrder: 10,
    status: 'available',
    actions: [
      { label: 'Backup & restore', path: '/admin/backups' },
      { label: 'Data integrity', path: '/admin/integrity' },
    ],
  },
  {
    id: 'system-health',
    title: 'System Health & Maintenance',
    description: 'Server version, database revision, uptime and storage capacity',
    group: 'system',
    canonicalPath: '/admin/system',
    requiredPermission: 'system:read',
    displayOrder: 11,
    status: 'available',
    actions: [{ label: 'System health', path: '/admin/system' }],
  },
]

export function adminModulesInGroup(group: AdminModuleGroup): AdminModule[] {
  return ADMIN_MODULES
    .filter((m) => m.group === group)
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

export function findAdminModuleForPath(
  pathname: string,
): { module: AdminModule; action: AdminModuleAction } | null {
  for (const module of ADMIN_MODULES) {
    for (const action of module.actions) {
      if (
        action.path === pathname ||
        (action.path !== '/admin' && pathname.startsWith(`${action.path}/`))
      ) {
        return { module, action }
      }
    }
  }
  return null
}
