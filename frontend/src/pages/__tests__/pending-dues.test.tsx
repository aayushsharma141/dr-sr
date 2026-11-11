import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

const mocks = vi.hoisted(() => ({ recordMutate: vi.fn() }))

vi.mock('../../api/queries', () => ({
  usePendingDues: () => ({
    data: sampleDues,
    isLoading: false,
    error: null,
  }),
  useRecordPayment: () => ({
    mutateAsync: mocks.recordMutate,
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

    expect(screen.getByText('Pending Dues')).toBeInTheDocument()
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

    // Verify payment modal opens, pre-filled with the outstanding balance
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/Amount/i)).toHaveValue(4000)
  })

  it('collects a package instalment against the treatment plan', async () => {
    mocks.recordMutate.mockReset()
    mocks.recordMutate.mockResolvedValueOnce({ id: 55, receipt_number: 'RCP-TEST-0055' })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PendingDuesPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Collect Payment/i }))
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }))
    fireEvent.click(screen.getByRole('button', { name: /Collect & Issue Receipt/i }))

    await waitFor(() => expect(mocks.recordMutate).toHaveBeenCalledTimes(1))
    expect(mocks.recordMutate).toHaveBeenCalledWith({
      patient_id: 10,
      treatment_plan_id: 1,
      appointment_id: null,
      amount_paise: 150000,
      payment_method: 'UPI',
      notes: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows the server rejection when a payment exceeds the remaining balance', async () => {
    mocks.recordMutate.mockReset()
    mocks.recordMutate.mockRejectedValueOnce(
      new Error('Payment of ₹5,000.00 exceeds remaining balance of ₹4,000.00.'),
    )

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PendingDuesPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Collect Payment/i }))
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /Collect & Issue Receipt/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payment of ₹5,000.00 exceeds remaining balance of ₹4,000.00.',
    )
    // The dialog stays open so reception can correct the amount.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
