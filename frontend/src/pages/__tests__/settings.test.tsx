import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  trust_name_en: 'Sri Vashishtha Kalyan Trust',
  trust_name_hi: null,
  location_line: 'Ara, Bhojpur, Bihar',
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

    // Save is only enabled once something has changed.
    const saveButton = screen.getByRole('button', { name: /save settings/i })
    expect(saveButton).toBeDisabled()
    await user.type(screen.getByLabelText(/Clinic Name \(English\)/i), ' Trust')
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

  // ---------------------------------------------------------------- helpers for the tests below

  type Responder = (init?: RequestInit) => { status: number; body: unknown }

  function jsonResponse(status: number, body: unknown) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 409 ? 'Conflict' : status === 422 ? 'Unprocessable Entity' : 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }

  function stubFetch(onPatch: Responder, settings: ClinicSettingsOut = mockSettings) {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) return jsonResponse(200, mockMe)
      if (url.includes('/api/settings')) {
        if (init?.method === 'PATCH') {
          const r = onPatch(init)
          return jsonResponse(r.status, r.body)
        }
        return jsonResponse(200, settings)
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function renderPage() {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  async function waitForLoaded() {
    await waitFor(() => {
      expect(screen.getByLabelText(/Clinic Name \(English\)/i)).toHaveValue('Kalyan Hospital')
    })
  }

  it('groups the form into titled sections with the print-usage note', async () => {
    stubFetch(() => ({ status: 200, body: mockSettings }))
    renderPage()
    await waitForLoaded()

    for (const title of [
      'Hospital identity',
      'Contact & addresses',
      'Billing — receipt numbering',
      'Printing — header & footer',
      'Consultation',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }
    expect(screen.getByRole('region', { name: 'Hospital identity' })).toContainElement(
      screen.getByLabelText(/Clinic Name \(Hindi\)/i),
    )
    expect(screen.getByLabelText(/Clinic Name \(Hindi\)/i)).toHaveAttribute('lang', 'hi')
    expect(screen.getByLabelText(/Print Footer \(Hindi\)/i)).toHaveAttribute('lang', 'hi')
    expect(screen.getByText(/Print header \(English and Hindi\): prescriptions, registration cards and receipts/i)).toBeInTheDocument()
  })

  it('describes receipt cycles by period with the real RCP number format', async () => {
    stubFetch(() => ({ status: 200, body: mockSettings }))
    renderPage()
    await waitForLoaded()

    const select = screen.getByLabelText(/Receipt Sequence Cycle/i)
    const options = within(select).getAllByRole('option')
    expect(options[0]).toHaveTextContent(/^Financial year \(April–March\), e\.g\. RCP-\d{4}-\d{4}-0001$/)
    expect(options[1]).toHaveTextContent(/^Calendar year \(January–December\), e\.g\. RCP-\d{4}-0001$/)
    expect(document.body.textContent).not.toMatch(/RCPT-/)

    // The financial-year key is two consecutive years, as the backend produces.
    const m = options[0].textContent?.match(/RCP-(\d{4})-(\d{4})-0001/)
    expect(m).not.toBeNull()
    expect(Number(m?.[2])).toBe(Number(m?.[1]) + 1)
  })

  it('Cancel resets the form to the server values', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: mockSettings }))
    const user = userEvent.setup()
    renderPage()
    await waitForLoaded()

    const cancel = screen.getByRole('button', { name: /^cancel$/i })
    expect(cancel).toBeDisabled()

    const phone = screen.getByLabelText(/phone/i)
    await user.clear(phone)
    await user.type(phone, '999')
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument()
    expect(cancel).toBeEnabled()

    await user.click(cancel)
    expect(phone).toHaveValue('06182234567')
    expect(screen.getByText('No unsaved changes.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false)
  })

  it('shows field-level messages from a 422 validation_error', async () => {
    stubFetch(() => ({
      status: 422,
      body: {
        code: 'validation_error',
        message: 'The submitted data failed validation.',
        fields: [
          { loc: ['body', 'phone'], message: 'Value error, Phone number must contain digits' },
          { loc: ['body', 'email'], message: 'Value error, Enter a valid email address, e.g. info@example.org' },
        ],
      },
    }))
    const user = userEvent.setup()
    renderPage()
    await waitForLoaded()

    const phone = screen.getByLabelText(/phone/i)
    await user.clear(phone)
    await user.type(phone, '-----')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(screen.getByText('Phone number must contain digits')).toBeInTheDocument()
    })
    expect(phone).toHaveAttribute('aria-invalid', 'true')
    expect(phone.getAttribute('aria-describedby')).toContain('settings-phone-error')
    expect(screen.getByLabelText(/^Email/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a valid email address, e.g. info@example.org')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Correct the 2 fields marked below/i)
  })

  it('confirms a receipt cycle change with a reason and resubmits with confirm_receipt_cycle_change', async () => {
    const patchBodies: Record<string, unknown>[] = []
    stubFetch((init) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      patchBodies.push(body)
      if (!body.confirm_receipt_cycle_change) {
        return {
          status: 409,
          body: {
            code: 'receipt_cycle_change_requires_confirmation',
            message: '12 receipt(s) have already been issued in the current FINANCIAL_YEAR cycle.',
            current_cycle: 'FINANCIAL_YEAR',
            current_cycle_key: '2026-2027',
            requested_cycle: 'CALENDAR_YEAR',
            receipts_issued: 12,
          },
        }
      }
      return { status: 200, body: { ...mockSettings, receipt_sequence_cycle: 'CALENDAR_YEAR', version_id: 2 } }
    })
    const user = userEvent.setup()
    renderPage()
    await waitForLoaded()

    await user.selectOptions(screen.getByLabelText(/Receipt Sequence Cycle/i), 'CALENDAR_YEAR')
    expect(screen.getByText(/You are changing the receipt numbering cycle/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(screen.getByText('Change the receipt numbering cycle?')).toBeInTheDocument()
    })
    const dialog = screen.getByText('Change the receipt numbering cycle?').closest('dialog') as HTMLElement
    expect(dialog).toHaveAttribute('data-variant', 'destructive')
    expect(within(dialog).getByText('12')).toBeInTheDocument()
    expect(within(dialog).getByText('2026-2027')).toBeInTheDocument()
    expect(within(dialog).getByText(/numbering continues under a new cycle key/i)).toBeInTheDocument()

    const confirm = within(dialog).getByRole('button', { name: /change cycle and save/i })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Reason for the change/i), 'Auditor asked for calendar-year numbering')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => {
      expect(screen.getByText(/Clinic settings saved successfully/i)).toBeInTheDocument()
    })
    expect(patchBodies).toHaveLength(2)
    expect(patchBodies[0].confirm_receipt_cycle_change).toBeUndefined()
    expect(patchBodies[1]).toMatchObject({
      receipt_sequence_cycle: 'CALENDAR_YEAR',
      confirm_receipt_cycle_change: true,
      change_reason: 'Auditor asked for calendar-year numbering',
      version_id: 1,
    })
    expect(screen.queryByText('Change the receipt numbering cycle?')).not.toBeInTheDocument()
  })

  it('keeps the current cycle when the confirmation is declined', async () => {
    const patchBodies: unknown[] = []
    stubFetch((init) => {
      patchBodies.push(JSON.parse(init?.body as string))
      return {
        status: 409,
        body: {
          code: 'receipt_cycle_change_requires_confirmation',
          message: 'Confirmation required.',
          current_cycle: 'FINANCIAL_YEAR',
          current_cycle_key: '2026-2027',
          requested_cycle: 'CALENDAR_YEAR',
          receipts_issued: 1,
        },
      }
    })
    const user = userEvent.setup()
    renderPage()
    await waitForLoaded()

    await user.selectOptions(screen.getByLabelText(/Receipt Sequence Cycle/i), 'CALENDAR_YEAR')
    await user.click(screen.getByRole('button', { name: /save settings/i }))
    await waitFor(() => {
      expect(screen.getByText('Change the receipt numbering cycle?')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /keep current cycle/i }))

    expect(screen.queryByText('Change the receipt numbering cycle?')).not.toBeInTheDocument()
    expect(patchBodies).toHaveLength(1)
    // The edit is kept (still unsaved) so the admin can cancel it or try again.
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument()
    expect(screen.queryByText('Record was modified by another user')).not.toBeInTheDocument()
  })
})
