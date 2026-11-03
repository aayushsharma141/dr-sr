import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClinicalEncounterWorkspace } from '../ClinicalEncounterWorkspace'
import { PrescriptionWorkspace } from '../PrescriptionWorkspace'
import { hasReportedAllergies } from '../../components/UnsavedChangesGuard'
import type { EncounterRead, Me, PatientOut, PrescriptionOut } from '../../api/types'

const doctor: Me = {
  id: 3,
  username: 'doctor',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'csrf',
  must_change_password: false,
  permissions: [],
  version_id: 1,
}

const patient: PatientOut = {
  id: 101,
  urn: 'KH-2026-0001',
  full_name: 'Aarav Kumar',
  guardian_name: 'Suresh Kumar',
  gender: 'M',
  dob: '1995-05-15',
  age_years: 30,
  mobile: '9876543210',
  address: 'Station Road, Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: null,
  allergies: 'Penicillin allergy',
  notes: null,
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const encounter = {
  id: 50,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  appointment_id: 10,
  encounter_date: '2026-11-01T10:15:00Z',
  symptoms: 'Right shoulder pain',
  clinical_notes: 'Neer positive',
  diagnosis: 'Rotator cuff tendinopathy',
  is_finalised: false,
  finalised_at: null,
  version_id: 1,
  addenda: [],
  created_at: '2026-11-01T10:15:00Z',
  updated_at: '2026-11-01T10:15:00Z',
} as unknown as EncounterRead

const issuedRx = {
  id: 50,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  encounter_id: null,
  diagnosis: 'Acute cervical strain',
  dietary_advice: null,
  general_advice: null,
  follow_up_date: null,
  version_id: 1,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  items: [],
} as unknown as PrescriptionOut

function json(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

type Handler = (url: string, init?: RequestInit) => Promise<unknown> | undefined

function stubApi(extra: Handler) {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    const custom = extra(url, init)
    if (custom) return custom
    if (url.includes('/api/auth/me')) return json(doctor)
    if (url.includes('/api/patients/101/encounters')) return json([])
    if (url.includes('/api/patients/101/prescriptions')) return json([])
    if (url.includes('/api/patients/101')) return json(patient)
    if (url.includes('/api/settings/clinic')) return json({ clinic_name_en: 'Kalyan Hospital' })
    return Promise.reject(new Error(`Unhandled: ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

describe('clinical safety regressions', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    vi.spyOn(window, 'print').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderEncounter() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/encounters/50']}>
          <Routes>
            <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  function renderRx() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/prescriptions/new?patient_id=101']}>
          <Routes>
            <Route path="/doctor/prescriptions/new" element={<PrescriptionWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('saves edited draft text before finalising so no edit is silently locked out', async () => {
    const calls = stubApi((url, init) => {
      if (url.endsWith('/api/encounters/50') && init?.method === 'PATCH') {
        return json({ ...encounter, diagnosis: 'Edited diagnosis', version_id: 2 })
      }
      if (url.includes('/api/encounters/50/finalise')) {
        return json({
          ...encounter,
          diagnosis: 'Edited diagnosis',
          is_finalised: true,
          finalised_at: '2026-11-01T11:00:00Z',
          version_id: 3,
        })
      }
      if (url.includes('/api/encounters/50')) return json(encounter)
      return undefined
    })
    const user = userEvent.setup()
    renderEncounter()

    const diagnosis = await screen.findByDisplayValue('Rotator cuff tendinopathy')
    await user.clear(diagnosis)
    await user.type(diagnosis, 'Edited diagnosis')
    await user.click(screen.getByRole('button', { name: /finalise consultation/i }))
    await user.click(screen.getByRole('button', { name: /yes, lock & finalise/i }))

    await waitFor(() => expect(screen.getByText(/Finalised & Locked/)).toBeInTheDocument())
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`)
    expect(writes).toEqual(['PATCH /api/encounters/50', 'POST /api/encounters/50/finalise'])
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      diagnosis: 'Edited diagnosis',
      version_id: 1,
    })
  })

  it('refuses to finalise with a blank required field and does not claim another user edited the record', async () => {
    const calls = stubApi((url) => (url.includes('/api/encounters/50') ? json(encounter) : undefined))
    const user = userEvent.setup()
    renderEncounter()

    const diagnosis = await screen.findByDisplayValue('Rotator cuff tendinopathy')
    await user.clear(diagnosis)
    await user.click(screen.getByRole('button', { name: /finalise consultation/i }))

    expect(
      await screen.findByText(/please fill out symptoms, clinical notes, and diagnosis/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/modified by another user/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Finalise Consultation?')).not.toBeInTheDocument()
    expect(calls.some((c) => c.method !== 'GET')).toBe(false)
  })

  it('shows the reload banner only for a genuine 409 conflict', async () => {
    stubApi((url, init) => {
      if (url.endsWith('/api/encounters/50') && init?.method === 'PATCH') {
        return json({ code: 'conflict', message: 'Version mismatch' }, 409)
      }
      if (url.includes('/api/encounters/50')) return json(encounter)
      return undefined
    })
    const user = userEvent.setup()
    renderEncounter()

    const diagnosis = await screen.findByDisplayValue('Rotator cuff tendinopathy')
    await user.type(diagnosis, ' updated')
    await user.click(screen.getByRole('button', { name: /save draft notes/i }))

    expect(await screen.findByText(/modified by another user/i)).toBeInTheDocument()
  })

  it('shows the patient allergy warning on the prescription screen', async () => {
    stubApi(() => undefined)
    renderRx()

    const alert = await screen.findByText(/reported allergies/i)
    expect(alert.closest('[role="alert"]')).toHaveTextContent('Penicillin allergy')
  })

  it('clears the prescription form after issuing so a second click cannot duplicate it', async () => {
    const calls = stubApi((url, init) =>
      url.endsWith('/api/prescriptions') && init?.method === 'POST' ? json(issuedRx, 201) : undefined,
    )
    const user = userEvent.setup()
    renderRx()

    await screen.findByText(/reported allergies/i)
    await user.type(screen.getByLabelText(/^diagnosis/i), 'Acute cervical strain')
    await user.type(screen.getByLabelText(/medicine name, item 1/i), 'Tab Aceclofenac')
    await user.type(screen.getByLabelText(/dosage, item 1/i), '100 mg')
    await user.click(screen.getByRole('button', { name: /issue prescription/i }))

    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1))
    await waitFor(() => expect(screen.getByLabelText(/^diagnosis/i)).toHaveValue(''))
    expect(screen.getByLabelText(/medicine name, item 1/i)).toHaveValue('')
  })

  it('treats only the default text as "no allergy"', () => {
    expect(hasReportedAllergies('None reported')).toBe(false)
    expect(hasReportedAllergies('  none reported ')).toBe(false)
    expect(hasReportedAllergies('')).toBe(false)
    expect(hasReportedAllergies(null)).toBe(false)
    expect(hasReportedAllergies('Sulfa drugs')).toBe(true)
    expect(hasReportedAllergies('NKDA')).toBe(true)
  })
})
