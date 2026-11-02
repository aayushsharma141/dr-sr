import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrescriptionWorkspace } from '../PrescriptionWorkspace'
import type { Me, PatientOut, PrescriptionOut } from '../../api/types'

const mockMeDoctor: Me = {
  id: 3,
  username: 'doctor',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['prescription:read', 'prescription:write', 'dashboard:doctor'],
  version_id: 1,
}

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
  allergies: 'None',
  notes: 'None',
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockCreatedPrescription: PrescriptionOut = {
  id: 50,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  encounter_id: null,
  diagnosis: 'Acute Cervical Strain',
  dietary_advice: 'Drink warm water',
  general_advice: 'Avoid heavy lifting',
  follow_up_date: '2026-11-10',
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  items: [
    {
      id: 1,
      prescription_id: 50,
      item_order: 1,
      medicine_name: 'Tab Aceclofenac',
      dosage: '100 mg',
      frequency: '1-0-1',
      duration_days: 5,
      instructions: 'After food',
    },
    {
      id: 2,
      prescription_id: 50,
      item_order: 2,
      medicine_name: 'Tab Thiocolchicoside',
      dosage: '4 mg',
      frequency: '1-0-1',
      duration_days: 5,
      instructions: 'After dinner',
    },
  ],
}

describe('Prescription Workspace & Print Slip', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
    vi.spyOn(window, 'print').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders patient demographic info and dynamic medication row controls', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/patients/101/prescriptions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (url.includes('/api/patients/101')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatient)),
        })
      }
      if (url.includes('/api/settings/clinic')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ clinic_name_en: 'Kalyan Hospital' })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/prescriptions/new?patient_id=101']}>
          <Routes>
            <Route path="/doctor/prescriptions/new" element={<PrescriptionWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Patient info banner rendered
    await waitFor(() => {
      expect(screen.getByText(/Aarav Kumar/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/KH-2026-0001/i)).toBeInTheDocument()

    // Default 1 medication row present
    const rows = screen.getAllByPlaceholderText(/e\.g\. Tab Pregabalin/i)
    expect(rows).toHaveLength(1)

    // Add a second medication row
    const addBtn = screen.getByText(/\+ Add Medication/i)
    await userEvent.click(addBtn)

    const updatedRows = screen.getAllByPlaceholderText(/e\.g\. Tab Pregabalin/i)
    expect(updatedRows).toHaveLength(2)

    // Remove the second row
    const removeButtons = screen.getAllByTitle('Remove item')
    expect(removeButtons).toHaveLength(2)
    await userEvent.click(removeButtons[1])

    expect(screen.getAllByPlaceholderText(/e\.g\. Tab Pregabalin/i)).toHaveLength(1)
  })

  it('submits prescription and opens bilingual print preview modal', async () => {
    let capturedBody: any = null

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/patients/101/prescriptions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (url.includes('/api/patients/101')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatient)),
        })
      }
      if (url.includes('/api/settings/clinic')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                clinic_name_en: 'Kalyan Hospital & Rehabilitation Centre',
                clinic_name_hi: 'कल्याण अस्पताल',
              }),
            ),
        })
      }
      if (url.endsWith('/api/prescriptions') && opts?.method === 'POST') {
        capturedBody = JSON.parse(opts.body)
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockCreatedPrescription)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/prescriptions/new?patient_id=101']}>
          <Routes>
            <Route path="/doctor/prescriptions/new" element={<PrescriptionWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Aarav Kumar/i)).toBeInTheDocument()
    })

    // Fill in diagnosis
    const diagnosisInput = screen.getByPlaceholderText(/e\.g\. Lumbar Canal Stenosis/i)
    await userEvent.type(diagnosisInput, 'Acute Cervical Strain')

    // Fill in medicine name & dosage
    const medNameInput = screen.getByPlaceholderText(/e\.g\. Tab Pregabalin/i)
    await userEvent.type(medNameInput, 'Tab Aceclofenac')

    const dosageInput = screen.getByPlaceholderText('75 mg')
    await userEvent.type(dosageInput, '100 mg')

    // Submit form
    const submitBtn = screen.getByText(/Issue Prescription/i)
    await userEvent.click(submitBtn)

    // Verify payload sent to backend
    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })
    expect(capturedBody.diagnosis).toBe('Acute Cervical Strain')
    expect(capturedBody.patient_id).toBe(101)
    expect(capturedBody.items[0].medicine_name).toBe('Tab Aceclofenac')

    // Verify PrescriptionPrint modal displayed
    await waitFor(() => {
      expect(screen.getByText(/Print Prescription Slip/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Prescribed Medications \(दवा का विवरण\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Tab Aceclofenac/i)).toBeInTheDocument()

    // Trigger window.print()
    const printBtn = screen.getByText(/Print Prescription Slip/i)
    await userEvent.click(printBtn)
    expect(window.print).toHaveBeenCalled()

    // Close modal
    const closeBtn = screen.getByText(/Close \(बंद करें\)/i)
    await userEvent.click(closeBtn)
    expect(screen.queryByText(/Print Prescription Slip/i)).not.toBeInTheDocument()
  })
})
