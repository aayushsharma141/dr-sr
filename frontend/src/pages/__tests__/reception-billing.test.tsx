import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionBillingPage } from '../ReceptionBillingPage'
import type { Me, PatientOut, PaymentOut, PendingDueOut, DoctorOut } from '../../api/types'

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['payment:create', 'payment:read', 'patients:read', 'appointment:read'],
  version_id: 1,
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

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
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
      if (url.includes('/api/patients') && init?.method !== 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockPatient])),
        })
      }
      if (url.includes('/api/payments') && init?.method === 'POST') {
        capturedPayload = JSON.parse(init.body as string)
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockRecordedPayment)),
        })
      }
      if (url.includes('/api/billing/ledger')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockRecordedPayment])),
        })
      }
      if (url.includes('/api/billing/pending-dues')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDues)),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/billing']}>
          <ReceptionBillingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Check Header & Tabs
    expect(screen.getByRole('heading', { name: /Reception Billing & Payment Desk/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Counter Checkout & Collect/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Today's Receipts & Ledger/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Outstanding Package Dues/i })).toBeInTheDocument()

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

    // Switch to Outstanding Package Dues tab
    const duesTab = screen.getByRole('button', { name: /Outstanding Package Dues/i })
    await user.click(duesTab)

    await waitFor(() => {
      expect(screen.getByText('Lumbar Spine Rehab Package')).toBeInTheDocument()
    })
    expect(screen.getAllByText('₹4,000.00')[0]).toBeInTheDocument()
  })
})
