import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../../components/AppShell'
import { PrintNote } from '../../components/PrintLetterhead'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppShell name="Admin" role="ADMIN">
          <p>Page</p>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubSettings(ok: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () =>
          Promise.resolve(
            JSON.stringify(
              ok
                ? {
                    name_en: 'New Hospital',
                    trust_name_en: 'New Trust',
                    trust_name_hi: null,
                    address_1: 'Garhani Road',
                    location_line: 'Garhani, Bhojpur',
                  }
                : { code: 'server_error', message: 'down' },
            ),
          ),
      }),
    ),
  )
}

describe('application header identity', () => {
  it('comes from clinic settings', async () => {
    stubSettings(true)
    renderShell()
    expect(await screen.findByText('New Trust')).toBeInTheDocument()
    expect(screen.getByText('Garhani Road')).toBeInTheDocument()
    expect(screen.getByText('Garhani, Bhojpur')).toBeInTheDocument()
  })

  it('falls back to the standard identity when settings cannot be loaded', () => {
    stubSettings(false)
    renderShell()
    expect(screen.getByText('Sri Vashishtha Kalyan Trust')).toBeInTheDocument()
  })
})

describe('PrintNote', () => {
  it('adds nothing to the document until an administrator sets text', () => {
    render(<PrintNote en={null} hi="" testId="note" />)
    expect(screen.queryByTestId('note')).not.toBeInTheDocument()
  })

  it('prints the text with the Hindi line marked as Hindi', () => {
    render(<PrintNote en="Trust registered" hi="पंजीकृत" testId="note" />)
    expect(screen.getByText('Trust registered')).toBeInTheDocument()
    expect(screen.getByText('पंजीकृत')).toHaveAttribute('lang', 'hi')
  })
})
