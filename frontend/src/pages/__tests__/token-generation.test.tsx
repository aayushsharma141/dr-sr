import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
    code: 'PHYSIOTHERAPY', name_en: 'Physiotherapy',
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

const baseAppointment: Appointment = {
  id: 201,
  patient_id: 99,
  patient_name: 'Prior Patient',
  patient_urn: 'KH-2026-0000',
  patient_mobile: '9876500000',
  doctor_id: 10,
  doctor_name_en: 'Dr. Anil Kumar',
  doctor_name_hi: 'डॉ अनिल कुमार',
  appointment_date: istToday(),
  token_number: 13,
  status: 'ARRIVED',
  consultation_status: 'WAITING',
  status_updated_at: '2026-11-06T09:00:00Z',
  cancellation_reason: null,
  notes: null,
  version_id: 1,
  created_at: '2026-11-06T09:00:00Z',
  updated_at: '2026-11-06T09:00:00Z',
}

/** The doctor's queue for today: one patient already waiting with token 13. */
const doctorQueue = { appointments: [baseAppointment], total: 1 }

/** A booking for Ramesh made earlier, still waiting for him; it has no token yet. */
const rameshBooking: Appointment = {
  ...baseAppointment,
  id: 501,
  patient_id: 101,
  patient_name: 'Ramesh Kumar',
  patient_urn: 'KH-2026-0001',
  patient_mobile: '9876543210',
  department_id: 1,
  token_number: null,
  status: 'BOOKED',
  consultation_status: null,
  expected_time: '10:30:00',
  source: 'PHONE',
}

/** What the server returns once Ramesh is checked in. */
const checkedIn: Appointment = {
  ...rameshBooking,
  token_number: 14,
  status: 'ARRIVED',
  consultation_status: 'WAITING',
  visit_id: 77,
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
  body: unknown
}

/**
 * A fake API for the Token Desk. `bookings` is what GET /appointments returns for the selected
 * patient; `write` answers the one write the desk makes (a walk-in or a check-in).
 */
function installApi(options: {
  bookings?: Appointment[]
  doctors?: DepartmentDoctorOut[]
  write?: (url: string) => ReturnType<typeof jsonResponse>
}) {
  const writes: Write[] = []
  const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      writes.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : null })
      return Promise.resolve(options.write?.(url) ?? jsonResponse(500, { message: 'unexpected write' }))
    }
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(200, mockMe))
    if (url.includes('/api/departments/1/doctors'))
      return Promise.resolve(jsonResponse(200, options.doctors ?? mockDoctors))
    if (url.includes('/api/departments')) return Promise.resolve(jsonResponse(200, mockDepartments))
    if (url.includes('/api/patients') && !url.includes('check-duplicate'))
      return Promise.resolve(jsonResponse(200, [mockPatient]))
    if (url.includes('/api/appointments') && url.includes('patient_id=101'))
      return Promise.resolve(
        jsonResponse(200, { appointments: options.bookings ?? [], total: options.bookings?.length ?? 0 }),
      )
    if (url.includes('/api/appointments')) return Promise.resolve(jsonResponse(200, doctorQueue))
    return Promise.reject(new Error(`Unhandled URL: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)
  return { writes }
}

function renderDesk() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TokenGenerationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

async function selectPatient(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/Search by Name, Mobile or Patient ID/i), 'Ramesh')
  await waitFor(() => {
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
  })
  await user.click(screen.getByRole('button', { name: /Ramesh Kumar KH-2026-0001 9876543210/i }))
  await waitFor(() => {
    expect(screen.getByText('Existing')).toBeInTheDocument()
  })
}

async function pickDepartmentAndDoctor(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'Physiotherapy' })).toBeInTheDocument()
  })
  await user.selectOptions(screen.getByLabelText(/Department \*/i), '1')
  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Dr\. Anil Kumar/i })).toBeInTheDocument()
  })
  await user.selectOptions(screen.getByLabelText(/Doctor \*/i), '10')
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

describe('TokenGenerationPage check-in desk', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('registers a walk-in with one call, and shows the token the server issued', async () => {
    const { writes } = installApi({
      write: () => jsonResponse(201, { ...checkedIn, id: 502, status: 'ARRIVED', source: 'WALK_IN' }),
    })
    const user = renderDesk()

    expect(screen.getByRole('heading', { name: /Token Desk/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Patient' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Visit Details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Token Preview' })).toBeInTheDocument()

    await selectPatient(user)
    await pickDepartmentAndDoctor(user)

    // The token that comes next is shown before anything is saved: the doctor's queue has 13.
    await waitFor(() => {
      expect(screen.getByTestId('token-preview-number')).toHaveTextContent('P-014')
    })

    const issueBtn = screen.getByRole('button', { name: /Register Walk-in & Issue Token/i })
    expect(issueBtn).toBeEnabled()
    await user.click(issueBtn)

    await waitFor(() => {
      expect(screen.getByText(/Token Allocated Successfully!/i)).toBeInTheDocument()
    })
    expect(screen.getByText('#14')).toBeInTheDocument()

    // One write, to the walk-in endpoint: no separate booking, no separate arrival update.
    expect(writes).toEqual([
      {
        method: 'POST',
        url: expect.stringContaining('/api/appointments/walk-in'),
        body: { patient_id: 101, department_id: 1, doctor_id: 10, notes: null },
      },
    ])
  })

  it('does not take payment or add a charge: fees are collected at checkout', async () => {
    installApi({})
    const user = renderDesk()

    await selectPatient(user)
    await pickDepartmentAndDoctor(user)

    expect(screen.queryByLabelText(/Consultation \/ Service/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/charge will be added/i)).not.toBeInTheDocument()
    expect(screen.getByText(/No payment is taken here/i)).toHaveTextContent(
      'Consultation fee: ₹400.00',
    )
  })

  it('checks in the booking the patient made, and keeps its details out of the walk-in form', async () => {
    const { writes } = installApi({
      bookings: [rameshBooking],
      write: () => jsonResponse(200, checkedIn),
    })
    const user = renderDesk()

    await selectPatient(user)

    // A patient with a booking today is offered it, with the time they said they would come.
    const booking = await screen.findByRole('radio', { name: /Dr\. Anil Kumar/i })
    expect(booking).toBeChecked()
    expect(screen.getByText(/Expected 10:30/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Department \*/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Register Walk-in/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Check In & Issue Token/i }))

    await waitFor(() => {
      expect(screen.getByText(/Token Allocated Successfully!/i)).toBeInTheDocument()
    })
    expect(screen.getByText('#14')).toBeInTheDocument()
    expect(writes).toEqual([
      {
        method: 'POST',
        url: expect.stringContaining('/api/appointments/501/check-in'),
        body: { version_id: 1 },
      },
    ])
  })

  it('offers a booking marked not arrived, as a late arrival', async () => {
    installApi({ bookings: [{ ...rameshBooking, status: 'NO_SHOW' }] })
    const user = renderDesk()

    await selectPatient(user)

    expect(await screen.findByText(/marked not arrived, late/i)).toBeInTheDocument()
  })

  it('does not offer bookings that are already checked in, or belong to another patient', async () => {
    installApi({
      bookings: [
        { ...rameshBooking, id: 601, status: 'ARRIVED', token_number: 3 },
        { ...rameshBooking, id: 602, patient_id: 55 },
      ],
    })
    const user = renderDesk()

    await selectPatient(user)

    // Nothing to check in, so the desk stays on a walk-in.
    await pickDepartmentAndDoctor(user)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Register Walk-in & Issue Token/i })).toBeEnabled()
  })

  it('shows the token with the doctor\'s cabin letter when they have one', async () => {
    installApi({
      doctors: [{ ...mockDoctors[0], cabin_code: 'B' }],
      write: () => jsonResponse(201, { ...checkedIn, id: 503 }),
    })
    const user = renderDesk()

    await selectPatient(user)
    await pickDepartmentAndDoctor(user)
    await waitFor(() => {
      expect(screen.getByTestId('token-preview-number')).toHaveTextContent('B-14')
    })
    await user.click(screen.getByRole('button', { name: /Register Walk-in & Issue Token/i }))

    await waitFor(() => {
      expect(screen.getByText(/Token Allocated Successfully!/i)).toBeInTheDocument()
    })
    expect(screen.getAllByText('B-14').length).toBeGreaterThan(0)
  })

  it('shows no success and no token when the server refuses the walk-in (BR-008)', async () => {
    installApi({
      write: () =>
        jsonResponse(409, {
          code: 'open_visit_from_earlier_day',
          message: 'This patient still has an open visit from 01 Nov 2026. Close or cancel it first.',
        }),
    })
    const user = renderDesk()

    await selectPatient(user)
    await pickDepartmentAndDoctor(user)
    await user.click(screen.getByRole('button', { name: /Register Walk-in & Issue Token/i }))

    // The walk-in is all or nothing, so a refusal leaves no half-done booking to chase up.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('still has an open visit')
    expect(screen.queryByText(/Token Allocated Successfully!/i)).not.toBeInTheDocument()
    expect(screen.queryByText('#14')).not.toBeInTheDocument()
  })

  it('points a walk-in for an already booked patient at their booking', async () => {
    installApi({
      bookings: [],
      write: () =>
        jsonResponse(409, {
          code: 'duplicate_appointment',
          message: 'Patient already has an active appointment with this doctor on this date.',
        }),
    })
    const user = renderDesk()

    await selectPatient(user)
    await pickDepartmentAndDoctor(user)
    await user.click(screen.getByRole('button', { name: /Register Walk-in & Issue Token/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('already has a booking with this doctor today')

    await user.click(screen.getByRole('button', { name: /Check in their booking instead/i }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Check In & Issue Token/i })).toBeInTheDocument()
  })
})
