import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LANStatusPill } from '../LANStatusPill'
import * as queries from '../../api/queries'

describe('LANStatusPill Component', () => {
  it('renders Online status when server is reachable and healthy', () => {
    vi.spyOn(queries, 'useHealth').mockReturnValue({
      data: { status: 'ok', db: 'ok', setup_required: false },
      isError: false,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof queries.useHealth>)

    render(<LANStatusPill />)

    expect(screen.getByRole('status', { name: /LAN status: Connected/i })).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('renders Disconnected status when server is unreachable', async () => {
    const mockRefetch = vi.fn()
    vi.spyOn(queries, 'useHealth').mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      isFetching: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof queries.useHealth>)

    const user = userEvent.setup()
    render(<LANStatusPill />)

    const pill = screen.getByRole('status', { name: /LAN status: Disconnected/i })
    expect(pill).toBeInTheDocument()
    expect(screen.getByText('Disconnected')).toBeInTheDocument()

    // Clicking retry calls refetch
    await user.click(pill)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('renders Checking state while initial health probe is loading', () => {
    vi.spyOn(queries, 'useHealth').mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
      isFetching: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof queries.useHealth>)

    render(<LANStatusPill />)

    expect(screen.getByRole('status', { name: /Checking local LAN/i })).toBeInTheDocument()
    expect(screen.getByText('Checking...')).toBeInTheDocument()
  })
})
