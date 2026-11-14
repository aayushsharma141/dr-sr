import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { GlobalSearchBar } from '../GlobalSearchBar'
import type { PatientOut } from '../../api/types'

const mockPatients: PatientOut[] = [
  {
    id: 101,
    urn: 'KH-2026-0001',
    full_name: 'Rahul Sharma',
    guardian_name: 'Anand Sharma',
    gender: 'M',
    dob: '1992-04-10',
    age_years: 34,
    mobile: '9876543210',
    address: 'Ara, Bihar',
    district: 'Bhojpur',
    state: 'Bihar',
    emergency_contact: '9876500000',
    allergies: 'Penicillin (RED)',
    notes: 'Fever 3 days',
    photo_path: null,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
]

describe('GlobalSearchBar across all tabs', () => {
  beforeEach(() => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatients)),
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

  it('renders top search bar with shortcut key indicator', () => {
    render(
      <MemoryRouter>
        <GlobalSearchBar role="DOCTOR" />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(/Search URN, name or mobile.../)
    expect(input).toBeInTheDocument()
    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('queries patients when search term is typed and shows dropdown results', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <GlobalSearchBar role="DOCTOR" />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(/Search URN, name or mobile.../)
    await user.type(input, 'Rahul')

    await waitFor(() => {
      expect(screen.getByText('Rahul Sharma')).toBeInTheDocument()
    })

    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    expect(screen.getByText(/34 yrs/)).toBeInTheDocument()
    expect(screen.getByText(/Penicillin/)).toBeInTheDocument()
    expect(screen.getByText('Consult')).toBeInTheDocument()
  })
})
