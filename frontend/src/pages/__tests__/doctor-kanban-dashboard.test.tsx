import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DoctorDashboard } from '../DoctorDashboard'
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
    expect(await screen.findByText('Doctor Dashboard')).toBeInTheDocument()
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
    expect(screen.getByText(/Critical Clinical Alert/)).toBeInTheDocument()
    expect(screen.getByText(/Drug Allergies: Penicillin \(RED\)/)).toBeInTheDocument()
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
})
