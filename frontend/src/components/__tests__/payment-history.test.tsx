import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/dialog-shim'
import type { PaymentOut } from '../../api/types'
import { PaymentHistory } from '../PaymentHistory'

const mocks = vi.hoisted(() => ({
  me: { role: 'RECEPTION' as string },
  payments: undefined as unknown,
}))

vi.mock('../../api/queries', () => ({
  useMe: () => ({ data: { id: 2, username: 'reception', full_name: 'Reception', role: mocks.me.role } }),
  usePatientPayments: () => ({ data: mocks.payments, isPending: false, isError: false }),
  useClinicSettings: () => ({ data: undefined }),
}))

const paid: PaymentOut = {
  id: 31,
  receipt_number: 'RCP-TEST-0031',
  patient_id: 1,
  patient_urn: 'TEST-0001',
  patient_name: 'Test Patient One',
  treatment_plan_id: null,
  treatment_plan_name: null,
  appointment_id: null,
  amount_paise: 50000,
  payment_method: 'CASH',
  notes: null,
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  created_by_username: 'reception',
  created_at: '2026-11-02T10:00:00Z',
} as unknown as PaymentOut

const reversed = { ...paid, id: 32, receipt_number: 'RCP-TEST-0032', is_reversed: true } as PaymentOut

describe('PaymentHistory', () => {
  beforeEach(() => {
    mocks.me.role = 'RECEPTION'
    mocks.payments = [paid, reversed]
  })

  it('lists receipts; a reversed payment is labelled Reversed and has no reprint button', () => {
    render(<PaymentHistory patientId={1} />)
    expect(screen.getByRole('heading', { name: 'Payments & receipts' })).toBeInTheDocument()
    expect(screen.getByText('RCP-TEST-0031')).toBeInTheDocument()
    expect(screen.getByText('Reversed')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Reprint receipt/ })).toHaveLength(1)
  })

  it('Reprint opens the receipt as a DUPLICATE COPY', async () => {
    render(<PaymentHistory patientId={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Reprint receipt RCP-TEST-0031/ }))
    const dialog = await screen.findByRole('dialog', { name: /DUPLICATE COPY/ })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId('duplicate-stamp')).toBeInTheDocument()
  })

  it('Esc closes the reprint and the history card stays on screen', async () => {
    render(<PaymentHistory patientId={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Reprint receipt RCP-TEST-0031/ }))
    await screen.findByRole('dialog', { name: /DUPLICATE COPY/ })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Payments & receipts' })).toBeInTheDocument()
  })

  it('a Doctor sees no payment card', () => {
    mocks.me.role = 'DOCTOR'
    const { container } = render(<PaymentHistory patientId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a malformed payments response does not crash the page', () => {
    mocks.payments = { detail: 'unexpected' }
    render(<PaymentHistory patientId={1} />)
    expect(screen.getByText('No payments recorded yet.')).toBeInTheDocument()
  })
})
