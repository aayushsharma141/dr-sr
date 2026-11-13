import React, { useState } from 'react'
import { usePendingDues, useMe } from '../api/queries'
import type { PendingDueOut } from '../api/types'
import { PaymentModal } from '../components/PaymentModal'
import { AppShell } from '../components/AppShell'
import { AdminPageHeader } from '../components/admin/AdminPageHeader'

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
  const totalDuesRupees = (totalDuesPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <AppShell name={me?.full_name ?? 'Staff'} role={me?.role ?? 'RECEPTION'}>
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <AdminPageHeader
          title="Pending Dues"
          description="Dynamically computed outstanding balances across active treatment packages (BIL-03)."
          actions={
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-2xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                Total Outstanding
              </div>
              <div className="text-xl font-black text-amber-900">
                ₹{totalDuesRupees}
              </div>
            </div>
          }
        />

        {/* Filter Bar */}
        <div className="flex items-center gap-4">
          <input
            type="text"
            aria-label="Search pending dues"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by patient name, URN, or package..."
            className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading pending dues ledger...</div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-600">Failed to load pending dues ledger.</div>
          ) : filteredDues.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No active packages with pending dues found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700">
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
                <tbody className="divide-y divide-slate-200">
                  {filteredDues.map((due, index) => (
                    <tr key={due.treatment_plan_id} className="hover:bg-slate-50/70 transition-colors" style={{ transitionDelay: `${index * 50}ms` }}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{due.patient_name}</div>
                        <div className="font-mono text-xs text-slate-500">{due.patient_urn}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{due.plan_name}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        ₹{(due.agreed_price_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-700">
                        ₹{(due.paid_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-700">
                        ₹{(due.balance_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-center text-xs">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          {due.completed_sessions} / {due.total_sessions}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleCollect(due)}
                          className="min-h-9 cursor-pointer rounded-lg bg-[#8E1C3D] px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[#741732] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8E1C3D]"
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
              condition_diagnosis: selectedDue.condition_diagnosis || '',
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
            maxAmountPaise={selectedDue.balance_paise}
          />
        )}
      </div>
    </AppShell>
  )
}

export default PendingDuesPage
