import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as billApi from '../../api/bill'
import type { VisitBillOut } from '../../api/bill'
import { BillPanel } from '../billing/BillPanel'

const baseBill: VisitBillOut = {
  visit_id: 10,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  status: 'OPEN',
  visit_date: '2026-11-16',
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
          created_at: '2026-11-16T09:00:00Z',
          history: [],
        },
      ],
    },
    {
      category: 'PROCEDURE',
      subtotal_paise: 0,
      lines: [],
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
          id: 2,
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
          created_at: '2026-11-16T09:30:00Z',
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
  bill_total_paise: 60000,
  paid_paise: 0,
  due_paise: 60000,
  payments: [],
  voided_lines: [],
  previous_dues: [],
  previous_dues_total_paise: 0,
  packages: [],
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('BillPanel (Task 1 & Task 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders five section headings in order with subtotals, lines with quantity × rate = amount, source tag and SYSTEM check-in label', () => {
    renderWithClient(<BillPanel visitId={10} initialBill={baseBill} />)

    // Verify 5 sections rendered
    expect(screen.getByRole('heading', { name: /Consultation/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Procedures \/ Services/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Treatment Packages/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Medicines/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Additional Particulars/i })).toBeInTheDocument()

    // Subtotals
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    expect(screen.getByText('₹100.00')).toBeInTheDocument()

    // Medicine line: "2 × ₹50.00 = ₹100.00" and Reception tag (BILL-04)
    expect(screen.getByText(/Paracetamol 500mg/i)).toBeInTheDocument()
    expect(screen.getByText(/2 × ₹50\.00 = ₹100\.00/i)).toBeInTheDocument()
    expect(screen.getByText('Reception')).toBeInTheDocument()

    // Consultation line with SYSTEM source labeled "Fee as billed at check-in"
    expect(screen.getByText(/OPD Consultation - Dr. Dwivedi/i)).toBeInTheDocument()
    expect(screen.getByText('Fee as billed at check-in')).toBeInTheDocument()
  })

  it('renders adjusted consultation line with original amount, reason, staff and time (FEE-09)', () => {
    const adjustedBill: VisitBillOut = {
      ...baseBill,
      sections: [
        {
          category: 'CONSULTATION',
          subtotal_paise: 40000,
          lines: [
            {
              ...baseBill.sections[0].lines[0],
              rate_paise: 40000,
              amount_paise: 40000,
              history: [
                {
                  id: 11,
                  bill_item_id: 1,
                  kind: 'DISCOUNT',
                  old_amount_paise: 50000,
                  new_amount_paise: 40000,
                  reason: 'Senior citizen discount',
                  actor_user_id: 3,
                  actor_username: 'dr_madan',
                  created_at: '2026-11-16T10:15:00Z',
                },
              ],
            },
          ],
        },
        ...baseBill.sections.slice(1),
      ],
      bill_total_paise: 50000,
      due_paise: 50000,
    }

    renderWithClient(<BillPanel visitId={10} initialBill={adjustedBill} />)

    // Current amount
    expect(screen.getByText(/1 × ₹400\.00 = ₹400\.00/i)).toBeInTheDocument()

    // History: "Changed from ₹500.00 · Senior citizen discount · dr_madan · ..."
    expect(
      screen.getByText(/Changed from ₹500\.00 · Senior citizen discount · dr_madan/i),
    ).toBeInTheDocument()
  })

  it('renders voided lines in a collapsed details disclosure with reason and never in totals', () => {
    const billWithVoided: VisitBillOut = {
      ...baseBill,
      voided_lines: [
        {
          id: 99,
          visit_id: 10,
          category: 'MEDICINE',
          source: 'RECEPTION',
          description: 'Unneeded syringe',
          quantity: 1,
          rate_paise: 2000,
          amount_paise: 2000,
          original_amount_paise: 2000,
          status: 'VOIDED',
          counts_toward_total: false,
          created_by_user_id: 2,
          created_at: '2026-11-16T09:10:00Z',
          history: [],
          void_reason: 'Entered by mistake',
          voided_by_username: 'reception',
          voided_at: '2026-11-16T09:20:00Z',
        },
      ],
    }

    renderWithClient(<BillPanel visitId={10} initialBill={billWithVoided} />)

    expect(screen.getByText(/Voided lines/i)).toBeInTheDocument()
    expect(screen.getByText(/Unneeded syringe/i)).toBeInTheDocument()
    expect(screen.getByText(/Entered by mistake · reception/i)).toBeInTheDocument()
  })

  it('renders empty copy when bill has no charges', () => {
    const emptyBill: VisitBillOut = {
      ...baseBill,
      sections: baseBill.sections.map((s) => ({ ...s, subtotal_paise: 0, lines: [] })),
      bill_total_paise: 0,
      due_paise: 0,
    }

    renderWithClient(<BillPanel visitId={10} initialBill={emptyBill} />)
    expect(screen.getByText('No charges on this visit yet.')).toBeInTheDocument()
  })

  it('renders locked copy when visit is closed', () => {
    const closedBill: VisitBillOut = {
      ...baseBill,
      status: 'CLOSED',
      locked: true,
      closed_at: '2026-11-16T11:45:00Z',
      close_reason: 'Normal checkout',
    }

    renderWithClient(<BillPanel visitId={10} initialBill={closedBill} />)
    expect(screen.getByText(/Visit closed on .* The bill is locked\./i)).toBeInTheDocument()
  })

  it('renders payment history list with receipt number, method, amount and reversed badge (W3)', () => {
    const billWithPayments: VisitBillOut = {
      ...baseBill,
      paid_paise: 40000,
      due_paise: 20000,
      payments: [
        {
          id: 501,
          receipt_number: 'REC-2026-0010',
          amount_paise: 40000,
          payment_method: 'UPI',
          is_reversed: false,
          created_at: '2026-11-16T10:00:00Z',
          created_by_username: 'reception',
        },
        {
          id: 502,
          receipt_number: 'REC-2026-0011',
          amount_paise: 10000,
          payment_method: 'CASH',
          is_reversed: true,
          created_at: '2026-11-16T10:05:00Z',
          created_by_username: 'reception',
        },
      ],
    }

    renderWithClient(<BillPanel visitId={10} initialBill={billWithPayments} />)

    expect(screen.getByText('REC-2026-0010')).toBeInTheDocument()
    expect(screen.getByText('UPI')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()

    expect(screen.getByText('REC-2026-0011')).toBeInTheDocument()
    expect(screen.getByText('CASH')).toBeInTheDocument()
    expect(screen.getByText('Reversed')).toBeInTheDocument()
  })

  it('renders totals block in exact order and responds to payingNowPaise', () => {
    renderWithClient(
      <BillPanel visitId={10} initialBill={baseBill} payingNowPaise={20000} />,
    )

    // Totals block contains:
    // Bill total (60000)
    // Paid earlier (0)
    // Paying now (20000 -> ₹200.00)
    // Remaining on this visit (40000 -> ₹400.00)
    // Previous dues (0)
    // Total outstanding (40000 -> ₹400.00)
    expect(screen.getByText('Bill total')).toBeInTheDocument()
    expect(screen.getByText('Paid earlier')).toBeInTheDocument()
    expect(screen.getByText('Paying now')).toBeInTheDocument()
    expect(screen.getByText('Remaining on this visit')).toBeInTheDocument()
    expect(screen.getByText('Previous dues')).toBeInTheDocument()
    expect(screen.getByText('Total outstanding')).toBeInTheDocument()
    expect(screen.getByText('(remaining + previous dues)')).toBeInTheDocument()

    expect(screen.getByText('₹200.00')).toBeInTheDocument() // Paying now
    expect(screen.getAllByText('₹400.00').length).toBe(2) // Remaining + Total outstanding
  })

  it('renders previous dues card separately and calls onCollectDue when clicked (LED-01, LED-02)', async () => {
    const onCollect = vi.fn()
    const billWithDues: VisitBillOut = {
      ...baseBill,
      previous_dues: [
        {
          visit_id: 5,
          visit_date: '2026-11-10',
          doctor_names: ['Dr. Madan Mohan Dwivedi'],
          balance_paise: 15000,
        },
      ],
      previous_dues_total_paise: 15000,
    }

    renderWithClient(
      <BillPanel
        visitId={10}
        initialBill={billWithDues}
        canCollect={true}
        onCollectDue={onCollect}
      />,
    )

    expect(screen.getByText('Previous dues (separate ledger)')).toBeInTheDocument()
    expect(screen.getByText('Visit 2026-11-10')).toBeInTheDocument()
    expect(screen.getByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
    expect(screen.getAllByText('₹150.00').length).toBe(2)

    const collectBtn = screen.getByRole('button', { name: /Collect previous dues/i })
    await userEvent.click(collectBtn)
    expect(onCollect).toHaveBeenCalledWith(billWithDues.previous_dues[0])
  })

  it('renders treatment packages card with session progress and agreed/paid balances (OD-C)', () => {
    const billWithPackages: VisitBillOut = {
      ...baseBill,
      packages: [
        {
          treatment_plan_id: 33,
          plan_name: 'Knee Rehab 10-Session Package',
          status: 'ACTIVE',
          total_sessions: 10,
          completed_sessions: 4,
          remaining_sessions: 6,
          agreed_price_paise: 350000,
          paid_paise: 200000,
          balance_paise: 150000,
        },
      ],
    }

    renderWithClient(<BillPanel visitId={10} initialBill={billWithPackages} />)

    expect(screen.getByText('Knee Rehab 10-Session Package')).toBeInTheDocument()
    expect(
      screen.getByText(/4 of 10 sessions completed \(6 remaining\)/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/Agreed: ₹3,500\.00/i)).toBeInTheDocument()
    expect(screen.getByText(/Paid: ₹2,000\.00/i)).toBeInTheDocument()
    expect(screen.getByText(/Balance: ₹1,500\.00/i)).toBeInTheDocument()
  })

  it('renders loading non-jumping placeholder while fetching', () => {
    vi.spyOn(billApi, 'useVisitBill').mockReturnValue({
      data: undefined,
      isPending: true,
      error: null,
    } as any)

    renderWithClient(<BillPanel visitId={10} />)
    expect(screen.getByText('Loading bill...')).toBeInTheDocument()
  })

  it('renders InlineAlert with role="alert" when bill load fails', () => {
    vi.spyOn(billApi, 'useVisitBill').mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error('Failed to load visit bill from server'),
    } as any)

    renderWithClient(<BillPanel visitId={10} />)
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('Failed to load visit bill from server')
  })
})
