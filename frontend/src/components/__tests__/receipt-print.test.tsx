import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReceiptPrint } from '../ReceiptPrint'
import type { PaymentOut } from '../../api/types'

const samplePayment: PaymentOut = {
  id: 42,
  receipt_number: 'RCP-2026-0042',
  patient_id: 101,
  patient_urn: 'KLY-001',
  patient_name: 'Aarav Patel',
  treatment_plan_id: 5,
  treatment_plan_name: 'Cervical Spondylosis Package',
  appointment_id: null,
  amount_paise: 250000,
  payment_method: 'CASH',
  notes: 'First instalment',
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  reversed_at: null,
  created_by_username: 'reception1',
  created_at: '2026-03-01T10:30:00Z',
}

describe('ReceiptPrint', () => {
  it('renders hospital letterhead, receipt metadata, and formatted rupee amount', () => {
    render(<ReceiptPrint payment={samplePayment} />)

    expect(screen.getByText('कल्याण हॉस्पिटल एवं फिजियोथेरेपी केंद्र')).toBeInTheDocument()
    expect(screen.getByText('Kalyan Hospital & Physiotherapy Centre')).toBeInTheDocument()
    expect(screen.getByText('RCP-2026-0042')).toBeInTheDocument()
    expect(screen.getByText('Aarav Patel')).toBeInTheDocument()
    expect(screen.getByText('Cervical Spondylosis Package')).toBeInTheDocument()
    expect(screen.getByText('₹2,500.00')).toBeInTheDocument()
    expect(screen.getByText('CASH')).toBeInTheDocument()
    expect(screen.getByText('@reception1')).toBeInTheDocument()

    // When isReprint is false, DUPLICATE stamp should not exist
    expect(screen.queryByTestId('duplicate-stamp')).not.toBeInTheDocument()
  })

  it('displays prominent DUPLICATE watermark and badge when isReprint is true', () => {
    render(<ReceiptPrint payment={samplePayment} isReprint={true} />)

    expect(screen.getByTestId('duplicate-stamp')).toBeInTheDocument()
    expect(screen.getByText(/DUPLICATE COPY/i)).toBeInTheDocument()
  })

  it('renders reversal information when payment is marked reversed', () => {
    const reversedPayment: PaymentOut = {
      ...samplePayment,
      is_reversed: true,
      reversal_reason: 'Entered duplicate by error',
      reversed_by_username: 'admin',
    }

    render(<ReceiptPrint payment={reversedPayment} />)

    expect(screen.getByText('TRANSACTION REVERSED')).toBeInTheDocument()
    expect(screen.getByText(/Entered duplicate by error/i)).toBeInTheDocument()
    expect(screen.getByText(/Authorized by @admin/i)).toBeInTheDocument()
  })
})
