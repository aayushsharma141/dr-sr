import '../../test/dialog-shim'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppointmentsReception } from '../AppointmentsReception'
import type { Appointment, AppointmentListResponse, DoctorOut, Me } from '../../api/types'
import { istToday } from '../../format'

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const today = istToday()
const tomorrow = shiftDate(today, 1)
const yesterday = shiftDate(today, -1)

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['appointment:read', 'appointment:write'],
  version_id: 1,
}

const doctorMe: Me = {
  ...mockMe,
  id: 3,
  role: 'DOCTOR',
  username: 'doctor',
  full_name: 'Dr. Madan Mohan Dwivedi',
  permissions: ['appointment:read', 'appointment:write', 'prescription:read'],
  doctor_id: 1,
}

const adminMe: Me = {
  ...mockMe,
  id: 1,
  role: 'ADMIN',
  username: 'admin',
  full_name: 'System Administrator',
  permissions: ['appointment:read'],
}

const mockDoctors: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr. Madan Mohan Dwivedi',
    name_hi: 'डॉ मदन मोहन द्विवेदी',
    qualification: 'Senior Physiotherapist',
    registration_number: 'PT-12345',
    default_fee_paise: 50000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
]

const mockDepartments = [
  { id: 1, name_en: 'Physiotherapy', name_hi: 'फिजियोथेरेपी', is_active: true },
]

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 10,
    patient_id: 101,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Aarav Kumar',
    patient_mobile: '9876543210',
    doctor_id: 1,
    doctor_name_en: 'Dr. Madan Mohan Dwivedi',
    doctor_name_hi: 'डॉ मदन मोहन द्विवेदी',
    department_name: 'Physiotherapy',
    appointment_date: today,
    expected_time: '10:30:00',
    token_number: 1,
    status: 'BOOKED',
    status_updated_at: '2026-01-01T10:00:00Z',
    cancellation_reason: null,
    notes: 'Knee rehabilitation',
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

type FetchOverride = (
  url: string,
  init?: RequestInit,
) => ReturnType<typeof jsonResponse> | undefined

function renderAppointments({
  me = mockMe,
  appointments = [makeAppointment()],
  followUps = [],
  initialEntries = ['/reception/appointments'],
  onFetch,
}: {
  me?: Me
  appointments?: Appointment[]
  followUps?: unknown[]
  initialEntries?: string[]
  onFetch?: FetchOverride
} = {}) {
  const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const custom = onFetch?.(url, init)
    if (custom) return Promise.resolve(custom)
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(me))
    if (url.includes('/api/doctors')) return Promise.resolve(jsonResponse(mockDoctors))
    if (url.includes('/api/departments')) return Promise.resolve(jsonResponse(mockDepartments))
    if (url.includes('/api/patients')) return Promise.resolve(jsonResponse([]))
    if (url.includes('/api/prescriptions/follow-ups')) return Promise.resolve(jsonResponse(followUps))
    if (url.includes('/api/appointments')) {
      const resp: AppointmentListResponse = {
        total: appointments.length,
        appointments,
      }
      return Promise.resolve(jsonResponse(resp))
    }
    return Promise.reject(new Error(`Unhandled: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AppointmentsReception />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { mockFetch }
}

describe('AppointmentsReception', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('Header, compact 5-column layout & Book Appointment modal', () => {
    it('renders reception header, compact 5-column table, and opens Book Appointment pre-filled with selected date', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 10, patient_name: 'Aarav Kumar', expected_time: '10:30:00', token_number: 1 }),
          makeAppointment({
            id: 11,
            patient_id: 102,
            patient_urn: 'KH-2026-0002',
            patient_name: 'Meera Devi',
            expected_time: null,
            token_number: null,
          }),
        ],
      })

      await screen.findByText('Aarav Kumar')

      // Reception header controls and single-view layout (no tablist, no New patient link)
      const main = screen.getByRole('main')
      expect(within(main).getByRole('heading', { level: 1, name: 'Appointments' })).toBeInTheDocument()
      expect(within(main).queryByRole('tablist')).not.toBeInTheDocument()
      expect(within(main).getByRole('button', { name: /book appointment/i })).toBeInTheDocument()
      expect(within(main).getByRole('link', { name: /check-in & token/i })).toHaveAttribute(
        'href',
        '/reception/tokens',
      )
      expect(within(main).queryByRole('link', { name: /new patient/i })).not.toBeInTheDocument()

      // Compact 5-column layout without Token column, mobile number, or Hindi doctor name
      const table = screen.getByRole('table')
      const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
      expect(headers).toEqual(['Time', 'Patient', 'Doctor', 'Status', 'Action'])
      expect(within(table).queryByText('#1')).not.toBeInTheDocument()

      const aaravRow = within(table).getByText('Aarav Kumar').closest('tr')!
      expect(within(aaravRow).getByText('10:30')).toBeInTheDocument()
      expect(within(aaravRow).getByRole('link', { name: 'Aarav Kumar' })).toHaveAttribute(
        'href',
        '/reception/patients/101',
      )
      expect(within(aaravRow).getByText('KH-2026-0001')).toBeInTheDocument()
      expect(within(aaravRow).queryByText('9876543210')).not.toBeInTheDocument()
      expect(within(aaravRow).getByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
      expect(within(aaravRow).getByText('Physiotherapy')).toBeInTheDocument()
      expect(within(aaravRow).queryByText('डॉ मदन मोहन द्विवेदी')).not.toBeInTheDocument()

      const meeraRow = within(table).getByText('Meera Devi').closest('tr')!
      expect(within(meeraRow).getByText('—')).toBeInTheDocument()
      expect(within(table).queryByText(/null/i)).not.toBeInTheDocument()

      // Shift selected date to tomorrow and open Book Appointment modal
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Next day' }))
      await user.click(screen.getByRole('button', { name: /book appointment/i }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Book New Appointment' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Appointment Date')).toHaveValue(tomorrow)
    })
  })

  describe('Appointment-specific statuses & lifecycle counts', () => {
    it('maps every active status to appointment-specific badges and toolbar counts', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 20, patient_name: 'P Booked', status: 'BOOKED' }),
          makeAppointment({ id: 21, patient_name: 'P ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 22, patient_name: 'P Registered', status: 'REGISTERED' }),
          makeAppointment({ id: 23, patient_name: 'P Arrived Only', status: 'ARRIVED', consultation_status: null }),
          makeAppointment({ id: 24, patient_name: 'P Arrived Waiting', status: 'ARRIVED', consultation_status: 'WAITING' }),
          makeAppointment({ id: 25, patient_name: 'P CheckedIn', status: 'CHECKED_IN' }),
          makeAppointment({ id: 26, patient_name: 'P Waiting', status: 'WAITING' }),
          makeAppointment({ id: 27, patient_name: 'P InConsult', status: 'IN_CONSULTATION' }),
          makeAppointment({ id: 28, patient_name: 'P Done', status: 'DONE' }),
          makeAppointment({ id: 29, patient_name: 'P Completed', status: 'COMPLETED' }),
          makeAppointment({ id: 30, patient_name: 'P NoShow', status: 'NO_SHOW' }),
        ],
      })

      await screen.findByText('P NoShow')

      const table = screen.getByRole('table')
      const expectRowBadge = (patient: string, label: string) => {
        const row = within(table).getByText(patient).closest('tr')!
        expect(within(row).getByText(label)).toBeInTheDocument()
      }

      expectRowBadge('P Booked', 'Booked')
      expectRowBadge('P ToArrive', 'Booked')
      expectRowBadge('P Registered', 'Booked')
      expectRowBadge('P Arrived Only', 'Arrived')
      expectRowBadge('P Arrived Waiting', 'Checked In')
      expectRowBadge('P CheckedIn', 'Checked In')
      expectRowBadge('P Waiting', 'Checked In')
      expectRowBadge('P InConsult', 'Checked In')
      expectRowBadge('P Done', 'Completed')
      expectRowBadge('P Completed', 'Completed')
      expectRowBadge('P NoShow', 'No-show')

      expect(within(table).getAllByText('Booked')).toHaveLength(3)
      expect(within(table).getAllByText('Arrived')).toHaveLength(1)
      expect(within(table).getAllByText('Checked In')).toHaveLength(4)
      expect(within(table).getAllByText('Completed')).toHaveLength(2)
      expect(within(table).getAllByText('No-show')).toHaveLength(1)

      // Live queue and billing labels must never appear on the appointments screen
      expect(screen.queryByText(/with doctor/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
      expect(screen.queryByText(/billing →/i)).not.toBeInTheDocument()

      // Toolbar lifecycle counts
      const hasCount = (text: string) =>
        screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === text)
      expect(hasCount('3 Booked')).toBeInTheDocument()
      expect(hasCount('1 Arrived')).toBeInTheDocument()
      expect(hasCount('4 Checked In')).toBeInTheDocument()
      expect(hasCount('2 Completed')).toBeInTheDocument()
    })
  })

  describe('Separate Cancelled filter (Active | Cancelled | All)', () => {
    it('hides cancelled and rescheduled rows by default, shows cancellation reason in Cancelled, and shows all in All', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 31, patient_name: 'Active Patient', status: 'BOOKED' }),
          makeAppointment({
            id: 32,
            patient_name: 'Cancelled Patient',
            status: 'CANCELLED',
            cancellation_reason: 'Patient travelled out of town',
          }),
          makeAppointment({ id: 33, patient_name: 'Rescheduled Patient', status: 'RESCHEDULED' }),
        ],
      })

      await screen.findByText('Active Patient')

      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      const activeBtn = filters.getByRole('button', { name: 'Active (1)' })
      const cancelledBtn = filters.getByRole('button', { name: 'Cancelled (1)' })
      const allBtn = filters.getByRole('button', { name: 'All (3)' })

      expect(activeBtn).toHaveAttribute('aria-pressed', 'true')
      expect(cancelledBtn).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByText('Cancelled Patient')).not.toBeInTheDocument()
      expect(screen.queryByText('Rescheduled Patient')).not.toBeInTheDocument()

      const user = userEvent.setup()
      await user.click(cancelledBtn)

      expect(cancelledBtn).toHaveAttribute('aria-pressed', 'true')
      const cancelledTable = screen.getByRole('table')
      expect(within(cancelledTable).getByText('Cancelled Patient')).toBeInTheDocument()
      expect(within(cancelledTable).getByText('Patient travelled out of town')).toBeInTheDocument()
      expect(within(cancelledTable).queryByText('Active Patient')).not.toBeInTheDocument()
      expect(within(cancelledTable).queryByText('Rescheduled Patient')).not.toBeInTheDocument()

      await user.click(allBtn)
      expect(allBtn).toHaveAttribute('aria-pressed', 'true')
      const allTable = screen.getByRole('table')
      expect(within(allTable).getByText('Active Patient')).toBeInTheDocument()
      expect(within(allTable).getByText('Cancelled Patient')).toBeInTheDocument()
      expect(within(allTable).getByText('Rescheduled Patient')).toBeInTheDocument()
      expect(within(allTable).getByText('Rescheduled')).toBeInTheDocument()
    })

    it('omits empty-state Book Appointment button when Cancelled filter has no rows', async () => {
      renderAppointments({
        appointments: [makeAppointment({ id: 34, patient_name: 'Active Only', status: 'BOOKED' })],
      })

      await screen.findByText('Active Only')

      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'Cancelled (0)' }))

      expect(
        screen.getByText('No cancelled appointments for this date and doctor.'),
      ).toBeInTheDocument()
      // Only the header primary CTA exists; no duplicate empty-state button inside Cancelled view
      expect(screen.getAllByRole('button', { name: /book appointment/i })).toHaveLength(1)
    })

    it('keeps filter pills visible when Active is empty and Cancelled has rows', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({
            id: 35,
            patient_name: 'Cancelled Only Patient',
            status: 'CANCELLED',
            cancellation_reason: 'Fever resolved',
          }),
        ],
      })

      await screen.findByText('No active appointments for this date and doctor.')

      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      const cancelledBtn = filters.getByRole('button', { name: 'Cancelled (1)' })
      expect(filters.getByRole('button', { name: 'Active (0)' })).toHaveAttribute('aria-pressed', 'true')

      const user = userEvent.setup()
      await user.click(cancelledBtn)

      expect(screen.getByText('Cancelled Only Patient')).toBeInTheDocument()
      expect(screen.getByText('Fever resolved')).toBeInTheDocument()
    })
  })

  describe('Reschedule modal', () => {
    it('shows Reschedule only on BOOKED, TO_ARRIVE, and NO_SHOW and posts reschedule payload', async () => {
      let reschedulePayload: unknown = null

      renderAppointments({
        appointments: [
          makeAppointment({ id: 40, patient_name: 'R Booked', status: 'BOOKED', version_id: 3 }),
          makeAppointment({ id: 41, patient_name: 'R ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 42, patient_name: 'R NoShow', status: 'NO_SHOW' }),
          makeAppointment({ id: 43, patient_name: 'R Registered', status: 'REGISTERED' }),
          makeAppointment({ id: 44, patient_name: 'R Arrived', status: 'ARRIVED' }),
          makeAppointment({ id: 45, patient_name: 'R Completed', status: 'COMPLETED' }),
        ],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/40/reschedule') && init?.method === 'POST') {
            reschedulePayload = JSON.parse(init.body as string)
            return jsonResponse(
              makeAppointment({ id: 40, appointment_date: tomorrow, expected_time: '11:15:00', version_id: 4 }),
            )
          }
          return undefined
        },
      })

      await screen.findByText('R Completed')

      const table = screen.getByRole('table')
      expect(within(table).getAllByRole('button', { name: 'Reschedule' })).toHaveLength(3)
      for (const name of ['R Booked', 'R ToArrive', 'R NoShow']) {
        const row = within(table).getByText(name).closest('tr')!
        expect(within(row).getByRole('button', { name: 'Reschedule' })).toBeInTheDocument()
      }
      for (const name of ['R Registered', 'R Arrived', 'R Completed']) {
        const row = within(table).getByText(name).closest('tr')!
        expect(within(row).queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()
      }

      const user = userEvent.setup()
      const bookedRow = within(table).getByText('R Booked').closest('tr')!
      await user.click(within(bookedRow).getByRole('button', { name: 'Reschedule' }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Reschedule Appointment' })).toBeInTheDocument()

      fireEvent.change(within(dialog).getByLabelText('New date *'), { target: { value: tomorrow } })
      fireEvent.change(within(dialog).getByLabelText('Expected time (optional)'), {
        target: { value: '11:15' },
      })
      await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Patient requested tomorrow')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Reschedule' }))

      await waitFor(() => {
        expect(reschedulePayload).toEqual({
          version_id: 3,
          appointment_date: tomorrow,
          expected_time: '11:15:00',
          reason: 'Patient requested tomorrow',
        })
      })
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('shows 422 reschedule error inline inside modal and preserves user input', async () => {
      renderAppointments({
        appointments: [makeAppointment({ id: 46, status: 'BOOKED' })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/46/reschedule') && init?.method === 'POST') {
            return jsonResponse(
              { code: 'invalid_reschedule', message: 'Doctor is unavailable on that date' },
              422,
            )
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Reschedule' }))

      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('New date *'), { target: { value: tomorrow } })
      fireEvent.change(within(dialog).getByLabelText('Expected time (optional)'), {
        target: { value: '14:30' },
      })
      await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Travel delay')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Reschedule' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Doctor is unavailable on that date',
      )
      expect(within(dialog).getByLabelText('New date *')).toHaveValue(tomorrow)
      expect(within(dialog).getByLabelText('Expected time (optional)')).toHaveValue('14:30')
      expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('Travel delay')
    })

    it('closes reschedule modal and renders ConflictBanner on 409 version_conflict', async () => {
      renderAppointments({
        appointments: [makeAppointment({ id: 47, status: 'BOOKED' })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/47/reschedule') && init?.method === 'POST') {
            return jsonResponse({ code: 'version_conflict', message: 'Stale version' }, 409)
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Reschedule' }))

      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('New date *'), { target: { value: tomorrow } })
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Reschedule' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(/modified by another user/i)
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    })
  })

  describe('Check in, No-Show & Cancel transitions and guards', () => {
    it('routes Check in to /reception/tokens without PATCH and enforces No-Show status/date guards', async () => {
      let patchedBody: unknown = null

      const { mockFetch } = renderAppointments({
        appointments: [
          makeAppointment({ id: 50, patient_id: 101, patient_name: 'G Booked', status: 'BOOKED' }),
          makeAppointment({ id: 51, patient_id: 102, patient_name: 'G ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 52, patient_id: 103, patient_name: 'G Registered', status: 'REGISTERED' }),
          makeAppointment({ id: 53, patient_id: 104, patient_name: 'G NoShow', status: 'NO_SHOW' }),
          makeAppointment({
            id: 54,
            patient_id: 105,
            patient_name: 'G Arrived',
            status: 'ARRIVED',
            consultation_status: 'WAITING',
          }),
        ],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/50/status') && init?.method === 'PATCH') {
            patchedBody = JSON.parse(init.body as string)
            return jsonResponse(makeAppointment({ id: 50, status: 'NO_SHOW', version_id: 2 }))
          }
          return undefined
        },
      })

      await screen.findByText('G Arrived')

      const table = screen.getByRole('table')
      const bookedRow = within(table).getByText('G Booked').closest('tr')!
      const toArriveRow = within(table).getByText('G ToArrive').closest('tr')!
      const registeredRow = within(table).getByText('G Registered').closest('tr')!
      const noShowRow = within(table).getByText('G NoShow').closest('tr')!
      const arrivedRow = within(table).getByText('G Arrived').closest('tr')!

      // Check in appears on today's unarrived bookings (BOOKED, TO_ARRIVE, REGISTERED, NO_SHOW)
      expect(within(bookedRow).getByRole('link', { name: 'Check in' })).toHaveAttribute(
        'href',
        '/reception/tokens?patient_id=101&appointment_id=50',
      )
      expect(within(toArriveRow).getByRole('link', { name: 'Check in' })).toBeInTheDocument()
      expect(within(registeredRow).getByRole('link', { name: 'Check in' })).toBeInTheDocument()
      expect(within(noShowRow).getByRole('link', { name: 'Check in' })).toHaveAttribute(
        'href',
        '/reception/tokens?patient_id=104&appointment_id=53',
      )
      expect(within(arrivedRow).queryByRole('link', { name: 'Check in' })).not.toBeInTheDocument()

      // Clicking Check in does not PATCH /status
      const user = userEvent.setup()
      await user.click(within(bookedRow).getByRole('link', { name: 'Check in' }))
      expect(patchedBody).toBeNull()
      expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/status'), expect.anything())

      // No-Show appears only on BOOKED and TO_ARRIVE (hidden on REGISTERED, NO_SHOW, ARRIVED)
      expect(within(table).getAllByRole('button', { name: 'No-Show' })).toHaveLength(2)
      expect(within(bookedRow).getByRole('button', { name: 'No-Show' })).toBeInTheDocument()
      expect(within(toArriveRow).getByRole('button', { name: 'No-Show' })).toBeInTheDocument()
      expect(within(registeredRow).queryByRole('button', { name: 'No-Show' })).not.toBeInTheDocument()
      expect(within(noShowRow).queryByRole('button', { name: 'No-Show' })).not.toBeInTheDocument()
      expect(within(arrivedRow).queryByRole('button', { name: 'No-Show' })).not.toBeInTheDocument()

      await user.click(within(bookedRow).getByRole('button', { name: 'No-Show' }))
      await waitFor(() => {
        expect(patchedBody).toEqual({
          status: 'NO_SHOW',
          version_id: 1,
          cancellation_reason: null,
        })
      })
    })

    it('hides Check in and No-Show on future dates and keeps No-Show on past dates', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 55, patient_name: 'Future Booking', appointment_date: tomorrow, status: 'BOOKED' }),
          makeAppointment({ id: 56, patient_name: 'Past Booking', appointment_date: yesterday, status: 'BOOKED' }),
        ],
      })

      await screen.findByText('Past Booking')
      const table = screen.getByRole('table')

      const futureRow = within(table).getByText('Future Booking').closest('tr')!
      expect(within(futureRow).queryByRole('link', { name: 'Check in' })).not.toBeInTheDocument()
      expect(within(futureRow).queryByRole('button', { name: 'No-Show' })).not.toBeInTheDocument()
      expect(within(futureRow).getByRole('button', { name: 'Reschedule' })).toBeInTheDocument()
      expect(within(futureRow).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

      const pastRow = within(table).getByText('Past Booking').closest('tr')!
      expect(within(pastRow).queryByRole('link', { name: 'Check in' })).not.toBeInTheDocument()
      expect(within(pastRow).getByRole('button', { name: 'No-Show' })).toBeInTheDocument()
    })

    it('enforces Cancel visibility guards across statuses', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 60, patient_name: 'C Booked', status: 'BOOKED' }),
          makeAppointment({ id: 61, patient_name: 'C ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 62, patient_name: 'C Registered', status: 'REGISTERED' }),
          makeAppointment({ id: 63, patient_name: 'C Arrived', status: 'ARRIVED', consultation_status: null }),
          makeAppointment({ id: 64, patient_name: 'C CheckedIn', status: 'CHECKED_IN', consultation_status: 'WAITING' }),
          makeAppointment({ id: 65, patient_name: 'C Waiting', status: 'WAITING', consultation_status: 'WAITING' }),
          makeAppointment({ id: 66, patient_name: 'C NoShow', status: 'NO_SHOW' }),
          makeAppointment({ id: 67, patient_name: 'C InConsult', status: 'IN_CONSULTATION' }),
          makeAppointment({ id: 68, patient_name: 'C Done', status: 'DONE' }),
          makeAppointment({ id: 69, patient_name: 'C Completed', status: 'COMPLETED' }),
          makeAppointment({ id: 70, patient_name: 'C Cancelled', status: 'CANCELLED' }),
          makeAppointment({ id: 71, patient_name: 'C Rescheduled', status: 'RESCHEDULED' }),
        ],
      })

      await screen.findByText('C Completed')
      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'All (12)' }))

      const table = screen.getByRole('table')
      for (const name of ['C Booked', 'C ToArrive', 'C Registered', 'C Arrived', 'C CheckedIn', 'C Waiting']) {
        const row = within(table).getByText(name).closest('tr')!
        expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      }
      for (const name of ['C NoShow', 'C InConsult', 'C Done', 'C Completed', 'C Cancelled', 'C Rescheduled']) {
        const row = within(table).getByText(name).closest('tr')!
        expect(within(row).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      }
    })

    it('submits Cancel PATCH with reason and clears cancelReason when dismissed', async () => {
      let cancelBody: unknown = null

      renderAppointments({
        appointments: [makeAppointment({ id: 72, status: 'BOOKED', version_id: 2 })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/72/status') && init?.method === 'PATCH') {
            cancelBody = JSON.parse(init.body as string)
            return jsonResponse(makeAppointment({ id: 72, status: 'CANCELLED', version_id: 3 }))
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()

      // Dismissing via Keep appointment clears typed reason on reopen
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      let dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText('Cancellation reason *'), 'Draft reason')
      await user.click(within(dialog).getByRole('button', { name: 'Keep appointment' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      dialog = await screen.findByRole('dialog')
      const textarea = within(dialog).getByLabelText('Cancellation reason *')
      expect(textarea).toHaveValue('')

      await user.type(textarea, 'Patient unwell today')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Cancellation' }))

      await waitFor(() => {
        expect(cancelBody).toEqual({
          status: 'CANCELLED',
          version_id: 2,
          cancellation_reason: 'Patient unwell today',
        })
      })
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('shows 422 Cancel error inline inside dialog and handles 409 ConflictBanner', async () => {
      let attempt = 0

      renderAppointments({
        appointments: [makeAppointment({ id: 73, status: 'BOOKED' })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/73/status') && init?.method === 'PATCH') {
            attempt += 1
            if (attempt === 1) {
              return jsonResponse(
                { code: 'invalid_transition', message: 'Appointment is already in consultation' },
                422,
              )
            }
            return jsonResponse({ code: 'version_conflict', message: 'Conflict' }, 409)
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText('Cancellation reason *'), 'Patient called')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Cancellation' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Appointment is already in consultation',
      )
      expect(within(dialog).getByLabelText('Cancellation reason *')).toHaveValue('Patient called')

      // Second submit hits 409 -> closes dialog and renders ConflictBanner
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Cancellation' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(/modified by another user/i)
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    })
  })

  describe('Role preservation (ADMIN & DOCTOR)', () => {
    it('keeps appointment actions read-only for ADMIN', async () => {
      renderAppointments({ me: adminMe })

      await screen.findByText('Aarav Kumar')

      expect(screen.getByText('Read-only schedule')).toBeInTheDocument()
      expect(screen.getByText('View only')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /book appointment/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /check-in & token/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Check in' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'No-Show' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('opens the doctor-only prescription follow-up tab from its deep link', async () => {
      const followUps = [
        {
          id: 71,
          patient_id: 101,
          patient_urn: 'KH-2026-0001',
          patient_name: 'Aarav Kumar',
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          encounter_id: null,
          diagnosis: 'Knee rehabilitation',
          items_count: 2,
          follow_up_date: shiftDate(today, 10),
          created_at: '2026-11-01T10:00:00Z',
        },
      ]

      const { mockFetch } = renderAppointments({
        me: doctorMe,
        appointments: [],
        followUps,
        initialEntries: ['/reception/appointments?tab=followup'],
      })

      await screen.findByText('Aarav Kumar')

      expect(screen.getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('Knee rehabilitation')).toBeInTheDocument()
      expect(screen.getByText('Upcoming')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open patient' })).toHaveAttribute(
        'href',
        '/reception/patients/101',
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/prescriptions/follow-ups'),
        expect.anything(),
      )
    })

    it('preserves DOCTOR tablist, OPD cabin pacing controls, and restricts reception-only actions on Schedule', async () => {
      renderAppointments({
        me: doctorMe,
        appointments: [
          makeAppointment({ id: 80, patient_name: 'Doc Booked', status: 'BOOKED' }),
          makeAppointment({
            id: 81,
            patient_name: 'Doc CheckedIn Waiting',
            status: 'ARRIVED',
            consultation_status: 'WAITING',
          }),
          makeAppointment({
            id: 82,
            patient_name: 'Doc Waiting Status',
            status: 'CHECKED_IN',
            consultation_status: 'WAITING',
          }),
        ],
      })

      // Doctor lands on Follow-ups with Follow-ups / Schedule tablist
      expect(await screen.findByRole('heading', { level: 1, name: 'Follow-ups' })).toBeInTheDocument()
      expect(screen.getByRole('tablist')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('tab', { name: 'Appointments' })).not.toBeInTheDocument()

      const user = userEvent.setup()
      await user.click(screen.getByRole('tab', { name: 'Schedule' }))
      expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument()

      await screen.findByText('Doc CheckedIn Waiting')

      // Pacing banner and local-only emergency hold
      expect(screen.getByText(/OPD Cabin Pacing & Doctor Schedule/i)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Mark emergency hold/i }))
      expect(screen.getByText(/marked on this screen only/i)).toBeInTheDocument()
      expect(screen.getByText('NOT SENT')).toBeInTheDocument()
      expect(screen.getByText(/Resume normal queue/i)).toBeInTheDocument()

      // Doctor RBAC guards on Schedule
      expect(screen.queryByRole('link', { name: /check-in & token/i })).not.toBeInTheDocument()
      const table = screen.getByRole('table')
      expect(within(table).queryByRole('link', { name: 'Check in' })).not.toBeInTheDocument()
      expect(within(table).queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()

      const bookedRow = within(table).getByText('Doc Booked').closest('tr')!
      expect(within(bookedRow).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

      const arrivedWaitingRow = within(table).getByText('Doc CheckedIn Waiting').closest('tr')!
      expect(within(arrivedWaitingRow).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

      const checkedInRow = within(table).getByText('Doc Waiting Status').closest('tr')!
      expect(within(checkedInRow).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })
  })
})
