import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionReportsPage } from '../ReceptionReportsPage'
import type { Me, PaymentOut } from '../../api/types'

const mockReception: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  csrf_token: 'test-token',
  must_change_password: false,
  permissions: ['payment:create', 'payment:read', 'visit:read', 'visit:write'],
  version_id: 1,
}

const mockPayments: PaymentOut[] = [
  {
    id: 10,
    receipt_number: 'REC-2026-0010',
    patient_id: 1,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Aarav Kumar',
    treatment_plan_id: null,
    treatment_plan_name: null,
    appointment_id: null,
    visit_id: 5,
    amount_paise: 50000,
    payment_method: 'CASH',
    notes: 'OPD Consultation',
    is_reversed: false,
    reversal_reason: null,
    reversed_by_username: null,
    reversed_at: null,
    created_by_username: 'reception',
    created_at: '2026-11-16T10:30:00Z',
  },
  {
    id: 11,
    receipt_number: 'REC-2026-0011',
    patient_id: 2,
    patient_urn: 'KH-2026-0002',
    patient_name: 'Pooja Devi',
    treatment_plan_id: null,
    treatment_plan_name: null,
    appointment_id: null,
    visit_id: 6,
    amount_paise: 30000,
    payment_method: 'UPI',
    notes: 'OPD Consultation',
    is_reversed: false,
    reversal_reason: null,
    reversed_by_username: null,
    reversed_at: null,
    created_by_username: 'reception',
    created_at: '2026-11-16T11:15:00Z',
  },
  {
    id: 12,
    receipt_number: 'REC-2026-0012',
    patient_id: 3,
    patient_urn: 'KH-2026-0003',
    patient_name: 'Rahul Sharma',
    treatment_plan_id: null,
    treatment_plan_name: null,
    appointment_id: null,
    visit_id: 7,
    amount_paise: 40000,
    payment_method: 'CARD',
    notes: 'Physiotherapy',
    is_reversed: true,
    reversal_reason: 'Entered wrong amount',
    reversed_by_username: 'admin',
    reversed_at: '2026-11-16T11:45:00Z',
    created_by_username: 'reception',
    created_at: '2026-11-16T11:30:00Z',
  },
]

type RouteHandler = (init?: RequestInit) => { status?: number; body: unknown }

function mockApi(routes: Record<string, RouteHandler>) {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.includes(' ') ? k.split(' ') : ['GET', k]
      return m === method && p === path
    })
    if (!key) return Promise.reject(new Error(`Unhandled ${method} ${path}`))
    const reply = routes[key](init)
    return Promise.resolve({
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(reply.body)),
    })
  })
}

function renderPage(
  payments: PaymentOut[] = mockPayments,
  error = false,
  pending = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  const mockFetch = mockApi({
    '/api/auth/me': () => ({ body: mockReception }),
    '/api/billing/receipts/today': () => {
      if (pending) return { status: 200, body: new Promise(() => {}) }
      if (error) return { status: 500, body: { message: 'Server connection failed' } }
      return { status: 200, body: payments }
    },
    '/api/clinic/branding': () => ({
      body: {
        trustNameEn: 'Sri Vashishtha Kalyan Trust',
        hospitalName: 'Kalyan Hospital',
      },
    }),
  })
  vi.stubGlobal('fetch', mockFetch)

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reception/reports']}>
        <ReceptionReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReceptionReportsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders today collection summary showing collected total and reversed total separately', async () => {
    renderPage()

    // Page title equals navigation label
    expect(await screen.findByRole('heading', { name: 'Reports', level: 1 })).toBeInTheDocument()

    // Collected total (500 + 300 = 800) and count (2 receipts)
    expect(await screen.findByText('₹800.00')).toBeInTheDocument()
    expect(screen.getByText(/2 receipts/i)).toBeInTheDocument()

    // Reversed total (400) and count (1 receipt)
    expect(screen.getByText('₹400.00')).toBeInTheDocument()
    expect(screen.getByText(/1 reversed receipt/i)).toBeInTheDocument()

    // No referral data on reception reports
    expect(screen.queryByText(/referral/i)).not.toBeInTheDocument()
  })

  it('renders empty state when no receipts are issued today', async () => {
    renderPage([])

    expect(await screen.findByText('No receipts issued today.')).toBeInTheDocument()
  })

  it('renders error state on fetch failure', async () => {
    renderPage([], true)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('renders cashier drawer reconciliation and service breakdown', async () => {
    renderPage()

    // Top desk tabs
    const deskNav = await screen.findByRole('navigation', { name: 'Reception Desk Financial Tabs' })
    expect(within(deskNav).getByRole('link', { name: /Billing & Checkout/i })).toHaveAttribute(
      'href',
      '/reception/billing',
    )
    expect(within(deskNav).getByRole('link', { name: /Receipts Desk/i })).toHaveAttribute(
      'href',
      '/reception/receipts',
    )

    // Cashier Drawer Reconciliation heading and breakdown
    expect(await screen.findByText('Cashier Drawer Reconciliation')).toBeInTheDocument()
    expect(screen.getByText('Physical Cash in Drawer')).toBeInTheDocument()
    expect(screen.getByText('UPI / QR Collections')).toBeInTheDocument()
    expect(screen.getByText('Card / POS Terminal')).toBeInTheDocument()

    // Specific mode totals from mockPayments (500 cash, 300 upi)
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    expect(screen.getByText('₹300.00')).toBeInTheDocument()

    // Department & Service Breakdown
    expect(screen.getByText('Department & Service Breakdown')).toBeInTheDocument()
    expect(screen.getAllByText(/OPD Consultation/i).length).toBeGreaterThan(0)

    // Print button exists
    expect(screen.getByRole('button', { name: /Print Closing Sheet/i })).toBeInTheDocument()
  })
})
