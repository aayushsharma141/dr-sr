import '../../test/dialog-shim'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { InitialEntry } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppointmentsReception } from '../AppointmentsReception'
import type {
  Appointment,
  AppointmentListResponse,
  DepartmentDoctorOut,
  DoctorOut,
  Me,
  OpdArrival,
  PatientOut,
  ReceptionFollowUpResponse,
} from '../../api/types'
import { istToday } from '../../format'

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const today = istToday()
const tomorrow = shiftDate(today, 1)
const yesterday = shiftDate(today, -1)

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['appointment:read', 'appointment:write', 'visit:write', 'patient:create'],
  version_id: 1,
}

const doctorMe: Me = {
  ...mockMe,
  id: 3,
  role: 'DOCTOR',
  username: 'doctor',
  full_name: 'Dr. Madan Mohan Dwivedi',
  permissions: ['appointment:read', 'appointment:write', 'prescription:read'],
  doctor_id: 1,
}

const adminMe: Me = {
  ...mockMe,
  id: 1,
  role: 'ADMIN',
  username: 'admin',
  full_name: 'System Administrator',
  permissions: ['appointment:read'],
}

const mockDoctors: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr. Madan Mohan Dwivedi',
    name_hi: 'डॉ मदन मोहन द्विवेदी',
    qualification: 'Senior Physiotherapist',
    registration_number: 'PT-12345',
    cabin_code: 'A',
    default_fee_paise: 50000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
  {
    id: 2,
    name_en: 'Dr. Priya Sharma',
    name_hi: 'डॉ प्रिया शर्मा',
    qualification: 'MD Medicine',
    registration_number: 'MD-67890',
    cabin_code: null,
    default_fee_paise: 40000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
]

const mockDepartmentDoctors: DepartmentDoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr. Madan Mohan Dwivedi',
    name_hi: 'डॉ मदन मोहन द्विवेदी',
    qualification: 'Senior Physiotherapist',
    cabin_code: 'A',
    default_fee_paise: 50000,
  },
  {
    id: 2,
    name_en: 'Dr. Priya Sharma',
    name_hi: 'डॉ प्रिया शर्मा',
    qualification: 'MD Medicine',
    cabin_code: null,
    default_fee_paise: 40000,
  },
]

const mockDepartments = [
  { id: 1, name_en: 'Physiotherapy', name_hi: 'फिजियोथेरेपी', is_active: true },
]

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 10,
    patient_id: 101,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Aarav Kumar',
    patient_mobile: '9876543210',
    doctor_id: 1,
    department_id: 1,
    doctor_name_en: 'Dr. Madan Mohan Dwivedi',
    doctor_name_hi: 'डॉ मदन मोहन द्विवेदी',
    department_name: 'Physiotherapy',
    appointment_date: today,
    expected_time: '10:30:00',
    token_number: 1,
    status: 'BOOKED',
    status_updated_at: '2026-01-01T10:00:00Z',
    cancellation_reason: null,
    notes: 'Knee rehabilitation',
    consultation_status: null,
    priority_level: 'NORMAL',
    priority_reason: null,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

function makeArrival(overrides: Partial<OpdArrival> = {}): OpdArrival {
  return {
    id: 901,
    full_name: 'Aayush Kumar',
    age_years: 26,
    mobile: '9811122233',
    doctor_id: 1,
    doctor_name_en: 'Dr. Madan Mohan Dwivedi',
    department_id: 1,
    department_name: 'Physiotherapy',
    appointment_date: today,
    token_number: 5,
    priority_level: 'NORMAL',
    priority_reason: null,
    status: 'TO_ARRIVE',
    version_id: 1,
    created_at: `${today}T03:00:00Z`,
    ...overrides,
  }
}

function makePatient(overrides: Partial<PatientOut> = {}): PatientOut {
  return {
    id: 101,
    urn: 'KH-2026-0001',
    full_name: 'Aarav Kumar',
    guardian_name: 'Rajesh Kumar',
    gender: 'M',
    dob: '1992-05-10',
    age_years: 34,
    computed_age_years: 34,
    mobile: '9876543210',
    address: 'Civil Lines',
    district: 'Lucknow',
    state: 'UP',
    emergency_contact: null,
    allergies: '',
    notes: null,
    photo_path: null,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    ...overrides,
  } as PatientOut
}

function makeReceptionFollowUp(
  overrides: Partial<ReceptionFollowUpResponse> = {},
): ReceptionFollowUpResponse {
  return {
    id: 501,
    encounter_id: 90,
    patient_id: 101,
    patient_name: 'Aarav Kumar',
    patient_urn: 'KH-2026-0001',
    patient_mobile: '9876543210',
    recommended_doctor_id: 1,
    recommended_doctor_name: 'Dr. Madan Mohan Dwivedi',
    recommended_date: shiftDate(today, 7),
    status: 'PENDING',
    booked_appointment_id: null,
    created_at: `${today}T06:00:00Z`,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

type FetchOverride = (
  url: string,
  init?: RequestInit,
) => ReturnType<typeof jsonResponse> | Promise<ReturnType<typeof jsonResponse>> | undefined

function LocationProbe({ onLocation }: { onLocation?: (loc: ReturnType<typeof useLocation>) => void }) {
  const loc = useLocation()
  onLocation?.(loc)
  return null
}

function NavigatedTarget() {
  const loc = useLocation()
  return <div data-testid="navigated-to">{`${loc.pathname}${loc.search}`}</div>
}

function renderAppointments({
  me = mockMe,
  appointments = [makeAppointment()],
  arrivals = [],
  patients = [],
  followUps = [],
  receptionFollowUps = [],
  initialEntries = ['/reception/appointments'],
  onFetch,
  onLocation,
}: {
  me?: Me
  appointments?: Appointment[]
  arrivals?: OpdArrival[]
  patients?: PatientOut[]
  followUps?: unknown[]
  receptionFollowUps?: ReceptionFollowUpResponse[]
  initialEntries?: InitialEntry[]
  onFetch?: FetchOverride
  onLocation?: (loc: ReturnType<typeof useLocation>) => void
} = {}) {
  const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const custom = onFetch?.(url, init)
    if (custom) return Promise.resolve(custom)
    if (url.includes('/api/health')) {
      return Promise.resolve(jsonResponse({ status: 'ok', db: 'ok', setup_required: false }))
    }
    if (url.includes('/api/reception/overview')) {
      return Promise.resolve(
        jsonResponse({
          role: 'RECEPTION',
          doctors_today: mockDoctors.map((d) => ({
            doctor_id: d.id,
            name: d.name_en,
            appointments_today: 0,
            waiting: 0,
            in_consultation: 0,
            done: 0,
            pending_arrivals: 0,
            department: 'Physiotherapy',
          })),
        }),
      )
    }
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(me))
    if (/\/api\/departments\/\d+\/doctors/.test(url)) {
      return Promise.resolve(jsonResponse(mockDepartmentDoctors))
    }
    if (/\/api\/doctors\/\d+\/departments/.test(url)) {
      return Promise.resolve(jsonResponse(mockDepartments))
    }
    if (url.includes('/api/departments')) return Promise.resolve(jsonResponse(mockDepartments))
    if (url.includes('/api/doctors')) return Promise.resolve(jsonResponse(mockDoctors))
    if (url.includes('/api/opd-arrivals')) {
      const parsed = new URL(url, 'http://localhost')
      const doctorIdParam = parsed.searchParams.get('doctor_id')
      const filteredArrivals = doctorIdParam
        ? arrivals.filter((a) => a.doctor_id === Number(doctorIdParam))
        : arrivals
      return Promise.resolve(jsonResponse({ total: filteredArrivals.length, arrivals: filteredArrivals }))
    }
    if (url.includes('/api/reception/follow-ups')) {
      const parsed = new URL(url, 'http://localhost')
      const statusParam = parsed.searchParams.get('status')
      const overdueParam = parsed.searchParams.get('overdue')
      let filtered = receptionFollowUps
      if (statusParam) {
        filtered = filtered.filter((r) => r.status === statusParam.toUpperCase())
      }
      if (overdueParam === 'true') {
        filtered = filtered.filter((r) => r.status === 'PENDING' && r.recommended_date < today)
      }
      return Promise.resolve(jsonResponse(filtered))
    }
    if (url.includes('/api/prescriptions/follow-ups')) {
      return Promise.resolve(jsonResponse(followUps))
    }
    const singleApptMatch = url.match(/\/api\/appointments\/(\d+)(\?|$)/)
    if (singleApptMatch && (!init?.method || init.method === 'GET')) {
      const id = Number(singleApptMatch[1])
      const found = appointments.find((a) => a.id === id)
      return Promise.resolve(
        found ? jsonResponse(found) : jsonResponse({ code: 'not_found', message: 'Not found' }, 404),
      )
    }
    if (url.includes('/api/appointments')) {
      const parsed = new URL(url, 'http://localhost')
      const doctorIdParam = parsed.searchParams.get('doctor_id')
      const patientIdParam = parsed.searchParams.get('patient_id')
      let filtered = appointments
      if (doctorIdParam) {
        filtered = filtered.filter((a) => a.doctor_id === Number(doctorIdParam))
      }
      if (patientIdParam) {
        filtered = filtered.filter((a) => a.patient_id === Number(patientIdParam))
      }
      const resp: AppointmentListResponse = {
        total: filtered.length,
        appointments: filtered,
      }
      return Promise.resolve(jsonResponse(resp))
    }
    const singlePatientMatch = url.match(/\/api\/patients\/(\d+)(\?|$)/)
    if (singlePatientMatch && (!init?.method || init.method === 'GET')) {
      const id = Number(singlePatientMatch[1])
      const explicit = patients.find((p) => p.id === id)
      if (explicit) return Promise.resolve(jsonResponse(explicit))
      const fromAppt = appointments.find((a) => a.patient_id === id)
      if (fromAppt) {
        return Promise.resolve(
          jsonResponse(
            makePatient({
              id: fromAppt.patient_id,
              urn: fromAppt.patient_urn,
              full_name: fromAppt.patient_name,
              mobile: fromAppt.patient_mobile,
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ code: 'not_found', message: 'Not found' }, 404))
    }
    if (url.includes('/api/patients')) return Promise.resolve(jsonResponse(patients))
    return Promise.reject(new Error(`Unhandled: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/reception/appointments"
            element={
              <>
                <LocationProbe onLocation={onLocation} />
                <AppointmentsReception />
              </>
            }
          />
          <Route path="*" element={<NavigatedTarget />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { mockFetch }
}

async function openRowMoreMenu(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  const moreBtn = within(row).getByRole('button', { name: 'More' })
  await user.click(moreBtn)
  const menu = within(row).getByRole('menu')
  return { moreBtn, menu }
}

describe('AppointmentsReception', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('Header, 8-column layout, Create OPD Token modal & location notice', () => {
    it('shows single Create OPD Token button, 8-column table with cabin tokens & pending arrivals, no duplicate counters, and opens token modal', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({
            id: 10,
            patient_id: 101,
            patient_urn: 'KH-2026-0001',
            patient_name: 'Aarav Kumar',
            doctor_id: 1,
            doctor_name_en: 'Dr. Madan Mohan Dwivedi',
            expected_time: '10:30:00',
            token_number: 1,
          }),
          makeAppointment({
            id: 11,
            patient_id: 102,
            patient_urn: 'KH-2026-0002',
            patient_name: 'Meera Devi',
            doctor_id: 2,
            doctor_name_en: 'Dr. Priya Sharma',
            department_name: 'General Medicine',
            expected_time: null,
            token_number: 2,
          }),
          makeAppointment({
            id: 12,
            patient_id: 103,
            patient_urn: 'KH-2026-0003',
            patient_name: 'Rohan Das',
            doctor_id: 1,
            expected_time: null,
            token_number: null,
          }),
        ],
        arrivals: [
          makeArrival({
            id: 901,
            full_name: 'Aayush Arrival',
            doctor_id: 1,
            token_number: 3,
          }),
        ],
      })

      await screen.findByText('Aarav Kumar')
      await screen.findByText('A-1')

      // Reception header: ONLY ONE primary button ("Create OPD Token"), tabs for Appointments (default) & Follow-ups
      const main = screen.getByRole('main')
      expect(within(main).getByRole('heading', { level: 1, name: 'Appointments' })).toBeInTheDocument()
      expect(within(main).getByRole('tablist')).toBeInTheDocument()
      expect(within(main).getByRole('tab', { name: 'Appointments' })).toHaveAttribute('aria-selected', 'true')
      expect(within(main).getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'false')
      expect(within(main).getAllByRole('button', { name: /create opd token/i })).toHaveLength(1)
      expect(within(main).queryByRole('button', { name: /book appointment/i })).not.toBeInTheDocument()
      expect(within(main).queryByRole('link', { name: /book appointment/i })).not.toBeInTheDocument()
      expect(within(main).queryByRole('link', { name: /check-in & token/i })).not.toBeInTheDocument()
      expect(within(main).queryByRole('link', { name: /new patient/i })).not.toBeInTheDocument()

      // Duplicate toolbar counters are removed; counts live strictly in the 7-pill filter bar
      expect(within(main).queryByText('4 To Arrive')).not.toBeInTheDocument()
      expect(within(main).queryByText('0 Checked In')).not.toBeInTheDocument()

      // 8-column table
      const table = screen.getByRole('table')
      const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
      expect(headers).toEqual([
        'Token',
        'Time',
        'Patient',
        'Department',
        'Doctor',
        'Status',
        'Priority',
        'Action',
      ])

      // Registered patient with cabin code A -> A-1, link + URN, separate Department/Doctor/Priority columns, no mobile or Hindi doctor name
      const aaravRow = within(table).getByText('Aarav Kumar').closest('tr')!
      const aaravCells = within(aaravRow).getAllByRole('cell')
      expect(aaravCells[0]).toHaveTextContent('A-1')
      expect(aaravCells[1]).toHaveTextContent('10:30')
      expect(within(aaravCells[2]).getByRole('link', { name: 'Aarav Kumar' })).toHaveAttribute(
        'href',
        '/reception/patients/101',
      )
      expect(within(aaravCells[2]).getByText('KH-2026-0001')).toBeInTheDocument()
      expect(within(aaravRow).queryByText('9876543210')).not.toBeInTheDocument()
      expect(aaravCells[3]).toHaveTextContent('Physiotherapy')
      expect(aaravCells[4]).toHaveTextContent('Dr. Madan Mohan Dwivedi')
      expect(within(aaravRow).queryByText('डॉ मदन मोहन द्विवेदी')).not.toBeInTheDocument()
      expect(within(aaravCells[6]).getByText('Normal')).toBeInTheDocument()

      // Doctor without cabin code -> #2
      const meeraRow = within(table).getByText('Meera Devi').closest('tr')!
      const meeraCells = within(meeraRow).getAllByRole('cell')
      expect(meeraCells[0]).toHaveTextContent('#2')
      expect(meeraCells[1]).toHaveTextContent('—')
      expect(meeraCells[3]).toHaveTextContent('General Medicine')

      // Null token -> —
      const rohanRow = within(table).getByText('Rohan Das').closest('tr')!
      const rohanCells = within(rohanRow).getAllByRole('cell')
      expect(rohanCells[0]).toHaveTextContent('—')
      expect(rohanCells[1]).toHaveTextContent('—')
      expect(within(table).queryByText(/null/i)).not.toBeInTheDocument()

      // Pending OpdArrival row -> cabin token A-3, plain name (no link), "Pending registration"
      const arrivalRow = within(table).getByText('Aayush Arrival').closest('tr')!
      expect(within(arrivalRow).getByText('A-3')).toBeInTheDocument()
      expect(within(arrivalRow).queryByRole('link', { name: 'Aayush Arrival' })).not.toBeInTheDocument()
      expect(within(arrivalRow).getByText('Pending registration')).toBeInTheDocument()

      // Clicking Create OPD Token opens modal dialog
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const user = userEvent.setup()
      await user.click(within(main).getByRole('button', { name: /create opd token/i }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: /create opd token/i })).toBeInTheDocument()
    })

    it('renders 8-column TableSkeleton while appointments are loading', () => {
      renderAppointments({
        onFetch: (url) => {
          if (url.includes('/api/appointments')) {
            return new Promise(() => {})
          }
          return undefined
        },
      })

      const skeleton = screen.getByText('Loading appointments schedule...').closest('[role="status"]')!
      expect(skeleton).toBeInTheDocument()
      const rows = skeleton.querySelectorAll('[aria-hidden="true"] > div')
      expect(rows.length).toBe(5)
      expect(rows[0].querySelectorAll('span').length).toBe(8)
    })

    it('shows success toast for location.state.notice and clears location state', async () => {
      let latestState: unknown = 'unset'
      renderAppointments({
        initialEntries: [
          {
            pathname: '/reception/appointments',
            state: { notice: 'Patient registered and queued for Dr. Madan Mohan Dwivedi.' },
          },
        ],
        onLocation: (loc) => {
          latestState = loc.state
        },
      })

      const toastHost = await screen.findByTestId('toast-host')
      expect(within(toastHost).getByRole('status')).toHaveTextContent(
        'Patient registered and queued for Dr. Madan Mohan Dwivedi.',
      )
      await waitFor(() => {
        expect(latestState).toBeNull()
      })
    })
  })

  describe('Status badges, colors, lifecycle counts & 7 canonical filter pills', () => {
    it('maps every status and pending arrival to badges, color classes, priority badges, and 7 canonical filter pills without duplicate toolbar counters', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 20, patient_name: 'P Booked', status: 'BOOKED', priority_level: 'PRIORITY', priority_reason: 'Senior citizen' }),
          makeAppointment({ id: 21, patient_name: 'P ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 22, patient_name: 'P Registered', status: 'REGISTERED', consultation_status: null }),
          makeAppointment({ id: 23, patient_name: 'P Arrived Only', status: 'ARRIVED', consultation_status: null }),
          makeAppointment({ id: 24, patient_name: 'P Arrived Waiting', status: 'ARRIVED', consultation_status: 'WAITING', priority_level: 'EMERGENCY', priority_reason: 'Acute pain' }),
          makeAppointment({ id: 25, patient_name: 'P CheckedIn', status: 'CHECKED_IN' }),
          makeAppointment({ id: 26, patient_name: 'P Waiting', status: 'WAITING' }),
          makeAppointment({ id: 27, patient_name: 'P InConsult', status: 'IN_CONSULTATION' }),
          makeAppointment({ id: 28, patient_name: 'P Done', status: 'DONE' }),
          makeAppointment({ id: 29, patient_name: 'P Completed', status: 'COMPLETED' }),
          makeAppointment({ id: 30, patient_name: 'P NoShow', status: 'NO_SHOW' }),
        ],
        arrivals: [
          makeArrival({ id: 902, full_name: 'P PendingArrival', status: 'TO_ARRIVE', token_number: 12 }),
        ],
      })

      await screen.findByText('P PendingArrival')

      // Duplicate toolbar summary counts are GONE
      for (const legacyCounter of ['4 To Arrive', '5 Checked In', '2 Completed', '1 No-show']) {
        expect(
          screen.queryByText((_, el) => el?.tagName === 'SPAN' && el.textContent === legacyCounter),
        ).not.toBeInTheDocument()
      }

      // Single authoritative 7-pill filter bar: Active === To Arrive (4) + Checked In (5) = 9
      // NO_SHOW is excluded from To Arrive; DONE & COMPLETED are excluded from Checked In
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      expect(filters.getAllByRole('button')).toHaveLength(7)
      expect(filters.getByRole('button', { name: 'Active (9)' })).toHaveAttribute('aria-pressed', 'true')
      expect(filters.getByRole('button', { name: 'To Arrive (4)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'Checked In (5)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'Completed (2)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'No-Show (1)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'Cancelled (0)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'All (12)' })).toBeInTheDocument()

      // Default Active excludes Completed and No-Show
      let table = screen.getByRole('table')
      expect(within(table).queryByText('P Done')).not.toBeInTheDocument()
      expect(within(table).queryByText('P Completed')).not.toBeInTheDocument()
      expect(within(table).queryByText('P NoShow')).not.toBeInTheDocument()

      // Switch to All (12) to verify every status badge, color class, and Priority column
      const user = userEvent.setup()
      await user.click(filters.getByRole('button', { name: 'All (12)' }))
      table = screen.getByRole('table')

      const expectRowBadge = (patient: string, label: string, classRegex?: RegExp) => {
        const row = within(table).getByText(patient).closest('tr')!
        const badge = within(row).getByText(label)
        expect(badge).toBeInTheDocument()
        if (classRegex) expect(badge.className).toMatch(classRegex)
      }

      expectRowBadge('P Booked', 'Booked', /bg-slate-100.*text-slate-700/)
      expectRowBadge('P ToArrive', 'To arrive', /bg-amber-50.*text-amber-800/)
      expectRowBadge('P Registered', 'Booked')
      expectRowBadge('P PendingArrival', 'To arrive', /bg-amber-50.*text-amber-800/)
      expectRowBadge('P Arrived Only', 'Arrived')
      expectRowBadge('P Arrived Waiting', 'Checked In', /bg-teal-50.*text-teal-800/)
      expectRowBadge('P CheckedIn', 'Checked In', /bg-teal-50.*text-teal-800/)
      expectRowBadge('P Waiting', 'Checked In', /bg-teal-50.*text-teal-800/)
      expectRowBadge('P InConsult', 'Checked In', /bg-teal-50.*text-teal-800/)
      expectRowBadge('P Done', 'Completed', /bg-emerald-50.*text-emerald-800/)
      expectRowBadge('P Completed', 'Completed', /bg-emerald-50.*text-emerald-800/)
      expectRowBadge('P NoShow', 'No-show', /bg-orange-50.*text-orange-800/)

      // Priority column renders High, Emergency, AND Normal (showNormal)
      expect(within(within(table).getByText('P Booked').closest('tr')!).getByText('High')).toBeInTheDocument()
      expect(
        within(within(table).getByText('P Arrived Waiting').closest('tr')!).getByText('Emergency'),
      ).toBeInTheDocument()
      expect(within(within(table).getByText('P ToArrive').closest('tr')!).getByText('Normal')).toBeInTheDocument()

      // Live queue and billing labels must never appear on Appointments
      expect(screen.queryByText(/with doctor/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
      expect(screen.queryByText(/billing →/i)).not.toBeInTheDocument()
    })

    it('switches across all 7 filter pills (Active, To Arrive, Checked In, Completed, No-Show, Cancelled, All)', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 31, patient_name: 'Booked Patient', status: 'BOOKED' }),
          makeAppointment({ id: 32, patient_name: 'Registered Patient', status: 'REGISTERED', consultation_status: null }),
          makeAppointment({ id: 33, patient_name: 'CheckedIn Patient', status: 'ARRIVED', consultation_status: 'WAITING' }),
          makeAppointment({ id: 38, patient_name: 'Completed Patient', status: 'DONE', consultation_status: 'COMPLETED' }),
          makeAppointment({ id: 39, patient_name: 'NoShow Patient', status: 'NO_SHOW' }),
          makeAppointment({
            id: 34,
            patient_name: 'Cancelled Patient',
            status: 'CANCELLED',
            cancellation_reason: 'Patient travelled out of town',
          }),
          makeAppointment({ id: 35, patient_name: 'Rescheduled Patient', status: 'RESCHEDULED' }),
        ],
        arrivals: [makeArrival({ id: 903, full_name: 'Pending Walkin', status: 'TO_ARRIVE' })],
      })

      await screen.findByText('Pending Walkin')

      const getFilterBtn = (name: string) =>
        within(screen.getByRole('group', { name: 'Filter appointments' })).getByRole('button', { name })

      // Default: Active === To Arrive (3) + Checked In (1); excludes Completed, No-Show, Cancelled, Rescheduled
      expect(getFilterBtn('Active (4)')).toHaveAttribute('aria-pressed', 'true')
      expect(getFilterBtn('To Arrive (3)')).toBeInTheDocument()
      expect(getFilterBtn('Checked In (1)')).toBeInTheDocument()
      expect(getFilterBtn('Completed (1)')).toBeInTheDocument()
      expect(getFilterBtn('No-Show (1)')).toBeInTheDocument()
      expect(getFilterBtn('Cancelled (1)')).toBeInTheDocument()
      expect(getFilterBtn('All (8)')).toBeInTheDocument()
      expect(screen.queryByText('Completed Patient')).not.toBeInTheDocument()
      expect(screen.queryByText('NoShow Patient')).not.toBeInTheDocument()
      expect(screen.queryByText('Cancelled Patient')).not.toBeInTheDocument()
      expect(screen.queryByText('Rescheduled Patient')).not.toBeInTheDocument()

      const user = userEvent.setup()

      // To Arrive includes BOOKED, REGISTERED, and pending arrival — excludes NO_SHOW
      await user.click(getFilterBtn('To Arrive (3)'))
      let table = await screen.findByRole('table')
      expect(getFilterBtn('To Arrive (3)')).toHaveAttribute('aria-pressed', 'true')
      expect(within(table).getByText('Booked Patient')).toBeInTheDocument()
      expect(within(table).getByText('Registered Patient')).toBeInTheDocument()
      expect(within(table).getByText('Pending Walkin')).toBeInTheDocument()
      expect(within(table).queryByText('CheckedIn Patient')).not.toBeInTheDocument()
      expect(within(table).queryByText('NoShow Patient')).not.toBeInTheDocument()

      // Checked In shows only checked-in patient — excludes DONE/COMPLETED
      await user.click(getFilterBtn('Checked In (1)'))
      table = await screen.findByRole('table')
      expect(getFilterBtn('Checked In (1)')).toHaveAttribute('aria-pressed', 'true')
      expect(within(table).getByText('CheckedIn Patient')).toBeInTheDocument()
      expect(within(table).queryByText('Booked Patient')).not.toBeInTheDocument()
      expect(within(table).queryByText('Completed Patient')).not.toBeInTheDocument()

      // Completed shows only completed patient
      await user.click(getFilterBtn('Completed (1)'))
      table = await screen.findByRole('table')
      expect(getFilterBtn('Completed (1)')).toHaveAttribute('aria-pressed', 'true')
      expect(within(table).getByText('Completed Patient')).toBeInTheDocument()
      expect(within(table).queryByText('CheckedIn Patient')).not.toBeInTheDocument()

      // No-Show shows only no-show patient
      await user.click(getFilterBtn('No-Show (1)'))
      table = await screen.findByRole('table')
      expect(getFilterBtn('No-Show (1)')).toHaveAttribute('aria-pressed', 'true')
      expect(within(table).getByText('NoShow Patient')).toBeInTheDocument()
      expect(within(table).queryByText('Booked Patient')).not.toBeInTheDocument()

      // Cancelled shows cancelled row + reason + red badge
      await user.click(getFilterBtn('Cancelled (1)'))
      table = await screen.findByRole('table')
      expect(getFilterBtn('Cancelled (1)')).toHaveAttribute('aria-pressed', 'true')
      expect(within(table).getByText('Cancelled Patient')).toBeInTheDocument()
      expect(within(table).getByText('Patient travelled out of town')).toBeInTheDocument()
      const cancelledBadge = within(table).getByText('Cancelled')
      expect(cancelledBadge.className).toMatch(/bg-red-50.*text-red-800/)
      expect(within(table).queryByText('Booked Patient')).not.toBeInTheDocument()

      // All shows everything including purple Rescheduled badge
      await user.click(getFilterBtn('All (8)'))
      table = await screen.findByRole('table')
      expect(getFilterBtn('All (8)')).toHaveAttribute('aria-pressed', 'true')
      expect(within(table).getByText('Booked Patient')).toBeInTheDocument()
      expect(within(table).getByText('Completed Patient')).toBeInTheDocument()
      expect(within(table).getByText('NoShow Patient')).toBeInTheDocument()
      expect(within(table).getByText('Cancelled Patient')).toBeInTheDocument()
      expect(within(table).getByText('Rescheduled Patient')).toBeInTheDocument()
      const rescheduledBadge = within(table).getByText('Rescheduled')
      expect(rescheduledBadge.className).toMatch(/bg-purple-50.*text-purple-800/)
    })

    it('uses server bucket_counts combined with pending arrivals (TO_ARRIVE and CANCELLED)', async () => {
      renderAppointments({
        appointments: [makeAppointment({ id: 301, patient_name: 'Page One Patient', status: 'BOOKED' })],
        arrivals: [
          makeArrival({ id: 904, full_name: 'Pending Walkin One', status: 'TO_ARRIVE' }),
          makeArrival({
            id: 905,
            full_name: 'Cancelled Walkin Two',
            status: 'CANCELLED',
            cancellation_reason: 'Left early',
          }),
        ],
        onFetch: (url) => {
          if (url.includes('/api/appointments')) {
            const resp: AppointmentListResponse = {
              total: 10,
              limit: 100,
              offset: 0,
              appointments: [makeAppointment({ id: 301, patient_name: 'Page One Patient', status: 'BOOKED' })],
              bucket_counts: {
                active: 10,
                to_arrive: 4,
                checked_in: 6,
                completed: 3,
                no_show: 2,
                cancelled: 1,
                rescheduled: 1,
                all: 17,
              },
            }
            return jsonResponse(resp)
          }
          return undefined
        },
      })

      await screen.findByText('Pending Walkin One')

      // Server counts + 1 TO_ARRIVE arrival (adds to to_arrive/active/all) + 1 CANCELLED arrival (adds to cancelled/all)
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      expect(filters.getByRole('button', { name: 'Active (11)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'To Arrive (5)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'Checked In (6)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'Completed (3)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'No-Show (2)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'Cancelled (2)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'All (19)' })).toBeInTheDocument()
    })

    it('omits empty-state Create OPD Token button when Cancelled filter has no rows', async () => {
      renderAppointments({
        appointments: [makeAppointment({ id: 36, patient_name: 'Active Only', status: 'BOOKED' })],
      })

      await screen.findByText('Active Only')

      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'Cancelled (0)' }))

      expect(
        screen.getByText('No cancelled appointments for this date and doctor.'),
      ).toBeInTheDocument()
      // Only the header primary CTA exists; no duplicate empty-state CTA in Cancelled view
      expect(screen.getAllByRole('button', { name: /create opd token/i })).toHaveLength(1)
    })

    it('keeps filter pills visible when Active is empty and Cancelled has rows', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({
            id: 37,
            patient_name: 'Cancelled Only Patient',
            status: 'CANCELLED',
            cancellation_reason: 'Fever resolved',
          }),
        ],
      })

      await screen.findByText('No active appointments for this date and doctor.')

      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      const cancelledBtn = filters.getByRole('button', { name: 'Cancelled (1)' })
      expect(filters.getByRole('button', { name: 'Active (0)' })).toHaveAttribute('aria-pressed', 'true')

      const user = userEvent.setup()
      await user.click(cancelledBtn)

      expect(screen.getByText('Cancelled Only Patient')).toBeInTheDocument()
      expect(screen.getByText('Fever resolved')).toBeInTheDocument()
    })

    it('displays a role="alert" banner with working Retry button when pending arrivals fail to load', async () => {
      let arrivalsAttempts = 0
      renderAppointments({
        appointments: [makeAppointment({ id: 38, patient_name: 'Aarav Kumar' })],
        arrivals: [makeArrival({ id: 906, full_name: 'Recovered Arrival' })],
        onFetch: (url) => {
          if (url.includes('/api/opd-arrivals')) {
            arrivalsAttempts += 1
            if (arrivalsAttempts === 1) {
              return jsonResponse({ code: 'server_error', message: 'Network unavailable' }, 500)
            }
          }
          return undefined
        },
      })

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/pending arrivals could not load/i)
      expect(alert).toHaveTextContent(/network unavailable/i)

      const user = userEvent.setup()
      await user.click(within(alert).getByRole('button', { name: 'Retry' }))

      await screen.findByText('Recovered Arrival')
      expect(screen.queryByText(/pending arrivals could not load/i)).not.toBeInTheDocument()
    })

    it('displays a role="alert" banner with working Retry button when appointments fail to load', async () => {
      let apptAttempts = 0
      renderAppointments({
        appointments: [makeAppointment({ id: 39, patient_name: 'Recovered Booking' })],
        onFetch: (url) => {
          if (url.includes('/api/appointments')) {
            apptAttempts += 1
            if (apptAttempts === 1) {
              return jsonResponse({ code: 'server_error', message: 'Database temporarily unavailable' }, 500)
            }
          }
          return undefined
        },
      })

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/failed to load appointments/i)
      expect(alert).toHaveTextContent(/database temporarily unavailable/i)

      const user = userEvent.setup()
      await user.click(within(alert).getByRole('button', { name: 'Retry' }))

      await screen.findByText('Recovered Booking')
      expect(screen.queryByText(/failed to load appointments/i)).not.toBeInTheDocument()
    })
  })

  describe('Search filter, Doctor filter & Refresh', () => {
    it('filters appointments and pending arrivals by name, URN, mobile, and token number, updating pill counts', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({
            id: 110,
            patient_name: 'Rahul Kumar',
            patient_urn: 'KH-9876',
            patient_mobile: '9123456789',
            doctor_id: 1,
            token_number: 2,
            status: 'TO_ARRIVE',
          }),
          makeAppointment({
            id: 111,
            patient_name: 'Meera Devi',
            patient_urn: 'KH-1111',
            patient_mobile: '9000011111',
            doctor_id: 2,
            doctor_name_en: 'Dr. Priya Sharma',
            token_number: 7,
            status: 'ARRIVED',
            consultation_status: 'WAITING',
          }),
        ],
        arrivals: [
          makeArrival({
            id: 910,
            full_name: 'Alpha Walkin',
            mobile: '9555544444',
            doctor_id: 1,
            token_number: 9,
          }),
        ],
      })

      await screen.findByText('A-2')
      const searchInput = screen.getByPlaceholderText(/search name, urn, mobile or token/i)
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      const user = userEvent.setup()

      expect(filters.getByRole('button', { name: 'Active (3)' })).toBeInTheDocument()

      // Search by URN
      await user.type(searchInput, 'KH-9876')
      expect(filters.getByRole('button', { name: 'Active (1)' })).toBeInTheDocument()
      expect(filters.getByRole('button', { name: 'To Arrive (1)' })).toBeInTheDocument()
      expect(within(screen.getByRole('table')).getByText('Rahul Kumar')).toBeInTheDocument()
      expect(within(screen.getByRole('table')).queryByText('Meera Devi')).not.toBeInTheDocument()

      // Search by mobile on pending arrival
      await user.clear(searchInput)
      await user.type(searchInput, '9555544444')
      expect(filters.getByRole('button', { name: 'Active (1)' })).toBeInTheDocument()
      expect(within(screen.getByRole('table')).getByText('Alpha Walkin')).toBeInTheDocument()

      // Search by cabin-formatted token (A-2)
      await user.clear(searchInput)
      await user.type(searchInput, 'A-2')
      expect(within(screen.getByRole('table')).getByText('Rahul Kumar')).toBeInTheDocument()
      expect(within(screen.getByRole('table')).queryByText('Alpha Walkin')).not.toBeInTheDocument()

      // Search by #token (#7)
      await user.clear(searchInput)
      await user.type(searchInput, '#7')
      expect(filters.getByRole('button', { name: 'Checked In (1)' })).toBeInTheDocument()
      expect(within(screen.getByRole('table')).getByText('Meera Devi')).toBeInTheDocument()

      // Search by name with no match
      await user.clear(searchInput)
      await user.type(searchInput, 'Nonexistent')
      expect(screen.getByText('No appointments match your search.')).toBeInTheDocument()
    })

    it('filters by doctor across appointments and arrivals, and Refresh refetches both endpoints', async () => {
      const { mockFetch } = renderAppointments({
        appointments: [
          makeAppointment({ id: 120, doctor_id: 1, patient_name: 'Doc1 Booking' }),
          makeAppointment({
            id: 121,
            doctor_id: 2,
            doctor_name_en: 'Dr. Priya Sharma',
            patient_name: 'Doc2 Booking',
          }),
        ],
        arrivals: [
          makeArrival({ id: 920, doctor_id: 1, full_name: 'Doc1 Arrival' }),
          makeArrival({
            id: 921,
            doctor_id: 2,
            doctor_name_en: 'Dr. Priya Sharma',
            full_name: 'Doc2 Arrival',
          }),
        ],
      })

      await screen.findByText('Doc2 Arrival')

      const user = userEvent.setup()
      const doctorSelect = screen.getByLabelText('Doctor')
      await user.selectOptions(doctorSelect, '2')

      await waitFor(() => {
        expect(screen.queryByText('Doc1 Booking')).not.toBeInTheDocument()
        expect(screen.queryByText('Doc1 Arrival')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Doc2 Booking')).toBeInTheDocument()
      expect(screen.getByText('Doc2 Arrival')).toBeInTheDocument()

      const apptCallsBefore = mockFetch.mock.calls.filter(([u]) =>
        String(u).includes('/api/appointments'),
      ).length
      const arrivalCallsBefore = mockFetch.mock.calls.filter(([u]) =>
        String(u).includes('/api/opd-arrivals'),
      ).length

      await user.click(screen.getByRole('button', { name: 'Refresh appointments' }))

      await waitFor(() => {
        const apptCallsAfter = mockFetch.mock.calls.filter(([u]) =>
          String(u).includes('/api/appointments'),
        ).length
        const arrivalCallsAfter = mockFetch.mock.calls.filter(([u]) =>
          String(u).includes('/api/opd-arrivals'),
        ).length
        expect(apptCallsAfter).toBeGreaterThan(apptCallsBefore)
        expect(arrivalCallsAfter).toBeGreaterThan(arrivalCallsBefore)
      })
    })
  })

  describe('Primary CTAs (Check in, Register) & deep-link auto-open', () => {
    it('opens CreateOpdTokenModal in-page on Check in for BOOKED, NO_SHOW, REGISTERED, and URN TO_ARRIVE without navigation or PATCH', async () => {
      const { mockFetch } = renderAppointments({
        appointments: [
          makeAppointment({ id: 50, patient_id: 101, patient_name: 'G Booked', status: 'BOOKED' }),
          makeAppointment({ id: 51, patient_id: 102, patient_urn: 'KH-2026-0002', patient_name: 'G ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 52, patient_id: 103, patient_urn: 'KH-2026-0003', patient_name: 'G Registered', status: 'REGISTERED' }),
          makeAppointment({ id: 53, patient_id: 104, patient_urn: 'KH-2026-0004', patient_name: 'G NoShow', status: 'NO_SHOW' }),
          makeAppointment({
            id: 54,
            patient_id: 105,
            patient_urn: 'KH-2026-0005',
            patient_name: 'G Arrived',
            status: 'ARRIVED',
            consultation_status: 'WAITING',
          }),
        ],
      })

      await screen.findByText('G Arrived')

      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))

      // Under default Active view, BOOKED, TO_ARRIVE, and REGISTERED have Check in; ARRIVED does not; NO_SHOW is excluded from Active/To Arrive
      let table = screen.getByRole('table')
      const bookedRow = within(table).getByText('G Booked').closest('tr')!
      const toArriveRow = within(table).getByText('G ToArrive').closest('tr')!
      const registeredRow = within(table).getByText('G Registered').closest('tr')!
      const arrivedRow = within(table).getByText('G Arrived').closest('tr')!
      expect(within(table).queryByText('G NoShow')).not.toBeInTheDocument()

      expect(within(bookedRow).getByRole('button', { name: 'Check in' })).toBeInTheDocument()
      expect(within(toArriveRow).getByRole('button', { name: 'Check in' })).toBeInTheDocument()
      expect(within(registeredRow).getByRole('button', { name: 'Check in' })).toBeInTheDocument()
      expect(within(arrivedRow).queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument()
      expect(within(table).queryByRole('link', { name: 'Check in' })).not.toBeInTheDocument()

      // Clicking Check in opens CreateOpdTokenModal in-page preloaded with G Booked, no navigation, no PATCH
      await user.click(within(bookedRow).getByRole('button', { name: 'Check in' }))

      let dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: /create opd token/i })).toBeInTheDocument()
      expect(within(dialog).getByText('G Booked')).toBeInTheDocument()
      expect(screen.queryByTestId('navigated-to')).not.toBeInTheDocument()
      expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/status'), expect.anything())

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Policy #2: same-day NO_SHOW row is in No-Show pill (excluded from To Arrive) and STILL shows Check in CTA opening CreateOpdTokenModal
      await user.click(filters.getByRole('button', { name: 'No-Show (1)' }))
      table = screen.getByRole('table')
      const noShowRow = within(table).getByText('G NoShow').closest('tr')!
      const noShowCheckInBtn = within(noShowRow).getByRole('button', { name: 'Check in' })
      expect(noShowCheckInBtn).toBeInTheDocument()
      await user.click(noShowCheckInBtn)

      dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: /create opd token/i })).toBeInTheDocument()
      expect(within(dialog).getByText('G NoShow')).toBeInTheDocument()
      expect(screen.queryByTestId('navigated-to')).not.toBeInTheDocument()
      expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/status'), expect.anything())
    })

    it('navigates to registration on Register for pending TO_ARRIVE arrival and unregistered TO_ARRIVE booking', async () => {
      const user = userEvent.setup()

      // 1. Pending arrival -> /reception/patients/new?arrival_id=930&doctor_id=2
      renderAppointments({
        appointments: [],
        arrivals: [
          makeArrival({
            id: 930,
            full_name: 'Pending Pat',
            doctor_id: 2,
            doctor_name_en: 'Dr. Priya Sharma',
            status: 'TO_ARRIVE',
          }),
        ],
      })

      await screen.findByText('Pending Pat')
      await user.click(screen.getByRole('button', { name: 'Register' }))
      expect(await screen.findByTestId('navigated-to')).toHaveTextContent(
        '/reception/patients/new?arrival_id=930&doctor_id=2',
      )

      // 2. Unregistered TO_ARRIVE booking (empty patient_urn) -> /reception/patients/204/edit?appointment_id=55
      cleanup()
      renderAppointments({
        appointments: [
          makeAppointment({
            id: 55,
            patient_id: 204,
            patient_urn: '',
            patient_name: 'Kiran Rao',
            status: 'TO_ARRIVE',
          }),
        ],
      })

      await screen.findByText('Kiran Rao')
      await user.click(screen.getByRole('button', { name: 'Register' }))
      expect(await screen.findByTestId('navigated-to')).toHaveTextContent(
        '/reception/patients/204/edit?appointment_id=55',
      )
    })

    it('auto-opens CreateOpdTokenModal preloaded for valid deep-link params and ignores invalid params', async () => {
      const deepLinkedBooking = makeAppointment({
        id: 501,
        patient_id: 101,
        patient_name: 'Deep Link Patient',
        patient_urn: 'KH-2026-0501',
        status: 'BOOKED',
      })
      renderAppointments({
        appointments: [deepLinkedBooking],
        patients: [makePatient({ id: 101, full_name: 'Deep Link Patient', urn: 'KH-2026-0501' })],
        initialEntries: ['/reception/appointments?patient_id=101&appointment_id=501'],
      })

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: /create opd token/i })).toBeInTheDocument()
      await waitFor(() => {
        expect(within(dialog).getByText('Deep Link Patient')).toBeInTheDocument()
      })

      // Invalid params (?patient_id=0&appointment_id=abc) must NOT auto-open modal
      cleanup()
      renderAppointments({
        appointments: [makeAppointment({ id: 502, patient_name: 'Normal Row' })],
        initialEntries: ['/reception/appointments?patient_id=0&appointment_id=abc'],
      })

      await screen.findByText('Normal Row')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('preserves unrelated query params when clearing deep-link params and switching doctor tabs', async () => {
      let latestSearch = ''
      renderAppointments({
        appointments: [makeAppointment({ id: 501, patient_id: 101, patient_name: 'Deep Link Patient' })],
        patients: [makePatient({ id: 101, full_name: 'Deep Link Patient' })],
        initialEntries: ['/reception/appointments?foo=bar&patient_id=101&appointment_id=501'],
        onLocation: (loc) => {
          latestSearch = loc.search
        },
      })

      const dialog = await screen.findByRole('dialog')
      const user = userEvent.setup()
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(latestSearch).toBe('?foo=bar')
      })

      // Doctor selectTab preserves unrelated query params (?foo=bar)
      cleanup()
      latestSearch = ''
      renderAppointments({
        me: doctorMe,
        appointments: [],
        initialEntries: ['/reception/appointments?foo=bar&tab=followup'],
        onLocation: (loc) => {
          latestSearch = loc.search
        },
      })

      await screen.findByRole('tab', { name: 'Schedule' })
      await user.click(screen.getByRole('tab', { name: 'Schedule' }))
      await waitFor(() => {
        const params = new URLSearchParams(latestSearch)
        expect(params.get('foo')).toBe('bar')
        expect(params.get('tab')).toBe('today')
      })
    })
  })

  describe('Controlled More dropdown & PriorityModal', () => {
    it('supports menu ARIA semantics, single-open coordination, Escape focus return, and dash for actionless rows', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 130, patient_name: 'Row One', status: 'ARRIVED', consultation_status: 'WAITING', token_number: 1 }),
          makeAppointment({ id: 131, patient_name: 'Row Two', status: 'BOOKED', token_number: null }),
          makeAppointment({ id: 132, patient_name: 'Cancelled Row', status: 'CANCELLED', token_number: null }),
        ],
        arrivals: [makeArrival({ id: 940, full_name: 'Arrival Three', token_number: 2 })],
      })

      await screen.findByText('Arrival Three')
      const user = userEvent.setup()

      // Switch to All so Cancelled Row is also visible
      await user.click(
        within(screen.getByRole('group', { name: 'Filter appointments' })).getByRole('button', {
          name: 'All (4)',
        }),
      )

      const table = screen.getByRole('table')
      const row1 = within(table).getByText('Row One').closest('tr')!
      const row3 = within(table).getByText('Arrival Three').closest('tr')!
      const cancelledRow = within(table).getByText('Cancelled Row').closest('tr')!

      // Actionless row renders — in the 8th (Action) column
      expect(within(cancelledRow).queryByRole('button')).not.toBeInTheDocument()
      expect(within(cancelledRow).getAllByRole('cell')[7]).toHaveTextContent('—')

      const more1 = within(row1).getByRole('button', { name: 'More' })
      expect(more1).toHaveAttribute('aria-haspopup', 'menu')
      expect(more1).toHaveAttribute('aria-expanded', 'false')

      await user.click(more1)
      expect(more1).toHaveAttribute('aria-expanded', 'true')
      expect(within(row1).getByRole('menuitem', { name: 'Change priority' })).toBeInTheDocument()

      // Opening another row's More closes the first
      const more3 = within(row3).getByRole('button', { name: 'More' })
      await user.click(more3)
      expect(more1).toHaveAttribute('aria-expanded', 'false')
      expect(within(row1).queryByRole('menu')).not.toBeInTheDocument()
      expect(more3).toHaveAttribute('aria-expanded', 'true')
      expect(within(row3).getByRole('menuitem', { name: 'Change priority' })).toBeInTheDocument()

      // Escape closes More menu and returns focus to More trigger
      await user.keyboard('{Escape}')
      expect(within(row3).queryByRole('menu')).not.toBeInTheDocument()
      expect(more3).toHaveAttribute('aria-expanded', 'false')
      expect(more3).toHaveFocus()
    })

    it('opens shared PriorityModal for pending arrivals and checked-in appointments, enforcing min 3-char reason and sending exact payloads', async () => {
      let arrivalPriorityBody: unknown = null
      let apptPriorityBody: unknown = null

      renderAppointments({
        appointments: [
          makeAppointment({
            id: 140,
            patient_name: 'Checked Pat',
            status: 'ARRIVED',
            consultation_status: 'WAITING',
            token_number: 2,
            version_id: 4,
          }),
          makeAppointment({
            id: 141,
            patient_name: 'InConsult Pat',
            status: 'IN_CONSULTATION',
            consultation_status: 'IN_CONSULTATION',
            token_number: 3,
            version_id: 2,
          }),
        ],
        arrivals: [
          makeArrival({
            id: 950,
            full_name: 'Arrival Pat',
            token_number: 1,
            version_id: 3,
          }),
        ],
        onFetch: (url, init) => {
          if (url.includes('/api/opd-arrivals/950/priority') && init?.method === 'PATCH') {
            arrivalPriorityBody = JSON.parse(init.body as string)
            return jsonResponse(makeArrival({ id: 950, priority_level: 'EMERGENCY', version_id: 4 }))
          }
          if (url.includes('/api/appointments/140/priority') && init?.method === 'PATCH') {
            apptPriorityBody = JSON.parse(init.body as string)
            return jsonResponse(makeAppointment({ id: 140, priority_level: 'PRIORITY', version_id: 5 }))
          }
          return undefined
        },
      })

      await screen.findByText('Arrival Pat')
      const table = screen.getByRole('table')
      const user = userEvent.setup()

      // 1. Pending arrival priority update -> PATCH /opd-arrivals/950/priority with `reason`
      const arrivalRow = within(table).getByText('Arrival Pat').closest('tr')!
      const { moreBtn: arrivalMoreBtn } = await openRowMoreMenu(user, arrivalRow)
      await user.click(within(arrivalRow).getByRole('menuitem', { name: 'Change priority' }))

      let dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Change priority' })).toBeInTheDocument()
      const levelSelect = within(dialog).getByLabelText('Priority *')
      expect(levelSelect).toHaveFocus()
      expect(within(dialog).getByText(/Normal \(Regular queue\)/)).toBeInTheDocument()
      expect(within(dialog).getByText(/High \(Needs preferential attention\)/)).toBeInTheDocument()
      expect(within(dialog).getByText(/Emergency \(Immediate clinical attention\)/)).toBeInTheDocument()

      await user.selectOptions(levelSelect, 'EMERGENCY')
      const saveBtn = within(dialog).getByRole('button', { name: 'Save priority' })
      expect(saveBtn).toBeDisabled()
      expect(within(dialog).getByText(/at least 3 characters to set Priority or Emergency/i)).toBeInTheDocument()

      await user.type(within(dialog).getByLabelText('Reason *'), 'ab')
      expect(saveBtn).toBeDisabled()
      expect(within(dialog).getByRole('alert')).toHaveTextContent(/at least 3 characters/i)
      expect(arrivalPriorityBody).toBeNull()

      await user.clear(within(dialog).getByLabelText('Reason *'))
      await user.type(within(dialog).getByLabelText('Reason *'), 'Acute chest pain')
      expect(saveBtn).toBeEnabled()
      await user.click(saveBtn)

      await waitFor(() => {
        expect(arrivalPriorityBody).toEqual({
          priority_level: 'EMERGENCY',
          reason: 'Acute chest pain',
          version_id: 3,
        })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(arrivalMoreBtn).toHaveFocus()

      // 2. Checked-in WAITING appointment priority update -> PATCH /appointments/140/priority with `priority_reason`
      const apptRow = within(table).getByText('Checked Pat').closest('tr')!
      await openRowMoreMenu(user, apptRow)
      await user.click(within(apptRow).getByRole('menuitem', { name: 'Change priority' }))

      dialog = await screen.findByRole('dialog')
      await user.selectOptions(within(dialog).getByLabelText('Priority *'), 'PRIORITY')
      await user.type(within(dialog).getByLabelText('Reason *'), 'Senior citizen')
      await user.click(within(dialog).getByRole('button', { name: 'Save priority' }))

      await waitFor(() => {
        expect(apptPriorityBody).toEqual({
          priority_level: 'PRIORITY',
          priority_reason: 'Senior citizen',
          version_id: 4,
        })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // 3. IN_CONSULTATION appointment also exposes Change priority
      const inConsultRow = within(table).getByText('InConsult Pat').closest('tr')!
      await openRowMoreMenu(user, inConsultRow)
      expect(within(inConsultRow).getByRole('menuitem', { name: 'Change priority' })).toBeInTheDocument()
    })

    it('enforces exact permission and status gates for Change priority and Cancel arrival', async () => {
      const baseAppts = [
        makeAppointment({ id: 150, status: 'ARRIVED', consultation_status: 'WAITING', token_number: 1, patient_name: 'Waiting Pat' }),
        makeAppointment({ id: 151, status: 'DONE', consultation_status: 'COMPLETED', token_number: 2, patient_name: 'Done Pat' }),
        makeAppointment({ id: 152, status: 'BOOKED', consultation_status: null, token_number: null, patient_name: 'Booked Pat' }),
      ]
      const baseArrivals = [makeArrival({ id: 960, full_name: 'Pending Pat', token_number: 3 })]
      const user = userEvent.setup()

      // 1. appointment:write WITHOUT visit:write -> Waiting Pat has Cancel booking only (NO Change priority); Done Pat has no More; Booked Pat has NO Change priority; Pending Pat has both Change priority & Cancel arrival
      renderAppointments({
        me: { ...mockMe, permissions: ['appointment:read', 'appointment:write', 'patient:create'] },
        appointments: baseAppts,
        arrivals: baseArrivals,
      })

      await screen.findByText('Pending Pat')
      await user.click(
        within(screen.getByRole('group', { name: 'Filter appointments' })).getByRole('button', {
          name: 'All (4)',
        }),
      )
      let table = await screen.findByRole('table')

      const waitingRow1 = within(table).getByText('Waiting Pat').closest('tr')!
      await openRowMoreMenu(user, waitingRow1)
      expect(within(waitingRow1).queryByRole('menuitem', { name: 'Change priority' })).not.toBeInTheDocument()
      expect(within(waitingRow1).getByRole('menuitem', { name: 'Cancel booking' })).toBeInTheDocument()

      const doneRow1 = within(table).getByText('Done Pat').closest('tr')!
      expect(within(doneRow1).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()

      const bookedRow1 = within(table).getByText('Booked Pat').closest('tr')!
      await openRowMoreMenu(user, bookedRow1)
      expect(within(bookedRow1).queryByRole('menuitem', { name: 'Change priority' })).not.toBeInTheDocument()

      const pendingRow1 = within(table).getByText('Pending Pat').closest('tr')!
      await openRowMoreMenu(user, pendingRow1)
      expect(within(pendingRow1).getByRole('menuitem', { name: 'Change priority' })).toBeInTheDocument()
      expect(within(pendingRow1).getByRole('menuitem', { name: 'Cancel arrival' })).toBeInTheDocument()

      // 2. visit:write WITHOUT appointment:write -> Pending Pat has NO More menu; Waiting Pat HAS Change priority
      cleanup()
      renderAppointments({
        me: { ...mockMe, permissions: ['appointment:read', 'visit:write'] },
        appointments: baseAppts,
        arrivals: baseArrivals,
      })

      await screen.findByText('Pending Pat')
      table = screen.getByRole('table')

      const pendingRow2 = within(table).getByText('Pending Pat').closest('tr')!
      expect(within(pendingRow2).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()

      const waitingRow2 = within(table).getByText('Waiting Pat').closest('tr')!
      await openRowMoreMenu(user, waitingRow2)
      expect(within(waitingRow2).getByRole('menuitem', { name: 'Change priority' })).toBeInTheDocument()
    })

    it('blocks PriorityModal double-submit via inFlightRef while PATCH is pending', async () => {
      let patchCalls = 0
      let resolvePatch!: (value: ReturnType<typeof jsonResponse>) => void

      renderAppointments({
        appointments: [
          makeAppointment({
            id: 145,
            patient_name: 'Double Submit Pat',
            status: 'ARRIVED',
            consultation_status: 'WAITING',
            token_number: 4,
            version_id: 2,
          }),
        ],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/145/priority') && init?.method === 'PATCH') {
            patchCalls += 1
            return new Promise((resolve) => {
              resolvePatch = resolve
            })
          }
          return undefined
        },
      })

      await screen.findByText('Double Submit Pat')
      const user = userEvent.setup()
      const row = screen.getByText('Double Submit Pat').closest('tr')!
      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Change priority' }))

      const dialog = await screen.findByRole('dialog')
      await user.selectOptions(within(dialog).getByLabelText('Priority *'), 'PRIORITY')
      await user.type(within(dialog).getByLabelText('Reason *'), 'Senior citizen')

      // Two synchronous submits before React re-renders isPending=true only trigger one PATCH
      const form = dialog.querySelector('form')!
      fireEvent.submit(form)
      fireEvent.submit(form)

      await waitFor(() => expect(patchCalls).toBe(1))
      expect(within(dialog).getByLabelText('Priority *')).toBeDisabled()
      expect(within(dialog).getByLabelText('Reason *')).toBeDisabled()
      expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled()

      resolvePatch(jsonResponse(makeAppointment({ id: 145, priority_level: 'PRIORITY', version_id: 3 })))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(patchCalls).toBe(1)
    })
  })

  describe('Transfer doctor (ReassignModal) via More menu', () => {
    it('shows Transfer doctor ONLY for Reception with visit:write on checked-in WAITING appointments', async () => {
      const baseAppts = [
        makeAppointment({ id: 201, patient_name: 'T ArrivedWaiting', status: 'ARRIVED', consultation_status: 'WAITING', token_number: 1 }),
        makeAppointment({ id: 202, patient_name: 'T CheckedInWaiting', status: 'CHECKED_IN', consultation_status: 'WAITING', token_number: 2 }),
        makeAppointment({ id: 203, patient_name: 'T WaitingWaiting', status: 'WAITING', consultation_status: 'WAITING', token_number: 3 }),
        makeAppointment({ id: 204, patient_name: 'T InConsult', status: 'IN_CONSULTATION', consultation_status: 'IN_CONSULTATION', token_number: 4 }),
        makeAppointment({ id: 205, patient_name: 'T Booked', status: 'BOOKED', consultation_status: null, token_number: null }),
        makeAppointment({ id: 206, patient_name: 'T NoShow', status: 'NO_SHOW', consultation_status: null, token_number: null }),
        makeAppointment({ id: 207, patient_name: 'T Done', status: 'DONE', consultation_status: 'COMPLETED', token_number: 5 }),
      ]
      const baseArrivals = [makeArrival({ id: 975, full_name: 'T PendingArrival', token_number: 6 })]
      const user = userEvent.setup()

      // 1. Reception WITH visit:write
      renderAppointments({ appointments: baseAppts, arrivals: baseArrivals })
      await screen.findByText('T PendingArrival')
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'All (8)' }))

      let table = screen.getByRole('table')
      for (const eligible of ['T ArrivedWaiting', 'T CheckedInWaiting', 'T WaitingWaiting']) {
        const row = within(table).getByText(eligible).closest('tr')!
        await openRowMoreMenu(user, row)
        expect(within(row).getByRole('menuitem', { name: 'Transfer doctor' })).toBeInTheDocument()
      }
      for (const ineligibleWithMenu of ['T InConsult', 'T Booked', 'T NoShow', 'T PendingArrival']) {
        const row = within(table).getByText(ineligibleWithMenu).closest('tr')!
        await openRowMoreMenu(user, row)
        expect(within(row).queryByRole('menuitem', { name: 'Transfer doctor' })).not.toBeInTheDocument()
      }
      const doneRow = within(table).getByText('T Done').closest('tr')!
      expect(within(doneRow).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()

      // 2. Reception WITHOUT visit:write -> Transfer doctor hidden even on WAITING
      cleanup()
      renderAppointments({
        me: { ...mockMe, permissions: ['appointment:read', 'appointment:write'] },
        appointments: [baseAppts[0]],
      })
      await screen.findByText('T ArrivedWaiting')
      table = screen.getByRole('table')
      const rowNoPerm = within(table).getByText('T ArrivedWaiting').closest('tr')!
      await openRowMoreMenu(user, rowNoPerm)
      expect(within(rowNoPerm).queryByRole('menuitem', { name: 'Transfer doctor' })).not.toBeInTheDocument()

      // 3. DOCTOR with visit:write -> Transfer doctor is Reception-only, and cross-doctor filter is locked
      cleanup()
      renderAppointments({
        me: { ...doctorMe, permissions: [...doctorMe.permissions, 'visit:write'] },
        appointments: [baseAppts[0]],
        initialEntries: ['/reception/appointments?tab=today'],
      })
      expect(await screen.findByTestId('doctor-schedule-scope-pill')).toHaveTextContent(
        'Showing your schedule',
      )
      expect(screen.queryByLabelText('Doctor')).not.toBeInTheDocument()
      table = await screen.findByRole('table')
      const rowDoc = within(table).getByText('T ArrivedWaiting').closest('tr')!
      await openRowMoreMenu(user, rowDoc)
      expect(within(rowDoc).queryByRole('menuitem', { name: 'Transfer doctor' })).not.toBeInTheDocument()
    })

    it('opens shared ReassignModal on Transfer doctor and submits POST /api/appointments/:id/reassign', async () => {
      let reassignPayload: unknown = null

      renderAppointments({
        appointments: [
          makeAppointment({
            id: 210,
            patient_name: 'Transfer Pat',
            doctor_id: 1,
            department_id: 1,
            status: 'ARRIVED',
            consultation_status: 'WAITING',
            token_number: 2,
            version_id: 6,
          }),
        ],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/210/reassign') && init?.method === 'POST') {
            reassignPayload = JSON.parse(init.body as string)
            return jsonResponse(
              makeAppointment({
                id: 211,
                patient_name: 'Transfer Pat',
                doctor_id: 2,
                doctor_name_en: 'Dr. Priya Sharma',
                status: 'ARRIVED',
                consultation_status: 'WAITING',
                token_number: 1,
                version_id: 1,
              }),
            )
          }
          return undefined
        },
      })

      await screen.findByText('Transfer Pat')
      const user = userEvent.setup()
      const row = screen.getByText('Transfer Pat').closest('tr')!
      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Transfer doctor' }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: /Reassign #2 \(Transfer Pat\)\?/ })).toBeInTheDocument()

      await user.selectOptions(within(dialog).getByLabelText('Move to doctor'), '2')
      await user.type(within(dialog).getByLabelText('Reason'), 'Dr. Dwivedi in procedure')
      await user.click(within(dialog).getByRole('button', { name: 'Reassign & issue new token' }))

      await waitFor(() => {
        expect(reassignPayload).toEqual({
          version_id: 6,
          new_doctor_id: 2,
          new_department_id: null,
          reason: 'Dr. Dwivedi in procedure',
        })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  describe('Sort by, Server Pagination, Date Banners & Offline Connection Banner', () => {
    it('toggles Sort by between Token number and Appointment time, sending sort_by and reordering rows', async () => {
      const { mockFetch } = renderAppointments({
        appointments: [
          makeAppointment({ id: 310, patient_name: 'Late Token Early Time', token_number: 5, expected_time: '09:00:00' }),
          makeAppointment({ id: 311, patient_name: 'Early Token Late Time', token_number: 1, expected_time: '11:30:00' }),
          makeAppointment({ id: 312, patient_name: 'No Token No Time', token_number: null, expected_time: null }),
        ],
      })

      await screen.findByText('Early Token Late Time')

      const getPatientOrder = () =>
        within(screen.getByRole('table'))
          .getAllByRole('row')
          .slice(1)
          .map((row) => within(row).getAllByRole('cell')[2].querySelector('a')?.textContent)

      // Default sort: Token number (1, 5, null)
      const sortSelect = screen.getByLabelText('Sort by') as HTMLSelectElement
      expect(sortSelect.value).toBe('token')
      expect(getPatientOrder()).toEqual([
        'Early Token Late Time',
        'Late Token Early Time',
        'No Token No Time',
      ])

      const user = userEvent.setup()
      await user.selectOptions(sortSelect, 'time')

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('sort_by=time'),
          expect.anything(),
        )
      })
      expect(getPatientOrder()).toEqual([
        'Late Token Early Time',
        'Early Token Late Time',
        'No Token No Time',
      ])
    })

    it('paginates server appointments (125 total) and merges pendingArrivals on page 1 only', async () => {
      const allAppts = Array.from({ length: 125 }, (_, i) =>
        makeAppointment({
          id: 400 + i,
          patient_id: 1400 + i,
          patient_urn: `KH-2026-${String(i + 1).padStart(4, '0')}`,
          patient_name: `Paged Patient ${String(i + 1).padStart(3, '0')}`,
          token_number: i + 1,
          status: 'BOOKED',
        }),
      )
      const requestedOffsets: string[] = []

      renderAppointments({
        arrivals: [makeArrival({ id: 991, full_name: 'Page One Walkin', token_number: 1 })],
        onFetch: (url) => {
          if (url.includes('/api/appointments')) {
            const parsed = new URL(url, 'http://localhost')
            const offset = Number(parsed.searchParams.get('offset') ?? '0')
            const limit = Number(parsed.searchParams.get('limit') ?? '100')
            requestedOffsets.push(`${offset}:${limit}`)
            const slice = allAppts.slice(offset, offset + limit)
            const resp: AppointmentListResponse = {
              total: allAppts.length,
              limit,
              offset,
              appointments: slice,
              bucket_counts: {
                active: allAppts.length,
                to_arrive: allAppts.length,
                checked_in: 0,
                completed: 0,
                no_show: 0,
                cancelled: 0,
                rescheduled: 0,
                all: allAppts.length,
              },
            }
            return jsonResponse(resp)
          }
          return undefined
        },
      })

      await screen.findByText('Paged Patient 001')
      expect(screen.getByText('Page One Walkin')).toBeInTheDocument()
      expect(
        screen.getByText('Showing 1–100 of 125 appointments (+ 1 pending walk-in registration)'),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Next' }))

      await screen.findByText('Paged Patient 101')
      expect(requestedOffsets).toContain('100:100')
      expect(screen.getByText('Showing 101–125 of 125 appointments')).toBeInTheDocument()
      expect(screen.queryByText(/pending walk-in registration/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Page One Walkin')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

      // Returning to page 1 merges pending arrivals again
      await user.click(screen.getByRole('button', { name: 'Previous' }))
      await screen.findByText('Paged Patient 001')
      expect(screen.getByText('Page One Walkin')).toBeInTheDocument()
      expect(
        screen.getByText('Showing 1–100 of 125 appointments (+ 1 pending walk-in registration)'),
      ).toBeInTheDocument()
    })

    it('renders historical past-date banner without empty-state Create OPD Token (even with search) and future-date banner with Book Appointment CTA', async () => {
      renderAppointments({ appointments: [] })

      await screen.findByText('No active appointments for this date and doctor.')
      const user = userEvent.setup()

      // Switch to yesterday (historical date)
      await user.click(screen.getByRole('button', { name: 'Previous day' }))

      const pastBanner = await screen.findByText(
        `Viewing historical appointments for ${yesterday} — check-in and token creation are available for today only.`,
      )
      expect(pastBanner.closest('[role="status"]')).toBeInTheDocument()
      expect(screen.getByText('No appointments recorded for this past date.')).toBeInTheDocument()

      // Only the header primary CTA exists; empty state shows Return to Today and NEVER Create OPD Token
      expect(screen.getAllByRole('button', { name: /create opd token/i })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'Return to Today' })).toHaveLength(2)

      // Even with a non-empty search on a past date, empty state MUST still show Return to Today and NEVER Create OPD Token
      const searchInput = screen.getByPlaceholderText(/search name, urn, mobile or token/i)
      await user.type(searchInput, 'unmatched')
      expect(screen.getByText('No appointments match your search.')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /create opd token/i })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'Return to Today' })).toHaveLength(2)

      // Return to Today clears past banner
      await user.clear(searchInput)
      await user.click(within(pastBanner.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Return to Today' }))
      await waitFor(() => {
        expect(screen.queryByText(/Viewing historical appointments/i)).not.toBeInTheDocument()
      })

      // Switch to tomorrow (future date)
      await user.click(screen.getByRole('button', { name: 'Next day' }))
      const futureBanner = await screen.findByText(
        `Viewing upcoming appointments for ${tomorrow} — new entries will be created as advance bookings without tokens.`,
      )
      expect(futureBanner.closest('[role="status"]')).toBeInTheDocument()
      expect(screen.getByText('No bookings scheduled for this upcoming date.')).toBeInTheDocument()

      // Empty state renders Book Appointment CTA opening CreateOpdTokenModal
      const bookBtn = screen.getByRole('button', { name: 'Book Appointment' })
      expect(bookBtn).toBeInTheDocument()
      await user.click(bookBtn)
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByTestId('opd-flow-badge')).toHaveTextContent('Advance Booking')
    })

    it('renders workspace offline/server-disconnected role="alert" banner with Retry Connection on /api/health failure and navigator.onLine false', async () => {
      let healthFailing = true
      renderAppointments({
        appointments: [makeAppointment({ id: 320, patient_name: 'Health Check Pat' })],
        onFetch: (url) => {
          if (url.includes('/api/health')) {
            if (healthFailing) {
              return jsonResponse({ code: 'unavailable', message: 'Server down' }, 503)
            }
            return jsonResponse({ status: 'ok', db: 'ok', setup_required: false })
          }
          return undefined
        },
      })

      await screen.findByText('Health Check Pat')
      const disconnectAlert = await screen.findByRole('alert')
      expect(disconnectAlert).toHaveTextContent(
        'Server connection lost — displayed queue data may be outdated.',
      )

      const user = userEvent.setup()
      healthFailing = false
      await user.click(within(disconnectAlert).getByRole('button', { name: 'Retry Connection' }))

      await waitFor(() => {
        expect(screen.queryByText(/Server connection lost/i)).not.toBeInTheDocument()
      })

      // Browser offline / online events also toggle the workspace banner
      const onLineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
      act(() => {
        window.dispatchEvent(new Event('offline'))
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Server connection lost — displayed queue data may be outdated.',
      )

      onLineSpy.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => {
        expect(screen.queryByText(/Server connection lost/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Reschedule modal via More menu', () => {
    it('shows Reschedule only on BOOKED, TO_ARRIVE, and NO_SHOW and posts reschedule payload', async () => {
      let reschedulePayload: unknown = null

      renderAppointments({
        appointments: [
          makeAppointment({ id: 40, patient_name: 'R Booked', status: 'BOOKED', version_id: 3 }),
          makeAppointment({ id: 41, patient_name: 'R ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 42, patient_name: 'R NoShow', status: 'NO_SHOW' }),
          makeAppointment({ id: 43, patient_name: 'R Registered', status: 'REGISTERED' }),
          makeAppointment({ id: 44, patient_name: 'R Arrived', status: 'ARRIVED', consultation_status: 'WAITING' }),
          makeAppointment({ id: 45, patient_name: 'R Completed', status: 'COMPLETED' }),
        ],
        arrivals: [makeArrival({ id: 970, full_name: 'R PendingArrival' })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/40/reschedule') && init?.method === 'POST') {
            reschedulePayload = JSON.parse(init.body as string)
            return jsonResponse(
              makeAppointment({ id: 40, appointment_date: tomorrow, expected_time: '11:15:00', version_id: 4 }),
            )
          }
          return undefined
        },
      })

      await screen.findByText('R PendingArrival')

      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'All (7)' }))

      const table = screen.getByRole('table')

      for (const name of ['R Booked', 'R ToArrive', 'R NoShow']) {
        const row = within(table).getByText(name).closest('tr')!
        await openRowMoreMenu(user, row)
        expect(within(row).getByRole('menuitem', { name: 'Reschedule' })).toBeInTheDocument()
      }
      for (const name of ['R Registered', 'R Arrived', 'R PendingArrival']) {
        const row = within(table).getByText(name).closest('tr')!
        await openRowMoreMenu(user, row)
        expect(within(row).queryByRole('menuitem', { name: 'Reschedule' })).not.toBeInTheDocument()
      }
      const completedRow = within(table).getByText('R Completed').closest('tr')!
      expect(within(completedRow).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()

      const bookedRow = within(table).getByText('R Booked').closest('tr')!
      await openRowMoreMenu(user, bookedRow)
      await user.click(within(bookedRow).getByRole('menuitem', { name: 'Reschedule' }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Reschedule Appointment' })).toBeInTheDocument()

      fireEvent.change(within(dialog).getByLabelText('New date *'), { target: { value: tomorrow } })
      fireEvent.change(within(dialog).getByLabelText('Expected time (optional)'), {
        target: { value: '11:15' },
      })
      await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Patient requested tomorrow')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Reschedule' }))

      await waitFor(() => {
        expect(reschedulePayload).toEqual({
          version_id: 3,
          appointment_date: tomorrow,
          expected_time: '11:15:00',
          reason: 'Patient requested tomorrow',
        })
      })
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('shows 422 reschedule error inline inside modal and preserves user input', async () => {
      renderAppointments({
        appointments: [makeAppointment({ id: 46, status: 'BOOKED' })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/46/reschedule') && init?.method === 'POST') {
            return jsonResponse(
              { code: 'invalid_reschedule', message: 'Doctor is unavailable on that date' },
              422,
            )
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()
      const row = screen.getByText('Aarav Kumar').closest('tr')!
      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Reschedule' }))

      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('New date *'), { target: { value: tomorrow } })
      fireEvent.change(within(dialog).getByLabelText('Expected time (optional)'), {
        target: { value: '14:30' },
      })
      await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Travel delay')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Reschedule' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Doctor is unavailable on that date',
      )
      expect(within(dialog).getByLabelText('New date *')).toHaveValue(tomorrow)
      expect(within(dialog).getByLabelText('Expected time (optional)')).toHaveValue('14:30')
      expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('Travel delay')
    })

    it('closes reschedule modal and renders ConflictBanner on 409 version_conflict without crashing', async () => {
      renderAppointments({
        appointments: [makeAppointment({ id: 47, status: 'BOOKED' })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/47/reschedule') && init?.method === 'POST') {
            return jsonResponse({ code: 'version_conflict', message: 'Stale version' }, 409)
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()
      const row = screen.getByText('Aarav Kumar').closest('tr')!
      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Reschedule' }))

      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('New date *'), { target: { value: tomorrow } })
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Reschedule' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(/modified by another user/i)
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    })

    it('defaults RescheduleModal date and min to tomorrow for today NO_SHOW and TO_ARRIVE bookings', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 48, patient_name: 'Today NoShow', status: 'NO_SHOW', appointment_date: today }),
          makeAppointment({ id: 49, patient_name: 'Today ToArrive', status: 'TO_ARRIVE', appointment_date: today }),
          makeAppointment({ id: 490, patient_name: 'Today Booked', status: 'BOOKED', appointment_date: today }),
        ],
      })

      await screen.findByText('Today Booked')
      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'All (3)' }))
      const table = screen.getByRole('table')

      // Today's NO_SHOW requires tomorrow
      const noShowRow = within(table).getByText('Today NoShow').closest('tr')!
      await openRowMoreMenu(user, noShowRow)
      await user.click(within(noShowRow).getByRole('menuitem', { name: 'Reschedule' }))
      let dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByLabelText('New date *')).toHaveValue(tomorrow)
      expect(within(dialog).getByLabelText('New date *')).toHaveAttribute('min', tomorrow)
      await user.click(within(dialog).getByRole('button', { name: 'Keep current date' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Today's TO_ARRIVE requires tomorrow
      const toArriveRow = within(table).getByText('Today ToArrive').closest('tr')!
      await openRowMoreMenu(user, toArriveRow)
      await user.click(within(toArriveRow).getByRole('menuitem', { name: 'Reschedule' }))
      dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByLabelText('New date *')).toHaveValue(tomorrow)
      expect(within(dialog).getByLabelText('New date *')).toHaveAttribute('min', tomorrow)
      await user.click(within(dialog).getByRole('button', { name: 'Keep current date' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Today's BOOKED still allows today (time-only reschedule)
      const bookedRow = within(table).getByText('Today Booked').closest('tr')!
      await openRowMoreMenu(user, bookedRow)
      await user.click(within(bookedRow).getByRole('menuitem', { name: 'Reschedule' }))
      dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByLabelText('New date *')).toHaveValue(today)
      expect(within(dialog).getByLabelText('New date *')).toHaveAttribute('min', today)
    })
  })

  describe('No-Show & Cancel (Booking + Arrival) via More menu', () => {
    it('enforces No-Show status and date guards and submits PATCH /appointments/:id/status', async () => {
      let patchedBody: unknown = null

      renderAppointments({
        appointments: [
          makeAppointment({ id: 50, patient_name: 'G Booked', status: 'BOOKED', appointment_date: today }),
          makeAppointment({ id: 51, patient_name: 'G ToArrive', status: 'TO_ARRIVE', appointment_date: today }),
          makeAppointment({ id: 52, patient_name: 'G Registered', status: 'REGISTERED', appointment_date: today }),
          makeAppointment({ id: 53, patient_name: 'G NoShow', status: 'NO_SHOW', appointment_date: today }),
          makeAppointment({ id: 54, patient_name: 'G Arrived', status: 'ARRIVED', consultation_status: 'WAITING', appointment_date: today }),
          makeAppointment({ id: 55, patient_name: 'Future Booking', status: 'BOOKED', appointment_date: tomorrow }),
          makeAppointment({ id: 56, patient_name: 'Past Booking', status: 'BOOKED', appointment_date: yesterday }),
        ],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/50/status') && init?.method === 'PATCH') {
            patchedBody = JSON.parse(init.body as string)
            return jsonResponse(makeAppointment({ id: 50, status: 'NO_SHOW', version_id: 2 }))
          }
          return undefined
        },
      })

      await screen.findByText('Past Booking')
      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'All (7)' }))
      const table = screen.getByRole('table')

      // Future booking: no Check in, no No-Show, keeps Reschedule & Cancel booking
      const futureRow = within(table).getByText('Future Booking').closest('tr')!
      expect(within(futureRow).queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument()
      await openRowMoreMenu(user, futureRow)
      expect(within(futureRow).queryByRole('menuitem', { name: 'No-Show' })).not.toBeInTheDocument()
      expect(within(futureRow).getByRole('menuitem', { name: 'Reschedule' })).toBeInTheDocument()
      expect(within(futureRow).getByRole('menuitem', { name: 'Cancel booking' })).toBeInTheDocument()

      // Past booking: no Check in, keeps No-Show
      const pastRow = within(table).getByText('Past Booking').closest('tr')!
      expect(within(pastRow).queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument()
      await openRowMoreMenu(user, pastRow)
      expect(within(pastRow).getByRole('menuitem', { name: 'No-Show' })).toBeInTheDocument()

      // Status guards: REGISTERED, NO_SHOW, ARRIVED omit No-Show; TO_ARRIVE & BOOKED include No-Show
      for (const name of ['G Registered', 'G NoShow', 'G Arrived']) {
        const row = within(table).getByText(name).closest('tr')!
        await openRowMoreMenu(user, row)
        expect(within(row).queryByRole('menuitem', { name: 'No-Show' })).not.toBeInTheDocument()
      }

      const toArriveRow = within(table).getByText('G ToArrive').closest('tr')!
      await openRowMoreMenu(user, toArriveRow)
      expect(within(toArriveRow).getByRole('menuitem', { name: 'No-Show' })).toBeInTheDocument()

      const bookedRow = within(table).getByText('G Booked').closest('tr')!
      await openRowMoreMenu(user, bookedRow)
      await user.click(within(bookedRow).getByRole('menuitem', { name: 'No-Show' }))

      await waitFor(() => {
        expect(patchedBody).toEqual({
          status: 'NO_SHOW',
          version_id: 1,
          cancellation_reason: null,
        })
      })
    })

    it('disables No-Show menuitem while update is pending and prevents duplicate PATCH calls', async () => {
      let patchCalls = 0
      let resolvePatch!: (value: ReturnType<typeof jsonResponse>) => void

      renderAppointments({
        appointments: [makeAppointment({ id: 74, status: 'BOOKED' })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/74/status') && init?.method === 'PATCH') {
            patchCalls += 1
            return new Promise((resolve) => {
              resolvePatch = resolve
            })
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()
      const row = screen.getByText('Aarav Kumar').closest('tr')!

      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'No-Show' }))
      await waitFor(() => expect(patchCalls).toBe(1))

      // Re-opening More while mutation is in flight shows No-Show disabled
      await openRowMoreMenu(user, row)
      const noShowItem = within(row).getByRole('menuitem', { name: 'No-Show' })
      expect(noShowItem).toBeDisabled()
      await user.click(noShowItem)
      expect(patchCalls).toBe(1)

      resolvePatch(jsonResponse(makeAppointment({ id: 74, status: 'NO_SHOW', version_id: 2 })))
      await waitFor(() => {
        expect(noShowItem).not.toBeDisabled()
      })
    })

    it('enforces Cancel booking visibility guards across all 12 statuses', async () => {
      renderAppointments({
        appointments: [
          makeAppointment({ id: 60, patient_name: 'C Booked', status: 'BOOKED' }),
          makeAppointment({ id: 61, patient_name: 'C ToArrive', status: 'TO_ARRIVE' }),
          makeAppointment({ id: 62, patient_name: 'C Registered', status: 'REGISTERED' }),
          makeAppointment({ id: 63, patient_name: 'C Arrived', status: 'ARRIVED', consultation_status: null }),
          makeAppointment({ id: 64, patient_name: 'C CheckedIn', status: 'CHECKED_IN', consultation_status: 'WAITING' }),
          makeAppointment({ id: 65, patient_name: 'C Waiting', status: 'WAITING', consultation_status: 'WAITING' }),
          makeAppointment({ id: 66, patient_name: 'C NoShow', status: 'NO_SHOW' }),
          makeAppointment({ id: 67, patient_name: 'C InConsult', status: 'IN_CONSULTATION', consultation_status: 'IN_CONSULTATION' }),
          makeAppointment({ id: 68, patient_name: 'C Done', status: 'DONE' }),
          makeAppointment({ id: 69, patient_name: 'C Completed', status: 'COMPLETED' }),
          makeAppointment({ id: 70, patient_name: 'C Cancelled', status: 'CANCELLED' }),
          makeAppointment({ id: 71, patient_name: 'C Rescheduled', status: 'RESCHEDULED' }),
        ],
      })

      await screen.findByText('C Booked')
      const user = userEvent.setup()
      const filters = within(screen.getByRole('group', { name: 'Filter appointments' }))
      await user.click(filters.getByRole('button', { name: 'All (12)' }))

      const table = screen.getByRole('table')
      for (const name of ['C Booked', 'C ToArrive', 'C Registered', 'C CheckedIn', 'C Waiting']) {
        const row = within(table).getByText(name).closest('tr')!
        await openRowMoreMenu(user, row)
        expect(within(row).getByRole('menuitem', { name: 'Cancel booking' })).toBeInTheDocument()
      }
      for (const name of ['C NoShow', 'C InConsult']) {
        const row = within(table).getByText(name).closest('tr')!
        await openRowMoreMenu(user, row)
        expect(within(row).queryByRole('menuitem', { name: 'Cancel booking' })).not.toBeInTheDocument()
      }
      for (const name of ['C Arrived', 'C Done', 'C Completed', 'C Cancelled', 'C Rescheduled']) {
        const row = within(table).getByText(name).closest('tr')!
        expect(within(row).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
      }
    })

    it('submits Cancel booking PATCH with min 3-char reason, clears draft on dismiss, and handles 422 & 409', async () => {
      let attempt = 0
      let lastCancelBody: unknown = null

      renderAppointments({
        appointments: [makeAppointment({ id: 72, status: 'BOOKED', version_id: 2 })],
        onFetch: (url, init) => {
          if (url.includes('/api/appointments/72/status') && init?.method === 'PATCH') {
            attempt += 1
            lastCancelBody = JSON.parse(init.body as string)
            if (attempt === 1) {
              return jsonResponse(
                { code: 'invalid_transition', message: 'Appointment is already in consultation' },
                422,
              )
            }
            if (attempt === 2) {
              return jsonResponse({ code: 'version_conflict', message: 'Conflict' }, 409)
            }
            return jsonResponse(makeAppointment({ id: 72, status: 'CANCELLED', version_id: 3 }))
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()
      const row = screen.getByText('Aarav Kumar').closest('tr')!

      // Dismissing via Keep appointment clears typed reason on reopen
      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Cancel booking' }))
      let dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Cancel Appointment' })).toBeInTheDocument()
      await user.type(within(dialog).getByLabelText('Cancellation reason *'), 'Draft reason')
      await user.click(within(dialog).getByRole('button', { name: 'Keep appointment' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Reopen -> empty, min 3-char guard (including whitespace)
      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Cancel booking' }))
      dialog = await screen.findByRole('dialog')
      const textarea = within(dialog).getByLabelText('Cancellation reason *')
      const confirmBtn = within(dialog).getByRole('button', { name: 'Confirm Cancellation' })
      expect(textarea).toHaveValue('')
      expect(confirmBtn).toBeDisabled()

      await user.type(textarea, 'ab')
      expect(confirmBtn).toBeDisabled()
      await user.clear(textarea)
      await user.type(textarea, '  a ')
      expect(confirmBtn).toBeDisabled()

      // Attempt 1 -> 422 inline preserving reason
      await user.clear(textarea)
      await user.type(textarea, 'Patient unwell today')
      expect(confirmBtn).not.toBeDisabled()
      await user.click(confirmBtn)

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Appointment is already in consultation',
      )
      expect(textarea).toHaveValue('Patient unwell today')
      expect(lastCancelBody).toEqual({
        status: 'CANCELLED',
        version_id: 2,
        cancellation_reason: 'Patient unwell today',
      })

      // Attempt 2 -> 409 closes dialog and renders ConflictBanner
      await user.click(confirmBtn)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByRole('alert')).toHaveTextContent(/modified by another user/i)
      expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()

      // Attempt 3 -> 200 success closes dialog
      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Cancel booking' }))
      dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText('Cancellation reason *'), 'Confirmed cancel')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Cancellation' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('submits Cancel arrival POST /opd-arrivals/:id/cancel with min 3-char reason', async () => {
      let cancelArrivalBody: unknown = null

      renderAppointments({
        appointments: [],
        arrivals: [makeArrival({ id: 980, full_name: 'Walkin Cancel', version_id: 7 })],
        onFetch: (url, init) => {
          if (url.includes('/api/opd-arrivals/980/cancel') && init?.method === 'POST') {
            cancelArrivalBody = JSON.parse(init.body as string)
            return jsonResponse(makeArrival({ id: 980, status: 'CANCELLED', version_id: 8 }))
          }
          return undefined
        },
      })

      await screen.findByText('Walkin Cancel')
      const user = userEvent.setup()
      const row = screen.getByText('Walkin Cancel').closest('tr')!

      await openRowMoreMenu(user, row)
      await user.click(within(row).getByRole('menuitem', { name: 'Cancel arrival' }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Cancel Arrival' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Keep arrival' })).toBeInTheDocument()

      const textarea = within(dialog).getByLabelText('Cancellation reason *')
      const confirmBtn = within(dialog).getByRole('button', { name: 'Confirm Cancellation' })
      expect(confirmBtn).toBeDisabled()

      await user.type(textarea, 'no')
      expect(confirmBtn).toBeDisabled()

      await user.clear(textarea)
      await user.type(textarea, 'Left clinic early')
      await user.click(confirmBtn)

      await waitFor(() => {
        expect(cancelArrivalBody).toEqual({
          version_id: 7,
          reason: 'Left clinic early',
        })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  describe('Role preservation (ADMIN & DOCTOR)', () => {
    it('keeps appointment actions read-only for ADMIN and skips pending arrivals fetch', async () => {
      const { mockFetch } = renderAppointments({ me: adminMe })

      await screen.findByText('Aarav Kumar')

      expect(screen.getByText('Read-only schedule')).toBeInTheDocument()
      expect(screen.getByText('View only')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /create opd token/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /book appointment/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /check-in & token/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/opd-arrivals'),
        expect.anything(),
      )
    })

    it('opens the doctor-only prescription follow-up tab from its deep link', async () => {
      const followUps = [
        {
          id: 71,
          patient_id: 101,
          patient_urn: 'KH-2026-0001',
          patient_name: 'Aarav Kumar',
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          encounter_id: null,
          diagnosis: 'Knee rehabilitation',
          items_count: 2,
          follow_up_date: shiftDate(today, 10),
          created_at: '2026-11-01T10:00:00Z',
        },
      ]

      const { mockFetch } = renderAppointments({
        me: doctorMe,
        appointments: [],
        followUps,
        initialEntries: ['/reception/appointments?tab=followup'],
      })

      await screen.findByText('Aarav Kumar')

      expect(screen.getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('Knee rehabilitation')).toBeInTheDocument()
      expect(screen.getByText('Upcoming')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open patient' })).toHaveAttribute(
        'href',
        '/reception/patients/101',
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/prescriptions/follow-ups'),
        expect.anything(),
      )
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/opd-arrivals'),
        expect.anything(),
      )
    })

    it('preserves DOCTOR tablist, OPD cabin pacing controls, skips arrivals fetch, and restricts reception-only actions on Schedule', async () => {
      const { mockFetch } = renderAppointments({
        me: doctorMe,
        appointments: [
          makeAppointment({ id: 80, patient_name: 'Doc Booked', status: 'BOOKED' }),
          makeAppointment({
            id: 81,
            patient_name: 'Doc CheckedIn Waiting',
            status: 'ARRIVED',
            consultation_status: 'WAITING',
          }),
          makeAppointment({
            id: 82,
            patient_name: 'Doc Waiting Status',
            status: 'CHECKED_IN',
            consultation_status: 'WAITING',
          }),
        ],
      })

      // Doctor lands on Follow-ups with Follow-ups / Schedule tablist
      expect(await screen.findByRole('heading', { level: 1, name: 'Follow-ups' })).toBeInTheDocument()
      expect(screen.getByRole('tablist')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('tab', { name: 'Appointments' })).not.toBeInTheDocument()

      const user = userEvent.setup()
      await user.click(screen.getByRole('tab', { name: 'Schedule' }))
      expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument()

      await screen.findByText('Doc CheckedIn Waiting')

      // Pacing banner and local-only emergency hold
      expect(screen.getByText(/OPD Cabin Pacing & Doctor Schedule/i)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Mark emergency hold/i }))
      expect(screen.getByText(/marked on this screen only/i)).toBeInTheDocument()
      expect(screen.getByText('NOT SENT')).toBeInTheDocument()
      expect(screen.getByText(/Resume normal queue/i)).toBeInTheDocument()

      // Doctor RBAC guards on Schedule: no Create OPD Token, no Check in, no Reschedule, no pending arrivals fetch
      expect(screen.queryByRole('button', { name: /create opd token/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /check-in & token/i })).not.toBeInTheDocument()
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/opd-arrivals'),
        expect.anything(),
      )

      const table = screen.getByRole('table')
      expect(within(table).queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument()

      const bookedRow = within(table).getByText('Doc Booked').closest('tr')!
      await openRowMoreMenu(user, bookedRow)
      expect(within(bookedRow).getByRole('menuitem', { name: 'Cancel booking' })).toBeInTheDocument()
      expect(within(bookedRow).getByRole('menuitem', { name: 'No-Show' })).toBeInTheDocument()
      expect(within(bookedRow).queryByRole('menuitem', { name: 'Reschedule' })).not.toBeInTheDocument()

      const arrivedWaitingRow = within(table).getByText('Doc CheckedIn Waiting').closest('tr')!
      expect(within(arrivedWaitingRow).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()

      const checkedInRow = within(table).getByText('Doc Waiting Status').closest('tr')!
      expect(within(checkedInRow).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    })

    it('hides Create OPD Token in empty state for DOCTOR and locks Schedule to own doctor without cross-doctor filter', async () => {
      const { mockFetch } = renderAppointments({
        me: doctorMe,
        appointments: [],
        initialEntries: ['/reception/appointments?tab=today'],
      })

      await screen.findByText('No active appointments for this date and doctor.')

      expect(screen.queryByRole('button', { name: /create opd token/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /book appointment/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Doctor')).not.toBeInTheDocument()
      expect(document.getElementById('doctor-filter')).toBeNull()
      expect(screen.getByTestId('doctor-schedule-scope-pill')).toHaveTextContent(
        'Showing your schedule',
      )

      const apptCalls = mockFetch.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.includes('/api/appointments'))
      expect(apptCalls.length).toBeGreaterThan(0)
      for (const callUrl of apptCalls) {
        const parsed = new URL(callUrl, 'http://localhost')
        expect(parsed.searchParams.get('doctor_id')).toBe('1')
      }
    })
  })

  describe('Follow-ups queue (T4.3: Reception, Admin & Doctor)', () => {
    it('Reception switches to Follow-ups tab, fetches /api/reception/follow-ups (never /api/prescriptions/follow-ups), omits clinical_reason, and books or closes recommendations', async () => {
      let currentRecs: ReceptionFollowUpResponse[] = [
        makeReceptionFollowUp({
          id: 601,
          patient_id: 101,
          patient_name: 'Aarav Kumar',
          patient_urn: 'KH-2026-0001',
          patient_mobile: '9876543210',
          recommended_doctor_name: 'Dr. Madan Mohan Dwivedi',
          recommended_date: shiftDate(today, 5),
          status: 'PENDING',
        }),
        makeReceptionFollowUp({
          id: 602,
          patient_id: 102,
          patient_name: 'Meera Devi',
          patient_urn: 'KH-2026-0002',
          patient_mobile: '9988776655',
          recommended_doctor_id: 2,
          recommended_doctor_name: 'Dr. Priya Sharma',
          recommended_date: yesterday,
          status: 'PENDING',
        }),
      ]
      let bookPayload: unknown = null
      let closePayload: unknown = null

      const { mockFetch } = renderAppointments({
        me: mockMe,
        appointments: [makeAppointment()],
        onFetch: (url, init) => {
          if (url.includes('/api/reception/follow-ups')) {
            const parsed = new URL(url, 'http://localhost')
            const statusParam = parsed.searchParams.get('status')
            const overdueParam = parsed.searchParams.get('overdue')
            let filtered = currentRecs
            if (statusParam) {
              filtered = filtered.filter((r) => r.status === statusParam.toUpperCase())
            }
            if (overdueParam === 'true') {
              filtered = filtered.filter((r) => r.status === 'PENDING' && r.recommended_date < today)
            }
            // Even if raw object somehow had extra clinical_reason, Reception must never render it
            return jsonResponse(
              filtered.map((r) => ({ ...r, clinical_reason: 'CONFIDENTIAL_DIAGNOSIS_NOTE' })),
            )
          }
          if (url.includes('/api/follow-ups/601/book') && init?.method === 'POST') {
            bookPayload = JSON.parse(init.body as string)
            currentRecs = currentRecs.map((r) =>
              r.id === 601 ? { ...r, status: 'BOOKED', booked_appointment_id: 999 } : r,
            )
            return jsonResponse(currentRecs.find((r) => r.id === 601))
          }
          if (url.includes('/api/follow-ups/602/close') && init?.method === 'POST') {
            closePayload = JSON.parse(init.body as string)
            currentRecs = currentRecs.map((r) => (r.id === 602 ? { ...r, status: 'CLOSED' } : r))
            return jsonResponse(currentRecs.find((r) => r.id === 602))
          }
          return undefined
        },
      })

      await screen.findByText('Aarav Kumar')
      // While on default Appointments tab, neither follow-up endpoint is fetched
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/reception/follow-ups'),
        expect.anything(),
      )
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/prescriptions/follow-ups'),
        expect.anything(),
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole('tab', { name: 'Follow-ups' }))

      await screen.findByRole('heading', { level: 2, name: 'Follow-up Recommendations' })
      expect(screen.getByRole('tab', { name: 'Follow-ups' })).toHaveAttribute('aria-selected', 'true')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/reception/follow-ups?status=PENDING'),
        expect.anything(),
      )
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/prescriptions/follow-ups'),
        expect.anything(),
      )

      // Privacy invariant: clinical_reason must NEVER be rendered
      expect(screen.queryByText(/CONFIDENTIAL_DIAGNOSIS_NOTE/)).not.toBeInTheDocument()

      const table = screen.getByRole('table')
      const aaravRow = within(table).getByText('Aarav Kumar').closest('tr')!
      expect(within(aaravRow).getByRole('link', { name: 'Aarav Kumar' })).toHaveAttribute(
        'href',
        '/reception/patients/101',
      )
      expect(within(aaravRow).getByText('KH-2026-0001')).toBeInTheDocument()
      expect(within(aaravRow).getByText('9876543210')).toBeInTheDocument()
      expect(within(aaravRow).getByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
      expect(within(aaravRow).getByText('Pending')).toBeInTheDocument()

      const meeraRow = within(table).getByText('Meera Devi').closest('tr')!
      expect(within(meeraRow).getByText('Overdue')).toBeInTheDocument()

      // Book Appointment flow -> POST /api/follow-ups/601/book
      await user.click(within(aaravRow).getByRole('button', { name: 'Book Appointment' }))
      let dialog = await screen.findByRole('dialog')
      expect(
        within(dialog).getByRole('heading', { name: 'Book Follow-up Appointment' }),
      ).toBeInTheDocument()
      const overrideDate = shiftDate(today, 6)
      fireEvent.change(within(dialog).getByLabelText('Appointment date'), {
        target: { value: overrideDate },
      })
      await user.type(within(dialog).getByLabelText('Notes (optional)'), 'Morning slot requested')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Booking' }))

      await waitFor(() => {
        expect(bookPayload).toEqual({
          appointment_date: overrideDate,
          notes: 'Morning slot requested',
        })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Switch to Booked filter -> Aarav Kumar now appears as Booked with no action buttons
      const filterGroup = within(
        screen.getByRole('group', { name: 'Follow-up recommendation status filters' }),
      )
      await user.click(filterGroup.getByRole('button', { name: 'Booked' }))
      const bookedRow = (await within(screen.getByRole('table')).findByText('Aarav Kumar')).closest(
        'tr',
      )!
      expect(within(bookedRow).getByText('Booked')).toBeInTheDocument()
      expect(within(bookedRow).queryByRole('button', { name: 'Book Appointment' })).not.toBeInTheDocument()
      expect(within(bookedRow).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

      // Switch to Overdue filter and Close Meera Devi -> POST /api/follow-ups/602/close
      await user.click(filterGroup.getByRole('button', { name: 'Overdue' }))
      const overdueRow = (await within(screen.getByRole('table')).findByText('Meera Devi')).closest(
        'tr',
      )!
      await user.click(within(overdueRow).getByRole('button', { name: 'Close' }))

      dialog = await screen.findByRole('dialog')
      expect(
        within(dialog).getByRole('heading', { name: 'Close Follow-up Recommendation' }),
      ).toBeInTheDocument()
      const reasonBox = within(dialog).getByLabelText('Closure reason *')
      const confirmCloseBtn = within(dialog).getByRole('button', { name: 'Confirm Close' })
      expect(confirmCloseBtn).toBeDisabled()
      await user.type(reasonBox, 'no')
      expect(confirmCloseBtn).toBeDisabled()
      await user.clear(reasonBox)
      await user.type(reasonBox, 'Patient declined follow-up')
      expect(confirmCloseBtn).toBeEnabled()
      await user.click(confirmCloseBtn)

      await waitFor(() => {
        expect(closePayload).toEqual({ reason: 'Patient declined follow-up' })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Switch to Closed filter -> Meera Devi appears as Closed
      await user.click(filterGroup.getByRole('button', { name: 'Closed' }))
      const closedRow = (await within(screen.getByRole('table')).findByText('Meera Devi')).closest(
        'tr',
      )!
      expect(within(closedRow).getByText('Closed')).toBeInTheDocument()

      // Still NEVER called /api/prescriptions/follow-ups
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/prescriptions/follow-ups'),
        expect.anything(),
      )
    })

    it('ADMIN sees Follow-ups tab in read-only mode without Book Appointment or Close actions and never calls /api/prescriptions/follow-ups', async () => {
      const { mockFetch } = renderAppointments({
        me: adminMe,
        receptionFollowUps: [
          makeReceptionFollowUp({
            id: 701,
            patient_name: 'Admin View Patient',
            patient_urn: 'KH-2026-0701',
            status: 'PENDING',
          }),
        ],
      })

      await screen.findByText('Aarav Kumar')
      const user = userEvent.setup()
      await user.click(screen.getByRole('tab', { name: 'Follow-ups' }))

      await screen.findByText('Admin View Patient')
      expect(screen.getByText('Read-only follow-ups')).toBeInTheDocument()
      expect(screen.getByText('View only')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Book Appointment' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/reception/follow-ups'),
        expect.anything(),
      )
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/prescriptions/follow-ups'),
        expect.anything(),
      )
    })

    it('DOCTOR sees own clinical follow-up recommendations (Close on PENDING, NO Book Appointment) + authorised prescription return dates (no Mark to recall or Cabin link)', async () => {
      let doctorClosePayload: unknown = null
      let recs: ReceptionFollowUpResponse[] = [
        makeReceptionFollowUp({
          id: 801,
          patient_id: 101,
          patient_name: 'Clinical Rec Pending',
          patient_urn: 'KH-2026-0801',
          recommended_doctor_id: 1,
          recommended_doctor_name: 'Dr. Madan Mohan Dwivedi',
          status: 'PENDING',
        }),
        makeReceptionFollowUp({
          id: 802,
          patient_id: 102,
          patient_name: 'Clinical Rec Booked',
          patient_urn: 'KH-2026-0802',
          recommended_doctor_id: 1,
          recommended_doctor_name: 'Dr. Madan Mohan Dwivedi',
          status: 'BOOKED',
          booked_appointment_id: 444,
        }),
      ]

      const rxFollowUps = [
        {
          id: 91,
          patient_id: 103,
          patient_urn: 'KH-2026-0803',
          patient_name: 'Rx Return Patient',
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          encounter_id: 55,
          diagnosis: 'Lumbar strain',
          items_count: 3,
          follow_up_date: shiftDate(today, 4),
          created_at: `${today}T05:00:00Z`,
        },
      ]

      const { mockFetch } = renderAppointments({
        me: doctorMe,
        appointments: [],
        followUps: rxFollowUps,
        onFetch: (url, init) => {
          if (url.includes('/api/reception/follow-ups')) {
            const parsed = new URL(url, 'http://localhost')
            const statusParam = parsed.searchParams.get('status')
            const filtered = statusParam
              ? recs.filter((r) => r.status === statusParam.toUpperCase())
              : recs
            return jsonResponse(filtered)
          }
          if (url.includes('/api/follow-ups/801/close') && init?.method === 'POST') {
            doctorClosePayload = JSON.parse(init.body as string)
            recs = recs.map((r) => (r.id === 801 ? { ...r, status: 'CLOSED' } : r))
            return jsonResponse(recs.find((r) => r.id === 801))
          }
          return undefined
        },
      })

      // Doctor lands on Follow-ups tab showing both sections
      await screen.findByText('Clinical Rec Pending')
      await screen.findByText('Rx Return Patient')

      expect(
        screen.getByRole('heading', { level: 2, name: 'Clinical Follow-up Recommendations' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 2, name: 'Prescription return dates' }),
      ).toBeInTheDocument()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/reception/follow-ups'),
        expect.anything(),
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/prescriptions/follow-ups'),
        expect.anything(),
      )

      // Clinical recommendation row: has Close button, NO Book Appointment button
      const recRow = screen.getByText('Clinical Rec Pending').closest('tr')!
      expect(within(recRow).queryByRole('button', { name: 'Book Appointment' })).not.toBeInTheDocument()
      expect(within(recRow).getByRole('button', { name: 'Close' })).toBeInTheDocument()

      // Prescription return date row: NO Mark to recall button, NO broken Cabin link, clean Open patient link
      const rxRow = screen.getByText('Rx Return Patient').closest('tr')!
      expect(within(rxRow).queryByRole('button', { name: /mark to recall/i })).not.toBeInTheDocument()
      expect(within(rxRow).queryByRole('link', { name: 'Cabin' })).not.toBeInTheDocument()
      expect(within(rxRow).getByRole('link', { name: 'Open patient' })).toHaveAttribute(
        'href',
        '/reception/patients/103',
      )

      // Doctor closes own PENDING recommendation with >=3 char reason
      const user = userEvent.setup()
      await user.click(within(recRow).getByRole('button', { name: 'Close' }))
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText('Closure reason *'), 'Recovered completely')
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Close' }))

      await waitFor(() => {
        expect(doctorClosePayload).toEqual({ reason: 'Recovered completely' })
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Switch to Schedule tab -> NO #doctor-filter dropdown
      await user.click(screen.getByRole('tab', { name: 'Schedule' }))
      expect(await screen.findByTestId('doctor-schedule-scope-pill')).toHaveTextContent(
        'Showing your schedule',
      )
      expect(screen.queryByLabelText('Doctor')).not.toBeInTheDocument()
      expect(document.getElementById('doctor-filter')).toBeNull()
    })
  })
})
