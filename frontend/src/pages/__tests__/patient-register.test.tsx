import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.restoreAllMocks()
    // jsdom has no object URLs; number them so each preview can be told apart.
    let previewCount = 0
    URL.createObjectURL = vi.fn(() => `blob:http://localhost/preview-${++previewCount}`)
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    Reflect.deleteProperty(globalThis.navigator, 'mediaDevices')
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

  // The server CSP is "img-src 'self' blob:". A data: preview is blocked there, so the
  // photo frame stayed empty after a capture and the photo looked as if it was not kept.
  it('previews the chosen photo with a blob: URL the server CSP allows, never a data: URL', async () => {
    stubRegistrationApi({ photoFails: false })
    const user = userEvent.setup()
    renderPage()

    const first = new File(['jpeg-bytes'], 'face.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Patient Photograph'), first)

    const preview = await screen.findByRole('img', { name: 'Patient preview' })
    expect(URL.createObjectURL).toHaveBeenCalledWith(first)
    expect(preview.getAttribute('src')).toBe('blob:http://localhost/preview-1')

    // Replacing the photo releases the previous object URL.
    const second = new File(['other-jpeg-bytes'], 'face-2.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Patient Photograph'), second)
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Patient preview' }).getAttribute('src')).toBe(
        'blob:http://localhost/preview-2',
      )
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/preview-1')

    // Removing the photo releases the current one and empties the frame.
    await user.click(screen.getByRole('button', { name: /^remove$/i }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/preview-2')
    expect(screen.queryByRole('img', { name: 'Patient preview' })).not.toBeInTheDocument()
  })

  it('keeps a webcam capture on the form and uploads it when the registration is saved', async () => {
    stubRegistrationApi({ photoFails: false })
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
      writable: true,
      configurable: true,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['snapshot-jpeg-data'], { type: 'image/jpeg' }))
    })

    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByTitle('Click to capture or upload patient photo'))
    await user.click(screen.getByRole('button', { name: /capture with webcam/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /take snapshot/i })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: /take snapshot/i }))
    await user.click(await screen.findByRole('button', { name: /use this photo/i }))

    // The capture is now shown in the form's photo frame through a CSP-allowed URL.
    const preview = await screen.findByRole('img', { name: 'Patient preview' })
    expect(preview.getAttribute('src')).toMatch(/^blob:/)

    await user.click(screen.getByRole('button', { name: /register patient/i }))
    await waitFor(() => {
      expect(screen.getByText('Registration Successful!')).toBeInTheDocument()
    })

    const photoCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url).includes('/photo') && init?.method === 'POST')
    const photoBody = photoCall?.[1]?.body
    expect(photoBody).toBeInstanceOf(FormData)
    const sent = (photoBody as FormData).get('file')
    expect(sent).toBeInstanceOf(File)
    expect((sent as File).type).toBe('image/jpeg')
    expect(await (sent as File).text()).toBe('snapshot-jpeg-data')
    expect(screen.queryByText('Patient saved, but the photo was not uploaded.')).not.toBeInTheDocument()
  })
})

describe('Registration form in edit mode (/reception/patients/:id/edit)', () => {
  let queryClient: QueryClient
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.restoreAllMocks()
    let previewCount = 0
    URL.createObjectURL = vi.fn(() => `blob:http://localhost/edit-preview-${++previewCount}`)
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  const jsonRes = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  })

  interface Recorded {
    method: string
    url: string
  }

  function stubEditApi(
    options: {
      patient?: PatientOut
      photoFailsFirst?: boolean
      loadStatus?: number
    } = {},
  ) {
    const patient = options.patient ?? mockRegisteredPatient
    const requests: Recorded[] = []
    const patches: Record<string, unknown>[] = []
    let photoAttempts = 0
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url })
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(200, mockMe))
      if (url.includes('/api/patients/101/photo') && method === 'POST') {
        photoAttempts += 1
        if (options.photoFailsFirst && photoAttempts === 1) {
          return Promise.resolve(jsonRes(500, { message: 'disk full' }))
        }
        return Promise.resolve(jsonRes(200, { photo_path: 'p.jpg' }))
      }
      if (url.includes('/api/patients/101') && method === 'PATCH') {
        const body = JSON.parse(init?.body as string) as Record<string, unknown>
        patches.push(body)
        return Promise.resolve(jsonRes(200, { ...patient, ...body, version_id: patient.version_id + 1 }))
      }
      if (url.includes('/api/patients/101')) {
        if (options.loadStatus && options.loadStatus >= 400) {
          return Promise.resolve(jsonRes(options.loadStatus, { code: 'not_found', message: 'Patient #101 not found' }))
        }
        return Promise.resolve(jsonRes(200, patient))
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)
    return { requests, patches }
  }

  function RecordStub() {
    const { state } = useLocation()
    const notice = (state as { notice?: string } | null)?.notice ?? ''
    return <div>Patient record page. {notice}</div>
  }

  function renderEdit(path = '/reception/patients/101/edit') {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/reception/patients/:id/edit" element={<PatientRegister />} />
            <Route path="/reception/patients/:id" element={<RecordStub />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('opens pre-filled with the saved details and the URN, without visit or token booking', async () => {
    stubEditApi()
    renderEdit()

    expect(await screen.findByRole('heading', { name: 'Edit Patient Details' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Full Name \*/i)).toHaveValue('Aarav Kumar')
    expect(screen.getByLabelText(/Father \/ Guardian/i)).toHaveValue('Suresh Kumar')
    expect(screen.getByLabelText('Gender *')).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Female' })).not.toBeChecked()
    expect(screen.getByLabelText(/Date of Birth/i)).toHaveValue('1995-05-15')
    expect(screen.getByLabelText(/Age \(Years\)/i)).toHaveValue(30)
    expect(screen.getByLabelText(/Mobile Number \*/i)).toHaveValue('9876543210')
    expect(screen.getByLabelText(/Address \(Village/i)).toHaveValue('Main Bazaar, Ara')
    expect(screen.getByLabelText(/District \*/i)).toHaveValue('Bhojpur')
    expect(screen.getByLabelText(/State \*/i)).toHaveValue('Bihar')
    expect(screen.getByLabelText(/Emergency Contact/i)).toHaveValue('9876500000')
    expect(screen.getByLabelText(/Allergies \*/i)).toHaveValue('Penicillin')
    expect(screen.getByLabelText(/Clinical \/ Administrative Notes/i)).toHaveValue('Referred by Dr. Sharma')
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()

    // Registration-only parts are absent
    expect(screen.queryByLabelText(/Department/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Save and add another/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /register patient/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  })

  it('saves with PATCH and the loaded version_id, clears optional fields with empty strings, and returns to the record', async () => {
    const { requests, patches } = stubEditApi()
    const user = userEvent.setup()
    renderEdit()

    await screen.findByRole('heading', { name: 'Edit Patient Details' })
    await user.clear(screen.getByLabelText(/Emergency Contact/i))
    await user.clear(screen.getByLabelText(/Clinical \/ Administrative Notes/i))
    await user.clear(screen.getByLabelText(/Address \(Village/i))
    await user.type(screen.getByLabelText(/Address \(Village/i), 'New Colony, Ara')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const record = await screen.findByText(/Patient record page\./)
    expect(record).toHaveTextContent('Patient details updated successfully.')

    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      version_id: 1,
      full_name: 'Aarav Kumar',
      guardian_name: 'Suresh Kumar',
      gender: 'M',
      dob: '1995-05-15',
      age_years: 30,
      mobile: '9876543210',
      address: 'New Colony, Ara',
      allergies: 'Penicillin',
      // '' clears on the server; null would silently keep the old value
      emergency_contact: '',
      notes: '',
    })
    // Never a second registration, a duplicate check, or a visit booking
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)
    expect(requests.some((r) => r.url.includes('check-duplicate'))).toBe(false)
    expect(requests.some((r) => r.url.includes('appointments'))).toBe(false)
  })

  it('shows the photo on file, uploads a newly chosen photo after the details, and Discard goes back to the saved one', async () => {
    const { requests } = stubEditApi({ patient: { ...mockRegisteredPatient, photo_path: 'abc.jpg' } })
    const user = userEvent.setup()
    renderEdit()

    await screen.findByRole('heading', { name: 'Edit Patient Details' })
    const preview = () => screen.getByRole('img', { name: 'Patient preview' })
    expect(preview().getAttribute('src')).toBe('/api/patients/101/photo')
    // The saved photo can be replaced but not deleted here
    expect(screen.queryByRole('button', { name: /remove|discard new photo/i })).not.toBeInTheDocument()

    const photo = new File(['new-jpeg-bytes'], 'new-face.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Patient Photograph'), photo)
    await waitFor(() => {
      expect(preview().getAttribute('src')).toMatch(/^blob:/)
    })

    await user.click(screen.getByRole('button', { name: /discard new photo/i }))
    expect(preview().getAttribute('src')).toBe('/api/patients/101/photo')

    await user.upload(screen.getByLabelText('Patient Photograph'), photo)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const record = await screen.findByText(/Patient record page\./)
    expect(record).toHaveTextContent('Patient details updated successfully.')
    const writes = requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`)
    expect(writes).toEqual(['PATCH /api/patients/101', 'POST /api/patients/101/photo'])
  })

  it('keeps the saved details when the photo upload fails, offers a retry, and returns to the record once it works', async () => {
    const { requests, patches } = stubEditApi({ photoFailsFirst: true })
    const user = userEvent.setup()
    renderEdit()

    await screen.findByRole('heading', { name: 'Edit Patient Details' })
    await user.upload(
      screen.getByLabelText('Patient Photograph'),
      new File(['jpeg-bytes'], 'face.jpg', { type: 'image/jpeg' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Patient saved, but the photo was not uploaded.')
    expect(alert).toHaveTextContent('disk full')
    // Still on the form, and the details are not saved a second time
    expect(screen.getByRole('heading', { name: 'Edit Patient Details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /retry photo upload/i }))

    const record = await screen.findByText(/Patient record page\./)
    expect(record).toHaveTextContent('Patient details and photo updated successfully.')
    expect(patches).toHaveLength(1)
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2)
  })

  it('Continue without photo returns to the record and says the photo was not saved', async () => {
    stubEditApi({ photoFailsFirst: true })
    const user = userEvent.setup()
    renderEdit()

    await screen.findByRole('heading', { name: 'Edit Patient Details' })
    await user.upload(
      screen.getByLabelText('Patient Photograph'),
      new File(['jpeg-bytes'], 'face.jpg', { type: 'image/jpeg' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await user.click(await screen.findByRole('button', { name: /continue without photo/i }))

    const record = await screen.findByText(/Patient record page\./)
    expect(record).toHaveTextContent('The new photo was not saved.')
  })

  it('warns before unloading only once something has changed from the saved record', async () => {
    stubEditApi()
    const user = userEvent.setup()
    renderEdit()
    await screen.findByRole('heading', { name: 'Edit Patient Details' })

    const untouched = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(untouched)
    expect(untouched.defaultPrevented).toBe(false)

    await user.type(screen.getByLabelText(/Full Name \*/i), ' Jr')
    const changed = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(changed)
    expect(changed.defaultPrevented).toBe(true)
  })

  it('refuses to clear a recorded date of birth instead of silently keeping it', async () => {
    const { patches } = stubEditApi()
    const user = userEvent.setup()
    renderEdit()
    await screen.findByRole('heading', { name: 'Edit Patient Details' })

    fireEvent.change(screen.getByLabelText(/Date of Birth/i), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('date of birth cannot be removed')
    expect(patches).toHaveLength(0)
  })

  it('keeps a record saved as Other selectable as Other', async () => {
    stubEditApi({ patient: { ...mockRegisteredPatient, gender: 'O' } })
    renderEdit()
    await screen.findByRole('heading', { name: 'Edit Patient Details' })

    expect(screen.getByRole('radio', { name: 'Other' })).toBeChecked()
    expect(screen.getByLabelText('Gender *')).not.toBeChecked()
  })

  it('says so, with a way back, when the patient cannot be loaded or the id is invalid', async () => {
    stubEditApi({ loadStatus: 404 })
    const { unmount } = renderEdit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load patient: Patient #101 not found')
    expect(screen.getByRole('link', { name: /back to patient records/i })).toHaveAttribute('href', '/reception/patients')
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
    unmount()

    renderEdit('/reception/patients/abc/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid patient ID.')
  })
})
