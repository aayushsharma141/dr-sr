import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReceiptPrint } from '../../components/ReceiptPrint'
import { RegistrationCard } from '../../components/RegistrationCard'
import type { PaymentOut, PatientOut, ClinicSettingsOut } from '../../api/types'

const mockPayment: PaymentOut = {
  id: 1,
  receipt_number: 'RCP-2026-00001',
  patient_id: 10,
  patient_urn: 'KHM-2026-00010',
  patient_name: 'Rajesh Kumar',
  treatment_plan_id: null,
  treatment_plan_name: null,
  appointment_id: null,
  amount_paise: 50000,
  payment_method: 'CASH',
  notes: 'Registration fee',
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  reversed_at: null,
  created_by_username: 'reception1',
  created_at: '2026-11-02T10:00:00Z',
}

const mockPatient: PatientOut = {
  id: 10,
  urn: 'KHM-2026-00010',
  full_name: 'Rajesh Kumar',
  guardian_name: 'Suresh Kumar',
  gender: 'M',
  dob: null,
  age_years: 42,
  mobile: '9876543210',
  address: 'Main Road',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: '9876543211',
  allergies: 'None',
  notes: null,
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
}

const mockSettings: ClinicSettingsOut = {
  id: 1,
  name_en: 'Kalyan Hospital',
  name_hi: 'कल्याण अस्पताल',
  trust_name_en: 'Sri Vashishtha Kalyan Trust',
  trust_name_hi: null,
  location_line: 'Ara, Bhojpur, Bihar',
  address_1: 'Station Road',
  address_2: 'Ara, Bihar',
  phone: '06182-234567',
  email: 'contact@kalyan.in',
  receipt_sequence_cycle: 'FINANCIAL_YEAR',
  print_header_en: 'Healthcare & Physiotherapy',
  print_header_hi: 'स्वास्थ्य एवं फिजियोथेरेपी केंद्र',
  print_footer_en: 'Speedy recovery',
  print_footer_hi: 'शीघ्र स्वास्थ्य लाभ की कामना',
  consultation_validity_days: 14,
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
}

describe('Hospital Print Layouts & Typography (PRN-01)', () => {
  it('renders 80mm thermal receipt with bilingual headers and amount', () => {
    render(<ReceiptPrint payment={mockPayment} isReprint={false} />)

    expect(screen.getByText(/कल्याण हॉस्पिटल एवं फिजियोथेरेपी केंद्र/)).toBeInTheDocument()
    expect(screen.getByText(/Kalyan Hospital & Physiotherapy Centre/)).toBeInTheDocument()
    expect(screen.getByText('RCP-2026-00001')).toBeInTheDocument()
    expect(screen.getByText('Rajesh Kumar')).toBeInTheDocument()
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    expect(screen.queryByTestId('duplicate-stamp')).not.toBeInTheDocument()
  })

  it('renders DUPLICATE watermark when isReprint is true', () => {
    render(<ReceiptPrint payment={mockPayment} isReprint={true} />)

    const stamp = screen.getByTestId('duplicate-stamp')
    expect(stamp).toBeInTheDocument()
    expect(stamp).toHaveTextContent('DUPLICATE')
  })

  it('renders A4 registration card with dual signature boxes and patient demographics', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    expect(screen.getByText('Kalyan Hospital')).toBeInTheDocument()
    // Hindi hospital name prints in the banner and again on the signature line.
    expect(screen.getAllByText(/कल्याण अस्पताल/)).toHaveLength(2)
    expect(screen.getByText('KHM-2026-00010')).toBeInTheDocument()
    expect(screen.getByText('Suresh Kumar')).toBeInTheDocument()
    expect(screen.getByText(/Authorized Signatory \/ Receptionist/i)).toBeInTheDocument()
    expect(screen.getByText(/Patient \/ Attendant Signature/i)).toBeInTheDocument()
  })
})
