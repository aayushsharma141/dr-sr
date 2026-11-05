import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import { AppointmentBookingModal } from '../AppointmentBookingModal'
import { SessionAddendumModal } from '../SessionAddendumModal'
import { SessionLoggerModal } from '../SessionLoggerModal'
import type { PatientOut, TreatmentPlanOut, TreatmentSessionOut } from '../../api/types'

const patient = { id: 7, full_name: 'Aarav Kumar', urn: 'KH-2026-0007', mobile: '9876543210', age_years: 30 } as PatientOut

vi.mock('../../api/queries', () => ({
  useLogTreatmentSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddSessionAddendum: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBookAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDepartments: () => ({ data: [] }),
  useDepartmentDoctors: () => ({ data: [] }),
  useDoctors: () => ({ data: [] }),
  usePatients: () => ({ data: [patient], isPending: false }),
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
  vi.useRealTimers()
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

  it('names the patient search and lets the keyboard pick a result', async () => {
    const user = userEvent.setup()
    render(<AppointmentBookingModal isOpen onClose={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: 'Patient' }), 'Aarav')
    screen.getByRole('button', { name: /Aarav Kumar/ }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })
})
