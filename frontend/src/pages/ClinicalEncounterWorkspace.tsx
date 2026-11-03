import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import { UnsavedChangesGuard, hasReportedAllergies } from '../components/UnsavedChangesGuard'
import { ApiError } from '../api/client'
import {
  usePatient,
  usePatientEncounters,
  useEncounter,
  useCreateEncounter,
  useUpdateEncounter,
  useFinaliseEncounter,
  useAddAddendum,
  useMe,
} from '../api/queries'
import type { AddendumRead, EncounterSummary } from '../api/types'

export function ClinicalEncounterWorkspace() {
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: me } = useMe()

  const encounterId = id ? Number(id) : 0
  const paramPatientId = searchParams.get('patient_id')
    ? Number(searchParams.get('patient_id'))
    : null
  const paramApptId = searchParams.get('appointment_id')
    ? Number(searchParams.get('appointment_id'))
    : null

  // Load existing encounter if viewing by ID
  const {
    data: existingEncounter,
    isPending: isEncounterPending,
    isError: isEncounterError,
    error: encounterError,
    refetch: refetchEncounter,
  } = useEncounter(encounterId)

  // Resolve target patient ID
  const effectivePatientId = existingEncounter?.patient_id || paramPatientId || 0
  const { data: patient } = usePatient(effectivePatientId)
  const { data: pastEncounters } = usePatientEncounters(effectivePatientId)

  // Form states
  const [symptoms, setSymptoms] = useState('')
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [versionId, setVersionId] = useState(1)
  const [isFinalised, setIsFinalised] = useState(false)
  const [finalisedAt, setFinalisedAt] = useState<string | null>(null)
  const [addenda, setAddenda] = useState<AddendumRead[]>([])

  // Modal / Feedback state
  const [conflictError, setConflictError] = useState<string | null>(null)
  const [isConflict, setIsConflict] = useState(false)
  const savedRef = useRef(false)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [showFinaliseConfirm, setShowFinaliseConfirm] = useState(false)
  const [addendumText, setAddendumText] = useState('')

  // Mutations
  const createMutation = useCreateEncounter()
  const updateMutation = useUpdateEncounter()
  const finaliseMutation = useFinaliseEncounter()
  const addendumMutation = useAddAddendum()

  // Sync existing encounter data into form
  useEffect(() => {
    if (existingEncounter) {
      setSymptoms(existingEncounter.symptoms)
      setClinicalNotes(existingEncounter.clinical_notes)
      setDiagnosis(existingEncounter.diagnosis)
      setVersionId(existingEncounter.version_id)
      setIsFinalised(existingEncounter.is_finalised)
      setFinalisedAt(existingEncounter.finalised_at)
      setAddenda(existingEncounter.addenda || [])
    }
  }, [existingEncounter])

  // Unsaved = the form differs from the last saved/loaded state (empty for a new encounter).
  const dirty =
    !isFinalised &&
    (existingEncounter
      ? symptoms !== existingEncounter.symptoms ||
        clinicalNotes !== existingEncounter.clinical_notes ||
        diagnosis !== existingEncounter.diagnosis
      : Boolean(symptoms || clinicalNotes || diagnosis))
  const isSaving = createMutation.isPending || updateMutation.isPending || finaliseMutation.isPending

  const reportError = (err: unknown, fallback: string) => {
    setIsConflict(err instanceof ApiError && err.status === 409)
    setConflictError(err instanceof Error ? err.message : fallback)
  }

  const clearMessages = () => {
    setConflictError(null)
    setIsConflict(false)
    setActionSuccess(null)
  }

  const missingFieldsMessage = () =>
    !symptoms.trim() || !clinicalNotes.trim() || !diagnosis.trim()
      ? 'Please fill out Symptoms, Clinical Notes, and Diagnosis.'
      : null

  /** Persists the form (create or update) and returns the saved encounter id, or null when it could not be saved. */
  const persistDraft = async (): Promise<number | null> => {
    const missing = missingFieldsMessage()
    if (missing) {
      setConflictError(missing)
      return null
    }
    if (encounterId > 0) {
      if (!dirty) return encounterId
      const res = await updateMutation.mutateAsync({
        id: encounterId,
        body: { symptoms, clinical_notes: clinicalNotes, diagnosis, version_id: versionId },
      })
      setVersionId(res.version_id)
      return encounterId
    }
    if (!effectivePatientId) {
      setConflictError('Valid patient record is required.')
      return null
    }
    const created = await createMutation.mutateAsync({
      patient_id: effectivePatientId,
      appointment_id: paramApptId,
      symptoms,
      clinical_notes: clinicalNotes,
      diagnosis,
    })
    return created.id
  }

  const handleSaveDraft = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (isSaving || isFinalised) return
    clearMessages()

    try {
      const savedId = await persistDraft()
      if (savedId === null) return
      if (encounterId > 0) {
        setActionSuccess('Encounter draft saved successfully.')
      } else {
        // The saved text now matches the server copy, so leaving must not prompt.
        savedRef.current = true
        navigate(`/doctor/encounters/${savedId}`, { replace: true })
      }
    } catch (err: unknown) {
      reportError(err, 'Failed to save draft.')
    }
  }

  const handleConfirmFinalise = async () => {
    setShowFinaliseConfirm(false)
    clearMessages()

    try {
      // Edits not yet saved must be stored before locking, otherwise they would be silently lost.
      const targetId = await persistDraft()
      if (targetId === null) return

      const res = await finaliseMutation.mutateAsync(targetId)
      setIsFinalised(true)
      setFinalisedAt(res.finalised_at)
      setVersionId(res.version_id)
      setActionSuccess('Encounter finalised and locked against modification.')
      if (encounterId === 0) {
        savedRef.current = true
        navigate(`/doctor/encounters/${targetId}`, { replace: true })
      }
    } catch (err: unknown) {
      reportError(err, 'Failed to finalise encounter.')
    }
  }

  // Ctrl+S saves the draft instead of opening the browser's "Save page" dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSaveDraft()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const handleAddAddendum = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addendumText.trim() || encounterId <= 0) return
    setConflictError(null)

    try {
      const newAddendum = await addendumMutation.mutateAsync({
        id: encounterId,
        body: { addendum_text: addendumText.trim() },
      })
      setAddenda((prev) => [...prev, newAddendum])
      setAddendumText('')
      setActionSuccess('Addendum successfully appended to record.')
    } catch (err: unknown) {
      if (err instanceof Error) {
        setConflictError(err.message)
      } else {
        setConflictError('Failed to add addendum.')
      }
    }
  }

  if (encounterId > 0 && isEncounterPending) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        <div className="p-8 text-center text-neutral-600">Loading consultation record...</div>
      </AppShell>
    )
  }

  if (encounterId > 0 && isEncounterError) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        <div role="alert" className="p-6 bg-red-50 text-red-700 rounded-xl border border-red-200">
          Encounter access restricted or not found: {encounterError.message}
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      <div className="space-y-6 w-full max-w-7xl mx-auto">
        <UnsavedChangesGuard dirty={dirty} bypassRef={savedRef} />

        {conflictError && isConflict && (
          <ConflictBanner
            onReload={() => {
              clearMessages()
              if (encounterId > 0) refetchEncounter()
            }}
          />
        )}
        {conflictError && !isConflict && (
          <InlineAlert tone="error" onDismiss={clearMessages}>
            {conflictError}
          </InlineAlert>
        )}

        {actionSuccess && (
          <div role="status" className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 text-sm font-semibold flex justify-between items-center shadow-xs">
            <span>&check; {actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-800 hover:text-emerald-950 font-bold">&times;</button>
          </div>
        )}

        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-neutral-200 shadow-xs">
          <div>
            <Link
              to="/doctor"
              className="text-xs font-bold text-rose-900 hover:underline flex items-center gap-1.5"
            >
              &larr; Back to Consultation Queue
            </Link>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight mt-1">
              Clinical Encounter Workspace
            </h2>
            <p className="text-xs text-neutral-600 mt-0.5">
              Document patient symptoms, physical examination findings, and clinical diagnosis.
            </p>
          </div>
          {isFinalised && (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-emerald-100 text-emerald-950 border border-emerald-300 shadow-2xs">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              🔒 Finalised & Locked ({finalisedAt ? new Date(finalisedAt).toLocaleDateString() : 'Locked'})
            </span>
          )}
        </div>

        {/* 2-Column Landscape Desktop Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Patient Identity & Clinical History (4 Cols) */}
          <div className="lg:col-span-4 xl:col-span-4 space-y-6">
            {/* Patient Clinical Banner */}
            {patient && (
              <div className="bg-white rounded-xl border border-neutral-200 shadow-xs p-5 space-y-4">
                <div className="border-b border-neutral-100 pb-3">
                  <span className="text-xs uppercase font-extrabold text-rose-900 tracking-wider">Patient Clinical Record</span>
                  <h3 className="text-xl font-bold text-neutral-900 mt-1">{patient.full_name}</h3>
                  <div className="flex flex-col gap-1.5 text-xs text-neutral-700 mt-2 font-mono">
                    <div>URN: <strong className="text-neutral-900">{patient.urn}</strong></div>
                    <div>Age: <strong className="text-neutral-900">{patient.age_years} yrs</strong> &bull; Gender: <strong className="text-neutral-900">{patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : 'Other'}</strong></div>
                    <div>Mobile: <strong className="text-neutral-900">{patient.mobile}</strong></div>
                  </div>
                </div>

                {/* Allergies Alert */}
                {hasReportedAllergies(patient.allergies) ? (
                  <div role="alert" className="p-3 bg-red-50 border border-red-300 rounded-lg text-red-900 text-xs font-bold flex items-center gap-2">
                    <span>⚠️ Clinical Alert - Reported Allergies:</span>
                    <span className="underline">{patient.allergies}</span>
                  </div>
                ) : (
                  <div className="text-xs text-neutral-600 font-medium bg-neutral-50 px-3 py-2 rounded-lg border border-neutral-200">
                    Allergies: None reported
                  </div>
                )}
              </div>
            )}

            {/* Historical Encounters Card */}
            {patient && (
              <div className="bg-white rounded-xl border border-neutral-200 shadow-xs p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
                  <h4 className="text-xs uppercase font-bold text-neutral-800 tracking-wider">
                    Previous Consultations ({pastEncounters?.length || 0})
                  </h4>
                </div>
                  {pastEncounters && pastEncounters.length > 0 ? (
                    <div className="divide-y divide-neutral-100 max-h-64 overflow-y-auto">
                      {pastEncounters.map((pe: EncounterSummary) => (
                        <div key={pe.id} className="py-2.5 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-neutral-900">{new Date(pe.encounter_date).toLocaleDateString()}</span>
                            <p className="text-neutral-600 truncate max-w-[180px]">Diagnosis: <strong>{pe.diagnosis}</strong></p>
                          </div>
                          <Link
                            to={`/doctor/encounters/${pe.id}`}
                            className="text-rose-900 hover:underline font-bold shrink-0 ml-2"
                          >
                            View Record &rarr;
                          </Link>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-600 italic py-2">No prior consultations recorded for this patient.</p>
                  )}
              </div>
            )}
          </div>

          {/* Right Column: Active Clinical Notes Form & Addenda (8 Cols) */}
          <div className="lg:col-span-8 xl:col-span-8 space-y-6">
            <div className="bg-white rounded-xl border border-neutral-200 shadow-xs p-6 space-y-6">
              <h3 className="text-base font-bold text-neutral-900 border-b border-neutral-100 pb-3">
                {isFinalised ? 'Consultation Record (Locked)' : 'Clinical Consultation Notes'}
              </h3>

              <form onSubmit={handleSaveDraft} className="space-y-5 pb-4">
                {patient && hasReportedAllergies(patient.allergies) && (
                  <div role="alert" className="p-3 bg-red-50 border border-red-300 rounded-lg text-red-900 text-xs font-bold flex items-center gap-2">
                    <span>⚠️ PATIENT ALLERGIES REPORTED:</span>
                    <span className="underline">{patient.allergies}</span>
                  </div>
                )}

                {/* Symptoms / Chief Complaints */}
                <div>
                  <label htmlFor="symptoms-field" className="block text-xs font-bold text-neutral-700 uppercase mb-1.5">
                    Chief Complaints & Symptoms
                  </label>
                  {isFinalised ? (
                    <div className="p-3.5 bg-neutral-50 rounded-lg border border-neutral-200 text-sm text-neutral-800 whitespace-pre-wrap font-medium">
                      {symptoms}
                    </div>
                  ) : (
                    <textarea
                      id="symptoms-field"
                      value={symptoms}
                      onChange={(e) => setSymptoms(e.target.value)}
                      placeholder="Describe patient's chief complaints, duration, pain intensity (VAS 0-10)..."
                      rows={3}
                      required
                      className="w-full p-3 border border-neutral-300 rounded-lg text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  )}
                </div>

                {/* Clinical Examination & Progress Notes */}
                <div>
                  <label htmlFor="notes-field" className="block text-xs font-bold text-neutral-700 uppercase mb-1.5">
                    Clinical Examination & Progress Notes
                  </label>
                  {isFinalised ? (
                    <div className="p-3.5 bg-neutral-50 rounded-lg border border-neutral-200 text-sm text-neutral-800 whitespace-pre-wrap font-medium">
                      {clinicalNotes}
                    </div>
                  ) : (
                    <textarea
                      id="notes-field"
                      value={clinicalNotes}
                      onChange={(e) => setClinicalNotes(e.target.value)}
                      placeholder="Physical examination findings, range of motion, anatomical tenderness, modalities applied..."
                      rows={4}
                      required
                      className="w-full p-3 border border-neutral-300 rounded-lg text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  )}
                </div>

                {/* Diagnosis / Impression */}
                <div>
                  <label htmlFor="diagnosis-field" className="block text-xs font-bold text-neutral-700 uppercase mb-1.5">
                    Clinical Diagnosis / Impression
                  </label>
                  {isFinalised ? (
                    <div className="p-3.5 bg-neutral-50 rounded-lg border border-neutral-200 text-sm text-neutral-900 font-bold">
                      {diagnosis}
                    </div>
                  ) : (
                    <input
                      id="diagnosis-field"
                      type="text"
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      placeholder="Diagnosis (e.g. Lumbar Spondylosis with L5 Radiculopathy)..."
                      required
                      className="w-full p-3 border border-neutral-300 rounded-lg text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  )}
                </div>

                {/* Action Bar */}
                {!isFinalised && (
                  <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-neutral-200 bg-white rounded-b-xl">
                    <div className="flex flex-wrap items-center gap-2">
                      {effectivePatientId > 0 && (
                        <Link
                          to={`/doctor/treatment-plans?patient_id=${effectivePatientId}`}
                          className="px-3.5 py-2 border border-purple-400 bg-purple-50 text-purple-950 rounded-lg font-semibold text-xs hover:bg-purple-100 flex items-center gap-1.5 transition-colors min-h-[40px]"
                        >
                          ⚡ Treatment Plan
                        </Link>
                      )}
                      {effectivePatientId > 0 && (
                        <Link
                          to={`/doctor/prescriptions/new?patient_id=${effectivePatientId}${encounterId ? `&encounter_id=${encounterId}` : ''}`}
                          className="px-3.5 py-2 border border-amber-400 bg-amber-50 text-amber-950 rounded-lg font-semibold text-xs hover:bg-amber-100 flex items-center gap-1.5 transition-colors min-h-[40px]"
                        >
                          ℞ Write Prescription
                        </Link>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={isSaving}
                        title="Save draft (Ctrl+S)"
                        className="px-4 py-2 border border-neutral-300 rounded-lg font-semibold text-xs text-neutral-700 hover:bg-neutral-50 min-h-[44px] transition-colors disabled:opacity-50"
                      >
                        {isSaving ? 'Saving...' : 'Save Draft Notes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const missing = missingFieldsMessage()
                          if (missing) {
                            clearMessages()
                            setConflictError(missing)
                            return
                          }
                          setShowFinaliseConfirm(true)
                        }}
                        disabled={isSaving}
                        className="px-5 py-2 bg-[#8E1C3D] text-white rounded-lg font-bold text-xs hover:bg-[#721631] shadow-xs flex items-center gap-1.5 min-h-[44px] transition-colors disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Finalise Consultation
                      </button>
                    </div>
                  </div>
                )}
              </form>

              {/* Addenda Section (Only enabled for finalised encounters) */}
              {isFinalised && (
                <div className="mt-8 pt-6 border-t border-neutral-200 space-y-5">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-neutral-900 uppercase tracking-wider">
                      Dated Clinical Addenda ({addenda.length})
                    </h4>
                    <span className="text-xs text-neutral-600 font-mono">Immutable audit trail</span>
                  </div>

                  {addenda.length === 0 ? (
                    <p className="text-xs text-neutral-600 italic py-1">No addenda recorded for this encounter.</p>
                  ) : (
                    <div className="space-y-3">
                      {addenda.map((ad: AddendumRead, idx: number) => (
                        <div key={ad.id} className="p-4 bg-amber-50/70 rounded-lg border border-amber-200 space-y-1.5">
                          <div className="flex justify-between text-xs text-amber-950 font-bold">
                            <span>Addendum #{idx + 1} &bull; Dr. {ad.doctor_name}</span>
                            <span className="font-mono">{new Date(ad.created_at).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-neutral-800 whitespace-pre-wrap font-medium">{ad.addendum_text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add New Addendum */}
                  <form onSubmit={handleAddAddendum} className="space-y-3 pt-2">
                    <label htmlFor="addendum-input" className="block text-xs font-bold text-neutral-700 uppercase">
                      Append Follow-Up Addendum
                    </label>
                    <textarea
                      id="addendum-input"
                      value={addendumText}
                      onChange={(e) => setAddendumText(e.target.value)}
                      placeholder="Record follow-up remarks, telephone consultation, or treatment adjustments..."
                      rows={3}
                      required
                      className="w-full p-3 border border-neutral-300 rounded-lg text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                    <button
                      type="submit"
                      disabled={addendumMutation.isPending || !addendumText.trim()}
                      className="px-5 py-2.5 bg-neutral-900 text-white rounded-lg text-xs font-bold hover:bg-neutral-800 disabled:opacity-50 min-h-[40px] transition-colors"
                    >
                      {addendumMutation.isPending ? 'Appending...' : '+ Append Addendum'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Finalisation Confirmation Modal */}
        {showFinaliseConfirm && (
          <Modal
            open
            variant="destructive"
            title="Finalise Consultation?"
            onClose={() => setShowFinaliseConfirm(false)}
            busy={finaliseMutation.isPending}
            className="max-w-md"
          >
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-900 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-xs text-neutral-700 text-center leading-relaxed font-medium">
                Once finalised, this clinical encounter will be permanently locked against modifications or deletions. Any subsequent changes can only be added as dated addenda.
              </p>
              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  data-autofocus
                  onClick={() => setShowFinaliseConfirm(false)}
                  className="px-4 py-2 border border-neutral-300 rounded-lg text-sm font-semibold hover:bg-neutral-50 min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmFinalise}
                  disabled={finaliseMutation.isPending}
                  className="px-5 py-2 bg-[#8E1C3D] text-white rounded-lg text-sm font-bold hover:bg-[#721631] min-h-[40px]"
                >
                  {finaliseMutation.isPending ? 'Finalising...' : 'Yes, Lock & Finalise'}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  )
}
