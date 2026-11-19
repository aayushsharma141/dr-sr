import '../../test/dialog-shim'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateOpdTokenModal, type CreateOpdTokenModalProps } from '../../components/checkin/CreateOpdTokenModal'
import { PriorityModal } from '../../components/checkin/PriorityModal'
import { AppointmentsReception } from '../AppointmentsReception'
import { router } from '../../router'
import { QueueTicketPreview } from '../../components/QueueTicketPreview'
import { ApiError } from '../../api/client'
import { istToday } from '../../format'
import type {
  Appointment,
  DepartmentDoctorOut,
  DepartmentOut,
  DoctorOut,
  DoctorTodayOut,
  Me,
  OpdArrival,
  PatientOut,
} from '../../api/types'

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

const mockDoctorList: DoctorOut[] = [
  {
    id: 10,
    name_en: 'Dr. Anil Kumar',
    name_hi: 'डॉ अनिल कुमार',
    qualification: 'BPT, MPT',
    registration_number: null,
    default_fee_paise: 40000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
]

function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

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
  headers: Record<string, string>
}

function installApi(options: {
  today?: Appointment[]
  arrivals?: OpdArrival[] | (() => OpdArrival[])
  bookings?: Appointment[]
  bookingById?: Record<number, Appointment>
  duplicate?: PatientOut | null
  me?: Me
  doctorsToday?: DoctorTodayOut[]
  write?: (
    url: string,
    method: string,
    body: Record<string, unknown> | null,
    headers: Record<string, string>,
  ) => ReturnType<typeof jsonResponse> | Promise<ReturnType<typeof jsonResponse>>
}) {
  const writes: Write[] = []
  const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url.includes('/api/system/heartbeat')) return Promise.resolve(jsonResponse(200, { ok: true }))
    if (url.includes('/api/health')) {
      return Promise.resolve(jsonResponse(200, { status: 'ok', db: 'ok', setup_required: false }))
    }
    if (url.includes('/api/settings')) return Promise.resolve(jsonResponse(200, {}))
    if (url.includes('/api/reception/overview')) {
      return Promise.resolve(
        jsonResponse(200, {
          area: 'reception',
          name: 'Reception Staff',
          role: 'RECEPTION',
          business_date: istToday(),
          doctors_today: options.doctorsToday ?? [],
        }),
      )
    }
    if (method !== 'GET') {
      const parsedBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      const headers = (init?.headers ?? {}) as Record<string, string>
      writes.push({ method, url, body: parsedBody, headers })
      return Promise.resolve().then(
        () =>
          options.write?.(url, method, parsedBody, headers) ??
          jsonResponse(500, { message: 'unexpected write' }),
      )
    }
    if (url.includes('/api/opd-arrivals')) {
      const arrivals = typeof options.arrivals === 'function' ? options.arrivals() : (options.arrivals ?? [])
      return Promise.resolve(jsonResponse(200, { total: arrivals.length, arrivals }))
    }
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(200, options.me ?? mockMe))
    if (url.includes('/api/doctors')) return Promise.resolve(jsonResponse(200, mockDoctorList))
    if (url.includes('/api/departments/1/doctors')) return Promise.resolve(jsonResponse(200, mockDoctors))
    if (url.includes('/api/departments')) return Promise.resolve(jsonResponse(200, mockDepartments))
    if (url.includes('/api/patients/check-duplicate')) {
      return Promise.resolve(
        jsonResponse(200, { has_duplicate: options.duplicate != null, matching_patient: options.duplicate ?? null }),
      )
    }
    if (url.endsWith('/api/patients/101')) return Promise.resolve(jsonResponse(200, mockPatient))
    if (url.includes('/api/patients')) return Promise.resolve(jsonResponse(200, [mockPatient]))
    const apptMatch = url.match(/\/api\/appointments\/(\d+)$/)
    if (apptMatch) {
      const id = Number(apptMatch[1])
      const found = options.bookingById?.[id] ?? (id === 501 ? rameshBooking : undefined)
      if (found) return Promise.resolve(jsonResponse(200, found))
      return Promise.resolve(jsonResponse(404, { message: 'Not found' }))
    }
    if (url.includes('/api/appointments') && url.includes('patient_id=101')) {
      const qs = new URLSearchParams(url.split('?')[1] ?? '')
      const requestedDate = qs.get('appointment_date')
      const source = options.bookings ?? []
      const filtered = requestedDate
        ? source.filter((a) => a.appointment_date === requestedDate)
        : source
      return Promise.resolve(
        jsonResponse(200, { appointments: filtered, total: filtered.length }),
      )
    }
    if (url.includes('/api/appointments')) {
      return Promise.resolve(
        jsonResponse(200, { appointments: options.today ?? [], total: options.today?.length ?? 0 }),
      )
    }
    return Promise.reject(new Error(`Unhandled URL: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)
  return { writes, mockFetch }
}

type DeskEntry = string | { pathname: string; search?: string; state?: unknown }

function LocationProbe() {
  const loc = useLocation()
  return (
    <>
      <span data-testid="router-pathname">{loc.pathname}</span>
      <span data-testid="router-search">{loc.search}</span>
    </>
  )
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderModal(props: Partial<CreateOpdTokenModalProps> = {}) {
  const queryClient = makeQueryClient()
  const onClose = props.onClose ?? vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reception/appointments']}>
        <CreateOpdTokenModal open onClose={onClose} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), queryClient, onClose }
}

function renderAppointments(entry: DeskEntry = '/reception/appointments') {
  const queryClient = makeQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <AppointmentsReception />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), queryClient }
}

type User = ReturnType<typeof userEvent.setup>

async function chooseDoctor(user: User) {
  const select = screen.getByLabelText(/Consulting doctor \*/i)
  await waitFor(() => {
    expect(within(select).getByRole('option', { name: /Dr\. Anil Kumar/ })).toBeInTheDocument()
  })
  await user.selectOptions(select, '1:10')
}

async function fillNewPatient(user: User) {
  await user.type(screen.getByLabelText(/Patient name \*/i), 'Sita Devi')
  await user.type(screen.getByLabelText(/Age \(years\) \*/i), '41')
  await user.type(screen.getByLabelText(/Phone number \*/i), '9876500011')
}

async function selectExistingPatient(user: User) {
  await user.click(
    within(screen.getByRole('group', { name: 'Patient type' })).getByRole('button', { name: /Existing patient/i }),
  )
  await user.type(screen.getByLabelText(/Search patient by URN, name or mobile/i), 'Ramesh')
  await user.click(await screen.findByRole('button', { name: /Ramesh Kumar.*KH-2026-0001/i }))
  await screen.findByText(/Confirm with the patient that these details are theirs/i)
}

const submitButton = () =>
  screen.getByRole('button', {
    name: /^Generate Token$|^Check in & Generate Token$|^Check in Booking$|^Book Appointment$/i,
  })

const confirmButton = () =>
  screen.getByRole('button', {
    name: /^Confirm & Issue Token$|^Confirm & Book Appointment$/i,
  })

async function submitAndConfirm(user: User) {
  await waitFor(() => expect(submitButton()).toBeEnabled())
  await user.click(submitButton())
  await screen.findByTestId('opd-confirm-bar')
  await user.click(confirmButton())
}

function getStepItems() {
  return within(screen.getByRole('list', { name: 'Check-in steps' })).getAllByRole('listitem')
}

function assertNoBillingLinksIn(container: HTMLElement) {
  expect(within(container).queryByRole('link', { name: /billing|receipt/i })).not.toBeInTheDocument()
  for (const link of within(container).queryAllByRole('link')) {
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

describe('CreateOpdTokenModal — Check-in, Tokens & Unified Booking', () => {
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
    const { user } = renderModal()

    const dialog = screen.getByRole('dialog', { name: 'Create OPD Token' })
    expect(within(dialog).getByRole('heading', { name: 'Create OPD Token' })).toBeInTheDocument()

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
    const { user } = renderModal()

    await fillNewPatient(user)
    await chooseDoctor(user)
    expect(screen.getByText(/Consultation fee/)).toHaveTextContent('₹400.00')
    expect(submitButton()).toHaveTextContent('Generate Token')
    await submitAndConfirm(user)

    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    const [step1, step2] = getStepItems()
    expect(step1).not.toHaveAttribute('aria-current')
    expect(step2).toHaveAttribute('aria-current', 'step')

    const dialog = screen.getByRole('dialog', { name: 'Token Generated' })
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(screen.getByText('To arrive · Pending full registration')).toBeInTheDocument()
    expect(screen.getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(screen.getByText('Physiotherapy')).toBeInTheDocument()

    const regLink = screen.getByRole('link', { name: /Complete Registration & Check In/i })
    expect(regLink).toHaveAttribute('href', '/reception/patients/new?arrival_id=900&doctor_id=10')
    expect(screen.getByRole('button', { name: /Print Token/i })).toBeInTheDocument()
    assertNoBillingLinksIn(dialog)

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
    const { user } = renderModal()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    expect(submitButton()).toHaveTextContent('Check in & Generate Token')
    await submitAndConfirm(user)

    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    const [step1, step2] = getStepItems()
    expect(step1).not.toHaveAttribute('aria-current')
    expect(step2).toHaveAttribute('aria-current', 'step')

    const dialog = screen.getByRole('dialog', { name: 'Token Generated' })
    expect(screen.getByText('Checked In · Waiting for doctor')).toBeInTheDocument()
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(screen.getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(screen.getByText('Physiotherapy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print Token/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Patient file' })).toHaveAttribute('href', '/reception/patients/101')
    expect(screen.getByRole('button', { name: 'Check in next patient' })).toBeInTheDocument()
    assertNoBillingLinksIn(dialog)

    expect(writes).toHaveLength(1)
    expect(writes[0].url.endsWith('/api/appointments/walk-in')).toBe(true)
    expect(writes[0].body).toMatchObject({
      patient_id: 101,
      doctor_id: 10,
      department_id: 1,
      priority_level: 'NORMAL',
    })
  })

  it('opens the Print OPD Token modal (print="receipt") from Step 02, triggers window.print, and closes cleanly back to Step 02', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    installApi({
      write: () => jsonResponse(201, { ...checkedIn, id: 502, status: 'CHECKED_IN', source: 'WALK_IN', visit_kind: 'NEW' }),
    })
    const { user } = renderModal()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    await submitAndConfirm(user)
    await screen.findByRole('heading', { name: 'Token Generated' })

    await user.click(screen.getByRole('button', { name: /Print Token/i }))

    const printDialog = await screen.findByRole('dialog', { name: 'Print OPD Token' })
    expect(printDialog).toHaveAttribute('data-print-page', 'receipt')
    expect(within(printDialog).getByTestId('print-slip-token')).toHaveTextContent('#14')
    expect(within(printDialog).getByText('Ramesh Kumar')).toBeInTheDocument()
    expect(within(printDialog).getByText('KH-2026-0001')).toBeInTheDocument()
    expect(within(printDialog).getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(within(printDialog).getByText('Physiotherapy')).toBeInTheDocument()

    await user.click(within(printDialog).getByRole('button', { name: /Print Slip/i }))
    expect(printSpy).toHaveBeenCalledTimes(1)

    await user.click(within(printDialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Print OPD Token' })).not.toBeInTheDocument()
    // Underlying Step 02 Token Generated dialog remains open cleanly
    expect(screen.getByRole('dialog', { name: 'Token Generated' })).toBeInTheDocument()
  })

  it('checks in an initialBooking preserving priority and hiding date picker', async () => {
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
      today: [priorityBooking],
      write: () => jsonResponse(200, priorityCheckedIn),
    })
    const { user } = renderModal({ initialBooking: priorityBooking })

    expect(screen.getByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar at 10:30')
    expect(screen.queryByLabelText(/Appointment date/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Consulting doctor \*/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(screen.getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')

    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    expect(submitButton()).toHaveTextContent('Check in Booking')
    await submitAndConfirm(user)

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(screen.getByText('Checked In · Waiting for doctor')).toBeInTheDocument()
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(writes[0].url).toContain('/api/appointments/501/check-in')
    expect(writes[0].body).toMatchObject({
      version_id: 1,
      patient_id: 101,
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
    const { user } = renderModal()

    await fillNewPatient(user)
    await chooseDoctor(user)
    await user.selectOptions(screen.getByLabelText('Priority *'), 'EMERGENCY')
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(/Still needed: priority reason/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Reason for emergency \*/i), 'Severe acute pain')
    await submitAndConfirm(user)

    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(screen.getByTestId('issued-token')).toHaveTextContent('#14')
    expect(screen.getByText('Severe acute pain')).toBeInTheDocument()
    expect(writes[0].body).toMatchObject({ priority_level: 'EMERGENCY', priority_reason: 'Severe acute pain' })
  })

  it('points a walk-in for an already booked patient at their booking via 409 action toast', async () => {
    const { writes } = installApi({
      today: [rameshBooking],
      bookings: [rameshBooking],
      write: (url) =>
        url.includes('/check-in')
          ? jsonResponse(200, checkedIn)
          : jsonResponse(409, {
              code: 'duplicate_appointment',
              message: 'Patient already has an active appointment with this doctor on this date.',
            }),
    })
    const { user } = renderModal()

    await selectExistingPatient(user)
    expect(await screen.findByText(/This patient is booked for today/i)).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    await chooseDoctor(user)
    await submitAndConfirm(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('already has a booking with this doctor today')
    expect(screen.queryByTestId('issued-token')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Check in their booking instead/i }))
    expect(screen.getByText(/Booked appointment with/)).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    expect(submitButton()).toHaveTextContent('Check in Booking')
    await submitAndConfirm(user)
    await waitFor(() => expect(writes.some((w) => w.url.includes('/check-in'))).toBe(true))
    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(screen.getByText('Checked In · Waiting for doctor')).toBeInTheDocument()
    expect(writes.map((w) => w.url).at(-1)).toContain('/api/appointments/501/check-in')
    expect(writes.at(-1)?.body).toMatchObject({ patient_id: 101 })
  })

  it('shows no token when the server refuses the check-in', async () => {
    installApi({
      write: () =>
        jsonResponse(409, {
          code: 'open_visit_from_earlier_day',
          message: 'This patient still has an open visit from 13 Nov 2026.',
        }),
    })
    const { user } = renderModal()

    await selectExistingPatient(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    await chooseDoctor(user)
    await submitAndConfirm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('still has an open visit')
    expect(screen.queryByTestId('issued-token')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create OPD Token' })).toBeInTheDocument()
  })

  it('offers the registered patient when a new patient matches one', async () => {
    installApi({ duplicate: mockPatient })
    const { user } = renderModal()

    await user.type(screen.getByLabelText(/Patient name \*/i), 'Ramesh Kumar')
    await user.type(screen.getByLabelText(/Phone number \*/i), '9876543210')

    expect(await screen.findByText(/Already registered\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use this patient' }))

    expect(screen.getByRole('button', { name: /Existing patient/i })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/Confirm with the patient that these details are theirs/i)).toBeInTheDocument()
  })

  it('resets notDuplicate confirmation when editing patient name or mobile', async () => {
    installApi({ duplicate: mockPatient })
    const { user } = renderModal()

    await user.type(screen.getByLabelText(/Patient name \*/i), 'Ramesh Kumar')
    await user.type(screen.getByLabelText(/Age \(years\) \*/i), '45')
    await user.type(screen.getByLabelText(/Phone number \*/i), '9876543210')
    await chooseDoctor(user)

    const checkbox = await screen.findByLabelText(/Different patient with same phone number/i)
    expect(submitButton()).toBeDisabled()
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    await waitFor(() => expect(submitButton()).toBeEnabled())

    // Editing fullName resets notDuplicate
    await user.type(screen.getByLabelText(/Patient name \*/i), ' Jr')
    const checkboxAfterName = await screen.findByLabelText(/Different patient with same phone number/i)
    expect(checkboxAfterName).not.toBeChecked()
    expect(submitButton()).toBeDisabled()

    // Re-checking and editing mobile also resets notDuplicate
    await user.click(checkboxAfterName)
    expect(checkboxAfterName).toBeChecked()
    await user.type(screen.getByLabelText(/Phone number \*/i), '1')
    const checkboxAfterMobile = await screen.findByLabelText(/Different patient with same phone number/i)
    expect(checkboxAfterMobile).not.toBeChecked()
  })

  it('requires Consultation type for existing walk-ins and hides Remarks in New patient mode', async () => {
    installApi({})
    const { user } = renderModal()

    expect(screen.queryByLabelText(/Remarks \(optional\)/i)).not.toBeInTheDocument()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    expect(screen.getByLabelText(/Remarks \(optional\)/i)).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(/Still needed: consultation type\./i)).toBeInTheDocument()

    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'Follow-up / Revisit',
      }),
    )
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })

  it('restores collapsible Referred by control and sends referral_source and referrer_name on walk-in', async () => {
    const { writes } = installApi({
      write: () =>
        jsonResponse(201, {
          ...checkedIn,
          id: 509,
          referral_source: 'DOCTOR',
          referrer_name: 'Dr. Sharma',
        }),
    })
    const { user } = renderModal()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )

    // Collapsed by default showing Self
    expect(screen.getByText(/Referred by:/i)).toHaveTextContent('Referred by: Self')
    expect(screen.queryByLabelText(/Referred by \*/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Change/i }))
    const referralSelect = screen.getByLabelText(/Referred by \*/i)
    await user.selectOptions(referralSelect, 'DOCTOR')

    // Referrer name is required for DOCTOR
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(/Still needed: referrer name/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Referring doctor's name \*/i), 'Dr. Sharma')
    await submitAndConfirm(user)

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].body).toMatchObject({
      referral_source: 'DOCTOR',
      referrer_name: 'Dr. Sharma',
    })
  })

  it('disables Print Token and displays Cancelled notice when issued arrival is cancelled live', async () => {
    let cancelled = false
    installApi({
      arrivals: () =>
        cancelled ? [{ ...sitaArrival, status: 'CANCELLED', version_id: 2 }] : [sitaArrival],
      write: () => jsonResponse(201, sitaArrival),
    })
    const { user, queryClient } = renderModal()

    await fillNewPatient(user)
    await chooseDoctor(user)
    await submitAndConfirm(user)
    await screen.findByRole('heading', { name: 'Token Generated' })
    expect(screen.getByRole('button', { name: /Print Token/i })).toBeEnabled()

    // Simulate live cancellation picked up on query refresh
    cancelled = true
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['opd-arrivals'] })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Print Token/i })).toBeDisabled()
    })
    expect(screen.getByText(/This token has been cancelled/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Complete Registration & Check In/i })).not.toBeInTheDocument()
  })

  it('shows backend error message directly on 409 duplicate_opd_arrival and shows same-day active token notice', async () => {
    installApi({
      today: [checkedIn],
      write: () =>
        jsonResponse(409, {
          code: 'duplicate_opd_arrival',
          message: 'This mobile number already has a pending arrival in this doctor’s queue today.',
        }),
    })
    const { user } = renderModal()

    await fillNewPatient(user)
    await chooseDoctor(user)
    await submitAndConfirm(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('already has a pending arrival')
    expect(screen.queryByRole('button', { name: /Check in their booking instead/i })).not.toBeInTheDocument()

    // Selecting an existing patient who already has an active token today shows an informational notice
    await selectExistingPatient(user)
    expect(await screen.findByText(/already checked in today/i)).toBeInTheDocument()
  })

  it('enforces canCreateArrival, canCheckIn, and canManageBookings permission gates', async () => {
    // 1. Only visit:write -> canCheckIn=true, canCreateArrival=false, canManageBookings=false
    installApi({
      me: { ...mockMe, permissions: ['patient:read', 'appointment:read', 'visit:read', 'visit:write'] },
    })
    const { user } = renderModal()

    await fillNewPatient(user)
    await chooseDoctor(user)
    expect(submitButton()).toBeDisabled()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    await waitFor(() => expect(submitButton()).toBeEnabled())

    // Future-date booking requires appointment:write (canManageBookings)
    const tomorrow = shiftIsoDate(istToday(), 1)
    fireEvent.change(screen.getByLabelText(/Appointment date \*/i), { target: { value: tomorrow } })
    expect(submitButton()).toHaveTextContent('Book Appointment')
    expect(submitButton()).toBeDisabled()

    // 2. Only patient:create + appointment:write -> canCreateArrival=true, canManageBookings=true, canCheckIn=false
    cleanup()
    installApi({
      me: { ...mockMe, permissions: ['patient:read', 'patient:create', 'appointment:read', 'appointment:write'] },
    })
    const { user: user2 } = renderModal()
    await fillNewPatient(user2)
    await chooseDoctor(user2)
    await waitFor(() => expect(submitButton()).toBeEnabled())

    await selectExistingPatient(user2)
    await chooseDoctor(user2)
    await user2.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    expect(submitButton()).toBeDisabled()

    // Future-date booking is allowed because canManageBookings=true
    fireEvent.change(screen.getByLabelText(/Appointment date \*/i), { target: { value: tomorrow } })
    await waitFor(() => expect(submitButton()).toBeEnabled())

    // 3. Only appointment:write -> canManageBookings=true, canCreateArrival=false, canCheckIn=false
    cleanup()
    installApi({
      me: { ...mockMe, permissions: ['patient:read', 'appointment:read', 'appointment:write'] },
    })
    const { user: user3 } = renderModal()
    await fillNewPatient(user3)
    await chooseDoctor(user3)
    expect(submitButton()).toBeDisabled()

    await selectExistingPatient(user3)
    await chooseDoctor(user3)
    await user3.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    expect(submitButton()).toBeDisabled()

    // Future-date booking enabled via canManageBookings
    fireEvent.change(screen.getByLabelText(/Appointment date \*/i), { target: { value: tomorrow } })
    await waitFor(() => expect(submitButton()).toBeEnabled())
  })

  it('defaults date picker to istToday with min=today in immediate Check-in & Token mode without book-for-later toggle', async () => {
    installApi({})
    renderModal()

    const today = istToday()
    const dateInput = screen.getByLabelText(/Appointment date \*/i)
    expect(dateInput).toHaveAttribute('id', 'checkin-date')
    expect(dateInput).toHaveValue(today)
    expect(dateInput).toHaveAttribute('min', today)

    expect(screen.queryByLabelText(/Book for later today/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create OPD Token' })).toBeInTheDocument()
    expect(screen.getByLabelText('Priority *')).toBeInTheDocument()
    expect(screen.getByTestId('next-token-preview')).toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Generate Token')
  })

  it('automatically switches to Book Appointment on a future date, blocks new-patient intake, submits POST /appointments, and handles 409 duplicate_appointment', async () => {
    const tomorrow = shiftIsoDate(istToday(), 1)
    let failDuplicate = false
    const futureBooked: Appointment = {
      ...rameshBooking,
      id: 602,
      appointment_date: tomorrow,
      expected_time: '16:00:00',
      source: 'PHONE',
      status: 'BOOKED',
      token_number: null,
    }
    const { writes } = installApi({
      write: () =>
        failDuplicate
          ? jsonResponse(409, {
              code: 'duplicate_appointment',
              message: 'Patient already has an active appointment with this doctor on this date.',
            })
          : jsonResponse(201, futureBooked),
    })
    const { user } = renderModal()

    // Select tomorrow
    fireEvent.change(screen.getByLabelText(/Appointment date \*/i), { target: { value: tomorrow } })

    expect(screen.getByText(/Advance booking — token will be issued on arrival/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Book Appointment' })).toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Book Appointment')

    // Blocks new-patient quick-intake with quick registration link
    expect(screen.getByRole('link', { name: /Register new patient first/i })).toHaveAttribute(
      'href',
      '/reception/patients/new',
    )
    expect(screen.queryByLabelText('Priority *')).not.toBeInTheDocument()
    expect(screen.queryByTestId('next-token-preview')).not.toBeInTheDocument()

    // Select existing patient and submit a duplicate 409 first
    await selectExistingPatient(user)
    await chooseDoctor(user)
    fireEvent.change(screen.getByLabelText(/Expected time \(optional\)/i), { target: { value: '16:00' } })

    failDuplicate = true
    await submitAndConfirm(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/already has an active appointment with this doctor on this date/i)
    expect(screen.queryByRole('button', { name: /Check in their booking instead/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Book Appointment' })).toBeInTheDocument()

    // Now succeed for the future date
    failDuplicate = false
    await submitAndConfirm(user)

    expect(await screen.findByRole('heading', { name: 'Appointment Booked' })).toBeInTheDocument()
    expect(screen.getByText(/16:00/)).toBeInTheDocument()
    expect(writes.at(-1)?.url.endsWith('/api/appointments')).toBe(true)
    expect(writes.at(-1)?.body).toMatchObject({
      patient_id: 101,
      doctor_id: 10,
      department_id: 1,
      appointment_date: tomorrow,
      expected_time: '16:00:00',
      source: 'PHONE',
      issue_token: false,
    })
  })

  it('shows inline confirmation bar with full summary across all 3 modes and Edit preserves all inputs without sending a request', async () => {
    const { writes } = installApi({})
    const { user } = renderModal()

    // 1. Walk-in Check-in mode badge + inline confirm bar + Edit preservation
    expect(screen.getByTestId('opd-flow-badge')).toHaveTextContent('Walk-in Check-in')
    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'New consultation',
      }),
    )
    await user.selectOptions(screen.getByLabelText('Priority *'), 'PRIORITY')
    await user.type(screen.getByLabelText(/Reason for priority \*/i), 'Senior citizen')
    await user.type(screen.getByLabelText(/Remarks \(optional\)/i), 'Needs wheelchair')

    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())

    expect(writes).toHaveLength(0)
    const confirmBar = await screen.findByTestId('opd-confirm-bar')
    expect(within(confirmBar).getByText('Confirm check-in before issuing token')).toBeInTheDocument()
    expect(within(confirmBar).getByText('Walk-in Check-in')).toBeInTheDocument()
    expect(within(confirmBar).getByText('Ramesh Kumar')).toBeInTheDocument()
    expect(within(confirmBar).getByText('KH-2026-0001')).toBeInTheDocument()
    expect(within(confirmBar).getByText('Dr. Anil Kumar')).toBeInTheDocument()
    expect(within(confirmBar).getByText('Physiotherapy')).toBeInTheDocument()
    expect(within(confirmBar).getByText('₹400.00')).toBeInTheDocument()
    expect(within(confirmBar).getByText('High')).toBeInTheDocument()
    expect(within(confirmBar).getByText('Senior citizen')).toBeInTheDocument()
    expect(within(confirmBar).getByRole('button', { name: 'Confirm & Issue Token' })).toBeInTheDocument()

    // Clicking Edit closes confirm bar without POSTing and preserves every entered field
    await user.click(within(confirmBar).getByRole('button', { name: 'Edit' }))
    expect(screen.queryByTestId('opd-confirm-bar')).not.toBeInTheDocument()
    expect(writes).toHaveLength(0)
    expect(screen.getByLabelText(/Consulting doctor \*/i)).toHaveValue('1:10')
    expect(screen.getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(screen.getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')
    expect(screen.getByLabelText(/Remarks \(optional\)/i)).toHaveValue('Needs wheelchair')
    expect(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'New consultation',
      }),
    ).toHaveAttribute('aria-pressed', 'true')

    // 2. Advance Booking mode badge + confirm bar
    const tomorrow = shiftIsoDate(istToday(), 1)
    fireEvent.change(screen.getByLabelText(/Appointment date \*/i), { target: { value: tomorrow } })
    expect(screen.getByTestId('opd-flow-badge')).toHaveTextContent('Advance Booking')
    expect(submitButton()).toHaveTextContent('Book Appointment')
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())

    const bookingConfirmBar = await screen.findByTestId('opd-confirm-bar')
    expect(within(bookingConfirmBar).getByText('Confirm appointment details')).toBeInTheDocument()
    expect(within(bookingConfirmBar).getByText('Advance Booking')).toBeInTheDocument()
    expect(
      within(bookingConfirmBar).getByRole('button', { name: 'Confirm & Book Appointment' }),
    ).toBeInTheDocument()
    expect(writes).toHaveLength(0)

    // 3. Appointment Check-in mode badge + confirm bar
    cleanup()
    installApi({ today: [rameshBooking] })
    const { user: user2 } = renderModal({ initialBooking: rameshBooking })
    expect(screen.getByTestId('opd-flow-badge')).toHaveTextContent('Appointment Check-in')
    await user2.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'New consultation',
      }),
    )
    expect(submitButton()).toHaveTextContent('Check in Booking')
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user2.click(submitButton())
    const apptConfirmBar = await screen.findByTestId('opd-confirm-bar')
    expect(within(apptConfirmBar).getByText('Appointment Check-in')).toBeInTheDocument()
    expect(within(apptConfirmBar).getByRole('button', { name: 'Confirm & Issue Token' })).toBeInTheDocument()
  })

  it('shows doctor live queue load badge (Available and Waiting/In Cabin) and skips reception overview for non-reception roles', async () => {
    // 1. Zero load -> Available — 0 waiting
    installApi({
      doctorsToday: [
        {
          doctor_id: 10,
          name: 'Dr. Anil Kumar',
          appointments_today: 0,
          waiting: 0,
          pending_arrivals: 0,
          in_consultation: 0,
          done: 0,
        },
      ],
    })
    const { user } = renderModal()
    await chooseDoctor(user)
    expect(await screen.findByTestId('doctor-queue-load')).toHaveTextContent('Available — 0 waiting')

    // 2. Active load -> Waiting: (waiting + pending_arrivals) · In Cabin: in_consultation
    cleanup()
    installApi({
      doctorsToday: [
        {
          doctor_id: 10,
          name: 'Dr. Anil Kumar',
          appointments_today: 7,
          waiting: 3,
          pending_arrivals: 2,
          in_consultation: 1,
          done: 1,
        },
      ],
    })
    const { user: user2 } = renderModal()
    await chooseDoctor(user2)
    expect(await screen.findByTestId('doctor-queue-load')).toHaveTextContent('Waiting: 5 · In Cabin: 1')

    // 3. Non-reception role does NOT call /api/reception/overview
    cleanup()
    const { mockFetch } = installApi({
      me: { ...mockMe, role: 'ADMIN' },
    })
    const { user: user3 } = renderModal()
    await chooseDoctor(user3)
    expect(screen.getByTestId('doctor-queue-load')).toHaveTextContent('Available — 0 waiting')
    const overviewCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/api/reception/overview'),
    )
    expect(overviewCalls).toHaveLength(0)
  })

  it('preserves selected doctor on booking unlink and preserves visit fields when switching New patient and Existing patient', async () => {
    const priorityBooking: Appointment = {
      ...rameshBooking,
      priority_level: 'PRIORITY',
      priority_reason: 'Senior citizen',
    }
    installApi({ today: [priorityBooking] })
    const { user } = renderModal({ initialBooking: priorityBooking })

    // Wait for consulting doctors to load so option '1:10' exists
    await screen.findByText(/Consultation fee/)

    // Unlinking the booking preserves Dr. Anil Kumar (1:10) and priority details
    await user.click(screen.getByRole('button', { name: 'Not this booking' }))
    expect(screen.getByLabelText(/Consulting doctor \*/i)).toHaveValue('1:10')
    expect(screen.getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(screen.getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')

    // Switching to New patient preserves doctor & priority fields
    await user.click(
      within(screen.getByRole('group', { name: 'Patient type' })).getByRole('button', {
        name: /New patient/i,
      }),
    )
    expect(screen.getByLabelText(/Consulting doctor \*/i)).toHaveValue('1:10')
    expect(screen.getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(screen.getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')

    // Fill new patient details, switch to Existing patient and back — all fields stay intact
    await fillNewPatient(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Patient type' })).getByRole('button', {
        name: /Existing patient/i,
      }),
    )
    expect(screen.getByLabelText(/Consulting doctor \*/i)).toHaveValue('1:10')
    expect(screen.getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(screen.getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')

    await user.click(
      within(screen.getByRole('group', { name: 'Patient type' })).getByRole('button', {
        name: /New patient/i,
      }),
    )
    expect(screen.getByLabelText(/Patient name \*/i)).toHaveValue('Sita Devi')
    expect(screen.getByLabelText(/Age \(years\) \*/i)).toHaveValue(41)
    expect(screen.getByLabelText(/Phone number \*/i)).toHaveValue('9876500011')
    expect(screen.getByLabelText(/Consulting doctor \*/i)).toHaveValue('1:10')
    expect(screen.getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(screen.getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')
  })

  it('displays explicit permission-disabled alert when user lacks submit permission', async () => {
    installApi({
      me: { ...mockMe, permissions: ['patient:read', 'appointment:read'] },
    })
    renderModal()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your account does not have permission to perform this action.')
    expect(submitButton()).toBeDisabled()
  })

  it('warns on same-doctor active queue conflict today and on existing future-date bookings', async () => {
    const tomorrow = shiftIsoDate(istToday(), 1)
    const futureBooking: Appointment = {
      ...rameshBooking,
      id: 610,
      appointment_date: tomorrow,
      expected_time: '15:30:00',
      status: 'BOOKED',
      token_number: null,
      consultation_status: null,
    }
    const inCabinToday: Appointment = {
      ...checkedIn,
      id: 511,
      token_number: 14,
      status: 'IN_CONSULTATION',
      consultation_status: 'IN_CONSULTATION',
    }
    installApi({
      today: [inCabinToday],
      bookings: [inCabinToday, futureBooking],
    })
    const { user } = renderModal()

    await selectExistingPatient(user)
    await chooseDoctor(user)

    // Same-doctor active queue conflict today
    const conflictBanner = await screen.findByRole('status')
    expect(conflictBanner).toHaveTextContent('Same-doctor conflict — already checked in today')
    expect(conflictBanner).toHaveTextContent('Token #14 · Dr. Anil Kumar · Same doctor')
    expect(conflictBanner).toHaveTextContent('In Cabin')

    // Future date existing booking warning
    fireEvent.change(screen.getByLabelText(/Appointment date \*/i), { target: { value: tomorrow } })
    const futureBanner = await screen.findByRole('status')
    expect(futureBanner).toHaveTextContent(/Existing booking on/i)
    expect(futureBanner).toHaveTextContent('Dr. Anil Kumar at 15:30 · Same doctor (duplicate booking)')
  })

  it('replays exact same Idempotency-Key on timeout retry, resets key after edit, and blocks double-submit & escape hatches while pending', async () => {
    // 1. Timeout retry replays identical Idempotency-Key and succeeds on retry
    let shouldTimeout = true
    const { writes } = installApi({
      write: () => {
        if (shouldTimeout) {
          throw new ApiError(0, 'request_timeout', 'Request timed out.', { isTimeout: true })
        }
        return jsonResponse(201, { ...checkedIn, id: 520, status: 'CHECKED_IN', source: 'WALK_IN' })
      },
    })
    const { user } = renderModal()

    await selectExistingPatient(user)
    await chooseDoctor(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'New consultation',
      }),
    )
    await submitAndConfirm(user)

    await waitFor(() => expect(writes).toHaveLength(1))
    const firstKey = writes[0].headers['Idempotency-Key']
    expect(firstKey).toBeTruthy()

    const confirmBar = screen.getByTestId('opd-confirm-bar')
    expect(within(confirmBar).getByRole('alert')).toHaveTextContent(
      'Connection timed out — click Confirm again to retry safely without creating a duplicate token.',
    )

    shouldTimeout = false
    await user.click(within(confirmBar).getByRole('button', { name: 'Confirm & Issue Token' }))

    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(writes).toHaveLength(2)
    expect(writes[1].headers['Idempotency-Key']).toBe(firstKey)

    // 2. Editing an input after timeout resets Idempotency-Key
    cleanup()
    let failFirstEdit = true
    const { writes: editWrites } = installApi({
      write: () => {
        if (failFirstEdit) {
          failFirstEdit = false
          throw new ApiError(0, 'request_timeout', 'Request timed out.', { isTimeout: true })
        }
        return jsonResponse(201, { ...checkedIn, id: 521, status: 'CHECKED_IN', source: 'WALK_IN' })
      },
    })
    const { user: user2 } = renderModal()
    await selectExistingPatient(user2)
    await chooseDoctor(user2)
    await user2.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'New consultation',
      }),
    )
    await submitAndConfirm(user2)
    await waitFor(() => expect(editWrites).toHaveLength(1))
    const keyBeforeEdit = editWrites[0].headers['Idempotency-Key']
    expect(keyBeforeEdit).toBeTruthy()

    await user2.click(within(screen.getByTestId('opd-confirm-bar')).getByRole('button', { name: 'Edit' }))
    await user2.type(screen.getByLabelText(/Remarks \(optional\)/i), 'Edited after timeout')
    await submitAndConfirm(user2)

    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(editWrites).toHaveLength(2)
    const keyAfterEdit = editWrites[1].headers['Idempotency-Key']
    expect(keyAfterEdit).toBeTruthy()
    expect(keyAfterEdit).not.toBe(keyBeforeEdit)

    // 3. Double-clicking confirm while pending fires ONLY ONE POST and locks escape hatches
    cleanup()
    let resolveDeferred: ((res: ReturnType<typeof jsonResponse>) => void) | null = null
    const { writes: pendingWrites } = installApi({
      write: () =>
        new Promise((resolve) => {
          resolveDeferred = resolve
        }),
    })
    const { user: user3 } = renderModal()
    await selectExistingPatient(user3)
    await chooseDoctor(user3)
    await user3.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'New consultation',
      }),
    )
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user3.click(submitButton())
    const pendingBar = await screen.findByTestId('opd-confirm-bar')
    const confirmBtn = within(pendingBar).getByRole('button', { name: 'Confirm & Issue Token' })

    // Synchronous double-click exercises inFlightRef before React re-renders disabled state
    fireEvent.click(confirmBtn)
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(pendingWrites).toHaveLength(1))
    expect(within(pendingBar).getByRole('button', { name: /Issuing token/i })).toBeDisabled()
    expect(within(pendingBar).getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear form' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Not this patient' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Patient file' })).toHaveAttribute('aria-disabled', 'true')

    await act(async () => {
      resolveDeferred?.(
        jsonResponse(201, { ...checkedIn, id: 522, status: 'CHECKED_IN', source: 'WALK_IN' }),
      )
    })
    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(pendingWrites).toHaveLength(1)
  })
})

describe('PriorityModal — Double-Submit Guard & Disabled-Reason UX', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('disables Save with inline reason hint for <3 chars and guards rapid double-submit while pending', async () => {
    let resolvePatch: ((res: ReturnType<typeof jsonResponse>) => void) | null = null
    const { writes } = installApi({
      write: () =>
        new Promise((resolve) => {
          resolvePatch = resolve
        }),
    })
    const onClose = vi.fn()
    const queryClient = makeQueryClient()
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <PriorityModal open appointment={checkedIn} onClose={onClose} />
      </QueryClientProvider>,
    )

    const saveBtn = screen.getByRole('button', { name: 'Save priority' })
    const levelSelect = screen.getByLabelText(/Priority \*/i)
    const reasonInput = screen.getByLabelText(/Reason \*/i)

    expect(saveBtn).toBeDisabled()
    expect(screen.getByText(/Enter a reason of at least 3 characters/i)).toBeInTheDocument()

    await user.selectOptions(levelSelect, 'EMERGENCY')
    await user.type(reasonInput, 'ab')
    expect(saveBtn).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a reason of at least 3 characters to set Priority or Emergency.',
    )

    await user.type(reasonInput, 'c')
    expect(saveBtn).toBeEnabled()

    // Synchronous double-click exercises inFlightRef before React re-renders isPending
    fireEvent.click(saveBtn)
    fireEvent.click(saveBtn)

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].method).toBe('PATCH')
    expect(writes[0].url).toContain('/api/appointments/501/priority')
    expect(writes[0].body).toMatchObject({
      priority_level: 'EMERGENCY',
      priority_reason: 'abc',
      version_id: 2,
    })
    expect(levelSelect).toBeDisabled()
    expect(reasonInput).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled()

    await act(async () => {
      resolvePatch?.(
        jsonResponse(200, { ...checkedIn, priority_level: 'EMERGENCY', priority_reason: 'abc', version_id: 3 }),
      )
    })

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(writes).toHaveLength(1)
  })
})

describe('AppointmentsReception integration & Legacy /reception/tokens redirect', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens CreateOpdTokenModal from top-right Create OPD Token button and checks in an unarrived booking preserving priority', async () => {
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
      today: [priorityBooking],
      write: () => jsonResponse(200, priorityCheckedIn),
    })
    const { user } = renderAppointments()

    // Wait for AppointmentsReception to load its rows
    const row = (await screen.findByText('Ramesh Kumar')).closest('tr') as HTMLElement

    // Top-right Create OPD Token button opens the blank modal and closes cleanly
    await user.click(screen.getByRole('button', { name: 'Create OPD Token' }))
    const blankDialog = await screen.findByRole('dialog', { name: 'Create OPD Token' })
    expect(within(blankDialog).getByLabelText(/Appointment date \*/i)).toHaveValue(istToday())
    await user.click(within(blankDialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Create OPD Token' })).not.toBeInTheDocument()

    // Clicking Check in on a BOOKED row opens the modal preloaded with that booking & priority
    await user.click(within(row).getByRole('button', { name: 'Check in' }))
    const checkInDialog = await screen.findByRole('dialog', { name: 'Create OPD Token' })
    expect(within(checkInDialog).getByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar at 10:30')
    expect(within(checkInDialog).queryByLabelText(/Appointment date/i)).not.toBeInTheDocument()
    expect(within(checkInDialog).getByLabelText('Priority *')).toHaveValue('PRIORITY')
    expect(within(checkInDialog).getByLabelText(/Reason for priority \*/i)).toHaveValue('Senior citizen')

    await user.click(
      within(within(checkInDialog).getByRole('group', { name: 'Consultation type' })).getByRole('button', {
        name: 'New consultation',
      }),
    )
    expect(submitButton()).toHaveTextContent('Check in Booking')
    await submitAndConfirm(user)

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(await screen.findByRole('heading', { name: 'Token Generated' })).toBeInTheDocument()
    expect(writes[0].url).toContain('/api/appointments/501/check-in')
    expect(writes[0].body).toMatchObject({
      version_id: 1,
      patient_id: 101,
      priority_level: 'PRIORITY',
      priority_reason: 'Senior citizen',
    })
  })

  it('checks in REGISTERED and URN-bearing TO_ARRIVE bookings from AppointmentsReception rows', async () => {
    const registeredBooking: Appointment = {
      ...rameshBooking,
      id: 505,
      status: 'REGISTERED',
      token_number: 7,
      consultation_status: null,
    }
    const toArriveBooking: Appointment = {
      ...rameshBooking,
      id: 506,
      status: 'TO_ARRIVE',
      token_number: 8,
      consultation_status: null,
    }
    const { writes } = installApi({
      today: [registeredBooking, toArriveBooking],
      write: () => jsonResponse(200, { ...checkedIn, id: 505 }),
    })
    const { user } = renderAppointments()

    const rows = (await screen.findAllByText('Ramesh Kumar')).map((el) => el.closest('tr') as HTMLElement)
    expect(rows).toHaveLength(2)
    await user.click(within(rows[0]).getByRole('button', { name: 'Check in' }))
    expect(await screen.findByText(/Booked appointment with/)).toBeInTheDocument()

    await user.click(
      within(screen.getByRole('group', { name: 'Consultation type' })).getByRole('button', { name: 'New consultation' }),
    )
    await submitAndConfirm(user)
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].url).toContain('/api/appointments/505/check-in')
    expect(writes[0].body).toMatchObject({ patient_id: 101 })
  })

  it('opens modal automatically on deep-link, clears preset query params on Clear form, and ignores invalid params', async () => {
    installApi({ today: [rameshBooking], bookings: [rameshBooking] })
    const { user } = renderAppointments('/reception/appointments?patient_id=101&appointment_id=501')

    expect(await screen.findByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar')
    expect(screen.getByRole('button', { name: /Existing patient/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText(/Appointment date/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('router-search')).toHaveTextContent('?patient_id=101&appointment_id=501')

    await user.click(screen.getByRole('button', { name: 'Clear form' }))
    expect(screen.queryByText(/Booked appointment with/)).not.toBeInTheDocument()
    expect(screen.getByTestId('router-search')).toHaveTextContent('')

    // Invalid params (0, non-numeric) do not open the modal or fetch /api/patients/0
    cleanup()
    const { mockFetch } = installApi({ today: [rameshBooking] })
    renderAppointments('/reception/appointments?patient_id=0&appointment_id=abc')
    await screen.findByText('Ramesh Kumar')
    expect(screen.queryByRole('dialog', { name: 'Create OPD Token' })).not.toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/patients/0'), expect.anything())
  })

  it('preserves and dismisses location.state.notice as a centered toast on AppointmentsReception', async () => {
    installApi({})
    const { user } = renderAppointments({
      pathname: '/reception/appointments',
      state: { notice: 'Patient registered and checked in (Token #14).' },
    })

    const toastHost = await screen.findByTestId('toast-host')
    const status = within(toastHost).getByRole('status')
    expect(status).toHaveTextContent('Patient registered and checked in (Token #14).')
    await user.click(within(status).getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByText('Patient registered and checked in (Token #14).')).not.toBeInTheDocument()
  })

  it('redirects legacy /reception/tokens?patient_id=101&appointment_id=501 to /reception/appointments preserving query params and state', async () => {
    installApi({ today: [rameshBooking], bookings: [rameshBooking] })
    const queryClient = makeQueryClient()
    const memRouter = createMemoryRouter(router.routes, {
      initialEntries: [
        {
          pathname: '/reception/tokens',
          search: '?patient_id=101&appointment_id=501',
          state: { notice: 'Patient registered and checked in (Token #14).' },
        },
      ],
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={memRouter} />
      </QueryClientProvider>,
    )

    // Redirects cleanly to /reception/appointments preserving query params
    await waitFor(() => {
      expect(memRouter.state.location.pathname).toBe('/reception/appointments')
      expect(memRouter.state.location.search).toBe('?patient_id=101&appointment_id=501')
    })

    // Preserves location.state.notice (rendered as toast) and deep-links open the check-in modal
    const toastHost = await screen.findByTestId('toast-host')
    expect(within(toastHost).getByRole('status')).toHaveTextContent(
      'Patient registered and checked in (Token #14).',
    )
    const dialog = await screen.findByRole('dialog', { name: 'Create OPD Token' })
    expect(within(dialog).getByText(/Booked appointment with/)).toHaveTextContent('Dr. Anil Kumar')
  })
})
