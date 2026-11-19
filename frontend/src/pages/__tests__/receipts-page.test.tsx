import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiptsPage } from '../ReceiptsPage'
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

const mockAdmin: Me = {
  ...mockReception,
  id: 1,
  username: 'admin',
  full_name: 'Admin User',
  role: 'ADMIN',
  permissions: ['payment:read', 'payment:reverse', 'visit:read'],
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
  me: Me = mockReception,
  payments: PaymentOut[] = mockPayments,
  client?: QueryClient,
) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    })

  const mockFetch = mockApi({
    '/api/auth/me': () => ({ body: me }),
    '/api/billing/receipts/today': () => ({ body: payments }),
    '/api/clinic/branding': () => ({
      body: {
        trustNameEn: 'Sri Vashishtha Kalyan Trust',
        hospitalName: 'Kalyan Hospital',
      },
    }),
    '/api/settings/clinic': () => ({
      body: { clinic_name: 'Kalyan Hospital' },
    }),
  })
  vi.stubGlobal('fetch', mockFetch)

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reception/receipts']}>
        <ReceiptsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReceiptsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("lists today's receipts newest first with receipt details and totals line", async () => {
    renderPage()

    // Title and heading
    expect(await screen.findByRole('heading', { name: 'Receipts', level: 1 })).toBeInTheDocument()

    // Table rows
    expect(await screen.findByText('REC-2026-0012')).toBeInTheDocument()
    expect(screen.getByText('REC-2026-0011')).toBeInTheDocument()
    expect(screen.getByText('REC-2026-0010')).toBeInTheDocument()

    // Patient names and URNs
    expect(screen.getByText('Rahul Sharma')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0003')).toBeInTheDocument()
    expect(screen.getByText('Pooja Devi')).toBeInTheDocument()
    expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()

    // Reversed row shows Reversed tag
    expect(screen.getByText('Reversed')).toBeInTheDocument()

    // Totals line: excludes reversed (500 + 300 = 800)
    // 2 receipts · ₹800.00
    expect(screen.getByText(/2 receipts · ₹800\.00/i)).toBeInTheDocument()
  })

  it('renders empty state when no receipts are issued today', async () => {
    renderPage(mockReception, [])

    expect(await screen.findByText('No receipts issued today.')).toBeInTheDocument()
  })

  it('clicking Reprint opens ReceiptDialog marked with DUPLICATE', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('REC-2026-0010')).toBeInTheDocument()

    // Find Reprint buttons
    const reprintButtons = screen.getAllByRole('button', { name: /reprint/i })
    expect(reprintButtons.length).toBeGreaterThan(0)

    await user.click(reprintButtons[reprintButtons.length - 1]) // Click Aarav's reprint

    // Dialog opens with DUPLICATE mark
    const duplicateMarks = await screen.findAllByText(/DUPLICATE COPY/i)
    expect(duplicateMarks.length).toBeGreaterThan(0)
    expect(screen.getAllByText('REC-2026-0010').length).toBeGreaterThan(0)
  })

  it('shows Full ledger link to admin but not to reception', async () => {
    const { unmount } = renderPage(mockAdmin)

    expect(await screen.findByRole('link', { name: /Full ledger/i })).toHaveAttribute(
      'href',
      '/admin/billing',
    )

    unmount()
    renderPage(mockReception)

    expect(await screen.findByRole('heading', { name: 'Receipts', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Full ledger/i })).not.toBeInTheDocument()
  })

  it('filters receipts by search query', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('REC-2026-0010')).toBeInTheDocument()
    expect(screen.getByText('REC-2026-0011')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(/filter/i)
    await user.type(searchInput, 'Pooja')

    expect(screen.getByText('REC-2026-0011')).toBeInTheDocument()
    expect(screen.queryByText('REC-2026-0010')).not.toBeInTheDocument()
    expect(screen.queryByText('REC-2026-0012')).not.toBeInTheDocument()
  })

  it('renders top financial desk tabs linking to billing and reports', async () => {
    renderPage()

    const deskNav = await screen.findByRole('navigation', { name: 'Reception Desk Financial Tabs' })
    const billingTab = within(deskNav).getByRole('link', { name: /Billing & Checkout/i })
    expect(billingTab).toHaveAttribute('href', '/reception/billing')

    const reportsTab = within(deskNav).getByRole('link', { name: /Daily Collection Report/i })
    expect(reportsTab).toHaveAttribute('href', '/reception/reports')
  })

  it('filters receipts by payment method chips', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('REC-2026-0010')).toBeInTheDocument() // CASH
    expect(screen.getByText('REC-2026-0011')).toBeInTheDocument() // UPI
    expect(screen.getByText('REC-2026-0012')).toBeInTheDocument() // CARD (Reversed)

    // Click Cash Drawer filter chip
    const cashChip = screen.getByRole('button', { name: /Cash Drawer/i })
    await user.click(cashChip)
    expect(screen.getByText('REC-2026-0010')).toBeInTheDocument()
    expect(screen.queryByText('REC-2026-0011')).not.toBeInTheDocument()
    expect(screen.queryByText('REC-2026-0012')).not.toBeInTheDocument()

    // Click UPI filter chip
    const upiChip = screen.getByRole('button', { name: /UPI \/ QR/i })
    await user.click(upiChip)
    expect(screen.getByText('REC-2026-0011')).toBeInTheDocument()
    expect(screen.queryByText('REC-2026-0010')).not.toBeInTheDocument()

    // Click Reversals filter chip
    const reversalsChip = screen.getByRole('button', { name: /Reversals/i })
    await user.click(reversalsChip)
    expect(screen.getByText('REC-2026-0012')).toBeInTheDocument()
    expect(screen.queryByText('REC-2026-0010')).not.toBeInTheDocument()
    expect(screen.queryByText('REC-2026-0011')).not.toBeInTheDocument()
  })
})
