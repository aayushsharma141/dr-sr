import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { AuditViewerPage } from '../admin/AuditViewerPage'

const sampleAuditLogs = {
  items: [
    {
      id: 101,
      occurred_at: '2026-11-02T10:00:00Z',
      actor_user_id: '1',
      actor_username: 'admin',
      actor_role: 'ADMIN',
      action: 'USER_CREATED',
      outcome: 'SUCCESS',
      entity_type: 'user',
      entity_id: '5',
      before_data: null,
      after_data: { username: 'nurse_joy' },
      reason: null,
      request_id: 'req-101',
      ip: '127.0.0.1',
      user_agent: 'Vitest Agent',
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  pages: 1,
}

vi.mock('../../api/queries', () => ({
  useMe: () => ({ data: { name: 'Admin', role: 'ADMIN' }, isPending: false, isError: false }),
  useAuditActions: () => ({ data: ['USER_CREATED'], isPending: false, isError: false }),
  useAuditLogs: () => ({
    data: sampleAuditLogs,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLogout: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

describe('AuditViewerPage', () => {
  const queryClient = new QueryClient()

  it('renders audit logs list with actor and action', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuditViewerPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Audit Trail' })).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getAllByText('USER_CREATED').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SUCCESS').length).toBeGreaterThan(0)
  })

  it('expands payload inspection on button click', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuditViewerPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const inspectBtn = screen.getByText('Inspect')
    fireEvent.click(inspectBtn)

    expect(screen.getByText(/Audit Entry #101/)).toBeInTheDocument()
    expect(screen.getAllByText(/nurse_joy/).length).toBeGreaterThan(0)
  })
})
