import React, { useState } from 'react'
import { usePendingDues } from '../api/queries'
import type { PendingDueOut } from '../api/types'
import { PaymentModal } from '../components/PaymentModal'

export const PendingDuesPage: React.FC = () => {
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
  const totalDuesRupees = (totalDuesPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Pending Dues Ledger
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Dynamically computed outstanding balances across active treatment packages (BIL-03).
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200">
            Total Outstanding
          </div>
          <div className="text-xl font-black text-amber-900 dark:text-amber-100">
            ₹{totalDuesRupees}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by patient name, URN, or package..."
          className="max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading pending dues ledger...</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-500">Failed to load pending dues ledger.</div>
        ) : filteredDues.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No active packages with pending dues found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="border-b bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Package Details</th>
                  <th className="px-4 py-3 text-right">Agreed Fee</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-center">Sessions</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredDues.map((due) => (
                  <tr key={due.treatment_plan_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{due.patient_name}</div>
                      <div className="font-mono text-xs text-slate-400">{due.patient_urn}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{due.plan_name}</div>
                      <div className="text-xs text-slate-400">{due.condition_diagnosis || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">
                      ₹{(due.agreed_price_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">
                      ₹{(due.paid_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">
                      ₹{(due.balance_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium dark:bg-slate-800">
                        {due.completed_sessions} / {due.total_sessions}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleCollect(due)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-blue-700"
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
  )
}
export default PendingDuesPage
