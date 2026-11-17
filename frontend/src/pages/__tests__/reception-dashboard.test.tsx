import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionDashboard } from '../ReceptionDashboard'
import type { ReceptionOverview, Appointment, DoctorOut } from '../../api/types'
import { istToday } from '../../format'

const mockApiState = vi.hoisted(() => ({
  failReceptionOverview: false,
  appointmentsOverride: null as Appointment[] | null,
}))

const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60000).toISOString()

const mockOverview: ReceptionOverview = {
  area: 'reception',
  name: 'Front Desk Operator',
  role: 'RECEPTION',
  business_date: istToday(),
  registrations_today: 18,
  appointments_today: {
    ARRIVED: 4,
    IN_CONSULTATION: 2,
    DONE: 2,
    BOOKED: 1,
  },
  doctors_today: [
    {
      doctor_id: 1,
      name: 'Dr. Anil Kumar',
      appointments_today: 6,
      waiting: 3,
      arrived_waiting: 2,
      in_consultation: 1,
      done: 3,
      department: 'Physiotherapy',
      next_token: 14,
    },
    {
      doctor_id: 2,
      name: 'Dr. Meera Rao',
      appointments_today: 4,
      waiting: 0,
      arrived_waiting: 0,
      in_consultation: 1,
      done: 2,
      department: 'General Medicine',
      next_token: null,
    },
  ],
  collections_today: {
    payments_count: 5,
    gross_paise: 250555,
    reversals_count: 1,
    reversed_paise: 1250,
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
      message: '2 patient(s) waiting over 30 minutes for consultation.',
    },
  ],
}

// Intentionally unsorted so Live Queue ordering assertions verify sorting behavior.
const mockAppointments: Appointment[] = [
  // Active In Cabin (token #15 -> overflows past the 5-row preview cap)
  {
    id: 102,
    department_id: 1,
    department_name: 'General Medicine',
    patient_id: 2,
    patient_urn: 'KH-2026-0002',
    patient_name: 'Sunita Devi',
    patient_mobile: '9876543211',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: 15,
    status: 'IN_CONSULTATION',
    status_updated_at: minutesAgo(10),
    cancellation_reason: null,
    notes: 'Post-op rehabilitation',
    version_id: 1,
    created_at: minutesAgo(15),
    updated_at: minutesAgo(2),
  },
  // Active Waiting (untokened NORMAL -> must NOT sort ahead of #01)
  {
    id: 107,
    department_id: 1,
    department_name: 'General Medicine',
    patient_id: 7,
    patient_urn: 'KH-2026-0007',
    patient_name: 'Deepak Untokened',
    patient_mobile: '9876543217',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: null,
    status: 'ARRIVED',
    priority_level: 'NORMAL',
    status_updated_at: minutesAgo(12),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(14),
    updated_at: minutesAgo(2),
  },
  // Active In Cabin via consultation_status (token #02 -> sorts after waiting, ahead of #15)
  {
    id: 108,
    department_id: 2,
    department_name: 'Orthopaedics',
    patient_id: 8,
    patient_urn: 'KH-2026-0008',
    patient_name: 'Vikram Mehta',
    patient_mobile: '9876543218',
    doctor_id: 2,
    doctor_name_en: 'Dr. Meera Rao',
    doctor_name_hi: 'डॉ मीरा राव',
    appointment_date: istToday(),
    token_number: 2,
    status: 'ARRIVED',
    consultation_status: 'IN_CONSULTATION',
    status_updated_at: minutesAgo(8),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(20),
    updated_at: minutesAgo(2),
  },
  // Active Waiting (NORMAL #01)
  {
    id: 101,
    department_id: 1,
    department_name: 'General Medicine',
    patient_id: 1,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Ramesh Kumar',
    patient_mobile: '9876543210',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: 1,
    status: 'ARRIVED',
    priority_level: 'NORMAL',
    status_updated_at: minutesAgo(10),
    cancellation_reason: null,
    notes: 'Walk-in lower back pain',
    version_id: 1,
    created_at: minutesAgo(18),
    updated_at: minutesAgo(2),
  },
  // Active Waiting (PRIORITY #18, delayed >30m -> renders "High" badge)
  {
    id: 106,
    department_id: 1,
    department_name: 'General Medicine',
    patient_id: 6,
    patient_urn: 'KH-2026-0006',
    patient_name: 'Kiran Patel',
    patient_mobile: '9876543216',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: 18,
    status: 'ARRIVED',
    priority_level: 'PRIORITY',
    priority_reason: 'Senior citizen',
    priority_updated_at: minutesAgo(25),
    status_updated_at: minutesAgo(35),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(38),
    updated_at: minutesAgo(2),
  },
  // Active Waiting (EMERGENCY #20, delayed >30m -> renders "Emergency" badge first)
  {
    id: 105,
    department_id: 1,
    department_name: 'General Medicine',
    patient_id: 5,
    patient_urn: 'KH-2026-0005',
    patient_name: 'Asha Devi',
    patient_mobile: '9876543215',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: 20,
    status: 'ARRIVED',
    priority_level: 'EMERGENCY',
    priority_reason: 'Acute chest discomfort',
    priority_updated_at: minutesAgo(20),
    status_updated_at: minutesAgo(42),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(45),
    updated_at: minutesAgo(2),
  },
  // Non-active rows: must all be excluded from Live Queue
  {
    id: 103,
    patient_id: 3,
    patient_urn: 'KH-2026-0003',
    patient_name: 'Manoj Verma',
    patient_mobile: '9876543212',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: 16,
    status: 'DONE',
    status_updated_at: minutesAgo(5),
    cancellation_reason: null,
    notes: 'Consultation finished',
    version_id: 1,
    created_at: minutesAgo(25),
    updated_at: minutesAgo(2),
  },
  {
    id: 112,
    patient_id: 12,
    patient_urn: 'KH-2026-0012',
    patient_name: 'Completed Patient',
    patient_mobile: '9876543222',
    doctor_id: 2,
    doctor_name_en: 'Dr. Meera Rao',
    doctor_name_hi: 'डॉ मीरा राव',
    appointment_date: istToday(),
    token_number: 6,
    status: 'COMPLETED',
    status_updated_at: minutesAgo(7),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(30),
    updated_at: minutesAgo(2),
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
    appointment_date: istToday(),
    token_number: null,
    status: 'BOOKED',
    status_updated_at: minutesAgo(5),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(10),
    updated_at: minutesAgo(2),
  },
  {
    id: 109,
    patient_id: 9,
    patient_urn: 'KH-2026-0009',
    patient_name: 'Cancelled Stale',
    patient_mobile: '9876543219',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: 3,
    status: 'CANCELLED',
    consultation_status: 'WAITING',
    status_updated_at: minutesAgo(50),
    cancellation_reason: 'Patient left',
    notes: null,
    version_id: 1,
    created_at: minutesAgo(55),
    updated_at: minutesAgo(2),
  },
  {
    id: 110,
    patient_id: 10,
    patient_urn: 'KH-2026-0010',
    patient_name: 'NoShow Patient',
    patient_mobile: '9876543220',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil Kumar',
    doctor_name_hi: 'डॉ अनिल कुमार',
    appointment_date: istToday(),
    token_number: 4,
    status: 'NO_SHOW',
    status_updated_at: minutesAgo(15),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(30),
    updated_at: minutesAgo(2),
  },
  {
    id: 111,
    patient_id: 11,
    patient_urn: 'KH-2026-0011',
    patient_name: 'Rescheduled Patient',
    patient_mobile: '9876543221',
    doctor_id: 2,
    doctor_name_en: 'Dr. Meera Rao',
    doctor_name_hi: 'डॉ मीरा राव',
    appointment_date: istToday(),
    token_number: 5,
    status: 'RESCHEDULED',
    status_updated_at: minutesAgo(15),
    cancellation_reason: null,
    notes: null,
    version_id: 1,
    created_at: minutesAgo(30),
    updated_at: minutesAgo(2),
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
  {
    id: 2,
    name_en: 'Dr. Meera Rao',
    name_hi: 'डॉ मीरा राव',
    qualification: 'Physician',
    registration_number: 'MD-2002',
    default_fee_paise: 50000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

// Mock API client
vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes('/appointments')) {
      const appointments = mockApiState.appointmentsOverride ?? mockAppointments
      return { total: appointments.length, appointments }
    }
    if (url.includes('/doctors')) {
      return mockDoctors
    }
    if (url.includes('/reception/overview')) {
      if (mockApiState.failReceptionOverview) throw new Error('local server unavailable')
      return mockOverview
    }
    return {}
  }),
  ApiError: class ApiError extends Error {},
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
    mockApiState.failReceptionOverview = false
    mockApiState.appointmentsOverride = null
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a clean command-center header with refresh and separate freshness timestamps', async () => {
    renderDashboard()

    await screen.findByText('Asha Devi')
    expect(screen.getByRole('button', { name: /refresh queue and summary/i })).toBeInTheDocument()
    expect(screen.getByText(/queue updated:/i)).toBeInTheDocument()
    expect(screen.getByText(/summary updated:/i)).toBeInTheDocument()

    expect(screen.queryByRole('link', { name: /\+ new patient/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /check-in & token/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /counter checkout/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/\+ new patient/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/check-in & token/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/counter checkout/i)).not.toBeInTheDocument()
  })

  it('renders six compact KPI card links with accurate counts and separate paise precision', async () => {
    renderDashboard()

    await screen.findByText('Asha Devi')

    const registrationsLink = screen.getByRole('link', { name: /registrations/i })
    expect(registrationsLink).toHaveAttribute('href', '/reception/appointments')
    expect(registrationsLink).toHaveTextContent('18')

    const waitingLink = screen.getByRole('link', { name: /waiting.*awaiting consultation/i })
    expect(waitingLink).toHaveAttribute('href', '/reception/waiting')
    expect(waitingLink).toHaveTextContent('4')

    const inCabinLink = screen.getByRole('link', { name: /in cabin.*with doctors right now/i })
    expect(inCabinLink).toHaveAttribute('href', '/reception/waiting')
    expect(inCabinLink).toHaveTextContent('2')

    const completedLink = screen.getByRole('link', { name: /completed.*ready for checkout/i })
    expect(completedLink).toHaveAttribute('href', '/reception/waiting')
    expect(completedLink).toHaveTextContent('2')

    const duesLink = screen.getByRole('link', { name: /dues pending/i })
    expect(duesLink).toHaveAttribute('href', '/reception/billing?tab=dues')
    expect(duesLink).toHaveTextContent('₹1,500.00')

    const paymentsLink = screen.getByRole('link', { name: /payments today/i })
    expect(paymentsLink).toHaveAttribute('href', '/reception/reports')
    expect(paymentsLink).toHaveTextContent('₹2,505.55')
    expect(paymentsLink).toHaveTextContent('Reversed today: ₹12.50')

    expect(screen.queryByText(/net payments today/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/patient flow today/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/hourly collections/i)).not.toBeInTheDocument()
  })

  it('counts visible alert cards in Needs Attention and routes each CTA to its destination', async () => {
    renderDashboard()

    await screen.findByText('Asha Devi')
    const attention = screen.getByRole('region', { name: /needs attention/i })

    expect(within(attention).getByRole('heading', { name: 'Needs Attention (3)' })).toBeInTheDocument()
    expect(within(attention).getByText('2 patient(s) waiting over 30 minutes')).toBeInTheDocument()
    expect(within(attention).getByText('₹1,500.00 pending dues')).toBeInTheDocument()
    expect(within(attention).getByText('1 booked patient(s) not checked in')).toBeInTheDocument()

    const delayedCta = within(attention).getByRole('link', { name: /view delayed patients/i })
    expect(delayedCta).toHaveAttribute('href', '/reception/waiting')

    const duesCta = within(attention).getByRole('link', { name: 'Review' })
    expect(duesCta).toHaveAttribute('href', '/reception/billing?tab=dues')

    const checkInCta = within(attention).getByRole('link', { name: 'Check in' })
    expect(checkInCta).toHaveAttribute('href', '/reception/tokens')

    expect(within(attention).getAllByRole('link')).toHaveLength(3)
  })

  it('caps Live Queue preview at 5 ordered active rows, excludes inactive rows, and omits inline management controls', async () => {
    renderDashboard()

    await screen.findByText('Asha Devi')
    const liveQueue = screen.getByRole('region', { name: /live queue/i })

    expect(within(liveQueue).getByText('Showing 5 of 6 active')).toBeInTheDocument()
    expect(within(liveQueue).getByRole('link', { name: /open waiting room/i })).toHaveAttribute(
      'href',
      '/reception/waiting',
    )
    expect(
      within(liveQueue).getByRole('link', { name: /view all 6 active patients in waiting room/i }),
    ).toHaveAttribute('href', '/reception/waiting')

    const table = within(liveQueue).getByRole('table')
    const [, tbody] = within(table).getAllByRole('rowgroup')
    const rows = within(tbody).getAllByRole('row')
    expect(rows).toHaveLength(5)

    // Order: EMERGENCY -> PRIORITY ("High") -> NORMAL (#01) -> untokened NORMAL (—) -> In Cabin (#02)
    expect(rows[0]).toHaveTextContent('#20')
    expect(rows[0]).toHaveTextContent('Asha Devi')
    expect(rows[0]).toHaveTextContent('Emergency')
    expect(rows[0]).toHaveTextContent('Waiting')

    expect(rows[1]).toHaveTextContent('#18')
    expect(rows[1]).toHaveTextContent('Kiran Patel')
    expect(rows[1]).toHaveTextContent('High')
    expect(rows[1]).toHaveTextContent('Waiting')

    expect(rows[2]).toHaveTextContent('#01')
    expect(rows[2]).toHaveTextContent('Ramesh Kumar')
    expect(rows[2]).toHaveTextContent('KH-2026-0001')
    expect(rows[2]).toHaveTextContent('General Medicine')
    expect(rows[2]).toHaveTextContent('Waiting')

    expect(rows[3]).toHaveTextContent('—')
    expect(rows[3]).toHaveTextContent('Deepak Untokened')
    expect(rows[3]).toHaveTextContent('Waiting')

    expect(rows[4]).toHaveTextContent('#02')
    expect(rows[4]).toHaveTextContent('Vikram Mehta')
    expect(rows[4]).toHaveTextContent('In Cabin')

    // 6th active row (#15 In Cabin) overflows past the 5-row cap
    expect(within(table).queryByText('Sunita Devi')).not.toBeInTheDocument()

    // Non-active statuses are excluded from Live Queue
    for (const excluded of [
      'Cancelled Stale',
      'NoShow Patient',
      'Rescheduled Patient',
      'Manoj Verma',
      'Completed Patient',
      'Pooja Singh',
    ]) {
      expect(within(table).queryByText(excluded)).not.toBeInTheDocument()
    }

    // No queue filters, search, or row action clutter
    expect(screen.queryByRole('textbox', { name: /search/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /waiting|delayed only/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /print token/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel appointment/i })).not.toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: /check in/i })).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /check in/i })).not.toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: /billing/i })).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /billing/i })).not.toBeInTheDocument()
  })

  it('orders multiple emergency waiting rows by earlier priority_updated_at first', async () => {
    mockApiState.appointmentsOverride = [
      {
        ...mockAppointments[5],
        id: 201,
        patient_id: 21,
        patient_urn: 'KH-2026-0021',
        patient_name: 'Later Emergency',
        token_number: 5,
        priority_updated_at: minutesAgo(5),
      },
      {
        ...mockAppointments[5],
        id: 202,
        patient_id: 22,
        patient_urn: 'KH-2026-0022',
        patient_name: 'Earlier Emergency',
        token_number: 22,
        priority_updated_at: minutesAgo(30),
      },
    ]

    renderDashboard()
    await screen.findByText('Earlier Emergency')

    const liveQueue = screen.getByRole('region', { name: /live queue/i })
    const [, tbody] = within(within(liveQueue).getByRole('table')).getAllByRole('rowgroup')
    const rows = within(tbody).getAllByRole('row')

    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Earlier Emergency')
    expect(rows[1]).toHaveTextContent('Later Emergency')
  })

  it('renders Doctor Workload as compact navigation links without Done counts or malformed next tokens', async () => {
    renderDashboard()

    await screen.findByText('Asha Devi')
    const workload = screen.getByRole('region', { name: /doctor workload/i })

    expect(within(workload).queryByRole('button')).not.toBeInTheDocument()

    const anilLink = within(workload).getByRole('link', { name: /Dr\. Anil Kumar/ })
    expect(anilLink).toHaveAttribute('href', '/reception/waiting?doctor_id=1')
    expect(anilLink).toHaveTextContent(/Waiting:\s*2/)
    expect(anilLink).toHaveTextContent(/In Cabin:\s*1/)
    expect(anilLink).toHaveTextContent('Next: #14')

    const meeraLink = within(workload).getByRole('link', { name: /Dr\. Meera Rao/ })
    expect(meeraLink).toHaveAttribute('href', '/reception/waiting?doctor_id=2')
    expect(meeraLink).toHaveTextContent(/Waiting:\s*0/)
    expect(meeraLink).toHaveTextContent(/In Cabin:\s*1/)
    expect(meeraLink).toHaveTextContent('Next: —')

    expect(within(workload).queryByText(/Next:\s*#—/)).not.toBeInTheDocument()
    expect(within(workload).queryByText(/\bDone\b/i)).not.toBeInTheDocument()
    expect(within(workload).queryByText('Physiotherapy')).not.toBeInTheDocument()
  })

  it('announces manual refresh errors while keeping the last successful overview', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(screen.getByText('₹2,505.55')).toBeInTheDocument())
    mockApiState.failReceptionOverview = true
    await user.click(screen.getByRole('button', { name: /refresh queue and summary/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/summary refresh failed/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/last successful values are still shown/i)
    expect(screen.getByText('₹2,505.55')).toBeInTheDocument()
  })

  it('strictly respects role separation: no clinical notes or diagnosis leak', async () => {
    renderDashboard()

    await screen.findByText('Asha Devi')
    expect(screen.queryByText(/clinical examination/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/differential diagnosis/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/rx prescription/i)).not.toBeInTheDocument()
  })
})
