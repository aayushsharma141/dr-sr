import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenGenerationPage } from '../TokenGenerationPage'
import { QueueTicketPreview } from '../../components/QueueTicketPreview'
import type { Me, PatientOut, DepartmentOut, DepartmentDoctorOut, Appointment } from '../../api/types'

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  permissions: ['patients:read', 'appointments:create', 'appointments:read', 'appointments:update'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const mockPatient: PatientOut = {
  id: 101,
  urn: 'KH-2026-0001',
  full_name: 'Ramesh Kumar',
  guardian_name: 'Ram Kumar',
  gender: 'M',
  dob: null,
  age_years: 45,
  mobile: '9876543210',
  address: 'Station Road, Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: null,
  allergies: 'None',
  notes: null,
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockDepartments: DepartmentOut[] = [
  {
    id: 1,
    name_en: 'Physiotherapy',
    name_hi: 'फिजियोथेरेपी',
    description: null,
    is_active: true,
    version_id: 1,
  },
]

const mockDoctors: DepartmentDoctorOut[] = [
  {
    id: 10,
    name_en: 'Dr. Anil Kumar',
    name_hi: 'डॉ अनिल कुमार',
    qualification: 'BPT, MPT',
    default_fee_paise: 40000,
  },
]

const mockAppointments: { appointments: Appointment[]; total: number } = {
  appointments: [
    {
      id: 201,
      patient_id: 99,
      patient_name: 'Prior Patient',
      patient_urn: 'KH-2026-0000',
      patient_mobile: '9876500000',
      doctor_id: 10,
      doctor_name_en: 'Dr. Anil Kumar',
      doctor_name_hi: 'डॉ अनिल कुमार',
      appointment_date: '2026-11-06',
      token_number: 13,
      status: 'ARRIVED',
      status_updated_at: '2026-11-06T09:00:00Z',
      cancellation_reason: null,
      notes: null,
      version_id: 1,
      created_at: '2026-11-06T09:00:00Z',
      updated_at: '2026-11-06T09:00:00Z',
    },
  ],
  total: 1,
}

describe('QueueTicketPreview Component', () => {
  it('renders notched ticket with monotonic token format and doctor queue stats', () => {
    render(
      <QueueTicketPreview
        departmentName="Physiotherapy"
        doctorName="Dr. Anil Kumar"
        tokenPrefix="P"
        tokenNumber={14}
        patientName="Ramesh Kumar"
        patientUrn="KH-2026-0001"
        waitingCount={5}
        nextToken={14}
      />,
    )

    expect(screen.getByText('Kalyan Hospital')).toBeInTheDocument()
    expect(screen.getByText('Physiotherapy')).toBeInTheDocument()
    expect(screen.getByTestId('token-preview-number')).toHaveTextContent('P-014')
    expect(screen.getByText('Ramesh Kumar')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect(screen.getByText(/Current Queue \(Dr. Anil Kumar\)/i)).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})

describe('TokenGenerationPage Cockpit', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders 3-column front desk cockpit and handles full token generation workflow', async () => {
    let bookedPayload: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/departments') && !url.includes('/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDepartments)),
        })
      }
      if (url.includes('/api/departments/1/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/patients') && !url.includes('check-duplicate') && init?.method !== 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockPatient])),
        })
      }
      if (url.includes('/api/appointments') && init?.method === 'POST') {
        bookedPayload = JSON.parse(init.body as string)
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 501,
                patient_id: 101,
                patient_name: 'Ramesh Kumar',
                patient_urn: 'KH-2026-0001',
                doctor_id: 10,
                doctor_name: 'Dr. Anil Kumar',
                appointment_date: '2026-11-06',
                token_number: 14,
                status: 'SCHEDULED',
                notes: null,
                created_by: 2,
                created_at: '2026-11-06T10:00:00Z',
                version_id: 1,
              }),
            ),
        })
      }
      if (url.includes('/api/appointments/501/status') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 501,
                status: 'ARRIVED',
                version_id: 2,
              }),
            ),
        })
      }
      if (url.includes('/api/appointments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockAppointments)),
        })
      }
      if (url.includes('/api/fees')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', mockFetch)
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TokenGenerationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Verify Title & Cockpit Columns
    expect(screen.getByRole('heading', { name: /Register Visit & Generate Token/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Patient' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Visit Details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Token Preview' })).toBeInTheDocument()

    // 1. Search and Select Patient
    const searchInput = screen.getByPlaceholderText(/Search by Name, Mobile or Patient ID/i)
    await user.type(searchInput, 'Ramesh')

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })

    const selectPatientBtn = screen.getByRole('button', { name: /Ramesh Kumar KH-2026-0001 9876543210/i })
    await user.click(selectPatientBtn)

    // Patient card should now be displayed
    await waitFor(() => {
      expect(screen.getByText('Existing')).toBeInTheDocument()
    })

    // 2. Select Department
    const deptSelect = screen.getByLabelText(/Department \*/i)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Physiotherapy' })).toBeInTheDocument()
    })
    await user.selectOptions(deptSelect, '1')

    // 3. Select Doctor
    const docSelect = screen.getByLabelText(/Doctor \*/i)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Dr\. Anil Kumar/i })).toBeInTheDocument()
    })
    await user.selectOptions(docSelect, '10')

    // 4. Generate Token & Register Visit
    const generateBtn = screen.getByRole('button', { name: /Generate Token & Register Visit/i })
    expect(generateBtn).toBeEnabled()
    await user.click(generateBtn)

    // Verify Success Banner and token
    await waitFor(() => {
      expect(screen.getByText(/Token Allocated Successfully!/i)).toBeInTheDocument()
    })
    expect(screen.getByText('#14')).toBeInTheDocument()

    // Assert API call payload
    expect(bookedPayload).toEqual({
      patient_id: 101,
      department_id: 1,
      doctor_id: 10,
      appointment_date: expect.any(String),
      notes: null,
    })
  })
})
