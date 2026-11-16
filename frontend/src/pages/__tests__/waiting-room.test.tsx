import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { Appointment } from '../../api/types'

const state: {
  appointments: Appointment[]
  reassignMutate: ReturnType<typeof vi.fn>
  cancelMutate: ReturnType<typeof vi.fn>
} = {
  appointments: [],
  reassignMutate: vi.fn(),
  cancelMutate: vi.fn(),
}

vi.mock('../../api/queries', () => ({
  useAppointments: () => ({ data: { total: state.appointments.length, appointments: state.appointments }, dataUpdatedAt: Date.parse('2026-11-15T04:30:00Z'), isError: false }),
  useDoctors: () => ({
    data: [
      { id: 1, name_en: 'Dr. Anil', is_active: true },
      { id: 2, name_en: 'Dr. Bharati', is_active: true },
    ],
  }),
  useDepartments: () => ({
    data: [
      { id: 10, name_en: 'General OPD', is_active: true },
      { id: 20, name_en: 'Ophthalmology', is_active: true },
    ],
  }),
  // Dr. Bharati belongs to Ophthalmology only; Dr. Anil belongs to General OPD.
  useDoctorDepartments: (doctorId: number | null) => {
    if (doctorId === 2) return { data: [{ id: 20, name_en: 'Ophthalmology' }], isSuccess: true }
    return { data: [{ id: 10, name_en: 'General OPD' }], isSuccess: true }
  },
  useReassignAppointment: () => ({ mutate: state.reassignMutate, isPending: false }),
  useUpdateAppointmentStatus: () => ({ mutate: state.cancelMutate, isPending: false }),
}))

import { WaitingRoom } from '../WaitingRoom'

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 1,
    department_id: 10,
    patient_id: 1,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Ram Kumar',
    patient_mobile: '9800000000',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil',
    doctor_name_hi: null,
    appointment_date: '2026-11-15',
    token_number: 1,
    status: 'ARRIVED',
    status_updated_at: '2026-11-15T04:00:00Z',
    cancellation_reason: null,
    notes: null,
    consultation_status: 'WAITING',
    priority_level: 'NORMAL',
    priority_updated_at: null,
    version_id: 2,
    created_at: '2026-11-15T03:00:00Z',
    ...overrides,
  } as Appointment
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WaitingRoom />
    </MemoryRouter>,
  )
}

describe('WaitingRoom', () => {
  beforeEach(() => {
    state.reassignMutate.mockReset()
    state.cancelMutate.mockReset()
  })

  afterEach(() => {
    cleanup()
    state.appointments = []
  })

  it('orders waiting patients: emergency by classification time, then priority, then normal', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Normal One', priority_level: 'NORMAL' }),
      appt({ id: 2, token_number: 2, patient_name: 'Priority Two', priority_level: 'PRIORITY', priority_reason: 'Elderly' }),
      appt({ id: 3, token_number: 3, patient_name: 'Emergency Late', priority_level: 'EMERGENCY', priority_reason: 'Fall', priority_updated_at: '2026-11-15T04:20:00Z' }),
      appt({ id: 4, token_number: 4, patient_name: 'Emergency Early', priority_level: 'EMERGENCY', priority_reason: 'Breathless', priority_updated_at: '2026-11-15T04:10:00Z' }),
    ]
    renderPage()

    const waitingColumn = screen.getByRole('heading', { name: 'Waiting' }).closest('div')!.parentElement!
    const order = within(waitingColumn)
      .getAllByRole('article')
      .map((card) => card.querySelector('p.text-base')?.textContent)
    expect(order).toEqual(['Emergency Early', 'Emergency Late', 'Priority Two', 'Normal One'])
  })

  it('computes a position for each waiting card and never shows a Complete control', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1 }),
      appt({ id: 2, token_number: 2, patient_name: 'Second', consultation_status: 'IN_CONSULTATION' }),
      appt({ id: 3, token_number: 3, patient_name: 'Done', consultation_status: 'COMPLETED' }),
    ]
    renderPage()

    expect(screen.getByText('Position 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument()
  })

  it('puts completed cards behind an Open bill link', () => {
    state.appointments = [appt({ id: 9, token_number: 9, patient_name: 'Paid Up', consultation_status: 'COMPLETED', patient_id: 77 })]
    renderPage()

    const link = screen.getByRole('link', { name: 'Open bill' })
    expect(link).toHaveAttribute('href', '/reception/billing?appointment_id=9&patient_id=77')
  })

  it('filters by search text across name, URN and token', async () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Ram Kumar', patient_urn: 'KH-1' }),
      appt({ id: 2, token_number: 2, patient_name: 'Sita Devi', patient_urn: 'KH-2' }),
    ]
    renderPage()

    await userEvent.type(screen.getByRole('searchbox'), 'sita')

    expect(screen.getByText('Sita Devi')).toBeInTheDocument()
    expect(screen.queryByText('Ram Kumar')).not.toBeInTheDocument()
  })

  it('shows Last updated', () => {
    renderPage()
    expect(screen.getByText(/Last updated/)).toBeInTheDocument()
  })

  it('reassign needs a department when the new doctor is outside the current one', async () => {
    state.appointments = [appt({ id: 1, token_number: 1, department_id: 10, doctor_id: 1 })]
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    const dialog = screen.getByRole('dialog', { hidden: true })
    await userEvent.selectOptions(within(dialog).getByLabelText('Move to doctor'), '2')

    // Dr. Bharati is not in General OPD, so a department choice appears.
    expect(within(dialog).getByLabelText('Department for this consultation')).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Eye complaint')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reassign & issue new token' }))

    expect(state.reassignMutate).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/Choose one of this doctor/)).toBeInTheDocument()
  })

  it('sends the reassignment with the chosen department and the version', async () => {
    state.appointments = [appt({ id: 1, token_number: 1, department_id: 10, doctor_id: 1, version_id: 5 })]
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    const dialog = screen.getByRole('dialog', { hidden: true })
    await userEvent.selectOptions(within(dialog).getByLabelText('Move to doctor'), '2')
    await userEvent.selectOptions(within(dialog).getByLabelText('Department for this consultation'), '20')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Eye complaint')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reassign & issue new token' }))

    expect(state.reassignMutate).toHaveBeenCalledTimes(1)
    expect(state.reassignMutate.mock.calls[0][0]).toEqual({
      id: 1,
      body: { version_id: 5, new_doctor_id: 2, new_department_id: 20, reason: 'Eye complaint' },
    })
  })

  it('refuses a cancellation reason shorter than 3 characters', async () => {
    state.appointments = [appt({ id: 1, token_number: 1 })]
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel consultation' }))
    await userEvent.type(screen.getByLabelText('Reason for cancelling'), 'ab')
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel consultation' }).at(-1)!)

    expect(state.cancelMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('at least 3 characters')
  })

  it('shows distinct empty copy for each column when empty', () => {
    state.appointments = []
    renderPage()

    expect(screen.getByText('No one is waiting.')).toBeInTheDocument()
    expect(screen.getByText('No one is in a cabin.')).toBeInTheDocument()
    expect(screen.getByText('No consultations completed yet today.')).toBeInTheDocument()
  })

  it('maintains doctor filter, department filter and search after actions', async () => {
    state.appointments = [
      appt({
        id: 1,
        token_number: 1,
        doctor_id: 1,
        department_id: 10,
        patient_name: 'Anita Devi',
        patient_urn: 'KH-001',
      }),
    ]
    renderPage()

    await userEvent.selectOptions(screen.getByLabelText('Doctor'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Department'), '10')
    await userEvent.type(screen.getByRole('searchbox'), 'Anita')

    expect(screen.getByText('Anita Devi')).toBeInTheDocument()

    // Trigger cancel consultation
    await userEvent.click(screen.getByRole('button', { name: 'Cancel consultation' }))
    await userEvent.type(screen.getByLabelText('Reason for cancelling'), 'Patient had an emergency')
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel consultation' }).at(-1)!)

    expect(state.cancelMutate).toHaveBeenCalledTimes(1)

    // Simulate onSuccess
    const onSuccess = state.cancelMutate.mock.calls[0][1]?.onSuccess
    if (onSuccess) {
      act(() => {
        onSuccess()
      })
    }

    // Verify filter inputs are still retained
    expect(screen.getByLabelText('Doctor')).toHaveValue('1')
    expect(screen.getByLabelText('Department')).toHaveValue('10')
    expect(screen.getByRole('searchbox')).toHaveValue('Anita')
  })
})
