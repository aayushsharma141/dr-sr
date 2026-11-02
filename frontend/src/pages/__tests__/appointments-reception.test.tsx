import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppointmentsReception } from '../AppointmentsReception'
import type { Appointment, AppointmentListResponse, DoctorOut, Me } from '../../api/types'

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

function clinicDateAfter(days: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

const mockAppointments: Appointment[] = [
  {
    id: 10,
    patient_id: 101,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Aarav Kumar',
    patient_mobile: '9876543210',
    doctor_id: 1,
    doctor_name_en: 'Dr. Madan Mohan Dwivedi',
    doctor_name_hi: 'डॉ मदन मोहन द्विवेदी',
    appointment_date: clinicDateAfter(0),
    booking_mode: 'WALK_IN',
    visit_type: 'NEW_CONSULTATION',
    treatment_plan_id: null,
    token_number: 1,
    status: 'BOOKED',
    status_updated_at: '2026-01-01T10:00:00Z',
    cancellation_reason: null,
    notes: 'Knee rehabilitation',
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
]

describe('AppointmentsReception Component', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders reception appointments board and displays booked appointments with tokens', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/appointments')) {
        const resp: AppointmentListResponse = {
          total: 1,
          appointments: mockAppointments,
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(resp)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('#1')).toBeInTheDocument()
    })

    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect(screen.getAllByText('Dr. Madan Mohan Dwivedi')[0]).toBeInTheDocument()
    expect(screen.getByText('Mark Arrived')).toBeInTheDocument()
  })

  it('transitions appointment status to ARRIVED when Mark Arrived is clicked', async () => {
    let patchedBody: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/appointments/10/status') && init?.method === 'PATCH') {
        patchedBody = JSON.parse(init.body as string)
        const updated = { ...mockAppointments[0], status: 'ARRIVED', version_id: 2 }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(updated)),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 1, appointments: mockAppointments })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Mark Arrived')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Mark Arrived'))

    await waitFor(() => {
      expect(patchedBody).toEqual({
        status: 'ARRIVED',
        version_id: 1,
        cancellation_reason: null,
      })
    })
  })

  it('opens cancellation reason dialog and cancels appointment', async () => {
    let cancelBody: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/appointments/10/status') && init?.method === 'PATCH') {
        cancelBody = JSON.parse(init.body as string)
        const updated = { ...mockAppointments[0], status: 'CANCELLED', version_id: 2 }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(updated)),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 1, appointments: mockAppointments })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Cancel'))

    // Dialog appears
    expect(screen.getByPlaceholderText(/reason for cancellation/i)).toBeInTheDocument()

    // Type reason and submit
    await user.type(screen.getByPlaceholderText(/reason for cancellation/i), 'Patient unwell today')
    await user.click(screen.getByText('Confirm Cancellation'))

    await waitFor(() => {
      expect(cancelBody).toEqual({
        status: 'CANCELLED',
        version_id: 1,
        cancellation_reason: 'Patient unwell today',
      })
    })
  })

  it('opens the doctor-only prescription follow-up tab from its deep link', async () => {
    const doctorMe: Me = {
      ...mockMe,
      role: 'DOCTOR',
      username: 'doctor',
      full_name: 'Consulting Doctor',
      permissions: ['appointment:read', 'appointment:write', 'prescription:read'],
      doctor_id: 1,
    }
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
        follow_up_date: '2026-11-20',
        created_at: '2026-11-01T10:00:00Z',
      },
    ]

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(doctorMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/prescriptions/follow-ups')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(followUps)),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 0, appointments: [] })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/appointments?tab=followup']}>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    })

    expect(screen.getByRole('tab', { name: 'Follow-up Visits' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Knee rehabilitation')).toBeInTheDocument()
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open patient' })).toHaveAttribute('href', '/reception/patients/101')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/prescriptions/follow-ups'),
      expect.anything(),
    )
  })

  it('keeps appointment actions read-only for ADMIN', async () => {
    const adminMe: Me = {
      ...mockMe,
      role: 'ADMIN',
      username: 'admin',
      full_name: 'System Administrator',
      permissions: ['appointment:read'],
    }
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(adminMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 1, appointments: mockAppointments })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    })

    expect(screen.getByText('Read-only schedule')).toBeInTheDocument()
    expect(screen.getByText('View only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /book new appointment/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark arrived/i })).not.toBeInTheDocument()
  })

  it('keeps scheduled booking available on the Scheduled Visits tab and searches patients only after typing', async () => {
    const scheduledDate = clinicDateAfter(3)
    const scheduledAppointment: Appointment = {
      ...mockAppointments[0],
      appointment_date: scheduledDate,
      booking_mode: 'SCHEDULED',
      visit_type: 'FOLLOW_UP',
      token_number: 1,
    }
    const activePatient = {
      id: 101,
      urn: 'KH-2026-0001',
      full_name: 'Aarav Kumar',
      guardian_name: 'Suresh Kumar',
      gender: 'M',
      dob: null,
      age_years: 30,
      mobile: '9876543210',
      address: 'Station Road, Ara',
      district: 'Bhojpur',
      state: 'Bihar',
      emergency_contact: null,
      allergies: 'None reported',
      notes: null,
      photo_path: null,
      is_active: true,
      version_id: 1,
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-01-01T10:00:00Z',
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/patients')) {
        expect(url).toContain('active_only=true')
        expect(url).toContain('q=Aar')
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([activePatient])),
        })
      }
      if (url.includes('/api/appointments?date_from=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 1, appointments: [scheduledAppointment] })),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 0, appointments: [] })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/appointments?tab=scheduled']}>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Upcoming reservations')).toBeInTheDocument()
      expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    })

    expect(screen.getByText('Follow-up review')).toBeInTheDocument()
    expect(screen.getByText(/not an exact consultation time/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Book future visit' }))
    const dialog = screen.getByRole('dialog', { name: 'Book a patient visit' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Scheduled Visit/ })).toHaveAttribute('aria-pressed', 'true')
    expect((within(dialog).getByLabelText('Future visit date') as HTMLInputElement).value)
      .toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/api/patients'))).toBe(false)

    await user.type(
      within(dialog).getByRole('searchbox', { name: 'Search active patients' }),
      'Aar',
    )
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: /Aarav Kumar/ })).toBeInTheDocument()
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/patients?q=Aar'),
      expect.anything(),
    )

    await user.click(within(dialog).getByRole('option', { name: /Aarav Kumar/ }))
    expect(within(dialog).getByText('KH-2026-0001')).toBeInTheDocument()
  })


  it('preselects the doctor and clinic date from the active queue filters', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 0, appointments: [] })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Filter by Doctor')).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Dr. Madan Mohan Dwivedi/ })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText('Filter by Doctor'), '1')
    await user.click(screen.getByRole('button', { name: 'Book First Appointment' }))

    const dialog = screen.getByRole('dialog', { name: 'Book a patient visit' })
    expect(within(dialog).getByLabelText('Consulting doctor')).toHaveValue('1')
    expect(within(dialog).getByLabelText('Today’s queue date')).toHaveValue(clinicDateAfter(0))
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/api/patients'))).toBe(false)
  })

  it('shows scheduled cancellation conflicts inside the open cancellation dialog', async () => {
    const scheduledAppointment: Appointment = {
      ...mockAppointments[0],
      appointment_date: clinicDateAfter(3),
      booking_mode: 'SCHEDULED',
      visit_type: 'FOLLOW_UP',
      token_number: null,
    }
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/appointments/10/status') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            code: 'version_conflict',
            message: 'This scheduled visit was changed by another staff member. Reload before retrying.',
          })),
        })
      }
      if (url.includes('/api/appointments?date_from=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 1, appointments: [scheduledAppointment] })),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 0, appointments: [] })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/appointments?tab=scheduled']}>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Upcoming reservations')).toBeInTheDocument()
      expect(screen.getByText('Assigned at check-in')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('heading', { name: 'Cancel Appointment' }).parentElement
    expect(dialog).not.toBeNull()
    expect(within(dialog as HTMLElement).getByText(/scheduled visit on/)).toBeInTheDocument()

    await user.type(
      screen.getByPlaceholderText(/reason for cancellation/i),
      'Patient requested a different date',
    )
    await user.click(screen.getByRole('button', { name: 'Confirm Cancellation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This scheduled visit was changed by another staff member. Reload before retrying.',
    )
    expect(screen.getByRole('button', { name: 'Reload appointments' })).toBeInTheDocument()
  })


  it('keeps missed scheduled visits visible and lets reception mark them no-show', async () => {
    const overdueAppointment: Appointment = {
      ...mockAppointments[0],
      appointment_date: clinicDateAfter(-2),
      booking_mode: 'SCHEDULED',
      visit_type: 'FOLLOW_UP',
      token_number: null,
    }
    let markedNoShow = false
    let statusBody: unknown = null
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/appointments/10/status') && init?.method === 'PATCH') {
        statusBody = JSON.parse(init.body as string)
        markedNoShow = true
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            ...overdueAppointment,
            status: 'NO_SHOW',
            version_id: 2,
          })),
        })
      }
      if (url.includes('/api/appointments?date_to=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            total: markedNoShow ? 0 : 1,
            appointments: markedNoShow ? [] : [overdueAppointment],
          })),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 0, appointments: [] })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/appointments?tab=scheduled']}>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Missed check-in · 1 visit(s)')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mark No-show' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Mark No-show' }))
    await waitFor(() => {
      expect(statusBody).toEqual({
        status: 'NO_SHOW',
        version_id: 1,
        cancellation_reason: null,
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Mark No-show' })).not.toBeInTheDocument()
    })
  })


})
