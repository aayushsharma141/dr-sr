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
  it('renders bilingual clinic header and patient URN', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    expect(screen.getByText('Kalyan Hospital & Research Centre')).toBeInTheDocument()
    expect(screen.getByText('कल्याण अस्पताल एवं शोध केंद्र')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
  })

  it('renders demographics table, barcode SVG, and allergies alert', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    expect(screen.getByText('Suresh Kumar')).toBeInTheDocument()
    expect(screen.getByText('30 Years / Male')).toBeInTheDocument()
    expect(screen.getByText('9876543210')).toBeInTheDocument()
    expect(screen.getByText(/Main Bazaar, Ara, Bhojpur, Bihar/i)).toBeInTheDocument()
    expect(screen.getByText('Penicillin allergy')).toBeInTheDocument()
    expect(screen.getByText(/Needs wheelchair assistance/i)).toBeInTheDocument()

    // Barcode SVG check
    expect(screen.getByLabelText('Barcode for KH-2026-0001')).toBeInTheDocument()
  })

  it('renders dual signature block for patient and authorized signatory', () => {
    render(<RegistrationCard patient={mockPatient} settings={mockSettings} />)

    expect(screen.getByText('Patient / Attendant Signature')).toBeInTheDocument()
    expect(screen.getByText('मरीज / परिचारक के हस्ताक्षर')).toBeInTheDocument()
    expect(screen.getByText('Authorized Signatory / Receptionist')).toBeInTheDocument()
  })
})
