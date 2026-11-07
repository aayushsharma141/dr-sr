import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'

import { PatientCorrectionPage } from '../admin/PatientCorrectionPage'
import { DemographicCorrectionModal } from '../../components/admin/DemographicCorrectionModal'
import { ReceiptPrint } from '../../components/ReceiptPrint'
import { PrescriptionPrint } from '../../components/PrescriptionPrint'
import { ConsultationSummaryPrint } from '../../components/ConsultationSummaryPrint'
import { RegistrationCard } from '../../components/RegistrationCard'
import type { PatientOut, PaymentOut, PrescriptionOut, EncounterRead } from '../../api/types'
import { ApiError } from '../../api/client'

const mockPatient: PatientOut = {
  id: 101,
  urn: 'KH-2026-0042',
  legacy_urn: 'OLD-999',
  full_name: 'Original Patient Name',
  guardian_name: 'Original Guardian',
  gender: 'M',
  dob: '1990-01-01',
  age_years: 36,
  mobile: '9876543210',
  address: '100 Hospital Road, Village Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: '9876500000',
  allergies: 'Penicillin allergy noted',
  notes: 'VIP trust member',
  photo_path: null,
  is_active: true,
  version_id: 3,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}

let mockSearchResults: PatientOut[] = [mockPatient]
const mutateCorrect = vi.fn()

vi.mock('../../api/queries', () => ({
  useAdminSearchPatients: (q: string) => ({
    data: q ? mockSearchResults : [],
    isLoading: false,
    isError: false,
  }),
  useCorrectPatientDemographics: () => ({
    mutateAsync: mutateCorrect,
    isPending: false,
  }),
  useClinicSettings: () => ({
    data: {
      id: 1,
      name_en: 'Kalyan Hospital',
      name_hi: 'कल्याण हॉस्पिटल',
      address_1: 'Station Road, Ara',
      phone: '+91 6182 000000',
      print_footer_hi: 'धन्यवाद',
    },
    isLoading: false,
  }),
}))

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Patient Demographic Correction & Print Snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchResults = [mockPatient]
  })

  describe('Print Components Stored Snapshot Rendering (D-20-05, D-20-06)', () => {
    it('ReceiptPrint renders stored snapshot details on duplicate reprint', () => {
      const payment: PaymentOut = {
        id: 50,
        receipt_number: 'RCP-2026-0050',
        patient_id: 101,
        patient_name: 'Stored Payment Name',
        patient_urn: 'KH-2026-0042',
        patient_mobile: '9876543210',
        patient_address: 'Stored Payment Address, Bhojpur',
        amount_paise: 30000,
        payment_method: 'CASH',
        notes: null,
        treatment_plan_id: null,
        treatment_plan_name: null,
        appointment_id: null,
        is_reversed: false,
        reversal_reason: null,
        reversed_by_username: null,
        reversed_at: null,
        created_by_username: 'reception',
        created_at: '2026-11-02T10:00:00Z',
      }

      render(<ReceiptPrint payment={payment} isReprint={true} />)

      expect(screen.getByText('Stored Payment Name')).toBeInTheDocument()
      expect(screen.getByText('KH-2026-0042')).toBeInTheDocument()
      expect(screen.getByText('9876543210')).toBeInTheDocument()
      expect(screen.getByText('Stored Payment Address, Bhojpur')).toBeInTheDocument()
      expect(screen.getByTestId('duplicate-stamp')).toBeInTheDocument()
      expect(screen.getAllByText(/DUPLICATE/i).length).toBeGreaterThanOrEqual(1)
    })

    it('PrescriptionPrint renders stored snapshot details', () => {
      const rx: PrescriptionOut = {
        id: 70,
        patient_id: 101,
        patient_name: 'Stored Rx Patient Name',
        patient_urn: 'KH-2026-0042',
        patient_mobile: '9876543210',
        patient_address: 'Stored Rx Address, Bhojpur',
        doctor_id: 1,
        doctor_name: 'Dr. Test Clinician',
        encounter_id: 88,
        status: 'AUTHORISED',
        authorised_at: '2026-11-03T11:00:00Z',
        diagnosis: 'Knee Osteoarthritis',
        dietary_advice: null,
        general_advice: null,
        follow_up_date: null,
        is_printable: true,
        version_id: 1,
        created_at: '2026-11-03T11:00:00Z',
        updated_at: '2026-11-03T11:00:00Z',
        items: [],
      }

      render(<PrescriptionPrint prescription={rx} />)

      expect(screen.getByText('Stored Rx Patient Name')).toBeInTheDocument()
      expect(screen.getByText('KH-2026-0042')).toBeInTheDocument()
      expect(screen.getByText('9876543210')).toBeInTheDocument()
      expect(screen.getByText('Stored Rx Address, Bhojpur')).toBeInTheDocument()
    })

    it('ConsultationSummaryPrint renders stored snapshot details', () => {
      const enc: EncounterRead = {
        id: 88,
        patient_id: 101,
        patient_name: 'Stored Enc Patient Name',
        patient_urn: 'KH-2026-0042',
        patient_mobile: '9876543210',
        patient_address: 'Stored Enc Address, Bhojpur',
        doctor_id: 1,
        doctor_name: 'Dr. Test Clinician',
        appointment_id: null,
        encounter_date: '2026-11-03T10:00:00Z',
        symptoms: 'Joint swelling',
        clinical_notes: 'Examination notes',
        diagnosis: 'Right Knee Osteoarthritis',
        is_finalised: true,
        finalised_at: '2026-11-03T10:30:00Z',
        version_id: 1,
        created_at: '2026-11-03T10:00:00Z',
        updated_at: '2026-11-03T10:30:00Z',
        addenda: [],
      }

      render(<ConsultationSummaryPrint encounter={enc} />)

      expect(screen.getByText('Stored Enc Patient Name')).toBeInTheDocument()
      expect(screen.getByText('KH-2026-0042')).toBeInTheDocument()
      expect(screen.getByText('9876543210')).toBeInTheDocument()
      expect(screen.getByText('Stored Enc Address, Bhojpur')).toBeInTheDocument()
    })

    it('RegistrationCard renders live patient record', () => {
      render(<RegistrationCard patient={mockPatient} />)
      expect(screen.getAllByText(mockPatient.full_name).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(mockPatient.urn).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(mockPatient.mobile).length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('DemographicCorrectionModal (Diff Viewer & Confirmation)', () => {
    const proposed = {
      full_name: 'Corrected Patient Name',
      guardian_name: 'Original Guardian',
      gender: 'F' as const,
      dob: '1990-01-01',
      age_years: 36,
      mobile: '9123456789',
      address: '999 New Street, Extended Multi-line Address for Testing Break Words Overflow Prevention',
      district: 'Patna',
      state: 'Bihar',
      emergency_contact: '9876500000',
    }

    it('renders side-by-side diff table with Modified tags and callout notice', () => {
      render(
        <DemographicCorrectionModal
          open={true}
          patient={mockPatient}
          proposed={proposed}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      expect(
        screen.getByText(
          'Demographic corrections update future patient documents, but historical printouts retain their issued details.',
        ),
      ).toBeInTheDocument()

      // Full Name changed
      expect(screen.getAllByText('Original Patient Name').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Corrected Patient Name')).toBeInTheDocument()

      // Gender changed (M -> F)
      expect(screen.getByText('Male')).toBeInTheDocument()
      expect(screen.getByText('Female')).toBeInTheDocument()

      // Modified badges
      const modifiedBadges = screen.getAllByText('Modified')
      expect(modifiedBadges.length).toBeGreaterThanOrEqual(4)
    })

    it('enforces mandatory reason >= 5 characters before confirmation', () => {
      render(
        <DemographicCorrectionModal
          open={true}
          patient={mockPatient}
          proposed={proposed}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      const applyBtn = screen.getByRole('button', { name: 'Apply Demographic Correction' })
      fireEvent.click(applyBtn)

      expect(
        screen.getByText('Demographic correction requires a documented reason of at least 5 characters.'),
      ).toBeInTheDocument()

      // Enter 4 chars (still invalid)
      const reasonInput = screen.getByLabelText(/Reason for Demographic Correction/i)
      fireEvent.change(reasonInput, { target: { value: 'Fix!' } })
      fireEvent.click(applyBtn)
      expect(
        screen.getByText('Demographic correction requires a documented reason of at least 5 characters.'),
      ).toBeInTheDocument()

      // Enter valid reason (>= 5 chars)
      fireEvent.change(reasonInput, { target: { value: 'Aadhaar matching correction per patient request' } })
      fireEvent.click(applyBtn)

      // Opens destructive confirmation modal with exact copywriting contract text
      expect(screen.getByText(/Are you sure you want to update the official demographic record for/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirm Demographic Correction' })).toBeInTheDocument()
    })
  })

  describe('PatientCorrectionPage Workspace', () => {
    it('searches for patients and renders empty state on zero matches', async () => {
      mockSearchResults = []
      renderWithClient(<PatientCorrectionPage />)

      const searchInput = screen.getByPlaceholderText(/Search by URN/i)
      fireEvent.change(searchInput, { target: { value: 'NONEXISTENT' } })
      fireEvent.click(screen.getByRole('button', { name: 'Search Patients' }))

      await waitFor(() => {
        expect(screen.getByText('No Matching Patients Found')).toBeInTheDocument()
        expect(
          screen.getByText(/No registered patient matches the search query/i),
        ).toBeInTheDocument()
      })
    })

    it('loads patient into workspace with locked URN and read-only allergies', async () => {
      mockSearchResults = [mockPatient]
      renderWithClient(<PatientCorrectionPage />)

      const searchInput = screen.getByPlaceholderText(/Search by URN/i)
      fireEvent.change(searchInput, { target: { value: 'KH-2026' } })
      fireEvent.click(screen.getByRole('button', { name: 'Search Patients' }))

      await waitFor(() => {
        expect(screen.getByText(mockPatient.full_name)).toBeInTheDocument()
      })

      // Select patient
      fireEvent.click(screen.getByText(mockPatient.full_name))

      // URN input is disabled/locked
      const urnInput = screen.getByLabelText(/Patient URN \(Immutable\)/i) as HTMLInputElement
      expect(urnInput).toBeDisabled()
      expect(urnInput.value).toBe(mockPatient.urn)

      // Allergies notice is visible
      expect(
        screen.getByText(/Clinical allergies and consultation notes are managed by reception and doctors/i),
      ).toBeInTheDocument()

      // Form values are populated
      const nameInput = screen.getByLabelText(/^Full Name/i) as HTMLInputElement
      expect(nameInput.value).toBe(mockPatient.full_name)
    })

    it('mounts ConflictBanner with Reload Patient Record on HTTP 409 concurrency error', async () => {
      mockSearchResults = [mockPatient]
      mutateCorrect.mockRejectedValueOnce(
        new ApiError(409, 'version_conflict', 'Patient demographics were updated in another session.'),
      )

      renderWithClient(<PatientCorrectionPage />)

      // Search & select
      const searchInput = screen.getByPlaceholderText(/Search by URN/i)
      fireEvent.change(searchInput, { target: { value: 'KH-2026' } })
      fireEvent.click(screen.getByRole('button', { name: 'Search Patients' }))
      await waitFor(() => screen.getByText(mockPatient.full_name))
      fireEvent.click(screen.getByText(mockPatient.full_name))

      // Edit name to enable submit
      const nameInput = screen.getByLabelText(/^Full Name/i)
      fireEvent.change(nameInput, { target: { value: 'Changed Name' } })

      // Open review modal
      fireEvent.click(screen.getByRole('button', { name: 'Apply Demographic Correction' }))

      // In modal, enter reason and confirm
      const reasonInput = screen.getByLabelText(/Reason for Demographic Correction/i)
      fireEvent.change(reasonInput, { target: { value: 'Valid correction reason here' } })
      fireEvent.click(screen.getByTestId('modal-apply-correction-button'))

      // Click final confirmation
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Demographic Correction' }))

      // ConflictBanner must mount with Reload Patient Record action
      await waitFor(() => {
        expect(
          screen.getByText('Patient demographics were updated in another session.'),
        ).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Reload Patient Record' })).toBeInTheDocument()
      })
    })
  })
})
