import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../test/dialog-shim'
import { PaymentModal } from '../PaymentModal'

const mockMutateAsync = vi.fn()
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../../api/client', () => ({ apiFetch: mocks.apiFetch }))

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

  it('re-reads the package balance and blocks an amount that now exceeds it', async () => {
    mockMutateAsync.mockClear()
    mocks.apiFetch.mockResolvedValueOnce([{ treatment_plan_id: 1, balance_paise: 100000 }])
    renderComponent({
      maxAmountPaise: 400000,
      treatmentPlan: {
        id: 1,
        plan_name: 'Knee Rehab',
        agreed_price_paise: 600000,
      } as never,
    })

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: /Collect & Issue Receipt/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Amount cannot exceed the remaining package balance of ₹1,000.00.',
    )
    expect(mocks.apiFetch).toHaveBeenCalledWith('/billing/pending-dues')
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('submits when the refreshed balance still covers the amount', async () => {
    mockMutateAsync.mockClear()
    mockMutateAsync.mockResolvedValueOnce({ id: 9, receipt_number: 'RCP-TEST-0009' })
    mocks.apiFetch.mockResolvedValueOnce([{ treatment_plan_id: 1, balance_paise: 400000 }])
    renderComponent({
      maxAmountPaise: 200000,
      treatmentPlan: {
        id: 1,
        plan_name: 'Knee Rehab',
        agreed_price_paise: 600000,
      } as never,
    })

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: /Collect & Issue Receipt/i }))

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rejects an amount above the remaining package balance before calling the API', async () => {
    mockMutateAsync.mockClear()
    renderComponent({ maxAmountPaise: 400000 })

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '5000' } })
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Amount cannot exceed the remaining package balance of ₹4,000.00.',
    )
    expect(mockMutateAsync).not.toHaveBeenCalled()
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
