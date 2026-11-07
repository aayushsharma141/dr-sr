import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { Modal } from '../components/Modal'
import { VitalsBiometricsSection } from '../components/VitalsBiometricsSection'
import { SpecialtyPhysiotherapyForm, type PhysiotherapyFormData } from '../components/SpecialtyPhysiotherapyForm'
import { SpecialtyOphthalmologyForm, type OphthalmologyFormData } from '../components/SpecialtyOphthalmologyForm'
import { PrescriptionFormSection } from '../components/PrescriptionFormSection'
import { FollowUpSection } from '../components/FollowUpSection'
import { AppointmentBookingModal } from '../components/AppointmentBookingModal'
import { ConsultationSummaryPrint } from '../components/ConsultationSummaryPrint'
import { QuickPhraseBar } from '../components/QuickPhraseBar'
import {
  IconStethoscope,
  IconHeartRateMonitor,
  IconNotes,
  IconPill,
  IconCalendarTime,
  IconCheck,
  IconAlertTriangle,
  IconPrinter,
  IconArrowLeft,
  IconLock,
  IconUser,
  IconHistory,
  IconCopy,
  IconDeviceFloppy,
  IconPlus,
} from '../components/icons'
import {
  usePatient,
  usePatientPriorEncounter,
  useEncounter,
  useCreateEncounter,
  useSaveEncounterDraft,
  useFinaliseEncounter,
  useAddAddendum,
  useEncounterVitals,
  useSaveVitals,
  useDepartmentTemplate,
  useEncounterTemplateResponse,
  useSaveEncounterTemplateResponse,
  useCreatePrescription,
  useAuthorisePrescription,
  useCancelPrescription,
  useEncounterFollowUp,
  useCreateFollowUp,
  useDoctors,
  useMe,
} from '../api/queries'
import type {
  AddendumRead,
  VitalObservationInput,
  PrescriptionItemCreate,
  PrescriptionOut,
  DoctorOut,
} from '../api/types'
import { withDoctorTitle } from '../format'

type AutoSaveStatus = 'IDLE' | 'SAVING' | 'SAVED' | 'OFFLINE_ERROR'

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

  // 1. Load existing encounter
  const {
    data: existingEncounter,
    isPending: isEncounterPending,
    isError: isEncounterError,
    error: encounterError,
    refetch: refetchEncounter,
  } = useEncounter(encounterId)

  // 2. Patient details & prior encounter
  const effectivePatientId = existingEncounter?.patient_id || paramPatientId || 0
  const { data: patient } = usePatient(effectivePatientId)
  const { data: priorEncounter } = usePatientPriorEncounter(effectivePatientId, encounterId)
  const { data: doctorsData } = useDoctors(false)
  const doctors: DoctorOut[] = Array.isArray(doctorsData) ? doctorsData : []

  // 3. Vitals & Specialty Template queries
  const { data: serverVitals } = useEncounterVitals(encounterId)
  const departmentId = existingEncounter?.department_id || (me?.doctor_id ? 1 : 1)
  const { data: deptTemplate } = useDepartmentTemplate(departmentId)
  const { data: serverTemplateResponse } = useEncounterTemplateResponse(encounterId)

  // 4. Follow-up recommendation
  const { data: serverFollowUp } = useEncounterFollowUp(encounterId)

  // Form State: Core Encounter
  const [symptoms, setSymptoms] = useState('')
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [versionId, setVersionId] = useState(1)
  const [isFinalised, setIsFinalised] = useState(false)
  const [finalisedAt, setFinalisedAt] = useState<string | null>(null)
  const [addenda, setAddenda] = useState<AddendumRead[]>([])

  // Form State: Vitals
  const [vitals, setVitals] = useState<VitalObservationInput>({
    height_cm: null,
    weight_kg: null,
    systolic_bp: null,
    diastolic_bp: null,
    pulse_bpm: null,
    temperature_f: null,
    respiratory_rate: null,
    spo2_percent: null,
  })

  // Form State: Specialty Form
  const [specialtyData, setSpecialtyData] = useState<Record<string, any>>({})

  // Form State: Prescription
  const [prescriptionItems, setPrescriptionItems] = useState<PrescriptionItemCreate[]>([])
  const [dietaryAdvice, setDietaryAdvice] = useState('')
  const [generalAdvice, setGeneralAdvice] = useState('')
  const [activeRxRecord, setActiveRxRecord] = useState<PrescriptionOut | null>(null)

  // Form State: Follow-up
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpDoctorId, setFollowUpDoctorId] = useState<number | null>(null)
  const [followUpReason, setFollowUpReason] = useState('')

  // UI / Auto-Save State
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('IDLE')
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [showFinaliseConfirm, setShowFinaliseConfirm] = useState(false)
  const [finaliseError, setFinaliseError] = useState<string | null>(null)
  const [addendumText, setAddendumText] = useState('')
  const [activeAnchor, setActiveAnchor] = useState('section-complaints')
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [showPrintSummary, setShowPrintSummary] = useState(false)
  const [showAllVitals, setShowAllVitals] = useState(false)
  const [showSpecialty, setShowSpecialty] = useState(true)
  const [showTreatmentPlan, setShowTreatmentPlan] = useState(true)

  // Track user modifications
  const isDirtyRef = useRef(false)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Mutations
  const createMutation = useCreateEncounter()
  const saveDraftMutation = useSaveEncounterDraft(encounterId)
  const finaliseMutation = useFinaliseEncounter()
  const addendumMutation = useAddAddendum()
  const saveVitalsMutation = useSaveVitals(encounterId)
  const saveTemplateResponseMutation = useSaveEncounterTemplateResponse(encounterId)
  const createRxMutation = useCreatePrescription()
  const authoriseRxMutation = useAuthorisePrescription()
  const cancelRxMutation = useCancelPrescription()
  const createFollowUpMutation = useCreateFollowUp(encounterId)

  // Populate from existing encounter
  useEffect(() => {
    if (existingEncounter) {
      setSymptoms(existingEncounter.symptoms || '')
      setClinicalNotes(existingEncounter.clinical_notes || '')
      setDiagnosis(existingEncounter.diagnosis || '')
      setVersionId(existingEncounter.version_id)
      setIsFinalised(existingEncounter.is_finalised)
      setFinalisedAt(existingEncounter.finalised_at)
      setAddenda(existingEncounter.addenda || [])
    }
  }, [existingEncounter])

  // Populate vitals
  useEffect(() => {
    if (serverVitals) {
      setVitals({
        height_cm: serverVitals.height_cm,
        weight_kg: serverVitals.weight_kg,
        systolic_bp: serverVitals.systolic_bp,
        diastolic_bp: serverVitals.diastolic_bp,
        pulse_bpm: serverVitals.pulse_bpm,
        temperature_f: serverVitals.temperature_f,
        respiratory_rate: serverVitals.respiratory_rate,
        spo2_percent: serverVitals.spo2_percent,
      })
    }
  }, [serverVitals])

  // Populate specialty template response
  useEffect(() => {
    if (serverTemplateResponse?.response_data) {
      setSpecialtyData(serverTemplateResponse.response_data)
    }
  }, [serverTemplateResponse])

  // Populate follow-up
  useEffect(() => {
    if (serverFollowUp) {
      setFollowUpDate(serverFollowUp.recommended_date)
      setFollowUpDoctorId(serverFollowUp.recommended_doctor_id)
      setFollowUpReason(serverFollowUp.clinical_reason || '')
    }
  }, [serverFollowUp])

  // Auto-Save Execution Engine
  const performAutoSave = useCallback(async () => {
    if (encounterId === 0 || isFinalised) return
    setAutoSaveStatus('SAVING')
    setConflictError(null)

    try {
      // 1. Save Encounter Draft
      const res = await saveDraftMutation.mutateAsync({
        symptoms,
        clinical_notes: clinicalNotes,
        diagnosis,
        version_id: versionId,
      })
      setVersionId(res.version_id)

      // 2. Save Vitals if any vital entered
      const hasVitals = Object.values(vitals).some((v) => v !== null && v !== undefined && v !== '')
      if (hasVitals) {
        await saveVitalsMutation.mutateAsync(vitals)
      }

      // 3. Save Specialty Template Response if schema & data exist
      const activeVersionId = deptTemplate?.active_version?.id
      if (activeVersionId && Object.keys(specialtyData).length > 0) {
        await saveTemplateResponseMutation.mutateAsync({
          template_version_id: activeVersionId,
          response_data: specialtyData,
        })
      }

      // 4. Save Follow-up recommendation if date entered
      if (followUpDate) {
        await createFollowUpMutation.mutateAsync({
          recommended_date: followUpDate,
          recommended_doctor_id: followUpDoctorId,
          clinical_reason: followUpReason || undefined,
        })
      }

      // Mark success with timestamp
      const now = new Date()
      const timeStr = now.toTimeString().split(' ')[0]
      setLastSavedTime(timeStr)
      setAutoSaveStatus('SAVED')
      isDirtyRef.current = false
    } catch (err: any) {
      if (err?.status === 409) {
        setConflictError('Encounter was modified concurrently by another session.')
      } else {
        setAutoSaveStatus('OFFLINE_ERROR')
      }
    }
  }, [
    encounterId,
    isFinalised,
    symptoms,
    clinicalNotes,
    diagnosis,
    versionId,
    vitals,
    specialtyData,
    deptTemplate,
    followUpDate,
    followUpDoctorId,
    followUpReason,
    createFollowUpMutation,
    saveDraftMutation,
    saveVitalsMutation,
    saveTemplateResponseMutation,
  ])

  // Schedule auto-save on typing (~3000ms pause)
  const scheduleAutoSave = useCallback(() => {
    if (isFinalised) return
    isDirtyRef.current = true
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave()
    }, 3000)
  }, [isFinalised, performAutoSave])

  // Save on section blur
  const handleSectionBlur = useCallback(() => {
    if (isDirtyRef.current && !isFinalised && encounterId > 0) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      performAutoSave()
    }
  }, [isFinalised, encounterId, performAutoSave])

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  // Auto-retry if OFFLINE_ERROR
  useEffect(() => {
    if (autoSaveStatus === 'OFFLINE_ERROR') {
      const retryTimer = setTimeout(() => {
        performAutoSave()
      }, 5000)
      return () => clearTimeout(retryTimer)
    }
  }, [autoSaveStatus, performAutoSave])

  // Copy Section Findings Handlers (D-19-08)
  const handleAppendQuickPhrase = (phrase: string) => {
    if (isFinalised) return
    setSymptoms((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return phrase
      if (trimmed.endsWith(',') || trimmed.endsWith('.')) {
        return `${trimmed} ${phrase}`
      }
      return `${trimmed}, ${phrase}`
    })
    scheduleAutoSave()
  }

  const handleCopySymptoms = () => {
    if (priorEncounter?.symptoms) {
      setSymptoms(priorEncounter.symptoms)
      scheduleAutoSave()
    }
  }

  const handleCopyVitals = () => {
    if (priorEncounter?.vitals) {
      setVitals({
        height_cm: priorEncounter.vitals.height_cm,
        weight_kg: priorEncounter.vitals.weight_kg,
        systolic_bp: priorEncounter.vitals.systolic_bp,
        diastolic_bp: priorEncounter.vitals.diastolic_bp,
        pulse_bpm: priorEncounter.vitals.pulse_bpm,
        temperature_f: priorEncounter.vitals.temperature_f,
        respiratory_rate: priorEncounter.vitals.respiratory_rate,
        spo2_percent: priorEncounter.vitals.spo2_percent,
      })
      scheduleAutoSave()
    }
  }

  const handleCopyDiagnosis = () => {
    if (priorEncounter?.diagnosis) {
      setDiagnosis(priorEncounter.diagnosis)
      scheduleAutoSave()
    }
  }

  // Prescription Handlers
  const handleAuthorisePrescription = async () => {
    if (activeRxRecord?.id) {
      await authoriseRxMutation.mutateAsync(activeRxRecord.id)
      setActiveRxRecord({ ...activeRxRecord, status: 'AUTHORISED', is_printable: true })
      setActionSuccess('Prescription authorised successfully.')
    } else {
      // Create new active prescription as AUTHORISED
      const res = await createRxMutation.mutateAsync({
        patient_id: effectivePatientId,
        encounter_id: encounterId > 0 ? encounterId : null,
        status: 'AUTHORISED',
        diagnosis: diagnosis || 'General Clinical Consultation',
        dietary_advice: dietaryAdvice || null,
        general_advice: generalAdvice || null,
        follow_up_date: followUpDate || null,
        items: prescriptionItems,
      })
      setActiveRxRecord(res)
      setActionSuccess('Prescription created and authorised.')
    }
  }

  const handleCancelAndReissuePrescription = async (reason: string) => {
    if (activeRxRecord?.id) {
      await cancelRxMutation.mutateAsync({ id: activeRxRecord.id, reason })
      setActiveRxRecord(null)
      setPrescriptionItems([])
      setActionSuccess('Prescription cancelled. You can now author a re-issued prescription.')
    }
  }

  // Finalisation Handler
  const handleFinaliseConsultation = async () => {
    setFinaliseError(null)
    if (!symptoms.trim() || symptoms.trim().length < 2) {
      setFinaliseError('Chief Complaint is required (minimum 2 characters).')
      setShowFinaliseConfirm(false)
      document.getElementById('section-complaints')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    if (!diagnosis.trim() || diagnosis.trim().length < 2) {
      setFinaliseError('Diagnosis is required (minimum 2 characters).')
      setShowFinaliseConfirm(false)
      document.getElementById('section-diagnosis')?.scrollIntoView({ behavior: 'smooth' })
      return
    }

    try {
      let targetId = encounterId
      if (encounterId === 0) {
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
      setShowFinaliseConfirm(false)
      setActionSuccess('Consultation finalised and locked. Notes are now permanently immutable.')
      if (encounterId === 0) {
        navigate(`/doctor/encounters/${targetId}`, { replace: true })
      }
    } catch (err: any) {
      setFinaliseError(err?.message || 'Failed to finalise consultation.')
      setShowFinaliseConfirm(false)
    }
  }

  // Addendum Handler
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
      setActionSuccess('Addendum successfully appended to consultation record.')
    } catch (err: any) {
      setConflictError(err?.message || 'Failed to append addendum.')
    }
  }

  const isPhysiotherapy =
    deptTemplate?.code === 'PHYSIOTHERAPY' ||
    (existingEncounter?.department_id === 1 && deptTemplate?.code !== 'OPHTHALMOLOGY')

  const scrollToAnchor = (anchorId: string) => {
    setActiveAnchor(anchorId)
    const el = document.getElementById(anchorId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  if (encounterId > 0 && isEncounterPending) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        <div className="p-12 text-center text-neutral-500 font-medium">
          Loading clinical encounter workspace...
        </div>
      </AppShell>
    )
  }

  if (encounterId > 0 && isEncounterError) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        <div role="alert" className="p-6 bg-red-50 text-red-700 rounded border border-red-200 m-6">
          Encounter access restricted or not found: {encounterError?.message}
        </div>
      </AppShell>
    )
  }

  const patientName = patient?.full_name || existingEncounter?.patient_name || 'Consultation Patient'
  const patientUrn = patient?.urn || existingEncounter?.patient_urn || 'KH-2026-XXXX'
  const departmentName = deptTemplate?.name_en || (isPhysiotherapy ? 'Physiotherapy' : 'Ophthalmology')

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      <div className="min-h-screen bg-[#0E131F] text-slate-100 pb-20">
        {/* Sticky Top Clinical Header matching Mockup */}
        <header
          data-testid="sticky-clinical-header"
          className="sticky top-0 z-30 bg-[#0B132B] border-b border-slate-800 px-6 py-3 shadow-md"
        >
          <div className="max-w-7xl mx-auto space-y-3">
            {/* Top Row: Navigation, Patient ID, Auto-save & Header Actions */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Link
                  to="/doctor"
                  className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  title="Return to Consultation Queue"
                  aria-label="Return to Doctor Queue"
                >
                  <IconArrowLeft size={18} />
                </Link>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold tracking-widest uppercase text-slate-500">
                      CURRENT CONSULTATION
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="text-xs font-bold font-mono text-slate-200">
                      Token #{existingEncounter?.appointment_id ? String(existingEncounter.appointment_id).padStart(3, '0') : '004'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3 mt-0.5">
                    <h1 className="text-xl font-bold text-white leading-tight">
                      {patientName}
                    </h1>
                    <span className="text-xs text-slate-500 font-mono">
                      Patient ID: {patientUrn} · OPD Visit
                    </span>
                  </div>
                </div>
              </div>

              {/* Center: Auto-Save Status Pill */}
              <div className="flex items-center">
                {autoSaveStatus === 'SAVING' && (
                  <div
                    data-testid="auto-save-pill"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-950 text-amber-200 border border-amber-700"
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    Saving consultation draft...
                  </div>
                )}
                {autoSaveStatus === 'SAVED' && lastSavedTime && (
                  <div
                    data-testid="auto-save-pill"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-emerald-200 bg-emerald-950 border border-emerald-700"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Saved to server at {lastSavedTime}
                  </div>
                )}
                {autoSaveStatus === 'OFFLINE_ERROR' && (
                  <div
                    role="alert"
                    data-testid="auto-save-pill"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-950 text-red-200 border border-red-700"
                  >
                    <IconAlertTriangle size={14} />
                    <span>⚠️</span>
                    Network error — unsaved changes present. Retrying connection...
                  </div>
                )}
                {autoSaveStatus === 'IDLE' && isFinalised && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-200 border border-emerald-700">
                    <IconLock size={14} />
                    🔒 Finalised & Locked
                  </span>
                )}
              </div>

              {/* Right: Primary Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAuthorisePrescription}
                  disabled={isFinalised || activeRxRecord?.status === 'AUTHORISED' || prescriptionItems.length === 0}
                  className="px-3.5 py-1.5 border border-teal-600 text-teal-300 rounded-lg text-xs font-semibold hover:bg-teal-900/30 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                >
                  <IconPill size={15} />
                  <span>Authorise Prescription</span>
                </button>

                <button
                  type="button"
                  disabled={!isFinalised}
                  onClick={() => setShowPrintSummary(true)}
                  className="px-3.5 py-1.5 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                >
                  <IconPrinter size={15} />
                  <span>Print Consultation Summary</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowFinaliseConfirm(true)}
                  disabled={isFinalised}
                  className="px-4 py-1.5 bg-[#8E1C3D] hover:bg-[#721631] text-white rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors shadow-xs inline-flex items-center gap-1.5"
                >
                  <IconCheck size={15} />
                  <span>Finalise Consultation</span>
                </button>
              </div>
            </div>

            {/* Hero Patient Row matching Mockup */}
            <div className="bg-[#142035] border border-slate-700/60 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200">
                  <IconUser size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      {patientName}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded font-semibold bg-teal-950 text-teal-200 border border-teal-700 uppercase tracking-wider">
                      {departmentName}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {patient ? `${patient.age_years} years · ${patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : 'Other'} · ` : ''}
                    New consultation
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {patient?.allergies && patient.allergies !== 'None reported' ? (
                  <span
                    data-testid="allergy-alert-badge"
                    className="bg-[#8E1C3D] text-white font-semibold px-2.5 py-1 rounded-full text-xs inline-flex items-center gap-1.5 shadow-2xs border border-red-700"
                  >
                    <IconAlertTriangle size={14} />
                    <span>⚠️ ALLERGY:</span>
                    <span>{patient.allergies}</span>
                  </span>
                ) : null}

                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-950 text-blue-200 border border-blue-700">
                  Waiting
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Sleek Horizontal Anchor Jump Navigation Strip */}
        <div className="bg-[#0B1220] border-b border-slate-800/80 sticky top-28 z-20 shadow-2xs">
          <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-between gap-3 overflow-x-auto">
            <nav
              data-testid="jump-navigation-rail"
              aria-label="Consultation Jump Navigation"
              className="flex items-center gap-1.5 min-w-max"
            >
              {[
                { id: 'section-complaints', label: '1. Chief Complaints & HPI', icon: IconNotes },
                { id: 'section-vitals', label: '2. Vital Signs & Biometrics', icon: IconHeartRateMonitor },
                { id: 'section-specialty', label: '3. Specialty Assessment', icon: IconStethoscope },
                { id: 'section-diagnosis', label: '4. Diagnosis & Impressions', icon: IconCheck },
                { id: 'section-prescriptions', label: '5. Prescriptions & Medications', icon: IconPill },
                { id: 'section-followup', label: '6. Follow-up Recommendation', icon: IconCalendarTime },
              ].map((anchor) => {
                const isActive = activeAnchor === anchor.id
                const Icon = anchor.icon
                return (
                  <button
                    key={anchor.id}
                    type="button"
                    onClick={() => scrollToAnchor(anchor.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-colors ${
                      isActive
                        ? 'bg-teal-700 text-white font-semibold shadow-2xs'
                        : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 font-medium'
                    }`}
                  >
                    <Icon size={14} />
                    <span>{anchor.label}</span>
                  </button>
                )
              })}
            </nav>
            <Link
              to="/doctor"
              className="text-xs text-slate-500 hover:text-white flex items-center gap-1 font-medium whitespace-nowrap shrink-0"
            >
              <IconArrowLeft size={14} />
              <span>Back to Queue</span>
            </Link>
          </div>
        </div>

        {/* Global Conflict / Notification Banners */}
        <div className="max-w-7xl mx-auto px-6 pt-4 space-y-3">
          {conflictError && (
            <ConflictBanner
              onReload={() => {
                setConflictError(null)
                if (encounterId > 0) refetchEncounter()
              }}
            />
          )}

          {actionSuccess && (
            <div
              role="status"
              className="p-3 bg-emerald-950/80 border border-emerald-700 rounded-xl text-emerald-200 text-xs font-medium flex justify-between items-center"
            >
              <span>&check; {actionSuccess}</span>
              <button
                onClick={() => setActionSuccess(null)}
                className="text-emerald-400 hover:text-white font-bold"
              >
                &times;
              </button>
            </div>
          )}

          {finaliseError && (
            <div
              role="alert"
              className="p-3 bg-red-950/80 border border-red-700 rounded-xl text-red-200 text-xs font-medium flex justify-between items-center"
            >
              <span>⚠️ {finaliseError}</span>
              <button
                onClick={() => setFinaliseError(null)}
                className="text-red-400 hover:text-white font-bold"
              >
                &times;
              </button>
            </div>
          )}
        </div>

        {/* Option C: Consultation-First Workspace Grid matching Mockup */}
        <main className="max-w-7xl mx-auto px-6 pt-6 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
          {/* Main Clinical Consultation Column */}
          <div className="min-w-0 space-y-6">
            {/* Section: Reason for visit */}
            <section
              id="section-complaints"
              data-testid="section-complaints"
              className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-6 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                <h2 className="text-base font-bold text-white">
                  Reason for visit
                </h2>
                <span className="text-xs text-slate-500">Chief Complaint & History</span>
              </div>

              {/* Quick Phrase Bar with Presets & Doctor Custom Add (+) */}
              {!isFinalised && (
                <QuickPhraseBar
                  departmentCode={deptTemplate?.code}
                  onSelectPhrase={handleAppendQuickPhrase}
                />
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="symptoms-input"
                  className="block text-xs font-semibold text-slate-200 uppercase tracking-wider"
                >
                  Chief Complaints & Symptoms <span className="text-red-600">*</span>
                </label>
                {isFinalised ? (
                  <div className="p-3.5 bg-[#0D121D] rounded-xl border border-slate-700 text-sm text-slate-100 whitespace-pre-wrap">
                    {symptoms}
                  </div>
                ) : (
                  <textarea
                    id="symptoms-input"
                    rows={3}
                    value={symptoms}
                    onChange={(e) => {
                      setSymptoms(e.target.value)
                      scheduleAutoSave()
                    }}
                    onBlur={handleSectionBlur}
                    placeholder="Patient presenting with lower back pain for approximately 2 weeks (or select quick phrases above)..."
                    className="w-full p-3.5 bg-[#0D121D] border border-slate-700 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                )}
              </div>
            </section>

            {/* 1. Quick observations */}
            <section
              id="section-vitals"
              data-testid="section-vitals"
              className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-6 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                <h2 className="text-base font-bold text-white">
                  1. Quick observations
                </h2>
                {serverVitals?.bmi && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-950 text-emerald-200 border border-emerald-700">
                    BMI: {serverVitals.bmi} kg/m²
                  </span>
                )}
              </div>

              {/* 3 Prominent Metric Cards matching Mockup */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* BP */}
                <div className="bg-[#0D121D] border border-slate-700/80 rounded-xl p-4 space-y-1.5">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-200">
                    BP
                  </span>
                  <div className="flex items-baseline gap-1">
                    <input
                      type="number"
                      aria-label="Systolic BP"
                      placeholder="120"
                      disabled={isFinalised}
                      value={vitals.systolic_bp ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value)
                        setVitals({ ...vitals, systolic_bp: val })
                        scheduleAutoSave()
                      }}
                      onBlur={handleSectionBlur}
                      className="w-14 bg-transparent text-xl font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-teal-500 rounded px-1"
                    />
                    <span className="text-slate-500 font-bold text-lg">/</span>
                    <input
                      type="number"
                      aria-label="Diastolic BP"
                      placeholder="80"
                      disabled={isFinalised}
                      value={vitals.diastolic_bp ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value)
                        setVitals({ ...vitals, diastolic_bp: val })
                        scheduleAutoSave()
                      }}
                      onBlur={handleSectionBlur}
                      className="w-14 bg-transparent text-xl font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-teal-500 rounded px-1"
                    />
                    <span className="text-xs text-slate-500 ml-1">mmHg</span>
                  </div>
                </div>

                {/* Pulse */}
                <div className="bg-[#0D121D] border border-slate-700/80 rounded-xl p-4 space-y-1.5">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-200">
                    Pulse
                  </span>
                  <div className="flex items-baseline gap-1">
                    <input
                      type="number"
                      aria-label="Pulse rate"
                      placeholder="78"
                      disabled={isFinalised}
                      value={vitals.pulse_bpm ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value)
                        setVitals({ ...vitals, pulse_bpm: val })
                        scheduleAutoSave()
                      }}
                      onBlur={handleSectionBlur}
                      className="w-20 bg-transparent text-xl font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-teal-500 rounded px-1"
                    />
                    <span className="text-xs text-slate-500 ml-1">bpm</span>
                  </div>
                </div>

                {/* Temperature */}
                <div className="bg-[#0D121D] border border-slate-700/80 rounded-xl p-4 space-y-1.5">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-200">
                    Temperature
                  </span>
                  <div className="flex items-baseline gap-1">
                    <input
                      type="number"
                      step="0.1"
                      aria-label="Body temperature"
                      placeholder="98.6"
                      disabled={isFinalised}
                      value={vitals.temperature_f ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value)
                        setVitals({ ...vitals, temperature_f: val })
                        scheduleAutoSave()
                      }}
                      onBlur={handleSectionBlur}
                      className="w-20 bg-transparent text-xl font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-teal-500 rounded px-1"
                    />
                    <span className="text-xs text-slate-500 ml-1">°F</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                <span>Optional · Record only relevant observations</span>
                <button
                  type="button"
                  onClick={() => setShowAllVitals(!showAllVitals)}
                  className="text-xs font-medium text-teal-300 hover:text-teal-200 underline"
                >
                  {showAllVitals ? 'Hide additional observations' : '+ Additional observations (Height, Weight, SpO2, BMI)'}
                </button>
              </div>

              {/* Full Vitals Component */}
              <div className={showAllVitals ? 'pt-4 border-t border-slate-700/60' : 'sr-only'}>
                <VitalsBiometricsSection
                  vitals={vitals}
                  onChange={(newVitals) => {
                    setVitals(newVitals)
                    scheduleAutoSave()
                  }}
                  onBlur={handleSectionBlur}
                  readOnly={isFinalised}
                  serverBmi={serverVitals?.bmi ? Number(serverVitals.bmi) : null}
                />
              </div>
            </section>

            {/* 2. Clinical notes */}
            <section className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="border-b border-slate-700/60 pb-3">
                <h2 className="text-base font-bold text-white">
                  2. Clinical notes
                </h2>
              </div>

              {/* Examination findings */}
              <div className="space-y-1.5">
                <label
                  htmlFor="clinical-notes-input"
                  className="block text-xs font-semibold text-slate-200 uppercase tracking-wider"
                >
                  Examination findings
                </label>
                {isFinalised ? (
                  <div className="p-3.5 bg-[#0D121D] rounded-xl border border-slate-700 text-sm text-slate-100 whitespace-pre-wrap">
                    {clinicalNotes}
                  </div>
                ) : (
                  <textarea
                    id="clinical-notes-input"
                    rows={3}
                    value={clinicalNotes}
                    onChange={(e) => {
                      setClinicalNotes(e.target.value)
                      scheduleAutoSave()
                    }}
                    onBlur={handleSectionBlur}
                    placeholder="Enter examination findings..."
                    className="w-full p-3.5 bg-[#0D121D] border border-slate-700 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                )}
              </div>

              {/* Diagnosis */}
              <div id="section-diagnosis" data-testid="section-diagnosis" className="space-y-1.5 pt-1">
                <label
                  htmlFor="diagnosis-input"
                  className="block text-xs font-semibold text-slate-200 uppercase tracking-wider"
                >
                  Diagnosis <span className="text-red-600">*</span>
                </label>
                {isFinalised ? (
                  <div className="p-3 bg-[#0D121D] rounded-xl border border-slate-700 text-sm font-semibold text-slate-100">
                    {diagnosis}
                  </div>
                ) : (
                  <input
                    id="diagnosis-input"
                    type="text"
                    value={diagnosis}
                    onChange={(e) => {
                      setDiagnosis(e.target.value)
                      scheduleAutoSave()
                    }}
                    onBlur={handleSectionBlur}
                    placeholder="Enter diagnosis..."
                    className="w-full px-3.5 py-2.5 bg-[#0D121D] border border-slate-700 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                )}
              </div>
            </section>

            {/* 3. Treatment & prescription */}
            <section
              id="section-prescriptions"
              data-testid="section-prescriptions"
              className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-6 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                <h2 className="text-base font-bold text-white">
                  3. Treatment & prescription
                </h2>
                <span className="text-xs text-slate-500">Therapy & Orders</span>
              </div>

              {/* Specialty Assessment */}
              <div id="section-specialty" data-testid="section-specialty" className="space-y-3">
                <div className="bg-[#0D121D] border border-slate-700/80 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">
                      {isPhysiotherapy ? 'Physiotherapy Clinical Examination' : 'Ophthalmology Clinical Examination'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSpecialty(!showSpecialty)}
                      className="text-xs font-semibold text-teal-300 hover:text-teal-200"
                    >
                      {showSpecialty ? 'Collapse' : '+ Expand assessment'}
                    </button>
                  </div>

                  <div className={showSpecialty ? 'pt-4 border-t border-slate-700/60 mt-3' : 'sr-only'}>
                    {isPhysiotherapy ? (
                      <SpecialtyPhysiotherapyForm
                        data={specialtyData as PhysiotherapyFormData}
                        onChange={(newData) => {
                          setSpecialtyData(newData)
                          scheduleAutoSave()
                        }}
                        onBlur={handleSectionBlur}
                        readOnly={isFinalised}
                      />
                    ) : (
                      <SpecialtyOphthalmologyForm
                        data={specialtyData as OphthalmologyFormData}
                        onChange={(newData) => {
                          setSpecialtyData(newData)
                          scheduleAutoSave()
                        }}
                        onBlur={handleSectionBlur}
                        readOnly={isFinalised}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Treatment Plan Card matching Mockup */}
              <div className="bg-[#0D121D] border border-slate-700/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-sm font-semibold text-white">
                      Treatment plan
                    </span>
                    <span className="text-xs text-slate-500">
                      Add treatment, medication or procedure...
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTreatmentPlan(!showTreatmentPlan)}
                    className="text-teal-300 hover:text-teal-200 p-1"
                    aria-label="Toggle Treatment Plan"
                  >
                    <IconPlus size={18} />
                  </button>
                </div>

                <div className={showTreatmentPlan ? 'pt-3 border-t border-slate-700/60' : 'sr-only'}>
                  <PrescriptionFormSection
                    prescription={activeRxRecord}
                    items={prescriptionItems}
                    diagnosis={diagnosis}
                    dietaryAdvice={dietaryAdvice}
                    generalAdvice={generalAdvice}
                    onItemsChange={(newItems) => {
                      setPrescriptionItems(newItems)
                      scheduleAutoSave()
                    }}
                    onDietaryAdviceChange={(val) => {
                      setDietaryAdvice(val)
                      scheduleAutoSave()
                    }}
                    onGeneralAdviceChange={(val) => {
                      setGeneralAdvice(val)
                      scheduleAutoSave()
                    }}
                    onAuthorise={handleAuthorisePrescription}
                    onCancelAndReissue={handleCancelAndReissuePrescription}
                    onBlur={handleSectionBlur}
                    readOnly={isFinalised}
                    isAuthorising={authoriseRxMutation.isPending || createRxMutation.isPending}
                    isCancelling={cancelRxMutation.isPending}
                  />
                </div>
              </div>
            </section>

            {/* 4. Follow-up */}
            <section
              id="section-followup"
              data-testid="section-followup"
              className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-6 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                <h2 className="text-base font-bold text-white">
                  4. Follow-up
                </h2>
                <span className="text-xs text-slate-500">Next review date</span>
              </div>

              <div className="bg-[#0D121D] border border-slate-700/80 rounded-xl p-4">
                <FollowUpSection
                  recommendedDate={followUpDate}
                  recommendedDoctorId={followUpDoctorId}
                  clinicalReason={followUpReason}
                  doctors={doctors}
                  onDateChange={(val) => {
                    setFollowUpDate(val)
                    scheduleAutoSave()
                  }}
                  onDoctorChange={(id) => {
                    setFollowUpDoctorId(id)
                    scheduleAutoSave()
                  }}
                  onReasonChange={(val) => {
                    setFollowUpReason(val)
                    scheduleAutoSave()
                  }}
                  onBookNow={() => setShowBookingModal(true)}
                  onBlur={handleSectionBlur}
                  readOnly={isFinalised}
                />
              </div>
            </section>

            {/* Finalised Addenda Audit Section */}
            {isFinalised && (
              <section
                data-testid="section-addenda"
                className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-6 space-y-4 shadow-sm"
              >
                <div className="flex justify-between items-center border-b border-slate-700/60 pb-2">
                  <h3 className="text-base font-semibold text-white">
                    Dated Clinical Addenda ({addenda.length})
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">Immutable audit trail</span>
                </div>

                {addenda.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No addenda recorded for this encounter.</p>
                ) : (
                  <div className="space-y-3">
                    {addenda.map((ad: AddendumRead, idx: number) => (
                      <div
                        key={ad.id}
                        className="p-3 bg-amber-950/60 rounded-xl border border-amber-700/80 space-y-1 text-xs"
                      >
                        <div className="flex justify-between text-amber-200 font-semibold">
                          <span>Addendum #{idx + 1} &bull; {withDoctorTitle(ad.doctor_name)}</span>
                          <span className="font-mono">{new Date(ad.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-slate-100 whitespace-pre-wrap">{ad.addendum_text}</p>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAddAddendum} className="space-y-2 pt-2">
                  <label htmlFor="addendum-field" className="block text-xs font-semibold text-slate-200 uppercase">
                    Append Addendum Note
                  </label>
                  <textarea
                    id="addendum-field"
                    rows={3}
                    value={addendumText}
                    onChange={(e) => setAddendumText(e.target.value)}
                    placeholder="Record follow-up remarks, phone consultation, or post-finalisation consultation addendum note..."
                    className="w-full p-3 bg-[#0D121D] border border-slate-700 rounded-xl text-xs text-slate-100 focus:ring-1 focus:ring-teal-500"
                  />
                  <button
                    type="submit"
                    disabled={addendumMutation.isPending || !addendumText.trim()}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 disabled:opacity-50"
                  >
                    {addendumMutation.isPending ? 'Appending...' : '+ Append Addendum'}
                  </button>
                </form>
              </section>
            )}

            {/* Bottom Action Bar matching Mockup */}
            <div className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">
                  {isFinalised
                    ? 'Consultation finalised & locked'
                    : autoSaveStatus === 'SAVED' && lastSavedTime
                    ? `Draft · Saved to server at ${lastSavedTime}`
                    : 'Draft · Not yet submitted'}
                </span>
                <span className="px-3 py-1 rounded-full font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700">
                  {isFinalised ? 'Finalised' : 'Ready to save'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowFinaliseConfirm(true)}
                disabled={isFinalised}
                className="w-full py-3.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-base font-bold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <IconDeviceFloppy size={20} stroke={2} />
                <span>Save consultation</span>
              </button>
            </div>
          </div>

          {/* Right Context Panel (Patient Demographics & Prior Encounter) */}
          <aside
            data-testid="persistent-side-panel"
            aria-label="Patient and Prior Consultation Card"
            className="w-full xl:sticky xl:top-28 space-y-4"
          >
            {/* Demographics Card */}
            {patient && (
              <div className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-teal-900/60 text-teal-200 border border-teal-700 flex items-center justify-center font-bold text-sm">
                    {patient.full_name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{patient.full_name}</h3>
                    <div className="text-xs font-mono text-slate-500">{patient.urn}</div>
                  </div>
                </div>

                <div className="text-xs text-slate-200 divide-y divide-slate-800 font-mono">
                  <div className="py-1.5 flex justify-between">
                    <span className="text-slate-500">Mobile:</span>
                    <strong className="text-white">{patient.mobile || '—'}</strong>
                  </div>
                  <div className="py-1.5 flex justify-between">
                    <span className="text-slate-500">Emergency:</span>
                    <strong className="text-white">{patient.emergency_contact || '—'}</strong>
                  </div>
                  <div className="py-1.5 flex justify-between">
                    <span className="text-slate-500">Address:</span>
                    <span className="text-slate-200 font-sans truncate max-w-[140px] text-right">
                      {patient.address || '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Severe Allergy Alert Card */}
            {patient?.allergies && patient.allergies !== 'None reported' ? (
              <div className="bg-[#8E1C3D] text-white rounded-2xl p-4 shadow-sm space-y-1 border border-red-700">
                <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <IconAlertTriangle size={15} />
                  <span>Severe Allergy Warning</span>
                </div>
                <p className="text-xs font-medium leading-relaxed">
                  {patient.allergies}
                </p>
              </div>
            ) : (
              <div className="bg-[#18202F] border border-slate-700/70 text-slate-500 rounded-2xl p-3 text-xs">
                <span className="font-semibold text-slate-200">Allergies: </span>
                None reported
              </div>
            )}

            {/* Prior Consultation Side Card (D-19-07, D-19-08) */}
            <div
              data-testid="prior-encounter-card"
              className="bg-[#18202F] border border-slate-700/70 rounded-2xl p-4 shadow-sm space-y-4"
            >
              <div className="border-b border-slate-700/60 pb-2">
                <div className="flex items-center gap-2">
                  <IconHistory size={16} className="text-slate-500" />
                  <h4 className="text-sm font-semibold text-white">
                    Previous Consultation Card
                  </h4>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Read-only findings from most recent prior visit.
                </p>
              </div>

              {!priorEncounter ? (
                <div className="py-4 text-center space-y-2">
                  <h5 className="text-xs font-semibold text-slate-200">
                    No Prior Encounters Recorded
                  </h5>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    This patient has no earlier consultation records in Kalyan Hospital. Complete this initial consultation to establish the clinical baseline.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center text-slate-500 text-xs font-mono">
                    <span>{new Date(priorEncounter.encounter_date).toLocaleDateString()}</span>
                    <span>{withDoctorTitle(priorEncounter.doctor_name)}</span>
                  </div>

                  {/* Prior Chief Complaints with Copy Button */}
                  <div className="p-2.5 bg-[#0D121D] rounded-xl border border-slate-700 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-200 uppercase text-xs tracking-wider">
                        Complaints
                      </span>
                      {!isFinalised && (
                        <button
                          type="button"
                          onClick={handleCopySymptoms}
                          className="text-xs font-semibold text-teal-300 hover:text-teal-200 inline-flex items-center gap-1"
                        >
                          <IconCopy size={12} />
                          <span>Copy Section Findings</span>
                        </button>
                      )}
                    </div>
                    <p className="text-slate-200 line-clamp-3">
                      {priorEncounter.symptoms || '—'}
                    </p>
                  </div>

                  {/* Prior Vitals with Copy Button */}
                  {priorEncounter.vitals && (
                    <div className="p-2.5 bg-[#0D121D] rounded-xl border border-slate-700 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200 uppercase text-xs tracking-wider">
                          Vitals Snapshot
                        </span>
                        {!isFinalised && (
                          <button
                            type="button"
                            onClick={handleCopyVitals}
                            className="text-xs font-semibold text-teal-300 hover:text-teal-200 inline-flex items-center gap-1"
                          >
                            <IconCopy size={12} />
                            <span>Copy Section Findings</span>
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs text-slate-200 font-mono">
                        <span>BP: {priorEncounter.vitals.systolic_bp}/{priorEncounter.vitals.diastolic_bp}</span>
                        <span>Pulse: {priorEncounter.vitals.pulse_bpm} bpm</span>
                        <span>SpO2: {priorEncounter.vitals.spo2_percent}%</span>
                        <span>BMI: {priorEncounter.vitals.bmi ?? '—'}</span>
                      </div>
                    </div>
                  )}

                  {/* Prior Diagnosis with Copy Button */}
                  <div className="p-2.5 bg-[#0D121D] rounded-xl border border-slate-700 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-200 uppercase text-xs tracking-wider">
                        Diagnosis
                      </span>
                      {!isFinalised && (
                        <button
                          type="button"
                          onClick={handleCopyDiagnosis}
                          className="text-xs font-semibold text-teal-300 hover:text-teal-200 inline-flex items-center gap-1"
                        >
                          <IconCopy size={12} />
                          <span>Copy Section Findings</span>
                        </button>
                      )}
                    </div>
                    <p className="font-semibold text-white line-clamp-2">
                      {priorEncounter.diagnosis || '—'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </main>

        {/* Finalise Confirmation Modal */}
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
              <p className="text-xs text-neutral-600 leading-relaxed">
                Once finalised, this clinical encounter will be permanently locked against modifications or deletions. Any subsequent changes can only be added as dated addenda.
              </p>
              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowFinaliseConfirm(false)}
                  className="px-4 py-2 border border-neutral-300 rounded text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleFinaliseConsultation}
                  disabled={finaliseMutation.isPending}
                  className="px-4 py-2 bg-[#8E1C3D] text-white rounded text-xs font-semibold hover:bg-[#721631] disabled:opacity-50"
                >
                  {finaliseMutation.isPending ? 'Finalising...' : 'Yes, Lock & Finalise'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Appointment Booking Modal */}
        {showBookingModal && (
          <AppointmentBookingModal
            isOpen
            onClose={() => setShowBookingModal(false)}
            initialPatient={patient || null}
            onSuccess={() => {
              setShowBookingModal(false)
              setActionSuccess('Follow-up appointment booked successfully.')
            }}
          />
        )}

        {/* Patient Consultation Summary Print Modal (DWS-09, T-19-12) */}
        {showPrintSummary && (
          <ConsultationSummaryPrint
            encounter={
              existingEncounter || {
                id: encounterId,
                patient_id: effectivePatientId,
                patient_urn: patientUrn,
                patient_name: patientName,
                doctor_id: me?.doctor_id || 1,
                doctor_name: me?.full_name || '',
                appointment_id: paramApptId || 0,
                encounter_date: new Date().toISOString(),
                symptoms,
                clinical_notes: clinicalNotes,
                diagnosis,
                is_finalised: isFinalised,
                finalised_at: finalisedAt,
                version_id: versionId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                addenda: [],
              }
            }
            patient={patient || null}
            followUp={
              serverFollowUp
                ? {
                    recommended_date: serverFollowUp.recommended_date,
                    recommended_doctor_id: serverFollowUp.recommended_doctor_id,
                    doctor_name:
                      doctors.find((d) => d.id === serverFollowUp.recommended_doctor_id)?.name_en ||
                      existingEncounter?.doctor_name,
                    reception_notes: null,
                  }
                : followUpDate
                ? {
                    recommended_date: followUpDate,
                    recommended_doctor_id: followUpDoctorId,
                    doctor_name:
                      doctors.find((d) => d.id === followUpDoctorId)?.name_en ||
                      existingEncounter?.doctor_name,
                    reception_notes: null,
                  }
                : null
            }
            advice={clinicalNotes}
            onClose={() => setShowPrintSummary(false)}
          />
        )}
      </div>
    </AppShell>
  )
}
export default ClinicalEncounterWorkspace
