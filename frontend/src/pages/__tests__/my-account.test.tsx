import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MyAccount } from '../MyAccount'
import type { ActiveSessionOut, DoctorOut, Me } from '../../api/types'

const mockMeDoctor: Me = {
  id: 3,
  username: 'dr.rane',
  full_name: 'Dr Vikram Rane',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: [
    'patient.read',
    'appointment.read',
    'clinical.read',
    'clinical.write',
    'clinical.finalize',
    'package.read',
    'session.read',
    'session.write',
    'billing.read',
  ],
  version_id: 1,
}

const mockDoctors: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr Vikram Rane',
    name_hi: 'डॉ विक्रम राणे',
    qualification: 'MPT (Orthopaedics)',
    registration_number: 'MH-PT-20413',
    cabin_code: 'Room 104',
    default_fee_paise: 50000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const mockSessions: ActiveSessionOut[] = [
  {
    id: 10,
    user_id: 3,
    username: 'dr.rane',
    full_name: 'Dr Vikram Rane',
    role: 'DOCTOR',
    ip_address: '10.12.0.82',
    user_agent: 'Chrome on Windows 11',
    created_at: '2026-11-14T10:00:00Z',
    last_seen_at: '2026-11-14T10:30:00Z',
    idle_expires_at: '2026-11-14T11:00:00Z',
    absolute_expires_at: '2026-11-14T22:00:00Z',
    is_current: true,
  },
]

describe('MyAccount Page', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    queryClient.setQueryData(['me'], mockMeDoctor)
    queryClient.setQueryData(['doctors', { activeOnly: false }], mockDoctors)
    queryClient.setQueryData(['sessions', { userId: 3 }], mockSessions)

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockSessions)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders user profile, change password form, signed-in computers, and permissions', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MyAccount />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Heading
    expect(screen.getByRole('heading', { name: /my account/i, level: 1 })).toBeInTheDocument()
    expect(
      screen.getByText('Your sign-in details and the computers currently signed in as you.')
    ).toBeInTheDocument()

    // Profile card
    expect(screen.getAllByText(/Dr Vikram Rane/).length).toBeGreaterThanOrEqual(1)
    expect((await screen.findAllByText(/MPT \(Orthopaedics\)/)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/MH-PT-20413/)).toBeInTheDocument()
    expect(screen.getByText(/Room 104/)).toBeInTheDocument()

    // Change password form
    expect(screen.getByLabelText(/Current password/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^New password/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Repeat new password/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument()

    // Signed in computers
    expect(screen.getByText('Signed-in computers')).toBeInTheDocument()
    expect(screen.getByText('Sign out others')).toBeInTheDocument()
    expect(screen.getByText('This computer')).toBeInTheDocument()

    // Permissions
    expect(screen.getByText('What you may do')).toBeInTheDocument()
    expect(screen.getByText('patient.read')).toBeInTheDocument()
    expect(screen.getByText('clinical.write')).toBeInTheDocument()

    // Security notes
    expect(screen.getByText('Security notes')).toBeInTheDocument()
  })

  it('asks in an in-app dialog before signing out other computers, and cancelling sends nothing', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MyAccount />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Sign out others' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/This computer stays signed in/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Keep them signed in' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })
})
