import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { DoctorQueueItem } from '../../api/types'

const alertsState: { data: DoctorQueueItem[] | undefined; refetch: () => void } = {
  data: [],
  refetch: vi.fn(),
}

vi.mock('../../api/alerts', () => ({
  useDoctorAlerts: () => ({ data: alertsState.data, refetch: alertsState.refetch }),
}))

const mutate = vi.fn()
const ackState: { isPending: boolean; variables: { id: number } | undefined } = {
  isPending: false,
  variables: undefined,
}

vi.mock('../../api/queries', () => ({
  useAcknowledgeAlert: () => ({
    mutate,
    isPending: ackState.isPending,
    variables: ackState.variables,
  }),
}))

import { EmergencyAlertBanner } from '../EmergencyAlertBanner'

function alert(overrides: Partial<DoctorQueueItem> = {}): DoctorQueueItem {
  return {
    id: 11,
    patient_id: 1,
    patient_urn: 'KH-2026-0001',
    patient_name: 'Ram Kumar',
    patient_gender: 'M',
    patient_age: 60,
    patient_mobile: '9800000000',
    patient_allergies: '',
    token_number: 4,
    status: 'ARRIVED',
    consultation_status: 'WAITING',
    status_updated_at: '2026-11-15T04:00:00Z',
    notes: null,
    priority_level: 'EMERGENCY',
    priority_reason: 'Chest pain',
    emergency_alerted_at: '2026-11-15T04:01:00Z',
    alert_acknowledged_at: null,
    check_in_at: '2026-11-15T03:50:00Z',
    version_id: 3,
    ...overrides,
  } as DoctorQueueItem
}

describe('EmergencyAlertBanner', () => {
  beforeEach(() => {
    mutate.mockReset()
    alertsState.refetch = vi.fn()
    ackState.isPending = false
    ackState.variables = undefined
  })

  afterEach(() => {
    cleanup()
    alertsState.data = []
  })

  it('renders nothing visible when there are no open alerts', () => {
    alertsState.data = []
    render(<EmergencyAlertBanner />)
    expect(screen.queryByRole('region', { name: 'Emergency alerts' })).not.toBeInTheDocument()
  })

  it('shows token, patient, reason and an Acknowledge control for each open alert', () => {
    alertsState.data = [alert()]
    render(<EmergencyAlertBanner />)

    const region = screen.getByRole('region', { name: 'Emergency alerts' })
    expect(within(region).getByText(/EMERGENCY · Token 4 · Ram Kumar/)).toBeInTheDocument()
    expect(within(region).getByText('Chest pain')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument()
  })

  it('has no dismiss control: the only exit is Acknowledge', () => {
    alertsState.data = [alert()]
    render(<EmergencyAlertBanner />)
    expect(screen.queryByRole('button', { name: /dismiss|close/i })).not.toBeInTheDocument()
  })

  it('sends the acknowledgement with the current version and never shows it as done early', async () => {
    alertsState.data = [alert({ id: 11, version_id: 3 })]
    render(<EmergencyAlertBanner />)

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual({ id: 11, body: { version_id: 3 } })
    // The row stays until the server confirms: the data is unchanged by the click itself.
    expect(screen.getByText(/EMERGENCY · Token 4/)).toBeInTheDocument()
  })

  it('shows the already-acknowledged message on 409 and refetches', async () => {
    alertsState.data = [alert({ id: 11, version_id: 3 })]
    render(<EmergencyAlertBanner />)

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))
    const options = mutate.mock.calls[0][1] as { onError: (e: unknown) => void }
    options.onError(new ApiError(409, 'alert_already_acknowledged', 'already'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This alert was already acknowledged.',
    )
    expect(alertsState.refetch).toHaveBeenCalled()
  })

  it('keeps the alert open and says so on other failures', async () => {
    alertsState.data = [alert({ id: 11, version_id: 3 })]
    render(<EmergencyAlertBanner />)

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))
    const options = mutate.mock.calls[0][1] as { onError: (e: unknown) => void }
    options.onError(new Error('network down'))

    expect(await screen.findByRole('alert')).toHaveTextContent('The alert is still open')
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument()
  })

  it('shows Recording… while the acknowledgement for that alert is pending', () => {
    alertsState.data = [alert({ id: 11 })]
    ackState.isPending = true
    ackState.variables = { id: 11 }
    render(<EmergencyAlertBanner />)

    expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled()
  })
})
