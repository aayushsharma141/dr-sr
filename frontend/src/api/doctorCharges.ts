import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { BillLineOut } from './bill'

export type { BillLineOut, BillLineHistoryOut } from './bill'

export interface DoctorChargesOut {
  consultation_line: BillLineOut | null
  doctor_lines: BillLineOut[]
}

export interface DoctorLineCreate {
  category: 'PROCEDURE' | 'PACKAGE'
  description?: string
  unit?: string | null
  quantity?: string | number
  rate_paise?: number
  treatment_plan_id?: number
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

/**
 * Hook to retrieve doctor's own charges and consultation fee from GET /api/appointments/{id}/bill-items (22-12).
 * Strictly contains own view (no reception lines, no other doctor lines, no visit totals or payments).
 */
export function useDoctorCharges(appointmentId: number | null | undefined) {
  return useQuery({
    queryKey: ['doctor-charges', appointmentId],
    queryFn: () => apiFetch<DoctorChargesOut>(`/api/appointments/${appointmentId}/bill-items`),
    enabled: typeof appointmentId === 'number' && appointmentId > 0,
    retry: false,
  })
}

/**
 * Mutation hook for doctor to discount or waive own consultation fee (OD-22-11, FEE-03, FEE-04).
 * Calls POST /api/appointments/{id}/fee-adjustment.
 */
export function useAdjustOwnFee(appointmentId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FeeAdjustmentRequest) =>
      apiFetch<FeeAdjustmentOut>(`/api/appointments/${appointmentId}/fee-adjustment`, {
        method: 'POST',
        body,
      }),
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-charges', appointmentId] })
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

/**
 * Mutation hook for doctor to add a procedure or package reference charge to own consultation (22-12, BILL-03, OD-C).
 * Calls POST /api/appointments/{id}/bill-items.
 */
export function useAddDoctorCharge(appointmentId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DoctorLineCreate) =>
      apiFetch<BillLineOut>(`/api/appointments/${appointmentId}/bill-items`, {
        method: 'POST',
        body,
      }),
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-charges', appointmentId] })
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] })
    },
  })
}
