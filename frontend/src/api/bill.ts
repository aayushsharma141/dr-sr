import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface BillLineHistoryOut {
  id: number
  bill_item_id: number
  kind: 'DISCOUNT' | 'WAIVER' | 'CORRECTION' | 'VOID' | string
  old_quantity?: string | number | null
  new_quantity?: string | number | null
  old_rate_paise?: number | null
  new_rate_paise?: number | null
  old_amount_paise: number
  new_amount_paise: number
  reason: string
  actor_user_id: number
  actor_username?: string | null
  created_at: string
  old?: number
  new?: number
  actor?: string | null
}

export interface BillLineOut {
  id: number
  visit_id: number
  appointment_id?: number | null
  category: string
  source: 'DOCTOR' | 'RECEPTION' | 'SYSTEM' | string
  description: string
  unit?: string | null
  quantity: string | number
  rate_paise: number
  amount_paise: number
  original_amount_paise: number
  status: 'ACTIVE' | 'VOIDED' | string
  counts_toward_total: boolean
  prescription_item_id?: number | null
  created_by_user_id: number
  created_by_username?: string | null
  created_at: string
  history: BillLineHistoryOut[]
  void_reason?: string | null
  voided_by_user_id?: number | null
  voided_by_username?: string | null
  voided_at?: string | null
  staff?: string | null
  voided_by?: string | null
}

export interface PrescribedMedicineOut {
  prescription_item_id: number
  medicine_name: string
  form: string
}

export interface BillLineCreate {
  category: 'MEDICINE' | 'ADDITIONAL' | string
  description: string
  unit?: string | null
  quantity: string | number
  rate_paise: number
  prescription_item_id?: number | null
}

export interface BillLineVoidRequest {
  reason: string
}

export interface BillLineCorrectRequest {
  quantity?: string | number | null
  rate_paise?: number | null
  reason: string
}

export interface FeeAdjustmentRequest {
  kind: 'DISCOUNT' | 'WAIVER' | 'CORRECTION'
  new_amount_paise: number
  reason: string
}

export interface FeeAdjustmentOut {
  bill_item_id: number
  appointment_id: number
  kind: string
  old_amount_paise: number
  new_amount_paise: number
  reason: string
  actor_user_id: number
  created_at: string
}

export interface BillSectionOut {
  category: 'CONSULTATION' | 'PROCEDURE' | 'PACKAGE' | 'MEDICINE' | 'ADDITIONAL' | string
  subtotal_paise: number
  lines: BillLineOut[]
}

export interface BillPaymentOut {
  id: number
  visit_id?: number | null
  appointment_id?: number | null
  receipt_number: string
  amount_paise: number
  payment_method: string
  is_reversed: boolean
  created_at: string
  created_by_username?: string | null
}

export interface PreviousDueOut {
  visit_id: number
  visit_date: string
  doctor_names: string[]
  balance_paise: number
  balance?: number
  due_paise?: number
}

export interface PackageInfoOut {
  treatment_plan_id: number
  plan_name: string
  status: string
  total_sessions: number
  completed_sessions: number
  remaining_sessions: number
  agreed_price_paise: number
  paid_paise: number
  balance_paise: number
}

export interface VisitBillOut {
  visit_id: number
  patient_id: number
  patient_urn?: string | null
  patient_name?: string | null
  status: string
  visit_date: string
  closed_at?: string | null
  close_reason?: string | null
  locked: boolean
  sections: BillSectionOut[]
  bill_total_paise: number
  paid_paise: number
  due_paise: number
  payments: BillPaymentOut[]
  voided_lines: BillLineOut[]
  previous_dues: PreviousDueOut[]
  previous_dues_total_paise: number
  packages: PackageInfoOut[]
}

/**
 * Hook to retrieve comprehensive visit bill breakdown from GET /api/visits/{id}/bill (22-09).
 * Refetches every 10 s like other checkout queries.
 */
export function useVisitBill(visitId: number | null | undefined) {
  return useQuery({
    queryKey: ['visit-bill', visitId],
    queryFn: () => apiFetch<VisitBillOut>(`/api/visits/${visitId}/bill`),
    enabled: typeof visitId === 'number' && visitId > 0,
    refetchInterval: 10000,
  })
}

/**
 * Hook to retrieve prescribed medicine names and forms for billing reference (OD-B, B2, MED-02).
 */
export function usePrescribedMedicines(visitId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['prescribed-medicines', visitId],
    queryFn: () => apiFetch<PrescribedMedicineOut[]>(`/api/visits/${visitId}/prescribed-medicines`),
    enabled: typeof visitId === 'number' && visitId > 0 && enabled,
    retry: false,
  })
}

/**
 * Mutation hook for reception to add a medicine or additional particular to an open visit bill.
 */
export function useAddBillLine(visitId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: BillLineCreate) =>
      apiFetch<BillLineOut>(`/api/visits/${visitId}/bill-items`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
    },
    retry: false,
  })
}

/**
 * Mutation hook for reception to void own same-day bill line.
 */
export function useVoidBillLine(visitId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lineId, reason }: { lineId: number; reason: string }) =>
      apiFetch<BillLineOut>(`/api/bill-items/${lineId}/void`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
    },
    retry: false,
  })
}

/**
 * Mutation hook for reception to correct quantity and/or rate of own same-day bill line.
 */
export function useCorrectBillLine(visitId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lineId, payload }: { lineId: number; payload: BillLineCorrectRequest }) =>
      apiFetch<BillLineOut>(`/api/bill-items/${lineId}/correct`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
    },
    retry: false,
  })
}

/**
 * Mutation hook for admin (bill:adjust) to void any non-consultation bill line on open visit.
 */
export function useAdminVoidBillLine(visitId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lineId, reason }: { lineId: number; reason: string }) =>
      apiFetch<BillLineOut>(`/api/bill-items/${lineId}/admin-void`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
    },
    retry: false,
  })
}

/**
 * Mutation hook for admin (bill:adjust) to correct quantity and/or rate of any non-consultation line.
 */
export function useAdminCorrectBillLine(visitId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lineId, payload }: { lineId: number; payload: BillLineCorrectRequest }) =>
      apiFetch<BillLineOut>(`/api/bill-items/${lineId}/admin-correct`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
    },
    retry: false,
  })
}

/**
 * Mutation hook for admin (bill:adjust) to adjust consultation fee (discount, waive, correct).
 */
export function useFeeCorrection(visitId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      appointmentId,
      payload,
    }: {
      appointmentId: number
      payload: FeeAdjustmentRequest
    }) =>
      apiFetch<FeeAdjustmentOut>(`/api/appointments/${appointmentId}/fee-correction`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
    },
    retry: false,
  })
}
