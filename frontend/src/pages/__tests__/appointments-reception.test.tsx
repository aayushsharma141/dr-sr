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
    expect(screen.getByRole('link', { name: 'Check In' })).toBeInTheDocument()
    // Reception has one view here, named like its sidebar tab, with no tab strip.
    expect(screen.getByRole('heading', { level: 1, name: 'Appointments' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('sends Check In to Check-in & Token with the booking chosen, changing nothing here', async () => {
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

    const checkIn = await screen.findByRole('link', { name: 'Check In' })
    expect(checkIn).toHaveAttribute('href', '/reception/tokens?patient_id=101&appointment_id=10')

    await user.click(checkIn)

    // The token is issued at the desk, so this screen sends no status change of its own.
    expect(patchedBody).toBeNull()
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/status'), expect.anything())
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

    expect(screen.getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'true')
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

  it('renders OPD cabin pacing controls and emergency hold when logged in as DOCTOR', async () => {
    const doctorMe: Me = {
      ...mockMe,
      role: 'DOCTOR',
      username: 'doctor',
      full_name: 'Dr. Madan Mohan Dwivedi',
      permissions: ['appointment:read', 'appointment:write', 'prescription:read'],
      doctor_id: 1,
    }

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

    // A doctor lands on Follow-ups (their sidebar tab); Schedule is the second tab, not a second queue tab.
    expect(await screen.findByRole('heading', { level: 1, name: 'Follow-ups' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Appointments' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Schedule' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/OPD Cabin Pacing & Doctor Schedule/i)).toBeInTheDocument()
    })

    // Pacing toggle buttons
    const blockBtn = screen.getByRole('button', { name: /Mark emergency hold/i })
    expect(blockBtn).toBeInTheDocument()
    await user.click(blockBtn)

    // The hold is only on this screen, and the page must say so rather than claim reception was told.
    expect(screen.getByText(/marked on this screen only/i)).toBeInTheDocument()
    expect(screen.getByText('NOT SENT')).toBeInTheDocument()
    expect(screen.queryByText(/RECEPTION BLOCKED/)).not.toBeInTheDocument()
    expect(screen.getByText(/Resume Normal Queue/i)).toBeInTheDocument()
  })
})

describe('AppointmentsReception check-in rules (RF-12)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderBoard(appointments: Appointment[]) {
    const jsonResponse = (body: unknown) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(mockMe))
        if (url.includes('/api/doctors')) return Promise.resolve(jsonResponse(mockDoctors))
        if (url.includes('/api/appointments'))
          return Promise.resolve(jsonResponse({ total: appointments.length, appointments }))
        return Promise.reject(new Error(`Unhandled: ${url}`))
      }),
    )
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <MemoryRouter>
          <AppointmentsReception />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  const booked = mockAppointments[0]

  it('offers No-Show only while the patient is still booked', async () => {
    renderBoard([
      { ...booked, id: 10, patient_name: 'Booked Patient', token_number: null },
      {
        ...booked,
        id: 11,
        patient_name: 'Arrived Patient',
        status: 'ARRIVED',
        consultation_status: 'WAITING',
        token_number: 2,
      },
    ])

    await screen.findByText('Arrived Patient')

    // The server refuses to mark a checked-in patient not arrived, so the button is not offered.
    expect(screen.getAllByRole('button', { name: 'No-Show' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2)
  })

  it('lets a patient marked not arrived be checked in late', async () => {
    renderBoard([{ ...booked, status: 'NO_SHOW', token_number: null }])

    await screen.findByText('Aarav Kumar')

    expect(screen.getByRole('link', { name: 'Check In' })).toHaveAttribute(
      'href',
      `/reception/tokens?patient_id=${booked.patient_id}&appointment_id=${booked.id}`,
    )
    expect(screen.queryByRole('button', { name: 'No-Show' })).not.toBeInTheDocument()
  })

  it('shows a dash, never "null", for a booking that has no token yet', async () => {
    renderBoard([{ ...booked, token_number: null }])

    await screen.findByText('Aarav Kumar')

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument()
  })
})
