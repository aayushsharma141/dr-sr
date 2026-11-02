import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PatientTimeline } from '../PatientTimeline'
import type { TimelineItemOut } from '../../api/types'

const sampleTimeline: TimelineItemOut[] = [
  {
    id: 'PAYMENT-1',
    event_type: 'PAYMENT',
    event_date: '2026-03-03T10:00:00Z',
    title: 'Payment Received: ₹1,500.00',
    subtitle: 'Receipt: RCP-2026-0005 · Method: UPI',
    summary: 'Collected by @reception',
    badge: 'PAID',
    badge_variant: 'default',
    metadata: { payment_id: 1 },
  },
  {
    id: 'TREATMENT_SESSION-1',
    event_type: 'TREATMENT_SESSION',
    event_date: '2026-03-02T11:00:00Z',
    title: 'Session #1: Lumbar Spine Rehab',
    subtitle: 'Dr. Dwivedi',
    summary: 'Doctor: Dr. Dwivedi | Modalities: Traction | VAS: 5/10',
    badge: 'COMPLETED',
    badge_variant: 'default',
    metadata: { session_id: 1 },
  },
  {
    id: 'APPOINTMENT-1',
    event_type: 'APPOINTMENT',
    event_date: '2026-03-01T09:30:00Z',
    title: 'Token #1: Appointment with Dr. Dwivedi',
    subtitle: 'Status: DONE',
    summary: 'Initial consultation',
    badge: 'DONE',
    badge_variant: 'outline',
    metadata: { appointment_id: 1 },
  },
]

vi.mock('../../api/queries', () => ({
  usePatientTimeline: () => ({
    data: sampleTimeline,
    isLoading: false,
    error: null,
  }),
}))

describe('PatientTimeline', () => {
  const queryClient = new QueryClient()

  it('renders all events in descending chronological order with icons and metadata', () => {
    const onViewReceipt = vi.fn()

    render(
      <QueryClientProvider client={queryClient}>
        <PatientTimeline patientId={101} onViewReceipt={onViewReceipt} />
      </QueryClientProvider>
    )

    expect(screen.getByText('Unified Chronological History')).toBeInTheDocument()
    expect(screen.getByText('3 interaction(s) recorded')).toBeInTheDocument()

    expect(screen.getByText('Payment Received: ₹1,500.00')).toBeInTheDocument()
    expect(screen.getByText('Session #1: Lumbar Spine Rehab')).toBeInTheDocument()
    expect(screen.getByText('Token #1: Appointment with Dr. Dwivedi')).toBeInTheDocument()

    // Receipt action link
    expect(screen.getByRole('button', { name: /View \/ Print Receipt Slip/i })).toBeInTheDocument()
  })
})

