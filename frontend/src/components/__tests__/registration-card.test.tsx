import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RegistrationCard } from '../RegistrationCard'
import type { ClinicSettingsOut, PatientOut } from '../../api/types'

const mockPatient: PatientOut = {
  id: 1,
  urn: 'KH-2026-0001',
  full_name: 'Aarav Kumar',
  guardian_name: 'Suresh Kumar',
  gender: 'M',
  dob: '1995-05-15',
  age_years: 30,
  mobile: '9876543210',
  address: 'Main Bazaar, Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: '9876500000',
  allergies: 'Penicillin allergy',
  notes: 'Needs wheelchair assistance',
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockSettings: ClinicSettingsOut = {
  id: 1,
  name_en: 'Kalyan Hospital & Research Centre',
  name_hi: 'कल्याण अस्पताल एवं शोध केंद्र',
  address_1: 'Station Road, Ara',
  address_2: 'Near Post Office',
  phone: '06182-234567',
  email: 'support@kalyanhospital.org',
  receipt_sequence_cycle: 'FINANCIAL_YEAR',
  print_header_en: 'Header EN',
  print_header_hi: 'Header HI',
  print_footer_en: 'Speedy recovery wishes.',
  print_footer_hi: 'शीघ्र स्वास्थ्य लाभ।',
  consultation_validity_days: 15,
  version_id: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('RegistrationCard Component', () => {
  it('renders the approved letterhead with clinic name and patient URN', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    expect(screen.getByText('Kalyan Hospital & Research Centre')).toBeInTheDocument()
    expect(screen.getByText(/physiotherapy department/i)).toBeInTheDocument()
    expect(screen.getByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
    expect(screen.getByText('Dr. Chandan Kr. Dwivedi')).toBeInTheDocument()
    expect(screen.getByAltText('Caduceus emblem')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('RECORD #KH-2026-0001')).toBeInTheDocument()
  })

  it('fills the ruled patient strip and the numbered fields from the record', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    // Name, age/sex and address appear in both the strip and the numbered fields.
    expect(screen.getAllByText('Aarav Kumar')).toHaveLength(2)
    expect(screen.getAllByText('30 Years / Male')).toHaveLength(2)
    expect(screen.getAllByText(/Main Bazaar, Ara, Bhojpur, Bihar/i)).toHaveLength(2)
    expect(screen.getByText('Suresh Kumar')).toBeInTheDocument()
    expect(screen.getByText('9876543210')).toBeInTheDocument()
    expect(screen.getByText('Penicillin allergy')).toBeInTheDocument()
    expect(screen.getByText(/Needs wheelchair assistance/i)).toBeInTheDocument()
  })

  it('leaves the visit and payment fields as lines to write on', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    for (const label of [
      /7\. Patient In/,
      /8\. Patient Out/,
      /9\. Reference \/ Referred By/,
      /10\. Patient Condition/,
      /11\. No\. of Sessions/,
      /12\. Payment Details/,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText(/Consulting Doctor/)).toBeInTheDocument()
  })

  it('renders dual signature block and the clinic address footer', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    expect(screen.getByText('Patient / Attendant Signature')).toBeInTheDocument()
    expect(screen.getByText('मरीज / परिचारक के हस्ताक्षर')).toBeInTheDocument()
    expect(screen.getByText('Authorized Signatory / Receptionist')).toBeInTheDocument()
    expect(screen.getByTestId('letterhead-footer')).toHaveTextContent('Station Road, Ara')
  })

  it('falls back to the standard clinic addresses when settings have none', () => {
    render(<RegistrationCard patient={mockPatient} settings={null} />)

    expect(screen.getByText('Kalyan Hospital')).toBeInTheDocument()
    expect(screen.getByTestId('letterhead-footer')).toHaveTextContent('नवादा थाना')
  })

  it('shows the stored photo when the patient has one', () => {
    render(<RegistrationCard patient={{ ...mockPatient, photo_path: 'p.jpg' }} settings={mockSettings} />)

    expect(screen.getByAltText('Patient photo')).toHaveAttribute('src', '/api/patients/1/photo')
  })
})
