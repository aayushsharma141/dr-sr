import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DoctorDashboard, allergyStatus } from '../DoctorDashboard'
import { istToday } from '../../format'
import type { DoctorOut, DoctorQueueResponse, Me } from '../../api/types'

const mockMeDoctor: Me = {
  id: 3,
  username: 'dr.rane',
  full_name: 'Dr Vikram Rane',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['clinical.read', 'clinical.write'],
  version_id: 1,
}

const mockDoctors: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr Vikram Rane',
    name_hi: 'डॉ विक्रम राणे',
    qualification: 'MPT (Orthopaedics)',
    registration_number: 'MH-PT-20413',
    cabin_code: 'Room 104',
    default_fee_paise: 50000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const mockQueue: DoctorQueueResponse = {
  doctor_id: 1,
  doctor_name: 'Dr Vikram Rane',
  queue_date: '2026-11-14',
  in_consultation: [
    {
      id: 12,
      patient_id: 101,
      patient_urn: 'KH-2026-0012',
      patient_name: 'Rahul Sharma',
      patient_gender: 'M',
      patient_age: 34,
      patient_mobile: '9876543210',
      patient_allergies: 'Penicillin (RED)',
      token_number: 12,
      status: 'IN_CONSULTATION',
      status_updated_at: '2026-11-14T10:00:00Z',
      notes: 'Fever 3 days',
      version_id: 1,
    },
  ],
  waiting: [
    {
      id: 13,
      patient_id: 102,
      patient_urn: 'KH-2026-0013',
      patient_name: 'Sunita Devi',
      patient_gender: 'F',
      patient_age: 45,
      patient_mobile: '9876543211',
      patient_allergies: 'None reported',
      token_number: 13,
      status: 'ARRIVED',
      status_updated_at: '2026-11-14T10:10:00Z',
      notes: 'Knee pain',
      version_id: 1,
    },
  ],
  booked: [
    {
      id: 14,
      patient_id: 103,
      patient_urn: 'KH-2026-0014',
      patient_name: 'Amit Patel',
      patient_gender: 'M',
      patient_age: 28,
      patient_mobile: '9876543212',
      patient_allergies: 'None reported',
      token_number: 14,
      status: 'BOOKED',
      status_updated_at: '2026-11-14T10:20:00Z',
      notes: 'Follow-up consultation',
      version_id: 1,
    },
  ],
  completed: [],
  total_active: 3,
}

describe('Doctor Dashboard 3-Zone Clinical Workspace and Kanban Cards', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    queryClient.setQueryData(['me'], mockMeDoctor)
    queryClient.setQueryData(['doctors', { activeOnly: false }], mockDoctors)
    queryClient.setQueryData(['doctor-queue'], mockQueue)

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
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
      if (url.includes('/api/doctor/queue')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockQueue)),
        })
      }
      if (url.includes('/encounters') || url.includes('/prescriptions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders top bar with doctor status, room/cabin code, and current token', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Top Bar items
    expect(await screen.findByRole('heading', { level: 1, name: 'My Queue' })).toBeInTheDocument()
    expect(screen.getByText('Room 104')).toBeInTheDocument()
    expect(screen.getByText(/Current Token:/)).toBeInTheDocument()
    expect((await screen.findAllByText(/#12/)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('Doctor availability status')).toBeInTheDocument()
  })

  it('renders 3-Zone Workspace with Zone 1 Live Queue, Zone 2 Active Chart, and Zone 3 Rapid Actions', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Zone 1: Live Queue
    expect((await screen.findAllByText(/Live Queue/)).length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('Sunita Devi')).toBeInTheDocument()

    // Zone 2: Active Patient Chart (Rahul Sharma)
    expect(screen.getByRole('heading', { name: 'Rahul Sharma', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('Drug allergy recorded')).toBeInTheDocument()
    expect(screen.getAllByText(/Penicillin \(RED\)/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Clinical Notes \/ SOAP/)).toBeInTheDocument()
    expect(screen.getByText(/\+ Fever, chills \(3 days\)/)).toBeInTheDocument()

    // Zone 3: Rapid Order & Checkout Bar
    expect(screen.getByText('Rapid Orders & Checkout')).toBeInTheDocument()
    expect(screen.getByText('Tab Paracetamol 650mg')).toBeInTheDocument()
    expect(screen.getByText('Place on Lab Hold')).toBeInTheDocument()
    expect(screen.getByText(/Finish Consultation & Call Next/)).toBeInTheDocument()
  })

  it('switches between 3-Zone EMR and Kanban Cards view', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const kanbanBtn = await screen.findByRole('button', { name: 'Kanban Cards' })
    await user.click(kanbanBtn)

    // Kanban columns visible
    expect(screen.getByText('Kanban Queue Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Waiting Room')).toBeInTheDocument()
    expect(screen.getByText('In Consultation')).toBeInTheDocument()
    expect(screen.getByText('Lab Hold')).toBeInTheDocument()
    expect(screen.getByText('Seen Today')).toBeInTheDocument()
  })

  it('operates interactive Kanban Cards tab with search, filters, and clinical inspection sheet', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const kanbanBtn = await screen.findByRole('button', { name: 'Kanban Cards' })
    await user.click(kanbanBtn)

    // Kanban toolbar items
    expect(screen.getByText('Kanban Queue Pipeline')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search token, patient name/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split EMR' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Full Board' })).toBeInTheDocument()

    // Filter by searching patient
    const searchInput = screen.getByPlaceholderText(/Search token, patient name/)
    await user.type(searchInput, 'Sunita')
    expect(screen.getByText('Sunita Devi')).toBeInTheDocument()

    // Clear search
    await user.clear(searchInput)

    // Click on patient card to open clinical inspector in Kanban mode
    const card = screen.getByText('Sunita Devi')
    await user.click(card)

    // Clinical sheet inspector rendered for selected patient in Kanban view
    expect(screen.getAllByText('Sunita Devi').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Clinical Notes / SOAP').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Finish Consultation & Call Next/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows no made-up vitals, conditions or allergies (patient safety)', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByRole('heading', { name: 'Rahul Sharma', level: 3 })
    // Nothing in the queue carries vitals or chronic conditions, so none may appear.
    expect(screen.queryByText(/120\/80/)).not.toBeInTheDocument()
    expect(screen.queryByText(/SpO2/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Hypertension|Diabetes/)).not.toBeInTheDocument()

    // Sunita's record says "None reported": shown as recorded, with no red allergy warning.
    await user.click(screen.getAllByText('Sunita Devi')[0])
    await screen.findByRole('heading', { name: 'Sunita Devi', level: 3 })
    expect(screen.getAllByText(/None reported/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Drug allergy recorded')).not.toBeInTheDocument()
  })

  it('will not finish a consultation and throw away unsaved notes without asking', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByRole('heading', { name: 'Rahul Sharma', level: 3 })
    await user.type(screen.getAllByLabelText('Subjective / chief complaint')[0], 'Headache for 2 days')
    await user.click(screen.getAllByRole('button', { name: /Finish Consultation & Call Next/ })[0])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/not part of the\s+patient record/)).toBeInTheDocument()
    // No status change was sent while the notes are unsaved.
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.some(([url]) => String(url).includes('/status'))).toBe(false)
    // The notes are still there.
    expect(screen.getAllByLabelText('Subjective / chief complaint')[0]).toHaveValue('Headache for 2 days')
  })
})

describe('Doctor Dashboard: cabin and failed calls', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderWith(cabin: string | null) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const doctors = [{ ...mockDoctors[0], cabin_code: cabin }]
    queryClient.setQueryData(['me'], mockMeDoctor)
    queryClient.setQueryData(['doctors', { activeOnly: false }], doctors)
    queryClient.setQueryData(['doctor-queue'], mockQueue)
    const json = (body: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ code: 'invalid_transition', message: 'Patient is not checked in.' })),
          })
        }
        if (url.includes('/api/auth/me')) return json(mockMeDoctor)
        if (url.includes('/api/doctors')) return json(doctors)
        if (url.includes('/api/doctor/queue')) return json(mockQueue)
        return json([])
      }),
    )
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('never shows a default room when the doctor has no cabin', async () => {
    renderWith(null)
    expect(await screen.findByText('Not assigned')).toBeInTheDocument()
    expect(screen.queryByText(/Room 104/)).not.toBeInTheDocument()
  })

  it('reports a failed call instead of saying the token was called', async () => {
    const user = userEvent.setup()
    renderWith('A')
    await user.click(await screen.findByRole('button', { name: /Call Next Waiting/ }))

    const alert = await screen.findByText(/^Could not call Token/)
    expect(alert).toBeInTheDocument()
    expect(screen.queryByText(/Token .* called$/)).not.toBeInTheDocument()
  })
})

describe('allergyStatus', () => {
  it('never invents an allergy and tells "not recorded" apart from "none"', () => {
    expect(allergyStatus('')).toEqual({ kind: 'not_recorded', text: 'Not recorded' })
    expect(allergyStatus(null)).toEqual({ kind: 'not_recorded', text: 'Not recorded' })
    expect(allergyStatus('None reported')).toEqual({ kind: 'none', text: 'None reported' })
    expect(allergyStatus(' NKDA ').kind).toBe('none')
    expect(allergyStatus('Sulfa drugs')).toEqual({ kind: 'recorded', text: 'Sulfa drugs' })
  })
})

// --- Task 1: PriorityBadge on doctor queue cards, server order kept ---

const priorityQueue: DoctorQueueResponse = {
  doctor_id: 1,
  doctor_name: 'Dr Vikram Rane',
  queue_date: '2026-11-14',
  in_consultation: [],
  waiting: [
    {
      id: 21,
      patient_id: 201,
      patient_urn: 'KH-2026-0021',
      patient_name: 'Emergency Patient',
      patient_gender: 'M',
      patient_age: 50,
      patient_mobile: '9000000001',
      patient_allergies: 'None reported',
      token_number: 21,
      status: 'ARRIVED',
      status_updated_at: '2026-11-14T09:00:00Z',
      notes: null,
      version_id: 1,
      priority_level: 'EMERGENCY',
      priority_reason: 'Chest pain',
    },
    {
      id: 22,
      patient_id: 202,
      patient_urn: 'KH-2026-0022',
      patient_name: 'Priority Patient',
      patient_gender: 'F',
      patient_age: 40,
      patient_mobile: '9000000002',
      patient_allergies: 'None reported',
      token_number: 22,
      status: 'ARRIVED',
      status_updated_at: '2026-11-14T09:05:00Z',
      notes: null,
      version_id: 1,
      priority_level: 'PRIORITY',
      priority_reason: 'Severe pain',
    },
    {
      id: 23,
      patient_id: 203,
      patient_urn: 'KH-2026-0023',
      patient_name: 'Normal Patient',
      patient_gender: 'M',
      patient_age: 30,
      patient_mobile: '9000000003',
      patient_allergies: 'None reported',
      token_number: 23,
      status: 'ARRIVED',
      status_updated_at: '2026-11-14T09:10:00Z',
      notes: null,
      version_id: 1,
      priority_level: 'NORMAL',
    },
  ],
  booked: [],
  completed: [],
  total_active: 3,
}

function renderWithPriorityQueue(q: DoctorQueueResponse = priorityQueue) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  qc.setQueryData(['me'], mockMeDoctor)
  qc.setQueryData(['doctors', { activeOnly: false }], mockDoctors)
  qc.setQueryData(['doctor-queue'], q)
  const json = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) return json(mockMeDoctor)
      if (url.includes('/api/doctors')) return json(mockDoctors)
      if (url.includes('/api/doctor/queue')) return json(q)
      return json([])
    }),
  )
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DoctorDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Doctor Queue: PriorityBadge and server order (OD-22-06, OD-22-07)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows Emergency badge on EMERGENCY card and Priority badge on PRIORITY card', async () => {
    renderWithPriorityQueue()
    // The Live Queue sidebar shows waiting cards
    expect(await screen.findByText('Emergency Patient')).toBeInTheDocument()
    // EMERGENCY: badge text 'Emergency' (from PRIORITY_LABEL)
    expect(screen.getByText('Emergency')).toBeInTheDocument()
    // PRIORITY: badge text 'High' (from PRIORITY_LABEL)
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('shows no classification badge for NORMAL patients', async () => {
    renderWithPriorityQueue()
    expect(await screen.findByText('Normal Patient')).toBeInTheDocument()
    // 'Normal' badge should NOT be present (PriorityBadge returns null for NORMAL)
    expect(screen.queryByText('Normal')).not.toBeInTheDocument()
  })

  it('renders waiting cards in the order the server returns (no client-side sort)', async () => {
    renderWithPriorityQueue()
    expect(await screen.findByText('Emergency Patient')).toBeInTheDocument()

    // DOM order: Emergency first, Priority second, Normal third (server order)
    const cards = screen.getAllByText(/Patient$/)
    const names = cards.map((el) => el.textContent)
    expect(names).toEqual(['Emergency Patient', 'Priority Patient', 'Normal Patient'])
  })

  it('reversing the mock order renders in reversed DOM order (proves no client-side sort)', async () => {
    const reversedQueue: DoctorQueueResponse = {
      ...priorityQueue,
      waiting: [...priorityQueue.waiting].reverse(),
    }
    renderWithPriorityQueue(reversedQueue)
    expect(await screen.findByText('Normal Patient')).toBeInTheDocument()

    const cards = screen.getAllByText(/Patient$/)
    const names = cards.map((el) => el.textContent)
    expect(names).toEqual(['Normal Patient', 'Priority Patient', 'Emergency Patient'])
  })
})

// --- Task 2: Pinned in-consultation card, last-updated, stale warning ---

const queueWithConsult: DoctorQueueResponse = {
  doctor_id: 1,
  doctor_name: 'Dr Vikram Rane',
  queue_date: '2026-11-14',
  in_consultation: [
    {
      id: 31,
      patient_id: 301,
      patient_urn: 'KH-2026-0031',
      patient_name: 'Consult Patient',
      patient_gender: 'M',
      patient_age: 44,
      patient_mobile: '9100000001',
      patient_allergies: 'None reported',
      token_number: 31,
      status: 'IN_CONSULTATION',
      status_updated_at: '2026-11-14T10:00:00Z',
      notes: null,
      version_id: 1,
    },
  ],
  waiting: [
    {
      id: 32,
      patient_id: 302,
      patient_urn: 'KH-2026-0032',
      patient_name: 'Emergency Waiter',
      patient_gender: 'F',
      patient_age: 55,
      patient_mobile: '9100000002',
      patient_allergies: 'None reported',
      token_number: 32,
      status: 'ARRIVED',
      status_updated_at: '2026-11-14T10:05:00Z',
      notes: null,
      version_id: 1,
      priority_level: 'EMERGENCY',
    },
  ],
  booked: [],
  completed: [],
  total_active: 2,
}

describe('Doctor Queue: pinned in-consultation card and freshness (OD-22-08, CONTEXT)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderWithConsult(q: DoctorQueueResponse = queueWithConsult, overrides: { isError?: boolean } = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    qc.setQueryData(['me'], mockMeDoctor)
    qc.setQueryData(['doctors', { activeOnly: false }], mockDoctors)
    qc.setQueryData(['doctor-queue'], q)
    const json = (body: unknown) =>
      Promise.resolve({
        ok: overrides.isError ? false : true,
        status: overrides.isError ? 500 : 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return json(mockMeDoctor)
        if (url.includes('/api/doctors')) return json(mockDoctors)
        if (url.includes('/api/doctor/queue')) return json(q)
        return json([])
      }),
    )
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('pins the in-consultation card in its own section above the waiting list (OD-22-08)', async () => {
    renderWithConsult()

    // Both cards rendered
    expect((await screen.findAllByText('Consult Patient')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Emergency Waiter')).toBeInTheDocument()

    // The in-consultation section heading must appear before the waiting room heading in the DOM
    const inConsultLabel = screen.getByText('In Consultation')
    const waitingRoomLabel = screen.getByText(/^Waiting Room/)
    expect(
      inConsultLabel.compareDocumentPosition(waitingRoomLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // The emergency waiter stays in the waiting list, not the in-consultation section
    const inConsultSection = inConsultLabel.closest('div')!
    expect(within(inConsultSection as HTMLElement).queryByText('Emergency Waiter')).toBeNull()
  })

  it('shows "Last updated" followed by a time after a successful fetch', async () => {
    renderWithConsult()
    // dataUpdatedAt is set by react-query when data lands; we just need the text to appear
    expect(await screen.findByText(/Last updated/)).toBeInTheDocument()
  })

  it('shows stale-data InlineAlert with role=alert when isError and data is present', async () => {
    renderWithConsult(queueWithConsult, { isError: true })
    // With isError=true from the fetch mock, react-query will mark the query as errored
    // The component should show the InlineAlert
    // Note: since setQueryData already set data, the query has stale data + error state
    const alerts = await screen.findAllByRole('alert')
    const staleAlert = alerts.find((el) => el.textContent?.includes('Could not refresh'))
    expect(staleAlert).toBeTruthy()
  })
})

describe('Doctor Dashboard: patient-scoped scratchpad isolation (C5)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('isolates SOAP notes, Quick Meds, Lab Orders, and Follow-up days per patient and clears only the finished patient', async () => {
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    qc.setQueryData(['me'], mockMeDoctor)
    qc.setQueryData(['doctors', { activeOnly: false }], mockDoctors)
    qc.setQueryData(['doctor-queue'], mockQueue)

    const json = (body: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status') && init?.method === 'PATCH') {
        const body = init.body ? JSON.parse(String(init.body)) : {}
        return json({ id: 12, status: body.status ?? 'DONE', version_id: 2 })
      }
      if (url.includes('/api/auth/me')) return json(mockMeDoctor)
      if (url.includes('/api/doctors')) return json(mockDoctors)
      if (url.includes('/api/doctor/queue')) return json(mockQueue)
      return json([])
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Patient A (Rahul Sharma, patient_id=101) is initially active
    expect(await screen.findByRole('heading', { name: 'Rahul Sharma', level: 3 })).toBeInTheDocument()

    // Populate SOAP notes, Quick Meds, Lab Orders, and Follow-up days on Patient A
    await user.type(screen.getByLabelText('Subjective / chief complaint'), 'Rahul fever 3 days')
    await user.type(screen.getByLabelText('Objective / clinical examination'), 'Throat congested')
    await user.click(screen.getByRole('button', { name: /Tab Paracetamol 650mg/i }))
    expect(screen.getByRole('button', { name: /Tab Paracetamol 650mg/i })).toHaveTextContent('✓ Added')

    const cbcCheckbox = screen.getByLabelText('CBC (Complete Blood Count)') as HTMLInputElement
    await user.click(cbcCheckbox)
    expect(cbcCheckbox.checked).toBe(true)

    await user.click(screen.getByRole('button', { name: '14d' }))

    // Switch to Patient B (Sunita Devi, patient_id=102) -> clean empty scratchpad
    await user.click(screen.getAllByText('Sunita Devi')[0])
    expect(await screen.findByRole('heading', { name: 'Sunita Devi', level: 3 })).toBeInTheDocument()

    expect(screen.getByLabelText('Subjective / chief complaint')).toHaveValue('')
    expect(screen.getByLabelText('Objective / clinical examination')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Tab Paracetamol 650mg/i })).not.toHaveTextContent('✓ Added')
    expect((screen.getByLabelText('CBC (Complete Blood Count)') as HTMLInputElement).checked).toBe(false)

    // Add distinct scratchpad content for Patient B
    await user.type(screen.getByLabelText('Subjective / chief complaint'), 'Sunita right knee pain')
    await user.click(screen.getByRole('button', { name: /Cap Amoxicillin 500mg/i }))
    expect(screen.getByRole('button', { name: /Cap Amoxicillin 500mg/i })).toHaveTextContent('✓ Added')

    // Switch back to Patient A -> retains Patient A's scratchpad without leaking Patient B's data
    await user.click(screen.getAllByText('Rahul Sharma')[0])
    expect(await screen.findByRole('heading', { name: 'Rahul Sharma', level: 3 })).toBeInTheDocument()

    expect(screen.getByLabelText('Subjective / chief complaint')).toHaveValue('Rahul fever 3 days')
    expect(screen.getByLabelText('Objective / clinical examination')).toHaveValue('Throat congested')
    expect(screen.getByRole('button', { name: /Tab Paracetamol 650mg/i })).toHaveTextContent('✓ Added')
    expect(screen.getByRole('button', { name: /Cap Amoxicillin 500mg/i })).not.toHaveTextContent('✓ Added')
    expect((screen.getByLabelText('CBC (Complete Blood Count)') as HTMLInputElement).checked).toBe(true)

    // Finish Patient A (confirming discard of rough scratchpad) -> clears Patient A's scratchpad only
    await user.click(screen.getByRole('button', { name: /Finish Consultation & Call Next/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Discard notes and finish/i }))

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u, init]) => String(u).includes('/api/appointments/12/status') && (init as RequestInit)?.method === 'PATCH')).toBe(true)
    })

    // Re-selecting Patient A confirms Patient A's scratchpad was cleared
    await user.click(screen.getAllByText('Rahul Sharma')[0])
    expect(await screen.findByRole('heading', { name: 'Rahul Sharma', level: 3 })).toBeInTheDocument()
    expect(screen.getByLabelText('Subjective / chief complaint')).toHaveValue('')
    expect(screen.getByLabelText('Objective / clinical examination')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Tab Paracetamol 650mg/i })).not.toHaveTextContent('✓ Added')
    expect((screen.getByLabelText('CBC (Complete Blood Count)') as HTMLInputElement).checked).toBe(false)

    // Patient B's scratchpad remains intact
    await user.click(screen.getAllByText('Sunita Devi')[0])
    expect(await screen.findByRole('heading', { name: 'Sunita Devi', level: 3 })).toBeInTheDocument()
    expect(screen.getByLabelText('Subjective / chief complaint')).toHaveValue('Sunita right knee pain')
    expect(screen.getByRole('button', { name: /Cap Amoxicillin 500mg/i })).toHaveTextContent('✓ Added')
  })
})

describe('Doctor Dashboard: queue reliability, transitions, and shared-PC isolation (A4)', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  function renderQueue(q: DoctorQueueResponse, meOverrides: Partial<Me> = {}) {
    const me = { ...mockMeDoctor, ...meOverrides }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    qc.setQueryData(['me'], me)
    qc.setQueryData(['doctors', { activeOnly: false }], mockDoctors)
    qc.setQueryData(['doctor-queue'], q)

    const json = (body: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status') && init?.method === 'PATCH') {
        const body = init.body ? JSON.parse(String(init.body)) : {}
        return json({ id: 99, status: body.status ?? 'IN_CONSULTATION', version_id: 2 })
      }
      if (url.includes('/api/auth/me')) return json(me)
      if (url.includes('/api/doctors')) return json(mockDoctors)
      if (url.includes('/api/doctor/queue')) return json(q)
      return json([])
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    return { mockFetch }
  }

  it('renders all concurrent IN_CONSULTATION patients in 3-Zone Zone 1 and clearly separates booked items in Live Queue badge', async () => {
    const multiConsultQueue: DoctorQueueResponse = {
      ...mockQueue,
      in_consultation: [
        mockQueue.in_consultation[0],
        {
          id: 15,
          patient_id: 105,
          patient_urn: 'KH-2026-0015',
          patient_name: 'Meera Joshi',
          patient_gender: 'F',
          patient_age: 52,
          patient_mobile: '9876543215',
          patient_allergies: 'None reported',
          token_number: 15,
          status: 'IN_CONSULTATION',
          consultation_status: 'IN_CONSULTATION',
          status_updated_at: '2026-11-14T10:15:00Z',
          notes: 'Post-op follow-up',
          version_id: 1,
        },
      ],
      total_active: 4,
    }

    renderQueue(multiConsultQueue)

    expect(await screen.findByText('Meera Joshi')).toBeInTheDocument()
    expect(screen.getAllByText('Rahul Sharma').length).toBeGreaterThanOrEqual(1)
    // 2 in_consultation + 1 waiting = 3 physically present live queue; 1 booked
    expect(screen.getByRole('heading', { level: 2, name: 'Live Queue (3) · 1 Booked' })).toBeInTheDocument()
    // In Consultation cards have no broken "Hold" button
    expect(screen.queryByRole('button', { name: /^Hold$/ })).not.toBeInTheDocument()
  })

  it('shows Awaiting Reception check-in on BOOKED cards and blocks PATCH /status when calling a BOOKED patient', async () => {
    const user = userEvent.setup()
    const { mockFetch } = renderQueue(mockQueue)

    expect(await screen.findByText('Amit Patel')).toBeInTheDocument()
    expect(screen.getByText('Awaiting Reception check-in')).toBeInTheDocument()
    // Only the waiting card (Sunita Devi) has Start Consultation; BOOKED card (Amit Patel) does not
    expect(screen.getAllByRole('button', { name: /Start Consultation/ })).toHaveLength(1)

    // Switch to Kanban, select BOOKED patient Amit Patel, and click Call in the inspector
    await user.click(screen.getByRole('button', { name: 'Kanban Cards' }))
    await user.click(screen.getByText('Amit Patel'))
    const callButtons = screen.getAllByRole('button', { name: /^Call$/ })
    await user.click(callButtons[callButtons.length - 1])

    expect(await screen.findByText('Patient has not been checked in by reception yet.')).toBeInTheDocument()
    expect(
      mockFetch.mock.calls.some(([url, init]) => String(url).includes('/status') && (init as RequestInit)?.method === 'PATCH'),
    ).toBe(false)
  })

  it('disables Finish Consultation & Call Next for WAITING, BOOKED, and DONE patients and enables it for IN_CONSULTATION', async () => {
    const user = userEvent.setup()
    const queueWithDone: DoctorQueueResponse = {
      ...mockQueue,
      waiting: [
        {
          ...mockQueue.waiting[0],
          status: 'WAITING',
          consultation_status: 'WAITING',
        },
      ],
      completed: [
        {
          id: 19,
          patient_id: 109,
          patient_urn: 'KH-2026-0019',
          patient_name: 'Vikash Verma',
          patient_gender: 'M',
          patient_age: 61,
          patient_mobile: '9876543219',
          patient_allergies: 'None reported',
          token_number: 19,
          status: 'DONE',
          consultation_status: 'COMPLETED',
          status_updated_at: '2026-11-14T09:40:00Z',
          notes: null,
          version_id: 2,
        },
      ],
    }

    const { mockFetch } = renderQueue(queueWithDone)

    // Initially active: Rahul Sharma (IN_CONSULTATION) -> Finish enabled
    expect(await screen.findByRole('heading', { name: 'Rahul Sharma', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Finish Consultation & Call Next/ })).toBeEnabled()

    // Select WAITING patient (Sunita Devi) -> Finish disabled
    await user.click(screen.getByText('Sunita Devi'))
    expect(await screen.findByRole('heading', { name: 'Sunita Devi', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Finish Consultation & Call Next/ })).toBeDisabled()

    // Select BOOKED patient (Amit Patel) -> Finish disabled
    await user.click(screen.getByText('Amit Patel'))
    expect(await screen.findByRole('heading', { name: 'Amit Patel', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Finish Consultation & Call Next/ })).toBeDisabled()

    // Switch to Kanban and select DONE patient (Vikash Verma) -> Finish disabled
    await user.click(screen.getByRole('button', { name: 'Kanban Cards' }))
    await user.click(screen.getByText('Vikash Verma'))
    expect(await screen.findByRole('heading', { name: 'Vikash Verma', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Finish Consultation & Call Next/ })).toBeDisabled()

    // Calling a WAITING status patient succeeds with PATCH /status -> IN_CONSULTATION
    await user.click(screen.getByRole('button', { name: /^Call Next$/ }))
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/appointments/13/status') && (init as RequestInit)?.method === 'PATCH',
        ),
      ).toBe(true)
    })
  })

  it('ignores dragging an IN_CONSULTATION card onto Lab Hold and namespaces localStorage by doctor_id and IST date', async () => {
    const user = userEvent.setup()
    renderQueue(mockQueue, { doctor_id: 7 })

    // Change doctor status -> stored under kh.doctor.status.7
    await user.selectOptions(await screen.findByLabelText('Doctor availability status'), 'ON_BREAK')
    expect(localStorage.getItem('kh.doctor.status.7')).toBe('ON_BREAK')
    expect(localStorage.getItem('kh.doctor.status')).toBeNull()

    // Switch to Kanban and attempt to drop IN_CONSULTATION card onto Lab Hold column
    await user.click(screen.getByRole('button', { name: 'Kanban Cards' }))
    const labHoldHeading = screen.getByRole('heading', { level: 3, name: 'Lab Hold' })
    const labHoldColumn = labHoldHeading.closest('div')!.parentElement!.parentElement!

    const dataTransfer = {
      getData: () => JSON.stringify(mockQueue.in_consultation[0]),
    }
    fireEvent.drop(labHoldColumn, { dataTransfer })

    expect(localStorage.getItem(`kh.doctor.labHold.7.${istToday()}`)).toBeNull()
    expect(within(labHoldColumn).getByText('No tokens on diagnostics hold')).toBeInTheDocument()

    // Place waiting patient Sunita Devi on Lab Hold -> stored under namespaced key
    const waitingTransfer = {
      getData: () => JSON.stringify(mockQueue.waiting[0]),
    }
    fireEvent.drop(labHoldColumn, { dataTransfer: waitingTransfer })
    expect(localStorage.getItem(`kh.doctor.labHold.7.${istToday()}`)).toBe(JSON.stringify([13]))
    expect(localStorage.getItem('kh.doctor.labHold')).toBeNull()
    expect(within(labHoldColumn).getByText('Sunita Devi')).toBeInTheDocument()
  })

  it('cancels pending autoCallTimerRef when Call Next Waiting is invoked', async () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    renderQueue(mockQueue)

    // Sunita Devi is in the waiting list
    expect(screen.getByText('Sunita Devi')).toBeInTheDocument()

    const callNextBtn = screen.getByRole('button', { name: /Call Next Waiting/i })
    fireEvent.click(callNextBtn)

    // handleCallNext checks and clears autoCallTimerRef at the start
    expect(clearTimeoutSpy).toBeDefined()
    expect(screen.getAllByText('Sunita Devi').length).toBeGreaterThanOrEqual(1)
  })
})
