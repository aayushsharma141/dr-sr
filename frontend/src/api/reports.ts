import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface ReferralReportRow {
  source: string
  referrer_name?: string | null
  visit_count: number
}

export interface ReferralReportOut {
  date_from: string
  date_to: string
  rows: ReferralReportRow[]
  total_visits: number
}

export interface ReferralReportParams {
  date_from: string
  date_to: string
  source?: string | null
  referrer?: string | null
}

export const REFERRAL_SOURCE_FILTER_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'SELF', label: 'Self' },
  { value: 'DOCTOR', label: 'Doctor' },
  { value: 'PERSONAL', label: 'Personal' },
  { value: 'ORGANIZATION', label: 'Organisation' },
  { value: 'OTHER', label: 'Other' },
  { value: 'NOT_RECORDED', label: 'Not recorded' },
] as const

const REFERRAL_SOURCES_NEEDING_NAME = new Set(['DOCTOR', 'PERSONAL', 'ORGANIZATION'])

export function shouldShowReferrerName(source: string): boolean {
  return REFERRAL_SOURCES_NEEDING_NAME.has(source.toUpperCase())
}

export function formatReferralSource(source: string): string {
  switch (source.toUpperCase()) {
    case 'SELF':
      return 'Self'
    case 'DOCTOR':
      return 'Doctor'
    case 'PERSONAL':
      return 'Personal'
    case 'ORGANIZATION':
      return 'Organisation'
    case 'OTHER':
      return 'Other'
    case 'NOT_RECORDED':
      return 'Not recorded'
    default:
      return source
  }
}

export function useReferralReport(
  params: ReferralReportParams,
  options?: { enabled?: boolean },
) {
  const { date_from, date_to, source, referrer } = params
  const isValidRange = Boolean(date_from && date_to && date_from <= date_to)
  const isEnabled = (options?.enabled ?? true) && isValidRange

  return useQuery({
    queryKey: ['reports', 'referrals', date_from, date_to, source ?? '', referrer ?? ''],
    queryFn: async () => {
      const query = new URLSearchParams()
      query.set('date_from', date_from)
      query.set('date_to', date_to)
      if (source && source.trim()) {
        query.set('source', source.trim())
      }
      if (referrer && referrer.trim()) {
        query.set('referrer', referrer.trim())
      }
      return apiFetch<ReferralReportOut>(`/api/reports/referrals?${query.toString()}`)
    },
    enabled: isEnabled,
  })
}
