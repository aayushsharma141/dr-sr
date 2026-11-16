import '../../test/dialog-shim'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from '../../api/client'
import type { VisitBillOut } from '../../api/bill'
import { BillPanel } from '../billing/BillPanel'
import { AddBillLineModal } from '../billing/AddBillLineModal'
import { BillLineActionModal } from '../billing/BillLineActionModal'
import { FeeCorrectionModal } from '../billing/FeeCorrectionModal'
import { istToday } from '../../format'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    apiFetch: vi.fn(),
  }
})

const todayStr = istToday()

const baseBill: VisitBillOut = {
  visit_id: 10,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  status: 'OPEN',
  visit_date: todayStr,
  closed_at: null,
  close_reason: null,
  locked: false,
  sections: [
    {
      category: 'CONSULTATION',
      subtotal_paise: 50000,
      lines: [
        {
          id: 1,
          visit_id: 10,
          appointment_id: 201,
          category: 'CONSULTATION',
          source: 'SYSTEM',
          description: 'OPD Consultation - Dr. Dwivedi',
          unit: null,
          quantity: 1,
          rate_paise: 50000,
          amount_paise: 50000,
          original_amount_paise: 50000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 2,
          created_by_username: 'reception',
          created_at: `${todayStr}T09:00:00Z`,
          history: [],
        },
      ],
    },
    {
      category: 'PROCEDURE',
      subtotal_paise: 30000,
      lines: [
        {
          id: 2,
          visit_id: 10,
          category: 'PROCEDURE',
          source: 'DOCTOR',
          description: 'Wound debridement',
          unit: null,
          quantity: 1,
          rate_paise: 30000,
          amount_paise: 30000,
          original_amount_paise: 30000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 5,
          created_by_username: 'doctor_a',
          created_at: `${todayStr}T09:15:00Z`,
          history: [],
        },
      ],
    },
    {
      category: 'PACKAGE',
      subtotal_paise: 0,
      lines: [],
    },
    {
      category: 'MEDICINE',
      subtotal_paise: 10000,
      lines: [
        {
          id: 3,
          visit_id: 10,
          category: 'MEDICINE',
          source: 'RECEPTION',
          description: 'Paracetamol 500mg',
          unit: 'strip',
          quantity: 2,
          rate_paise: 5000,
          amount_paise: 10000,
          original_amount_paise: 10000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 2,
          created_by_username: 'reception',
          created_at: `${todayStr}T09:30:00Z`,
          history: [],
        },
        {
          id: 4,
          visit_id: 10,
          category: 'MEDICINE',
          source: 'RECEPTION',
          description: 'Ibuprofen 400mg',
          unit: 'strip',
          quantity: 1,
          rate_paise: 4000,
          amount_paise: 4000,
          original_amount_paise: 4000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 99,
          created_by_username: 'other_user',
          created_at: `${todayStr}T09:35:00Z`,
          history: [],
        },
        {
          id: 5,
          visit_id: 10,
          category: 'MEDICINE',
          source: 'RECEPTION',
          description: 'Yesterday medicine',
          unit: 'strip',
          quantity: 1,
          rate_paise: 5000,
          amount_paise: 5000,
          original_amount_paise: 5000,
          status: 'ACTIVE',
          counts_toward_total: true,
          created_by_user_id: 2,
          created_by_username: 'reception',
          created_at: '2026-11-01T09:30:00Z',
          history: [],
        },
      ],
    },
    {
      category: 'ADDITIONAL',
      subtotal_paise: 0,
      lines: [],
    },
  ],
  bill_total_paise: 94000,
  paid_paise: 0,
  due_paise: 94000,
  payments: [],
  voided_lines: [],
  previous_dues: [],
  previous_dues_total_paise: 0,
  packages: [],
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  }
}

describe('Bill Line Actions: Add medicine and Add particular (Task 1)', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/prescribed-medicines')) {
        return [
          { prescription_item_id: 101, medicine_name: 'Amoxicillin 500mg', form: 'capsule' },
          { prescription_item_id: 102, medicine_name: 'Paracetamol 650mg', form: 'tablet' },
        ]
      }
      return {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders "Add medicine" and "Add particular" only when user has bill:write and bill is unlocked', () => {
    const receptionUser = { id: 2, username: 'reception', permissions: ['bill:write', 'payment:create'] }

    // Unlocked bill with bill:write
    const { unmount } = renderWithClient(
      <BillPanel visitId={10} initialBill={baseBill} currentUser={receptionUser} />
    )
    expect(screen.getByRole('button', { name: /Add medicine/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add particular/i })).toBeInTheDocument()
    unmount()

    // Locked bill (locked: true)
    const lockedBill = { ...baseBill, locked: true }
    const { unmount: unmountLocked } = renderWithClient(
      <BillPanel visitId={10} initialBill={lockedBill} currentUser={receptionUser} />
    )
    expect(screen.queryByRole('button', { name: /Add medicine/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add particular/i })).not.toBeInTheDocument()
    unmountLocked()

    // User without bill:write
    const readOnlyUser = { id: 3, username: 'viewer', permissions: ['bill:read'] }
    renderWithClient(
      <BillPanel visitId={10} initialBill={baseBill} currentUser={readOnlyUser} />
    )
    expect(screen.queryByRole('button', { name: /Add medicine/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add particular/i })).not.toBeInTheDocument()
  })

  it('Add medicine modal: lists prescribed medicines (name and form only, B2); picking one fills name and prescription_item_id, leaving quantity empty', async () => {
    const onClose = vi.fn()
    renderWithClient(
      <AddBillLineModal open={true} onClose={onClose} visitId={10} mode="medicine" />
    )

    // Prescribed medicines reference rendered with name and form
    expect(await screen.findByText('Amoxicillin 500mg')).toBeInTheDocument()
    expect(screen.getByText('capsule')).toBeInTheDocument()
    expect(screen.getByText('Paracetamol 650mg')).toBeInTheDocument()
    expect(screen.getByText('tablet')).toBeInTheDocument()

    // No clinical quantities or dosages rendered
    expect(screen.queryByText(/1-0-1/)).not.toBeInTheDocument()
    expect(screen.queryByText(/5 days/)).not.toBeInTheDocument()

    // Picking one fills name and leaves quantity empty
    const pickButton = screen.getByRole('button', { name: /Amoxicillin 500mg/i })
    await user.click(pickButton)

    const descInput = screen.getByLabelText(/Medicine name \*/i) as HTMLInputElement
    expect(descInput.value).toBe('Amoxicillin 500mg')
    expect(screen.getByText(/Linked to doctor's prescription/i)).toBeInTheDocument()

    const qtyInput = screen.getByLabelText(/Quantity \*/i) as HTMLInputElement
    expect(qtyInput.value).toBe('')

    // Type quantity "2" and rate "50"
    await user.type(qtyInput, '2')
    const rateInput = screen.getByLabelText(/Rate \(₹\) \*/i)
    await user.type(rateInput, '50')

    // Live preview: 2 × ₹50.00 = ₹100.00
    expect(screen.getByText(/Preview: 2 × ₹50\.00 = ₹100\.00/i)).toBeInTheDocument()

    // Submit
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 99 })
    const submitBtn = screen.getByRole('button', { name: /Add medicine/i })
    await user.click(submitBtn)

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/visits/10/bill-items',
      expect.objectContaining({
        method: 'POST',
        body: {
          category: 'MEDICINE',
          description: 'Amoxicillin 500mg',
          unit: null,
          quantity: '2',
          rate_paise: 5000,
          prescription_item_id: 101,
        },
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('Add medicine modal: free typing sends no prescription link (MED-07)', async () => {
    const onClose = vi.fn()
    renderWithClient(
      <AddBillLineModal open={true} onClose={onClose} visitId={10} mode="medicine" />
    )

    const descInput = screen.getByLabelText(/Medicine name \*/i)
    await user.type(descInput, 'Cetirizine 10mg')

    const unitInput = screen.getByLabelText(/Unit \(optional\)/i)
    await user.type(unitInput, 'strip')

    const qtyInput = screen.getByLabelText(/Quantity \*/i)
    await user.type(qtyInput, '3')

    const rateInput = screen.getByLabelText(/Rate \(₹\) \*/i)
    await user.type(rateInput, '25')

    expect(screen.getByText(/Preview: 3 × ₹25\.00 = ₹75\.00/i)).toBeInTheDocument()

    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 100 })
    await user.click(screen.getByRole('button', { name: /Add medicine/i }))

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/visits/10/bill-items',
      expect.objectContaining({
        method: 'POST',
        body: {
          category: 'MEDICINE',
          description: 'Cetirizine 10mg',
          unit: 'strip',
          quantity: '3',
          rate_paise: 2500,
          prescription_item_id: null,
        },
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('Add particular modal: posts category ADDITIONAL with name, quantity, rate (BILL-05)', async () => {
    const onClose = vi.fn()
    renderWithClient(
      <AddBillLineModal open={true} onClose={onClose} visitId={10} mode="particular" />
    )

    const descInput = screen.getByLabelText(/Particular name \*/i)
    await user.type(descInput, 'Dressing charge')

    const qtyInput = screen.getByLabelText(/Quantity \*/i)
    // starts with default "1"
    expect((qtyInput as HTMLInputElement).value).toBe('1')

    const rateInput = screen.getByLabelText(/Rate \(₹\) \*/i)
    await user.type(rateInput, '100')

    expect(screen.getByText(/Preview: 1 × ₹100\.00 = ₹100\.00/i)).toBeInTheDocument()

    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 102 })
    await user.click(screen.getByRole('button', { name: /Add particular/i }))

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/visits/10/bill-items',
      expect.objectContaining({
        method: 'POST',
        body: {
          category: 'ADDITIONAL',
          description: 'Dressing charge',
          unit: null,
          quantity: '1',
          rate_paise: 10000,
          prescription_item_id: null,
        },
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps submit disabled with "Still needed: ..." when fields are invalid or missing', async () => {
    renderWithClient(
      <AddBillLineModal open={true} onClose={vi.fn()} visitId={10} mode="particular" />
    )

    const submitBtn = screen.getByRole('button', { name: /Add particular/i })
    expect(submitBtn).toBeDisabled()
    expect(screen.getByText(/Still needed: particular name, rate\./i)).toBeInTheDocument()

    const descInput = screen.getByLabelText(/Particular name \*/i)
    await user.type(descInput, 'Syringe')
    expect(screen.getByText(/Still needed: rate\./i)).toBeInTheDocument()

    // Invalid quantity
    const qtyInput = screen.getByLabelText(/Quantity \*/i)
    await user.clear(qtyInput)
    await user.type(qtyInput, '0')
    expect(screen.getByText(/Still needed: quantity, rate\./i)).toBeInTheDocument()
  })

  it('server 422 shows error in InlineAlert and dialog stays open with values kept', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new ApiError(422, 'invalid_rate', 'Rate must be a positive integer in paise.')
    )

    renderWithClient(
      <AddBillLineModal open={true} onClose={vi.fn()} visitId={10} mode="particular" />
    )

    await user.type(screen.getByLabelText(/Particular name \*/i), 'Test charge')
    await user.type(screen.getByLabelText(/Rate \(₹\) \*/i), '50')

    await user.click(screen.getByRole('button', { name: /Add particular/i }))

    // Error alert shown
    expect(await screen.findByRole('alert')).toHaveTextContent('Rate must be a positive integer in paise.')
    // Typed values preserved
    expect((screen.getByLabelText(/Particular name \*/i) as HTMLInputElement).value).toBe('Test charge')
  })

  it('network failure shows connection error in InlineAlert, keeps dialog open, and does not retry', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/prescribed-medicines')) {
        return []
      }
      if (path.includes('/bill-items')) {
        throw new TypeError('Failed to fetch')
      }
      return {}
    })

    renderWithClient(
      <AddBillLineModal open={true} onClose={vi.fn()} visitId={10} mode="medicine" />
    )

    await user.type(screen.getByLabelText(/Medicine name \*/i), 'Paracetamol')
    await user.type(screen.getByLabelText(/Quantity \*/i), '2')
    await user.type(screen.getByLabelText(/Rate \(₹\) \*/i), '20')

    await user.click(screen.getByRole('button', { name: /Add medicine/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Failed to fetch/i)
    // Inputs remain intact
    expect((screen.getByLabelText(/Medicine name \*/i) as HTMLInputElement).value).toBe('Paracetamol')
    expect((screen.getByLabelText(/Quantity \*/i) as HTMLInputElement).value).toBe('2')
    // No retry occurred
    expect(apiFetch).toHaveBeenCalledTimes(2) // 1 for prescribed-medicines query + 1 for failed mutation
  })
})

describe('Bill Line Actions: Void and Change Quantity for Reception (Task 2)', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reception sees Void and Change quantity only on own same-day lines (OD-G)', () => {
    const receptionUser = { id: 2, username: 'reception', permissions: ['bill:write', 'payment:create'] }
    renderWithClient(
      <BillPanel visitId={10} initialBill={baseBill} currentUser={receptionUser} />
    )

    // Own same-day line (id: 3, created_by_user_id: 2, created today) has Void and Change quantity
    const voidButtons = screen.getAllByRole('button', { name: /^Void$/i })
    expect(voidButtons.length).toBe(1)

    const changeButtons = screen.getAllByRole('button', { name: /Change quantity/i })
    expect(changeButtons.length).toBe(1)

    // Other user's line (id: 4, created_by: 99), older day line (id: 5), doctor line (id: 2), consultation line (id: 1) do NOT have them
  })

  it('Void action: requires reason (3-500 chars) with counter and destructive button styling', async () => {
    const receptionLine = baseBill.sections[3].lines[0] // line id: 3
    const onClose = vi.fn()

    renderWithClient(
      <BillLineActionModal
        open={true}
        onClose={onClose}
        visitId={10}
        line={receptionLine}
        mode="void"
      />
    )

    expect(screen.getByText(/Void bill line/i)).toBeInTheDocument()
    expect(screen.getByText(/Paracetamol 500mg/i)).toBeInTheDocument()
    expect(screen.getByText('0 / 500')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: /Void line/i })
    expect(confirmBtn).toBeDisabled()
    expect(confirmBtn.className).toContain('bg-[#C81E1E]')

    const reasonInput = screen.getByLabelText(/Reason \*/i)
    await user.type(reasonInput, 'ab')
    expect(screen.getByText('2 / 500')).toBeInTheDocument()
    expect(confirmBtn).toBeDisabled()
    expect(screen.getByText(/Still needed: reason \(3–500 characters\)\./i)).toBeInTheDocument()

    await user.type(reasonInput, 'c - patient requested return')
    expect(confirmBtn).not.toBeDisabled()

    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 3, status: 'VOIDED' })
    await user.click(confirmBtn)

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/bill-items/3/void',
      expect.objectContaining({
        method: 'POST',
        body: { reason: 'abc - patient requested return' },
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('Change quantity action: allows changing quantity and rate with reason', async () => {
    const receptionLine = baseBill.sections[3].lines[0] // line id: 3, qty 2, rate 5000
    const onClose = vi.fn()

    renderWithClient(
      <BillLineActionModal
        open={true}
        onClose={onClose}
        visitId={10}
        line={receptionLine}
        mode="correct"
      />
    )

    expect(screen.getByText(/Change quantity/i)).toBeInTheDocument()
    const qtyInput = screen.getByLabelText(/New Quantity \*/i)
    expect((qtyInput as HTMLInputElement).value).toBe('2')

    await user.clear(qtyInput)
    await user.type(qtyInput, '5')

    const reasonInput = screen.getByLabelText(/Reason \*/i)
    await user.type(reasonInput, 'Quantity adjusted per doctor instruction')

    expect(screen.getByText(/Revised: 5 × ₹50\.00 = ₹250\.00/i)).toBeInTheDocument()

    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 3, quantity: 5, amount_paise: 25000 })
    await user.click(screen.getByRole('button', { name: /Save change/i }))

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/bill-items/3/correct',
      expect.objectContaining({
        method: 'POST',
        body: {
          quantity: '5',
          rate_paise: 5000,
          reason: 'Quantity adjusted per doctor instruction',
        },
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('422 void_below_paid shows server message; 409 shows ConflictBanner', async () => {
    const receptionLine = baseBill.sections[3].lines[0]
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new ApiError(422, 'void_below_paid', 'Void would reduce bill total below paid amount ₹500.00.')
    )

    const { unmount } = renderWithClient(
      <BillLineActionModal
        open={true}
        onClose={vi.fn()}
        visitId={10}
        line={receptionLine}
        mode="void"
      />
    )

    await user.type(screen.getByLabelText(/Reason \*/i), 'Void reason test')
    await user.click(screen.getByRole('button', { name: /Void line/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Void would reduce bill total below paid amount ₹500.00.'
    )
    unmount()

    // Conflict 409
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new ApiError(409, 'line_already_voided', 'Line is already voided.')
    )
    const onReload = vi.fn()
    renderWithClient(
      <BillLineActionModal
        open={true}
        onClose={vi.fn()}
        visitId={10}
        line={receptionLine}
        mode="void"
        onReload={onReload}
      />
    )

    await user.type(screen.getByLabelText(/Reason \*/i), 'Another void try')
    await user.click(screen.getByRole('button', { name: /Void line/i }))

    expect(await screen.findByText(/This bill line was modified or voided by another user/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reload latest/i })).toBeInTheDocument()
  })
})

describe('Bill Line Actions: Admin Actions with bill:adjust (Task 3)', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Admin with bill:adjust sees "Adjust fee" on consultation line; reception never does (OD-A)', () => {
    const receptionUser = { id: 2, username: 'reception', permissions: ['bill:write', 'payment:create'] }
    const { unmount } = renderWithClient(
      <BillPanel visitId={10} initialBill={baseBill} currentUser={receptionUser} />
    )
    expect(screen.queryByRole('button', { name: /Adjust fee/i })).not.toBeInTheDocument()
    unmount()

    const adminUser = { id: 1, username: 'admin', permissions: ['bill:adjust', 'bill:write'] }
    renderWithClient(
      <BillPanel visitId={10} initialBill={baseBill} currentUser={adminUser} />
    )
    expect(screen.getByRole('button', { name: /Adjust fee/i })).toBeInTheDocument()
  })

  it('FeeCorrectionModal: supports Discount, Waive, Correct; S6 copy "Original ₹X → Revised ₹Y"; posts to /fee-correction', async () => {
    const onClose = vi.fn()
    renderWithClient(
      <FeeCorrectionModal
        open={true}
        onClose={onClose}
        visitId={10}
        appointmentId={201}
        currentAmountPaise={50000}
      />
    )

    // S6 copy: "Original ₹X → Revised ₹Y"
    expect(screen.getByText(/Original ₹500\.00 → Revised/i)).toBeInTheDocument()

    // Waive sets 0
    await user.click(screen.getByRole('button', { name: /Waive/i }))
    expect(screen.getByText(/Original ₹500\.00 → Revised ₹0\.00/i)).toBeInTheDocument()

    const reasonInput = screen.getByLabelText(/Reason \*/i)
    await user.type(reasonInput, 'Director waiver for BPL card holder')

    vi.mocked(apiFetch).mockResolvedValueOnce({
      bill_item_id: 1,
      appointment_id: 201,
      kind: 'WAIVER',
      old_amount_paise: 50000,
      new_amount_paise: 0,
    })

    await user.click(screen.getByRole('button', { name: /Save fee adjustment/i }))

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/appointments/201/fee-correction',
      expect.objectContaining({
        method: 'POST',
        body: {
          kind: 'WAIVER',
          new_amount_paise: 0,
          reason: 'Director waiver for BPL card holder',
        },
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('FeeCorrectionModal: Discount validates amount lower than original fee', async () => {
    renderWithClient(
      <FeeCorrectionModal
        open={true}
        onClose={vi.fn()}
        visitId={10}
        appointmentId={201}
        currentAmountPaise={50000}
      />
    )

    const amountInput = screen.getByLabelText(/Discounted Amount \(₹\) \*/i)
    await user.type(amountInput, '600') // higher than 500
    await user.type(screen.getByLabelText(/Reason \*/i), 'Senior citizen discount')

    const saveBtn = screen.getByRole('button', { name: /Save fee adjustment/i })
    expect(saveBtn).toBeDisabled()
    expect(screen.getByText(/Still needed: amount lower than original fee\./i)).toBeInTheDocument()

    await user.clear(amountInput)
    await user.type(amountInput, '350')
    expect(saveBtn).not.toBeDisabled()
    expect(screen.getByText(/Original ₹500\.00 → Revised ₹350\.00/i)).toBeInTheDocument()
  })

  it('Admin with bill:adjust sees Void and Change on ANY non-consultation line and posts to admin routes (owner decision (v))', async () => {
    const adminUser = { id: 1, username: 'admin', permissions: ['bill:adjust', 'bill:write'] }
    renderWithClient(
      <BillPanel visitId={10} initialBill={baseBill} currentUser={adminUser} />
    )

    // Doctor procedure line (id: 2), other user's medicine (id: 4), older day line (id: 5), reception line (id: 3)
    // All 4 non-consultation lines have Void and Change quantity buttons for admin!
    const voidButtons = screen.getAllByRole('button', { name: /^Void$/i })
    expect(voidButtons.length).toBe(4)

    const changeButtons = screen.getAllByRole('button', { name: /Change quantity/i })
    expect(changeButtons.length).toBe(4)

    // Click void on doctor procedure line
    await user.click(voidButtons[0]) // opens modal for line id: 2

    expect(screen.getAllByText(/Wound debridement/i).length).toBeGreaterThanOrEqual(2)
    await user.type(screen.getByLabelText(/Reason \*/i), 'Admin void test for procedure')

    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 2, status: 'VOIDED' })
    await user.click(screen.getByRole('button', { name: /Void line/i }))

    // Posts to admin-void route!
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/bill-items/2/admin-void',
      expect.objectContaining({
        method: 'POST',
        body: { reason: 'Admin void test for procedure' },
      })
    )
  })
})
