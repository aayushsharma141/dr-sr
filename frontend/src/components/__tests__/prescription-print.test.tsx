import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionPrint } from '../PrescriptionPrint'
import type { PrescriptionOut } from '../../api/types'

const prescription: PrescriptionOut = {
  id: 1,
  patient_id: 1,
  patient_urn: 'KH-2026-0004',
  patient_name: 'Anita Singh',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  encounter_id: null,
  diagnosis: 'Frozen shoulder',
  dietary_advice: null,
  general_advice: 'Hot fomentation',
  follow_up_date: '2026-11-10',
  version_id: 1,
  created_at: '2026-10-27T14:00:00Z',
  updated_at: '2026-10-27T14:00:00Z',
  items: [
    {
      id: 1,
      item_order: 1,
      medicine_name: 'Tab Aceclofenac',
      dosage: '100 mg',
      frequency: 'Twice daily',
      duration_days: 5,
      instructions: 'After meals',
    },
  ],
} as PrescriptionOut

function renderSlip() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div id="app-root">
        <PrescriptionPrint prescription={prescription} />
      </div>
    </QueryClientProvider>,
  )
}

describe('PrescriptionPrint', () => {
  it('uses the approved letterhead with the patient strip filled in', () => {
    renderSlip()

    expect(screen.getByTestId('letterhead-banner')).toHaveTextContent(/kalyan hospital/i)
    expect(screen.getByText('Dr. Chandan Kr. Dwivedi')).toBeInTheDocument()
    expect(screen.getByText('Anita Singh')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0004')).toBeInTheDocument()
    expect(screen.getByTestId('letterhead-footer')).toBeInTheDocument()
    expect(screen.getByText('Tab Aceclofenac')).toBeInTheDocument()
  })

  it('renders on <body> as a print portal so printing can hide the app behind it', () => {
    const { container } = renderSlip()

    const sheet = screen.getByTestId('prescription-sheet')
    expect(container.contains(sheet)).toBe(false) // not inside the app tree
    expect(document.body.contains(sheet)).toBe(true)
    expect(sheet.closest('.print-portal')).not.toBeNull()
  })
})
