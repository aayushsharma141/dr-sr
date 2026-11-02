import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
    appointment_date: new Date().toISOString().split('T')[0],
    booking_mode: 'WALK_IN',
    visit_type: 'NEW_CONSULTATION',
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

    expect(screen.getByRole('tab', { name: 'Prescription Follow-up Reminders' })).toHaveAttribute('aria-selected', 'true')
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


  it('shows date-based scheduled visits without token numbers in their own workspace', async () => {
    const scheduledAppointment: Appointment = {
      ...mockAppointments[0],
      id: 88,
      appointment_date: '2099-01-02',
      booking_mode: 'SCHEDULED',
      visit_type: 'PHYSIOTHERAPY_SESSION',
      token_number: null,
      notes: 'Reception reminder',
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
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 1, appointments: [scheduledAppointment] })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/appointments?tab=scheduled']}>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Upcoming scheduled visits')).toBeInTheDocument()
      expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    })

    expect(screen.getByRole('tab', { name: 'Scheduled Visits' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Physiotherapy visit')).toBeInTheDocument()
    expect(screen.getByText('At check-in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark arrived/i })).not.toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([url]) =>
      typeof url === 'string' && url.includes('booking_mode=SCHEDULED') && url.includes('has_token=false'),
    )).toBe(true)
  })

  it('searches only after two characters and submits a scheduled visit without a token', async () => {
    let createdBody: Record<string, unknown> | null = null
    const activePatient = {
      id: 101,
      urn: 'KH-2026-0001',
      full_name: 'Aarav Kumar',
      guardian_name: 'Suresh Kumar',
      gender: 'M',
      dob: null,
      age_years: 30,
      mobile: '9876543210',
      address: 'Ara',
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
    const createdAppointment: Appointment = {
      ...mockAppointments[0],
      id: 88,
      booking_mode: 'SCHEDULED',
      visit_type: 'NEW_CONSULTATION',
      appointment_date: '2099-01-02',
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
      if (url.includes('/api/patients?')) {
        expect(url).toContain('active_only=true')
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([activePatient])),
        })
      }
      if (url.includes('/api/appointments') && init?.method === 'POST') {
        createdBody = JSON.parse(init.body as string) as Record<string, unknown>
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(createdAppointment)),
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

    await user.click(await screen.findByRole('button', { name: 'Schedule Future Visit' }))
    const patientSearch = screen.getByRole('searchbox', { name: 'Search active patients' })
    expect(mockFetch.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/api/patients?'))).toBe(false)

    await user.type(patientSearch, 'Aarav')
    const patientOption = await screen.findByRole('option', { name: /Aarav Kumar/ })
    await user.click(patientOption)

    await user.selectOptions(screen.getByLabelText('4. Consulting doctor'), '1')
    expect(screen.getByText('Date-based booking · no fixed time')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm scheduled visit' }))

    await waitFor(() => {
      expect(createdBody).not.toBeNull()
    })
    expect(createdBody).toMatchObject({
      patient_id: 101,
      doctor_id: 1,
      booking_mode: 'SCHEDULED',
      visit_type: 'NEW_CONSULTATION',
    })
    expect(typeof createdBody?.appointment_date).toBe('string')
    expect(screen.getByText('No token allocated yet')).toBeInTheDocument()
  })

})
