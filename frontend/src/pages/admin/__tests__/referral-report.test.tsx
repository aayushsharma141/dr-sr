import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferralReportPage } from '../ReferralReportPage'
import type { ReferralReportOut } from '../../../api/reports'
import { istToday } from '../../../format'

vi.mock('../../../components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('../../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'Admin User', role: 'ADMIN' } }),
}))

const sampleReport: ReferralReportOut = {
  date_from: '2026-11-01',
  date_to: '2026-11-16',
  total_visits: 12,
  rows: [
    { source: 'DOCTOR', referrer_name: 'Dr. Sharma', visit_count: 5 },
    { source: 'SELF', referrer_name: null, visit_count: 3 },
    { source: 'PERSONAL', referrer_name: 'Mrs. Verma', visit_count: 2 },
    { source: 'ORGANIZATION', referrer_name: 'City Care Hospital', visit_count: 1 },
    { source: 'NOT_RECORDED', referrer_name: null, visit_count: 1 },
  ],
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReferralReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReferralReportPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/reports/referrals')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(sampleReport),
        }
      }
      return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'Not found' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders default date range (first day of IST month to today) and loads report', async () => {
    renderPage()

    const today = istToday()
    const firstDay = `${today.slice(0, 7)}-01`

    const fromInput = screen.getByLabelText(/from date/i) as HTMLInputElement
    const toInput = screen.getByLabelText(/to date/i) as HTMLInputElement

    expect(fromInput.value).toBe(firstDay)
    expect(toInput.value).toBe(today)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const callUrl = fetchMock.mock.calls[0][0] as string
    expect(callUrl).toContain(`date_from=${firstDay}`)
    expect(callUrl).toContain(`date_to=${today}`)
  })

  it('renders table rows with formatted sources, referrer names, and visit counts', async () => {
    renderPage()

    const table = await screen.findByRole('table', { name: /referral report/i })
    expect(within(table).getByText('Dr. Sharma')).toBeInTheDocument()
    expect(within(table).getByText('Doctor')).toBeInTheDocument()
    expect(within(table).getByText('Self')).toBeInTheDocument()
    expect(within(table).getByText('Personal')).toBeInTheDocument()
    expect(within(table).getByText('Mrs. Verma')).toBeInTheDocument()
    expect(within(table).getByText('Organisation')).toBeInTheDocument()
    expect(within(table).getByText('City Care Hospital')).toBeInTheDocument()
    expect(within(table).getByText('Not recorded')).toBeInTheDocument()

    // Visit counts
    expect(within(table).getByText('5')).toBeInTheDocument()
    expect(within(table).getByText('3')).toBeInTheDocument()
    expect(within(table).getByText('2')).toBeInTheDocument()

    // Total row
    expect(within(table).getByText('Total')).toBeInTheDocument()
    expect(within(table).getByText('12')).toBeInTheDocument()
  })

  it('renders empty state when there are no visits in the date range', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          date_from: '2026-11-01',
          date_to: '2026-11-16',
          rows: [],
          total_visits: 0,
        }),
    }))

    renderPage()

    expect(await screen.findByText('No visits in this date range.')).toBeInTheDocument()
  })

  it('renders InlineAlert with role="alert" when request fails', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ message: 'Database connection failed' }),
    }))

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent(/database connection failed/i)
  })

  it('shows validation error and blocks fetch when date_from > date_to', async () => {
    renderPage()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    fetchMock.mockClear()

    const fromInput = screen.getByLabelText(/from date/i)
    const toInput = screen.getByLabelText(/to date/i)

    // Set from to 2026-11-20 and to to 2026-11-10
    await userEvent.clear(fromInput)
    await userEvent.type(fromInput, '2026-11-20')
    await userEvent.clear(toInput)
    await userEvent.type(toInput, '2026-11-10')

    const validationAlert = await screen.findByRole('alert')
    expect(validationAlert).toHaveTextContent(/from date must not be after to date/i)

    // Should NOT have triggered a new fetch for invalid range
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filters by referral source when selected', async () => {
    renderPage()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    fetchMock.mockClear()

    const sourceSelect = screen.getByLabelText(/referral source/i)
    await userEvent.selectOptions(sourceSelect, 'DOCTOR')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const callUrl = fetchMock.mock.calls[0][0] as string
    expect(callUrl).toContain('source=DOCTOR')
  })

  it('filters by referrer text when entered', async () => {
    renderPage()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    fetchMock.mockClear()

    const referrerInput = screen.getByLabelText(/referrer/i)
    await userEvent.type(referrerInput, 'Sharma')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const lastCallUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string
    expect(lastCallUrl).toContain('referrer=Sharma')
  })
})
