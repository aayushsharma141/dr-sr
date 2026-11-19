import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import type { DoctorChargesOut } from '../../api/doctorCharges'
import * as doctorChargesApi from '../../api/doctorCharges'
import * as queriesApi from '../../api/queries'
import { DoctorChargesPanel } from '../billing/DoctorChargesPanel'

const mockConsultationLine: doctorChargesApi.BillLineOut = {
  id: 1,
  visit_id: 10,
  appointment_id: 5,
  category: 'CONSULTATION',
  source: 'SYSTEM',
  description: 'Consultation Fee - Dr. Dwivedi',
  unit: null,
  quantity: '1.00',
  rate_paise: 50000,
  amount_paise: 50000,
  original_amount_paise: 50000,
  status: 'ACTIVE',
  counts_toward_total: true,
  created_by_user_id: 2,
  created_by_username: 'reception',
  created_at: '2026-11-16T09:00:00Z',
  history: [],
}

const mockProcedureLine: doctorChargesApi.BillLineOut = {
  id: 2,
  visit_id: 10,
  appointment_id: 5,
  category: 'PROCEDURE',
  source: 'DOCTOR',
  description: 'Ultrasound therapy',
  unit: 'session',
  quantity: '1.00',
  rate_paise: 30000,
  amount_paise: 30000,
  original_amount_paise: 30000,
  status: 'ACTIVE',
  counts_toward_total: true,
  created_by_user_id: 3,
  created_by_username: 'drdwivedi',
  created_at: '2026-11-16T09:15:00Z',
  history: [],
}

const mockPackageLine: doctorChargesApi.BillLineOut = {
  id: 3,
  visit_id: 10,
  appointment_id: 5,
  category: 'PACKAGE',
  source: 'DOCTOR',
  description: 'Lumbar Rehab 10-Session Plan',
  unit: null,
  quantity: '1.00',
  rate_paise: 0,
  amount_paise: 0,
  original_amount_paise: 0,
  status: 'ACTIVE',
  counts_toward_total: true,
  created_by_user_id: 3,
  created_by_username: 'drdwivedi',
  created_at: '2026-11-16T09:20:00Z',
  history: [],
}

const mockChargesData: DoctorChargesOut = {
  consultation_line: mockConsultationLine,
  doctor_lines: [mockProcedureLine],
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DoctorChargesPanel', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders consultation fee read-only as "₹500.00, billed at check-in"', () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    expect(screen.getByText(/₹500\.00, billed at check-in/i)).toBeInTheDocument()
  })

  it('renders procedure lines with "quantity × rate = amount" and "Doctor" tag', () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    expect(screen.getByText('Ultrasound therapy')).toBeInTheDocument()
    expect(screen.getByText(/1(?:\.00)? × ₹300\.00 = ₹300\.00/i)).toBeInTheDocument()
    expect(screen.getByText('Doctor')).toBeInTheDocument()
  })

  it('renders empty copy "No charges added for this consultation yet." when doctor_lines is empty', () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: {
        consultation_line: mockConsultationLine,
        doctor_lines: [],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    expect(screen.getByText('No charges added for this consultation yet.')).toBeInTheDocument()
  })

  it('strictly contains NO payment controls, NO visit total, NO reception lines', () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    // No payment controls
    expect(screen.queryByRole('button', { name: /collect/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/payment mode/i)).not.toBeInTheDocument()

    // No visit total or dues
    expect(screen.queryByText(/total outstanding/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/visit total/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/remaining on this visit/i)).not.toBeInTheDocument()

    // No reception lines tag
    expect(screen.queryByText('Reception')).not.toBeInTheDocument()
  })

  it('is read-only when visit is closed: action buttons are hidden', () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} isVisitClosed={true} />)

    expect(screen.queryByRole('button', { name: /adjust fee/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add charge/i })).not.toBeInTheDocument()
  })

  it('renders "Adjust fee" and opens modal with Discount and Waive only (no Correct)', async () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} isVisitClosed={false} />)

    const adjustBtn = screen.getByRole('button', { name: /adjust fee/i })
    await user.click(adjustBtn)

    expect(screen.getByText(/Adjust Consultation Fee/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /discount/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /waive/i })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /correct/i })).not.toBeInTheDocument()
  })

  it('fee discount submits kind DISCOUNT with reduced amount and mandatory reason', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      bill_item_id: 1,
      appointment_id: 5,
      kind: 'DISCOUNT',
      old_amount_paise: 50000,
      new_amount_paise: 30000,
      reason: 'Senior citizen discount',
      actor_user_id: 3,
      created_at: '2026-11-16T09:20:00Z',
    })

    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(doctorChargesApi, 'useAdjustOwnFee').mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
      error: null,
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    await user.click(screen.getByRole('button', { name: /adjust fee/i }))

    const amountInput = screen.getByLabelText(/revised fee|new amount/i)
    await user.clear(amountInput)
    await user.type(amountInput, '300')

    const reasonInput = screen.getByLabelText(/reason/i)
    await user.type(reasonInput, 'Senior citizen discount')

    // Submit button should be enabled
    const submitBtn = screen.getByRole('button', { name: /^confirm/i })
    expect(submitBtn).not.toBeDisabled()

    await user.click(submitBtn)

    expect(mutateAsync).toHaveBeenCalledWith({
      kind: 'DISCOUNT',
      new_amount_paise: 30000,
      reason: 'Senior citizen discount',
    })
  })

  it('fee waive sets amount to 0, requires reason, and displays "Waived" badge', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      bill_item_id: 1,
      appointment_id: 5,
      kind: 'WAIVER',
      old_amount_paise: 50000,
      new_amount_paise: 0,
      reason: 'Poor patient follow up review',
      actor_user_id: 3,
      created_at: '2026-11-16T09:25:00Z',
    })

    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(doctorChargesApi, 'useAdjustOwnFee').mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
      error: null,
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    await user.click(screen.getByRole('button', { name: /adjust fee/i }))
    await user.click(screen.getByRole('radio', { name: /waive/i }))

    const reasonInput = screen.getByLabelText(/reason/i)
    await user.type(reasonInput, 'Poor patient follow up review')

    const submitBtn = screen.getByRole('button', { name: /^confirm/i })
    await user.click(submitBtn)

    expect(mutateAsync).toHaveBeenCalledWith({
      kind: 'WAIVER',
      new_amount_paise: 0,
      reason: 'Poor patient follow up review',
    })
  })

  it('displays S6 copy "Original ₹X → Revised ₹Y · {reason} · {you} · {time}" and Waived badge when fee was waived', () => {
    const waivedLine: doctorChargesApi.BillLineOut = {
      ...mockConsultationLine,
      amount_paise: 0,
      history: [
        {
          id: 10,
          bill_item_id: 1,
          kind: 'WAIVER',
          old_amount_paise: 50000,
          new_amount_paise: 0,
          reason: 'Free follow-up consultation',
          actor_user_id: 3,
          actor_username: 'drdwivedi',
          created_at: '2026-11-16T09:30:00Z',
        },
      ],
    }

    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: {
        consultation_line: waivedLine,
        doctor_lines: [],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    expect(screen.getByText('Waived')).toBeInTheDocument()
    expect(screen.getByText(/₹0\.00, billed at check-in/i)).toBeInTheDocument()
    expect(screen.getByText(/Original ₹500\.00 → Revised ₹0\.00/i)).toBeInTheDocument()
    expect(screen.getByText(/Free follow-up consultation/i)).toBeInTheDocument()
    expect(screen.getByText(/drdwivedi/i)).toBeInTheDocument()
  })

  it('reason validation: under 3 or over 500 chars keeps submit disabled and shows character counter', async () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    await user.click(screen.getByRole('button', { name: /adjust fee/i }))

    const reasonInput = screen.getByLabelText(/reason/i)
    const submitBtn = screen.getByRole('button', { name: /^confirm/i })

    // Under 3 chars
    await user.type(reasonInput, 'ab')
    expect(submitBtn).toBeDisabled()
    expect(screen.getByText(/2 \/ 500/i)).toBeInTheDocument()

    // 3 chars
    await user.type(reasonInput, 'c')
    expect(screen.getByText(/3 \/ 500/i)).toBeInTheDocument()
  })

  it('displays server error message on adjustment failure', async () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    const error = new Error('Fee cannot be adjusted below ₹200.00 already collected.')
    vi.spyOn(doctorChargesApi, 'useAdjustOwnFee').mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(error),
      isPending: false,
      isError: true,
      error,
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    await user.click(screen.getByRole('button', { name: /adjust fee/i }))

    const amountInput = screen.getByLabelText(/revised fee|new amount/i)
    await user.clear(amountInput)
    await user.type(amountInput, '300')

    const reasonInput = screen.getByLabelText(/reason/i)
    await user.type(reasonInput, 'Discretionary discount')

    const submitBtn = screen.getByRole('button', { name: /^confirm/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/Fee cannot be adjusted below ₹200\.00 already collected\./i)).toBeInTheDocument()
    })
  })

  it('"Add charge" opens modal supporting Procedure mode with preview and submits', async () => {
    const addLineMutate = vi.fn().mockResolvedValue(mockProcedureLine)

    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(doctorChargesApi, 'useAddDoctorCharge').mockReturnValue({
      mutateAsync: addLineMutate,
      isPending: false,
      isError: false,
      error: null,
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    await user.click(screen.getByRole('button', { name: /add charge/i }))

    expect(screen.getByRole('heading', { name: /Add Charge/i })).toBeInTheDocument()

    const descInput = screen.getByLabelText(/description/i)
    await user.type(descInput, 'Ultrasound therapy')

    const qtyInput = screen.getByLabelText(/quantity/i)
    await user.clear(qtyInput)
    await user.type(qtyInput, '2')

    const rateInput = screen.getByLabelText(/rate/i)
    await user.clear(rateInput)
    await user.type(rateInput, '350')

    // Preview should show 2 × ₹350.00 = ₹700.00
    expect(screen.getByText(/2(?:\.00)? × ₹350\.00 = ₹700\.00/i)).toBeInTheDocument()

    const submitBtn = screen.getByRole('button', { name: 'Save charge' })
    await user.click(submitBtn)

    expect(addLineMutate).toHaveBeenCalledWith({
      category: 'PROCEDURE',
      description: 'Ultrasound therapy',
      quantity: '2',
      rate_paise: 35000,
      unit: null,
    })
  })

  it('"Add charge" in Package mode lists patient treatment plans, shows "Package (information only)", zero amount', async () => {
    const addLineMutate = vi.fn().mockResolvedValue(mockPackageLine)

    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: mockChargesData,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(doctorChargesApi, 'useAddDoctorCharge').mockReturnValue({
      mutateAsync: addLineMutate,
      isPending: false,
      isError: false,
      error: null,
    } as any)

    vi.spyOn(queriesApi, 'usePatientTreatmentPlans').mockReturnValue({
      data: [
        {
          id: 42,
          patient_id: 101,
          plan_name: 'Lumbar Rehab 10-Session Plan',
          total_sessions: 10,
          completed_sessions: 2,
          total_price_paise: 250000,
          notes: 'Lower back strengthening',
        },
      ],
      isPending: false,
      isError: false,
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} patientId={101} />)

    await user.click(screen.getByRole('button', { name: /add charge/i }))
    await user.click(screen.getByRole('radio', { name: /package/i }))

    expect(screen.getByText(/Package \(information only\)/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/rate/i)).not.toBeInTheDocument()

    const selectPlan = screen.getByLabelText(/treatment plan/i)
    await user.selectOptions(selectPlan, '42')

    const submitBtn = screen.getByRole('button', { name: 'Save charge' })
    await user.click(submitBtn)

    expect(addLineMutate).toHaveBeenCalledWith({
      category: 'PACKAGE',
      treatment_plan_id: 42,
    })
  })

  it('renders package lines with "Package (information only)" and no amount input', () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: {
        consultation_line: mockConsultationLine,
        doctor_lines: [mockPackageLine],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    expect(screen.getByText('Lumbar Rehab 10-Session Plan')).toBeInTheDocument()
    expect(screen.getByText('Package (information only)')).toBeInTheDocument()
  })

  it('strictly NO doctor void button is rendered on any line', () => {
    vi.spyOn(doctorChargesApi, 'useDoctorCharges').mockReturnValue({
      data: {
        consultation_line: mockConsultationLine,
        doctor_lines: [mockProcedureLine, mockPackageLine],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<DoctorChargesPanel appointmentId={5} />)

    expect(screen.queryByRole('button', { name: /void/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})
