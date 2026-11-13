import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Appointment, DepartmentOut, Me } from './types'

/** Specialties that have their own consultation form and quick phrases (D-19-01). */
export type SpecialtyCode = 'PHYSIOTHERAPY' | 'OPHTHALMOLOGY'

export function asSpecialty(code: string | null | undefined): SpecialtyCode | null {
  return code === 'PHYSIOTHERAPY' || code === 'OPHTHALMOLOGY' ? code : null
}

/**
 * Departments the signed-in doctor belongs to (D-19-03). Empty for other roles, while loading,
 * or when the administrator has not assigned any yet, so callers must treat "empty" as "unknown",
 * never as "no specialty".
 *
 * It reads the current user from the cache that `useMe()` fills on every page instead of
 * fetching it again, so it never races the CSRF token that `useMe()` stores.
 */
export function useMyDepartments(): DepartmentOut[] {
  const { data: me } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/auth/me'),
    enabled: false,
  })
  const doctorId = me?.role === 'DOCTOR' ? me.doctor_id : null
  const { data } = useQuery({
    queryKey: ['doctors', doctorId, 'departments'],
    queryFn: () => apiFetch<DepartmentOut[]>(`/doctors/${doctorId}/departments`),
    enabled: doctorId !== null,
    staleTime: 5 * 60_000,
  })
  return Array.isArray(data) ? data.filter((d) => d.is_active) : []
}

/**
 * The appointment a consultation was opened from. Its `department_id` decides the consultation
 * template (D-19-03) and its `token_number` is the queue token the patient holds. Null while
 * loading or when the consultation has no appointment.
 */
export function useBookedAppointment(appointmentId: number | null): Appointment | null {
  const { data } = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => apiFetch<Appointment>(`/appointments/${appointmentId}`),
    enabled: appointmentId !== null && appointmentId > 0,
  })
  return data ?? null
}
