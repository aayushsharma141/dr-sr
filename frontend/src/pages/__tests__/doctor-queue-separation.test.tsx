import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoctorDashboardPage } from '../DoctorDashboardPage'
import { DoctorDashboard as DoctorQueueWorkspace } from '../DoctorDashboard'
import type {
  DoctorDashboardSummary,
  DoctorQueueResponse,
  Me,
} from '../../api/types'

const mockMeDoctor: Me = {
  id: 1,
  username: 'anil_kumar',
  full_name: 'Anil Kumar',
  role: 'DOCTOR',
  doctor_id: 10,
  csrf_token: 'csrf-xyz',
  must_change_password: false,
  permissions: ['encounters:read', 'encounters:write', 'dashboard:doctor'],
  version_id: 1,
}

const mockSummary: DoctorDashboardSummary = {
  doctor_id: 10,
  doctor_name_en: 'Anil Kumar',
  specialty_name: 'Physiotherapy',
  waiting_count: 3,
  in_consultation_count: 1,
  scheduled_count: 2,
  completed_count: 5,
  pending_drafts_count: 1,
  today_glance: {
    total: 8,
    completed: 5,
    in_progress: 1,
    pending: 2,
  },
}

const mockQueue: DoctorQueueResponse = {
  doctor_id: 10,
  doctor_name: 'Dr. Anil Kumar',
  queue_date: '2026-11-18',
  in_consultation: [
    {
      id: 101,
      patient_id: 201,
      patient_urn: 'KH-26-001',
      patient_name: 'Ramesh Kumar',
      patient_gender: 'M',
      patient_age: 45,
      patient_mobile: '9876543210',
      patient_allergies: 'None',
      status_updated_at: '2026-11-18T10:00:00Z',
      token_number: 1,
      status: 'IN_CONSULTATION',
      consultation_status: 'IN_CONSULTATION',
      notes: 'Initial evaluation',
      visit_kind: 'NEW',
      priority_level: 'NORMAL',
      version_id: 1,
    },
  ],
  waiting: [
    {
      id: 102,
      patient_id: 202,
      patient_urn: 'KH-26-002',
      patient_name: 'Sita Devi',
      patient_gender: 'F',
      patient_age: 38,
      patient_mobile: '9876543211',
      patient_allergies: 'None',
      status_updated_at: '2026-11-18T10:05:00Z',
      token_number: 2,
      status: 'WAITING',
      notes: 'Follow-up therapy',
      visit_kind: 'FOLLOW_UP',
      priority_level: 'NORMAL',
      version_id: 1,
    },
  ],
  booked: [],
  completed: [],
  total_active: 2,
}

describe('Doctor Dashboard vs My Queue Separation', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
          })
        }
        if (url.includes('/api/doctor/dashboard/summary')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(mockSummary)),
          })
        }
        if (url.includes('/api/doctor/queue')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(mockQueue)),
          })
        }
        if (url.includes('/api/encounters/unfinished')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify([])),
          })
        }
        if (url.includes('/api/appointments')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(JSON.stringify({ appointments: [], total: 0 })),
          })
        }
        if (url.includes('/api/physiotherapy/treatment-plans')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify([])),
          })
        }
        if (url.includes('/api/doctors')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(
                JSON.stringify([
                  {
                    id: 10,
                    name_en: 'Dr. Anil Kumar',
                    specialty: 'Physiotherapy',
                    cabin_code: 'Cabin 102',
                    default_fee_paise: 50000,
                    is_active: true,
                  },
                ]),
              ),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('renders Doctor Dashboard at /doctor with Dashboard highlighted in sidebar', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <Routes>
            <Route path="/doctor" element={<DoctorDashboardPage />} />
            <Route path="/doctor/queue" element={<DoctorQueueWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Verify operational dashboard contents
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /Dr\. Anil Kumar/i }),
      ).toBeInTheDocument()
    })
    expect(screen.getByTestId('card-waiting')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Live Queue/i })).toBeInTheDocument()

    // Verify sidebar navigation items
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    const dashboardLink = within(primaryNav).getByRole('link', { name: /Dashboard/i })
    const queueLink = within(primaryNav).getByRole('link', { name: /My Queue/i })

    expect(dashboardLink).toHaveAttribute('href', '/doctor')
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')

    expect(queueLink).toHaveAttribute('href', '/doctor/queue')
    expect(queueLink).not.toHaveAttribute('aria-current')
  })

  it('renders clinical queue workstation at /doctor/queue with My Queue highlighted in sidebar', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/queue']}>
          <Routes>
            <Route path="/doctor" element={<DoctorDashboardPage />} />
            <Route path="/doctor/queue" element={<DoctorQueueWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Verify clinical queue workspace contents
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /My Queue/i }),
      ).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('Cabin 102')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '3-Zone EMR' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kanban Cards' })).toBeInTheDocument()

    // Verify sidebar navigation items
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    const dashboardLink = within(primaryNav).getByRole('link', { name: /Dashboard/i })
    const queueLink = within(primaryNav).getByRole('link', { name: /My Queue/i })

    expect(dashboardLink).toHaveAttribute('href', '/doctor')
    expect(dashboardLink).not.toHaveAttribute('aria-current')

    expect(queueLink).toHaveAttribute('href', '/doctor/queue')
    expect(queueLink).toHaveAttribute('aria-current', 'page')
  })

  it('navigates from Dashboard to My Queue when clicking "My Queue ->" button in live queue', async () => {
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <Routes>
            <Route path="/doctor" element={<DoctorDashboardPage />} />
            <Route path="/doctor/queue" element={<DoctorQueueWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /Dr\. Anil Kumar/i }),
      ).toBeInTheDocument()
    })

    const queueButton = screen.getByRole('button', { name: /My Queue →/i })
    await user.click(queueButton)

    // Should now be on the clinical queue workstation
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /My Queue/i }),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '3-Zone EMR' })).toBeInTheDocument()
  })
})
