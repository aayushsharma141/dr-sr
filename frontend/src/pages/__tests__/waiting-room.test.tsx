import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import type { Appointment } from '../../api/types'

const DEFAULT_DOCTORS = [
  { id: 1, name_en: 'Dr. Anil', is_active: true },
  { id: 2, name_en: 'Dr. Bharati', is_active: true },
]

const DEFAULT_PERMISSIONS = ['visit:write', 'appointment:write', 'payment:create']

type DoctorDepartmentsResult = {
  data?: { id: number; name_en: string }[]
  isSuccess?: boolean
  isPending?: boolean
  isError?: boolean
  refetch: ReturnType<typeof vi.fn>
}

const state: {
  appointments: Appointment[]
  permissions: string[]
  doctorsQuery: { data: typeof DEFAULT_DOCTORS | undefined; isError?: boolean }
  visitsQuery: { data?: { total: number; visits: { id: number }[] }; isSuccess: boolean; isPending?: boolean; isError?: boolean }
  doctorDepartmentsOverride: ((doctorId: number | null) => DoctorDepartmentsResult) | null
  doctorDepartmentsRefetch: ReturnType<typeof vi.fn>
  reassignMutate: ReturnType<typeof vi.fn>
  cancelMutate: ReturnType<typeof vi.fn>
} = {
  appointments: [],
  permissions: DEFAULT_PERMISSIONS,
  doctorsQuery: { data: DEFAULT_DOCTORS },
  visitsQuery: { data: { total: 1, visits: [{ id: 500 }] }, isSuccess: true },
  doctorDepartmentsOverride: null,
  doctorDepartmentsRefetch: vi.fn(),
  reassignMutate: vi.fn(),
  cancelMutate: vi.fn(),
}

vi.mock('../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'Reception Staff', role: 'RECEPTION', permissions: state.permissions } }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAppointments: () => ({ data: { total: state.appointments.length, appointments: state.appointments }, dataUpdatedAt: Date.parse('2026-11-15T04:30:00Z'), isError: false }),
  useVisits: () => state.visitsQuery,
  useDoctors: () => state.doctorsQuery,
  useDepartments: () => ({
    data: [
      { id: 10, name_en: 'General OPD', is_active: true },
      { id: 20, name_en: 'Ophthalmology', is_active: true },
    ],
  }),
  // Dr. Bharati belongs to Ophthalmology only; Dr. Anil belongs to General OPD.
  // Mirrors TanStack Query v5 where a disabled query (doctorId === null) has isPending: true.
  useDoctorDepartments: (doctorId: number | null) => {
    if (state.doctorDepartmentsOverride) return state.doctorDepartmentsOverride(doctorId)
    if (doctorId === null) {
      return { data: undefined, isSuccess: false, isPending: true, isError: false, refetch: state.doctorDepartmentsRefetch }
    }
    if (doctorId === 2) {
      return { data: [{ id: 20, name_en: 'Ophthalmology' }], isSuccess: true, isPending: false, isError: false, refetch: state.doctorDepartmentsRefetch }
    }
    return { data: [{ id: 10, name_en: 'General OPD' }], isSuccess: true, isPending: false, isError: false, refetch: state.doctorDepartmentsRefetch }
  },
  useReassignAppointment: () => ({ mutate: state.reassignMutate, isPending: false }),
  useUpdateAppointmentStatus: () => ({ mutate: state.cancelMutate, isPending: false }),
}))

import { WaitingRoom } from '../WaitingRoom'

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 1,
    department_id: 10,
    visit_id: 500,
    patient_id: 1,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Ram Kumar',
    patient_mobile: '9800000000',
    doctor_id: 1,
    doctor_name_en: 'Dr. Anil',
    doctor_name_hi: null,
    appointment_date: '2026-11-15',
    token_number: 1,
    status: 'ARRIVED',
    status_updated_at: '2026-11-15T04:00:00Z',
    cancellation_reason: null,
    notes: null,
    consultation_status: 'WAITING',
    priority_level: 'NORMAL',
    priority_updated_at: null,
    version_id: 2,
    created_at: '2026-11-15T03:00:00Z',
    ...overrides,
  } as Appointment
}

let latestSearch = ''
function SearchSpy() {
  latestSearch = useLocation().search
  return null
}

function renderPage(initialEntry = '/reception/waiting') {
  latestSearch = ''
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SearchSpy />
        <WaitingRoom />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WaitingRoom', () => {
  beforeEach(() => {
    state.reassignMutate.mockReset()
    state.cancelMutate.mockReset()
    state.doctorDepartmentsRefetch.mockReset()
  })

  afterEach(() => {
    cleanup()
    state.appointments = []
    state.permissions = DEFAULT_PERMISSIONS
    state.doctorsQuery = { data: DEFAULT_DOCTORS }
    state.visitsQuery = { data: { total: 1, visits: [{ id: 500 }] }, isSuccess: true }
    state.doctorDepartmentsOverride = null
  })

  it('orders waiting patients: emergency by classification time, then priority, then normal', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Normal One', priority_level: 'NORMAL' }),
      appt({ id: 2, token_number: 2, patient_name: 'Priority Two', priority_level: 'PRIORITY', priority_reason: 'Elderly' }),
      appt({ id: 3, token_number: 3, patient_name: 'Emergency Late', priority_level: 'EMERGENCY', priority_reason: 'Fall', priority_updated_at: '2026-11-15T04:20:00Z' }),
      appt({ id: 4, token_number: 4, patient_name: 'Emergency Early', priority_level: 'EMERGENCY', priority_reason: 'Breathless', priority_updated_at: '2026-11-15T04:10:00Z' }),
    ]
    renderPage()

    const waitingColumn = screen.getByRole('heading', { name: 'Waiting' }).closest('div')!.parentElement!
    const order = within(waitingColumn)
      .getAllByRole('article')
      .map((card) => card.querySelector('[data-testid="card-patient-name"]')?.textContent)
    expect(order).toEqual(['Emergency Early', 'Emergency Late', 'Priority Two', 'Normal One'])
  })

  it('computes a position for each waiting card and never shows a Complete control', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1 }),
      appt({ id: 2, token_number: 2, patient_name: 'Second', consultation_status: 'IN_CONSULTATION' }),
      appt({ id: 3, token_number: 3, patient_name: 'Done', consultation_status: 'COMPLETED' }),
    ]
    renderPage()

    expect(screen.getByText('Position 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument()
  })

  it('renders completed cards with Ready for checkout status and Collect payment link', () => {
    state.appointments = [appt({ id: 9, token_number: 9, patient_name: 'Paid Up', consultation_status: 'COMPLETED', patient_id: 77 })]
    renderPage()

    expect(screen.getByText('Ready for checkout')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Collect payment/i })
    expect(link).toHaveAttribute('href', '/reception/billing?appointment_id=9&patient_id=77')
  })

  it('filters by search text across name, URN and token', async () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Ram Kumar', patient_urn: 'KH-1' }),
      appt({ id: 2, token_number: 2, patient_name: 'Sita Devi', patient_urn: 'KH-2' }),
    ]
    renderPage()

    await userEvent.type(screen.getByLabelText(/Search by name, URN or token/i), 'sita')

    expect(screen.getByText('Sita Devi')).toBeInTheDocument()
    expect(screen.queryByText('Ram Kumar')).not.toBeInTheDocument()
  })

  it('shows Last updated', () => {
    renderPage()
    expect(screen.getByText(/Last updated/)).toBeInTheDocument()
  })

  it('reassign needs a department when the new doctor is outside the current one', async () => {
    state.appointments = [appt({ id: 1, token_number: 1, department_id: 10, doctor_id: 1 })]
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    const dialog = screen.getByRole('dialog', { hidden: true })
    await userEvent.selectOptions(within(dialog).getByLabelText('Move to doctor'), '2')

    // Dr. Bharati is not in General OPD, so a department choice appears.
    expect(within(dialog).getByLabelText('Department for this consultation')).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Eye complaint')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reassign & issue new token' }))

    expect(state.reassignMutate).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/Choose one of this doctor/)).toBeInTheDocument()
  })

  it('sends the reassignment with the chosen department and the version', async () => {
    state.appointments = [appt({ id: 1, token_number: 1, department_id: 10, doctor_id: 1, version_id: 5 })]
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    const dialog = screen.getByRole('dialog', { hidden: true })
    await userEvent.selectOptions(within(dialog).getByLabelText('Move to doctor'), '2')
    await userEvent.selectOptions(within(dialog).getByLabelText('Department for this consultation'), '20')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Eye complaint')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reassign & issue new token' }))

    expect(state.reassignMutate).toHaveBeenCalledTimes(1)
    expect(state.reassignMutate.mock.calls[0][0]).toEqual({
      id: 1,
      body: { version_id: 5, new_doctor_id: 2, new_department_id: 20, reason: 'Eye complaint' },
    })
  })

  it('refuses a cancellation reason shorter than 3 characters', async () => {
    state.appointments = [appt({ id: 1, token_number: 1 })]
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel consultation' }))
    await userEvent.type(screen.getByLabelText('Reason for cancelling'), 'ab')
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel consultation' }).at(-1)!)

    expect(state.cancelMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('at least 3 characters')
  })

  it('shows distinct empty copy for each column when empty', () => {
    state.appointments = []
    renderPage()

    expect(screen.getByText('No one is waiting.')).toBeInTheDocument()
    expect(screen.getByText('No one is in a cabin.')).toBeInTheDocument()
    expect(screen.getByText('No consultations completed yet today.')).toBeInTheDocument()
  })

  it('maintains doctor filter, department filter and search after actions', async () => {
    state.appointments = [
      appt({
        id: 1,
        token_number: 1,
        doctor_id: 1,
        department_id: 10,
        patient_name: 'Anita Devi',
        patient_urn: 'KH-001',
      }),
    ]
    renderPage()

    await userEvent.selectOptions(screen.getByLabelText('Doctor'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Department'), '10')
    await userEvent.type(screen.getByLabelText(/Search by name, URN or token/i), 'Anita')

    expect(screen.getByText('Anita Devi')).toBeInTheDocument()

    // Trigger cancel consultation
    await userEvent.click(screen.getByRole('button', { name: 'Cancel consultation' }))
    await userEvent.type(screen.getByLabelText('Reason for cancelling'), 'Patient had an emergency')
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel consultation' }).at(-1)!)

    expect(state.cancelMutate).toHaveBeenCalledTimes(1)

    // Simulate onSuccess
    const onSuccess = state.cancelMutate.mock.calls[0][1]?.onSuccess
    if (onSuccess) {
      act(() => {
        onSuccess()
      })
    }

    // Verify filter inputs are still retained
    expect(screen.getByLabelText('Doctor')).toHaveValue('1')
    expect(screen.getByLabelText('Department')).toHaveValue('10')
    expect(screen.getByLabelText(/Search by name, URN or token/i)).toHaveValue('Anita')
  })

  it('pre-filters cards and Doctor select when opened with ?doctor_id=2', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil Patient' }),
      appt({ id: 2, token_number: 2, doctor_id: 2, doctor_name_en: 'Dr. Bharati', patient_name: 'Bharati Patient' }),
    ]
    renderPage('/reception/waiting?doctor_id=2')

    expect(screen.getByLabelText('Doctor')).toHaveValue('2')
    expect(screen.getByText('Bharati Patient')).toBeInTheDocument()
    expect(screen.queryByText('Anil Patient')).not.toBeInTheDocument()
  })

  it.each(['abc', '0', '02', '999'])(
    'falls back to all doctors when ?doctor_id=%s is invalid or unknown',
    (rawId) => {
      state.appointments = [
        appt({ id: 1, token_number: 1, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil Patient' }),
        appt({ id: 2, token_number: 2, doctor_id: 2, doctor_name_en: 'Dr. Bharati', patient_name: 'Bharati Patient' }),
      ]
      renderPage(`/reception/waiting?doctor_id=${rawId}`)

      expect(screen.getByLabelText('Doctor')).toHaveValue('')
      expect(screen.getByText('Anil Patient')).toBeInTheDocument()
      expect(screen.getByText('Bharati Patient')).toBeInTheDocument()
    },
  )

  it('falls back to all doctors when useDoctors errors without data', () => {
    state.doctorsQuery = { data: undefined, isError: true }
    state.appointments = [
      appt({ id: 1, token_number: 1, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil Patient' }),
      appt({ id: 2, token_number: 2, doctor_id: 2, doctor_name_en: 'Dr. Bharati', patient_name: 'Bharati Patient' }),
    ]
    renderPage('/reception/waiting?doctor_id=2')

    expect(screen.getByLabelText('Doctor')).toHaveValue('')
    expect(screen.getByText('Anil Patient')).toBeInTheDocument()
    expect(screen.getByText('Bharati Patient')).toBeInTheDocument()
  })

  it('preserves validated doctor_id while doctors are still loading', () => {
    state.doctorsQuery = { data: undefined, isError: false }
    state.appointments = [
      appt({ id: 1, token_number: 1, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil Patient' }),
      appt({ id: 2, token_number: 2, doctor_id: 2, doctor_name_en: 'Dr. Bharati', patient_name: 'Bharati Patient' }),
    ]
    renderPage('/reception/waiting?doctor_id=2')

    expect(screen.getByText('Bharati Patient')).toBeInTheDocument()
    expect(screen.queryByText('Anil Patient')).not.toBeInTheDocument()
  })

  it('updates displayed queue and URL query param when changing the Doctor select', async () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil Patient' }),
      appt({ id: 2, token_number: 2, doctor_id: 2, doctor_name_en: 'Dr. Bharati', patient_name: 'Bharati Patient' }),
    ]
    renderPage('/reception/waiting')

    await userEvent.selectOptions(screen.getByLabelText('Doctor'), '2')
    expect(latestSearch).toBe('?doctor_id=2')
    expect(screen.getByText('Bharati Patient')).toBeInTheDocument()
    expect(screen.queryByText('Anil Patient')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Doctor'), '')
    expect(latestSearch).toBe('')
    expect(screen.getByText('Anil Patient')).toBeInTheDocument()
    expect(screen.getByText('Bharati Patient')).toBeInTheDocument()
  })

  it('computes independent per-doctor queue positions and Next up badges under All doctors', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil First' }),
      appt({ id: 2, token_number: 2, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil Second' }),
      appt({ id: 3, token_number: 1, doctor_id: 2, doctor_name_en: 'Dr. Bharati', patient_name: 'Bharati First' }),
    ]
    renderPage()

    const anilFirst = screen.getByText('Anil First').closest('article')!
    const anilSecond = screen.getByText('Anil Second').closest('article')!
    const bharatiFirst = screen.getByText('Bharati First').closest('article')!

    expect(within(anilFirst).getByText('Position 1')).toBeInTheDocument()
    expect(within(anilFirst).getByText('Next up')).toBeInTheDocument()

    expect(within(anilSecond).getByText('Position 2')).toBeInTheDocument()
    expect(within(anilSecond).queryByText('Next up')).not.toBeInTheDocument()

    expect(within(bharatiFirst).getByText('Position 1')).toBeInTheDocument()
    expect(within(bharatiFirst).getByText('Next up')).toBeInTheDocument()
  })

  it('preserves true queue position and omits Next up when searching for a later waiting patient', async () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil First' }),
      appt({ id: 2, token_number: 2, doctor_id: 1, doctor_name_en: 'Dr. Anil', patient_name: 'Anil Second' }),
    ]
    renderPage()

    await userEvent.type(screen.getByLabelText(/Search by name, URN or token/i), 'Anil Second')

    expect(screen.queryByText('Anil First')).not.toBeInTheDocument()
    const card = screen.getByText('Anil Second').closest('article')!
    expect(within(card).getByText('Position 2')).toBeInTheDocument()
    expect(within(card).queryByText('Next up')).not.toBeInTheDocument()
  })

  it('sorts untokened waiting patients after token #1', () => {
    state.appointments = [
      appt({ id: 1, token_number: null, patient_name: 'Untokened Patient' }),
      appt({ id: 2, token_number: 1, patient_name: 'Token One Patient' }),
    ]
    renderPage()

    const waitingColumn = screen.getByRole('region', { name: 'Waiting' })
    const order = within(waitingColumn)
      .getAllByRole('article')
      .map((card) => card.querySelector('[data-testid="card-patient-name"]')?.textContent)
    expect(order).toEqual(['Token One Patient', 'Untokened Patient'])
  })

  it('renders In Cabin status, allows BR-013 cancellation, maps API errors, and clears form state on toggle close', async () => {
    state.appointments = [
      appt({
        id: 12,
        token_number: 4,
        patient_name: 'Cabin Patient',
        consultation_status: 'IN_CONSULTATION',
        version_id: 7,
      }),
    ]
    renderPage()

    const cabinCard = screen.getByText('Cabin Patient').closest('article')!
    expect(within(cabinCard).getByText('Consultation in progress')).toBeInTheDocument()
    expect(within(cabinCard).getByText('Completed by doctor')).toBeInTheDocument()
    expect(within(cabinCard).queryByRole('button', { name: /complete|call/i })).not.toBeInTheDocument()

    const toggleBtn = within(cabinCard).getByRole('button', { name: 'Cancel consultation' })
    await userEvent.click(toggleBtn)
    await userEvent.type(within(cabinCard).getByLabelText('Reason for cancelling'), 'Patient walked out')
    await userEvent.click(within(cabinCard).getAllByRole('button', { name: 'Cancel consultation' }).at(-1)!)

    expect(state.cancelMutate).toHaveBeenCalledTimes(1)
    expect(state.cancelMutate.mock.calls[0][0]).toEqual({
      id: 12,
      body: { status: 'CANCELLED', version_id: 7, cancellation_reason: 'Patient walked out' },
    })

    const onError = state.cancelMutate.mock.calls[0][1]?.onError as (err: unknown) => void

    act(() => {
      onError(new ApiError(422, 'cannot_cancel_finalised', 'Encounter finalised'))
    })
    expect(within(cabinCard).getByRole('alert')).toHaveTextContent(/already finalised and cannot be cancelled/i)

    act(() => {
      onError(new ApiError(422, 'invalid_status_transition', 'Status changed'))
    })
    expect(within(cabinCard).getByRole('alert')).toHaveTextContent(/already changed status\. The queue has refreshed/i)

    act(() => {
      onError(new ApiError(409, 'version_conflict', 'Stale version'))
    })
    expect(within(cabinCard).getByRole('alert')).toHaveTextContent(/updated by someone else\. The queue has refreshed/i)

    // Toggling Cancel consultation closed clears both error alert and entered reason
    await userEvent.click(toggleBtn)
    expect(within(cabinCard).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(cabinCard).queryByLabelText('Reason for cancelling')).not.toBeInTheDocument()

    await userEvent.click(toggleBtn)
    expect(within(cabinCard).getByLabelText('Reason for cancelling')).toHaveValue('')
  })

  it('uses adaptive grid and empty checkout guidance when no consultations are completed', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Waiting Patient' }),
    ]
    renderPage()

    const board = screen.getByTestId('waiting-room-board')
    expect(board).toHaveClass('lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(15rem,0.75fr)]')
    expect(screen.getByText('No consultations completed yet today.')).toBeInTheDocument()
    expect(screen.getByText('Completed visits appear here ready for checkout.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Billing & Checkout/i })).toHaveAttribute('href', '/reception/billing')
  })

  it('switches to equal 3-column grid and renders checkout CTA when completed consultations exist', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Waiting Patient' }),
      appt({ id: 9, token_number: 9, patient_id: 77, patient_name: 'Finished Patient', consultation_status: 'COMPLETED' }),
    ]
    renderPage()

    const board = screen.getByTestId('waiting-room-board')
    expect(board).toHaveClass('lg:grid-cols-3')
    expect(screen.getByText('Ready for checkout')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Collect payment →' })).toHaveAttribute(
      'href',
      '/reception/billing?appointment_id=9&patient_id=77',
    )
  })

  it('highlights waiting duration in amber when patient has waited 30 minutes or more', () => {
    state.appointments = [
      appt({
        id: 1,
        token_number: 1,
        patient_name: 'Long Wait',
        status_updated_at: new Date(Date.now() - 35 * 60000).toISOString(),
      }),
      appt({
        id: 2,
        token_number: 2,
        patient_name: 'Short Wait',
        status_updated_at: new Date(Date.now() - 10 * 60000).toISOString(),
      }),
    ]
    renderPage()

    const longWaitCard = screen.getByText('Long Wait').closest('article')!
    const longWaitText = within(longWaitCard).getByText(/3[56] min waiting/)
    expect(longWaitText).toHaveClass('text-amber-800')

    const shortWaitCard = screen.getByText('Short Wait').closest('article')!
    const shortWaitText = within(shortWaitCard).getByText(/1[01] min waiting/)
    expect(shortWaitText).not.toHaveClass('text-amber-800')
  })

  it('never renders Call or Complete buttons anywhere on Waiting Room (OD-22-19)', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Waiting One', consultation_status: 'WAITING' }),
      appt({ id: 2, token_number: 2, patient_name: 'Cabin One', consultation_status: 'IN_CONSULTATION' }),
      appt({ id: 3, token_number: 3, patient_name: 'Done One', consultation_status: 'COMPLETED' }),
    ]
    renderPage()

    expect(screen.queryByRole('button', { name: /call patient|call next|\bcall\b/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /complete|mark completed/i })).not.toBeInTheDocument()
  })

  it('ReassignDialog stays clickable before selecting a doctor, disables submit while loading departments, and shows error alert with Retry on fetch failure', async () => {
    state.appointments = [appt({ id: 1, token_number: 1, department_id: 10, doctor_id: 1 })]
    state.doctorDepartmentsOverride = (doctorId) => {
      if (doctorId === null) {
        return { data: undefined, isSuccess: false, isPending: true, isError: false, refetch: state.doctorDepartmentsRefetch }
      }
      return { data: undefined, isSuccess: false, isPending: true, isError: false, refetch: state.doctorDepartmentsRefetch }
    }
    const { rerender } = renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    const dialog = screen.getByRole('dialog', { hidden: true })
    const submitBtn = within(dialog).getByRole('button', { name: 'Reassign & issue new token' })

    // Even though disabled TanStack Query v5 returns isPending: true when doctorId === null, submit stays enabled for validation.
    expect(submitBtn).toBeEnabled()
    await userEvent.click(submitBtn)
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose the doctor to move the patient to.')
    expect(state.reassignMutate).not.toHaveBeenCalled()

    // Selecting a doctor while its departments are loading disables submit.
    await userEvent.selectOptions(within(dialog).getByLabelText('Move to doctor'), '2')
    expect(submitBtn).toBeDisabled()

    // Transitioning to error keeps submit disabled and renders an InlineAlert + Retry calling refetch().
    state.doctorDepartmentsOverride = (doctorId) => {
      if (doctorId === null) {
        return { data: undefined, isSuccess: false, isPending: true, isError: false, refetch: state.doctorDepartmentsRefetch }
      }
      return { data: undefined, isSuccess: false, isPending: false, isError: true, refetch: state.doctorDepartmentsRefetch }
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/waiting']}>
          <SearchSpy />
          <WaitingRoom />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(submitBtn).toBeDisabled()
    const retryBtn = within(dialog).getByRole('button', { name: 'Retry' })
    expect(retryBtn.closest('[role="alert"]')).toBeInTheDocument()
    await userEvent.click(retryBtn)
    expect(state.doctorDepartmentsRefetch).toHaveBeenCalledTimes(1)
  })

  it('gates Reassign, Cancel consultation, and Collect payment / billing links on permissions', () => {
    state.appointments = [
      appt({ id: 1, token_number: 1, patient_name: 'Waiting Patient', consultation_status: 'WAITING' }),
      appt({ id: 2, token_number: 2, patient_name: 'Cabin Patient', consultation_status: 'IN_CONSULTATION' }),
      appt({ id: 3, token_number: 3, patient_name: 'Done Patient', consultation_status: 'COMPLETED', visit_id: 500 }),
    ]

    // Missing visit:write hides Reassign only
    state.permissions = ['appointment:write', 'payment:create']
    renderPage()
    expect(screen.queryByRole('button', { name: 'Reassign' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Cancel consultation' })).toHaveLength(2)
    expect(screen.getByRole('link', { name: /Collect payment/i })).toBeInTheDocument()
    cleanup()

    // Missing appointment:write hides Cancel consultation on both Waiting and In Cabin
    state.permissions = ['visit:write', 'payment:create']
    renderPage()
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel consultation' })).not.toBeInTheDocument()
    expect(screen.getByText('Position 1')).toBeInTheDocument()
    expect(screen.getByText('Consultation in progress')).toBeInTheDocument()
    cleanup()

    // Missing payment:create hides Collect payment on Completed card
    state.permissions = ['visit:write', 'appointment:write']
    renderPage()
    expect(screen.getByText('Ready for checkout')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Collect payment/i })).not.toBeInTheDocument()
    cleanup()

    // Missing payment:create also hides empty-state Open Billing & Checkout link
    state.appointments = [appt({ id: 1, token_number: 1, patient_name: 'Waiting Patient', consultation_status: 'WAITING' })]
    state.permissions = ['visit:write', 'appointment:write']
    renderPage()
    expect(screen.queryByRole('link', { name: /Open Billing & Checkout/i })).not.toBeInTheDocument()
  })

  it('distinguishes Ready for checkout, Other consultation active, Closed / settled, and loading fallback on CompletedCard', () => {
    state.visitsQuery = { data: { total: 1, visits: [{ id: 500 }] }, isSuccess: true }
    state.appointments = [
      // Visit 500: in readyVisits -> Ready for checkout
      appt({ id: 10, token_number: 1, patient_id: 101, patient_name: 'Ready Patient', visit_id: 500, consultation_status: 'COMPLETED' }),
      // Visit 501: not in readyVisits, another consultation still IN_CONSULTATION -> Other consultation active
      appt({ id: 11, token_number: 2, patient_id: 102, patient_name: 'Multi Doctor Patient', visit_id: 501, doctor_id: 1, consultation_status: 'COMPLETED' }),
      appt({ id: 12, token_number: 3, patient_id: 102, patient_name: 'Multi Doctor Patient', visit_id: 501, doctor_id: 2, doctor_name_en: 'Dr. Bharati', consultation_status: 'IN_CONSULTATION' }),
      // Visit 502: not in readyVisits, no other active consultation -> Closed / settled
      appt({ id: 13, token_number: 4, patient_id: 103, patient_name: 'Settled Patient', visit_id: 502, consultation_status: 'COMPLETED' }),
      // No visit_id -> graceful fallback to Ready for checkout
      appt({ id: 14, token_number: 5, patient_id: 104, patient_name: 'Legacy Patient', visit_id: null, consultation_status: 'COMPLETED' }),
    ]
    renderPage()

    const completedColumn = screen.getByRole('region', { name: 'Completed' })

    const readyCard = within(completedColumn).getByText('Ready Patient').closest('article')!
    expect(within(readyCard).getByText('Ready for checkout')).toBeInTheDocument()
    expect(within(readyCard).getByRole('link', { name: 'Collect payment →' })).toHaveAttribute(
      'href',
      '/reception/billing?appointment_id=10&patient_id=101',
    )

    const multiCard = within(completedColumn).getByText('Multi Doctor Patient').closest('article')!
    expect(within(multiCard).getByText('Other consultation active')).toBeInTheDocument()
    expect(within(multiCard).queryByText('Ready for checkout')).not.toBeInTheDocument()
    expect(within(multiCard).getByRole('link', { name: 'Open billing →' })).toHaveAttribute(
      'href',
      '/reception/billing?appointment_id=11&patient_id=102',
    )

    const settledCard = within(completedColumn).getByText('Settled Patient').closest('article')!
    expect(within(settledCard).getByText('Closed / settled')).toBeInTheDocument()
    expect(within(settledCard).queryByText('Ready for checkout')).not.toBeInTheDocument()
    expect(within(settledCard).getByRole('link', { name: 'View bill →' })).toHaveAttribute(
      'href',
      '/reception/billing?appointment_id=13&patient_id=103',
    )

    const legacyCard = within(completedColumn).getByText('Legacy Patient').closest('article')!
    expect(within(legacyCard).getByText('Ready for checkout')).toBeInTheDocument()
    expect(within(legacyCard).getByRole('link', { name: 'Collect payment →' })).toBeInTheDocument()
    cleanup()

    // While useVisits hasn't loaded yet, falls back gracefully to Ready for checkout / Collect payment
    state.visitsQuery = { data: undefined, isSuccess: false, isPending: true }
    state.appointments = [
      appt({ id: 13, token_number: 4, patient_id: 103, patient_name: 'Settled Patient', visit_id: 502, consultation_status: 'COMPLETED' }),
    ]
    renderPage()
    const loadingCard = screen.getByText('Settled Patient').closest('article')!
    expect(within(loadingCard).getByText('Ready for checkout')).toBeInTheDocument()
    expect(within(loadingCard).getByRole('link', { name: 'Collect payment →' })).toBeInTheDocument()
  })

  it('scopes column max height to lg:max-h-[70vh] for mobile/tablet stacked layouts', () => {
    renderPage()
    const waitingRegion = screen.getByRole('region', { name: 'Waiting' })
    expect(waitingRegion).toHaveClass('lg:max-h-[70vh]')
    expect(waitingRegion).not.toHaveClass('max-h-[70vh]')
  })
})
