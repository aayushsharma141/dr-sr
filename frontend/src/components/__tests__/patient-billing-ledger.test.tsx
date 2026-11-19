import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VisitBillOut } from '../../api/bill'
import type {
  Me,
  PatientLedgerResponse,
  PatientOut,
  PatientSummaryOut,
  RefundOut,
} from '../../api/types'
import { PatientDetail } from '../../pages/PatientDetail'
import { PatientBillingLedgerTab } from '../patient/PatientBillingLedgerTab'

const adminMe: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Hospital Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: [
    'patient:read',
    'payment:read',
    'payment:reverse',
    'payment:refund',
    'bill:read',
    'audit:read',
    'timeline:read',
  ],
  must_change_password: false,
  csrf_token: 'csrf-admin',
  version_id: 1,
}

const receptionMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Front Desk Staff',
  role: 'RECEPTION',
  doctor_id: null,
  permissions: [
    'patient:read',
    'payment:read',
    'payment:create',
    'bill:read',
    'timeline:read',
  ],
  must_change_password: false,
  csrf_token: 'csrf-rec',
  version_id: 1,
}

const doctorMe: Me = {
  id: 3,
  username: 'dr_dwivedi',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  permissions: [
    'patient:read',
    'encounter:read',
    'prescription:read',
    'allergy:read',
    'timeline:read',
  ],
  must_change_password: false,
  csrf_token: 'csrf-doc',
  version_id: 1,
}

const samplePatient: PatientOut = {
  id: 101,
  urn: 'KH-2026-0101',
  full_name: 'Aarav Kumar',
  guardian_name: 'Suresh Kumar',
  gender: 'M',
  dob: '1996-05-14',
  age_years: 30,
  computed_age_years: 30,
  mobile: '9876543210',
  address: 'Station Road, Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: null,
  allergies: 'None',
  notes: null,
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-10T09:00:00Z',
  updated_at: '2026-01-10T09:00:00Z',
}

const doctorSummary: PatientSummaryOut = {
  patient_id: 101,
  urn: 'KH-2026-0101',
  total_visits: 1,
  active_treatment_plans: 0,
  latest_visit: null,
  allergy_alert: null,
  active_allergies: [],
  prescriptions_count: 0,
  active_conditions_count: 0,
  latest_encounter: null,
  total_billed_paise: null,
  total_paid_paise: null,
  total_refunded_paise: null,
  outstanding_paise: null,
}

function buildSampleLedger(): PatientLedgerResponse {
  return {
    patient_id: 101,
    patient_urn: 'KH-2026-0101',
    total_billed_paise: 150000,
    total_paid_paise: 120000,
    total_refunded_paise: 20000,
    outstanding_paise: 50000,
    ledger_balance_paise: 50000,
    entries: [
      {
        id: 103,
        patient_id: 101,
        visit_id: 501,
        entry_type: 'REFUND',
        direction: 'DEBIT',
        amount_paise: 20000,
        signed_amount_paise: 20000,
        running_balance_paise: 50000,
        reference_type: 'REFUND',
        reference_id: 901,
        description: 'Refund RFN-2627-000001 against RCP-2026-0001',
        actor_user_id: 1,
        actor_username: 'admin',
        occurred_at: '2026-11-12T10:30:00Z',
        created_at: '2026-11-12T10:30:00Z',
      },
      {
        id: 102,
        patient_id: 101,
        visit_id: 501,
        entry_type: 'PAYMENT',
        direction: 'CREDIT',
        amount_paise: 100000,
        signed_amount_paise: -100000,
        running_balance_paise: 30000,
        reference_type: 'PAYMENT',
        reference_id: 301,
        description: 'Payment received (RCP-2026-0001)',
        actor_user_id: 2,
        actor_username: 'reception',
        occurred_at: '2026-11-11T09:15:00Z',
        created_at: '2026-11-11T09:15:00Z',
      },
      {
        id: 101,
        patient_id: 101,
        visit_id: 501,
        entry_type: 'CHARGE',
        direction: 'DEBIT',
        amount_paise: 150000,
        signed_amount_paise: 150000,
        running_balance_paise: 150000,
        reference_type: 'BILL_ITEM',
        reference_id: 701,
        description: 'Consultation fee — Dr. Madan Mohan Dwivedi',
        actor_user_id: 2,
        actor_username: 'reception',
        occurred_at: '2026-11-11T09:00:00Z',
        created_at: '2026-11-11T09:00:00Z',
      },
    ],
    total_entries: 3,
    limit: 50,
    offset: 0,
    payments: [
      {
        id: 301,
        receipt_number: 'RCP-2026-0001',
        patient_id: 101,
        patient_urn: 'KH-2026-0101',
        patient_name: 'Aarav Kumar',
        patient_mobile: '9876543210',
        patient_address: 'Station Road, Ara',
        treatment_plan_id: null,
        treatment_plan_name: null,
        appointment_id: 401,
        visit_id: 501,
        amount_paise: 100000,
        payment_method: 'UPI',
        notes: null,
        is_reversed: false,
        reversal_reason: null,
        reversed_by_username: null,
        reversed_at: null,
        created_by_username: 'reception',
        created_at: '2026-11-11T09:15:00Z',
        refunded_paise: 20000,
        remaining_refundable_paise: 80000,
      },
      {
        id: 302,
        receipt_number: 'RCP-2026-0002',
        patient_id: 101,
        patient_urn: 'KH-2026-0101',
        patient_name: 'Aarav Kumar',
        patient_mobile: '9876543210',
        patient_address: 'Station Road, Ara',
        treatment_plan_id: null,
        treatment_plan_name: null,
        appointment_id: 401,
        visit_id: 501,
        amount_paise: 20000,
        payment_method: 'CASH',
        notes: null,
        is_reversed: false,
        reversal_reason: null,
        reversed_by_username: null,
        reversed_at: null,
        created_by_username: 'reception',
        created_at: '2026-11-11T10:00:00Z',
        refunded_paise: 0,
        remaining_refundable_paise: 20000,
      },
      {
        id: 303,
        receipt_number: 'RCP-2026-0003',
        patient_id: 101,
        patient_urn: 'KH-2026-0101',
        patient_name: 'Aarav Kumar',
        patient_mobile: '9876543210',
        patient_address: 'Station Road, Ara',
        treatment_plan_id: null,
        treatment_plan_name: null,
        appointment_id: 401,
        visit_id: 501,
        amount_paise: 50000,
        payment_method: 'CARD',
        notes: null,
        is_reversed: true,
        reversal_reason: 'Duplicate card swipe',
        reversed_by_username: 'admin',
        reversed_at: '2026-11-11T11:00:00Z',
        created_by_username: 'reception',
        created_at: '2026-11-11T10:30:00Z',
        refunded_paise: 0,
        remaining_refundable_paise: 0,
      },
    ],
    refunds: [
      {
        id: 901,
        refund_number: 'RFN-2627-000001',
        payment_id: 301,
        payment_receipt_number: 'RCP-2026-0001',
        patient_id: 101,
        visit_id: 501,
        amount_paise: 20000,
        refund_method: 'UPI',
        reason: 'Overbilled physiotherapy session',
        refunded_by_user_id: 1,
        refunded_by_username: 'admin',
        created_at: '2026-11-12T10:30:00Z',
      },
    ],
    visits: [
      {
        visit_id: 501,
        visit_code: 'VIS-2026-0501',
        visit_date: '2026-11-11',
        status: 'OPEN',
        bill_total_paise: 150000,
        paid_paise: 120000,
        refunded_paise: 20000,
        due_paise: 50000,
      },
    ],
  }
}

const sampleVisitBill: VisitBillOut = {
  visit_id: 501,
  patient_id: 101,
  patient_urn: 'KH-2026-0101',
  patient_name: 'Aarav Kumar',
  status: 'OPEN',
  visit_date: '2026-11-11',
  closed_at: null,
  close_reason: null,
  locked: false,
  sections: [
    {
      category: 'CONSULTATION',
      subtotal_paise: 50000,
      lines: [
        {
          id: 701,
          visit_id: 501,
          appointment_id: 401,
          category: 'CONSULTATION',
          source: 'SYSTEM',
          description: 'Orthopaedics Consultation — Dr. Dwivedi',
          unit: null,
          quantity: 1,
          rate_paise: 50000,
          amount_paise: 50000,
          original_amount_paise: 50000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 2,
          created_by_username: 'reception',
          created_at: '2026-11-11T09:00:00Z',
          history: [],
        },
      ],
    },
    {
      category: 'PROCEDURE',
      subtotal_paise: 100000,
      lines: [
        {
          id: 702,
          visit_id: 501,
          appointment_id: 401,
          category: 'PROCEDURE',
          source: 'DOCTOR',
          description: 'Lumbar Traction & IFT Therapy',
          unit: 'session',
          quantity: 1,
          rate_paise: 100000,
          amount_paise: 100000,
          original_amount_paise: 100000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 3,
          created_by_username: 'dr_dwivedi',
          created_at: '2026-11-11T09:10:00Z',
          history: [],
        },
      ],
    },
  ],
  bill_total_paise: 150000,
  paid_paise: 100000,
  due_paise: 50000,
  payments: [],
  voided_lines: [],
  previous_dues: [],
  previous_dues_total_paise: 0,
  packages: [],
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 422 ? 'Unprocessable Entity' : 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function renderLedgerTab(
  me: Me,
  options?: {
    ledger?: PatientLedgerResponse
    refundHandler?: (paymentId: number, body: Record<string, unknown>) => ReturnType<typeof jsonResponse>
  },
) {
  const ledger = options?.ledger ?? buildSampleLedger()
  const calls: Array<{ method: string; url: string; body?: unknown }> = []

  const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const parsedBody =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ method, url, body: parsedBody })

    if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(200, me))
    if (url.includes('/api/patients/101/ledger')) return Promise.resolve(jsonResponse(200, ledger))
    if (url.includes('/api/visits/501/bill')) {
      return Promise.resolve(jsonResponse(200, sampleVisitBill))
    }
    if (url.includes('/api/settings/clinic')) return Promise.resolve(jsonResponse(200, {}))
    const refundMatch = url.match(/\/api\/payments\/(\d+)\/refunds/)
    if (refundMatch && method === 'POST') {
      const paymentId = Number(refundMatch[1])
      if (options?.refundHandler) {
        return Promise.resolve(options.refundHandler(paymentId, parsedBody ?? {}))
      }
      const created: RefundOut = {
        id: 902,
        refund_number: 'RFN-2627-000002',
        payment_id: paymentId,
        payment_receipt_number: 'RCP-2026-0001',
        patient_id: 101,
        visit_id: 501,
        amount_paise: Number(parsedBody?.amount_paise ?? 0),
        refund_method: String(parsedBody?.refund_method ?? 'CASH'),
        reason: String(parsedBody?.reason ?? ''),
        refunded_by_user_id: 1,
        refunded_by_username: 'admin',
        created_at: '2026-11-12T12:00:00Z',
      }
      return Promise.resolve(jsonResponse(201, created))
    }

    return Promise.reject(new Error(`Unhandled fetch: ${method} ${url}`))
  })

  vi.stubGlobal('fetch', mockFetch)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PatientBillingLedgerTab
          patientId={101}
          role={me.role}
          permissions={me.permissions}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PatientBillingLedgerTab & PaymentRefundModal (T3.4)', () => {
  it('renders 4-tile KPI totals, Visit Bills expansion embedding BillPanel, and immutable DEBIT/CREDIT ledger rows', async () => {
    const user = userEvent.setup()
    const { calls } = renderLedgerTab(adminMe)

    // 4-tile KPI summary bar formatted via formatPaise()
    expect(await screen.findByTestId('kpi-total-billed')).toHaveTextContent('₹1,500.00')
    expect(screen.getByTestId('kpi-total-paid')).toHaveTextContent('₹1,200.00')
    expect(screen.getByTestId('kpi-total-refunded')).toHaveTextContent('₹200.00')
    expect(screen.getByTestId('kpi-outstanding-balance')).toHaveTextContent('₹500.00')

    // Role-neutral visit workspace link present; Reception checkout link hidden for Admin
    expect(
      screen.getByRole('link', { name: /Open Visit Workspace for VIS-2026-0501/i }),
    ).toHaveAttribute('href', '/patients/101/visits/501')
    expect(
      screen.queryByRole('link', { name: /Open Reception Checkout for VIS-2026-0501/i }),
    ).not.toBeInTheDocument()

    // Expand Visit Bill -> embeds BillPanel & loads GET /api/visits/501/bill
    await user.click(screen.getByRole('button', { name: 'View Bill' }))
    expect(
      await screen.findByText('Orthopaedics Consultation — Dr. Dwivedi'),
    ).toBeInTheDocument()
    expect(screen.getByText('Lumbar Traction & IFT Therapy')).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/api/visits/501/bill'))).toBe(true)

    // Immutable Ledger Journal: DEBIT (text-red-800) & CREDIT (text-emerald-800) pills + descriptions
    const ledgerSection = screen.getByRole('region', { name: 'Immutable Ledger Journal' })
    const debitPills = within(ledgerSection).getAllByText('DEBIT')
    const creditPills = within(ledgerSection).getAllByText('CREDIT')
    expect(debitPills).toHaveLength(2)
    expect(creditPills).toHaveLength(1)
    expect(debitPills[0].className).toContain('text-red-800')
    expect(creditPills[0].className).toContain('text-emerald-800')
    expect(
      within(ledgerSection).getByText('Consultation fee — Dr. Madan Mohan Dwivedi'),
    ).toBeInTheDocument()
    expect(
      within(ledgerSection).getByText('Payment received (RCP-2026-0001)'),
    ).toBeInTheDocument()
    expect(
      within(ledgerSection).getByText('Refund RFN-2627-000001 against RCP-2026-0001'),
    ).toBeInTheDocument()
  })

  it('shows Partially Refunded badge disabling Reverse, disables both on Reversed, and opens ReceiptDialog on Print Receipt', async () => {
    const user = userEvent.setup()
    renderLedgerTab(adminMe)

    await screen.findByText('RCP-2026-0001')

    // RCP-2026-0001: Partially Refunded -> Reverse disabled, Refund enabled
    expect(screen.getByText('Partially Refunded')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reverse payment RCP-2026-0001' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Refund payment RCP-2026-0001' }),
    ).toBeEnabled()

    // RCP-2026-0002: Paid (0 refunded) -> both Reverse & Refund enabled
    expect(
      screen.getByRole('button', { name: 'Reverse payment RCP-2026-0002' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Refund payment RCP-2026-0002' }),
    ).toBeEnabled()

    // RCP-2026-0003: Reversed -> both Reverse & Refund disabled
    expect(screen.getByText('Reversed')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reverse payment RCP-2026-0003' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Refund payment RCP-2026-0003' }),
    ).toBeDisabled()

    // Print Receipt opens ReceiptDialog with DUPLICATE stamp
    await user.click(screen.getByRole('button', { name: 'Print Receipt RCP-2026-0001' }))
    expect(await screen.findByText('Payment receipt (DUPLICATE COPY)')).toBeInTheDocument()
    expect(screen.getByTestId('duplicate-stamp')).toHaveTextContent('DUPLICATE')
  })

  it('allows Admin to submit a partial refund via PaymentRefundModal with client-side cap & 422 error display', async () => {
    const user = userEvent.setup()
    let failFirst = true
    const { calls } = renderLedgerTab(adminMe, {
      refundHandler: (paymentId, body) => {
        if (failFirst) {
          failFirst = false
          return jsonResponse(422, {
            code: 'refund_exceeds_payment',
            message: 'Refund exceeds remaining refundable amount on server.',
          })
        }
        return jsonResponse(201, {
          id: 902,
          refund_number: 'RFN-2627-000002',
          payment_id: paymentId,
          payment_receipt_number: 'RCP-2026-0001',
          patient_id: 101,
          visit_id: 501,
          amount_paise: Number(body.amount_paise),
          refund_method: String(body.refund_method),
          reason: String(body.reason),
          refunded_by_user_id: 1,
          refunded_by_username: 'admin',
          created_at: '2026-11-12T12:00:00Z',
        })
      },
    })

    await screen.findByText('RCP-2026-0001')

    await user.click(screen.getByRole('button', { name: 'Refund payment RCP-2026-0001' }))

    expect(await screen.findByRole('heading', { name: 'Issue Payment Refund' })).toBeInTheDocument()
    const amountInput = screen.getByLabelText(/Refund Amount/i)
    const methodSelect = screen.getByLabelText(/Refund Method/i)
    const reasonInput = screen.getByLabelText(/Mandatory Refund Reason/i)

    // Pre-filled with remaining refundable amount (₹800.00)
    expect(amountInput).toHaveValue('800.00')

    // Client-side cap prevents exceeding remaining ₹800.00
    await user.clear(amountInput)
    await user.type(amountInput, '900.00')
    await user.type(reasonInput, 'Partial adjustment')
    await user.click(screen.getByRole('button', { name: 'Confirm Refund' }))
    expect(
      await screen.findByText(/exceeds the remaining refundable amount/i),
    ).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    // Valid amount (₹300.50 -> 30050 paise) first surfaces server 422 alert
    await user.clear(amountInput)
    await user.type(amountInput, '300.50')
    await user.selectOptions(methodSelect, 'CASH')
    await user.click(screen.getByRole('button', { name: 'Confirm Refund' }))
    expect(
      await screen.findByText('Refund exceeds remaining refundable amount on server.'),
    ).toBeInTheDocument()

    // Second submit succeeds -> sends integer paise + method + reason and closes modal
    await user.click(screen.getByRole('button', { name: 'Confirm Refund' }))
    await waitFor(() => {
      expect(screen.getByText(/Refund RFN-2627-000002 issued for ₹300.50/i)).toBeInTheDocument()
    })

    const postCall = calls.filter((c) => c.method === 'POST' && c.url.includes('/api/payments/301/refunds'))
    expect(postCall).toHaveLength(2)
    expect(postCall[1].body).toEqual({
      amount_paise: 30050,
      refund_method: 'CASH',
      reason: 'Partial adjustment',
    })
  })

  it('hides Admin-only Reverse & Refund actions for RECEPTION while showing Reception Checkout link and Print Receipt', async () => {
    renderLedgerTab(receptionMe)

    await screen.findByText('RCP-2026-0001')

    expect(
      screen.getByRole('link', { name: /Open Reception Checkout for VIS-2026-0501/i }),
    ).toHaveAttribute('href', '/reception/billing?visit_id=501')
    expect(
      screen.getByRole('button', { name: 'Print Receipt RCP-2026-0001' }),
    ).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /^Reverse$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Refund$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reverse payment/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Refund payment/i })).not.toBeInTheDocument()
  })

  it('completely hides Billing & Ledger tab for DOCTOR on PatientDetail and never calls /ledger', async () => {
    const fetchedUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        fetchedUrls.push(url)
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(200, doctorMe))
        if (url.includes('/api/patients/101/summary')) {
          return Promise.resolve(jsonResponse(200, doctorSummary))
        }
        if (url.includes('/api/patients/101/allergies')) return Promise.resolve(jsonResponse(200, []))
        if (url.includes('/api/patients/101')) return Promise.resolve(jsonResponse(200, samplePatient))
        return Promise.reject(new Error(`Unhandled fetch: ${url}`))
      }),
    )

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/patients/101?tab=billing']}>
          <Routes>
            <Route path="/reception/patients/:id" element={<PatientDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    })

    expect(screen.queryByRole('tab', { name: 'Billing & Ledger' })).not.toBeInTheDocument()
    expect(screen.queryByText('Immutable Ledger Journal')).not.toBeInTheDocument()
    expect(fetchedUrls.some((u) => u.includes('/ledger'))).toBe(false)
  })
})
