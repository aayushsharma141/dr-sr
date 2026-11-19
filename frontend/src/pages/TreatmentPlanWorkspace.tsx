import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { SessionLoggerModal } from '../components/SessionLoggerModal'
import { SessionAddendumModal } from '../components/SessionAddendumModal'
import { Modal } from '../components/Modal'
import { toast } from '../components/ToastHost'
import { VasTrendChart } from '../components/VasTrendChart'
import { IconSearch } from '../components/icons'
import {
  usePatient,
  usePatients,
  usePatientTreatmentPlans,
  useTreatmentPlans,
  useTreatmentPlan,
  useTreatmentSessions,
  useCreateTreatmentPlan,
  useUpdateTreatmentPlan,
  useMe,
} from '../api/queries'
import type { PatientOut, TreatmentPlanOut, TreatmentSessionOut } from '../api/types'
import { withDoctorTitle } from '../format'

const DEFAULT_PLAN_NAME = 'Physiotherapy Rehabilitation Package'
const DEFAULT_TOTAL_SESSIONS = 10
const DEFAULT_PRICE_RUPEES = 5000

const ROSTER_STATUS_TABS: Array<{ value: 'ACTIVE' | 'COMPLETED' | 'ALL'; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ALL', label: 'All' },
]

export function TreatmentPlanWorkspace() {
  const { id } = useParams<{ id?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: me } = useMe()

  const hasRoutePlanParam = id !== undefined
  const parsedRoutePlanId = hasRoutePlanParam ? Number(id) : 0
  const isInvalidRoutePlanId =
    hasRoutePlanParam && (!Number.isInteger(parsedRoutePlanId) || parsedRoutePlanId <= 0)
  const routePlanId = isInvalidRoutePlanId ? 0 : parsedRoutePlanId

  const rawPatientId = searchParams.get('patient_id')
  const parsedPatientId = rawPatientId ? Number(rawPatientId) : null
  const paramPatientId =
    parsedPatientId !== null && Number.isInteger(parsedPatientId) && parsedPatientId > 0
      ? parsedPatientId
      : null

  const rawEncounterId = searchParams.get('encounter_id')
  const parsedEncounterId = rawEncounterId ? Number(rawEncounterId) : null
  const paramEncounterId =
    parsedEncounterId !== null && Number.isInteger(parsedEncounterId) && parsedEncounterId > 0
      ? parsedEncounterId
      : null

  // If specific plan ID loaded from route
  const {
    data: routePlan,
    isPending: isRoutePlanPending,
    isError: isRoutePlanError,
    error: routePlanError,
  } = useTreatmentPlan(routePlanId)

  const showRoutePlanError = isInvalidRoutePlanId || (routePlanId > 0 && isRoutePlanError)
  const showRoutePlanLoading = routePlanId > 0 && isRoutePlanPending && !isRoutePlanError

  // Directory Patient Search State
  const [patientSearch, setPatientSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [manualPatient, setManualPatient] = useState<PatientOut | null>(null)
  const [rosterStatus, setRosterStatus] = useState<'ACTIVE' | 'COMPLETED' | 'ALL'>('ACTIVE')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(patientSearch.trim())
    }, 250)
    return () => clearTimeout(timer)
  }, [patientSearch])

  const { data: searchResults = [], isPending: isSearching } = usePatients(debouncedSearch, 8)

  // Resolve target patient ID
  const effectivePatientId = showRoutePlanError
    ? 0
    : routePlan?.patient_id || manualPatient?.id || paramPatientId || 0
  const showLaunchpad = effectivePatientId === 0 && !showRoutePlanError && !showRoutePlanLoading

  const {
    data: rosterPlans = [],
    isPending: isRosterPending,
    isError: isRosterError,
    error: rosterError,
    refetch: refetchRoster,
  } = useTreatmentPlans(rosterStatus, showLaunchpad)

  const { data: patient } = usePatient(effectivePatientId)
  const activePatient = patient || manualPatient
  const { data: patientPlans, refetch: refetchPlans } = usePatientTreatmentPlans(effectivePatientId)

  // Determine active plan to display
  const activePlan: TreatmentPlanOut | undefined =
    routePlan ||
    patientPlans?.find((p) => p.status === 'ACTIVE') ||
    (patientPlans && patientPlans.length > 0 ? patientPlans[0] : undefined)

  const isOwnPlan = !activePlan || me?.doctor_id == null || activePlan.doctor_id === me.doctor_id
  const otherPlans = (patientPlans ?? []).filter((p) => p.id !== activePlan?.id)

  // Load sessions for active plan
  const activePlanId = activePlan?.id || 0
  const { data: sessions, refetch: refetchSessions } = useTreatmentSessions(activePlanId)

  // Mutations
  const createPlanMutation = useCreateTreatmentPlan()
  const updatePlanMutation = useUpdateTreatmentPlan()

  // Modal / Interaction states
  const [showNewPlanModal, setShowNewPlanModal] = useState(false)
  const [sessionModalPlan, setSessionModalPlan] = useState<TreatmentPlanOut | null>(null)
  const [activeAddendumSession, setActiveAddendumSession] = useState<TreatmentSessionOut | null>(null)
  const [showCancelPlanModal, setShowCancelPlanModal] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')

  // New Plan Form State
  const [newPlanName, setNewPlanName] = useState(DEFAULT_PLAN_NAME)
  const [newDiagnosis, setNewDiagnosis] = useState('')
  const [newReferredBy, setNewReferredBy] = useState('')
  const [newTotalSessions, setNewTotalSessions] = useState(DEFAULT_TOTAL_SESSIONS)
  const [newPriceRupees, setNewPriceRupees] = useState(DEFAULT_PRICE_RUPEES)

  const resetNewPlanForm = () => {
    setNewPlanName(DEFAULT_PLAN_NAME)
    setNewDiagnosis('')
    setNewReferredBy('')
    setNewTotalSessions(DEFAULT_TOTAL_SESSIONS)
    setNewPriceRupees(DEFAULT_PRICE_RUPEES)
  }

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!effectivePatientId) {
      toast.error('Patient ID is required.')
      return
    }

    if (newPlanName.trim().length < 2) {
      toast.error('Package name must be at least 2 characters.')
      return
    }

    if (newDiagnosis.trim().length < 2) {
      toast.error('Condition diagnosis must be at least 2 characters.')
      return
    }

    try {
      const created = await createPlanMutation.mutateAsync({
        patient_id: effectivePatientId,
        encounter_id: paramEncounterId,
        plan_name: newPlanName.trim(),
        condition_diagnosis: newDiagnosis.trim(),
        referred_by: newReferredBy.trim() || null,
        total_sessions: Number(newTotalSessions),
        agreed_price_paise: Math.round(Number(newPriceRupees) * 100),
      })
      resetNewPlanForm()
      setShowNewPlanModal(false)
      toast.success('New treatment package created successfully!')
      if (effectivePatientId > 0) void refetchPlans()
      navigate(`/doctor/treatment-plans/${created.id}`)
    } catch (err: any) {
      toast.error(err.message || 'Failed to create treatment package.')
    }
  }

  const handleConfirmCancelPlan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePlan) return

    if (!cancellationReason.trim() || cancellationReason.trim().length < 3) {
      toast.error('Cancellation reason must be at least 3 characters.')
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
      toast.success('Treatment package has been cancelled.')
      if (effectivePatientId > 0) void refetchPlans()
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel treatment plan.')
    }
  }

  const completionPercent = activePlan
    ? Math.min(100, Math.round((activePlan.completed_sessions / activePlan.total_sessions) * 100))
    : 0

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      {/* Session Logger Modal */}
      {sessionModalPlan && (
        <SessionLoggerModal
          plan={sessionModalPlan}
          onClose={() => setSessionModalPlan(null)}
          onSuccess={() => {
            toast.success('Session logged successfully!')
            if (activePlanId > 0) void refetchSessions()
            if (effectivePatientId > 0) void refetchPlans()
            if (showLaunchpad) void refetchRoster()
          }}
        />
      )}

      {/* Session Addendum Modal */}
      {activeAddendumSession && (
        <SessionAddendumModal
          session={activeAddendumSession}
          onClose={() => setActiveAddendumSession(null)}
          onSuccess={() => {
            toast.success('Dated addendum attached successfully!')
            if (activePlanId > 0) void refetchSessions()
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
            <p className="text-xs leading-relaxed text-gray-600">
              Please state the clinical or administrative reason for discontinuing this package early.
            </p>
            <form onSubmit={handleConfirmCancelPlan} className="space-y-4">
              <div>
                <label htmlFor="cancel-reason" className="mb-1.5 block text-xs font-medium text-gray-700">
                  Reason for Cancellation *
                </label>
                <textarea
                  id="cancel-reason"
                  required
                  rows={3}
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  placeholder="e.g. Patient improved completely, surgery scheduled, or patient relocated..."
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  data-autofocus
                  onClick={() => setShowCancelPlanModal(false)}
                  className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50"
                >
                  Keep Active
                </button>
                <button
                  type="submit"
                  disabled={updatePlanMutation.isPending}
                  className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
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
            {paramEncounterId && (
              <div
                data-testid="linked-encounter-badge"
                className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900"
              >
                Linked to Consultation #{paramEncounterId}
              </div>
            )}
            <form onSubmit={handleCreatePlan} noValidate className="space-y-4">
              <div>
                <label htmlFor="plan-name" className="mb-1.5 block text-xs font-medium text-gray-700">
                  Package Name *
                </label>
                <input
                  id="plan-name"
                  data-autofocus
                  type="text"
                  required
                  minLength={2}
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
              </div>

              <div>
                <label htmlFor="plan-diag" className="mb-1.5 block text-xs font-medium text-gray-700">
                  Condition / Diagnosis *
                </label>
                <input
                  id="plan-diag"
                  type="text"
                  required
                  minLength={2}
                  value={newDiagnosis}
                  onChange={(e) => setNewDiagnosis(e.target.value)}
                  placeholder="e.g. Lumbar Spondylolisthesis Grade I"
                  className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
              </div>

              <div>
                <label htmlFor="plan-ref" className="mb-1.5 block text-xs font-medium text-gray-700">
                  Referred By (Optional)
                </label>
                <input
                  id="plan-ref"
                  type="text"
                  value={newReferredBy}
                  onChange={(e) => setNewReferredBy(e.target.value)}
                  placeholder="e.g. Self / Dr. S. K. Sinha"
                  className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="plan-sessions" className="mb-1.5 block text-xs font-medium text-gray-700">
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
                    className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 tabular-nums transition-colors duration-150 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                  />
                </div>

                <div>
                  <label htmlFor="plan-price" className="mb-1.5 block text-xs font-medium text-gray-700">
                    Agreed Fee (₹ INR) *
                  </label>
                  <input
                    id="plan-price"
                    type="number"
                    min={0}
                    required
                    value={newPriceRupees}
                    onChange={(e) => setNewPriceRupees(Number(e.target.value))}
                    className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 tabular-nums transition-colors duration-150 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 border-t border-gray-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewPlanModal(false)}
                  className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createPlanMutation.isPending}
                  className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create Package
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        {/* Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-2xs sm:px-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/doctor"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 transition-colors duration-150 hover:text-teal-900"
            >
              ← Back to Queue
            </Link>
            <span className="text-gray-500" aria-hidden="true">|</span>
            <span className="text-xs font-medium text-gray-600">Patient:</span>
            {activePatient ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {activePatient.full_name} (<span className="font-mono">{activePatient.urn}</span>) · {activePatient.age_years}y / {activePatient.gender}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setManualPatient(null)
                    setSearchParams({})
                    navigate('/doctor/treatment-plans')
                  }}
                  className="ml-1 cursor-pointer text-xs font-medium text-teal-700 underline underline-offset-2 transition-colors duration-150 hover:text-teal-900"
                >
                  Switch Patient
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-500 italic">No patient selected</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {effectivePatientId > 0 && (
              <button
                type="button"
                onClick={() => setShowNewPlanModal(true)}
                className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-1.5 text-xs font-medium text-teal-800 transition-colors duration-150 hover:bg-teal-100"
              >
                + New Package (+ नया पैकेज)
              </button>
            )}
          </div>
        </div>

        {/* Route Plan Loading / Error State */}
        {showRoutePlanLoading && (
          <div
            role="status"
            className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 shadow-2xs"
          >
            Loading treatment package...
          </div>
        )}

        {showRoutePlanError && (
          <div
            role="alert"
            data-testid="treatment-plan-error"
            className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 shadow-2xs"
          >
            <p className="font-semibold">Unable to load treatment package</p>
            <p className="text-xs leading-relaxed text-red-800">
              {isInvalidRoutePlanId
                ? 'Invalid treatment plan ID in the URL.'
                : routePlanError instanceof Error
                  ? routePlanError.message
                  : 'Treatment package was not found or could not be loaded.'}
            </p>
            <Link
              to="/doctor/treatment-plans"
              className="inline-flex min-h-[36px] items-center rounded-lg border border-red-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-red-800 transition-colors duration-150 hover:bg-red-100"
            >
              Back to Active Treatment Packages
            </Link>
          </div>
        )}

        {/* Directory Launchpad when no patient is chosen */}
        {showLaunchpad && (
          <div className="space-y-5">
            <div className="rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50/70 to-white p-4 shadow-2xs sm:p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight leading-tight text-teal-950 sm:text-2xl">
                    <span>Physiotherapy Treatment</span>
                    <span className="rounded-full border border-teal-300 bg-teal-100 px-2.5 py-0.5 text-xs font-medium tracking-normal text-teal-800">
                      भौतिक चिकित्सा
                    </span>
                  </h1>
                  <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-teal-800/90">
                    Manage packages, track VAS progress, log daily modalities.
                  </p>
                </div>
                <div className="flex items-center gap-2 self-start md:self-auto">
                  <div className="rounded-lg border border-teal-200 bg-white px-3.5 py-2 text-left sm:text-center">
                    <span className="block text-xs font-medium text-gray-500">Modalities</span>
                    <span className="text-sm font-semibold text-teal-900">IFT · TENS · Traction · US</span>
                  </div>
                </div>
              </div>

              {/* Patient Search Input */}
              <div className="relative mt-5 max-w-2xl">
                <label htmlFor="rehab-patient-search" className="sr-only">
                  Search patient by URN, Name, or Mobile
                </label>
                <input
                  id="rehab-patient-search"
                  type="search"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="Type URN, name or mobile"
                  className="min-h-[42px] w-full rounded-xl border border-teal-300 bg-white py-2.5 pl-10 pr-16 text-sm text-gray-900 shadow-2xs transition-colors duration-150 placeholder:text-gray-400 hover:border-teal-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-teal-700" aria-hidden="true">
                  <IconSearch className="h-4 w-4 shrink-0" />
                </span>
                {patientSearch && (
                  <button
                    type="button"
                    onClick={() => setPatientSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Live Search Results */}
            {patientSearch && (
              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-5">
                  <h2 className="text-base font-semibold tracking-tight text-gray-900 tabular-nums">
                    Matching Patients ({searchResults.length})
                  </h2>
                  {isSearching && <span className="text-xs font-medium text-gray-500">Searching...</span>}
                </div>
                <div className="p-4 sm:p-5">
                  {searchResults.length === 0 && !isSearching ? (
                    <p className="py-2 text-sm leading-relaxed text-gray-500">
                      No patients found matching &ldquo;{patientSearch}&rdquo;.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {searchResults.map((p) => (
                        <div
                          key={p.id}
                          className="flex flex-col justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/40 p-3.5 transition-colors duration-150 hover:border-teal-300 hover:bg-teal-50/30"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-gray-900">{p.full_name}</span>
                              <span className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-xs font-semibold text-teal-800 tabular-nums">
                                {p.urn}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-500 tabular-nums">
                              {p.age_years}y / {p.gender} · Mobile: {p.mobile}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setManualPatient(p)
                                setSearchParams({ patient_id: String(p.id) })
                              }}
                              className="inline-flex min-h-[36px] flex-1 cursor-pointer items-center justify-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-teal-800"
                            >
                              Open Rehabilitation Plans
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setManualPatient(p)
                                setShowNewPlanModal(true)
                              }}
                              className="inline-flex min-h-[36px] cursor-pointer items-center justify-center rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-medium text-teal-800 transition-colors duration-150 hover:bg-teal-50"
                            >
                              + New Package
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Active Treatment Packages Roster */}
            <section
              data-testid="active-treatment-plans-roster"
              className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-gray-900 tabular-nums">
                    {rosterStatus === 'ACTIVE'
                      ? 'Active Treatment Packages'
                      : rosterStatus === 'COMPLETED'
                        ? 'Completed Treatment Packages'
                        : 'All Treatment Packages'}{' '}
                    ({rosterPlans.length})
                  </h2>
                  <p className="text-xs text-gray-500">
                    Your ongoing physiotherapy packages — open a plan or log today&apos;s session.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="Filter packages by status">
                    {ROSTER_STATUS_TABS.map((tab) => {
                      const selected = rosterStatus === tab.value
                      return (
                        <button
                          key={tab.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setRosterStatus(tab.value)}
                          className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                            selected
                              ? 'bg-teal-700 text-white shadow-2xs'
                              : 'text-gray-600 hover:bg-white hover:text-gray-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => void refetchRoster()}
                    className="inline-flex min-h-[32px] cursor-pointer items-center rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {isRosterPending ? (
                <div role="status" className="p-6 text-center text-sm text-gray-500">
                  Loading treatment packages...
                </div>
              ) : isRosterError ? (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 bg-red-50/70 p-4 text-xs text-red-800 sm:px-5">
                  <span>
                    {rosterError instanceof Error
                      ? rosterError.message
                      : 'Failed to load treatment packages.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refetchRoster()}
                    className="cursor-pointer rounded-md border border-red-300 bg-white px-2.5 py-1 font-semibold text-red-800 hover:bg-red-100"
                  >
                    Retry
                  </button>
                </div>
              ) : rosterPlans.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">
                  No {rosterStatus === 'ALL' ? '' : `${rosterStatus.toLowerCase()} `}treatment packages found. Search for a patient above to create a new package.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-semibold text-gray-600">
                      <tr>
                        <th className="px-4 py-2.5 sm:px-5">Patient</th>
                        <th className="px-4 py-2.5">Package &amp; Condition</th>
                        <th className="px-4 py-2.5">Progress</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right sm:px-5">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {rosterPlans.map((plan) => {
                        const pct =
                          plan.total_sessions > 0
                            ? Math.min(100, Math.round((plan.completed_sessions / plan.total_sessions) * 100))
                            : 0
                        const canQuickLog =
                          plan.status === 'ACTIVE' &&
                          plan.completed_sessions < plan.total_sessions &&
                          (me?.doctor_id == null || plan.doctor_id === me.doctor_id)
                        return (
                          <tr key={plan.id} className="transition-colors hover:bg-gray-50/60">
                            <td className="px-4 py-3 align-top sm:px-5">
                              <div className="font-semibold text-gray-900">{plan.patient_name}</div>
                              <div className="font-mono text-xs text-gray-500 tabular-nums">{plan.patient_urn}</div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-medium text-gray-900">{plan.plan_name}</div>
                              <div className="text-xs text-gray-600">{plan.condition_diagnosis}</div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="min-w-[120px] space-y-1">
                                <span className="font-mono text-xs font-semibold text-teal-900 tabular-nums">
                                  {plan.completed_sessions} / {plan.total_sessions} ({pct}%)
                                </span>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className="h-full rounded-full bg-teal-700"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                                  plan.status === 'ACTIVE'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : plan.status === 'COMPLETED'
                                      ? 'border-blue-200 bg-blue-50 text-blue-800'
                                      : 'border-gray-300 bg-gray-100 text-gray-700'
                                }`}
                              >
                                {plan.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top text-right sm:px-5">
                              <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                {canQuickLog && (
                                  <button
                                    type="button"
                                    onClick={() => setSessionModalPlan(plan)}
                                    className="inline-flex min-h-[32px] cursor-pointer items-center rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-teal-800"
                                  >
                                    Log Session
                                  </button>
                                )}
                                <Link
                                  to={`/doctor/treatment-plans/${plan.id}`}
                                  className="inline-flex min-h-[32px] items-center rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 transition-colors duration-150 hover:bg-teal-100"
                                >
                                  Open Plan
                                </Link>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Active Treatment Package Overview Card */}
        {effectivePatientId > 0 && activePlan ? (
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
            <div className="flex flex-col justify-between gap-3 border-b border-gray-200 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight leading-tight text-gray-900 sm:text-xl">
                    {activePlan.plan_name}
                  </h2>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      activePlan.status === 'ACTIVE'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : activePlan.status === 'COMPLETED'
                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                        : 'border-gray-300 bg-gray-100 text-gray-700'
                    }`}
                  >
                    {activePlan.status}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                  Condition: <span className="font-semibold text-gray-800">{activePlan.condition_diagnosis}</span>
                  {activePlan.referred_by && ` · Ref: ${activePlan.referred_by}`}
                  {activePlan.encounter_id && (
                    <>
                      {' · '}
                      <Link
                        to={`/doctor/encounters/${activePlan.encounter_id}`}
                        className="font-medium text-teal-700 underline-offset-2 hover:text-teal-900 hover:underline"
                      >
                        Consultation #{activePlan.encounter_id}
                      </Link>
                    </>
                  )}
                </p>
              </div>

              <div className="sm:text-right">
                <span className="block text-xs font-medium text-gray-500">Agreed Fee</span>
                <span className="font-mono text-lg font-bold text-gray-900 tabular-nums">
                  ₹{(activePlan.agreed_price_paise / 100).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              {/* Read-only notice when viewing another doctor's plan */}
              {!isOwnPlan && (
                <div
                  role="status"
                  data-testid="treatment-plan-readonly-banner"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900"
                >
                  Read-only view: This treatment package belongs to {withDoctorTitle(activePlan.doctor_name)}. Only the owning doctor can log sessions, append addenda, or cancel this package.
                </div>
              )}

              {/* Progress Gauge */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-700">Package Progress:</span>
                  <span className="font-mono font-semibold text-teal-900 tabular-nums">
                    {activePlan.completed_sessions} of {activePlan.total_sessions} Sessions Completed ({completionPercent}%)
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full border border-gray-200 bg-gray-100">
                  <div
                    className="h-full rounded-full bg-teal-700 transition-all duration-500"
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  {isOwnPlan && activePlan.status === 'ACTIVE' && activePlan.completed_sessions < activePlan.total_sessions && (
                    <button
                      type="button"
                      onClick={() => setSessionModalPlan(activePlan)}
                      className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-2xs tabular-nums transition-colors duration-150 hover:bg-teal-800"
                    >
                      Log Session #{activePlan.completed_sessions + 1}
                    </button>
                  )}

                  {isOwnPlan && activePlan.status === 'ACTIVE' && (
                    <button
                      type="button"
                      onClick={() => setShowCancelPlanModal(true)}
                      className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors duration-150 hover:bg-red-50"
                    >
                      Cancel Package
                    </button>
                  )}
                </div>

                {activePlan.status === 'COMPLETED' && (
                  <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 tabular-nums">
                    ✓ All {activePlan.total_sessions} planned sessions completed
                  </span>
                )}

                {activePlan.cancellation_reason && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                    Cancelled: {activePlan.cancellation_reason}
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {effectivePatientId > 0 && !activePlan && (
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-6 text-center shadow-2xs sm:p-8">
            <p className="text-sm leading-relaxed text-gray-600">
              No active treatment package found for this patient.
            </p>
            <button
              type="button"
              onClick={() => setShowNewPlanModal(true)}
              className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-teal-800"
            >
              Create New Treatment Package
            </button>
          </div>
        )}

        {/* VAS Pain Trend Chart */}
        {sessions && sessions.length > 0 && (
          <VasTrendChart sessions={sessions} />
        )}

        {/* Chronological Sessions Log Table */}
        {sessions && sessions.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-5">
              <h3 className="text-base font-semibold tracking-tight text-gray-900 tabular-nums">
                Session History & Treatment Records ({sessions.length})
              </h3>
              <span className="font-mono text-xs text-gray-500">Immutable audit records</span>
            </div>

            <div className="divide-y divide-gray-200 px-4 sm:px-5">
              {sessions.map((sess) => (
                <div
                  key={sess.id}
                  className="space-y-3 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-teal-800 px-2.5 py-0.5 text-xs font-semibold text-white tabular-nums">
                        Session #{sess.session_number}
                      </span>
                      <span className="text-xs font-medium text-gray-600 tabular-nums">
                        {new Date(sess.session_date).toLocaleDateString('en-IN')}
                      </span>
                      <span className="text-xs font-semibold text-gray-700">· {withDoctorTitle(sess.doctor_name)}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 tabular-nums">
                        VAS: {sess.vas_score}/10
                      </span>
                      <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Finalised
                      </span>
                      {isOwnPlan && (
                        <button
                          type="button"
                          onClick={() => setActiveAddendumSession(sess)}
                          className="ml-1 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-teal-700 transition-colors duration-150 hover:bg-teal-50 hover:text-teal-900"
                        >
                          + Addendum
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Modalities Chips */}
                  {sess.modalities && sess.modalities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {sess.modalities.map((mod) => (
                        <span
                          key={mod}
                          className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800"
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{sess.clinical_notes}</p>

                  {/* Addenda Section */}
                  {sess.addenda && sess.addenda.length > 0 && (
                    <div className="space-y-2 border-t border-gray-100 pt-2.5">
                      <span className="block text-xs font-semibold text-amber-800 tabular-nums">
                        Addenda ({sess.addenda.length})
                      </span>
                      {sess.addenda.map((ad, idx) => (
                        <div
                          key={ad.id}
                          className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-gray-800"
                        >
                          <div className="flex justify-between text-[10px] text-amber-900 font-semibold">
                            <span>#{idx + 1} By {ad.author_name}</span>
                            <span className="font-mono tabular-nums">{new Date(ad.created_at).toLocaleString('en-IN')}</span>
                          </div>
                          <p className="leading-relaxed">{ad.note}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Other Packages for Patient */}
        {otherPlans.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
            <div className="border-b border-gray-200 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold tracking-tight text-gray-900 tabular-nums">
                Other Treatment Packages ({otherPlans.length})
              </h3>
            </div>
            <div className="divide-y divide-gray-200 px-4 sm:px-5">
              {otherPlans.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{p.plan_name}</span>
                    <span className="text-gray-500 tabular-nums">
                      ({p.completed_sessions}/{p.total_sessions} sessions)
                    </span>
                    <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">
                      {p.status}
                    </span>
                  </div>
                  <Link
                    to={`/doctor/treatment-plans/${p.id}`}
                    className="whitespace-nowrap font-medium text-teal-700 transition-colors duration-150 hover:text-teal-900"
                  >
                    Switch View
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  )
}

