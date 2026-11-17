import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import { ApiError } from '../../api/client'
import { AppointmentBookingModal } from '../AppointmentBookingModal'
import { SessionAddendumModal } from '../SessionAddendumModal'
import { SessionLoggerModal } from '../SessionLoggerModal'
import type { PatientOut, TreatmentPlanOut, TreatmentSessionOut } from '../../api/types'

const patient = { id: 7, full_name: 'Aarav Kumar', urn: 'KH-2026-0007', mobile: '9876543210', age_years: 30 } as PatientOut

const { usePatientsSpy, bookMutateAsync, departmentsState, departmentDoctorsState } = vi.hoisted(() => ({
  usePatientsSpy: vi.fn(),
  bookMutateAsync: vi.fn(),
  departmentsState: { data: [] as { id: number; name_en: string; name_hi?: string | null }[] },
  departmentDoctorsState: { data: [] as { id: number; name_en: string; name_hi?: string | null; qualification?: string | null }[] },
}))

vi.mock('../../api/queries', () => ({
  useLogTreatmentSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddSessionAddendum: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBookAppointment: () => ({ mutateAsync: bookMutateAsync, isPending: false }),
  useUpdateAppointmentStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDepartments: () => ({ data: departmentsState.data }),
  useDepartmentDoctors: () => ({ data: departmentDoctorsState.data }),
  usePatients: (...args: unknown[]) => {
    usePatientsSpy(...args)
    return { data: [patient], isPending: false }
  },
}))

const plan = {
  id: 1,
  plan_name: 'Knee Rehab',
  patient_name: 'Aarav Kumar',
  completed_sessions: 2,
  total_sessions: 6,
} as TreatmentPlanOut

const session = {
  id: 9,
  session_number: 3,
  session_date: '2026-11-05',
  patient_name: 'Aarav Kumar',
  modalities: [] as string[],
} as TreatmentSessionOut

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  usePatientsSpy.mockClear()
  bookMutateAsync.mockReset()
  departmentsState.data = []
  departmentDoctorsState.data = []
})

describe('session dialogs', () => {
  it('session logger opens on its first field', () => {
    render(<SessionLoggerModal plan={plan} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Session Date/)).toHaveFocus()
  })

  it('session addendum opens on its first field', () => {
    render(<SessionAddendumModal session={session} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Addendum Observation or Correction/)).toHaveFocus()
  })

  it('session logger defaults to the IST date just after midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T19:30:00Z') }) // 01:00 IST, 6 Nov
    render(<SessionLoggerModal plan={plan} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Session Date/)).toHaveValue('2026-11-06')
  })
})

describe('appointment booking dialog', () => {
  it('defaults to the IST date just after midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T19:30:00Z') }) // 01:00 IST, 6 Nov
    render(<AppointmentBookingModal isOpen onClose={vi.fn()} />)
    expect(screen.getByLabelText('Appointment Date')).toHaveValue('2026-11-06')
  })

  it('pre-fills initialDate when today or in the future and enforces IST min date', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T06:00:00Z') })
    render(<AppointmentBookingModal isOpen initialDate="2026-11-20" onClose={vi.fn()} />)
    const dateInput = screen.getByLabelText('Appointment Date')
    expect(dateInput).toHaveValue('2026-11-20')
    expect(dateInput).toHaveAttribute('min', '2026-11-17')
  })

  it('clamps past initialDate to today in IST', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T06:00:00Z') })
    render(<AppointmentBookingModal isOpen initialDate="2026-11-10" onClose={vi.fn()} />)
    const dateInput = screen.getByLabelText('Appointment Date')
    expect(dateInput).toHaveValue('2026-11-17')
    expect(dateInput).toHaveAttribute('min', '2026-11-17')
  })

  it('names the patient search and lets the keyboard pick a result', async () => {
    const user = userEvent.setup()
    render(<AppointmentBookingModal isOpen onClose={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: 'Patient' }), 'Aarav')
    screen.getByRole('button', { name: /Aarav Kumar/ }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  it('debounces patient search and gates usePatients on >= 2 chars and no initialPatient', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AppointmentBookingModal isOpen onClose={vi.fn()} />)

    // Initially disabled with empty search query
    expect(usePatientsSpy).toHaveBeenLastCalledWith('', 5, 0, { enabled: false })

    // Typing 1 character stays disabled
    await user.type(screen.getByRole('textbox', { name: 'Patient' }), 'A')
    expect(usePatientsSpy).toHaveBeenLastCalledWith('', 5, 0, { enabled: false })

    // Typing >= 2 characters enables search after debounce
    await user.type(screen.getByRole('textbox', { name: 'Patient' }), 'arav')
    await waitFor(() => {
      expect(usePatientsSpy).toHaveBeenLastCalledWith('Aarav', 5, 0, { enabled: true })
    })

    // When initialPatient is provided on open, search stays disabled
    unmount()
    usePatientsSpy.mockClear()
    render(<AppointmentBookingModal isOpen initialPatient={patient} onClose={vi.fn()} />)
    expect(usePatientsSpy).toHaveBeenLastCalledWith('', 5, 0, { enabled: false })
  })

  it('shows a clear conflict message without override-reason jargon on 409 duplicate_appointment', async () => {
    departmentsState.data = [{ id: 1, name_en: 'Physiotherapy', name_hi: null }]
    departmentDoctorsState.data = [{ id: 2, name_en: 'Dr. Sharma', name_hi: null, qualification: 'PT' }]
    bookMutateAsync.mockRejectedValueOnce(
      new ApiError(
        409,
        'duplicate_appointment',
        'Patient already has an active appointment with this doctor on this date. An override reason of at least 5 characters is required.',
      ),
    )

    const user = userEvent.setup()
    render(<AppointmentBookingModal isOpen initialPatient={patient} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Department / Specialty'), '1')
    await user.selectOptions(screen.getByLabelText('Consulting Doctor'), '2')
    await user.click(screen.getByRole('button', { name: 'Confirm Booking' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/already has an active appointment/i)
    expect(alert.textContent).not.toMatch(/override reason/i)
  })
})
