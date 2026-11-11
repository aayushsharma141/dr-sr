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

    expect(screen.getAllByText('KH-2026-0001')[0]).toBeInTheDocument()
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

describe('Registration desk: no second submit and no silent step failures (BR-007, BR-008)', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const jsonResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  })

  function stubRegistrationApi(options: { photoFails: boolean; photoRetrySucceeds?: boolean }) {
    const postedPatients: unknown[] = []
    let photoAttempts = 0
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(200, mockMe))
      if (url.includes('/api/patients/check-duplicate')) {
        const noDup: DuplicateCheckResponse = { has_duplicate: false, matching_patient: null }
        return Promise.resolve(jsonResponse(200, noDup))
      }
      if (url.includes('/photo') && init?.method === 'POST') {
        photoAttempts += 1
        const fails = options.photoFails && !(photoAttempts > 1 && options.photoRetrySucceeds)
        if (fails) return Promise.resolve(jsonResponse(500, { message: 'disk full' }))
        return Promise.resolve(jsonResponse(200, { photo_path: 'p.jpg' }))
      }
      if (url.includes('/api/patients') && init?.method === 'POST') {
        postedPatients.push(JSON.parse(init.body as string))
        return Promise.resolve(jsonResponse(201, mockRegisteredPatient))
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)
    return { postedPatients }
  }

  async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Full Name \*/i), 'Aarav Kumar')
    await user.type(screen.getByLabelText(/Mobile Number \*/i), '9876543210')
    await user.type(screen.getByLabelText(/Age \(Years\)/i), '30')
    await user.type(screen.getByLabelText(/Address \(Village/i), 'Main Bazaar, Ara')
  }

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientRegister />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('does not allow a second registration while the saved patient card is shown', async () => {
    const { postedPatients } = stubRegistrationApi({ photoFails: false })
    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: /register patient/i }))
    await waitFor(() => {
      expect(screen.getByText('Registration Successful!')).toBeInTheDocument()
    })

    const submitAgain = screen.getByRole('button', { name: /register patient/i })
    expect(submitAgain).toBeDisabled()
    // Pressing Enter in a field must not submit either.
    const nameField = screen.getByLabelText(/Full Name \*/i)
    nameField.focus()
    await user.keyboard('{Enter}')

    expect(postedPatients).toHaveLength(1)
  })

  it('reports a failed photo upload with a retry action instead of a clean success', async () => {
    stubRegistrationApi({ photoFails: true })
    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)

    const photo = new File(['jpeg-bytes'], 'face.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Patient Photograph'), photo)

    await user.click(screen.getByRole('button', { name: /register patient/i }))
    await waitFor(() => {
      expect(screen.getByText('Patient Registered — Photo Pending')).toBeInTheDocument()
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Patient saved, but the photo was not uploaded.')
    expect(alert).toHaveTextContent('face.jpg')
    expect(screen.getByRole('button', { name: /retry photo upload/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue without photo/i })).toBeInTheDocument()
    expect(screen.queryByText('Registration Successful!')).not.toBeInTheDocument()
  })

  it('retries the photo and reports success without registering the patient twice', async () => {
    const { postedPatients } = stubRegistrationApi({ photoFails: true, photoRetrySucceeds: true })
    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)

    const photo = new File(['jpeg-bytes'], 'face.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Patient Photograph'), photo)

    await user.click(screen.getByRole('button', { name: /register patient/i }))
    const retry = await screen.findByRole('button', { name: /retry photo upload/i })
    await user.click(retry)

    await waitFor(() => {
      expect(screen.getByText('Photo uploaded and saved to the patient record.')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Registration Successful!')).toBeInTheDocument()
    expect(postedPatients).toHaveLength(1)
  })

  it('warns before unloading once the registration form has input', async () => {
    stubRegistrationApi({ photoFails: false })
    const user = userEvent.setup()
    renderPage()

    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await user.type(screen.getByLabelText(/Full Name \*/i), 'Aarav')

    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('opens photo selection popup with webcam and upload options when receptionist clicks photo box', async () => {
    stubRegistrationApi({ photoFails: false })
    const user = userEvent.setup()
    renderPage()

    const photoBox = screen.getByTitle('Click to capture or upload patient photo')
    await user.click(photoBox)

    expect(screen.getByRole('heading', { name: 'Add Patient Photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /capture with webcam/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload from computer/i })).toBeInTheDocument()
  })
})
