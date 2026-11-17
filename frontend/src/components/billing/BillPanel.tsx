import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useVisitBill, type BillLineOut, type PreviousDueOut, type VisitBillOut } from '../../api/bill'
import { useMe } from '../../api/queries'
import { formatIst, formatPaise, istToday } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { IconPrinter } from '../icons'
import { AddBillLineModal } from './AddBillLineModal'
import { BillLineActionModal } from './BillLineActionModal'
import { FeeCorrectionModal } from './FeeCorrectionModal'

const SECTION_ORDER = [
  { category: 'CONSULTATION', title: 'Consultation' },
  { category: 'PROCEDURE', title: 'Procedures / Services' },
  { category: 'PACKAGE', title: 'Treatment Packages' },
  { category: 'MEDICINE', title: 'Medicines' },
  { category: 'ADDITIONAL', title: 'Additional Particulars' },
] as const

export interface BillPanelProps {
  visitId: number
  /** Amount in paise being entered in the payment form (defaults to 0). */
  payingNowPaise?: number
  canCollect?: boolean
  onCollectDue?: (due: PreviousDueOut) => void
  onReprint?: (paymentId: number) => void
  /** Optional pre-loaded bill (e.g. for testing or external state). */
  initialBill?: VisitBillOut
  /** Optional current user override for testing or parent passthrough */
  currentUser?: { id?: number; username?: string; permissions?: string[] }
}

export function BillPanel({
  visitId,
  payingNowPaise = 0,
  canCollect = false,
  onCollectDue,
  onReprint,
  initialBill,
  currentUser,
}: BillPanelProps) {
  const qc = useQueryClient()
  const { data: meFromQuery } = useMe()
  const me = currentUser ?? meFromQuery
  const permissions = me?.permissions ?? []
  const hasBillWrite = permissions.includes('bill:write')
  const hasBillAdjust = permissions.includes('bill:adjust')

  const { data: fetchedBill, isPending, error } = useVisitBill(initialBill ? null : visitId)
  const bill = initialBill ?? fetchedBill

  // Modals state
  const [addLineOpen, setAddLineOpen] = useState(false)
  const [addLineMode, setAddLineMode] = useState<'medicine' | 'particular'>('medicine')

  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [actionModalMode, setActionModalMode] = useState<'void' | 'correct'>('void')
  const [actionAdmin, setActionAdmin] = useState(false)
  const [selectedActionLine, setSelectedActionLine] = useState<BillLineOut | null>(null)

  const [feeCorrectionOpen, setFeeCorrectionOpen] = useState(false)
  const [selectedFeeLine, setSelectedFeeLine] = useState<BillLineOut | null>(null)

  if (!initialBill && isPending) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-xs text-slate-500 shadow-xs">
        Loading bill...
      </div>
    )
  }

  if (!bill && error) {
    return (
      <InlineAlert tone="error" className="my-2">
        {error instanceof Error ? error.message : 'Could not load the bill.'}
      </InlineAlert>
    )
  }

  if (!bill) {
    return null
  }

  const isLocked = bill.locked || Boolean(bill.closed_at)
  const totalActiveLines = bill.sections.reduce((sum, s) => sum + s.lines.length, 0)
  const safePayingNow = Math.max(0, payingNowPaise)
  const remainingOnVisit = Math.max(0, bill.due_paise - safePayingNow)
  const totalOutstanding = remainingOnVisit + bill.previous_dues_total_paise
  const discountsPaise = bill.sections.reduce(
    (sum, section) =>
      sum +
      section.lines.reduce((lineSum, line) => {
        if (
          line.status !== 'ACTIVE' ||
          !line.counts_toward_total ||
          !line.history?.some((h) => h.kind === 'DISCOUNT' || h.kind === 'WAIVER')
        ) {
          return lineSum
        }
        return lineSum + Math.max(0, (line.original_amount_paise ?? line.amount_paise) - line.amount_paise)
      }, 0),
    0,
  )

  const isOwnSameDay = (line: BillLineOut) => {
    if (line.source !== 'RECEPTION') return false
    const matchesUser =
      (me?.id != null && line.created_by_user_id === me.id) ||
      (me?.username != null && line.created_by_username === me.username)
    if (!matchesUser) return false
    try {
      return istToday(new Date(line.created_at)) === istToday()
    } catch {
      return false
    }
  }

  return (
    <div className="space-y-5">
      {/* Locked notice (OD-22-18, Copywriting) */}
      {isLocked && bill.closed_at && (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"
        >
          Visit closed on {formatIst(bill.closed_at)}. The bill is locked.
        </div>
      )}

      {/* Checkout Summary Strip */}
      <section
        data-testid="checkout-summary-strip"
        aria-label="Checkout summary"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
      >
        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-xs">
          <p className="text-xs font-semibold text-slate-600">Bill Total</p>
          <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900">
            {formatPaise(bill.bill_total_paise)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-xs">
          <div className="flex items-baseline justify-between gap-1">
            <p className="text-xs font-semibold text-slate-600">Discounts</p>
            {discountsPaise > 0 && (
              <span className="text-xs font-medium text-emerald-800">included</span>
            )}
          </div>
          <p
            className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
              discountsPaise > 0 ? 'text-emerald-800' : 'text-slate-900'
            }`}
          >
            {formatPaise(discountsPaise)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-xs">
          <p className="text-xs font-semibold text-slate-600">Paid</p>
          <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-emerald-800">
            {formatPaise(bill.paid_paise)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-xs">
          <p className="text-xs font-semibold text-slate-600">Balance Due</p>
          <p
            className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
              bill.due_paise > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {formatPaise(bill.due_paise)}
          </p>
        </div>
      </section>

      {/* Bill sections card */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-900">Visit Bill</h3>
        </div>

        {totalActiveLines === 0 && (
          <p className="text-xs text-slate-600">No charges on this visit yet.</p>
        )}

        <div className="space-y-4">
          {SECTION_ORDER.map(({ category, title }) => {
            const section = bill.sections.find((s) => s.category === category)
            const subtotal = section?.subtotal_paise ?? 0
            const lines = section?.lines ?? []

            return (
              <div key={category} className="space-y-2">
                <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
                  <h4 className="text-xs font-bold text-slate-700">
                    {title}
                  </h4>
                  <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                    {formatPaise(subtotal)}
                  </span>
                </div>

                {lines.length > 0 && (
                  <ul className="divide-y divide-slate-100">
                    {lines.map((line) => {
                      const isSystem = line.source === 'SYSTEM'
                      const isDoctor = line.source === 'DOCTOR'
                      const isConsultation = line.category === 'CONSULTATION'
                      const canAdjustFee =
                        isConsultation && hasBillAdjust && !isLocked && Boolean(line.appointment_id)

                      const canAdminAction =
                        !isConsultation && line.status === 'ACTIVE' && hasBillAdjust && !isLocked
                      const canReceptionAction =
                        !isConsultation &&
                        line.status === 'ACTIVE' &&
                        !hasBillAdjust &&
                        hasBillWrite &&
                        !isLocked &&
                        isOwnSameDay(line)
                      const showLineActions = canAdminAction || canReceptionAction

                      return (
                        <li key={line.id} className="py-2 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-slate-900">
                                {line.description}
                              </span>
                              {isSystem ? (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                                  Fee as billed at check-in
                                </span>
                              ) : isDoctor ? (
                                <span className="rounded bg-consult-100 px-2 py-0.5 text-xs font-bold text-consult-800">
                                  Doctor
                                </span>
                              ) : (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                                  Reception
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-mono text-xs font-bold tabular-nums text-slate-900">
                                {line.quantity} × {formatPaise(line.rate_paise)} = {formatPaise(line.amount_paise)}
                              </div>
                              {canAdjustFee && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedFeeLine(line)
                                    setFeeCorrectionOpen(true)
                                  }}
                                  className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                                >
                                  Adjust fee
                                </button>
                              )}
                              {showLineActions && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedActionLine(line)
                                      setActionAdmin(canAdminAction)
                                      setActionModalMode('correct')
                                      setActionModalOpen(true)
                                    }}
                                    className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                                  >
                                    Change quantity
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedActionLine(line)
                                      setActionAdmin(canAdminAction)
                                      setActionModalMode('void')
                                      setActionModalOpen(true)
                                    }}
                                    className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 shadow-2xs hover:bg-red-50"
                                  >
                                    Void
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Adjusted lines history (OD-22-15, FEE-09) */}
                          {line.history && line.history.length > 0 && (
                            <div className="space-y-0.5 pl-2 border-l-2 border-amber-300">
                              {line.history.map((hist) => {
                                const actor = hist.actor_username || hist.actor || 'staff'
                                const time = formatIst(hist.created_at)
                                return (
                                  <p key={hist.id} className="text-xs text-slate-600">
                                    Changed from {formatPaise(hist.old_amount_paise)} · {hist.reason} · {actor} · {time}
                                  </p>
                                )
                              })}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* Section footers: Add medicine / Add particular (MED-02, BILL-05) */}
                {category === 'MEDICINE' && !isLocked && hasBillWrite && (
                  <div className="pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setAddLineMode('medicine')
                        setAddLineOpen(true)
                      }}
                      className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                    >
                      Add medicine
                    </button>
                  </div>
                )}

                {category === 'ADDITIONAL' && !isLocked && hasBillWrite && (
                  <div className="pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setAddLineMode('particular')
                        setAddLineOpen(true)
                      }}
                      className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                    >
                      Add particular
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Voided lines disclosure (OD-G, PROPOSED) */}
        {bill.voided_lines && bill.voided_lines.length > 0 && (
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <summary className="cursor-pointer font-bold select-none text-slate-800">
              Voided lines ({bill.voided_lines.length})
            </summary>
            <ul className="mt-2 space-y-2 divide-y divide-slate-200/60 pt-1">
              {bill.voided_lines.map((v) => {
                const staff = v.voided_by_username || v.staff || 'staff'
                const voidTime = formatIst(v.voided_at || v.created_at)
                return (
                  <li key={v.id} className="pt-1.5 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold line-through text-slate-600">{v.description}</span>
                      <span className="font-mono tabular-nums line-through text-slate-600">
                        {v.quantity} × {formatPaise(v.rate_paise)} = {formatPaise(v.amount_paise)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {v.void_reason ?? 'Voided'} · {staff} · {voidTime}
                    </p>
                  </li>
                )
              })}
            </ul>
          </details>
        )}
      </section>

      {/* Totals block in exact order (UI-SPEC S4 §7) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
        <h3 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-2">
          Totals &amp; Settlement
        </h3>
        <div className="space-y-2">
          {/* 1. Bill total */}
          <div className="flex items-center justify-between text-sm">
            <span className="font-normal text-slate-700">Bill total</span>
            <span className="font-mono text-base font-bold tabular-nums text-slate-900">
              {formatPaise(bill.bill_total_paise)}
            </span>
          </div>

          {discountsPaise > 0 && (
            <div className="flex items-center justify-between text-xs text-emerald-800">
              <span className="font-medium">Discounts applied (included above)</span>
              <span className="font-mono font-bold tabular-nums">{formatPaise(discountsPaise)}</span>
            </div>
          )}

          {/* 2. Paid earlier */}
          <div className="flex items-center justify-between text-sm">
            <span className="font-normal text-slate-700">Paid earlier</span>
            <span className="font-mono text-base font-bold tabular-nums text-emerald-800">
              {formatPaise(bill.paid_paise)}
            </span>
          </div>

          {/* 3. Paying now */}
          <div className="flex items-center justify-between text-sm">
            <span className="font-normal text-slate-700">Paying now</span>
            <span className="font-mono text-base font-bold tabular-nums text-emerald-800">
              {formatPaise(safePayingNow)}
            </span>
          </div>

          {/* 4. Remaining on this visit */}
          <div className="flex items-center justify-between text-sm">
            <span className="font-normal text-slate-700">Remaining on this visit</span>
            <span className="font-mono text-base font-bold tabular-nums text-slate-900">
              {formatPaise(remainingOnVisit)}
            </span>
          </div>

          {/* 5. Previous dues (separate line) */}
          <div className="flex items-center justify-between text-sm">
            <span className="font-normal text-slate-700">Previous dues</span>
            <span className="font-mono text-base font-bold tabular-nums text-red-700">
              {formatPaise(bill.previous_dues_total_paise)}
            </span>
          </div>

          {/* 6. Total outstanding */}
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
            <div>
              <span className="font-bold text-slate-900">Total outstanding</span>
              <span className="block text-xs font-normal text-slate-500">
                (remaining + previous dues)
              </span>
            </div>
            <span className="font-mono text-base font-bold tabular-nums text-red-700">
              {formatPaise(totalOutstanding)}
            </span>
          </div>
        </div>
      </section>

      {/* Previous dues card (OD-22-17, LED-01, LED-02) */}
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900">Previous dues (separate ledger)</h3>
        {bill.previous_dues.length === 0 ? (
          <p className="text-xs text-slate-600">No previous dues</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {bill.previous_dues.map((due) => (
              <li
                key={due.visit_id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div>
                  <p className="font-mono text-xs font-bold text-slate-900">
                    Visit {due.visit_date}
                  </p>
                  <p className="text-xs text-slate-600">
                    {due.doctor_names.length > 0 ? due.doctor_names.join(', ') : 'Doctor consultation'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold tabular-nums text-red-700">
                    {formatPaise(due.balance_paise)}
                  </span>
                  {canCollect && onCollectDue && (
                    <button
                      type="button"
                      onClick={() => onCollectDue(due)}
                      className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                    >
                      Collect previous dues
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Packages card (OD-C, LED-03..07) */}
      {bill.packages && bill.packages.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900">Treatment Packages</h3>
          <ul className="divide-y divide-slate-100">
            {bill.packages.map((pkg) => (
              <li key={pkg.treatment_plan_id} className="py-2.5 space-y-1 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">{pkg.plan_name}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                    {pkg.status}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  {pkg.completed_sessions} of {pkg.total_sessions} sessions completed ({pkg.remaining_sessions} remaining)
                </p>
                <div className="flex flex-wrap gap-4 text-xs font-mono text-slate-700">
                  <span>Agreed: {formatPaise(pkg.agreed_price_paise)}</span>
                  <span>Paid: {formatPaise(pkg.paid_paise)}</span>
                  <span className="font-bold text-red-700">Balance: {formatPaise(pkg.balance_paise)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Payments history list (W3) */}
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900">Payments on this visit</h3>
        {bill.payments.length === 0 ? (
          <p className="text-xs text-slate-600">No payments recorded on this visit yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Receipt #</th>
                  <th className="px-3 py-2">Time (IST)</th>
                  <th className="px-3 py-2 text-center">Mode</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  {onReprint && <th className="px-3 py-2 text-right">Receipt</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {bill.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">{p.receipt_number}</td>
                    <td className="px-3 py-2 text-slate-600">{formatIst(p.created_at)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-700">
                        {p.payment_method}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-emerald-800">
                      {formatPaise(p.amount_paise)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.is_reversed ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-800">
                          Reversed
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                          Active
                        </span>
                      )}
                    </td>
                    {onReprint && (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onReprint(p.id)}
                          className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                        >
                          <IconPrinter className="h-3.5 w-3.5 text-slate-500" />
                          Print
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modals for line actions and fee corrections */}
      <AddBillLineModal
        open={addLineOpen}
        onClose={() => setAddLineOpen(false)}
        visitId={visitId}
        mode={addLineMode}
      />

      <BillLineActionModal
        open={actionModalOpen}
        onClose={() => {
          setActionModalOpen(false)
          setSelectedActionLine(null)
        }}
        visitId={visitId}
        line={selectedActionLine}
        mode={actionModalMode}
        isAdmin={actionAdmin}
        onReload={() => qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })}
      />

      {selectedFeeLine && selectedFeeLine.appointment_id && (
        <FeeCorrectionModal
          open={feeCorrectionOpen}
          onClose={() => {
            setFeeCorrectionOpen(false)
            setSelectedFeeLine(null)
          }}
          visitId={visitId}
          appointmentId={selectedFeeLine.appointment_id}
          currentAmountPaise={selectedFeeLine.amount_paise}
          onReload={() => qc.invalidateQueries({ queryKey: ['visit-bill', visitId] })}
        />
      )}
    </div>
  )
}
