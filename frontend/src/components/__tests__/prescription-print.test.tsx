import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../test/dialog-shim'
import { PrescriptionPrint } from '../PrescriptionPrint'
import type { DoctorOut, PrescriptionOut } from '../../api/types'

const prescription: PrescriptionOut = {
  id: 1,
  patient_id: 1,
  patient_urn: 'KH-2026-0004',
  patient_name: 'Anita Singh',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  encounter_id: null,
  status: 'AUTHORISED',
  is_printable: true,
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
      prescription_id: 1,
      item_order: 1,
      medicine_name: 'Tab Aceclofenac',
      dosage: '100 mg',
      frequency: 'Twice daily',
      duration_days: 5,
      instructions: 'After meals',
    },
  ],
}

const clinicSettings = vi.hoisted(() => ({
  current: {
    id: 1,
    name_en: 'Kalyan Hospital & Research Centre',
    name_hi: 'कल्याण अस्पताल',
    address_1: 'Station Road, Ara',
    address_2: 'Near Post Office',
  },
}))

const doctorsState = vi.hoisted(() => ({
  current: [] as DoctorOut[],
}))

vi.mock('../../api/queries', () => ({
  useClinicSettings: () => ({ data: clinicSettings.current }),
  useDoctors: () => ({ data: doctorsState.current }),
}))

function renderSlip(rx: PrescriptionOut = prescription, departmentName?: string | null) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div id="app-root">
        <PrescriptionPrint prescription={rx} departmentName={departmentName} />
      </div>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  doctorsState.current = []
})

describe('PrescriptionPrint', () => {
  it('uses the approved letterhead with the patient strip filled in', () => {
    renderSlip()

    expect(screen.getByTestId('letterhead-banner')).toHaveTextContent(/kalyan hospital/i)
    expect(screen.getByText('Dr. Chandan Kr. Dwivedi')).toBeInTheDocument()
    expect(screen.getByText('Anita Singh')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0004')).toBeInTheDocument()
    expect(screen.getByTestId('letterhead-footer')).toBeInTheDocument()
    expect(screen.getByText('Tab Aceclofenac')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print Prescription Slip/i })).toBeEnabled()
    expect(screen.queryByTestId('rx-status-watermark')).not.toBeInTheDocument()
  })

  it('prints the configured first address when the optional second address is blank', () => {
    clinicSettings.current = { ...clinicSettings.current, address_2: '' }
    renderSlip()
    const footer = screen.getByTestId('letterhead-footer')
    expect(footer).toHaveTextContent('Station Road, Ara')
    expect(footer).not.toHaveTextContent('नवादा थाना')
    expect(footer).not.toHaveTextContent('श्रीरामपुर रोड')
    clinicSettings.current = { ...clinicSettings.current, address_2: 'Near Post Office' }
  })

  it('renders on <body> as a print portal so printing can hide the app behind it', () => {
    const { container } = renderSlip()

    const sheet = screen.getByTestId('prescription-sheet')
    expect(container.contains(sheet)).toBe(false) // not inside the app tree
    expect(document.body.contains(sheet)).toBe(true)
    expect(sheet.closest('.print-portal')).not.toBeNull()
  })

  it.each([
    ['DRAFT', /DRAFT — NOT AUTHORISED/i],
    ['CANCELLED', /CANCELLED — VOID/i],
    ['SUPERSEDED', /SUPERSEDED — REVISED/i],
  ] as const)(
    'disables print button and renders non-print:hidden status watermark inside prescription-sheet for %s Rx',
    (status, expectedPattern) => {
      renderSlip({ ...prescription, status, is_printable: false })

      const printBtn = screen.getByRole('button', { name: /Print Prescription Slip/i })
      expect(printBtn).toBeDisabled()

      const sheet = screen.getByTestId('prescription-sheet')
      const watermark = within(sheet).getByTestId('rx-status-watermark')
      expect(watermark).toHaveTextContent(expectedPattern)
      expect(watermark.className).not.toContain('print:hidden')
    },
  )

  it('renders medicine form, strength, and route on the prescription table (Ophthalmology)', () => {
    const ophthRx: PrescriptionOut = {
      ...prescription,
      id: 2,
      doctor_id: 2,
      doctor_name: 'Priya Sharma',
      diagnosis: 'Acute Bacterial Conjunctivitis',
      items: [
        {
          id: 10,
          prescription_id: 2,
          item_order: 1,
          medicine_name: 'Moxifloxacin',
          form: 'Eye Drops',
          strength: '0.5%',
          route: 'Right Eye (OD)',
          dosage: '1 drop',
          frequency: 'QID',
          duration_days: 7,
          instructions: 'Instill gently into conjunctival sac',
        },
      ],
    }

    renderSlip(ophthRx, 'Ophthalmology')

    const sheet = screen.getByTestId('prescription-sheet')
    expect(within(sheet).getByText('Moxifloxacin')).toBeInTheDocument()
    expect(within(sheet).getByText('Eye Drops · 0.5%')).toBeInTheDocument()
    expect(within(sheet).getByText('1 drop')).toBeInTheDocument()
    expect(within(sheet).getByText('Right Eye (OD)')).toBeInTheDocument()
  })

  it('uses dynamic department banner and authoring doctor block for non-Physiotherapy prescriptions', () => {
    doctorsState.current = [
      {
        id: 2,
        name_en: 'Priya Sharma',
        name_hi: null,
        qualification: 'MBBS, MS (Ophthalmology)',
        registration_number: 'BIH-OPHTH-4412',
        default_fee_paise: 50000,
        is_active: true,
        version_id: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]

    const ophthRx: PrescriptionOut = {
      ...prescription,
      id: 3,
      doctor_id: 2,
      doctor_name: 'Priya Sharma',
    }

    renderSlip(ophthRx, 'Ophthalmology')

    const banner = screen.getByTestId('letterhead-banner')
    expect(banner).toHaveTextContent('Ophthalmology')
    expect(banner).not.toHaveTextContent('Physiotherapy Department')

    const doctorBlock = screen.getByTestId('letterhead-authoring-doctor')
    expect(doctorBlock).toHaveTextContent('Dr. Priya Sharma')
    expect(doctorBlock).toHaveTextContent('MBBS, MS (Ophthalmology)')
    expect(doctorBlock).toHaveTextContent('BIH-OPHTH-4412')
    expect(screen.queryByText('Dr. Chandan Kr. Dwivedi')).not.toBeInTheDocument()
    expect(screen.queryByText('Dr. Madan Mohan Dwivedi')).not.toBeInTheDocument()
  })

  it('does not default to Physiotherapy Department when departmentName is omitted for non-physio doctor', () => {
    doctorsState.current = [
      {
        id: 2,
        name_en: 'Priya Sharma',
        name_hi: null,
        qualification: 'MBBS, MS (Ophthalmology)',
        registration_number: 'BIH-OPHTH-4412',
        default_fee_paise: 50000,
        is_active: true,
        version_id: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]

    const nonPhysioRx: PrescriptionOut = {
      ...prescription,
      id: 4,
      doctor_id: 2,
      doctor_name: 'Priya Sharma',
    }

    renderSlip(nonPhysioRx)

    const banner = screen.getByTestId('letterhead-banner')
    expect(banner).toHaveTextContent(/kalyan hospital/i)
    expect(banner).not.toHaveTextContent('Physiotherapy Department')

    const doctorBlock = screen.getByTestId('letterhead-authoring-doctor')
    expect(doctorBlock).toHaveTextContent('Dr. Priya Sharma')
    expect(doctorBlock).toHaveTextContent('MBBS, MS (Ophthalmology)')
    expect(screen.queryByText('Dr. Chandan Kr. Dwivedi')).not.toBeInTheDocument()
    expect(screen.queryByText('Dr. Madan Mohan Dwivedi')).not.toBeInTheDocument()
  })
})
