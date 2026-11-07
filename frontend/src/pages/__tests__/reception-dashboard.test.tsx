import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionDashboard } from '../ReceptionDashboard'
import type { ReceptionOverview, Appointment, DoctorOut } from '../../api/types'

const mockOverview: ReceptionOverview = {
  area: 'reception',
  name: 'Front Desk Operator',
  role: 'RECEPTION',
  business_date: '2026-11-07',
  registrations_today: 18,
  appointments_today: {
    ARRIVED: 3,
    IN_CONSULTATION: 1,
    DONE: 5,
    BOOKED: 2,
  },
  doctors_today: [
    {
      doctor_id: 1,
      name: 'Dr. Anil Kumar',
      appointments_today: 6,
      waiting: 2,
      arrived_waiting: 2,
      in_consultation: 1,
      done: 3,
      department: 'Physiotherapy',
      next_token: 14,
    },
  ],
  collections_today: {
    payments_count: 5,
    gross_paise: 240000,
    reversals_count: 0,
    reversed_paise: 0,
    by_method: { CASH: 160000, UPI: 80000, CARD: 0 },
  },
  outstanding_dues_paise: 150000,
  hourly_collections: [
    { hour: '09:00', amount_paise: 80000, count: 2 },
    { hour: '10:00', amount_paise: 160000, count: 3 },
  ],
  alerts: [
    {
      code: 'queue_delay_30m',
      severity: 'warning',
      message: '1 patient(s) waiting over 30 minutes for consultation.',
    },
  ],
}

const mockAppointments: Appointment[] = [
  {
    id: 101,
    patient_id: 1,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Ramesh Kumar',
    patient_mobile: '9876543210',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: '2026-11-07',
    token_number: 14,
    status: 'ARRIVED',
    status_updated_at: new Date(Date.now() - 35 * 60000).toISOString(), // 35 min ago -> delayed
    cancellation_reason: null,
    notes: 'Walk-in lower back pain',
    version_id: 1,
    created_at: new Date(Date.now() - 40 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 102,
    patient_id: 2,
    patient_urn: 'KH-2026-0002',
    patient_name: 'Sunita Devi',
    patient_mobile: '9876543211',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: '2026-11-07',
    token_number: 15,
    status: 'IN_CONSULTATION',
    status_updated_at: new Date(Date.now() - 10 * 60000).toISOString(),
    cancellation_reason: null,
    notes: 'Post-op rehabilitation',
    version_id: 1,
    created_at: new Date(Date.now() - 15 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 103,
    patient_id: 3,
    patient_urn: 'KH-2026-0003',
    patient_name: 'Manoj Verma',
    patient_mobile: '9876543212',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: '2026-11-07',
    token_number: 16,
    status: 'DONE',
    status_updated_at: new Date(Date.now() - 5 * 60000).toISOString(),
    cancellation_reason: null,
    notes: 'Consultation finished',
    version_id: 1,
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 104,
    patient_id: 4,
    patient_urn: 'KH-2026-0004',
    patient_name: 'Pooja Singh',
    patient_mobile: '9876543213',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: '2026-11-07',
    token_number: 17,
    status: 'BOOKED',
    status_updated_at: new Date().toISOString(),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

const mockDoctors: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr. Anil Kumar',
    name_hi: 'डॉ अनिल कुमार',
    qualification: 'Physiotherapist',
    registration_number: 'PT-1001',
    default_fee_paise: 40000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

// Mock API client
vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/appointments')) {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string)
        return {
          id: 104,
          patient_id: 4,
          patient_urn: 'KH-2026-0004',
          patient_name: 'Pooja Singh',
          doctor_id: 1,
          doctor_name_en: 'Dr. Anil Kumar',
          appointment_date: '2026-11-07',
          token_number: 17,
          status: body.status,
          version_id: 2,
        }
      }
      return { total: mockAppointments.length, appointments: mockAppointments }
    }
    if (url.includes('/doctors')) {
      return mockDoctors
    }
    if (url.includes('/reception/overview')) {
      return mockOverview
    }
    return {}
  }),
  ApiError: class ApiError extends Error { },
  setCsrfToken: vi.fn(),
}))

function renderDashboard() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReceptionDashboard overview={mockOverview} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReceptionDashboard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders top-level KPI cards with accurate calculations', async () => {
    renderDashboard()

    // 1. Registrations
    expect(screen.getByText('Registrations')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()

    // 2. Waiting (arrived in appointments)
    expect(screen.getAllByText('Waiting')[0]).toBeInTheDocument()

    // 3. In Cabin
    expect(screen.getAllByText('In Cabin')[0]).toBeInTheDocument()

    // 4. Completed
    expect(screen.getAllByText('Completed')[0]).toBeInTheDocument()

    // 5. Outstanding Dues Pending (₹1,500)
    expect(screen.getByText('Dues Pending')).toBeInTheDocument()
    expect(screen.getByText('₹1,500')).toBeInTheDocument()

    // 6. Net Collections Today (₹2,400)
    expect(screen.getByText('Collection')).toBeInTheDocument()
    expect(screen.getAllByText('₹2,400')[0]).toBeInTheDocument()
  })

  it('renders live queue workspace with patient details and status badges', async () => {
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Ramesh Kumar')).toBeInTheDocument()
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
      expect(screen.getByText('#14')).toBeInTheDocument()
    })

    // Other patients
    expect(screen.getByText('Sunita Devi')).toBeInTheDocument()
    expect(screen.getByText('Manoj Verma')).toBeInTheDocument()
    expect(screen.getByText('Pooja Singh')).toBeInTheDocument()
  })

  it('filters queue by search query', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Ramesh Kumar')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/search patient queue/i)
    await user.type(searchInput, 'Sunita')

    expect(screen.getByText('Sunita Devi')).toBeInTheDocument()
    expect(screen.queryByText('Ramesh Kumar')).not.toBeInTheDocument()
    expect(screen.queryByText('Manoj Verma')).not.toBeInTheDocument()
  })

  it('allows reception to check-in a booked patient', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Pooja Singh')).toBeInTheDocument()
    })

    // Find "Check In" button for Pooja Singh
    const checkInBtn = screen.getByRole('button', { name: /check in/i })
    expect(checkInBtn).toBeInTheDocument()
    await user.click(checkInBtn)

    // Verify status mutation triggered
    const { apiFetch } = await import('../../api/client')
    expect(apiFetch).toHaveBeenCalledWith(
      '/appointments/104/status',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ status: 'ARRIVED' }),
      }),
    )
  })

  it('renders doctor workload column with waiting and next token indicator', async () => {
    renderDashboard()

    expect(screen.getByText('Doctor Workload')).toBeInTheDocument()
    expect(screen.getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(screen.getByText('Next: #14')).toBeInTheDocument()
  })

  it('strictly respects role separation: no clinical notes or diagnosis leak', () => {
    renderDashboard()

    // Clinical diagnosis/doctor encounter fields must NOT appear
    expect(screen.queryByText(/clinical examination/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/differential diagnosis/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/rx prescription/i)).not.toBeInTheDocument()
  })
})
