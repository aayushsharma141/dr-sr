import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RolesMatrixPage } from '../admin/RolesMatrixPage'
import type { Me, RolePermissionsOut } from '../../api/types'

const mockMe: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Kalyan Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: ['user:read'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const catalogue: RolePermissionsOut = {
  roles: [
    { role: 'ADMIN', label: 'Administrator' },
    { role: 'RECEPTION', label: 'Reception' },
    { role: 'DOCTOR', label: 'Doctor' },
  ],
  permissions: [
    { key: 'user:read', group: 'Users', label: 'View user accounts' },
    { key: 'user:create', group: 'Users', label: 'Create user accounts' },
    { key: 'patient:read', group: 'Patients', label: 'View patients' },
    { key: 'encounter:write', group: 'Clinical', label: 'Write clinical encounters' },
  ],
  grants: {
    ADMIN: ['user:create', 'user:read'],
    RECEPTION: ['patient:read'],
    DOCTOR: ['encounter:write', 'patient:read'],
  },
}

function json(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RolesMatrixPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Roles & permissions matrix (admin module 02)', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the fixed-catalogue heading and explains that roles are fixed and per-user permissions are unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return json(mockMe)
        if (url.includes('/api/roles/permissions')) return json(catalogue)
        return Promise.reject(new Error(`Unhandled: ${url}`))
      }),
    )
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Role permissions (fixed catalogue)' })).toBeInTheDocument()
    expect(screen.getByText(/fixed by the approved scope/i)).toBeInTheDocument()
    expect(screen.getByText(/Per-user permissions are not available/i)).toBeInTheDocument()
    await screen.findByRole('table')
  })

  it('renders grouped permission rows and role columns with accessible allowed / not allowed text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return json(mockMe)
        if (url.includes('/api/roles/permissions')) return json(catalogue)
        return Promise.reject(new Error(`Unhandled: ${url}`))
      }),
    )
    renderPage()

    const table = await screen.findByRole('table')
    const head = table.querySelector('thead') as HTMLElement
    const headers = within(head).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Permission', 'Administrator', 'Reception', 'Doctor'])

    // Group headings, in API order.
    expect(within(table).getByRole('columnheader', { name: 'Users' })).toBeInTheDocument()
    expect(within(table).getByText('Patients')).toBeInTheDocument()
    expect(within(table).getByText('Clinical')).toBeInTheDocument()

    const row = within(table).getByRole('row', { name: /View patients/ })
    expect(within(row).getByText('Administrator: not allowed')).toBeInTheDocument()
    expect(within(row).getByText('Reception: allowed')).toBeInTheDocument()
    expect(within(row).getByText('Doctor: allowed')).toBeInTheDocument()

    // Per-role totals are counted from the API grants.
    const adminCard = screen.getAllByText('Administrator').find((el) => el.tagName === 'DT')
    expect(adminCard?.closest('div')).toHaveTextContent('2 of 4 permissions')

    // Read only: nothing to edit.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(table).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows a persistent error when the catalogue cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return json(mockMe)
        if (url.includes('/api/roles/permissions')) return json({ code: 'forbidden', message: 'Not allowed' }, 403)
        return Promise.reject(new Error(`Unhandled: ${url}`))
      }),
    )
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the role permission catalogue: Not allowed')
  })
})
