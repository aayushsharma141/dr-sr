import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { DoctorQueueItem, DoctorQueueResponse } from '../../api/types'

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

describe('useDoctorAlerts shared queue cache (A4 #11-FE)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shares the ["doctor-queue"] cache key and derives sorted open emergencies via select', async () => {
    const { useDoctorAlerts } = await vi.importActual<typeof import('../../api/alerts')>(
      '../../api/alerts',
    )

    const queueResponse: DoctorQueueResponse = {
      doctor_id: 1,
      doctor_name: 'Dr Vikram Rane',
      queue_date: '2026-11-15',
      in_consultation: [
        alert({
          id: 20,
          patient_name: 'Later Emergency',
          emergency_alerted_at: '2026-11-15T04:05:00Z',
          alert_acknowledged_at: null,
        }),
      ],
      waiting: [
        alert({
          id: 19,
          patient_name: 'Earlier Emergency',
          emergency_alerted_at: '2026-11-15T04:01:00Z',
          alert_acknowledged_at: null,
        }),
        alert({
          id: 21,
          patient_name: 'Acked Emergency',
          emergency_alerted_at: '2026-11-15T04:00:00Z',
          alert_acknowledged_at: '2026-11-15T04:02:00Z',
        }),
        alert({
          id: 22,
          patient_name: 'Normal Waiter',
          priority_level: 'NORMAL',
          emergency_alerted_at: null,
          alert_acknowledged_at: null,
        }),
      ],
      booked: [],
      completed: [],
      total_active: 4,
    }

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(queueResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

    function Probe() {
      const { data = [] } = useDoctorAlerts(true)
      return (
        <ul data-testid="derived-alerts">
          {data.map((item) => (
            <li key={item.id}>{item.patient_name}</li>
          ))}
        </ul>
      )
    }

    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Earlier Emergency')).toBeInTheDocument()
    const items = within(screen.getByTestId('derived-alerts')).getAllByRole('listitem')
    expect(items.map((el) => el.textContent)).toEqual(['Earlier Emergency', 'Later Emergency'])

    // Verify raw DoctorQueueResponse is cached under the shared ['doctor-queue'] key
    expect(qc.getQueryData(['doctor-queue'])).toEqual(queueResponse)
    expect(qc.getQueryData(['doctor-alerts'])).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
