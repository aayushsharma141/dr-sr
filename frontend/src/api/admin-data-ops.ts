/**
 * API client and interfaces for Phase 23 Advanced Data Operations:
 * - Duplicate patient detection & alias merge/unmerge
 * - Filtered bulk archival & restore
 * - LAN workstation heartbeat & status monitoring
 */

import { apiFetch } from './client'
import type { PatientOut } from './types'

export interface DuplicateCandidatePair {
  master: PatientOut
  duplicate: PatientOut
  similarity_score: number
  match_reason: string
  master_visit_count: number
  duplicate_visit_count: number
  has_open_visit: boolean
  open_visit_details?: string | null
}

export interface PatientMergeRequest {
  master_patient_id: number
  secondary_patient_id: number
  reason: string
  demographic_overrides?: Record<string, string | number | null>
}

export interface PatientMergeResult {
  master: PatientOut
  secondary: PatientOut
  message: string
}

export interface ArchivalCandidateItem {
  patient: PatientOut
  last_activity_date?: string | null
  visit_count: number
  total_dues_paise: number
  can_archive: boolean
  blocking_reason?: string | null
}

export interface BulkArchiveRequest {
  patient_ids: number[]
  reason: string
}

export interface BulkArchiveResult {
  archived_count: number
  skipped_count: number
  skipped_details: Array<{ patient_id: number; reason: string }>
  message: string
}

export interface WorkstationHeartbeatIn {
  hostname: string
  terminal_name?: string | null
  app_version?: string | null
}

export interface WorkstationOut {
  id: number
  hostname: string
  ip_address?: string | null
  terminal_name?: string | null
  app_version?: string | null
  last_seen_at: string
  last_user_id?: number | null
  last_username?: string | null
  status: 'ONLINE' | 'IDLE' | 'OFFLINE'
  created_at: string
  updated_at: string
}

export async function getDuplicateCandidates(limit = 50): Promise<DuplicateCandidatePair[]> {
  return apiFetch<DuplicateCandidatePair[]>(`/admin/patients/duplicates?limit=${limit}`)
}

export async function mergePatients(payload: PatientMergeRequest): Promise<PatientMergeResult> {
  return apiFetch<PatientMergeResult>('/admin/patients/merge', {
    method: 'POST',
    body: payload,
  })
}

export async function unmergePatient(id: number, reason: string): Promise<PatientOut> {
  return apiFetch<PatientOut>(`/admin/patients/${id}/unmerge`, {
    method: 'POST',
    body: { reason },
  })
}

export async function getArchivalCandidates(params: {
  inactivity_years?: number
  district?: string
  zero_visits_only?: boolean
  limit?: number
} = {}): Promise<ArchivalCandidateItem[]> {
  const query = new URLSearchParams()
  if (params.inactivity_years !== undefined) query.set('inactivity_years', String(params.inactivity_years))
  if (params.district) query.set('district', params.district)
  if (params.zero_visits_only !== undefined) query.set('zero_visits_only', String(params.zero_visits_only))
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  const qs = query.toString()
  return apiFetch<ArchivalCandidateItem[]>(`/admin/patients/archival-candidates${qs ? `?${qs}` : ''}`)
}

export async function bulkArchivePatients(payload: BulkArchiveRequest): Promise<BulkArchiveResult> {
  return apiFetch<BulkArchiveResult>('/admin/patients/bulk-archive', {
    method: 'POST',
    body: payload,
  })
}

export async function unarchivePatient(id: number, reason: string): Promise<PatientOut> {
  return apiFetch<PatientOut>(`/admin/patients/${id}/unarchive`, {
    method: 'POST',
    body: { reason },
  })
}

export async function sendHeartbeat(payload: WorkstationHeartbeatIn): Promise<WorkstationOut> {
  return apiFetch<WorkstationOut>('/system/heartbeat', {
    method: 'POST',
    body: payload,
  })
}

export async function getWorkstations(): Promise<WorkstationOut[]> {
  return apiFetch<WorkstationOut[]>('/admin/workstations')
}
