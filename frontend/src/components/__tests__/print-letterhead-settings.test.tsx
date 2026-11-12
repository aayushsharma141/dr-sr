import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LetterheadBanner, LetterheadContactLine, LetterheadHeaderNote } from '../PrintLetterhead'
import { ReceiptPrint } from '../ReceiptPrint'
import type { ClinicSettingsOut, PaymentOut } from '../../api/types'

const settings = {
  id: 1,
  name_en: 'Kalyan Hospital',
  name_hi: 'कल्याण अस्पताल',
  trust_name_en: 'Sri Vashishtha Kalyan Trust',
  trust_name_hi: null,
  location_line: 'Ara',
  address_1: 'Station Road, Ara',
  address_2: null,
  phone: '06182-234567',
  email: 'support@kalyanhospital.org',
  receipt_sequence_cycle: 'FINANCIAL_YEAR',
  print_header_en: 'Header EN',
  print_header_hi: 'Header HI',
  print_footer_en: null,
  print_footer_hi: null,
  consultation_validity_days: 15,
  version_id: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as ClinicSettingsOut

describe('shared letterhead fields from hospital setup', () => {
  it('prints the header note, trust and contact line when set', () => {
    render(
      <>
        <LetterheadBanner clinicName="Kalyan Hospital" clinicNameHi="कल्याण अस्पताल" />
        <LetterheadHeaderNote settings={settings} />
        <LetterheadContactLine settings={settings} />
      </>,
    )
    expect(screen.getByTestId('letterhead-name-hi')).toHaveTextContent('कल्याण अस्पताल')
    expect(screen.getByTestId('print-header')).toHaveTextContent('Header EN')
    expect(screen.getByTestId('print-header')).toHaveTextContent('Header HI')
    expect(screen.getByTestId('card-contact-line')).toHaveTextContent(
      'Sri Vashishtha Kalyan Trust · Phone: 06182-234567 · Email: support@kalyanhospital.org',
    )
  })

  it('renders nothing for blank or missing settings', () => {
    const blank = { ...settings, print_header_en: null, print_header_hi: '', phone: '', email: null, trust_name_en: '' }
    const { container } = render(
      <>
        <LetterheadHeaderNote settings={blank} />
        <LetterheadContactLine settings={blank} />
        <LetterheadHeaderNote settings={null} />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('receipt prints the header note and contact line from settings', () => {
    const payment = {
      id: 1,
      receipt_number: 'R-1',
      amount_paise: 50000,
      payment_method: 'CASH',
      created_at: '2026-01-01T10:00:00Z',
      created_by_username: 'reception',
      patient_urn: 'KH-1',
      patient_name: 'Test Patient',
      is_reversed: false,
    } as unknown as PaymentOut
    render(<ReceiptPrint payment={payment} settings={settings} />)
    expect(screen.getByTestId('print-header')).toHaveTextContent('Header EN')
    expect(screen.getByTestId('card-contact-line')).toHaveTextContent('Phone: 06182-234567')
  })
})
