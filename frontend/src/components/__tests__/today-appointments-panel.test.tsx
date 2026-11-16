import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TodayAppointmentsPanel } from '../checkin/TodayAppointmentsPanel'
import type { Appointment } from '../../api/types'

vi.mock('../../api/queries', () => ({
  useAppointments: () => ({ data: { appointments: state.appointments }, isPending: false, isError: false }),
  useUpdateAppointmentStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRescheduleAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePriority: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../format', () => ({
  istToday: () => '2026-11-15',
  formatToken: (n: number | null) => (n != null ? String(n).padStart(3, '0') : '---'),
}))

const state: { appointments: Appointment[] } = { appointments: [] }

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 1,
    department_id: 10,
    patient_id: 1,
    patient_urn: 'KH-0001',
    patient_name: 'Test Patient',
    patient_mobile: '9800000000',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil',
    doctor_name_hi: null,
    appointment_date: '2026-11-15',
    token_number: null,
    status: 'BOOKED',
    status_updated_at: '2026-11-15T04:00:00Z',
    cancellation_reason: null,
    notes: null,
    consultation_status: null,
    priority_level: 'NORMAL',
    priority_updated_at: null,
    priority_reason: null,
    source: null,
    expected_time: '09:00:00',
    version_id: 1,
    created_at: '2026-11-15T03:00:00Z',
    ...overrides,
  } as Appointment
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TodayAppointmentsPanel
        activeBookingId={null}
        canCheckIn={true}
        canManage={true}
        onCheckIn={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  state.appointments = []
})

describe('TodayAppointmentsPanel status labels and colours', () => {
  it('shows "Waiting" with slate classes (no amber) for ARRIVED/WAITING', async () => {
    state.appointments = [appt({ id: 1, status: 'ARRIVED', consultation_status: 'WAITING' })]
    renderPanel()
    // switch to All tab to see checked-in
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = screen.getByText('Waiting')
    expect(badge.className).toMatch(/bg-slate-100/)
    expect(badge.className).toMatch(/text-slate-800/)
    expect(badge.className).not.toMatch(/amber/)
  })

  it('shows "In Cabin" with violet classes for IN_CONSULTATION status', async () => {
    state.appointments = [appt({ id: 2, status: 'IN_CONSULTATION' })]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = screen.getByText('In Cabin')
    expect(badge.className).toMatch(/bg-violet-50/)
    expect(badge.className).toMatch(/text-violet-800/)
  })

  it('shows "Completed" with emerald classes for DONE status', async () => {
    state.appointments = [appt({ id: 3, status: 'DONE' })]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = screen.getByText('Completed')
    expect(badge.className).toMatch(/bg-emerald-50/)
    expect(badge.className).toMatch(/text-emerald-800/)
  })

  it('shows "No-show" with slate classes for NO_SHOW status', () => {
    state.appointments = [appt({ id: 4, status: 'NO_SHOW' })]
    renderPanel()
    // NO_SHOW appears in arrive tab (awaiting arrival)
    const badge = screen.getByText('No-show')
    expect(badge.className).toMatch(/bg-slate-100/)
    expect(badge.className).not.toMatch(/red/)
  })

  it('shows "Cancelled" with slate-600 and no red class for CANCELLED status', async () => {
    state.appointments = [appt({ id: 5, status: 'CANCELLED' })]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = screen.getByText('Cancelled')
    expect(badge.className).toMatch(/bg-slate-100/)
    expect(badge.className).toMatch(/text-slate-600/)
    expect(badge.className).not.toMatch(/red/)
  })

  it('shows "Booked" with sky classes (unchanged) for BOOKED status', () => {
    state.appointments = [appt({ id: 6, status: 'BOOKED' })]
    renderPanel()
    const badge = screen.getByText('Booked')
    expect(badge.className).toMatch(/bg-sky-50/)
    expect(badge.className).toMatch(/text-sky-800/)
  })

  it('row cancel action button reads "Cancel booking"', () => {
    state.appointments = [appt({ id: 7, status: 'BOOKED' })]
    renderPanel()
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument()
  })

  it('renders "Register patient" button for new patient in To arrive', async () => {
    state.appointments = [
      appt({
        id: 8,
        status: 'TO_ARRIVE',
        visit_kind: 'NEW',
        token_number: 1,
        patient_name: 'Aayush',
      }),
    ]
    renderPanel()
    expect(screen.getByText('New patient')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Register patient' })).toBeInTheDocument()
  })

  it('renders "Check In" button for existing patient in To arrive', async () => {
    state.appointments = [
      appt({
        id: 9,
        status: 'TO_ARRIVE',
        visit_kind: 'FOLLOW_UP',
        token_number: 2,
        patient_name: 'Rahul Kumar',
      }),
    ]
    renderPanel()
    expect(screen.getByText('Existing patient')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check in' })).toBeInTheDocument()
  })

  it('opens priority dropdown with Normal, High, Emergency and mandatory reason', async () => {
    state.appointments = [
      appt({
        id: 10,
        status: 'ARRIVED',
        consultation_status: 'WAITING',
        token_number: 2,
        patient_name: 'Rahul Kumar',
        priority_level: 'NORMAL',
      }),
    ]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)

    const changePriorityBtn = screen.getByRole('button', { name: 'Change priority' })
    await userEvent.click(changePriorityBtn)

    const select = screen.getByRole('combobox', { name: /Priority \*/i })
    expect(select).toBeInTheDocument()
    expect(screen.getByText(/Normal \(Regular queue\)/)).toBeInTheDocument()
    expect(screen.getByText(/High \(Needs preferential attention\)/)).toBeInTheDocument()
    expect(screen.getByText(/Emergency \(Immediate clinical attention\)/)).toBeInTheDocument()

    const reasonInput = screen.getByPlaceholderText(/Enter reason for updating priority/i)
    expect(reasonInput).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save priority' })).toBeInTheDocument()
  })
})

describe('TodayAppointmentsPanel tablist keyboard navigation (roving tabindex)', () => {
  it('only the selected tab has tabIndex 0, others have tabIndex -1', () => {
    state.appointments = []
    renderPanel()
    const tabs = screen.getAllByRole('tab')
    // First tab (To arrive) is selected by default
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    expect(tabs[2]).toHaveAttribute('tabindex', '-1')
  })

  it('ArrowRight moves focus to the next tab and selects it', async () => {
    state.appointments = []
    renderPanel()
    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveAttribute('tabindex', '0')
    expect(tabs[0]).toHaveAttribute('tabindex', '-1')
  })

  it('ArrowLeft wraps from the first tab to the last', async () => {
    state.appointments = []
    renderPanel()
    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(tabs[2]).toHaveAttribute('tabindex', '0')
  })

  it('End moves focus to the last tab', async () => {
    state.appointments = []
    renderPanel()
    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    await userEvent.keyboard('{End}')
    expect(tabs[2]).toHaveAttribute('tabindex', '0')
  })

  it('Home moves focus to the first tab', async () => {
    state.appointments = []
    renderPanel()
    const tabs = screen.getAllByRole('tab')
    // Start from last
    await userEvent.click(tabs[2])
    tabs[2].focus()
    await userEvent.keyboard('{Home}')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
  })
})
