import { useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { SessionLoggerModal } from '../components/SessionLoggerModal'
import { SessionAddendumModal } from '../components/SessionAddendumModal'
import { Modal } from '../components/Modal'
import { VasTrendChart } from '../components/VasTrendChart'
import {
  usePatient,
  usePatientTreatmentPlans,
  useTreatmentPlan,
  useTreatmentSessions,
  useCreateTreatmentPlan,
  useUpdateTreatmentPlan,
  useMe,
} from '../api/queries'
import type { TreatmentPlanOut, TreatmentSessionOut } from '../api/types'

export function TreatmentPlanWorkspace() {
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const { data: me } = useMe()

  const routePlanId = id ? Number(id) : 0
  const paramPatientId = searchParams.get('patient_id')
    ? Number(searchParams.get('patient_id'))
    : null

  // If specific plan ID loaded from route
  const { data: routePlan } = useTreatmentPlan(routePlanId)

  // Resolve target patient ID
  const effectivePatientId = routePlan?.patient_id || paramPatientId || 0
  const { data: patient } = usePatient(effectivePatientId)
  const { data: patientPlans, refetch: refetchPlans } = usePatientTreatmentPlans(effectivePatientId)

  // Determine active plan to display
  const activePlan: TreatmentPlanOut | undefined =
    routePlan ||
    patientPlans?.find((p) => p.status === 'ACTIVE') ||
    (patientPlans && patientPlans.length > 0 ? patientPlans[0] : undefined)

  // Load sessions for active plan
  const activePlanId = activePlan?.id || 0
  const { data: sessions, refetch: refetchSessions } = useTreatmentSessions(activePlanId)

  // Mutations
  const createPlanMutation = useCreateTreatmentPlan()
  const updatePlanMutation = useUpdateTreatmentPlan()

  // Modal / Interaction states
  const [showNewPlanModal, setShowNewPlanModal] = useState(false)
  const [showLogSessionModal, setShowLogSessionModal] = useState(false)
  const [activeAddendumSession, setActiveAddendumSession] = useState<TreatmentSessionOut | null>(null)
  const [showCancelPlanModal, setShowCancelPlanModal] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // New Plan Form State
  const [newPlanName, setNewPlanName] = useState('Physiotherapy Rehabilitation Package')
  const [newDiagnosis, setNewDiagnosis] = useState('')
  const [newReferredBy, setNewReferredBy] = useState('')
  const [newTotalSessions, setNewTotalSessions] = useState(10)
  const [newPriceRupees, setNewPriceRupees] = useState(5000)

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!effectivePatientId) {
      setErrorMessage('Patient ID is required.')
      return
    }

    if (!newDiagnosis.trim()) {
      setErrorMessage('Condition diagnosis is required.')
      return
    }

    try {
      await createPlanMutation.mutateAsync({
        patient_id: effectivePatientId,
        plan_name: newPlanName.trim(),
        condition_diagnosis: newDiagnosis.trim(),
        referred_by: newReferredBy.trim() || null,
        total_sessions: Number(newTotalSessions),
        agreed_price_paise: Math.round(Number(newPriceRupees) * 100),
      })
      setShowNewPlanModal(false)
      setSuccessMessage('New treatment package created successfully!')
      refetchPlans()
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create treatment package.')
    }
  }

  const handleConfirmCancelPlan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePlan) return
    setErrorMessage(null)

    if (!cancellationReason.trim() || cancellationReason.trim().length < 3) {
      setErrorMessage('Cancellation reason must be at least 3 characters.')
      return
    }

    try {
      await updatePlanMutation.mutateAsync({
        id: activePlan.id,
        body: {
          version_id: activePlan.version_id,
          status: 'CANCELLED',
          cancellation_reason: cancellationReason.trim(),
        },
      })
      setShowCancelPlanModal(false)
      setCancellationReason('')
      setSuccessMessage('Treatment package has been cancelled.')
      refetchPlans()
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to cancel treatment plan.')
    }
  }

  const completionPercent = activePlan
    ? Math.min(100, Math.round((activePlan.completed_sessions / activePlan.total_sessions) * 100))
    : 0

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      {/* Session Logger Modal */}
      {showLogSessionModal && activePlan && (
        <SessionLoggerModal
          plan={activePlan}
          onClose={() => setShowLogSessionModal(false)}
          onSuccess={() => {
            setSuccessMessage('Session logged successfully!')
            refetchSessions()
            refetchPlans()
          }}
        />
      )}

      {/* Session Addendum Modal */}
      {activeAddendumSession && (
        <SessionAddendumModal
          session={activeAddendumSession}
          onClose={() => setActiveAddendumSession(null)}
          onSuccess={() => {
            setSuccessMessage('Dated addendum attached successfully!')
            refetchSessions()
          }}
        />
      )}

      {/* Cancel Plan Modal */}
      {showCancelPlanModal && activePlan && (
        <Modal
          open
          variant="destructive"
          title="Cancel Treatment Package?"
          onClose={() => setShowCancelPlanModal(false)}
          busy={updatePlanMutation.isPending}
          className="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-xs text-gray-600">
              Please state the clinical or administrative reason for discontinuing this package early.
            </p>
            <form onSubmit={handleConfirmCancelPlan} className="space-y-4">
              <div>
                <label htmlFor="cancel-reason" className="block text-xs font-semibold text-gray-700 mb-1">
                  Reason for Cancellation *
                </label>
                <textarea
                  id="cancel-reason"
                  required
                  rows={3}
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  placeholder="e.g. Patient improved completely, surgery scheduled, or patient relocated..."
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-red-600 focus:ring-1 focus:ring-red-600"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  data-autofocus
                  onClick={() => setShowCancelPlanModal(false)}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Keep Active
                </button>
                <button
                  type="submit"
                  disabled={updatePlanMutation.isPending}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg shadow transition"
                >
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Create New Plan Modal */}
      {showNewPlanModal && (
        <Modal
          open
          onClose={() => setShowNewPlanModal(false)}
          title="New Physiotherapy Treatment Package"
          description="Define multi-session package terms and agreed fee"
          className="max-w-lg"
        >
          <div className="space-y-4">

            <form onSubmit={handleCreatePlan} className="space-y-4">
              <div>
                <label htmlFor="plan-name" className="block text-xs font-semibold text-gray-700 mb-1">
                  Package Name *
                </label>
                <input
                  id="plan-name"
                  data-autofocus
                  type="text"
                  required
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="plan-diag" className="block text-xs font-semibold text-gray-700 mb-1">
                  Condition / Diagnosis *
                </label>
                <input
                  id="plan-diag"
                  type="text"
                  required
                  value={newDiagnosis}
                  onChange={(e) => setNewDiagnosis(e.target.value)}
                  placeholder="e.g. Lumbar Spondylolisthesis Grade I"
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="plan-ref" className="block text-xs font-semibold text-gray-700 mb-1">
                  Referred By (Optional)
                </label>
                <input
                  id="plan-ref"
                  type="text"
                  value={newReferredBy}
                  onChange={(e) => setNewReferredBy(e.target.value)}
                  placeholder="e.g. Self / Dr. S. K. Sinha"
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="plan-sessions" className="block text-xs font-semibold text-gray-700 mb-1">
                    Total Sessions (1–200) *
                  </label>
                  <input
                    id="plan-sessions"
                    type="number"
                    min={1}
                    max={200}
                    required
                    value={newTotalSessions}
                    onChange={(e) => setNewTotalSessions(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="plan-price" className="block text-xs font-semibold text-gray-700 mb-1">
                    Agreed Fee (₹ INR) *
                  </label>
                  <input
                    id="plan-price"
                    type="number"
                    min={0}
                    required
                    value={newPriceRupees}
                    onChange={(e) => setNewPriceRupees(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowNewPlanModal(false)}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createPlanMutation.isPending}
                  className="px-5 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow transition"
                >
                  Create Package
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3">
            <Link
              to="/doctor"
              className="text-sm font-medium text-teal-700 hover:text-teal-900 flex items-center gap-1"
            >
              ← Back to Queue
            </Link>
            <span className="text-gray-600">|</span>
            <span className="text-sm font-semibold text-gray-700">Patient:</span>
            {patient ? (
              <span className="font-bold text-gray-900">
                {patient.full_name} ({patient.urn}) · {patient.age_years}y / {patient.gender}
              </span>
            ) : (
              <span className="text-sm text-gray-500 italic">No patient selected</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {effectivePatientId > 0 && (
              <button
                type="button"
                onClick={() => setShowNewPlanModal(true)}
                className="text-xs font-semibold bg-teal-50 text-teal-800 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200 transition"
              >
                + New Package (+ नया पैकेज)
              </button>
            )}
          </div>
        </div>

        {/* Notifications */}
        {errorMessage && (
          <div role="alert" className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div role="status" className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            {successMessage}
          </div>
        )}

        {/* Active Treatment Package Overview Card */}
        {activePlan ? (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-900">{activePlan.plan_name}</h2>
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                      activePlan.status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : activePlan.status === 'COMPLETED'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-gray-100 text-gray-700 border-gray-300'
                    }`}
                  >
                    {activePlan.status}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Condition: <span className="font-semibold text-gray-800">{activePlan.condition_diagnosis}</span>
                  {activePlan.referred_by && ` · Ref: ${activePlan.referred_by}`}
                </p>
              </div>

              <div className="text-right">
                <span className="text-xs text-gray-500 block">Agreed Fee</span>
                <span className="text-lg font-bold text-gray-900 font-mono">
                  ₹{(activePlan.agreed_price_paise / 100).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Progress Gauge */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm font-semibold">
                <span className="text-gray-700">Package Progress:</span>
                <span className="font-mono text-teal-900">
                  {activePlan.completed_sessions} of {activePlan.total_sessions} Sessions Completed ({completionPercent}%)
                </span>
              </div>
              <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden border border-gray-200">
                <div
                  className="bg-teal-700 h-full rounded-full transition-all duration-500"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap justify-between items-center gap-3 pt-2">
              <div className="flex gap-2">
                {activePlan.status === 'ACTIVE' && activePlan.completed_sessions < activePlan.total_sessions && (
                  <button
                    type="button"
                    onClick={() => setShowLogSessionModal(true)}
                    className="px-5 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow transition flex items-center gap-1.5"
                  >
                    ⚡ Log Session #{activePlan.completed_sessions + 1}
                  </button>
                )}

                {activePlan.status === 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={() => setShowCancelPlanModal(true)}
                    className="px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition"
                  >
                    Cancel Package
                  </button>
                )}
              </div>

              {activePlan.status === 'COMPLETED' && (
                <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                  ✓ All {activePlan.total_sessions} planned sessions completed
                </span>
              )}

              {activePlan.cancellation_reason && (
                <div className="text-xs text-red-700 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
                  Cancelled: {activePlan.cancellation_reason}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center space-y-3">
            <p className="text-gray-500 text-sm">No active treatment package found for this patient.</p>
            {effectivePatientId > 0 && (
              <button
                type="button"
                onClick={() => setShowNewPlanModal(true)}
                className="px-5 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow transition"
              >
                Create New Treatment Package
              </button>
            )}
          </div>
        )}

        {/* VAS Pain Trend Chart */}
        {sessions && sessions.length > 0 && (
          <VasTrendChart sessions={sessions} />
        )}

        {/* Chronological Sessions Log Table */}
        {sessions && sessions.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-base font-bold text-gray-900">
                Session History & Treatment Records ({sessions.length})
              </h3>
              <span className="text-xs text-gray-500 font-mono">Immutable audit records</span>
            </div>

            <div className="space-y-4">
              {sessions.map((sess) => (
                <div
                  key={sess.id}
                  className="rounded-lg border border-gray-200 p-4 space-y-3 bg-gray-50/40 hover:bg-gray-50 transition"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white bg-teal-800 px-2.5 py-0.5 rounded-full">
                        Session #{sess.session_number}
                      </span>
                      <span className="text-xs text-gray-500 font-medium">
                        {new Date(sess.session_date).toLocaleDateString('en-IN')}
                      </span>
                      <span className="text-xs text-gray-600 font-semibold">· Dr. {sess.doctor_name}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                        VAS: {sess.vas_score}/10
                      </span>
                      <span className="text-sm font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        🔒 Finalised
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveAddendumSession(sess)}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-900 ml-2"
                      >
                        + Addendum
                      </button>
                    </div>
                  </div>

                  {/* Modalities Chips */}
                  {sess.modalities && sess.modalities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {sess.modalities.map((mod) => (
                        <span
                          key={mod}
                          className="text-sm font-medium bg-teal-50 text-teal-800 px-2 py-0.5 rounded border border-teal-200"
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  <p className="text-xs text-gray-800 whitespace-pre-wrap">{sess.clinical_notes}</p>

                  {/* Addenda Section */}
                  {sess.addenda && sess.addenda.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      <span className="text-sm font-bold uppercase tracking-wider text-amber-800 block">
                        Addenda ({sess.addenda.length})
                      </span>
                      {sess.addenda.map((ad, idx) => (
                        <div
                          key={ad.id}
                          className="bg-amber-50/60 border border-amber-200 rounded p-2 text-xs text-gray-800 space-y-0.5"
                        >
                          <div className="flex justify-between text-[10px] text-amber-900 font-semibold">
                            <span>#{idx + 1} By {ad.author_name}</span>
                            <span className="font-mono">{new Date(ad.created_at).toLocaleString('en-IN')}</span>
                          </div>
                          <p>{ad.note}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Other Packages for Patient */}
        {patientPlans && patientPlans.length > 1 && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">
              Other Treatment Packages ({patientPlans.length})
            </h3>
            <div className="divide-y divide-gray-200">
              {patientPlans.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-gray-900">{p.plan_name}</span>
                    <span className="text-gray-500 ml-2">
                      ({p.completed_sessions}/{p.total_sessions} sessions)
                    </span>
                    <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-700">
                      {p.status}
                    </span>
                  </div>
                  <Link
                    to={`/doctor/treatment-plans/${p.id}`}
                    className="text-teal-700 hover:text-teal-900 font-semibold"
                  >
                    Switch View
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

