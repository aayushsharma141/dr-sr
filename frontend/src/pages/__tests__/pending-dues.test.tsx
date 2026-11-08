import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { PendingDuesPage } from '../PendingDuesPage'

const sampleDues = [
  {
    treatment_plan_id: 1,
    patient_id: 10,
    patient_urn: 'KLY-0010',
    patient_name: 'Sunita Devi',
    plan_name: 'Knee Osteoarthritis Rehab',
    condition_diagnosis: 'Grade 2 OA',
    agreed_price_paise: 600000,
    paid_paise: 200000,
    balance_paise: 400000,
    total_sessions: 12,
    completed_sessions: 4,
  },
]

vi.mock('../../api/queries', () => ({
  usePendingDues: () => ({
    data: sampleDues,
    isLoading: false,
    error: null,
  }),
  useRecordPayment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useMe: () => ({ data: { full_name: 'Reception User', role: 'RECEPTION' }, isLoading: false }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../api/branding', () => ({
  useClinicBranding: () => ({
    trustNameEn: 'Sri Vashishtha Kalyan Trust',
    trustNameHi: 'श्री वशिष्ठ कल्याण ट्रस्ट',
    hospitalName: 'Kalyan Hospital',
    address: 'Hospital Road, Ara, Bhojpur, Bihar - 802301',
    locationLine: 'Ara, Bhojpur, Bihar',
  }),
}))

describe('PendingDuesPage', () => {
  const queryClient = new QueryClient()

  it('renders pending dues table with formatted rupee balances', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PendingDuesPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByText('Pending Dues Ledger')).toBeInTheDocument()
    expect(screen.getByText('Sunita Devi')).toBeInTheDocument()
    expect(screen.getByText('KLY-0010')).toBeInTheDocument()
    expect(screen.getByText('Knee Osteoarthritis Rehab')).toBeInTheDocument()

    // ₹4,000.00 outstanding balance
    expect(screen.getAllByText('₹4,000.00').length).toBeGreaterThan(0)
    expect(screen.getByText('4 / 12')).toBeInTheDocument()

    // Action button
    const collectBtn = screen.getByRole('button', { name: /Collect Payment/i })
    expect(collectBtn).toBeInTheDocument()
    fireEvent.click(collectBtn)

    // Verify payment modal opens
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
