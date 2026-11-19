import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoctorDashboard } from '../DoctorDashboard'
import type {
  DoctorDashboardSummary,
  DoctorQueueResponse,
  Me,
  UnfinishedEncounter,
  TreatmentPlanOut,
  AppointmentListResponse,
} from '../../../../api/types'

const mockMeDoctor: Me = {
  id: 1,
  username: 'anil_kumar',
  full_name: 'Anil Kumar',
  role: 'DOCTOR',
  doctor_id: 10,
  csrf_token: 'csrf-token-xyz',
  must_change_password: false,
  permissions: ['encounters:read', 'encounters:write', 'dashboard:doctor'],
  version_id: 1,
}

const mockSummary: DoctorDashboardSummary = {
  doctor_id: 10,
  doctor_name_en: 'Anil Kumar',
  specialty_name: 'Physiotherapy',
  waiting_count: 4,
  in_consultation_count: 1,
  scheduled_count: 3,
  completed_count: 6,
  pending_drafts_count: 2,
  today_glance: {
    total: 9,
    completed: 6,
    in_progress: 1,
    pending: 2,
  },
}

const mockQueue: DoctorQueueResponse = {
  doctor_id: 10,
  doctor_name: 'Anil Kumar',
  queue_date: '2026-11-18',
  in_consultation: [
    {
      id: 103,
      patient_id: 203,
      patient_urn: 'KH-26-P-11-00003',
      patient_name: 'Patient C',
      patient_gender: 'M',
      patient_age: 28,
      patient_mobile: '9876500003',
      patient_allergies: 'None',
      token_number: 3,
      status: 'IN_CONSULTATION',
      consultation_status: 'IN_CONSULTATION',
      status_updated_at: new Date(Date.now() - 5 * 60000).toISOString(),
      notes: 'Active physiotherapy session',
      visit_kind: 'NEW',
      priority_level: 'NORMAL',
      version_id: 1,
    },
  ],
  waiting: [
    {
      id: 101,
      patient_id: 201,
      patient_urn: 'KH-26-P-11-00001',
      patient_name: 'Aa Sharma',
      patient_gender: 'M',
      patient_age: 12,
      patient_mobile: '9876500001',
      patient_allergies: 'None',
      token_number: 1,
      status: 'WAITING',
      consultation_status: 'WAITING',
      status_updated_at: new Date(Date.now() - 15 * 60000).toISOString(),
      notes: 'Neck pain, stiffness',
      visit_kind: 'NEW',
      priority_level: 'NORMAL',
      version_id: 1,
    },
    {
      id: 102,
      patient_id: 202,
      patient_urn: 'KH-26-P-11-00002',
      patient_name: 'Aayush Sharma',
      patient_gender: 'M',
      patient_age: 32,
      patient_mobile: '9876500002',
      patient_allergies: 'None',
      token_number: 2,
      status: 'WAITING',
      consultation_status: 'WAITING',
      status_updated_at: new Date(Date.now() - 11 * 60000).toISOString(),
      notes: 'Low back pain',
      visit_kind: 'FOLLOW_UP',
      priority_level: 'NORMAL',
      version_id: 1,
    },
  ],
  booked: [
    {
      id: 104,
      patient_id: 204,
      patient_urn: 'KH-26-P-11-00004',
      patient_name: 'Mohan Yadav',
      patient_gender: 'M',
      patient_age: 45,
      patient_mobile: '9876500004',
      patient_allergies: 'None',
      token_number: null,
      status: 'BOOKED',
      consultation_status: null,
      status_updated_at: new Date().toISOString(),
      notes: 'Review',
      visit_kind: 'FOLLOW_UP',
      priority_level: 'NORMAL',
      version_id: 1,
    },
  ],
  completed: [],
  total_active: 3,
}

const mockAppointments: AppointmentListResponse = {
  total: 2,
  appointments: [
    {
      id: 501,
      patient_id: 301,
      patient_urn: 'KH-26-P-11-00010',
      patient_name: 'Ramesh Kumar',
      patient_mobile: '9876543210',
      doctor_id: 10,
      doctor_name_en: 'Anil Kumar',
      doctor_name_hi: null,
      appointment_date: '2026-11-18',
      expected_time: '10:00:00',
      token_number: null,
      status: 'BOOKED',
      status_updated_at: new Date().toISOString(),
      cancellation_reason: null,
      notes: 'Follow-up',
      version_id: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 502,
      patient_id: 302,
      patient_urn: 'KH-26-P-11-00011',
      patient_name: 'Sita Devi',
      patient_mobile: '9876543211',
      doctor_id: 10,
      doctor_name_en: 'Anil Kumar',
      doctor_name_hi: null,
      appointment_date: '2026-11-18',
      expected_time: '11:30:00',
      token_number: 1,
      status: 'CHECKED_IN',
      status_updated_at: new Date().toISOString(),
      cancellation_reason: null,
      notes: 'Tailored Therapy',
      version_id: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
}

const mockDrafts: UnfinishedEncounter[] = [
  {
    id: 601,
    patient_id: 202,
    patient_name: 'Aayush Sharma',
    patient_urn: 'KH-26-P-11-00002',
    department_id: 1,
    department_name: 'Physiotherapy',
    started_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    is_finalised: false,
  },
  {
    id: 602,
    patient_id: 205,
    patient_name: 'TEST Patient E2E',
    patient_urn: 'KH-26-P-11-00005',
    department_id: 1,
    department_name: 'Physiotherapy',
    started_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    is_finalised: false,
  },
]

const mockTreatmentPlans: TreatmentPlanOut[] = [
  {
    id: 701,
    patient_id: 201,
    patient_urn: 'KH-26-P-11-00001',
    patient_name: 'Mutated Before Restore',
    doctor_id: 10,
    doctor_name: 'Dr. Anil Kumar',
    encounter_id: null,
    plan_name: 'Spine Rehabilitation',
    condition_diagnosis: 'Spine Rehabilitation',
    referred_by: null,
    total_sessions: 10,
    completed_sessions: 4,
    agreed_price_paise: 500000,
    status: 'ACTIVE',
    cancellation_reason: null,
    version_id: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 702,
    patient_id: 202,
    patient_urn: 'KH-26-P-11-00002',
    patient_name: 'Aa Sharma Plan',
    doctor_id: 10,
    doctor_name: 'Dr. Anil Kumar',
    encounter_id: null,
    plan_name: 'Post-Op Rehab (Knee)',
    condition_diagnosis: 'Post-Op Rehab (Knee)',
    referred_by: null,
    total_sessions: 10,
    completed_sessions: 2,
    agreed_price_paise: 500000,
    status: 'ACTIVE',
    cancellation_reason: null,
    version_id: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

function LocationWatcher() {
  const location = useLocation()
  return (
    <div data-testid="current-location">
      {location.pathname}
      {location.search}
    </div>
  )
}

describe('Doctor Dashboard Feature Workspace', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })

    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify(mockMeDoctor), { status: 200 }))
      }
      if (url.includes('/api/doctor/dashboard/summary')) {
        return Promise.resolve(new Response(JSON.stringify(mockSummary), { status: 200 }))
      }
      if (url.includes('/api/doctor/queue')) {
        return Promise.resolve(new Response(JSON.stringify(mockQueue), { status: 200 }))
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve(new Response(JSON.stringify(mockAppointments), { status: 200 }))
      }
      if (url.includes('/api/encounters/unfinished')) {
        return Promise.resolve(new Response(JSON.stringify(mockDrafts), { status: 200 }))
      }
      if (url.includes('/api/treatment-plans')) {
        return Promise.resolve(new Response(JSON.stringify(mockTreatmentPlans), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders greeting, authenticated doctor name, and specialty subtitle', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/Dr\. Anil Kumar/)).toBeInTheDocument()
    expect(screen.getByText(/Physiotherapy • Doctor Workspace/)).toBeInTheDocument()
    expect(screen.getByTestId('header-btn-new-consultation')).toBeInTheDocument()
  })

  it('renders 5 workload summary cards with counts from summary endpoint', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('card-waiting')).toHaveTextContent('4')
    })

    expect(screen.getByTestId('card-in-consultation')).toHaveTextContent('1')
    expect(screen.getByTestId('card-scheduled')).toHaveTextContent('3')
    expect(screen.getByTestId('card-completed')).toHaveTextContent('6')
    expect(screen.getByTestId('card-pending-drafts')).toHaveTextContent('2')
  })

  it('filters live queue rows when clicking tabs', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      const tables = screen.getAllByRole('table')
      expect(tables.length).toBeGreaterThanOrEqual(1)
      expect(within(tables[0]).getByText('Aa Sharma')).toBeInTheDocument()
      expect(within(tables[0]).getByText('Patient C')).toBeInTheDocument()
    })

    const queueTable = screen.getAllByRole('table')[0]

    // Click 'Waiting' tab
    const waitingTab = screen.getByRole('button', { name: /Waiting \(\d+\)/i })
    await user.click(waitingTab)

    expect(within(queueTable).getByText('Aa Sharma')).toBeInTheDocument()
    expect(within(queueTable).getByText('Aayush Sharma')).toBeInTheDocument()
    expect(within(queueTable).queryByText('Patient C')).not.toBeInTheDocument()

    // Click 'In Consult' tab
    const inConsultTab = screen.getByRole('button', { name: /In Consult \(\d+\)/i })
    await user.click(inConsultTab)

    expect(within(queueTable).getByText('Patient C')).toBeInTheDocument()
    expect(within(queueTable).queryByText('Aa Sharma')).not.toBeInTheDocument()
  })

  it('renders contextual Start Consult for waiting patients and routes to new encounter', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
          <LocationWatcher />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Waiting patient has 'Start Consult'
    const startButtons = await screen.findAllByRole('button', { name: 'Start Consult' })
    expect(startButtons.length).toBeGreaterThanOrEqual(1)

    // Active consulting patient has 'Continue Consult'
    expect(screen.getByRole('button', { name: 'Continue Consult' })).toBeInTheDocument()

    // Click 'Start Consult' on first waiting patient (id=101, patient_id=201)
    await user.click(startButtons[0])

    const watcher = screen.getByTestId('current-location')
    expect(watcher).toHaveTextContent('/doctor/encounters/new?patient_id=201&appointment_id=101')
  })

  it('renders scheduled appointments in Today Schedule card isolated from waiting queue', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('todays-schedule-card')).toHaveTextContent('Ramesh Kumar')
    })
    const scheduleCard = screen.getByTestId('todays-schedule-card')
    expect(scheduleCard).toHaveTextContent('10:00 AM')
    expect(scheduleCard).toHaveTextContent('Sita Devi')
    expect(scheduleCard).toHaveTextContent('11:30 AM')
  })

  it('renders Today at a Glance with completed count and reconciled metrics', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('glance-total')).toHaveTextContent('9')
    })
    expect(screen.getByTestId('donut-center-completed')).toHaveTextContent('6')
    expect(screen.getByTestId('glance-completed')).toHaveTextContent('6')
    expect(screen.getByTestId('glance-in-progress')).toHaveTextContent('1')
    expect(screen.getByTestId('glance-pending')).toHaveTextContent('2')
  })

  it('renders neutral circle track when Today at a Glance total is 0', async () => {
    const freshClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })

    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify(mockMeDoctor), { status: 200 }))
      }
      if (url.includes('/api/doctor/dashboard/summary')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...mockSummary,
              today_glance: { total: 0, completed: 0, in_progress: 0, pending: 0 },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/api/doctor/queue')) {
        return Promise.resolve(new Response(JSON.stringify(mockQueue), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    render(
      <QueryClientProvider client={freshClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('donut-neutral-track')).toBeInTheDocument()
      expect(screen.getByTestId('donut-center-completed')).toHaveTextContent('0')
    })
  })

  it('renders Recent Treatment Plans with calculated progress percentage', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('recent-treatment-plans-card')).toHaveTextContent(
        'Spine Rehabilitation • 4/10 sessions',
      )
    })
    const plansCard = screen.getByTestId('recent-treatment-plans-card')
    expect(plansCard).toHaveTextContent('40%')
    expect(plansCard).toHaveTextContent('Post-Op Rehab (Knee) • 2/10 sessions')
    expect(plansCard).toHaveTextContent('20%')
  })

  it('opens New Consultation modal and allows searching patients', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const newBtn = await screen.findByTestId('header-btn-new-consultation')
    await user.click(newBtn)

    expect(screen.getByTestId('new-consultation-modal')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search by URN, patient name or mobile/i)).toBeInTheDocument()
  })
})
