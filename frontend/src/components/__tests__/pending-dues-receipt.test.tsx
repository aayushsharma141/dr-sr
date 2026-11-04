import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import '../../test/dialog-shim'
import type { PaymentOut } from '../../api/types'
import { PaymentModal } from '../PaymentModal'
import { ReceiptHost } from '../ReceiptHost'

const mocks = vi.hoisted(() => ({ recordMutate: vi.fn() }))

// Receipt wiring for pending dues without editing PendingDuesPage (another agent's uncommitted
// file, B-1 H4 declined): PaymentModal announces the saved payment; ReceiptHost shows the receipt.
vi.mock('../../api/queries', () => ({
  useRecordPayment: () => ({ mutateAsync: mocks.recordMutate, isPending: false }),
  useClinicSettings: () => ({ data: undefined }),
}))

const saved: PaymentOut = {
  id: 21,
  receipt_number: 'RCP-TEST-0021',
  patient_id: 1,
  patient_urn: 'TEST-0001',
  patient_name: 'Test Patient One',
  treatment_plan_id: null,
  treatment_plan_name: null,
  appointment_id: null,
  amount_paise: 75000,
  payment_method: 'UPI',
  notes: null,
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  created_by_username: 'reception',
  created_at: '2026-11-02T10:00:00Z',
} as unknown as PaymentOut

function Page() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <PaymentModal
        isOpen={open}
        onClose={() => setOpen(false)}
        patientId={1}
        patientName="Test Patient One"
        patientUrn="TEST-0001"
      />
      <ReceiptHost />
    </>
  )
}

describe('pending dues: a saved payment opens its receipt', () => {
  it('after Collect & Issue Receipt succeeds, the receipt dialog opens for that payment (not a duplicate)', async () => {
    mocks.recordMutate.mockResolvedValueOnce(saved)
    render(<Page />)

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '750' } })
    fireEvent.click(screen.getByRole('button', { name: /Collect & Issue Receipt/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Payment receipt' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('RCP-TEST-0021')).toBeInTheDocument()
    expect(screen.queryByTestId('duplicate-stamp')).not.toBeInTheDocument()
  })

  it('Esc closes the receipt dialog', async () => {
    mocks.recordMutate.mockResolvedValueOnce(saved)
    render(<Page />)
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '750' } })
    fireEvent.click(screen.getByRole('button', { name: /Collect & Issue Receipt/i }))
    await screen.findByRole('dialog', { name: 'Payment receipt' })

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Payment receipt' })).not.toBeInTheDocument())
  })
})
