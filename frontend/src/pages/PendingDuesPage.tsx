import React, { useState } from 'react'
import { usePendingDues, useMe } from '../api/queries'
import type { PendingDueOut } from '../api/types'
import { PaymentModal } from '../components/PaymentModal'
import { AppShell } from '../components/AppShell'

// Integer-paise formatting: no floating-point division of money (BIL-02).
const formatPaise = (paise: number): string => {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN')
  return `${sign}${rupees}.${String(abs % 100).padStart(2, '0')}`
}

export const PendingDuesPage: React.FC = () => {
  const { data: me } = useMe()
  const { data: dues, isLoading, error } = usePendingDues()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedDue, setSelectedDue] = useState<PendingDueOut | null>(null)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)

  const handleCollect = (due: PendingDueOut) => {
    setSelectedDue(due)
    setIsPaymentModalOpen(true)
  }

  const filteredDues = (dues || []).filter((d) => {
    const q = searchTerm.toLowerCase()
    return (
      d.patient_name.toLowerCase().includes(q) ||
      d.patient_urn.toLowerCase().includes(q) ||
      d.plan_name.toLowerCase().includes(q)
    )
  })

  const totalDuesPaise = filteredDues.reduce((acc, curr) => acc + curr.balance_paise, 0)
  const totalDuesRupees = formatPaise(totalDuesPaise)

  if (!me) {
    return <div className="p-12 text-center text-sm text-slate-600" role="status">Loading...</div>
  }

  return (
    <AppShell name={me.full_name} role={me.role}>
      <div className="space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Pending Dues Ledger
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Dynamically computed outstanding balances across active treatment packages (BIL-03).
            </p>
          </div>
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-3 text-right shadow-xs">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-900">
              Total Outstanding Balance
            </div>
            <div className="text-2xl font-black text-amber-950">
              ₹{totalDuesRupees}
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="relative max-w-md">
            <label htmlFor="dues-search-input" className="sr-only">
              Search by patient name, URN, or package
            </label>
            <input
              id="dues-search-input"
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by patient name, URN, or package..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-slate-600" role="status">
              Loading pending dues ledger...
            </div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-700 bg-red-50 border-b border-red-200" role="alert">
              Failed to load pending dues ledger.
            </div>
          ) : filteredDues.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-600">
              No active packages with pending dues found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700">
                  <tr>
                    <th scope="col" className="px-4 py-3.5">Patient</th>
                    <th scope="col" className="px-4 py-3.5">Package Details</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Agreed Fee</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Paid</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Balance Due</th>
                    <th scope="col" className="px-4 py-3.5 text-center">Sessions</th>
                    <th scope="col" className="px-4 py-3.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredDues.map((due) => (
                    <tr key={due.treatment_plan_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">{due.patient_name}</div>
                        <div className="font-mono text-xs font-medium text-slate-600">{due.patient_urn}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-900">{due.plan_name}</div>
                        <div className="text-xs text-slate-600">{due.condition_diagnosis || '—'}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-slate-900">
                        ₹{formatPaise(due.agreed_price_paise)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-emerald-800">
                        ₹{formatPaise(due.paid_paise)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-red-800">
                        ₹{formatPaise(due.balance_paise)}
                      </td>
                      <td className="px-4 py-3.5 text-center text-xs">
                        <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-800">
                          {due.completed_sessions} / {due.total_sessions}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleCollect(due)}
                          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#5D0B26] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#4A081E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                        >
                          Collect Payment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payment Modal */}
        {selectedDue && (
          <PaymentModal
            isOpen={isPaymentModalOpen}
            onClose={() => {
              setIsPaymentModalOpen(false)
              setSelectedDue(null)
            }}
            patientId={selectedDue.patient_id}
            patientName={selectedDue.patient_name}
            patientUrn={selectedDue.patient_urn}
            treatmentPlan={{
              id: selectedDue.treatment_plan_id,
              patient_id: selectedDue.patient_id,
              patient_urn: selectedDue.patient_urn,
              patient_name: selectedDue.patient_name,
              doctor_id: 0,
              doctor_name: '',
              encounter_id: null,
              plan_name: selectedDue.plan_name,
              condition_diagnosis: selectedDue.condition_diagnosis || "",
              referred_by: null,
              total_sessions: selectedDue.total_sessions,
              completed_sessions: selectedDue.completed_sessions,
              agreed_price_paise: selectedDue.agreed_price_paise,
              status: 'ACTIVE',
              cancellation_reason: null,
              version_id: 1,
              created_at: '',
              updated_at: '',
            }}
            defaultAmountPaise={selectedDue.balance_paise}
          />
        )}
      </div>
    </AppShell>
  )
}
export default PendingDuesPage
