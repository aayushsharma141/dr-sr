import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { Modal } from '../components/Modal'
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
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [showFinaliseConfirm, setShowFinaliseConfirm] = useState(false)
  const [addendumText, setAddendumText] = useState('')
  const [showHistory, setShowHistory] = useState(false)

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

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    setConflictError(null)
    setActionSuccess(null)

    if (!symptoms.trim() || !clinicalNotes.trim() || !diagnosis.trim()) {
      setConflictError('Please fill out Symptoms, Clinical Notes, and Diagnosis.')
      return
    }

    try {
      if (encounterId > 0) {
        // Update draft
        const res = await updateMutation.mutateAsync({
          id: encounterId,
          body: {
            symptoms,
            clinical_notes: clinicalNotes,
            diagnosis,
            version_id: versionId,
          },
        })
        setVersionId(res.version_id)
        setActionSuccess('Draft consultation notes saved successfully.')
      } else {
        // Create new encounter
        const res = await createMutation.mutateAsync({
          patient_id: effectivePatientId,
          appointment_id: paramApptId,
          symptoms,
          clinical_notes: clinicalNotes,
          diagnosis,
        })
        setActionSuccess('Consultation encounter created.')
        navigate(`/doctor/encounters/${res.id}`, { replace: true })
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setConflictError(err.message)
      } else {
        setConflictError('Failed to save draft.')
      }
    }
  }

  const handleConfirmFinalise = async () => {
    setShowFinaliseConfirm(false)
    setConflictError(null)

    try {
      let targetId = encounterId
      if (encounterId === 0) {
        // Save first then finalise
        const created = await createMutation.mutateAsync({
          patient_id: effectivePatientId,
          appointment_id: paramApptId,
          symptoms,
          clinical_notes: clinicalNotes,
          diagnosis,
        })
        targetId = created.id
      }

      const res = await finaliseMutation.mutateAsync(targetId)
      setIsFinalised(true)
      setFinalisedAt(res.finalised_at)
      setVersionId(res.version_id)
      setActionSuccess('Consultation finalised and locked. Notes are now permanently immutable.')
      if (encounterId === 0) {
        navigate(`/doctor/encounters/${targetId}`, { replace: true })
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setConflictError(err.message)
      } else {
        setConflictError('Failed to finalise consultation.')
      }
    }
  }

  const handleAddAddendum = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addendumText.trim() || encounterId === 0) return

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
        <div className="p-8 text-center text-neutral-500">Loading consultation record...</div>
      </AppShell>
    )
  }

  if (encounterId > 0 && isEncounterError) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        <div role="alert" className="p-6 bg-red-50 text-red-700 rounded border border-red-200">
          Encounter access restricted or not found: {encounterError.message}
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      <div className="space-y-6 max-w-5xl mx-auto">
        {conflictError && (
          <ConflictBanner
            onReload={() => {
              setConflictError(null)
              if (encounterId > 0) refetchEncounter()
            }}
          />
        )}

        {actionSuccess && (
          <div role="status" className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-900 text-sm font-medium flex justify-between items-center">
            <span>&check; {actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="text-green-700 hover:text-green-900 font-bold">&times;</button>
          </div>
        )}

        {/* Top bar with back to queue */}
        <div className="flex justify-between items-center">
          <Link
            to="/doctor"
            className="text-sm font-semibold text-red-900 hover:underline flex items-center gap-1.5"
          >
            &larr; Back to Consultation Queue
          </Link>
          {isFinalised && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-300">
              🔒 Finalised & Locked ({finalisedAt ? new Date(finalisedAt).toLocaleDateString() : 'Locked'})
            </span>
          )}
        </div>

        {/* Patient Clinical Banner */}
        {patient && (
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-neutral-100 pb-4">
              <div>
                <span className="text-xs uppercase font-bold text-red-800 tracking-wider">Patient Clinical Record</span>
                <h2 className="text-2xl font-bold text-neutral-900 mt-0.5">{patient.full_name}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 mt-1 font-mono">
                  <span>URN: <strong className="text-neutral-900">{patient.urn}</strong></span>
                  <span>Age: <strong className="text-neutral-900">{patient.age_years} yrs</strong></span>
                  <span>Gender: <strong className="text-neutral-900">{patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : 'Other'}</strong></span>
                  <span>Mobile: <strong className="text-neutral-900">{patient.mobile}</strong></span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="px-3 py-1.5 border border-neutral-300 rounded text-xs font-semibold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1"
              >
                Past Encounters ({pastEncounters?.length || 0}) {showHistory ? '▲' : '▼'}
              </button>
            </div>

            {/* Allergies Alert */}
            {patient.allergies && patient.allergies !== 'None reported' ? (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-xs font-semibold flex items-center gap-2">
                <span>⚠️ Clinical Alert - Reported Allergies:</span>
                <span className="font-bold underline">{patient.allergies}</span>
              </div>
            ) : (
              <div className="text-xs text-neutral-500">
                Allergies: None reported
              </div>
            )}

            {/* Historical Encounters Dropdown */}
            {showHistory && pastEncounters && pastEncounters.length > 0 && (
              <div className="mt-3 p-4 bg-neutral-50 rounded border border-neutral-200 space-y-3">
                <h4 className="text-xs uppercase font-bold text-neutral-600 tracking-wider">Previous Consultations</h4>
                <div className="divide-y divide-neutral-200">
                  {pastEncounters.map((pe: EncounterSummary) => (
                    <div key={pe.id} className="py-2 flex justify-between items-center text-xs">
                      <div>
                        <span className="font-bold text-neutral-800">{new Date(pe.encounter_date).toLocaleDateString()}</span>
                        <span className="ml-3 text-neutral-600">Diagnosis: <strong>{pe.diagnosis}</strong></span>
                      </div>
                      <Link
                        to={`/doctor/encounters/${pe.id}`}
                        className="text-red-800 hover:underline font-semibold"
                      >
                        View Record &rarr;
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Clinical Form */}
        <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6 space-y-6">
          <h3 className="text-lg font-bold text-neutral-900 border-b pb-3">
            {isFinalised ? 'Consultation Record (Locked)' : 'Clinical Consultation Notes'}
          </h3>

          <form onSubmit={handleSaveDraft} className="space-y-6">
            {/* Symptoms / Chief Complaints */}
            <div>
              <label htmlFor="symptoms-field" className="block text-xs font-bold text-neutral-700 uppercase mb-2">
                Chief Complaints & Symptoms
              </label>
              {isFinalised ? (
                <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-sm text-neutral-800 whitespace-pre-wrap">
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
                  className="w-full p-3 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                />
              )}
            </div>

            {/* Clinical Examination & Progress Notes */}
            <div>
              <label htmlFor="notes-field" className="block text-xs font-bold text-neutral-700 uppercase mb-2">
                Clinical Examination & Progress Notes
              </label>
              {isFinalised ? (
                <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-sm text-neutral-800 whitespace-pre-wrap">
                  {clinicalNotes}
                </div>
              ) : (
                <textarea
                  id="notes-field"
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder="Physical examination findings, range of motion, anatomical tenderness, modalities applied..."
                  rows={5}
                  required
                  className="w-full p-3 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                />
              )}
            </div>

            {/* Diagnosis / Impression */}
            <div>
              <label htmlFor="diagnosis-field" className="block text-xs font-bold text-neutral-700 uppercase mb-2">
                Clinical Diagnosis / Impression
              </label>
              {isFinalised ? (
                <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-sm text-neutral-800 font-semibold">
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
                  className="w-full p-3 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                />
              )}
            </div>

            {/* Buttons when not finalised */}
            {!isFinalised && (
              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t">
                {effectivePatientId > 0 && (
                  <Link
                    to={`/doctor/treatment-plans?patient_id=${effectivePatientId}`}
                    className="px-4 py-2.5 border border-purple-600 text-purple-800 rounded font-semibold text-sm hover:bg-purple-50 flex items-center gap-1.5"
                  >
                    ⚡ Treatment Plan
                  </Link>
                )}
                {effectivePatientId > 0 && (
                  <Link
                    to={`/doctor/prescriptions/new?patient_id=${effectivePatientId}${encounterId ? `&encounter_id=${encounterId}` : ''}`}
                    className="px-4 py-2.5 border border-teal-600 text-teal-800 rounded font-semibold text-sm hover:bg-teal-50 flex items-center gap-1.5"
                  >
                    ℞ Write Prescription
                  </Link>
                )}
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-5 py-2.5 border border-neutral-300 rounded font-semibold text-sm hover:bg-neutral-50"
                >
                  Save Draft Notes
                </button>
                <button
                  type="button"
                  onClick={() => setShowFinaliseConfirm(true)}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-5 py-2.5 bg-red-900 text-white rounded font-semibold text-sm hover:bg-red-800 shadow-xs flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Finalise Consultation
                </button>
              </div>
            )}
          </form>

          {/* Addenda Section (Only enabled for finalised encounters) */}
          {isFinalised && (
            <div className="mt-8 pt-6 border-t border-neutral-200 space-y-6">
              <div className="flex justify-between items-center">
                <h4 className="text-base font-bold text-neutral-900">
                  Dated Clinical Addenda ({addenda.length})
                </h4>
                <span className="text-xs text-neutral-500 font-mono">Immutable audit trail</span>
              </div>

              {/* Addenda Timeline */}
              {addenda.length === 0 ? (
                <p className="text-xs text-neutral-500 italic">No addenda recorded for this encounter.</p>
              ) : (
                <div className="space-y-3">
                  {addenda.map((ad: AddendumRead, idx: number) => (
                    <div key={ad.id} className="p-4 bg-amber-50/50 rounded-lg border border-amber-200 space-y-1">
                      <div className="flex justify-between text-xs text-amber-900 font-semibold">
                        <span>Addendum #{idx + 1} &bull; Dr. {ad.doctor_name}</span>
                        <span className="font-mono">{new Date(ad.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-neutral-800 whitespace-pre-wrap">{ad.addendum_text}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Addendum */}
              <form onSubmit={handleAddAddendum} className="space-y-3 pt-3">
                <label htmlFor="addendum-input" className="block text-xs font-bold text-neutral-700 uppercase">
                  Append Follow-Up Addendum
                </label>
                <textarea
                  id="addendum-input"
                  value={addendumText}
                  onChange={(e) => setAddendumText(e.target.value)}
                  placeholder="Record follow-up remarks, phone consultation, or treatment adjustments..."
                  rows={3}
                  required
                  className="w-full p-3 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                />
                <button
                  type="submit"
                  disabled={addendumMutation.isPending || !addendumText.trim()}
                  className="px-4 py-2 bg-neutral-900 text-white rounded text-xs font-bold hover:bg-neutral-800 disabled:opacity-50"
                >
                  {addendumMutation.isPending ? 'Appending...' : '+ Append Addendum'}
                </button>
              </form>
            </div>
          )}
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
              <p className="text-xs text-neutral-600 text-center leading-relaxed">
                Once finalised, this clinical encounter will be permanently locked against modifications or deletions. Any subsequent changes can only be added as dated addenda.
              </p>
              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  data-autofocus
                  onClick={() => setShowFinaliseConfirm(false)}
                  className="px-4 py-2 border border-neutral-300 rounded text-sm font-medium hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmFinalise}
                  disabled={finaliseMutation.isPending}
                  className="px-4 py-2 bg-red-900 text-white rounded text-sm font-semibold hover:bg-red-800"
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
