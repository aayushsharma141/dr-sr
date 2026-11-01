import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings } from '../Settings'
import type { ClinicSettingsOut, Me } from '../../api/types'

const mockMe: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Kalyan Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: ['settings:read', 'settings:write'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const mockSettings: ClinicSettingsOut = {
  id: 1,
  name_en: 'Kalyan Hospital',
  name_hi: 'कल्याण अस्पताल',
  address_1: 'Station Road, Ara, Bhojpur',
  address_2: 'Near Railway Station',
  phone: '06182234567',
  email: 'info@kalyanhospital.org',
  receipt_sequence_cycle: 'FINANCIAL_YEAR',
  print_header_en: 'Kalyan Hospital Trust',
  print_header_hi: 'कल्याण अस्पताल ट्रस्ट',
  print_footer_en: 'Get well soon',
  print_footer_hi: 'शीघ्र स्वास्थ्य लाभ की कामना',
  consultation_validity_days: 15,
  version_id: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('Clinic Settings Page', () => {
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

  it('loads and displays current clinic settings', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/settings')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockSettings)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/Clinic Name \(English\)/i)).toHaveValue('Kalyan Hospital')
    })

    expect(screen.getByLabelText(/Clinic Name \(Hindi\)/i)).toHaveValue('कल्याण अस्पताल')
    expect(screen.getByLabelText(/Primary Address/i)).toHaveValue('Station Road, Ara, Bhojpur')
    expect(screen.getByLabelText(/phone/i)).toHaveValue('06182234567')
    expect(screen.getByLabelText(/Consultation Validity/i)).toHaveValue(15)
  })

  it('updates settings and displays success banner', async () => {
    let patchedData: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/settings')) {
        if (init?.method === 'PATCH') {
          patchedData = JSON.parse(init.body as string)
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  ...mockSettings,
                  ...(patchedData as Record<string, unknown>),
                  version_id: 2,
                }),
              ),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockSettings)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/Clinic Name \(English\)/i)).toHaveValue('Kalyan Hospital')
    })

    const phoneInput = screen.getByLabelText(/phone/i)
    await user.clear(phoneInput)
    await user.type(phoneInput, '06182999999')

    const saveButton = screen.getByRole('button', { name: /save settings/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/Settings saved successfully/i)).toBeInTheDocument()
    })
    expect((patchedData as any)?.phone).toBe('06182999999')
  })

  it('handles 409 version_conflict and reloads latest data', async () => {
    let settingsCallCount = 0

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/settings')) {
        if (init?.method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  code: 'version_conflict',
                  message: 'Record was modified by another user.',
                }),
              ),
          })
        }
        settingsCallCount++
        const serverVersion = settingsCallCount > 1 ? 2 : 1
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                ...mockSettings,
                name_en: serverVersion === 2 ? 'Kalyan Hospital & Research' : 'Kalyan Hospital',
                version_id: serverVersion,
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/Clinic Name \(English\)/i)).toHaveValue('Kalyan Hospital')
    })

    const saveButton = screen.getByRole('button', { name: /save settings/i })
    await user.click(saveButton)

    // ConflictBanner should appear
    await waitFor(() => {
      expect(screen.getByText('Record was modified by another user')).toBeInTheDocument()
    })

    const reloadButton = screen.getByRole('button', { name: /reload latest/i })
    await user.click(reloadButton)

    // ConflictBanner should clear and new value should appear
    await waitFor(() => {
      expect(screen.queryByText('Record was modified by another user')).not.toBeInTheDocument()
      expect(screen.getByLabelText(/Clinic Name \(English\)/i)).toHaveValue('Kalyan Hospital & Research')
    })
  })
})
