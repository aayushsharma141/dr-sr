import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, isVersionConflict } from '../../api/client'
import { useDoctorDepartments, useDoctors, useReassignAppointment } from '../../api/queries'
import type { Appointment } from '../../api/types'
import { formatToken } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'

export interface ReassignModalProps {
  open?: boolean
  appointment: Appointment
  onClose: () => void
  onSuccess?: (reassigned: Appointment) => void
}

/** Shared modal for transferring a checked-in waiting patient to another doctor on the same visit. */
export function ReassignModal({
  open = true,
  appointment,
  onClose,
  onSuccess,
}: ReassignModalProps) {
  const queryClient = useQueryClient()
  const doctors = useDoctors(true)
  const reassign = useReassignAppointment()
  const inFlightRef = useRef(false)
  const reasonHelpId = useId()

  const [targetDoctorId, setTargetDoctorId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      inFlightRef.current = false
      return
    }
    setTargetDoctorId('')
    setDepartmentId('')
    setReason('')
    setError(null)
    inFlightRef.current = false
  }, [open, appointment.id])

  const isPending = reassign.isPending
  const targetId = targetDoctorId ? Number(targetDoctorId) : null
  const targetDepartments = useDoctorDepartments(targetId)
  // TanStack Query v5 reports isPending=true while disabled (targetId === null); guard on targetId !== null.
  const targetDepartmentsLoading = targetId !== null && targetDepartments.isPending
  const targetDepartmentsError = targetId !== null && targetDepartments.isError
  const targetDepartmentsUnavailable = targetDepartmentsLoading || targetDepartmentsError
  const sameDepartment =
    targetDepartments.data?.some((d) => d.id === appointment.department_id) ?? false
  const needsDepartment = targetId !== null && targetDepartments.isSuccess && !sameDepartment

  const candidates = (doctors.data ?? []).filter((d) => d.id !== appointment.doctor_id && d.is_active)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (inFlightRef.current || isPending) {
      return
    }
    if (targetId === null) {
      setError('Choose the doctor to move the patient to.')
      return
    }
    if (targetDepartmentsUnavailable) {
      return
    }
    if (needsDepartment && !departmentId) {
      setError('Choose one of this doctor’s departments.')
      return
    }
    const text = reason.trim()
    if (text.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }
    setError(null)
    inFlightRef.current = true
    try {
      reassign.mutate(
        {
          id: appointment.id,
          body: {
            version_id: appointment.version_id,
            new_doctor_id: targetId,
            new_department_id: needsDepartment ? Number(departmentId) : null,
            reason: text,
          },
        },
        {
          onSuccess: (data) => {
            toast.success(`Reassigned ${appointment.patient_name} to the selected doctor.`)
            onSuccess?.(data)
            onClose()
          },
          onError: (err) => {
            if (err instanceof ApiError && err.code === 'department_required') {
              setError('Choose one of this doctor’s departments.')
            } else if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
              void queryClient.invalidateQueries({ queryKey: ['appointments'] })
              setError('This patient was updated by someone else. The queue has refreshed; check it and try again.')
            } else {
              setError('Could not move the patient. The consultation is still waiting. Try again.')
            }
          },
          onSettled: () => {
            inFlightRef.current = false
          },
        },
      )
    } catch (err) {
      inFlightRef.current = false
      throw err
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reassign ${formatToken(appointment.token_number)} (${appointment.patient_name})?`}
      description="The old token stays in history. The patient gets a new token from the new doctor's sequence."
      variant="warning"
      dismiss="none"
      busy={isPending}
      className="max-w-md"
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-semibold text-slate-700">
          Move to doctor
          <select
            data-autofocus
            value={targetDoctorId}
            disabled={isPending}
            onChange={(e) => {
              setTargetDoctorId(e.target.value)
              setDepartmentId('')
              setError(null)
            }}
            className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
          >
            <option value="">Choose a doctor</option>
            {candidates.map((d) => (
              <option key={d.id} value={d.id}>{d.name_en}</option>
            ))}
          </select>
        </label>

        {targetDepartmentsLoading && (
          <p className="text-xs text-slate-600">
            Loading departments for the selected doctor…
          </p>
        )}

        {targetDepartmentsError && (
          <InlineAlert tone="error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Could not load departments for the selected doctor.</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => void targetDepartments.refetch()}
                className="min-h-8 rounded-lg border border-red-300 bg-white px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          </InlineAlert>
        )}

        {needsDepartment && (
          <label className="block text-sm font-semibold text-slate-700">
            Department for this consultation
            <select
              value={departmentId}
              disabled={isPending}
              onChange={(e) => {
                setDepartmentId(e.target.value)
                setError(null)
              }}
              className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
            >
              <option value="">Choose a department</option>
              {(targetDepartments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name_en}</option>
              ))}
            </select>
          </label>
        )}

        <div>
          <label className="block text-sm font-semibold text-slate-700">
            Reason
            <input
              value={reason}
              disabled={isPending}
              aria-describedby={reasonHelpId}
              onChange={(e) => {
                setReason(e.target.value)
                if (error) setError(null)
              }}
              className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
            />
          </label>
          <p id={reasonHelpId} className="mt-1 text-xs text-slate-600">
            Enter at least 3 characters explaining why the patient is being reassigned.
          </p>
        </div>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Keep with current doctor
          </button>
          <button
            type="submit"
            disabled={isPending || targetDepartmentsUnavailable}
            className="min-h-[44px] rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 transition-colors disabled:opacity-70"
          >
            {isPending ? 'Reassigning…' : 'Reassign & issue new token'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
