import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TodayAppointmentsPanel } from '../checkin/TodayAppointmentsPanel'
import type { Appointment, OpdArrival } from '../../api/types'

vi.mock('../../api/queries', () => ({
  useAppointments: () => ({
    data: { appointments: state.appointments },
    isPending: false,
    isError: Boolean(state.appointmentsError),
    error: state.appointmentsError,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useOpdArrivals: () => ({
    data: { arrivals: state.arrivals },
    isPending: false,
    isError: Boolean(state.arrivalsError),
    error: state.arrivalsError,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useUpdateAppointmentStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelOpdArrival: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRescheduleAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePriority: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOpdArrivalPriority: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConsultingDoctors: () => ({ options: [], isPending: false }),
}))

vi.mock('../../format', () => ({
  istToday: () => '2026-11-15',
  formatToken: (n: number | null, cabin?: string | null) => (n != null ? (cabin ? `${cabin}-${n}` : `#${n}`) : '—'),
}))

const state: {
  appointments: Appointment[]
  arrivals: OpdArrival[]
  appointmentsError: Error | null
  arrivalsError: Error | null
} = { appointments: [], arrivals: [], appointmentsError: null, arrivalsError: null }

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

function renderPanel(
  opts:
    | ((arrival: OpdArrival) => void)
    | {
        onCheckIn?: (booking: Appointment) => void
        onRegisterArrival?: (arrival: OpdArrival) => void
        onRegisterPatient?: (booking: Appointment) => void
        canCheckIn?: boolean
        canRegister?: boolean
        canManage?: boolean
      } = {},
) {
  const resolved = typeof opts === 'function' ? { onRegisterArrival: opts } : opts
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TodayAppointmentsPanel
        activeBookingId={null}
        canCheckIn={resolved.canCheckIn ?? true}
        canRegister={resolved.canRegister ?? true}
        canManage={resolved.canManage ?? true}
        onCheckIn={resolved.onCheckIn ?? vi.fn()}
        onRegisterArrival={resolved.onRegisterArrival ?? vi.fn()}
        onRegisterPatient={resolved.onRegisterPatient ?? vi.fn()}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  state.appointments = []
  state.arrivals = []
  state.appointmentsError = null
  state.arrivalsError = null
})

describe('TodayAppointmentsPanel status labels and colours', () => {
  it('shows "Checked In" with emerald classes for ARRIVED/WAITING', async () => {
    state.appointments = [appt({ id: 1, status: 'ARRIVED', consultation_status: 'WAITING' })]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = within(screen.getByRole('table')).getByText('Checked In')
    expect(badge.className).toMatch(/bg-emerald-50/)
    expect(badge.className).toMatch(/text-emerald-800/)
  })

  it('shows "Checked In" with emerald classes for IN_CONSULTATION status', async () => {
    state.appointments = [appt({ id: 2, status: 'IN_CONSULTATION' })]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = within(screen.getByRole('table')).getByText('Checked In')
    expect(badge.className).toMatch(/bg-emerald-50/)
    expect(badge.className).toMatch(/text-emerald-800/)
  })

  it('shows "Checked In" with emerald classes for DONE status', async () => {
    state.appointments = [appt({ id: 3, status: 'DONE' })]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = within(screen.getByRole('table')).getByText('Checked In')
    expect(badge.className).toMatch(/bg-emerald-50/)
    expect(badge.className).toMatch(/text-emerald-800/)
  })

  it('shows an error when pending arrivals fail to load', () => {
    state.arrivalsError = new Error('Network unavailable')
    renderPanel()

    expect(screen.getByRole('alert')).toHaveTextContent('Queue data could not load. Refresh to try again.')
    expect(screen.getByRole('alert')).toHaveTextContent('Pending arrivals: Network unavailable')
    expect(screen.queryByText('No patients today.')).not.toBeInTheDocument()
  })

  it('shows "Cancelled" with slate-600 and no red class for CANCELLED status', async () => {
    state.appointments = [appt({ id: 5, status: 'CANCELLED' })]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)
    const badge = within(screen.getByRole('table')).getByText('Cancelled')
    expect(badge.className).toMatch(/bg-slate-100/)
    expect(badge.className).toMatch(/text-slate-600/)
    expect(badge.className).not.toMatch(/red/)
  })

  it('shows "To arrive" with amber classes for pending arrival awaiting registration', () => {
    state.arrivals = [{
      id: 6,
      full_name: 'Test Arrival',
      age_years: 28,
      mobile: '9876543210',
      doctor_id: 1,
      doctor_name_en: 'Dr. Anil',
      department_id: 10,
      department_name: 'General Medicine',
      appointment_date: '2026-11-15',
      token_number: 1,
      priority_level: 'NORMAL',
      status: 'TO_ARRIVE',
      version_id: 1,
      created_at: '2026-11-15T03:00:00Z',
    }]
    renderPanel()
    const badge = within(screen.getByRole('table')).getByText('To arrive')
    expect(badge.className).toMatch(/bg-amber-50/)
    expect(badge.className).toMatch(/text-amber-800/)
  })

  it('promotes REGISTERED patient directly to Checked In tab', async () => {
    state.appointments = [appt({ id: 88, status: 'REGISTERED', token_number: 2, patient_name: 'Registered Patient' })]
    renderPanel()
    expect(screen.getByRole('tab', { name: /Checked In/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /To Arrive/ })).toHaveTextContent('0')
    const checkedTab = screen.getByRole('tab', { name: /Checked In/ })
    await userEvent.click(checkedTab)
    expect(screen.getByText('Registered Patient')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Checked In')).toBeInTheDocument()
  })

  it('promotes tokenized existing patient directly to Checked In tab and uses compact 5-column layout', async () => {
    state.appointments = [
      appt({
        id: 9,
        status: 'TO_ARRIVE',
        visit_kind: 'FOLLOW_UP',
        token_number: 2,
        patient_name: 'Rahul Kumar',
        patient_urn: 'KH-9876',
        patient_mobile: '9123456789',
        patient_age: 42,
      } as Partial<Appointment>),
    ]
    renderPanel()
    expect(screen.getByRole('tab', { name: /Checked In/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /To Arrive/ })).toHaveTextContent('0')
    const checkedTab = screen.getByRole('tab', { name: /Checked In/ })
    await userEvent.click(checkedTab)

    const table = screen.getByRole('table')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headers).toEqual(['Token', 'Patient', 'Doctor', 'Status', 'Action'])
    expect(within(table).queryByText('Patient Type')).not.toBeInTheDocument()
    expect(within(table).getByText('Rahul Kumar')).toBeInTheDocument()
    expect(within(table).queryByText('Existing patient')).not.toBeInTheDocument()
    expect(within(table).queryByText(/KH-9876/)).not.toBeInTheDocument()
    expect(within(table).queryByText(/9123456789/)).not.toBeInTheDocument()
    expect(within(table).queryByText(/42 yrs/)).not.toBeInTheDocument()
    expect(within(table).queryByText('Normal')).not.toBeInTheDocument()
    expect(within(table).getByText('Checked In')).toBeInTheDocument()

    // Search still matches URN and mobile even though they are omitted from the Patient cell
    const searchInput = screen.getByPlaceholderText(/Search name, URN, mobile or token/i)
    await userEvent.type(searchInput, 'KH-9876')
    expect(within(screen.getByRole('table')).getByText('Rahul Kumar')).toBeInTheDocument()
    await userEvent.clear(searchInput)
    await userEvent.type(searchInput, '9123456789')
    expect(within(screen.getByRole('table')).getByText('Rahul Kumar')).toBeInTheDocument()
  })

  it('renders "Register" primary CTA and "More" -> "Cancel arrival" for pending arrival rows', async () => {
    state.arrivals = [{
      id: 8,
      full_name: 'Aayush',
      age_years: 26,
      mobile: '9876543210',
      doctor_id: 1,
      doctor_name_en: 'Dr. Anil',
      department_id: 10,
      department_name: 'General Medicine',
      appointment_date: '2026-11-15',
      token_number: 1,
      priority_level: 'NORMAL',
      status: 'TO_ARRIVE',
      version_id: 1,
      created_at: '2026-11-15T03:00:00Z',
    }]
    renderPanel()
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument()
    const moreBtn = screen.getByRole('button', { name: 'More' })
    expect(moreBtn).toHaveAttribute('aria-haspopup', 'menu')
    expect(moreBtn).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(moreBtn)
    expect(moreBtn).toHaveAttribute('aria-expanded', 'true')
    const cancelItem = screen.getByRole('menuitem', { name: 'Cancel arrival' })
    await userEvent.click(cancelItem)

    expect(screen.getByText("Cancel Aayush's arrival")).toBeInTheDocument()
    expect(screen.getByLabelText('Reason *')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel arrival' })).toBeInTheDocument()
  })

  it('offers Change priority inside More menu for tokenized rows and omits it when no token', async () => {
    state.appointments = [
      appt({ id: 1, token_number: 3, patient_name: 'Existing Pat', status: 'ARRIVED', consultation_status: 'WAITING' }),
      appt({ id: 2, token_number: null, patient_name: 'No Token Pat', status: 'BOOKED' }),
    ]
    state.arrivals = [{
      id: 3,
      full_name: 'Walk In Pat',
      age_years: 30,
      mobile: '9876543210',
      doctor_id: 1,
      doctor_name_en: 'Dr. Anil',
      department_id: 10,
      department_name: 'General',
      appointment_date: '2026-11-15',
      token_number: 1,
      priority_level: 'NORMAL',
      status: 'TO_ARRIVE',
      version_id: 1,
      created_at: '2026-11-15T03:00:00Z',
    }]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    await userEvent.click(allTab)

    const existingRow = screen.getByText('Existing Pat').closest('tr')!
    await userEvent.click(within(existingRow).getByRole('button', { name: 'More' }))
    expect(within(existingRow).getByRole('menuitem', { name: 'Change priority' })).toBeInTheDocument()

    // Opening another row's More menu closes the previous one
    const walkInRow = screen.getByText('Walk In Pat').closest('tr')!
    await userEvent.click(within(walkInRow).getByRole('button', { name: 'More' }))
    expect(within(existingRow).queryByRole('menu')).not.toBeInTheDocument()
    expect(within(walkInRow).getByRole('menuitem', { name: 'Change priority' })).toBeInTheDocument()

    // Row without token (No Token Pat) has no Change priority menuitem
    const noTokenRow = screen.getByText('No Token Pat').closest('tr')!
    await userEvent.click(within(noTokenRow).getByRole('button', { name: 'More' }))
    expect(within(noTokenRow).queryByRole('menuitem', { name: 'Change priority' })).not.toBeInTheDocument()
  })

  it('shows breakdown of active and cancelled appointments in header subtitle', () => {
    state.appointments = [
      appt({ id: 1, status: 'BOOKED', token_number: 1 }),
      appt({ id: 2, status: 'CANCELLED', token_number: 2 }),
    ]
    renderPanel()
    const allTab = screen.getByRole('tab', { name: /All/ })
    expect(allTab).toHaveTextContent('All (2)')
    expect(allTab).not.toHaveTextContent('1 active · 1 cancelled')
    expect(screen.getByText(/1 active · 1 cancelled/)).toBeInTheDocument()
  })

  it('dynamically updates tab counts when searching', async () => {
    state.arrivals = [
      {
        id: 1,
        full_name: 'Alpha User',
        age_years: 25,
        mobile: '9876543210',
        doctor_id: 1,
        doctor_name_en: 'Dr. Anil',
        department_id: 10,
        department_name: 'General',
        appointment_date: '2026-11-15',
        token_number: 1,
        priority_level: 'NORMAL',
        status: 'TO_ARRIVE',
        version_id: 1,
        created_at: '2026-11-15T03:00:00Z',
      },
      {
        id: 2,
        full_name: 'Beta User',
        age_years: 30,
        mobile: '9876543211',
        doctor_id: 1,
        doctor_name_en: 'Dr. Anil',
        department_id: 10,
        department_name: 'General',
        appointment_date: '2026-11-15',
        token_number: 2,
        priority_level: 'NORMAL',
        status: 'TO_ARRIVE',
        version_id: 1,
        created_at: '2026-11-15T03:00:00Z',
      },
    ]
    renderPanel()
    expect(screen.getByRole('tab', { name: /To Arrive/ })).toHaveTextContent('2')

    const searchInput = screen.getByPlaceholderText(/Search name, URN, mobile or token/i)
    await userEvent.type(searchInput, 'Alpha')

    expect(screen.getByRole('tab', { name: /To Arrive/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('1')
  })

  it('shows persisted new arrival before permanent registration and opens registration', async () => {
    const registerArrival = vi.fn()
    state.arrivals = [{
      id: 12,
      full_name: 'Aayush Kumar',
      age_years: 26,
      mobile: '9876543210',
      doctor_id: 1,
      doctor_name_en: 'Dr. Anil',
      department_id: 10,
      department_name: 'General Medicine',
      appointment_date: '2026-11-15',
      token_number: 3,
      priority_level: 'PRIORITY',
      priority_reason: 'Needs preferential attention',
      status: 'TO_ARRIVE',
      version_id: 1,
      created_at: '2026-11-15T03:00:00Z',
    }]
    const user = userEvent.setup()
    renderPanel(registerArrival)

    expect(screen.getByText('Aayush Kumar')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(registerArrival).toHaveBeenCalledWith(state.arrivals[0])
  })

  it('requires a reason when changing a pending arrival priority and returns focus to More', async () => {
    state.arrivals = [{
      id: 13,
      full_name: 'Aayush Kumar',
      age_years: 26,
      mobile: '9876543210',
      doctor_id: 1,
      doctor_name_en: 'Dr. Anil',
      department_id: 10,
      department_name: 'General Medicine',
      appointment_date: '2026-11-15',
      token_number: 4,
      priority_level: 'NORMAL',
      status: 'TO_ARRIVE',
      version_id: 2,
      created_at: '2026-11-15T03:00:00Z',
    }]
    renderPanel()

    const moreBtn = screen.getByRole('button', { name: 'More' })
    await userEvent.click(moreBtn)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change priority' }))
    expect(screen.getByLabelText('Priority *')).toHaveFocus()
    await userEvent.selectOptions(screen.getByLabelText('Priority *'), 'EMERGENCY')
    await userEvent.click(screen.getByRole('button', { name: 'Save priority' }))
    expect(screen.getByLabelText('Reason *')).toBeRequired()

    await userEvent.type(screen.getByLabelText('Reason *'), 'Severe acute pain')
    await userEvent.click(screen.getByRole('button', { name: 'Save priority' }))
    await waitFor(() => expect(screen.queryByLabelText('Reason *')).not.toBeInTheDocument())
    expect(moreBtn).toHaveFocus()
  })

  it('opens priority dropdown with Normal, High, Emergency and mandatory reason via More menu', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change priority' }))

    const select = screen.getByRole('combobox', { name: /Priority \*/i })
    expect(select).toBeInTheDocument()
    expect(screen.getByText(/Normal \(Regular queue\)/)).toBeInTheDocument()
    expect(screen.getByText(/High \(Needs preferential attention\)/)).toBeInTheDocument()
    expect(screen.getByText(/Emergency \(Immediate clinical attention\)/)).toBeInTheDocument()

    const reasonInput = screen.getByPlaceholderText(/Enter reason for updating priority/i)
    expect(reasonInput).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save priority' })).toBeInTheDocument()
  })

  it('keeps unarrived BOOKED appointments (including FOLLOW_UP with URN) in To Arrive with Check in CTA and booking cancellation', async () => {
    const onCheckIn = vi.fn()
    const booked = appt({
      id: 21,
      status: 'BOOKED',
      visit_kind: 'FOLLOW_UP',
      patient_urn: 'KH-0042',
      patient_name: 'Meera Devi',
      token_number: null,
      consultation_status: null,
      priority_level: 'PRIORITY',
      priority_reason: 'Senior citizen',
    })
    state.appointments = [booked]
    renderPanel({ onCheckIn })

    expect(screen.getByRole('tab', { name: /To Arrive/ })).toHaveTextContent('To Arrive (1)')
    expect(screen.getByRole('tab', { name: /Checked In/ })).toHaveTextContent('Checked In (0)')
    expect(within(screen.getByRole('table')).getByText('Meera Devi')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('High')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Check in' }))
    expect(onCheckIn).toHaveBeenCalledWith(booked)

    const moreBtn = screen.getByRole('button', { name: 'More' })
    await userEvent.click(moreBtn)
    expect(screen.getByRole('menuitem', { name: 'No-show' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reschedule' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Change priority' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel booking' }))
    expect(screen.getByText("Cancel Meera Devi's booking")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument()
  })

  it('keeps NO_SHOW appointments in To Arrive with Check in and Reschedule only (never Cancel booking)', async () => {
    const onCheckIn = vi.fn()
    const noShow = appt({
      id: 22,
      status: 'NO_SHOW',
      patient_urn: 'KH-0043',
      patient_name: 'Suresh Verma',
      token_number: null,
      consultation_status: null,
    })
    state.appointments = [noShow]
    renderPanel({ onCheckIn })

    expect(screen.getByRole('tab', { name: /To Arrive/ })).toHaveTextContent('To Arrive (1)')
    await userEvent.click(screen.getByRole('button', { name: 'Check in' }))
    expect(onCheckIn).toHaveBeenCalledWith(noShow)

    const moreBtn = screen.getByRole('button', { name: 'More' })
    await userEvent.click(moreBtn)
    expect(screen.getByRole('menuitem', { name: 'Reschedule' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Cancel booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'No-show' })).not.toBeInTheDocument()

    // Escape closes the More menu and returns focus to the More button
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(moreBtn).toHaveFocus()
  })

  it('calls onRegisterPatient for non-pending unregistered TO_ARRIVE appointments', async () => {
    const onRegisterPatient = vi.fn()
    const unregistered = appt({
      id: 23,
      status: 'TO_ARRIVE',
      patient_urn: '',
      visit_kind: 'NEW',
      token_number: 5,
      consultation_status: null,
      patient_name: 'Kiran Rao',
    })
    state.appointments = [unregistered]
    renderPanel({ onRegisterPatient })

    expect(screen.getByRole('tab', { name: /To Arrive/ })).toHaveTextContent('To Arrive (1)')
    await userEvent.click(screen.getByRole('button', { name: 'Register' }))
    expect(onRegisterPatient).toHaveBeenCalledWith(unregistered)
  })

  it('renders dash in Action column when neither primary CTA nor More items apply', async () => {
    state.appointments = [appt({ id: 24, status: 'CANCELLED', patient_name: 'Cancelled Pat' })]
    renderPanel()
    await userEvent.click(screen.getByRole('tab', { name: /All/ }))

    const row = screen.getByText('Cancelled Pat').closest('tr')!
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    const cells = within(row).getAllByRole('cell')
    expect(cells[4]).toHaveTextContent('—')
  })
})

describe('TodayAppointmentsPanel tablist keyboard navigation (roving tabindex)', () => {
  it('only the selected tab has tabIndex 0, others have tabIndex -1', () => {
    state.appointments = []
    renderPanel()
    const tabs = screen.getAllByRole('tab')
    // The reception queue opens on To arrive, as in the desk workflow.
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[0]).toHaveAttribute('tabindex', '-1')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('tabindex', '0')
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
