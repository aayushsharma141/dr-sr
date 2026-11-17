import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionBillingPage } from '../ReceptionBillingPage'
import type {
  Me,
  PatientOut,
  PaymentOut,
  PendingDueOut,
  DoctorOut,
  VisitDetail,
  VisitDueOut,
  VisitSummary,
} from '../../api/types'
import type { VisitBillOut } from '../../api/bill'

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: [
    'payment:create',
    'payment:read',
    'patients:read',
    'appointment:read',
    'visit:read',
    'visit:write',
  ],
  version_id: 1,
}

const mockAdmin: Me = {
  ...mockMe,
  id: 1,
  username: 'admin',
  full_name: 'Admin User',
  role: 'ADMIN',
  permissions: ['payment:read', 'payment:reverse', 'patients:read', 'visit:read'],
}

const mockPatient: PatientOut = {
  id: 101,
  urn: 'KH-2026-0001',
  full_name: 'Aarav Kumar',
  guardian_name: 'Suresh Kumar',
  gender: 'M',
  dob: '1995-05-15',
  age_years: 30,
  mobile: '9876543210',
  address: 'Main Road, Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: null,
  allergies: 'None',
  notes: null,
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockDoctors: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr. Madan Mohan Dwivedi',
    name_hi: 'डॉ मदन मोहन द्विवेदी',
    qualification: 'Senior Physiotherapist',
    registration_number: 'PT-12345',
    default_fee_paise: 40000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
]

const mockRecordedPayment: PaymentOut = {
  id: 55,
  receipt_number: 'REC-2026-0001',
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  treatment_plan_id: null,
  treatment_plan_name: null,
  appointment_id: null,
  visit_id: null,
  amount_paise: 40000,
  payment_method: 'CASH',
  notes: 'OPD OPD CONSULTATION',
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  reversed_at: null,
  created_by_username: 'reception',
  created_at: '2026-11-07T10:00:00Z',
}

const mockDues: PendingDueOut[] = [
  {
    treatment_plan_id: 1,
    patient_id: 101,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Aarav Kumar',
    plan_name: 'Lumbar Spine Rehab Package',
    condition_diagnosis: 'L4-L5 Disc Herniation',
    agreed_price_paise: 600000,
    paid_paise: 200000,
    balance_paise: 400000,
    total_sessions: 12,
    completed_sessions: 4,
  },
]

// RF-23 fixtures: one visit whose doctor has completed the consultation, Rs 400 still due.
const visitBase = {
  id: 7,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  visit_date: '2026-11-14',
  status: 'OPEN' as const,
  opened_by_user_id: 2,
  opened_at: '2026-11-14T04:30:00Z',
  closed_by_user_id: null,
  closed_at: null,
  close_reason: null,
  cancelled_by_user_id: null,
  cancelled_at: null,
  cancel_reason: null,
  version_id: 3,
}

const readySummary: VisitSummary = {
  ...visitBase,
  doctors: ['Dr. Madan Mohan Dwivedi'],
  completed_consultations: 1,
  active_consultations: 0,
  outstanding_paise: 40000,
  token_numbers: [4],
  last_completed_at: '2026-11-14T05:30:00Z',
}

const openBill: VisitBillOut = {
  visit_id: 7,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  status: 'OPEN',
  visit_date: '2026-11-14',
  closed_at: null,
  close_reason: null,
  locked: false,
  sections: [
    {
      category: 'CONSULTATION',
      subtotal_paise: 40000,
      lines: [
        {
          id: 31,
          visit_id: 7,
          appointment_id: 31,
          category: 'CONSULTATION',
          source: 'SYSTEM',
          description: 'OPD Consultation - Dr. Madan Mohan Dwivedi',
          quantity: 1,
          rate_paise: 40000,
          amount_paise: 40000,
          original_amount_paise: 40000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 2,
          created_by_username: 'reception',
          created_at: '2026-11-14T09:00:00Z',
          history: [],
        },
      ],
    },
    { category: 'PROCEDURE', subtotal_paise: 0, lines: [] },
    { category: 'PACKAGE', subtotal_paise: 0, lines: [] },
    { category: 'MEDICINE', subtotal_paise: 0, lines: [] },
    { category: 'ADDITIONAL', subtotal_paise: 0, lines: [] },
  ],
  bill_total_paise: 40000,
  paid_paise: 0,
  due_paise: 40000,
  payments: [],
  voided_lines: [],
  previous_dues: [],
  previous_dues_total_paise: 0,
  packages: [],
}

const openDetail: VisitDetail = {
  ...visitBase,
  consultations: [
    {
      appointment_id: 31,
      doctor_id: 1,
      doctor_name_en: 'Dr. Madan Mohan Dwivedi',
      token_number: 4,
      appointment_status: 'DONE',
      consultation_status: 'COMPLETED',
      appointment_date: '2026-11-14',
      fee_paise: 40000,
      paid_paise: 0,
      balance_paise: 40000,
      collectable: true,
    },
  ],
  payments: [],
  total_paid_paise: 0,
  outstanding_paise: 40000,
}

type Reply = { status?: number; body: unknown }
type Route = (init?: RequestInit) => Reply

/** Routes by method and exact pathname; an unmapped call rejects so a missing mock is visible. */
function mockApi(routes: Record<string, Route>) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = new URL(url, 'http://localhost').pathname
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

function renderPage(fetchMock: ReturnType<typeof mockApi>, client: QueryClient, initialRoute = '/reception/billing') {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <ReceptionBillingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReceptionBillingPage Desk', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders counter checkout desk, searches patient, and records consultation payment with receipt', async () => {
    let capturedPayload: unknown = null

    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({
        body: [
          { id: 5, name: 'Follow-up visit', fee_paise: 20000, is_active: true, version_id: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        ],
      }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/patients': () => ({ body: [mockPatient] }),
      '/api/visits': () => ({ body: { total: 0, visits: [] } }),
      '/api/appointments': () => ({
        body: {
          total: 3,
          appointments: [
            { id: 11, status: 'DONE', consultation_status: 'COMPLETED' },
            { id: 12, status: 'COMPLETED', consultation_status: 'COMPLETED' },
            { id: 13, status: 'CANCELLED', consultation_status: 'CANCELLED' },
          ],
        },
      }),
      'POST /api/payments': (init) => {
        capturedPayload = JSON.parse(init?.body as string)
        return { status: 201, body: mockRecordedPayment }
      },
      '/api/billing/ledger': () => ({ body: [mockRecordedPayment] }),
      '/api/billing/receipts/today': () => ({ body: [mockRecordedPayment] }),
      '/api/billing/pending-dues': () => ({ body: mockDues }),
      '/api/billing/visit-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    // Check Header & Tabs
    expect(await screen.findByRole('heading', { name: /Billing & Checkout/i })).toBeInTheDocument()
    const financialTabs = screen.getByRole('navigation', { name: /Reception Desk Financial Tabs/i })
    expect(await within(financialTabs).findByRole('link', { name: /Billing & Checkout/i })).toBeInTheDocument()
    expect(within(financialTabs).getByRole('link', { name: /^Pending Dues$/i })).toBeInTheDocument()

    // Sidebar-duplicated shortcuts and top Add item button are absent inside <main>.
    const main = screen.getByRole('main')
    expect(within(main).queryByRole('link', { name: /Appointments/i })).not.toBeInTheDocument()
    expect(within(main).queryByRole('link', { name: /Check-in & Token/i })).not.toBeInTheDocument()
    expect(within(main).queryByRole('button', { name: /Add item/i })).not.toBeInTheDocument()

    // Compact empty state summarizes daily completed consultations, pending dues, and quick actions.
    const emptyState = await screen.findByTestId('checkout-empty-state')
    expect(screen.queryByTestId('checkout-split-workspace')).not.toBeInTheDocument()
    expect(
      within(emptyState).getByRole('heading', { name: /No visits awaiting checkout/i }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(within(emptyState).getByText('Completed consultations today').parentElement).toHaveTextContent('2')
      expect(within(emptyState).getByText('Pending dues').parentElement).toHaveTextContent('1')
      expect(within(emptyState).getByText('₹4,000.00 outstanding')).toBeInTheDocument()
    })
    expect(within(emptyState).getByRole('link', { name: /View Pending Dues/i })).toHaveAttribute(
      'href',
      '/reception/billing?tab=dues',
    )

    // Standalone non-visit billing opens via Direct payment (no visit).
    await user.click(within(emptyState).getByRole('button', { name: /Direct payment \(no visit\)/i }))
    expect(screen.getByRole('heading', { name: /Direct Payment \(No Visit\)/i })).toBeInTheDocument()

    // Search and select patient
    const searchInput = screen.getByPlaceholderText(/Search patient by Name, Mobile or Patient ID/i)
    await user.type(searchInput, 'Aarav')

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })

    const selectPatientBtn = screen.getByRole('button', { name: /Aarav Kumar KH-2026-0001 9876543210/i })
    await user.click(selectPatientBtn)

    // Form should now have patient selected
    await waitFor(() => {
      expect(screen.getByText('Change')).toBeInTheDocument()
    })

    // No fee is assumed: nothing to collect until the doctor (or an amount) is chosen.
    expect(screen.getByRole('button', { name: /Collect ₹0.00 & Issue Receipt/i })).toBeInTheDocument()
    expect(screen.getAllByText(/Choose the consulting doctor to fill their fee/i).length).toBeGreaterThan(0)

    // A fee schedule entry fills the amount the administrator set for it.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Follow-up visit - ₹200.00' })).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'fee:5')
    expect(screen.getByRole('button', { name: /Collect ₹200.00 & Issue Receipt/i })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'opd_consultation')

    // Choosing the doctor fills their own fee (₹400.00 in this fixture).
    await waitFor(() => {
      expect(screen.getByLabelText(/Consulting Doctor/i).querySelectorAll('option').length).toBeGreaterThan(1)
    })
    await user.selectOptions(screen.getByLabelText(/Consulting Doctor/i), String(mockDoctors[0].id))

    // Submit payment collection
    const collectBtn = screen.getByRole('button', { name: /Collect ₹400.00 & Issue Receipt/i })
    expect(collectBtn).toBeEnabled()
    await user.click(collectBtn)

    // Verify success banner and receipt number
    await waitFor(() => {
      expect(screen.getByText(/Payment Recorded & Receipt Issued!/i)).toBeInTheDocument()
    })
    expect(screen.getByText('REC-2026-0001')).toBeInTheDocument()

    expect(capturedPayload).toEqual({
      patient_id: 101,
      amount_paise: 40000,
      payment_method: 'CASH',
      notes: expect.stringContaining('OPD'),
    })

    // Switch to Pending Dues tab
    const duesTab = within(
      screen.getByRole('navigation', { name: /Reception Desk Financial Tabs/i }),
    ).getByRole('link', { name: /^Pending Dues$/i })
    await user.click(duesTab)

    await waitFor(() => {
      expect(screen.getByText('Lumbar Spine Rehab Package')).toBeInTheDocument()
    })
    expect(screen.getAllByText('₹4,000.00')[0]).toBeInTheDocument()
  })

  it('takes a visit payment for the completed consultation, then closes the visit with a reason', async () => {
    let closed = false
    let paymentBody: Record<string, unknown> | null = null
    let closeBody: Record<string, unknown> | null = null

    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: closed ? 0 : 1, visits: closed ? [] : [readySummary] } }),
      '/api/appointments': () => ({
        body: {
          total: 1,
          appointments: [{ id: 31, status: 'DONE', consultation_status: 'COMPLETED' }],
        },
      }),
      '/api/visits/7': () => ({ body: openDetail }),
      '/api/visits/7/bill': () => ({ body: openBill }),
      'POST /api/visits/7/close': (init) => {
        closeBody = JSON.parse(init?.body as string)
        closed = true
        return {
          body: {
            ...openDetail,
            status: 'CLOSED',
            closed_at: '2026-11-14T06:00:00Z',
            close_reason: closeBody?.reason ?? null,
          },
        }
      },
      'POST /api/payments': (init) => {
        paymentBody = JSON.parse(init?.body as string)
        return { status: 201, body: mockRecordedPayment }
      },
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    // The visit waiting for checkout is listed; picking it shows its charges.
    const visitButton = await screen.findByRole('button', { name: /Aarav Kumar/i })
    expect(screen.getByText(/Token #4/i)).toBeInTheDocument()
    expect(screen.getByText(/Completed 14 Nov 2026/i)).toBeInTheDocument()
    await user.click(visitButton)
    expect(await screen.findByRole('heading', { name: /Take payment/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Amount/i)).toHaveValue(400)

    // Money goes against the visit, for its full outstanding balance.
    await user.click(screen.getByRole('button', { name: /Collect ₹400.00 & Issue Receipt/i }))
    await waitFor(() => {
      expect(screen.getByText('REC-2026-0001')).toBeInTheDocument()
    })
    expect(paymentBody).toEqual(
      expect.objectContaining({
        patient_id: 101,
        visit_id: 7,
        amount_paise: 40000,
        payment_method: 'CASH',
        notes: 'Visit 2026-11-14',
      }),
    )
    expect(paymentBody).not.toHaveProperty('appointment_id')

    // Balance still due, so closing needs a reason: the button stays disabled until one is typed.
    const closeButton = screen.getByRole('button', { name: /^Patient Out$/i })
    expect(closeButton).toBeDisabled()
    await user.type(screen.getByLabelText(/Reason for closing/i), 'Patient will pay on the next visit')
    expect(closeButton).toBeEnabled()
    await user.click(closeButton)

    await waitFor(() => {
      expect(screen.getByText(/visit is closed/i)).toBeInTheDocument()
    })
    expect(closeBody).toEqual({ version_id: 3, reason: 'Patient will pay on the next visit' })
  })

  it('caps visit payment amount to visit outstanding and validates input', async () => {
    let paymentCallCount = 0

    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: 1, visits: [readySummary] } }),
      '/api/visits/7': () => ({ body: openDetail }),
      '/api/visits/7/bill': () => ({ body: openBill }),
      'POST /api/payments': () => {
        paymentCallCount++
        return { status: 201, body: mockRecordedPayment }
      },
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    await user.click(await screen.findByRole('button', { name: /Aarav Kumar/i }))
    const amountInput = screen.getByLabelText(/Amount/i)
    expect(amountInput).toHaveValue(400)

    // Type 600 which exceeds outstanding 400
    await user.clear(amountInput)
    await user.type(amountInput, '600')

    const collectBtn = screen.getByRole('button', { name: /Collect ₹600.00 & Issue Receipt/i })
    await user.click(collectBtn)

    expect(await screen.findByRole('alert')).toHaveTextContent('Only ₹400.00 is due on this visit.')
    expect(paymentCallCount).toBe(0)
  })

  it('displays server overpayment_rejected error in alert, keeps button enabled, and opens no receipt', async () => {
    let paymentCallCount = 0

    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: 1, visits: [readySummary] } }),
      '/api/visits/7': () => ({ body: openDetail }),
      '/api/visits/7/bill': () => ({ body: openBill }),
      'POST /api/payments': () => {
        paymentCallCount++
        return {
          status: 422,
          body: {
            code: 'overpayment_rejected',
            message: 'Payment of ₹400.00 exceeds remaining visit outstanding balance.',
          },
        }
      },
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    await user.click(await screen.findByRole('button', { name: /Aarav Kumar/i }))
    const collectBtn = screen.getByRole('button', { name: /Collect ₹400.00 & Issue Receipt/i })
    await user.click(collectBtn)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Payment of ₹400.00 exceeds remaining visit outstanding balance.')
    expect(collectBtn).toBeEnabled()
    expect(screen.queryByText('REC-2026-0001')).not.toBeInTheDocument()
    expect(paymentCallCount).toBe(1)
  })

  it('preserves form values and shows persistent error without auto-retry on network drop', async () => {
    let paymentCallCount = 0

    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: 1, visits: [readySummary] } }),
      '/api/visits/7': () => ({ body: openDetail }),
      '/api/visits/7/bill': () => ({ body: openBill }),
      'POST /api/payments': () => {
        paymentCallCount++
        throw new Error('Failed to fetch')
      },
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    await user.click(await screen.findByRole('button', { name: /Aarav Kumar/i }))

    const amountInput = screen.getByLabelText(/Amount/i)
    await user.clear(amountInput)
    await user.type(amountInput, '350.00')

    await user.click(screen.getByRole('button', { name: 'UPI' }))

    const remarksInput = screen.getByLabelText(/Remarks/i)
    await user.type(remarksInput, 'UPI-TXN-1234')

    const collectBtn = screen.getByRole('button', { name: /Collect ₹350.00 & Issue Receipt/i })
    await user.click(collectBtn)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Failed to fetch')

    // Preserved values
    expect(amountInput).toHaveValue(350)
    expect(screen.getByRole('button', { name: 'UPI' })).toHaveAttribute('aria-pressed', 'true')
    expect(remarksInput).toHaveValue('UPI-TXN-1234')

    // Button re-enabled
    expect(collectBtn).toBeEnabled()
    expect(screen.queryByText('REC-2026-0001')).not.toBeInTheDocument()
    // Exactly one call made, no auto retry
    expect(paymentCallCount).toBe(1)
  })

  it('renders closed visit dues and collects balance with visit_id', async () => {
    let paymentBody: Record<string, unknown> | null = null

    const mockVisitDues: VisitDueOut[] = [
      {
        visit_id: 12,
        patient_id: 101,
        patient_urn: 'KH-2026-0001',
        patient_name: 'Aarav Kumar',
        doctor_names: ['Dr. Madan Mohan Dwivedi', 'Dr. Sharma'],
        visit_date: '2026-11-10',
        bill_total_paise: 50000,
        paid_paise: 30000,
        balance_paise: 20000,
        close_reason: 'Patient will pay later',
      },
    ]

    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: 0, visits: [] } }),
      '/api/appointments': () => ({ body: { total: 0, appointments: [] } }),
      '/api/billing/visit-dues': () => ({ body: mockVisitDues }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
      'POST /api/payments': (init) => {
        paymentBody = JSON.parse(init?.body as string)
        return {
          status: 201,
          body: {
            ...mockRecordedPayment,
            id: 99,
            receipt_number: 'REC-2026-0099',
            amount_paise: 20000,
            visit_id: 12,
          },
        }
      },
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    // Switch to Pending Dues tab to view visit balances
    const financialTabs = await screen.findByRole('navigation', {
      name: /Reception Desk Financial Tabs/i,
    })
    await user.click(within(financialTabs).getByRole('link', { name: /^Pending Dues$/i }))

    // Visit balances is displayed on the dues tab
    expect(await screen.findByRole('heading', { name: /Visit balances/i })).toBeInTheDocument()
    expect(screen.getByText('Dr. Madan Mohan Dwivedi, Dr. Sharma')).toBeInTheDocument()
    expect(screen.getByText('Patient will pay later')).toBeInTheDocument()
    expect(screen.getByText('2026-11-10')).toBeInTheDocument()

    // Click collect
    const collectRowBtn = screen.getByRole('button', { name: /Collect/i })
    await user.click(collectRowBtn)

    // Form opens with amount prefilled to balance
    const dueAmountInput = screen.getByLabelText(/Amount/i)
    expect(dueAmountInput).toHaveValue(200)

    // Cap check: typing 300 shows error and blocks submission
    await user.clear(dueAmountInput)
    await user.type(dueAmountInput, '300')
    const dueSubmitBtn = screen.getByRole('button', { name: /Collect ₹300.00 & Issue Receipt/i })
    await user.click(dueSubmitBtn)
    expect(await screen.findByRole('alert')).toHaveTextContent('Only ₹200.00 is owed on this visit.')
    expect(paymentBody).toBeNull()

    // Set back to 200 and submit
    await user.clear(dueAmountInput)
    await user.type(dueAmountInput, '200')
    await user.click(screen.getByRole('button', { name: /Collect ₹200.00 & Issue Receipt/i }))

    await waitFor(() => {
      expect(screen.getByText(/Receipt REC-2026-0099 issued for Aarav Kumar/i)).toBeInTheDocument()
    })

    expect(paymentBody).toEqual({
      patient_id: 101,
      visit_id: 12,
      amount_paise: 20000,
      payment_method: 'CASH',
      notes: 'Balance from visit 2026-11-10',
    })
    expect(paymentBody).not.toHaveProperty('appointment_id')
  })

  it("shows reception only today's receipts from the day endpoint, never the full ledger", async () => {
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: 0, visits: [] } }),
      '/api/billing/receipts/today': () => ({ body: [mockRecordedPayment] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
      '/api/billing/visit-dues': () => ({ body: [] }),
    })

    renderPage(mockFetch, queryClient, '/reception/billing?tab=ledger')

    expect(await screen.findByText('REC-2026-0001')).toBeInTheDocument()

    const requested = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(requested.some((url) => url.includes('/api/billing/receipts/today'))).toBe(true)
    expect(requested.some((url) => url.includes('/api/billing/ledger'))).toBe(false)
  })

  it('shows admin the oversight view only: no checkout tab, the full ledger, and no collect actions', async () => {
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockAdmin }),
      '/api/billing/ledger': () => ({ body: [mockRecordedPayment] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: mockDues }),
      '/api/billing/visit-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    expect(await screen.findByRole('link', { name: /Receipts Ledger/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Checkout$/i })).not.toBeInTheDocument()
    expect(await screen.findByText('REC-2026-0001')).toBeInTheDocument()

    const requested = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(requested.some((url) => url.includes('/api/billing/receipts/today'))).toBe(false)
    expect(requested.some((url) => url.includes('/api/billing/ledger'))).toBe(true)
    expect(requested.some((url) => url.includes('/api/visits'))).toBe(false)

    await user.click(screen.getByRole('link', { name: /Pending Dues/i }))
    await waitFor(() => {
      expect(screen.getByText('Lumbar Spine Rehab Package')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Collect Payment/i })).not.toBeInTheDocument()
  })

  it('starts in unselected queue, expands split workspace on visit click, and returns via Back to queue', async () => {
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: 1, visits: [readySummary] } }),
      '/api/visits/7': () => ({ body: openDetail }),
      '/api/visits/7/bill': () => ({ body: openBill }),
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    const unselectedQueue = await screen.findByTestId('checkout-queue-unselected')
    expect(unselectedQueue).toBeInTheDocument()
    expect(screen.queryByTestId('checkout-split-workspace')).not.toBeInTheDocument()

    await user.click(within(unselectedQueue).getByRole('button', { name: /Aarav Kumar/i }))

    const splitWorkspace = await screen.findByTestId('checkout-split-workspace')
    expect(splitWorkspace).toBeInTheDocument()
    expect(screen.queryByTestId('checkout-queue-unselected')).not.toBeInTheDocument()
    expect(await within(splitWorkspace).findByTestId('checkout-summary-strip')).toBeInTheDocument()
    expect(within(splitWorkspace).getByRole('heading', { name: /^Visit Bill$/i })).toBeInTheDocument()
    expect(within(splitWorkspace).getByRole('heading', { name: /^Take payment$/i })).toBeInTheDocument()
    expect(
      within(splitWorkspace).getByRole('heading', { name: /^Close Visit \/ Patient Out$/i }),
    ).toBeInTheDocument()

    await user.click(within(splitWorkspace).getByRole('button', { name: /Back to queue/i }))

    expect(await screen.findByTestId('checkout-queue-unselected')).toBeInTheDocument()
    expect(screen.queryByTestId('checkout-split-workspace')).not.toBeInTheDocument()
  })

  it('shows Add medicine and Add particular only after selecting a visit', async () => {
    const meWithBillWrite: Me = {
      ...mockMe,
      permissions: [...mockMe.permissions, 'bill:write'],
    }

    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: meWithBillWrite }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({ body: { total: 1, visits: [readySummary] } }),
      '/api/visits/7': () => ({ body: openDetail }),
      '/api/visits/7/bill': () => ({ body: openBill }),
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    const unselectedQueue = await screen.findByTestId('checkout-queue-unselected')
    expect(screen.queryByRole('button', { name: /Add medicine/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add particular/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add item/i })).not.toBeInTheDocument()

    await user.click(within(unselectedQueue).getByRole('button', { name: /Aarav Kumar/i }))

    expect(await screen.findByRole('button', { name: /^Add medicine$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Add particular$/i })).toBeInTheDocument()
  })

  it('shows alert error state instead of empty state on queue fetch failure while keeping Direct payment clickable', async () => {
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/visits': () => ({
        status: 500,
        body: { code: 'internal_error', message: 'Checkout queue unavailable' },
      }),
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Checkout queue unavailable')
    expect(screen.queryByText(/No visits awaiting checkout/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('checkout-empty-state')).not.toBeInTheDocument()

    const directPayBtn = screen.getByRole('button', { name: /Direct payment \(no visit\)/i })
    expect(directPayBtn).toBeEnabled()
    await user.click(directPayBtn)
    expect(screen.getByRole('heading', { name: /Direct Payment \(No Visit\)/i })).toBeInTheDocument()
  })

  it('resolves Waiting Room ?appointment_id=9&patient_id=77 deep link, clears URL on Back to queue, and never pre-selects patient in Direct Payment', async () => {
    let resolveAppt!: (val: Reply) => void
    const apptPromise = new Promise<Reply>((res) => {
      resolveAppt = res
    })

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = new URL(url, 'http://localhost').pathname
      if (method === 'GET' && path === '/api/appointments/9') {
        return apptPromise.then((reply) => ({
          ok: (reply.status ?? 200) < 400,
          status: reply.status ?? 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(reply.body)),
        }))
      }
      const routes: Record<string, Route> = {
        '/api/auth/me': () => ({ body: mockMe }),
        '/api/fees': () => ({ body: [] }),
        '/api/doctors': () => ({ body: mockDoctors }),
        '/api/patients/77': () => ({ body: { ...mockPatient, id: 77, full_name: 'Deep Link Patient', urn: 'KH-2026-0077' } }),
        '/api/visits': () => ({ body: { total: 1, visits: [readySummary] } }),
        '/api/visits/7': () => ({ body: openDetail }),
        '/api/visits/7/bill': () => ({ body: openBill }),
        '/api/billing/visit-dues': () => ({ body: [] }),
        '/api/billing/receipts/today': () => ({ body: [] }),
        '/api/billing/pending-dues': () => ({ body: [] }),
      }
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

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient, '/reception/billing?appointment_id=9&patient_id=77')

    // While appointment is pending, shows loading state
    expect(await screen.findByText(/Loading visits\.\.\./i)).toBeInTheDocument()

    // Resolve linked appointment to visit_id 7
    resolveAppt({
      body: {
        id: 9,
        visit_id: 7,
        patient_id: 77,
        doctor_id: 1,
        status: 'DONE',
      },
    })

    // Transitions directly into split workspace for visit 7
    const splitWorkspace = await screen.findByTestId('checkout-split-workspace')
    expect(splitWorkspace).toBeInTheDocument()

    // Back to queue clears URL params and returns to unselected queue
    await user.click(within(splitWorkspace).getByRole('button', { name: /Back to queue/i }))
    const unselectedQueue = await screen.findByTestId('checkout-queue-unselected')
    expect(unselectedQueue).toBeInTheDocument()

    // Switching to Direct Payment must NOT pre-select patient_id=77
    await user.click(within(unselectedQueue).getByRole('button', { name: /Direct payment \(no visit\)/i }))
    expect(screen.getByRole('heading', { name: /Direct Payment \(No Visit\)/i })).toBeInTheDocument()
    expect(screen.queryByText('Deep Link Patient')).not.toBeInTheDocument()
    expect(screen.getByText(/Search above to select a patient/i)).toBeInTheDocument()

    // Going back to Visit Checkout must NOT reopen visit 7
    await user.click(screen.getByRole('button', { name: /Back to Visit Checkout/i }))
    expect(await screen.findByTestId('checkout-queue-unselected')).toBeInTheDocument()
    expect(screen.queryByTestId('checkout-split-workspace')).not.toBeInTheDocument()
  })

  it('pre-selects standalone ?patient_id=77 once and does not snap back after Change or Checkout Next Patient', async () => {
    const patient77: PatientOut = {
      ...mockPatient,
      id: 77,
      urn: 'KH-2026-0077',
      full_name: 'Meera Devi',
    }
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/fees': () => ({ body: [] }),
      '/api/doctors': () => ({ body: mockDoctors }),
      '/api/patients/77': () => ({ body: patient77 }),
      '/api/visits': () => ({ body: { total: 0, visits: [] } }),
      '/api/appointments': () => ({ body: { total: 0, appointments: [] } }),
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/receipts/today': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
      'POST /api/payments': () => ({
        status: 201,
        body: { ...mockRecordedPayment, patient_id: 77, patient_name: 'Meera Devi', patient_urn: 'KH-2026-0077' },
      }),
    })

    const user = userEvent.setup()
    const { unmount } = renderPage(mockFetch, queryClient, '/reception/billing?patient_id=77')

    const emptyState = await screen.findByTestId('checkout-empty-state')
    await user.click(within(emptyState).getByRole('button', { name: /Direct payment \(no visit\)/i }))

    // Patient 77 is pre-selected
    expect(await screen.findByText('Meera Devi')).toBeInTheDocument()

    // Clicking Change clears patient and does NOT snap back
    await user.click(screen.getByRole('button', { name: /^Change$/i }))
    await waitFor(() => {
      expect(screen.queryByText('Meera Devi')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/Search above to select a patient/i)).toBeInTheDocument()
    unmount()

    // Now verify Checkout Next Patient also does not snap back
    const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
    renderPage(mockFetch, qc2, '/reception/billing?patient_id=77')
    const empty2 = await screen.findByTestId('checkout-empty-state')
    await user.click(within(empty2).getByRole('button', { name: /Direct payment \(no visit\)/i }))
    expect(await screen.findByText('Meera Devi')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByLabelText(/Consulting Doctor/i).querySelectorAll('option').length).toBeGreaterThan(1)
    })
    await user.selectOptions(screen.getByLabelText(/Consulting Doctor/i), String(mockDoctors[0].id))
    await user.click(screen.getByRole('button', { name: /Collect ₹400.00 & Issue Receipt/i }))

    expect(await screen.findByText(/Payment Recorded & Receipt Issued!/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Checkout Next Patient/i }))
    await waitFor(() => {
      expect(screen.queryByText('Meera Devi')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/Search above to select a patient/i)).toBeInTheDocument()
  })

  it('hides the Direct Payment form after recording and guards against double-submit while in flight', async () => {
    let postCount = 0
    let resolvePayment!: (val: Reply) => void
    const paymentPromise = new Promise<Reply>((res) => {
      resolvePayment = res
    })

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = new URL(url, 'http://localhost').pathname
      if (method === 'POST' && path === '/api/payments') {
        postCount++
        return paymentPromise.then((reply) => ({
          ok: true,
          status: reply.status ?? 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(reply.body)),
        }))
      }
      const routes: Record<string, Route> = {
        '/api/auth/me': () => ({ body: mockMe }),
        '/api/fees': () => ({ body: [] }),
        '/api/doctors': () => ({ body: mockDoctors }),
        '/api/patients/101': () => ({ body: mockPatient }),
        '/api/visits': () => ({ body: { total: 0, visits: [] } }),
        '/api/appointments': () => ({ body: { total: 0, appointments: [] } }),
        '/api/billing/visit-dues': () => ({ body: [] }),
        '/api/billing/receipts/today': () => ({ body: [] }),
        '/api/billing/pending-dues': () => ({ body: [] }),
      }
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

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient, '/reception/billing?patient_id=101')

    const emptyState = await screen.findByTestId('checkout-empty-state')
    await user.click(within(emptyState).getByRole('button', { name: /Direct payment \(no visit\)/i }))
    expect(await screen.findByText('Aarav Kumar')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByLabelText(/Consulting Doctor/i).querySelectorAll('option').length).toBeGreaterThan(1)
    })
    await user.selectOptions(screen.getByLabelText(/Consulting Doctor/i), String(mockDoctors[0].id))

    const collectBtn = screen.getByRole('button', { name: /Collect ₹400.00 & Issue Receipt/i })
    const form = collectBtn.closest('form')!
    // Trigger rapid double-submit synchronously before React re-renders
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => {
      expect(postCount).toBe(1)
    })

    resolvePayment({ status: 201, body: mockRecordedPayment })

    // Success card replaces the payment form so a stray click cannot double-charge
    expect(await screen.findByText(/Payment Recorded & Receipt Issued!/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Collect ₹400.00 & Issue Receipt/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Payable Amount/i)).not.toBeInTheDocument()
    expect(postCount).toBe(1)
  })

  it('hides Direct payment (no visit) when reception lacks payment:create (canCollect=false)', async () => {
    const meNoCollect: Me = {
      ...mockMe,
      permissions: ['payment:read', 'patients:read', 'appointment:read', 'visit:read', 'visit:write'],
    }
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: meNoCollect }),
      '/api/visits': () => ({ body: { total: 0, visits: [] } }),
      '/api/appointments': () => ({ body: { total: 0, appointments: [] } }),
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    renderPage(mockFetch, queryClient)

    const emptyState = await screen.findByTestId('checkout-empty-state')
    expect(within(emptyState).queryByRole('button', { name: /Direct payment \(no visit\)/i })).not.toBeInTheDocument()
  })

  it('renders error alerts instead of ₹0.00 on Pending Dues and Today Receipts tabs when API calls fail', async () => {
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/visits': () => ({ body: { total: 0, visits: [] } }),
      '/api/billing/visit-dues': () => ({
        status: 500,
        body: { code: 'internal_error', message: 'Visit dues database unavailable' },
      }),
      '/api/billing/pending-dues': () => ({
        status: 500,
        body: { code: 'internal_error', message: 'Package dues service unavailable' },
      }),
      '/api/billing/receipts/today': () => ({
        status: 500,
        body: { code: 'internal_error', message: 'Receipts query failed' },
      }),
    })

    renderPage(mockFetch, queryClient, '/reception/billing?tab=dues')

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.some((a) => a.textContent?.includes('Visit dues database unavailable'))).toBe(true)
      expect(alerts.some((a) => a.textContent?.includes('Package dues service unavailable'))).toBe(true)
    })
    expect(screen.queryByText('No closed visit has a balance.')).not.toBeInTheDocument()
    expect(screen.queryByText('No active packages with pending dues found.')).not.toBeInTheDocument()
    expect(screen.queryByText('₹0.00')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Retry$/i })).toBeInTheDocument()

    // Check Today's Receipts error alert (no ₹0.00)
    cleanup()
    const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
    renderPage(mockFetch, qc2, '/reception/billing?tab=ledger')

    const ledgerAlert = await screen.findByRole('alert')
    expect(ledgerAlert).toHaveTextContent('Receipts query failed')
    expect(screen.queryByText(/No receipts issued today/i)).not.toBeInTheDocument()
    expect(screen.queryByText('₹0.00')).not.toBeInTheDocument()

    // Check Admin Ledger error alert
    cleanup()
    const adminMockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockAdmin }),
      '/api/billing/ledger': () => ({
        status: 500,
        body: { code: 'internal_error', message: 'Ledger service unavailable' },
      }),
    })
    const qc3 = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
    renderPage(adminMockFetch, qc3, '/reception/billing?tab=ledger')

    const adminAlert = await screen.findByRole('alert')
    expect(adminAlert).toHaveTextContent('Ledger service unavailable')
    expect(screen.queryByText(/No payment receipts found/i)).not.toBeInTheDocument()
  })

  it('shows initialVisitError alert when ?appointment_id= has no visit_id', async () => {
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockMe }),
      '/api/appointments/15': () => ({
        body: { id: 15, visit_id: null, patient_id: 101, doctor_id: 1, status: 'BOOKED' },
      }),
      '/api/visits': () => ({ body: { total: 0, visits: [] } }),
      '/api/appointments': () => ({ body: { total: 0, appointments: [] } }),
      '/api/billing/visit-dues': () => ({ body: [] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
    })

    renderPage(mockFetch, queryClient, '/reception/billing?appointment_id=15')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/does not have an open visit ready for checkout/i)
  })

  it('hides Daily Collection Report tab in ADMIN oversight view', async () => {
    const mockFetch = mockApi({
      '/api/auth/me': () => ({ body: mockAdmin }),
      '/api/billing/ledger': () => ({ body: [mockRecordedPayment] }),
      '/api/billing/pending-dues': () => ({ body: [] }),
      '/api/billing/visit-dues': () => ({ body: [] }),
    })

    renderPage(mockFetch, queryClient)

    const nav = await screen.findByRole('navigation', { name: /Reception Desk Financial Tabs/i })
    expect(within(nav).getByRole('link', { name: /Receipts Ledger/i })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Daily Collection Report/i })).not.toBeInTheDocument()
  })
})
