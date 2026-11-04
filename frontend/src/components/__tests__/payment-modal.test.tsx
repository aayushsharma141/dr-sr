import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../test/dialog-shim'
import { PaymentModal } from '../PaymentModal'

const mockMutateAsync = vi.fn()

vi.mock('../../api/queries', () => ({
  useRecordPayment: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

describe('PaymentModal', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <PaymentModal
          isOpen={true}
          onClose={vi.fn()}
          patientId={101}
          patientName="Test Patient"
          patientUrn="KLY-001"
          {...props}
        />
      </QueryClientProvider>
    )
  }

  it('renders payment modal and converts rupee input to paise on submission', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      id: 1,
      receipt_number: 'RCP-2026-0001',
      patient_id: 101,
      amount_paise: 50000,
      payment_method: 'UPI',
    })

    const onSuccess = vi.fn()
    const onClose = vi.fn()

    renderComponent({ onSuccess, onClose })

    expect(screen.getByText('Record Payment')).toBeInTheDocument()
    expect(screen.getByText('Test Patient (KLY-001)')).toBeInTheDocument()

    // Enter 500 rupees
    const amountInput = screen.getByLabelText(/Amount/i)
    fireEvent.change(amountInput, { target: { value: '500' } })

    // Select UPI
    const upiButton = screen.getByRole('button', { name: 'UPI' })
    fireEvent.click(upiButton)

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Collect & Issue Receipt/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        patient_id: 101,
        treatment_plan_id: null,
        appointment_id: null,
        amount_paise: 50000,
        payment_method: 'UPI',
        notes: null,
      })
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('rejects zero or negative amount input', async () => {
    renderComponent()

    const form = screen.getByRole('dialog').querySelector('form')!
    const amountInput = screen.getByLabelText(/Amount/i)
    fireEvent.change(amountInput, { target: { value: '0' } })

    fireEvent.submit(form)

    await waitFor(() => {
      expect(
        screen.getByText(/Please enter a valid payment amount greater than zero/i)
      ).toBeInTheDocument()
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })
  })

  it('shows a validation error as role=alert', async () => {
    renderComponent()
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '0' } })
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent(/greater than zero/i)
  })

  it('Esc closes once through onClose and returns focus to the control that opened it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <QueryClientProvider client={queryClient}>
          <button type="button" onClick={() => setOpen(true)}>
            Collect Payment
          </button>
          <PaymentModal
            isOpen={open}
            onClose={() => {
              onClose()
              setOpen(false)
            }}
            patientId={101}
            patientName="Test Patient"
            patientUrn="KLY-001"
          />
        </QueryClientProvider>
      )
    }
    render(<Opener />)

    await user.click(screen.getByRole('button', { name: 'Collect Payment' }))
    await waitFor(() => expect(screen.getByLabelText(/Amount/i)).toHaveFocus())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Collect Payment' })).toHaveFocus()
  })
})
