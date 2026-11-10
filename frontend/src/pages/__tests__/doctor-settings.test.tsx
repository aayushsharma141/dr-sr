import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoctorSettings } from '../DoctorSettings'
import type { DoctorOut, Me } from '../../api/types'

const mockDoctorMe: Me = {
  id: 3,
  username: 'dr_anil',
  full_name: 'Dr. Anil Kumar',
  role: 'DOCTOR',
  doctor_id: 1,
  permissions: ['doctor:read', 'doctor_settings:write', 'dashboard:doctor'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const mockDoctorProfile: DoctorOut = {
  id: 1,
  name_en: 'Dr. Anil Kumar',
  name_hi: null,
  qualification: 'MBBS, MD',
  registration_number: 'BR-9988',
  cabin_code: 'A',
  default_fee_paise: 50000,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('DoctorSettings Page (K-60)', () => {
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

  it('renders current fee and cabin info', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctorMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockDoctorProfile])),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorSettings />
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'My Settings' })).toBeInTheDocument()
      expect(screen.getByText('Cabin A')).toBeInTheDocument()
      const feeInput = screen.getByLabelText(/Consultation Fee/i) as HTMLInputElement
      expect(feeInput.value).toBe('500')
    })
  })

  it('updates consultation fee successfully', async () => {
    const user = userEvent.setup()
    let patchPayload: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctorMe)),
        })
      }
      if (url.includes('/api/doctors/me/settings') && options?.method === 'PATCH') {
        patchPayload = JSON.parse(options.body as string)
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                ...mockDoctorProfile,
                default_fee_paise: 60000,
                version_id: 2,
              })
            ),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockDoctorProfile])),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorSettings />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const feeInput = await screen.findByLabelText(/Consultation Fee/i)
    await user.clear(feeInput)
    await user.type(feeInput, '600')

    const saveBtn = screen.getByRole('button', { name: /Save Settings/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByText(/updated successfully/i)).toBeInTheDocument()
    })
    expect(patchPayload).toEqual({
      default_fee_paise: 60000,
      version_id: 1,
    })
  })

  it('shows conflict banner on 409 and reloads latest fee', async () => {
    const user = userEvent.setup()
    let getCallCount = 0

    const mockFetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctorMe)),
        })
      }
      if (url.includes('/api/doctors/me/settings') && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                detail: 'Version conflict',
                code: 'version_conflict',
                message: 'Doctor profile modified by another session',
              })
            ),
        })
      }
      if (url.includes('/api/doctors')) {
        getCallCount++
        const fee = getCallCount > 1 ? 70000 : 50000
        const ver = getCallCount > 1 ? 2 : 1
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify([
                {
                  ...mockDoctorProfile,
                  default_fee_paise: fee,
                  version_id: ver,
                },
              ])
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorSettings />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const feeInput = await screen.findByLabelText(/Consultation Fee/i)
    await user.clear(feeInput)
    await user.type(feeInput, '650')

    const saveBtn = screen.getByRole('button', { name: /Save Settings/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(
        screen.getByText('Your doctor settings were modified by another session.')
      ).toBeInTheDocument()
    })

    const reloadBtn = screen.getByRole('button', { name: /Reload latest fee/i })
    await user.click(reloadBtn)

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect((screen.getByLabelText(/Consultation Fee/i) as HTMLInputElement).value).toBe('700')
    })
  })
})
