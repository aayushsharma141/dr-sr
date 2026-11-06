import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { Modal } from '../components/Modal'
import { VitalsBiometricsSection } from '../components/VitalsBiometricsSection'
import { SpecialtyPhysiotherapyForm, PhysiotherapyFormData } from '../components/SpecialtyPhysiotherapyForm'
import { SpecialtyOphthalmologyForm, OphthalmologyFormData } from '../components/SpecialtyOphthalmologyForm'
import { PrescriptionFormSection } from '../components/PrescriptionFormSection'
import { FollowUpSection } from '../components/FollowUpSection'
import { AppointmentBookingModal } from '../components/AppointmentBookingModal'
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
  usePatientPrescriptions,
  useCreatePrescription,
  useUpdatePrescription,
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
  const doctors: DoctorOut[] = doctorsData || []

  // 3. Vitals & Specialty Template queries
  const { data: serverVitals } = useEncounterVitals(encounterId)
  const departmentId = existingEncounter?.department_id || (me?.doctor_id ? 1 : 1)
  const { data: deptTemplate } = useDepartmentTemplate(departmentId)
  const { data: serverTemplateResponse } = useEncounterTemplateResponse(encounterId)

  // 4. Prescription queries
  const { data: patientPrescriptions } = usePatientPrescriptions(effectivePatientId)
  const activePrescription = (patientPrescriptions || []).find(
    (p) => p.encounter_id === encounterId && p.status !== 'CANCELLED'
  )
  const activePrescriptionId = activePrescription?.id || null

  // 5. Follow-up recommendation
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
  const updateRxMutation = useUpdatePrescription()
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
      <div className="min-h-screen bg-[#F5F7FA] pb-16">
        {/* Sticky Top Clinical Header */}
        <header
          data-testid="sticky-clinical-header"
          className="sticky top-0 z-30 bg-white border-b border-neutral-200 px-6 py-3 shadow-xs"
        >
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
            {/* Patient identity strip */}
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold text-neutral-900 leading-tight">
                    {patientName}
                  </h1>
                  <span className="font-mono text-xs px-2 py-0.5 bg-neutral-100 rounded text-neutral-700 font-medium">
                    {patientUrn}
                  </span>
                  {patient && (
                    <span className="text-xs text-neutral-600 font-medium">
                      {patient.age_years}y / {patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : 'Other'}
                    </span>
                  )}
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800 uppercase tracking-wider">
                    {departmentName}
                  </span>
                </div>
                {/* Severe Allergy Badge */}
                <div className="mt-1 flex items-center gap-2">
                  {patient?.allergies && patient.allergies !== 'None reported' ? (
                    <span
                      data-testid="allergy-alert-badge"
                      className="bg-[#8E1C3D] text-white font-semibold px-2 py-0.5 rounded text-xs inline-flex items-center gap-1"
                    >
                      <span>⚠️ ALLERGY:</span>
                      <span>{patient.allergies}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">
                      Allergies: None reported
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Center: Auto-Save Status Pill */}
            <div className="flex items-center">
              {autoSaveStatus === 'SAVING' && (
                <div
                  data-testid="auto-save-pill"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                  Saving consultation draft...
                </div>
              )}
              {autoSaveStatus === 'SAVED' && lastSavedTime && (
                <div
                  data-testid="auto-save-pill"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  Saved to server at {lastSavedTime}
                </div>
              )}
              {autoSaveStatus === 'OFFLINE_ERROR' && (
                <div
                  role="alert"
                  data-testid="auto-save-pill"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-[#B91C1C] border border-red-300"
                >
                  <span>⚠️</span>
                  Network error — unsaved changes present. Retrying connection...
                </div>
              )}
              {autoSaveStatus === 'IDLE' && isFinalised && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-300">
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
                className="px-3.5 py-1.5 border border-[#8E1C3D] text-[#8E1C3D] rounded text-xs font-semibold hover:bg-[#8E1C3D]/5 disabled:opacity-40 transition-colors"
              >
                Authorise Prescription
              </button>

              <button
                type="button"
                disabled={!isFinalised}
                onClick={() => {
                  if (encounterId > 0) {
                    window.open(`/doctor/encounters/${encounterId}/print-summary`, '_blank')
                  }
                }}
                className="px-3.5 py-1.5 border border-neutral-300 rounded text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 transition-colors"
              >
                Print Consultation Summary
              </button>

              <button
                type="button"
                onClick={() => setShowFinaliseConfirm(true)}
                disabled={isFinalised}
                className="px-4 py-1.5 bg-[#8E1C3D] text-white rounded text-xs font-semibold hover:bg-[#721631] disabled:opacity-40 transition-colors shadow-xs"
              >
                Finalise Consultation
              </button>
            </div>
          </div>
        </header>

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
              className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-900 text-xs font-medium flex justify-between items-center"
            >
              <span>&check; {actionSuccess}</span>
              <button
                onClick={() => setActionSuccess(null)}
                className="text-green-700 hover:text-green-900 font-bold"
              >
                &times;
              </button>
            </div>
          )}

          {finaliseError && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-xs font-medium flex justify-between items-center"
            >
              <span>⚠️ {finaliseError}</span>
              <button
                onClick={() => setFinaliseError(null)}
                className="text-red-700 hover:text-red-900 font-bold"
              >
                &times;
              </button>
            </div>
          )}
        </div>

        {/* Continuous Single-Page Workspace Body */}
        <main className="max-w-7xl mx-auto px-6 pt-6 flex gap-6 items-start">
          {/* 1. Left Jump Navigation Rail (6 Anchors) */}
          <nav
            data-testid="jump-navigation-rail"
            aria-label="Consultation Jump Navigation"
            className="w-56 shrink-0 sticky top-24 bg-white rounded-lg border border-neutral-200 p-3 shadow-xs space-y-1 text-xs"
          >
            <span className="block px-3 py-1 font-bold text-neutral-400 uppercase tracking-wider text-[10px]">
              Workspace Anchors
            </span>
            {[
              { id: 'section-complaints', label: '1. Chief Complaints & HPI' },
              { id: 'section-vitals', label: '2. Vital Signs & Biometrics' },
              { id: 'section-specialty', label: '3. Specialty Assessment' },
              { id: 'section-diagnosis', label: '4. Diagnosis & Impressions' },
              { id: 'section-prescriptions', label: '5. Prescriptions & Medications' },
              { id: 'section-followup', label: '6. Follow-up Recommendation' },
            ].map((anchor) => {
              const isActive = activeAnchor === anchor.id
              return (
                <button
                  key={anchor.id}
                  type="button"
                  onClick={() => scrollToAnchor(anchor.id)}
                  className={`w-full text-left px-3 py-2 rounded-r transition-colors border-l-2 ${
                    isActive
                      ? 'border-[#8E1C3D] bg-[#8E1C3D]/5 font-semibold text-[#8E1C3D]'
                      : 'border-transparent text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                  }`}
                >
                  {anchor.label}
                </button>
              )
            })}

            <div className="pt-4 border-t border-neutral-200 mt-3 px-3">
              <Link
                to="/doctor"
                className="text-[11px] text-neutral-500 hover:text-neutral-900 flex items-center gap-1 font-medium"
              >
                &larr; Consultation Queue
              </Link>
            </div>
          </nav>

          {/* 2. Main Clinical Workspace Sections (Continuous Single Page) */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Section 1: Chief Complaints & HPI */}
            <section
              id="section-complaints"
              data-testid="section-complaints"
              className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6 space-y-4"
            >
              <div className="border-b border-neutral-200 pb-2">
                <h2 className="text-lg font-semibold text-neutral-900">
                  Chief Complaints & History of Present Illness (HPI)
                </h2>
                <p className="text-xs text-neutral-500">
                  Record presenting symptoms, onset, functional duration, and relevant clinical history.
                </p>
              </div>

              <div>
                <label
                  htmlFor="symptoms-input"
                  className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
                >
                  Chief Complaints & Symptoms <span className="text-red-600">*</span>
                </label>
                {isFinalised ? (
                  <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-sm text-neutral-800 whitespace-pre-wrap">
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
                    placeholder="Describe patient's chief complaints, duration, severity, and onset..."
                    className="w-full p-3 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                  />
                )}
              </div>

              <div>
                <label
                  htmlFor="clinical-notes-input"
                  className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
                >
                  Clinical Examination & Progress Notes
                </label>
                {isFinalised ? (
                  <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-sm text-neutral-800 whitespace-pre-wrap">
                    {clinicalNotes}
                  </div>
                ) : (
                  <textarea
                    id="clinical-notes-input"
                    rows={4}
                    value={clinicalNotes}
                    onChange={(e) => {
                      setClinicalNotes(e.target.value)
                      scheduleAutoSave()
                    }}
                    onBlur={handleSectionBlur}
                    placeholder="Physical examination notes, systemic findings, functional limitations..."
                    className="w-full p-3 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                  />
                )}
              </div>
            </section>

            {/* Section 2: Vital Signs & Biometrics */}
            <section
              id="section-vitals"
              data-testid="section-vitals"
              className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6"
            >
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
            </section>

            {/* Section 3: Dynamic Specialty Assessment */}
            <section
              id="section-specialty"
              data-testid="section-specialty"
              className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6"
            >
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
            </section>

            {/* Section 4: Diagnosis & Impressions */}
            <section
              id="section-diagnosis"
              data-testid="section-diagnosis"
              className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6 space-y-4"
            >
              <div className="border-b border-neutral-200 pb-2">
                <h2 className="text-lg font-semibold text-neutral-900">
                  Diagnosis & Clinical Impressions
                </h2>
                <p className="text-xs text-neutral-500">
                  Authoritative provisional or definitive medical diagnosis.
                </p>
              </div>

              <div>
                <label
                  htmlFor="diagnosis-input"
                  className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1"
                >
                  Clinical Diagnosis <span className="text-red-600">*</span>
                </label>
                {isFinalised ? (
                  <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-sm font-semibold text-neutral-800">
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
                    placeholder="Diagnosis (e.g. Lumbar Spondylosis with L5 Radiculopathy, Immature Senile Cataract)..."
                    className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                  />
                )}
              </div>
            </section>

            {/* Section 5: Prescriptions & Medications */}
            <section
              id="section-prescriptions"
              data-testid="section-prescriptions"
              className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6"
            >
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
            </section>

            {/* Section 6: Follow-up Recommendation */}
            <section
              id="section-followup"
              data-testid="section-followup"
              className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6"
            >
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
            </section>

            {/* Finalised Addenda Audit Section */}
            {isFinalised && (
              <section
                data-testid="section-addenda"
                className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6 space-y-4"
              >
                <div className="flex justify-between items-center border-b border-neutral-200 pb-2">
                  <h3 className="text-base font-semibold text-neutral-900">
                    Dated Clinical Addenda ({addenda.length})
                  </h3>
                  <span className="text-xs text-neutral-500 font-mono">Immutable audit trail</span>
                </div>

                {addenda.length === 0 ? (
                  <p className="text-xs text-neutral-500 italic">No addenda recorded for this encounter.</p>
                ) : (
                  <div className="space-y-3">
                    {addenda.map((ad: AddendumRead, idx: number) => (
                      <div
                        key={ad.id}
                        className="p-3 bg-amber-50/50 rounded-lg border border-amber-200 space-y-1 text-xs"
                      >
                        <div className="flex justify-between text-amber-900 font-semibold">
                          <span>Addendum #{idx + 1} &bull; {withDoctorTitle(ad.doctor_name)}</span>
                          <span className="font-mono">{new Date(ad.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-neutral-800 whitespace-pre-wrap">{ad.addendum_text}</p>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAddAddendum} className="space-y-2 pt-2">
                  <label htmlFor="addendum-field" className="block text-xs font-semibold text-neutral-700 uppercase">
                    Append Addendum Note
                  </label>
                  <textarea
                    id="addendum-field"
                    rows={3}
                    value={addendumText}
                    onChange={(e) => setAddendumText(e.target.value)}
                    placeholder="Record post-finalisation consultation addendum note..."
                    className="w-full p-3 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D]"
                  />
                  <button
                    type="submit"
                    disabled={addendumMutation.isPending || !addendumText.trim()}
                    className="px-4 py-2 bg-neutral-900 text-white rounded text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {addendumMutation.isPending ? 'Appending...' : '+ Append Addendum'}
                  </button>
                </form>
              </section>
            )}
          </div>

          {/* 3. Persistent Side Panel (Prior Encounter & Patient Demographics) */}
          <aside
            data-testid="persistent-side-panel"
            aria-label="Patient and Prior Consultation Card"
            className="w-80 shrink-0 sticky top-24 space-y-4"
          >
            {/* Demographics Card */}
            {patient && (
              <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center font-bold text-sm">
                    {patient.full_name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-900">{patient.full_name}</h3>
                    <div className="text-[11px] font-mono text-neutral-500">{patient.urn}</div>
                  </div>
                </div>

                <div className="text-xs text-neutral-600 divide-y divide-neutral-100 font-mono">
                  <div className="py-1 flex justify-between">
                    <span>Mobile:</span>
                    <strong className="text-neutral-900">{patient.mobile || '—'}</strong>
                  </div>
                  <div className="py-1 flex justify-between">
                    <span>Emergency:</span>
                    <strong className="text-neutral-900">{patient.emergency_contact || '—'}</strong>
                  </div>
                  <div className="py-1 flex justify-between">
                    <span>Address:</span>
                    <span className="text-neutral-900 font-sans truncate max-w-[140px] text-right">
                      {patient.address || '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Allergy Alert Card */}
            {patient?.allergies && patient.allergies !== 'None reported' ? (
              <div className="bg-[#8E1C3D] text-white rounded-lg p-3 shadow-xs space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>Severe Allergy Warning</span>
                </div>
                <p className="text-xs font-medium leading-relaxed">
                  {patient.allergies}
                </p>
              </div>
            ) : (
              <div className="bg-neutral-100 text-neutral-600 rounded-lg p-3 text-xs">
                <span className="font-semibold text-neutral-800">Allergies: </span>
                None reported
              </div>
            )}

            {/* Prior Consultation Side Card (D-19-07, D-19-08) */}
            <div
              data-testid="prior-encounter-card"
              className="bg-white rounded-lg border border-neutral-200 shadow-xs p-4 space-y-4"
            >
              <div className="border-b border-neutral-200 pb-2">
                <h4 className="text-sm font-semibold text-neutral-900">
                  Previous Consultation Card
                </h4>
                <p className="text-[11px] text-neutral-500">
                  Read-only findings from most recent prior visit.
                </p>
              </div>

              {!priorEncounter ? (
                <div className="py-4 text-center space-y-2">
                  <h5 className="text-xs font-semibold text-neutral-800">
                    No Prior Encounters Recorded
                  </h5>
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    This patient has no earlier consultation records in Kalyan Hospital. Complete this initial consultation to establish the clinical baseline.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center text-neutral-500 text-[11px] font-mono">
                    <span>{new Date(priorEncounter.encounter_date).toLocaleDateString()}</span>
                    <span>{withDoctorTitle(priorEncounter.doctor_name)}</span>
                  </div>

                  {/* Prior Chief Complaints with Copy Button */}
                  <div className="p-2.5 bg-neutral-50 rounded border border-neutral-200 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-neutral-700 uppercase text-[10px] tracking-wider">
                        Complaints
                      </span>
                      {!isFinalised && (
                        <button
                          type="button"
                          onClick={handleCopySymptoms}
                          className="text-[11px] font-semibold text-[#8E1C3D] hover:underline"
                        >
                          Copy Section Findings
                        </button>
                      )}
                    </div>
                    <p className="text-neutral-800 line-clamp-3">
                      {priorEncounter.symptoms || '—'}
                    </p>
                  </div>

                  {/* Prior Vitals with Copy Button */}
                  {priorEncounter.vitals && (
                    <div className="p-2.5 bg-neutral-50 rounded border border-neutral-200 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-neutral-700 uppercase text-[10px] tracking-wider">
                          Vitals Snapshot
                        </span>
                        {!isFinalised && (
                          <button
                            type="button"
                            onClick={handleCopyVitals}
                            className="text-[11px] font-semibold text-[#8E1C3D] hover:underline"
                          >
                            Copy Section Findings
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-neutral-700 font-mono">
                        <span>BP: {priorEncounter.vitals.systolic_bp}/{priorEncounter.vitals.diastolic_bp}</span>
                        <span>Pulse: {priorEncounter.vitals.pulse_bpm} bpm</span>
                        <span>SpO2: {priorEncounter.vitals.spo2_percent}%</span>
                        <span>BMI: {priorEncounter.vitals.bmi ?? '—'}</span>
                      </div>
                    </div>
                  )}

                  {/* Prior Diagnosis with Copy Button */}
                  <div className="p-2.5 bg-neutral-50 rounded border border-neutral-200 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-neutral-700 uppercase text-[10px] tracking-wider">
                        Diagnosis
                      </span>
                      {!isFinalised && (
                        <button
                          type="button"
                          onClick={handleCopyDiagnosis}
                          className="text-[11px] font-semibold text-[#8E1C3D] hover:underline"
                        >
                          Copy Section Findings
                        </button>
                      )}
                    </div>
                    <p className="font-semibold text-neutral-900 line-clamp-2">
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
      </div>
    </AppShell>
  )
}
export default ClinicalEncounterWorkspace
