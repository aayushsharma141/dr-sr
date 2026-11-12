/**
 * Single source of truth for the Administration module registry.
 * Drives Administration dashboard cards, route mappings, status notices,
 * and canonical permissions per D-20-21, D-20-22, and D-20-23.
 */

export const ADMIN_MODULE_GROUPS = [
  { id: 'hospital-config', label: 'Hospital Configuration', navLabel: 'Setup' },
  { id: 'patient-data', label: 'Patient & Data Management', navLabel: 'Patients' },
  { id: 'billing-finance', label: 'Billing & Finance', navLabel: 'Finance' },
  { id: 'users-security', label: 'Users, Security & Governance', navLabel: 'Users & Access' },
  { id: 'system-maintenance', label: 'System & Maintenance', navLabel: 'System' },
] as const

export type AdminSectionGroupId = (typeof ADMIN_MODULE_GROUPS)[number]['id']
export type AdminModuleGroup = 'overview' | AdminSectionGroupId
export type AdminModuleStatus = 'available' | 'partial' | 'fixed'

export interface AdminModuleAction {
  label: string
  path: string
}

export interface AdminModule {
  id: string
  title: string
  /** Short label for the sidebar; the full title stays in tooltips, page headers and breadcrumbs. */
  navLabel?: string
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
  id: AdminSectionGroupId
  label: string
  navLabel: string
}

export const ADMIN_MODULES: readonly AdminModule[] = [
  // --- Top-level Management Overview ---
  {
    id: 'overview',
    title: 'Management Overview',
    navLabel: 'Overview',
    description: 'Hospital performance, financial summary and operational governance',
    group: 'overview',
    canonicalPath: '/admin',
    displayOrder: 1,
    status: 'available',
    actions: [{ label: 'Management Overview', path: '/admin' }],
  },

  // --- 1. Hospital Configuration ---
  {
    id: 'hospital-settings',
    title: 'Hospital Settings',
    navLabel: 'Settings',
    description: 'Hospital identity, crest and logo, contact details, receipt numbering, print text and consultation rules',
    group: 'hospital-config',
    canonicalPath: '/admin/settings',
    requiredPermission: 'settings:read',
    displayOrder: 2,
    status: 'available',
    actions: [{ label: 'Hospital settings', path: '/admin/settings' }],
  },
  {
    id: 'print-templates',
    title: 'Print Templates',
    navLabel: 'Templates',
    description: 'Bilingual header and footer templates for prescriptions, receipts, cards and summaries',
    group: 'hospital-config',
    canonicalPath: '/admin/templates',
    requiredPermission: 'settings:write',
    displayOrder: 3,
    status: 'available',
    actions: [{ label: 'Print templates', path: '/admin/templates' }],
  },
  {
    id: 'doctors-fees',
    title: 'Doctors & Fees',
    navLabel: 'Doctors & Fees',
    description: 'Doctor profiles, medical registration details and consultation fee schedules',
    group: 'hospital-config',
    canonicalPath: '/admin/doctors',
    requiredPermission: 'doctors:read',
    displayOrder: 4,
    status: 'available',
    actions: [{ label: 'Doctors & fees', path: '/admin/doctors' }],
  },

  // --- 2. Patient & Data Management ---
  {
    id: 'patient-correct',
    title: 'Patient Demographic Correction',
    navLabel: 'Corrections',
    description: 'Audited administrative correction of patient demographics with mandatory justification',
    group: 'patient-data',
    canonicalPath: '/admin/patients/correct',
    requiredPermission: 'patient:correct',
    displayOrder: 5,
    status: 'available',
    actions: [{ label: 'Demographic correction', path: '/admin/patients/correct' }],
  },

  // --- 3. Billing & Finance ---
  {
    id: 'billing-reversals',
    title: 'Receipts & Reversals',
    navLabel: 'Receipts',
    description: 'Receipt numbering, financial adjustments and payment reversals with mandatory justification',
    group: 'billing-finance',
    canonicalPath: '/admin/billing',
    requiredPermission: 'billing:read',
    displayOrder: 6,
    status: 'available',
    actions: [{ label: 'Receipts & reversals', path: '/admin/billing' }],
  },
  {
    id: 'pending-dues',
    title: 'Pending Dues',
    navLabel: 'Dues',
    description: 'Outstanding patient treatment package receivables and instalment tracking',
    group: 'billing-finance',
    canonicalPath: '/reception/dues',
    requiredPermission: 'billing:read',
    displayOrder: 7,
    status: 'available',
    actions: [{ label: 'Pending dues', path: '/reception/dues' }],
  },

  // --- 4. Users, Security & Governance ---
  {
    id: 'user-accounts',
    title: 'User Accounts',
    navLabel: 'Users',
    description: 'Staff accounts, credential resets and status management',
    group: 'users-security',
    canonicalPath: '/admin/users',
    requiredPermission: 'users:read',
    displayOrder: 8,
    status: 'available',
    actions: [{ label: 'User accounts', path: '/admin/users' }],
  },
  {
    id: 'roles-matrix',
    title: 'Roles & Permissions',
    navLabel: 'Roles',
    description: 'Role-based access control matrix and permission catalogue inspection',
    group: 'users-security',
    canonicalPath: '/admin/roles',
    requiredPermission: 'users:read',
    displayOrder: 9,
    status: 'available',
    actions: [{ label: 'Roles & permissions', path: '/admin/roles' }],
  },
  {
    id: 'security-sessions',
    title: 'Security & Sessions',
    navLabel: 'Sessions',
    description: 'Active login sessions, session termination and security policy monitoring',
    group: 'users-security',
    canonicalPath: '/admin/security',
    requiredPermission: 'security:read',
    displayOrder: 10,
    status: 'available',
    actions: [{ label: 'Security & sessions', path: '/admin/security' }],
  },
  {
    id: 'audit-trail',
    title: 'Audit Trail',
    navLabel: 'Audit Trail',
    description: 'Search the immutable cryptographic audit trail of security and administrative operations',
    group: 'users-security',
    canonicalPath: '/admin/audit',
    requiredPermission: 'audit:read',
    displayOrder: 11,
    status: 'available',
    actions: [{ label: 'Audit trail', path: '/admin/audit' }],
  },

  // --- 5. System & Maintenance ---
  {
    id: 'backups-restore',
    title: 'Backup & Restore',
    navLabel: 'Backups',
    description: 'Automated database backups, disaster recovery, spreadsheet import and dataset export',
    group: 'system-maintenance',
    canonicalPath: '/admin/backups',
    requiredPermission: 'backups:read',
    displayOrder: 12,
    status: 'available',
    actions: [
      { label: 'Backup & restore', path: '/admin/backups' },
      { label: 'Import spreadsheet', path: '/admin/backups?action=import' },
      { label: 'Export dataset', path: '/admin/backups?action=export' },
    ],
  },
  {
    id: 'data-integrity',
    title: 'Data Integrity',
    navLabel: 'Integrity',
    description: 'Database foreign key integrity checks, sequence verification and orphan audits',
    group: 'system-maintenance',
    canonicalPath: '/admin/integrity',
    requiredPermission: 'backups:read',
    displayOrder: 13,
    status: 'available',
    actions: [{ label: 'Data integrity', path: '/admin/integrity' }],
  },
  {
    id: 'system-health',
    title: 'System Health',
    navLabel: 'Health',
    description: 'Server runtime revision, database connectivity, disk storage and system telemetry',
    group: 'system-maintenance',
    canonicalPath: '/admin/system',
    requiredPermission: 'system:read',
    displayOrder: 14,
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
