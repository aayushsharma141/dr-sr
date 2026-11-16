import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenGenerationPage } from '../TokenGenerationPage'
import { QueueTicketPreview } from '../../components/QueueTicketPreview'
import { istToday } from '../../format'
import type { Me, PatientOut, DepartmentOut, DepartmentDoctorOut, Appointment } from '../../api/types'

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  permissions: ['patient:read', 'patient:create', 'appointment:read', 'appointment:write', 'visit:read', 'visit:write'],
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
    code: 'PHYSIOTHERAPY',
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

/** A booking for Ramesh made by phone, still waiting for him; it has no token yet. */
const rameshBooking: Appointment = {
  id: 501,
  patient_id: 101,
  patient_name: 'Ramesh Kumar',
  patient_urn: 'KH-2026-0001',
  patient_mobile: '9876543210',
  doctor_id: 10,
  doctor_name_en: 'Dr. Anil Kumar',
  doctor_name_hi: null,
  department_id: 1,
  appointment_date: istToday(),
  token_number: null,
  status: 'BOOKED',
  consultation_status: null,
  status_updated_at: '2026-11-06T09:00:00Z',
  cancellation_reason: null,
  notes: null,
  expected_time: '10:30:00',
  source: 'PHONE',
  priority_level: 'NORMAL',
  version_id: 1,
  created_at: '2026-11-06T09:00:00Z',
  updated_at: '2026-11-06T09:00:00Z',
}

/** What the server returns once a patient is checked in. */
const checkedIn: Appointment = {
  ...rameshBooking,
  token_number: 14,
  status: 'ARRIVED',
  consultation_status: 'WAITING',
  visit_id: 77,
  visit_kind: 'NEW',
  referral_source: 'SELF',
  version_id: 2,
}

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  text: () => Promise.resolve(JSON.stringify(body)),
})

interface Write {
  method: string
  url: string
  body: Record<string, unknown> | null
}

/**
 * A fake API for the check-in desk. `today` is the day's appointment list on the right;
 * `bookings` what GET /appointments returns for the selected patient; `write` answers writes.
 */
function installApi(options: {
  today?: Appointment[]
  bookings?: Appointment[]
  duplicate?: PatientOut | null
  write?: (url: string, method: string) => ReturnType<typeof jsonResponse>
}) {
  const writes: Write[] = []
  const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      writes.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : null })
      return Promise.resolve(options.write?.(url, method) ?? jsonResponse(500, { message: 'unexpected write' }))
    }
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(200, mockMe))
    if (url.includes('/api/departments/1/doctors')) return Promise.resolve(jsonResponse(200, mockDoctors))
    if (url.includes('/api/departments')) return Promise.resolve(jsonResponse(200, mockDepartments))
    if (url.includes('/api/patients/check-duplicate'))
      return Promise.resolve(
        jsonResponse(200, { has_duplicate: options.duplicate != null, matching_patient: options.duplicate ?? null }),
      )
    if (/\/api\/patients\/101$/.test(url)) return Promise.resolve(jsonResponse(200, mockPatient))
    if (url.includes('/api/patients')) return Promise.resolve(jsonResponse(200, [mockPatient]))
    if (/\/api\/appointments\/501$/.test(url)) return Promise.resolve(jsonResponse(200, rameshBooking))
    if (url.includes('/api/appointments') && url.includes('patient_id=101'))
      return Promise.resolve(
        jsonResponse(200, { appointments: options.bookings ?? [], total: options.bookings?.length ?? 0 }),
      )
    if (url.includes('/api/appointments'))
      return Promise.resolve(jsonResponse(200, { appointments: options.today ?? [], total: options.today?.length ?? 0 }))
    return Promise.reject(new Error(`Unhandled URL: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)
  return { writes }
}

function renderDesk(route = '/reception/tokens') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <TokenGenerationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

type User = ReturnType<typeof userEvent.setup>

async function chooseDoctor(user: User) {
  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Dr\. Anil Kumar/ })).toBeInTheDocument()
  })
  await user.selectOptions(screen.getByLabelText(/Consulting doctor \*/i), '1:10')
}

async function fillNewPatient(user: User) {
  await user.type(screen.getByLabelText(/Patient name \*/i), 'Sita Devi')
  await user.type(screen.getByLabelText(/Age \(years\) \*/i), '41')
  await user.type(screen.getByLabelText(/Phone number \*/i), '9876500011')
  await user.click(within(screen.getByRole('group', { name: 'Sex' })).getByRole('button', { name: 'Other' }))
  await user.type(screen.getByLabelText(/Address \*/i), 'Station Road, Ara')
}

async function selectExistingPatient(user: User) {
  await user.click(screen.getByRole('button', { name: /Existing patient/i }))
  await user.type(screen.getByLabelText(/Search patient by URN, name or mobile/i), 'Ramesh')
  await user.click(await screen.findByRole('button', { name: /Ramesh Kumar.*KH-2026-0001/i }))
  await screen.findByText(/Confirm with the patient that these details are theirs/i)
}

const submitButton = () => screen.getByRole('button', { name: /issue token/i })

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
    expect(screen.getByTestId('token-preview-number')).toHaveTextContent('P-014')
    expect(screen.getByText(/Current Queue \(Dr. Anil Kumar\)/i)).toBeInTheDocument()
  })
})

describe('Check-in & Token desk (phase 22)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('has the check-in form on the left and today\'s appointments on the right, and explains the desk', async () => {
    installApi({ today: [rameshBooking] })
    const user = renderDesk()

    expect(screen.getByRole('heading', { name: 'Check-in & Token' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Check in a patient/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Today's appointments/i })).toBeInTheDocument()
    expect(screen.getByText(/Booked patient\?/)).toBeInTheDocument()
    expect(screen.getByText(/Walk-in\?/)).toBeInTheDocument()
    expect(await screen.findByText('Ramesh Kumar')).toBeInTheDocument()

    // New patient is a real choice on this page: the form appears here, nothing navigates away.
    expect(screen.getByRole('button', { name: /New patient/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(/Patient name \*/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Existing patient/i }))
    expect(screen.getByLabelText(/Search patient by URN, name or mobile/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /New patient/i }))
    expect(screen.getByLabelText(/Patient name \*/i)).toBeInTheDocument()
  })

  it('registers a new patient and issues the token in one call', async () => {
    const { writes } = installApi({
      write: () =>
        jsonResponse(201, {
          ...checkedIn,
          id: 900,
          patient_id: 300,
          patient_name: 'Sita Devi',
          patient_urn: 'KH-2026-0300',
          source: 'WALK_IN',
        }),
    })
    const user = renderDesk()

    await fillNewPatient(user)
    await chooseDoctor(user)
    expect(screen.getByText(/Consultation fee/)).toHaveTextContent('₹400.00')
    expect(submitButton()).toHaveTextContent('Register patient & issue token')
    expect(submitButton()).toBeEnabled()
    await user.click(submitButton())

    expect(await screen.findByText(/Patient registered and checked in/i)).toBeInTheDocument()
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(screen.getByText('KH-2026-0300')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Print registration card/i })).toHaveAttribute(
      'href',
      '/reception/patients/300/print',
    )

    expect(writes).toHaveLength(1)
    expect(writes[0].url).toContain('/api/appointments/walk-in/new-patient')
    expect(writes[0].body).toMatchObject({
      patient: {
        full_name: 'Sita Devi',
        gender: 'O',
        age_years: 41,
        mobile: '9876500011',
        address: 'Station Road, Ara',
        guardian_name: 'Self / Not specified',
      },
      doctor_id: 10,
      department_id: 1,
      referral_source: 'SELF',
      priority_level: 'NORMAL',
      visit_kind: 'NEW',
    })
  })

  it('checks an existing patient in as a follow-up walk-in, with who referred them', async () => {
    const { writes } = installApi({
      write: () => jsonResponse(201, { ...checkedIn, id: 502, source: 'WALK_IN', visit_kind: 'FOLLOW_UP' }),
    })
    const user = renderDesk()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    // The consultation type must be chosen for a returning patient.
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(/Still needed: consultation type/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Follow-up / Revisit' }))

    await user.selectOptions(screen.getByLabelText(/Referred by \*/i), 'DOCTOR')
    expect(submitButton()).toBeDisabled()
    await user.type(screen.getByLabelText(/Referring doctor's name \*/i), 'Dr. Mehta')
    expect(submitButton()).toBeEnabled()
    await user.click(submitButton())

    expect(await screen.findByText(/^Patient checked in$/i)).toBeInTheDocument()
    expect(writes[0].url).toMatch(/\/api\/appointments\/walk-in$/)
    expect(writes[0].body).toMatchObject({
      patient_id: 101,
      doctor_id: 10,
      department_id: 1,
      visit_kind: 'FOLLOW_UP',
      referral_source: 'DOCTOR',
      referrer_name: 'Dr. Mehta',
    })
  })

  it('needs a reason before marking a patient Emergency, and sends it', async () => {
    const { writes } = installApi({
      write: () =>
        jsonResponse(201, {
          ...checkedIn,
          priority_level: 'EMERGENCY',
          priority_reason: 'Severe acute pain',
        }),
    })
    const user = renderDesk()

    await fillNewPatient(user)
    await chooseDoctor(user)
    await user.click(within(screen.getByRole('group', { name: 'Priority' })).getByRole('button', { name: 'Emergency' }))
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(/Still needed: priority reason/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Reason for emergency \*/i), 'Severe acute pain')
    await user.click(submitButton())

    const card = (await screen.findByTestId('issued-token')).closest('[role="status"]') as HTMLElement
    expect(within(card).getByText('Emergency')).toBeInTheDocument()
    expect(writes[0].body).toMatchObject({ priority_level: 'EMERGENCY', priority_reason: 'Severe acute pain' })
  })

  it("checks in a booking picked from today's appointments", async () => {
    const { writes } = installApi({ today: [rameshBooking], write: () => jsonResponse(200, checkedIn) })
    const user = renderDesk()

    const row = (await screen.findByText('Ramesh Kumar')).closest('li') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Check in' }))

    expect(screen.getByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar at 10:30')
    expect(screen.queryByLabelText(/Consulting doctor \*/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New consultation' }))
    expect(submitButton()).toHaveTextContent('Check in booking & issue token')
    await user.click(submitButton())

    expect(await screen.findByText(/^Patient checked in$/i)).toBeInTheDocument()
    expect(writes).toHaveLength(1)
    expect(writes[0].url).toContain('/api/appointments/501/check-in')
    expect(writes[0].body).toMatchObject({ version_id: 1, referral_source: 'SELF', visit_kind: 'NEW' })
  })

  it('opens with the patient and booking chosen when sent from Check In elsewhere', async () => {
    installApi({ bookings: [rameshBooking] })
    renderDesk('/reception/tokens?patient_id=101&appointment_id=501')

    expect(await screen.findByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar')
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Existing patient/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('points a walk-in for an already booked patient at their booking', async () => {
    const { writes } = installApi({
      bookings: [rameshBooking],
      write: (url) =>
        url.includes('/check-in')
          ? jsonResponse(200, checkedIn)
          : jsonResponse(409, {
              code: 'duplicate_appointment',
              message: 'Patient already has an active appointment with this doctor on this date.',
            }),
    })
    const user = renderDesk()

    await selectExistingPatient(user)
    expect(await screen.findByText(/This patient is booked for today/i)).toBeInTheDocument()
    await chooseDoctor(user)
    await user.click(screen.getByRole('button', { name: 'New consultation' }))
    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('already has a booking with this doctor today')
    expect(screen.queryByTestId('issued-token')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Check in their booking instead/i }))
    expect(screen.getByText(/Booked appointment with/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New consultation' }))
    await user.click(submitButton())
    expect(await screen.findByText(/^Patient checked in$/i)).toBeInTheDocument()
    expect(writes.map((w) => w.url).at(-1)).toContain('/api/appointments/501/check-in')
  })

  it('shows no token when the server refuses the check-in', async () => {
    installApi({
      write: () =>
        jsonResponse(409, {
          code: 'open_visit_from_earlier_day',
          message: 'This patient still has an open visit from 13 Nov 2026.',
        }),
    })
    const user = renderDesk()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(screen.getByRole('button', { name: 'New consultation' }))
    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('still has an open visit')
    expect(screen.queryByTestId('issued-token')).not.toBeInTheDocument()
  })

  it('offers the registered patient when a new patient matches one', async () => {
    installApi({ duplicate: mockPatient })
    const user = renderDesk()

    await user.type(screen.getByLabelText(/Patient name \*/i), 'Ramesh Kumar')
    await user.type(screen.getByLabelText(/Phone number \*/i), '9876543210')

    expect(await screen.findByText(/Already registered\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use this patient' }))

    expect(screen.getByRole('button', { name: /Existing patient/i })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/Confirm with the patient that these details are theirs/i)).toBeInTheDocument()
  })

  it('marks a booking as not arrived from the list', async () => {
    const { writes } = installApi({
      today: [rameshBooking],
      write: () => jsonResponse(200, { ...rameshBooking, status: 'NO_SHOW', version_id: 2 }),
    })
    const user = renderDesk()

    const row = (await screen.findByText('Ramesh Kumar')).closest('li') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'No-show' }))
    await user.click(within(row).getByRole('button', { name: 'Mark no-show' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      method: 'PATCH',
      body: { status: 'NO_SHOW', version_id: 1 },
    })
    expect(writes[0].url).toContain('/api/appointments/501/status')
  })

  it('renders next available token preview and existing patient search matching OPD check-in design', async () => {
    // Ramesh has token 1 today with Dr. Anil Kumar (id 10)
    const existingTokenAppt: Appointment = {
      ...rameshBooking,
      token_number: 1,
      status: 'ARRIVED',
    }
    installApi({ today: [existingTokenAppt] })
    const user = renderDesk()

    // 1. Initial next token preview is #-- before doctor selection
    expect(screen.getByTestId('next-token-preview')).toHaveTextContent('#--')
    expect(
      screen.getByText(/Illustrative preview only\. Actual number is assigned atomically/i),
    ).toBeInTheDocument()

    // 2. Select Dr. Anil Kumar -> next available token preview updates to #02
    await chooseDoctor(user)
    expect(screen.getByTestId('next-token-preview')).toHaveTextContent('#02')

    // 3. Switch to Existing patient -> verify search heading and placeholder
    await user.click(screen.getByRole('button', { name: /Existing patient/i }))
    expect(screen.getByText('Find existing patient')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter mobile number or hospital URN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search patient' })).toBeInTheDocument()
  })
})
