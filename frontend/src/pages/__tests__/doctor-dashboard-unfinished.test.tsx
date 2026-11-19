import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoctorDashboard } from '../DoctorDashboard'
import { DoctorDashboardUnfinishedCard, formatRelativeTime } from '../../components/DoctorDashboardUnfinishedCard'
import type { DoctorQueueResponse, Me, UnfinishedEncounter } from '../../api/types'

const mockMeDoctor: Me = {
  id: 3,
  username: 'doctor',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['encounters:read', 'encounters:write', 'dashboard:doctor'],
  version_id: 1,
}

const mockEmptyQueue: DoctorQueueResponse = {
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  queue_date: '2026-11-06',
  in_consultation: [],
  waiting: [],
  booked: [],
  completed: [],
  total_active: 0,
}

const mockDrafts: UnfinishedEncounter[] = [
  {
    id: 42,
    patient_id: 201,
    patient_name: 'Rameshwar Singh',
    patient_urn: 'KH-2026-8801',
    department_id: 1,
    department_name: 'Physiotherapy',
    started_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15m ago
    is_finalised: false,
  },
  {
    id: 43,
    patient_id: 202,
    patient_name: 'Sunita Devi',
    patient_urn: 'KH-2026-8802',
    department_id: 2,
    department_name: 'Ophthalmology',
    started_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    is_finalised: false,
  },
]

describe('formatRelativeTime helper', () => {
  it('formats recent timestamps into human readable relative intervals', () => {
    const justNow = new Date(Date.now() - 10 * 1000).toISOString()
    expect(formatRelativeTime(justNow)).toBe('Just now')

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(formatRelativeTime(tenMinAgo)).toBe('10m ago')

    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago')
  })
})

describe('DoctorDashboardUnfinishedCard component', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders empty state when there are 0 unfinished drafts', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboardUnfinishedCard encounters={[]} isLoading={false} />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByText('Unfinished Consultations')).toBeInTheDocument()
    expect(screen.getByTestId('unfinished-draft-count')).toHaveTextContent('0')
    expect(screen.getByText('No Unfinished Consultations')).toBeInTheDocument()
    expect(
      screen.getByText(
        "All active clinical encounters have been finalised. Select a patient from today's queue to begin a new consultation."
      )
    ).toBeInTheDocument()
  })

  it('renders draft rows with patient name, URN chip, department badge, and relative time', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboardUnfinishedCard encounters={mockDrafts} isLoading={false} />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByTestId('unfinished-draft-count')).toHaveTextContent('2')
    expect(screen.getByText('Rameshwar Singh')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-8801')).toBeInTheDocument()
    expect(screen.getByText('Physiotherapy')).toBeInTheDocument()
    expect(screen.getByText('15m ago')).toBeInTheDocument()

    expect(screen.getByText('Sunita Devi')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-8802')).toBeInTheDocument()
    expect(screen.getByText('Ophthalmology')).toBeInTheDocument()
    expect(screen.getByText('2h ago')).toBeInTheDocument()

    const resumeButtons = screen.getAllByRole('button', { name: /Resume Consultation Draft/i })
    expect(resumeButtons).toHaveLength(2)
  })

  it('navigates to /doctor/encounters/:id when Resume button is clicked', async () => {
    const user = userEvent.setup()
    let navigatedEncounterId: number | null = null

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboardUnfinishedCard
            encounters={mockDrafts}
            isLoading={false}
            onNavigate={(id) => {
              navigatedEncounterId = id
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const resumeButtons = screen.getAllByRole('button', { name: /Resume Consultation Draft/i })
    await user.click(resumeButtons[0])

    expect(navigatedEncounterId).toBe(42)
  })

  it('does not fetch /encounters/unfinished when encounters prop is supplied', () => {
    const fetchSpy = vi.spyOn(global, 'fetch')

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboardUnfinishedCard encounters={mockDrafts} isLoading={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders an explicit error alert with Retry instead of green empty state when the API fails', async () => {
    const user = userEvent.setup()
    let shouldFail = true

    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/encounters/unfinished')) {
        if (shouldFail) {
          return Promise.resolve(
            new Response(JSON.stringify({ message: 'Database unavailable' }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify(mockDrafts), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboardUnfinishedCard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const errorAlert = await screen.findByTestId('unfinished-consultations-error')
    expect(errorAlert).toHaveAttribute('role', 'alert')
    expect(screen.queryByText('No Unfinished Consultations')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unfinished-empty-state')).not.toBeInTheDocument()

    // Retrying after recovery loads the unfinished drafts
    shouldFail = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Rameshwar Singh')).toBeInTheDocument()
    expect(screen.queryByTestId('unfinished-consultations-error')).not.toBeInTheDocument()
  })

  it('disables the retry button and renders "Retrying…" while refetch is in progress', async () => {
    let shouldFail = true
    let finishRetryFetch: () => void = () => {}

    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/encounters/unfinished')) {
        if (shouldFail) {
          return Promise.resolve(
            new Response(JSON.stringify({ message: 'Internal server error' }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }
        return new Promise<Response>((resolve) => {
          finishRetryFetch = () =>
            resolve(
              new Response(JSON.stringify(mockDrafts), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            )
        })
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboardUnfinishedCard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByTestId('unfinished-consultations-error')
    const retryBtn = screen.getByRole('button', { name: 'Retry' })
    expect(retryBtn).toBeEnabled()

    shouldFail = false
    await user.click(retryBtn)

    // Button should now be disabled and text should be "Retrying…"
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled()

    // Complete the fetch
    finishRetryFetch()
    expect(await screen.findByText('Rameshwar Singh')).toBeInTheDocument()
  })
})

describe('DoctorDashboard integration with Unfinished Consultations card', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify(mockMeDoctor), { status: 200 }))
      }
      if (url.includes('/doctor/queue') || url.includes('/queue')) {
        return Promise.resolve(new Response(JSON.stringify(mockEmptyQueue), { status: 200 }))
      }
      if (url.includes('/encounters/unfinished')) {
        return Promise.resolve(new Response(JSON.stringify(mockDrafts), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders DoctorDashboard with Unfinished Consultations card above queue', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor']}>
          <Routes>
            <Route path="/doctor" element={<DoctorDashboard />} />
            <Route path="/doctor/encounters/:id" element={<div data-testid="encounter-workspace">Encounter Workspace</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    // Unfinished card header is visible
    expect(await screen.findByText('Unfinished Consultations')).toBeInTheDocument()
    expect(await screen.findByText('Rameshwar Singh')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-8801')).toBeInTheDocument()

    // Today's consultation queue is also visible below
    expect(screen.getByRole('heading', { level: 1, name: 'My Queue' })).toBeInTheDocument()
  })
})
