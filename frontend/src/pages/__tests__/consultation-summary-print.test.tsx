import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConsultationSummaryPrint,
  formatReprintTimestamp,
} from '../../components/ConsultationSummaryPrint'
import type { EncounterRead, PatientOut } from '../../api/types'

const mockPatient: PatientOut = {
  id: 101,
  urn: 'KH-2026-0001',
  full_name: 'Aarav Kumar',
  guardian_name: 'Suresh Kumar',
  gender: 'M',
  dob: '1995-05-15',
  age_years: 30,
  mobile: '9876543210',
  address: 'Station Road, Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: '9876500000',
  allergies: 'Penicillin allergy',
  notes: 'Referred by Dr. Sharma',
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockFinalisedEncounter: EncounterRead = {
  id: 77,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  appointment_id: 10,
  department_id: 1,
  encounter_date: '2026-11-06T10:30:00Z',
  symptoms: 'Bilateral knee pain for 3 months, worse on descending stairs.',
  clinical_notes: 'Quadriceps strengthening exercises advised twice daily. Avoid squatting.',
  diagnosis: 'Bilateral Knee Osteoarthritis Grade II',
  is_finalised: true,
  finalised_at: '2026-11-06T11:00:00Z',
  version_id: 2,
  created_at: '2026-11-06T10:30:00Z',
  updated_at: '2026-11-06T11:00:00Z',
  addenda: [],
}

const mockDraftEncounter: EncounterRead = {
  ...mockFinalisedEncounter,
  id: 78,
  is_finalised: false,
  finalised_at: null,
}

describe('formatReprintTimestamp helper', () => {
  it('formats dates into DD/MM/YYYY at HH:MM', () => {
    const fixedDate = new Date(2026, 10, 6, 15, 30) // Nov 6, 2026 15:30
    expect(formatReprintTimestamp(fixedDate)).toBe('06/11/2026 at 15:30')
  })
})

describe('ConsultationSummaryPrint component', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders hospital letterhead, patient identity, and 4 bilingual sections', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ConsultationSummaryPrint
          encounter={mockFinalisedEncounter}
          patient={mockPatient}
          followUp={{
            recommended_date: '2026-11-20',
            doctor_name: 'Dr. Madan Mohan Dwivedi',
            reception_notes: 'Review with X-Ray AP/Lateral views',
          }}
        />
      </QueryClientProvider>
    )

    // Letterhead banner & doctors
    expect(screen.getByTestId('letterhead-banner')).toBeInTheDocument()
    expect(screen.getByText('Patient Consultation Summary / मरीज परामर्श सारांश')).toBeInTheDocument()

    // Patient demographic details
    expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect(screen.getAllByText('Dr. Madan Mohan Dwivedi').length).toBeGreaterThan(0)

    // 4 Bilingual Sections
    expect(screen.getByText(/Chief Complaints \/ मुख्य शिकायतें/i)).toBeInTheDocument()
    expect(screen.getByText(/Bilateral knee pain for 3 months/i)).toBeInTheDocument()

    expect(screen.getByText(/Diagnosis \/ निदान/i)).toBeInTheDocument()
    expect(screen.getByText('Bilateral Knee Osteoarthritis Grade II')).toBeInTheDocument()

    expect(screen.getByText(/Advice \/ परामर्श एवं सलाह/i)).toBeInTheDocument()
    expect(screen.getByText(/Quadriceps strengthening exercises advised/i)).toBeInTheDocument()

    expect(screen.getByText(/Follow-up \/ पुनः परीक्षण/i)).toBeInTheDocument()
    expect(screen.getByText(/Instructions: Review with X-Ray AP\/Lateral views/i)).toBeInTheDocument()

    // Doctor signature seal box
    expect(screen.getByText(/Doctor's Signature \/ चिकित्सक के हस्ताक्षर/i)).toBeInTheDocument()
  })

  it('guarantees zero medications or prescription tables rendered in DOM (T-19-12, D-19-29)', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ConsultationSummaryPrint
          encounter={mockFinalisedEncounter}
          patient={mockPatient}
        />
      </QueryClientProvider>
    )

    // Ensure prescription terms and symbols are strictly absent
    expect(screen.queryByText('℞')).not.toBeInTheDocument()
    expect(screen.queryByText('Prescribed Medications (दवा का विवरण)')).not.toBeInTheDocument()
    expect(screen.queryByText(/दवा का विवरण/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Paracetamol')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    // Clear disclaimer directs patient to prescription slip
    expect(
      screen.getByText(/For prescribed medications, refer exclusively to the authorised Kalyan Hospital Prescription Slip/i)
    ).toBeInTheDocument()
  })

  it('enforces finalisation gate: unfinalised encounter draft cannot be printed', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ConsultationSummaryPrint
          encounter={mockDraftEncounter}
          patient={mockPatient}
        />
      </QueryClientProvider>
    )

    // Printable sheet must not exist
    expect(screen.queryByTestId('consultation-summary-sheet')).not.toBeInTheDocument()

    // Alert message must be rendered
    expect(screen.getByTestId('unfinalised-summary-block')).toBeInTheDocument()
    expect(screen.getByText('Cannot Print Consultation Summary')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A patient consultation summary can only be printed on hospital letterhead after the encounter has been finalised.'
      )
    ).toBeInTheDocument()
  })

  it('renders reprint timestamp stamp when reprint prop or timestamp is active', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ConsultationSummaryPrint
          encounter={mockFinalisedEncounter}
          patient={mockPatient}
          isReprint
          reprintTimestamp="06/11/2026 at 15:30"
        />
      </QueryClientProvider>
    )

    const stamp = screen.getByTestId('reprint-stamp')
    expect(stamp).toBeInTheDocument()
    expect(stamp).toHaveTextContent('Reprinted on: 06/11/2026 at 15:30')
  })
})
