import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/dialog-shim'
import type { ClinicSettingsOut, PaymentOut } from '../../api/types'
import { ReceiptDialog } from '../ReceiptDialog'
import { ReceiptPrint } from '../ReceiptPrint'

const mocks = vi.hoisted(() => ({ settings: undefined as unknown }))

vi.mock('../../api/queries', () => ({
  useClinicSettings: () => ({ data: mocks.settings }),
}))

const payment: PaymentOut = {
  id: 7,
  receipt_number: 'RCP-TEST-0007',
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

const settings = {
  name_en: 'Test Clinic Name',
  name_hi: 'परीक्षण क्लिनिक',
  address_1: 'परीक्षण पता 1',
  address_2: null,
  phone: '9000000999',
  print_footer_hi: null,
} as unknown as ClinicSettingsOut

describe('ReceiptPrint header comes from clinic settings', () => {
  it('uses settings name, address and phone, and the Hindi name is marked lang="hi"', () => {
    render(<ReceiptPrint payment={payment} settings={settings} />)
    expect(screen.getByText('Test Clinic Name')).toBeInTheDocument()
    expect(screen.getByText('परीक्षण क्लिनिक')).toHaveAttribute('lang', 'hi')
    expect(screen.getByText('परीक्षण पता 1')).toBeInTheDocument()
    expect(screen.getByText(/Phone: 9000000999/)).toBeInTheDocument()
  })

  it('falls back to the standard clinic text and never shows the old placeholder phone', () => {
    const { container } = render(<ReceiptPrint payment={payment} />)
    expect(screen.getByText('Kalyan Hospital & Physiotherapy Centre')).toBeInTheDocument()
    expect(container.textContent).not.toContain('94310')
  })

  it('has no dark: classes, so the receipt does not follow the OS theme', () => {
    const { container } = render(<ReceiptPrint payment={payment} />)
    expect(container.innerHTML).not.toMatch(/dark:/)
  })
})

describe('ReceiptDialog', () => {
  beforeEach(() => {
    mocks.settings = settings
  })

  it('opens as a named receipt dialog with the receipt inside', () => {
    render(<ReceiptDialog payment={payment} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Payment receipt' })
    expect(dialog).toHaveAttribute('data-print-page', 'receipt')
    expect(dialog).toHaveClass('print-portal')
    expect(screen.getByText('RCP-TEST-0007')).toBeInTheDocument()
  })

  it('a reprint is titled DUPLICATE COPY and shows the duplicate stamp', () => {
    render(<ReceiptDialog payment={payment} isReprint onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: /DUPLICATE COPY/ })).toBeInTheDocument()
    expect(screen.getByTestId('duplicate-stamp')).toBeInTheDocument()
  })

  it('Print calls window.print once', async () => {
    const printSpy = vi.fn()
    vi.stubGlobal('print', printSpy)
    const user = userEvent.setup()
    render(<ReceiptDialog payment={payment} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Print receipt (A4)' }))
    expect(printSpy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('the print button has focus on open', async () => {
    render(<ReceiptDialog payment={payment} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print receipt (A4)' })).toHaveFocus())
  })

  it('Esc closes it through onClose exactly once', async () => {
    const onClose = vi.fn()
    render(<ReceiptDialog payment={payment} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
