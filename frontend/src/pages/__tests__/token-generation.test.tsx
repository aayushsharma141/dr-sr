import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenGenerationPage } from '../TokenGenerationPage'
import { QueueTicketPreview } from '../../components/QueueTicketPreview'
import { istToday } from '../../format'
import type { Me, PatientOut, DepartmentOut, DepartmentDoctorOut, Appointment, OpdArrival } from '../../api/types'

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

const sitaArrival: OpdArrival = {
  id: 900,
  full_name: 'Sita Devi',
  age_years: 41,
  mobile: '9876500011',
  doctor_id: 10,
  doctor_name_en: 'Dr. Anil Kumar',
  department_id: 1,
  department_name: 'Physiotherapy',
  appointment_date: istToday(),
  token_number: 14,
  priority_level: 'NORMAL',
  status: 'TO_ARRIVE',
  version_id: 1,
  created_at: '2026-11-16T03:00:00Z',
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
  arrivals?: OpdArrival[]
  bookings?: Appointment[]
  duplicate?: PatientOut | null
  write?: (url: string, method: string) => ReturnType<typeof jsonResponse>
}) {
  const writes: Write[] = []
  const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    // AppShell sends this best-effort heartbeat on mount; it is unrelated to the desk action.
    if (url.includes('/api/system/heartbeat')) return Promise.resolve(jsonResponse(200, { ok: true }))
    if (method !== 'GET') {
      writes.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : null })
      return Promise.resolve(options.write?.(url, method) ?? jsonResponse(500, { message: 'unexpected write' }))
    }
    if (url.includes('/api/opd-arrivals'))
      return Promise.resolve(jsonResponse(200, { total: options.arrivals?.length ?? 0, arrivals: options.arrivals ?? [] }))
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(200, mockMe))
    if (url.includes('/api/departments/1/doctors')) return Promise.resolve(jsonResponse(200, mockDoctors))
    if (url.includes('/api/departments')) return Promise.resolve(jsonResponse(200, mockDepartments))
    if (url.includes('/api/patients/check-duplicate'))
      return Promise.resolve(
        jsonResponse(200, { has_duplicate: options.duplicate != null, matching_patient: options.duplicate ?? null }),
      )
    if (url.endsWith('/api/patients/101')) return Promise.resolve(jsonResponse(200, mockPatient))
    if (url.includes('/api/patients')) return Promise.resolve(jsonResponse(200, [mockPatient]))
    if (url.endsWith('/api/appointments/501')) return Promise.resolve(jsonResponse(200, rameshBooking))
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

type DeskEntry = string | { pathname: string; state?: unknown }

function renderDesk(entry: DeskEntry = '/reception/tokens') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
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
}

async function selectExistingPatient(user: User) {
  await user.click(screen.getByRole('button', { name: /Existing patient/i }))
  await user.type(screen.getByLabelText(/Search patient by URN, name or mobile/i), 'Ramesh')
  await user.click(await screen.findByRole('button', { name: /Ramesh Kumar.*KH-2026-0001/i }))
  await screen.findByText(/Confirm with the patient that these details are theirs/i)
}

const submitButton = () => screen.getByRole('button', { name: /^Generate Token$|^Check in & Generate Token$/i })

function getStepItems() {
  return within(screen.getByRole('list', { name: 'Check-in steps' })).getAllByRole('listitem')
}

function assertNoBillingLinksInDesk() {
  const desk = screen.getByRole('main')
  expect(within(desk).queryByRole('link', { name: /billing|receipt/i })).not.toBeInTheDocument()
  for (const link of within(desk).queryAllByRole('link')) {
    expect(link.getAttribute('href') ?? '').not.toContain('/reception/billing')
  }
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
    expect(screen.getByTestId('token-preview-number')).toHaveTextContent('P-014')
    expect(screen.getByText(/Current Queue \(Dr. Anil Kumar\)/i)).toBeInTheDocument()
  })
})

describe('Check-in & Token desk', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows two-step indicator, compact Step 01 controls, live token preview, and no dead Search patient button', async () => {
    const existingTokenAppt: Appointment = {
      ...rameshBooking,
      token_number: 1,
      status: 'ARRIVED',
      consultation_status: 'WAITING',
    }
    installApi({ today: [existingTokenAppt] })
    const user = renderDesk()

    expect(screen.getByRole('heading', { name: 'Check-in & Token' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Today's appointments/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create OPD Token' })).toBeInTheDocument()

    // Step 01 is active initially in the two-step indicator
    const [step1, step2] = getStepItems()
    expect(step1).toHaveAttribute('aria-current', 'step')
    expect(step1).toHaveTextContent(/01.*Patient & Visit/)
    expect(step2).not.toHaveAttribute('aria-current')
    expect(step2).toHaveTextContent(/02.*Token & Check-in/)

    // Compact inline next-token preview starts at #-- and updates to #2 when doctor is chosen
    expect(screen.getByTestId('next-token-preview')).toHaveTextContent('#--')
    expect(screen.getByText('Preview only')).toBeInTheDocument()
    await chooseDoctor(user)
    expect(screen.getByTestId('next-token-preview')).toHaveTextContent('#2')

    // New patient / Existing patient toggle works inline without a dead Search patient button
    expect(screen.getByRole('button', { name: /New patient/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(/Patient name \*/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Existing patient/i }))
    expect(screen.getByRole('button', { name: /Existing patient/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Find existing patient')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter mobile number or hospital URN')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search patient' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /New patient/i }))
    expect(screen.getByLabelText(/Patient name \*/i)).toBeInTheDocument()
  })

  it('moves new patient from Step 01 to Step 02 arrival summary and resets cleanly on Next patient', async () => {
    const { writes } = installApi({
      write: () => jsonResponse(201, sitaArrival),
    })
    const user = renderDesk()

    await fillNewPatient(user)
    await chooseDoctor(user)
    expect(screen.getByText(/Consultation fee/)).toHaveTextContent('₹400.00')
    expect(submitButton()).toHaveTextContent('Generate Token')
    expect(submitButton()).toBeEnabled()
    await user.click(submitButton())

    // Swaps left card to Step 02
    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    const [step1, step2] = getStepItems()
    expect(step1).not.toHaveAttribute('aria-current')
    expect(step2).toHaveAttribute('aria-current', 'step')

    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(screen.getByText('To arrive · Pending full registration')).toBeInTheDocument()
    expect(screen.getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(screen.getByText('Physiotherapy')).toBeInTheDocument()

    const regLink = screen.getByRole('link', { name: /Complete Registration & Check In/i })
    expect(regLink).toHaveAttribute('href', '/reception/patients/new?arrival_id=900&doctor_id=10')
    expect(screen.getByRole('button', { name: /Print Token/i })).toBeInTheDocument()
    assertNoBillingLinksInDesk()

    expect(writes).toHaveLength(1)
    expect(writes[0].url).toContain('/api/opd-arrivals')
    expect(writes[0].body).toMatchObject({
      full_name: 'Sita Devi',
      age_years: 41,
      mobile: '9876500011',
      doctor_id: 10,
      department_id: 1,
      priority_level: 'NORMAL',
    })

    // Next patient returns cleanly to Step 01 with cleared inputs
    await user.click(screen.getByRole('button', { name: 'Next patient' }))
    expect(screen.getByRole('heading', { name: 'Create OPD Token' })).toBeInTheDocument()
    const [resetStep1, resetStep2] = getStepItems()
    expect(resetStep1).toHaveAttribute('aria-current', 'step')
    expect(resetStep2).not.toHaveAttribute('aria-current')
    expect(screen.getByLabelText(/Patient name \*/i)).toHaveValue('')
    expect(screen.getByLabelText(/Age \(years\) \*/i)).toHaveValue(null)
    expect(screen.getByLabelText(/Phone number \*/i)).toHaveValue('')
  })

  it('moves existing patient walk-in from Step 01 to Step 02 checked-in summary without billing links', async () => {
    const { writes } = installApi({
      write: () => jsonResponse(201, { ...checkedIn, id: 502, status: 'CHECKED_IN', source: 'WALK_IN', visit_kind: 'NEW' }),
    })
    const user = renderDesk()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    expect(submitButton()).toHaveTextContent('Check in & Generate Token')
    expect(submitButton()).toBeEnabled()
    await user.click(submitButton())

    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    const [step1, step2] = getStepItems()
    expect(step1).not.toHaveAttribute('aria-current')
    expect(step2).toHaveAttribute('aria-current', 'step')

    expect(screen.getByText('Checked In · Waiting for doctor')).toBeInTheDocument()
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(screen.getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(screen.getByText('Physiotherapy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print Token/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Patient file' })).toHaveAttribute('href', '/reception/patients/101')
    expect(screen.getByRole('button', { name: 'Check in next patient' })).toBeInTheDocument()
    assertNoBillingLinksInDesk()

    expect(writes).toHaveLength(1)
    expect(writes[0].url.endsWith('/api/appointments/walk-in')).toBe(true)
    expect(writes[0].body).toMatchObject({
      patient_id: 101,
      doctor_id: 10,
      department_id: 1,
      priority_level: 'NORMAL',
    })
  })

  it('opens the Print OPD Token modal from Step 02, triggers window.print, and closes cleanly', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    installApi({
      write: () => jsonResponse(201, { ...checkedIn, id: 502, status: 'CHECKED_IN', source: 'WALK_IN', visit_kind: 'NEW' }),
    })
    const user = renderDesk()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    await user.click(submitButton())
    await screen.findByRole('heading', { name: 'Token Generated' })

    await user.click(screen.getByRole('button', { name: /Print Token/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Print OPD Token' })
    expect(within(dialog).getByTestId('print-slip-token')).toHaveTextContent('#14')
    expect(within(dialog).getByText('Ramesh Kumar')).toBeInTheDocument()
    expect(within(dialog).getByText('KH-2026-0001')).toBeInTheDocument()
    expect(within(dialog).getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(within(dialog).getByText('Physiotherapy')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Print Slip/i }))
    expect(printSpy).toHaveBeenCalledTimes(1)

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Print OPD Token' })).not.toBeInTheDocument()
  })

  it('checks in an unarrived BOOKED appointment directly from the default To Arrive tab and preserves booking priority', async () => {
    const priorityBooking: Appointment = {
      ...rameshBooking,
      priority_level: 'PRIORITY',
      priority_reason: 'Senior citizen',
    }
    const priorityCheckedIn: Appointment = {
      ...checkedIn,
      priority_level: 'PRIORITY',
      priority_reason: 'Senior citizen',
    }
    const { writes } = installApi({
      bookings: [priorityBooking],
      today: [priorityBooking],
      write: () => jsonResponse(200, priorityCheckedIn),
    })
    const user = renderDesk()

    // Default tab is To Arrive; unarrived BOOKED appointment appears directly with a Check in button
    expect(screen.getByRole('tab', { name: /To Arrive/i })).toHaveAttribute('aria-selected', 'true')
    const row = (await screen.findByText('Ramesh Kumar')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Check in' }))

    expect(screen.getByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar at 10:30')
    expect(screen.queryByLabelText(/Consulting doctor \*/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(screen.getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')

    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    expect(submitButton()).toHaveTextContent('Check in & Generate Token')
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(screen.getByText('Checked In · Waiting for doctor')).toBeInTheDocument()
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(writes[0].url).toContain('/api/appointments/501/check-in')
    expect(writes[0].body).toMatchObject({
      version_id: 1,
      referral_source: 'SELF',
      visit_kind: 'NEW',
      priority_level: 'PRIORITY',
      priority_reason: 'Senior citizen',
    })
  })

  it('needs a reason before marking a patient Emergency, and sends it', async () => {
    const { writes } = installApi({
      write: () =>
        jsonResponse(201, {
          ...sitaArrival,
          priority_level: 'EMERGENCY',
          priority_reason: 'Severe acute pain',
        }),
    })
    const user = renderDesk()

    await fillNewPatient(user)
    await chooseDoctor(user)
    await user.selectOptions(screen.getByLabelText('Priority *'), 'EMERGENCY')
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(/Still needed: priority reason/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Reason for emergency \*/i), 'Severe acute pain')
    await user.click(submitButton())

    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(screen.getByText('Severe acute pain')).toBeInTheDocument()
    expect(writes[0].body).toMatchObject({ priority_level: 'EMERGENCY', priority_reason: 'Severe acute pain' })
  })

  it('opens with the patient and booking chosen when sent from Check In elsewhere', async () => {
    installApi({ bookings: [rameshBooking] })
    renderDesk('/reception/tokens?patient_id=101&appointment_id=501')

    expect(await screen.findByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar')
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Existing patient/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('preserves and dismisses location.state.notice banner', async () => {
    installApi({})
    const user = renderDesk({
      pathname: '/reception/tokens',
      state: { notice: 'Patient registered and checked in (Token #14).' },
    })

    const status = within(screen.getByRole('main')).getByRole('status')
    expect(status).toHaveTextContent('Patient registered and checked in (Token #14).')
    await user.click(within(status).getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Patient registered and checked in (Token #14).')).not.toBeInTheDocument()
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
    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('already has a booking with this doctor today')
    expect(screen.queryByTestId('issued-token')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Check in their booking instead/i }))
    expect(screen.getByText(/Booked appointment with/)).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    await user.click(submitButton())
    await waitFor(() => expect(writes.some((w) => w.url.includes('/check-in'))).toBe(true))
    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(screen.getByText('Checked In · Waiting for doctor')).toBeInTheDocument()
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
    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('still has an open visit')
    expect(screen.queryByTestId('issued-token')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create OPD Token' })).toBeInTheDocument()
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

  it('marks an unarrived booking as no-show via More menuitem from To Arrive', async () => {
    const { writes } = installApi({
      today: [rameshBooking],
      write: () => jsonResponse(200, { ...rameshBooking, status: 'NO_SHOW', version_id: 2 }),
    })
    const user = renderDesk()

    const row = (await screen.findByText('Ramesh Kumar')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'No-show' }))
    await user.click(screen.getByRole('button', { name: 'Mark no-show' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      method: 'PATCH',
      body: { status: 'NO_SHOW', version_id: 1 },
    })
    expect(writes[0].url).toContain('/api/appointments/501/status')
  })
})
