import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PatientRegister } from '../PatientRegister'
import type { DuplicateCheckResponse, Me, PatientOut } from '../../api/types'

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  permissions: ['patients:read', 'patients:create'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const mockRegisteredPatient: PatientOut = {
  id: 101,
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
  allergies: 'Penicillin',
  notes: 'Referred by Dr. Sharma',
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

describe('Patient Registration Screen', () => {
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

  it('renders all 12 canonical demographic fields with accessible inputs', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientRegister />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText(/Full Name \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Father \/ Guardian/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Gender \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Date of Birth/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Age \(Years\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Mobile Number \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Address \(Village/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/District \*/i)).toHaveValue('Bhojpur')
    expect(screen.getByLabelText(/State \*/i)).toHaveValue('Bihar')
    expect(screen.getByLabelText(/Emergency Contact/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Allergies \*/i)).toHaveValue('None reported')
    expect(screen.getByLabelText(/Clinical \/ Administrative Notes/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Patient Photograph/i)).toBeInTheDocument()
  })

  it('submits patient registration and displays the generated URN', async () => {
    let capturedBody: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/patients/check-duplicate')) {
        const noDup: DuplicateCheckResponse = { has_duplicate: false, matching_patient: null }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(noDup)),
        })
      }
      if (url.includes('/api/patients') && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string)
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockRegisteredPatient)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientRegister />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText(/Full Name \*/i), 'Aarav Kumar')
    await user.type(screen.getByLabelText(/Father \/ Guardian/i), 'Suresh Kumar')
    await user.type(screen.getByLabelText(/Mobile Number \*/i), '9876543210')
    await user.type(screen.getByLabelText(/Age \(Years\)/i), '30')
    await user.type(screen.getByLabelText(/Address \(Village/i), 'Main Bazaar, Ara')

    const submitBtn = screen.getByRole('button', { name: /register patient/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('Registration Successful!')).toBeInTheDocument()
    })

    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect((capturedBody as any)?.full_name).toBe('Aarav Kumar')
    expect((capturedBody as any)?.mobile).toBe('9876543210')
  })

  it('shows duplicate warning when duplicate match is found and requires override check', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/patients/check-duplicate')) {
        const dupResult: DuplicateCheckResponse = {
          has_duplicate: true,
          matching_patient: mockRegisteredPatient,
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(dupResult)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientRegister />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText(/Full Name \*/i), 'Aarav Kumar')
    await user.type(screen.getByLabelText(/Mobile Number \*/i), '9876543210')

    await waitFor(() => {
      expect(screen.getByText('Potential Duplicate Patient Detected')).toBeInTheDocument()
    })

    const submitButton = screen.getByRole('button', { name: /register patient/i })
    expect(submitButton).toBeDisabled()

    // Check the confirmation checkbox
    const overrideCheckbox = screen.getByLabelText(/Confirm this is a different patient/i)
    await user.click(overrideCheckbox)

    // Button should now be enabled
    expect(submitButton).toBeEnabled()
  })
})
