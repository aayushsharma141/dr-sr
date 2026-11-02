import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PaymentReversalModal } from '../PaymentReversalModal'
import type { PaymentOut } from '../../api/types'

const mockReverseMutate = vi.fn()

vi.mock('../../api/queries', () => ({
  useReversePayment: () => ({
    mutateAsync: mockReverseMutate,
    isPending: false,
  }),
}))

const samplePayment: PaymentOut = {
  id: 15,
  receipt_number: 'RCP-2026-0015',
  patient_id: 101,
  patient_urn: 'KLY-001',
  patient_name: 'Rajesh Kumar',
  treatment_plan_id: null,
  treatment_plan_name: null,
  appointment_id: null,
  amount_paise: 50000,
  payment_method: 'CASH',
  notes: null,
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  reversed_at: null,
  created_by_username: 'reception',
  created_at: '2026-03-01T10:00:00Z',
}

describe('PaymentReversalModal', () => {
  const queryClient = new QueryClient()

  it('requires at least 5 characters justification and calls reversal mutation', async () => {
    mockReverseMutate.mockResolvedValueOnce({
      ...samplePayment,
      is_reversed: true,
      reversal_reason: 'Entered wrong patient receipt',
    })

    const onSuccess = vi.fn()
    const onClose = vi.fn()

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentReversalModal
          isOpen={true}
          onClose={onClose}
          payment={samplePayment}
          onSuccess={onSuccess}
        />
      </QueryClientProvider>
    )

    expect(screen.getByText('Reverse Payment Transaction')).toBeInTheDocument()
    expect(screen.getByText(/RCP-2026-0015/i)).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText(/Provide a clear clinical or administrative justification/i)
    const confirmBtn = screen.getByRole('button', { name: /Confirm Reversal/i })

    // Try submitting with short justification (< 5 chars)
    fireEvent.change(textarea, { target: { value: 'err' } })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(
        screen.getByText(/Reversal reason must be at least 5 characters long/i)
      ).toBeInTheDocument()
      expect(mockReverseMutate).not.toHaveBeenCalled()
    })

    // Enter valid justification
    fireEvent.change(textarea, { target: { value: 'Entered wrong patient receipt' } })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockReverseMutate).toHaveBeenCalledWith({
        id: 15,
        payload: { reversal_reason: 'Entered wrong patient receipt' },
      })
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})

