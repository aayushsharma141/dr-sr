/**
 * Turns a stored integrity run into what the Data Integrity page and the sidebar show:
 * findings grouped by what is wrong (not by which check found them), worst first.
 */
import type { IntegrityCheckItemOut, IntegrityReportOut, IntegritySeverity } from '../api/types'

export const SEVERITY_ORDER: Record<IntegritySeverity, number> = { ERROR: 0, WARNING: 1, CLEANUP: 2 }

export const SEVERITY_LABEL: Record<IntegritySeverity, string> = {
  ERROR: 'Problem',
  WARNING: 'Review',
  CLEANUP: 'Clean-up',
}

/** Plain names for each check, by its stable code. */
export const CHECK_INFO: Record<string, { title: string; purpose: string }> = {
  package_payments: {
    title: 'Treatment package payments',
    purpose: 'Payments against each treatment package do not exceed its agreed price, and no price is below zero.',
  },
  patient_id_unique: {
    title: 'Patient ID uniqueness',
    purpose: 'Every patient has their own registration number (URN).',
  },
  patient_id_gaps: {
    title: 'Patient ID sequence',
    purpose: 'Registration numbers that were issued or reserved but belong to no patient.',
  },
  receipt_unique: {
    title: 'Receipt numbers',
    purpose: 'No two payments share a receipt number.',
  },
  session_counts: {
    title: 'Treatment session counts',
    purpose: 'Each plan’s completed-session count matches the sessions actually finalised.',
  },
  photo_files: {
    title: 'Patient photo files',
    purpose: 'Every patient photo record has its file, and every stored photo belongs to a patient.',
  },
  asset_files: {
    title: 'Hospital logo and document files',
    purpose: 'Every uploaded hospital file has its stored file, and every stored file belongs to a record.',
  },
}

export function checkTitle(check: IntegrityCheckItemOut): string {
  return CHECK_INFO[check.code]?.title ?? check.name
}

export type Finding = Record<string, unknown> & { issue?: string; severity?: IntegritySeverity }

export interface FindingGroup {
  /** Issue code, or a merged code such as 'unlinked_files'. */
  key: string
  severity: IntegritySeverity
  findings: Finding[]
}

/** Unlinked photo and asset files are one clean-up job, so they are shown as one group. */
const MERGED_ISSUES: Record<string, string> = {
  orphan_photo_file: 'unlinked_files',
  orphan_asset_file: 'unlinked_files',
}

export function groupFindings(report: IntegrityReportOut | null | undefined): FindingGroup[] {
  if (!report || !Array.isArray(report.checks)) return []
  const groups = new Map<string, FindingGroup>()
  for (const check of report.checks) {
    for (const raw of Array.isArray(check.discrepancies) ? check.discrepancies : []) {
      const finding = raw as Finding
      const issue = String(finding.issue ?? check.code ?? check.name)
      const key = MERGED_ISSUES[issue] ?? issue
      const severity = (finding.severity as IntegritySeverity | undefined) ?? check.severity
      const group = groups.get(key) ?? { key, severity, findings: [] }
      if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[group.severity]) group.severity = severity
      group.findings.push({ ...finding, check_code: check.code })
      groups.set(key, group)
    }
  }
  return [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

export function countBySeverity(groups: FindingGroup[]): Record<IntegritySeverity, number> {
  const counts: Record<IntegritySeverity, number> = { ERROR: 0, WARNING: 0, CLEANUP: 0 }
  for (const group of groups) counts[group.severity] += 1
  return counts
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "1 problem, 1 clean-up item" or "No problems found". */
export function summaryHeadline(counts: Record<IntegritySeverity, number>): string {
  const parts: string[] = []
  if (counts.ERROR) parts.push(plural(counts.ERROR, 'problem', 'problems'))
  if (counts.WARNING) parts.push(plural(counts.WARNING, 'item to review', 'items to review'))
  if (counts.CLEANUP) parts.push(plural(counts.CLEANUP, 'clean-up item', 'clean-up items'))
  return parts.length ? parts.join(', ') : 'No problems found'
}

export function formatBytes(value: unknown): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return 'Size unknown'
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
