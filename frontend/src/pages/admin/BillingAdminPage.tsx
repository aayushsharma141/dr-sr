import { useState, type FormEvent } from 'react'
import { useBillingConfiguration, useLedger, useMe, type LedgerFilter } from '../../api/queries'
import type { PaymentOut } from '../../api/types'
import { AppShell } from '../../components/AppShell'
import { InlineAlert } from '../../components/InlineAlert'
import { PaymentReversalModal } from '../../components/PaymentReversalModal'

// Admin module 06. Shows how billing works today and gives administrators the reversal screen.
// Payment methods, receipt format and reversal authority are not editable: they await the client.

const CYCLE_LABEL: Record<string, string> = {
  FINANCIAL_YEAR: 'Financial year (April to March)',
  CALENDAR_YEAR: 'Calendar year (January to December)',
}

const STATUS_OPTIONS: { value: LedgerFilter['status']; label: string }[] = [
  { value: 'all', label: 'All payments' },
  { value: 'active', label: 'Active payments' },
  { value: 'reversed', label: 'Reversed payments' },
]

const CARD = 'rounded-lg border border-slate-200 bg-white p-5 shadow-xs'
const HEAD = 'px-3 py-2 text-left text-sm font-semibold text-slate-700'
const CELL = 'px-3 py-2 text-sm text-slate-800'
const INPUT =
  'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 min-h-11 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]'

/** Integer-paise formatting: no floating-point division of money (BIL-02). */
function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100).toLocaleString('en-IN')
  return `₹${rupees}.${String(paise % 100).padStart(2, '0')}`
}

function formatIst(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-sm text-slate-700">{label}</dt>
      <dd className="text-base font-semibold text-slate-900">{value}</dd>
    </div>
  )
}

function ConfigurationSection() {
  const { data, isPending, isError, error } = useBillingConfiguration()
  return (
    <section aria-labelledby="billing-config-heading" className={CARD}>
      <h2 id="billing-config-heading" className="text-base font-bold text-slate-900">
        Billing rules in force
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        Read-only. The numbering cycle is set in Clinic Settings; the other rules are fixed until the client decides.
      </p>
      {isPending && <p role="status" className="mt-3 text-sm text-slate-700">Loading billing rules...</p>}
      {isError && (
        <InlineAlert tone="error" className="mt-3">
          Could not load billing rules: {error.message}
        </InlineAlert>
      )}
      {data && (
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label="Receipt numbering cycle" value={CYCLE_LABEL[data.receipt_sequence_cycle] ?? data.receipt_sequence_cycle} />
          <Fact label="Current cycle" value={data.current_cycle_key} />
          <Fact label="Receipts issued this cycle" value={String(data.receipts_issued_in_cycle)} />
          <Fact label="Next receipt number" value={data.next_receipt_number} />
          <Fact label="Payment methods" value={data.payment_methods.join(', ')} />
          <Fact label="Who can reverse a payment" value={data.reversal_roles.join(', ')} />
        </dl>
      )}
    </section>
  )
}

function LedgerRow({ payment, onReverse }: { payment: PaymentOut; onReverse: (p: PaymentOut) => void }) {
  return (
    <tr>
      <td className={`${CELL} font-mono`}>{payment.receipt_number}</td>
      <td className={CELL}>{formatIst(payment.created_at)}</td>
      <td className={CELL}>
        {payment.patient_name}
        <span className="block font-mono text-sm text-slate-700">{payment.patient_urn}</span>
      </td>
      <td className={`${CELL} text-right whitespace-nowrap`}>{formatPaise(payment.amount_paise)}</td>
      <td className={CELL}>{payment.payment_method}</td>
      <td className={CELL}>
        {payment.is_reversed ? (
          <>
            Reversed
            <span className="block text-sm text-slate-700">
              {payment.reversal_reason} ({payment.reversed_by_username}
              {payment.reversed_at ? `, ${formatIst(payment.reversed_at)}` : ''})
            </span>
          </>
        ) : (
          'Paid'
        )}
      </td>
      <td className={`${CELL} text-right`}>
        {!payment.is_reversed && (
          <button
            type="button"
            aria-label={`Reverse receipt ${payment.receipt_number}`}
            onClick={() => onReverse(payment)}
            className="min-h-11 rounded border border-red-800 px-3 font-medium text-red-900 hover:bg-red-50"
          >
            Reverse
          </button>
        )}
      </td>
    </tr>
  )
}

function LedgerSection() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<LedgerFilter>({ q: '', status: 'all' })
  const [reversing, setReversing] = useState<PaymentOut | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { data, isPending, isError, error } = useLedger(filter)

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    setFilter((f) => ({ ...f, q: search.trim() }))
  }

  return (
    <section aria-labelledby="billing-ledger-heading" className={CARD}>
      <h2 id="billing-ledger-heading" className="text-base font-bold text-slate-900">
        Payments and reversals
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        A reversal keeps the original receipt, records the reason and returns the amount to the patient's dues.
      </p>
      {notice && (
        <InlineAlert tone="success" className="mt-3" onDismiss={() => setNotice(null)}>
          {notice}
        </InlineAlert>
      )}
      <form onSubmit={handleSearch} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_14rem_auto] md:items-end">
        <div>
          <label htmlFor="ledger-search" className="text-sm font-semibold text-slate-800">
            Receipt number, URN or patient name
          </label>
          <input id="ledger-search" type="search" value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="ledger-status" className="text-sm font-semibold text-slate-800">Show</label>
          <select
            id="ledger-status"
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as LedgerFilter['status'] }))}
            className={INPUT}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-lg bg-[#8E1C3D] px-4 text-sm font-semibold text-white hover:bg-[#5D0B26]">
          Search
        </button>
      </form>
      {isPending && <p role="status" className="mt-3 text-sm text-slate-700">Loading payments...</p>}
      {isError && (
        <InlineAlert tone="error" className="mt-3">
          Could not load payments: {error.message}
        </InlineAlert>
      )}
      {data && data.length === 0 && <p className="mt-3 text-sm text-slate-700">No payments match this search.</p>}
      {data && data.length > 0 && (
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className={HEAD}>Receipt</th>
                <th scope="col" className={HEAD}>Date</th>
                <th scope="col" className={HEAD}>Patient</th>
                <th scope="col" className={`${HEAD} text-right`}>Amount</th>
                <th scope="col" className={HEAD}>Method</th>
                <th scope="col" className={HEAD}>Status</th>
                <th scope="col" className={HEAD}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((p) => (
                <LedgerRow key={p.id} payment={p} onReverse={setReversing} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaymentReversalModal
        isOpen={reversing !== null}
        payment={reversing}
        onClose={() => setReversing(null)}
        onSuccess={(p) => setNotice(`Receipt ${p.receipt_number} was reversed.`)}
      />
    </section>
  )
}

export function BillingAdminPage() {
  const { data: me } = useMe()
  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Billing & Financial</h1>
          <p className="mt-1 text-sm text-slate-700">Receipt rules, payment search and authorised reversals.</p>
        </div>
        <ConfigurationSection />
        <LedgerSection />
      </div>
    </AppShell>
  )
}
