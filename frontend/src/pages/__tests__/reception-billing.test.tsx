import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  VisitSummary,
} from '../../api/types'

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

function renderPage(fetchMock: ReturnType<typeof mockApi>, client: QueryClient) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reception/billing']}>
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
    expect(await screen.findByRole('heading', { name: /Billing & Payments/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Checkout/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Today's Receipts/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pending Dues/i })).toBeInTheDocument()

    // Checkout opens on visits; the patient-only desk is the "Other payment" option.
    await user.click(screen.getByRole('button', { name: /Other payment \(no visit\)/i }))

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
    const duesTab = screen.getByRole('button', { name: /Pending Dues/i })
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
      '/api/visits/7': () => ({ body: openDetail }),
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
    await user.click(await screen.findByRole('button', { name: /Aarav Kumar/i }))
    expect(await screen.findByRole('heading', { name: /Take payment/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Amount/i)).toHaveValue(400)

    // Money goes against the consultation, for its full balance.
    await user.click(screen.getByRole('button', { name: /Collect ₹400.00 & Issue Receipt/i }))
    await waitFor(() => {
      expect(screen.getByText('REC-2026-0001')).toBeInTheDocument()
    })
    expect(paymentBody).toEqual(
      expect.objectContaining({
        patient_id: 101,
        appointment_id: 31,
        amount_paise: 40000,
        payment_method: 'CASH',
      }),
    )

    // Balance still due, so closing needs a reason: the button stays disabled until one is typed.
    const closeButton = screen.getByRole('button', { name: /Close Visit \/ Patient Out/i })
    expect(closeButton).toBeDisabled()
    await user.type(screen.getByLabelText(/Reason for closing/i), 'Patient will pay on the next visit')
    expect(closeButton).toBeEnabled()
    await user.click(closeButton)

    await waitFor(() => {
      expect(screen.getByText(/visit is closed/i)).toBeInTheDocument()
    })
    expect(closeBody).toEqual({ version_id: 3, reason: 'Patient will pay on the next visit' })
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

    const user = userEvent.setup()
    renderPage(mockFetch, queryClient)

    await user.click(await screen.findByRole('button', { name: /Today's Receipts/i }))
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

    expect(await screen.findByRole('button', { name: /Receipts Ledger/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Checkout$/i })).not.toBeInTheDocument()
    expect(await screen.findByText('REC-2026-0001')).toBeInTheDocument()

    const requested = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(requested.some((url) => url.includes('/api/billing/receipts/today'))).toBe(false)
    expect(requested.some((url) => url.includes('/api/billing/ledger'))).toBe(true)
    expect(requested.some((url) => url.includes('/api/visits'))).toBe(false)

    await user.click(screen.getByRole('button', { name: /Pending Dues/i }))
    await waitFor(() => {
      expect(screen.getByText('Lumbar Spine Rehab Package')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Collect Payment/i })).not.toBeInTheDocument()
  })
})
