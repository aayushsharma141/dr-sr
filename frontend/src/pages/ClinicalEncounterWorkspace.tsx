import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useParams, useSearchParams, useNavigate, useLocation, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { Modal } from '../components/Modal'
import { toast } from '../components/ToastHost'
import { VitalsBiometricsSection } from '../components/VitalsBiometricsSection'
import { SpecialtyPhysiotherapyForm, type PhysiotherapyFormData } from '../components/SpecialtyPhysiotherapyForm'
import { SpecialtyOphthalmologyForm, type OphthalmologyFormData } from '../components/SpecialtyOphthalmologyForm'
import { PrescriptionFormSection } from '../components/PrescriptionFormSection'
import { FollowUpSection } from '../components/FollowUpSection'
import { ConsultationSummaryPrint } from '../components/ConsultationSummaryPrint'
import { QuickPhraseBar } from '../components/QuickPhraseBar'
import { DoctorChargesPanel } from '../components/billing/DoctorChargesPanel'
import { EncounterStructuredDiagnosesPanel } from '../components/encounter/EncounterStructuredDiagnosesPanel'
import { EncounterInvestigationOrdersPanel } from '../components/encounter/EncounterInvestigationOrdersPanel'
import { asSpecialty, useBookedAppointment, useMyDepartments } from '../api/specialty'
import { ApiError, isVersionConflict } from '../api/client'
import { UnsavedChangesGuard, hasReportedAllergies } from '../components/UnsavedChangesGuard'
import {
  IconCheck,
  IconAlertTriangle,
  IconPrinter,
  IconArrowLeft,
  IconLock,
  IconHistory,
  IconCopy,
  IconChevronDown,
  IconChevronRight,
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
  useEncounterPrescription,
  useCreatePrescription,
  useAuthorisePrescription,
  useCancelPrescription,
  useEncounterFollowUp,
  useCreateFollowUp,
  useEncounterInvestigations,
  useDoctors,
  useMe,
} from '../api/queries'
import type {
  AddendumRead,
  EncounterRead,
  VitalObservationInput,
  PrescriptionItemCreate,
  PrescriptionOut,
  DoctorOut,
} from '../api/types'
import { formatIst, withDoctorTitle } from '../format'

type AutoSaveStatus = 'IDLE' | 'SAVING' | 'SAVED' | 'OFFLINE_ERROR'

/**
 * One fresh workspace per consultation route. Moving from one consultation to another (or to a
 * new one) inside the app would otherwise keep the previous record's state, such as its
 * finalised lock and draft text. When a new consultation is saved for the first time, the
 * address moves to the saved record but carries the workspace key, so the form is not rebuilt
 * and nothing typed in the meantime is lost.
 */
export function ClinicalEncounterWorkspace() {
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const carriedKey = (location.state as { workspaceKey?: string } | null)?.workspaceKey
  const workspaceKey = carriedKey ?? `${id ?? 'new'}?${searchParams.toString()}#${location.key}`
  return <EncounterWorkspace key={workspaceKey} workspaceKey={workspaceKey} />
}

function EncounterWorkspace({ workspaceKey }: { workspaceKey: string }) {
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: me } = useMe()

  const routeEncounterId = id ? Number(id) : 0
  // A new consultation without an appointment gets its id on its first save. Until the address
  // catches up, this holds it.
  const [createdEncounterId, setCreatedEncounterId] = useState(0)
  const encounterId = routeEncounterId || createdEncounterId
  const paramPatientId = searchParams.get('patient_id')
    ? Number(searchParams.get('patient_id'))
    : null
  const paramApptId = searchParams.get('appointment_id')
    ? Number(searchParams.get('appointment_id'))
    : null
  // DWS-01/DWS-02: starting a consultation from the queue opens that appointment's encounter
  // (the server creates it, or returns the one already there) and moves to it, so every edit is
  // auto-saved to it and an interrupted draft reopens.
  const needsOpen = routeEncounterId === 0 && paramPatientId !== null && paramApptId !== null

  // 1. Load existing encounter
  const {
    data: existingEncounter,
    isPending: isEncounterPending,
    isError: isEncounterError,
    error: encounterError,
    refetch: refetchEncounter,
  } = useEncounter(encounterId)

  // Cross-doctor read-only state: viewing another doctor's encounter must never fire write/billing calls.
  const isOtherDoctorEncounter = Boolean(
    existingEncounter && me?.doctor_id != null && existingEncounter.doctor_id !== me.doctor_id,
  )
  const canLoadOwnAppointmentBilling = !isOtherDoctorEncounter && (!existingEncounter || me != null)

  // 2. Patient details & prior encounter
  const effectivePatientId = existingEncounter?.patient_id || paramPatientId || 0
  const { data: patient } = usePatient(effectivePatientId)
  const { data: priorEncounter } = usePatientPriorEncounter(effectivePatientId, encounterId)
  const { data: doctorsData } = useDoctors(false)
  const doctors: DoctorOut[] = Array.isArray(doctorsData) ? doctorsData : []

  // 3. Vitals & Specialty Template queries
  const vitalsQuery = useEncounterVitals(encounterId)
  const serverVitals = vitalsQuery.data
  // D-19-03: the specialty comes from the consultation's own department, then the booked
  // appointment's, then the doctor's department when they have exactly one. Never assume one.
  const myDepartments = useMyDepartments()
  const effectiveAppointmentId = existingEncounter?.appointment_id ?? paramApptId
  const bookedAppointment = useBookedAppointment(canLoadOwnAppointmentBilling ? effectiveAppointmentId : null)
  const departmentId: number | null =
    existingEncounter?.department_id ??
    bookedAppointment?.department_id ??
    (myDepartments.length === 1 ? myDepartments[0].id : null)
  const { data: deptTemplate, isPending: isTemplatePending } = useDepartmentTemplate(departmentId)
  const templateResponseQuery = useEncounterTemplateResponse(encounterId)

  // 4. Active encounter prescription, investigations & follow-up recommendation
  const encounterRxQuery = useEncounterPrescription(encounterId)
  const investigationsQuery = useEncounterInvestigations(encounterId, encounterId > 0)
  const followUpQuery = useEncounterFollowUp(encounterId)
  const serverFollowUp = followUpQuery.data
  // The server keeps one follow-up per encounter and cannot change it afterwards.
  const followUpRecorded = Boolean(serverFollowUp)

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
  const [showFinaliseConfirm, setShowFinaliseConfirm] = useState(false)
  const [isFinalising, setIsFinalising] = useState(false)
  const [addendumText, setAddendumText] = useState('')
  const [activeAnchor, setActiveAnchor] = useState('section-complaints')
  const [followUpRetryError, setFollowUpRetryError] = useState<string | null>(null)
  const [showPrintSummary, setShowPrintSummary] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [highlightMissingRequired, setHighlightMissingRequired] = useState(false)
  const [showPatientDetails, setShowPatientDetails] = useState(false)
  const [showExamQuickPhrases, setShowExamQuickPhrases] = useState(false)

  // Track user modifications
  const isDirtyRef = useRef(false)
  const [unsavedEdits, setUnsavedEdits] = useState(false)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Save engine state. Saves run one after another (saveChainRef), each reading the latest form
  // (runSaveRef) and the id and version the previous save returned (refs, not state, because the
  // next save can start before React re-renders).
  const encounterIdRef = useRef(routeEncounterId)
  const versionRef = useRef(1)
  const isFinalisedRef = useRef(false)
  const isOtherDoctorRef = useRef(false)
  isOtherDoctorRef.current = isOtherDoctorEncounter
  const isReadOnly = isFinalised || isOtherDoctorEncounter
  const editSeqRef = useRef(0)
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const runSaveRef = useRef<() => Promise<boolean>>(async () => true)
  const followUpRecordedRef = useRef(false)
  const bypassGuardRef = useRef(false)
  const mountedRef = useRef(true)
  const openStartedRef = useRef(false)
  // Each part of the form is loaded from the server once. Later cache updates (our own saves)
  // must not overwrite what the doctor typed while a save was in flight.
  const hydratedRef = useRef({
    encounter: false,
    vitals: false,
    template: false,
    prescription: false,
    followUp: false,
  })
  const authorisingRxRef = useRef(false)
  const sendingFollowUpRef = useRef(false)

  // Mutations
  const createMutation = useCreateEncounter()
  const saveDraftMutation = useSaveEncounterDraft()
  const finaliseMutation = useFinaliseEncounter()
  const addendumMutation = useAddAddendum()
  const saveVitalsMutation = useSaveVitals()
  const saveTemplateResponseMutation = useSaveEncounterTemplateResponse()
  const createRxMutation = useCreatePrescription()
  const authoriseRxMutation = useAuthorisePrescription()
  const cancelRxMutation = useCancelPrescription()
  const createFollowUpMutation = useCreateFollowUp()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (encounterId > 0) encounterIdRef.current = encounterId
  }, [encounterId])

  useEffect(() => {
    followUpRecordedRef.current = followUpRecorded
  }, [followUpRecorded])

  // A deliberate address change after the first save is over; guard navigation again.
  useEffect(() => {
    bypassGuardRef.current = false
  }, [location.key])

  // Open the appointment's encounter, then show it. The ref keeps this to one request.
  useEffect(() => {
    if (!needsOpen || paramPatientId === null || paramApptId === null || openStartedRef.current) return
    openStartedRef.current = true
    createMutation
      .mutateAsync({
        patient_id: paramPatientId,
        appointment_id: paramApptId,
        symptoms: '',
        clinical_notes: '',
        diagnosis: '',
      })
      .then((enc) => {
        if (mountedRef.current) navigate(`/doctor/encounters/${enc.id}`, { replace: true })
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setOpenError(err instanceof Error ? err.message : 'The consultation could not be opened.')
        }
      })
  }, [needsOpen, paramPatientId, paramApptId, createMutation, navigate])

  const applyEncounter = useCallback((enc: EncounterRead) => {
    setSymptoms(enc.symptoms || '')
    setClinicalNotes(enc.clinical_notes || '')
    setDiagnosis(enc.diagnosis || '')
    versionRef.current = enc.version_id
    setVersionId(enc.version_id)
    isFinalisedRef.current = enc.is_finalised
    setIsFinalised(enc.is_finalised)
    setFinalisedAt(enc.finalised_at)
    setAddenda(enc.addenda || [])
  }, [])

  // Populate from existing encounter (once)
  useEffect(() => {
    if (!existingEncounter || hydratedRef.current.encounter) return
    hydratedRef.current.encounter = true
    applyEncounter(existingEncounter)
  }, [existingEncounter, applyEncounter])

  // Populate vitals (once the first load has finished, found or not)
  useEffect(() => {
    if (hydratedRef.current.vitals || !vitalsQuery.isFetched) return
    hydratedRef.current.vitals = true
    const v = vitalsQuery.data
    if (v) {
      setVitals({
        height_cm: v.height_cm,
        weight_kg: v.weight_kg,
        systolic_bp: v.systolic_bp,
        diastolic_bp: v.diastolic_bp,
        pulse_bpm: v.pulse_bpm,
        temperature_f: v.temperature_f,
        respiratory_rate: v.respiratory_rate,
        spo2_percent: v.spo2_percent,
      })
    }
  }, [vitalsQuery.isFetched, vitalsQuery.data])

  // Populate specialty template response
  useEffect(() => {
    if (hydratedRef.current.template || !templateResponseQuery.isFetched) return
    hydratedRef.current.template = true
    const data = templateResponseQuery.data?.response_data
    if (data) setSpecialtyData(data)
  }, [templateResponseQuery.isFetched, templateResponseQuery.data])

  // Populate active encounter prescription (once on load)
  useEffect(() => {
    if (hydratedRef.current.prescription || !encounterRxQuery.isFetched || encounterRxQuery.isError) return
    hydratedRef.current.prescription = true
    const rx = encounterRxQuery.data
    if (rx) {
      setActiveRxRecord(rx)
      setPrescriptionItems(
        (Array.isArray(rx.items) ? rx.items : []).map((it) => ({
          item_order: it.item_order,
          medicine_name: it.medicine_name,
          dosage: it.dosage,
          frequency: it.frequency,
          duration_days: it.duration_days,
          instructions: it.instructions ?? '',
          strength: it.strength ?? '',
          form: it.form ?? 'Tablet',
          route: it.route ?? 'Oral',
        })),
      )
      setDietaryAdvice(rx.dietary_advice || '')
      setGeneralAdvice(rx.general_advice || '')
    }
  }, [encounterRxQuery.isFetched, encounterRxQuery.isError, encounterRxQuery.data])

  // Populate follow-up
  useEffect(() => {
    if (hydratedRef.current.followUp || !followUpQuery.isFetched) return
    hydratedRef.current.followUp = true
    const f = followUpQuery.data
    if (f) {
      setFollowUpDate(f.recommended_date)
      setFollowUpDoctorId(f.recommended_doctor_id)
      setFollowUpReason(f.clinical_reason || '')
    }
  }, [followUpQuery.isFetched, followUpQuery.data])

  // One save of everything the draft holds: the encounter text (creating the record on a new
  // consultation's first save), vitals and the specialty form. Returns whether it reached the
  // server. The follow-up is not part of it: it is sent once, on Finalise.
  const runSave = async (): Promise<boolean> => {
    if (isFinalisedRef.current || isOtherDoctorRef.current) return true
    if (encounterIdRef.current > 0 && !isDirtyRef.current) return true
    if (encounterIdRef.current === 0 && !effectivePatientId) return false

    const seq = editSeqRef.current
    setAutoSaveStatus('SAVING')
    setConflictError(null)

    try {
      let targetId = encounterIdRef.current
      if (targetId === 0) {
        const created = await createMutation.mutateAsync({
          patient_id: effectivePatientId,
          department_id: departmentId,
          symptoms,
          clinical_notes: clinicalNotes,
          diagnosis,
        })
        targetId = created.id
        encounterIdRef.current = created.id
        versionRef.current = created.version_id
        // Nothing else is on the server for a record created just now: the form is the source.
        hydratedRef.current = {
          encounter: true,
          vitals: true,
          template: true,
          prescription: true,
          followUp: true,
        }
        if (mountedRef.current) {
          setCreatedEncounterId(created.id)
          setVersionId(created.version_id)
          bypassGuardRef.current = true
          navigate(`/doctor/encounters/${created.id}`, { replace: true, state: { workspaceKey } })
        }
      } else {
        const res = await saveDraftMutation.mutateAsync({
          id: targetId,
          body: { symptoms, clinical_notes: clinicalNotes, diagnosis, version_id: versionRef.current },
        })
        versionRef.current = res.version_id
        setVersionId(res.version_id)
      }

      const hasVitals = Object.values(vitals).some((v) => v !== null && v !== undefined && v !== '')
      if (hasVitals) {
        await saveVitalsMutation.mutateAsync({ encounterId: targetId, body: vitals })
      }

      const activeVersionId = deptTemplate?.active_version?.id
      if (activeVersionId && hasMeaningfulSpecialtyData(specialtyData)) {
        await saveTemplateResponseMutation.mutateAsync({
          encounterId: targetId,
          body: { template_version_id: activeVersionId, response_data: specialtyData },
        })
      }

      setLastSavedTime(new Date().toTimeString().split(' ')[0])
      setAutoSaveStatus('SAVED')
      // Edits made while this save was in flight are still unsaved; their own save is queued.
      if (editSeqRef.current === seq) {
        isDirtyRef.current = false
        setUnsavedEdits(false)
      }
      return true
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        setAutoSaveStatus('IDLE')
        setConflictError('Encounter was modified in another session.')
      } else if (err instanceof ApiError) {
        setAutoSaveStatus('IDLE')
        toast.error(`Auto-save failed: ${err.message}`)
      } else {
        setAutoSaveStatus('OFFLINE_ERROR')
      }
      return false
    }
  }

  useLayoutEffect(() => {
    runSaveRef.current = runSave
  })

  /** Queue a save behind any save in flight, so two saves never send the same version. */
  const saveNow = useCallback((): Promise<boolean> => {
    const next = saveChainRef.current.then(() => runSaveRef.current())
    saveChainRef.current = next
    return next
  }, [])

  // Schedule auto-save on typing (~3000ms pause)
  const scheduleAutoSave = useCallback(() => {
    if (isFinalisedRef.current || isOtherDoctorRef.current) return
    editSeqRef.current += 1
    isDirtyRef.current = true
    setUnsavedEdits(true)
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      void saveNow()
    }, 3000)
  }, [saveNow])

  // Save on section blur
  const handleSectionBlur = useCallback(() => {
    if (!isDirtyRef.current || isFinalisedRef.current || isOtherDoctorRef.current) return
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    void saveNow()
  }, [saveNow])

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
        void saveNow()
      }, 5000)
      return () => clearTimeout(retryTimer)
    }
  }, [autoSaveStatus, saveNow])

  const handleReloadLatest = async () => {
    setConflictError(null)
    if (encounterIdRef.current === 0) return
    const { data } = await refetchEncounter()
    if (data) applyEncounter(data)
    const rxRes = await encounterRxQuery.refetch()
    if (rxRes.data !== undefined) {
      const rx = rxRes.data
      setActiveRxRecord(rx)
      setPrescriptionItems(
        rx && Array.isArray(rx.items)
          ? rx.items.map((it) => ({
            item_order: it.item_order,
            medicine_name: it.medicine_name,
            dosage: it.dosage,
            frequency: it.frequency,
            duration_days: it.duration_days,
            instructions: it.instructions ?? '',
            strength: it.strength ?? '',
            form: it.form ?? 'Tablet',
            route: it.route ?? 'Oral',
          }))
          : [],
      )
      setDietaryAdvice(rx?.dietary_advice || '')
      setGeneralAdvice(rx?.general_advice || '')
    }
  }

  // Copy Section Findings Handlers (D-19-08)
  const appendClinicalPhrase = (prev: string, phrase: string): string => {
    const trimmed = prev.trim()
    if (!trimmed) return phrase
    if (trimmed.endsWith(',') || trimmed.endsWith('.')) {
      return `${trimmed} ${phrase}`
    }
    return `${trimmed}, ${phrase}`
  }

  const handleAppendQuickPhrase = (phrase: string) => {
    if (isReadOnly) return
    setSymptoms((prev) => appendClinicalPhrase(prev, phrase))
    scheduleAutoSave()
  }

  const handleAppendExaminationPhrase = (phrase: string) => {
    if (isReadOnly) return
    setClinicalNotes((prev) => appendClinicalPhrase(prev, phrase))
    scheduleAutoSave()
  }

  const handleCopySymptoms = () => {
    if (isReadOnly) return
    if (priorEncounter?.symptoms) {
      setSymptoms(priorEncounter.symptoms)
      scheduleAutoSave()
    }
  }

  const handleCopyVitals = () => {
    if (isReadOnly) return
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
    if (isReadOnly) return
    if (priorEncounter?.diagnosis) {
      setDiagnosis(priorEncounter.diagnosis)
      scheduleAutoSave()
    }
  }

  // Prescription Handlers
  const handleAuthorisePrescription = async () => {
    if (isReadOnly || authorisingRxRef.current || createRxMutation.isPending || authoriseRxMutation.isPending) {
      return
    }
    const trimmedDiagnosis = diagnosis.trim()
    if (!activeRxRecord?.id && trimmedDiagnosis.length < 2) {
      throw new Error('Diagnosis is required (minimum 2 characters) before authorising a prescription.')
    }
    authorisingRxRef.current = true
    try {
      if (activeRxRecord?.id) {
        await authoriseRxMutation.mutateAsync(activeRxRecord.id)
        setActiveRxRecord({ ...activeRxRecord, status: 'AUTHORISED', is_printable: true })
        toast.success('Prescription authorised successfully.')
      } else {
        // The prescription belongs to this consultation, so a new consultation is saved first.
        if (encounterIdRef.current === 0) {
          const saved = await saveNow()
          if (!saved || encounterIdRef.current === 0) {
            const msg =
              'The consultation could not be saved, so the prescription was not authorised. Check the connection and try again.'
            toast.error(msg)
            throw new Error(msg)
          }
        }
        const res = await createRxMutation.mutateAsync({
          patient_id: effectivePatientId,
          encounter_id: encounterIdRef.current,
          status: 'AUTHORISED',
          diagnosis: trimmedDiagnosis,
          dietary_advice: dietaryAdvice || null,
          general_advice: generalAdvice || null,
          follow_up_date: followUpDate || null,
          items: prescriptionItems,
        })
        setActiveRxRecord(res)
        toast.success('Prescription created and authorised.')
      }
    } finally {
      authorisingRxRef.current = false
    }
  }

  const handleCancelAndReissuePrescription = async (reason: string) => {
    if (isReadOnly) return
    if (activeRxRecord?.id) {
      await cancelRxMutation.mutateAsync({ id: activeRxRecord.id, reason })
      setActiveRxRecord(null)
      setPrescriptionItems([])
      toast.success('Prescription cancelled. You can now author a re-issued prescription.')
    }
  }

  const specialty = asSpecialty(deptTemplate?.code)
  const isPhysiotherapy = specialty === 'PHYSIOTHERAPY'
  const isOphthalmology = specialty === 'OPHTHALMOLOGY'

  const hasSpecialtyInput = hasMeaningfulSpecialtyData(specialtyData)
  const requiredSpecialtyFields: string[] = Array.isArray(deptTemplate?.active_version?.schema_json?.required)
    ? (deptTemplate.active_version.schema_json.required as unknown[]).filter(
      (k): k is string => typeof k === 'string' && k.length > 0,
    )
    : []

  const followUpMissingDate = followUpReason.trim().length > 0 && !followUpDate

  // Same minimums enforced on Finalise; optional specialty form fields only required once started.
  const requiredItems: Array<{ key: string; sectionId: string; label: string; done: boolean }> = [
    { key: 'symptoms', sectionId: 'section-complaints', label: 'Chief complaint', done: symptoms.trim().length >= 2 },
    { key: 'diagnosis', sectionId: 'section-diagnosis', label: 'Diagnosis', done: diagnosis.trim().length >= 2 },
    ...(hasSpecialtyInput
      ? requiredSpecialtyFields.map((fieldKey) => {
        const val = specialtyData[fieldKey]
        const done =
          val !== undefined &&
          val !== null &&
          (typeof val === 'number' ? !Number.isNaN(val) : String(val).trim().length > 0)
        return {
          key: `specialty:${fieldKey}`,
          sectionId: 'section-specialty',
          label: resolveSpecialtyFieldLabel(deptTemplate?.active_version?.schema_json, fieldKey),
          done,
        }
      })
      : []),
    ...(followUpMissingDate
      ? [{ key: 'followup:date', sectionId: 'section-followup', label: 'Follow-up date', done: false }]
      : []),
  ]
  const missingRequiredItems = requiredItems.filter((item) => !item.done)
  const showValidationHints = highlightMissingRequired && missingRequiredItems.length > 0
  const missingSpecialtyItems = missingRequiredItems.filter((item) => item.sectionId === 'section-specialty')

  const headerRef = useRef<HTMLElement | null>(null)
  const spyPausedUntilRef = useRef(0)
  const [stickyLayout, setStickyLayout] = useState<{
    headerHeight: number
    asideMax: number
  } | null>(null)
  const workspaceVisible =
    !needsOpen && !(encounterId > 0 && (isEncounterPending || isEncounterError))

  const visibleSections = useMemo(() => {
    const sections: Array<{ id: string; label: string }> = [
      CONSULTATION_SECTIONS[0],
      CONSULTATION_SECTIONS[1],
      CONSULTATION_SECTIONS[2],
      CONSULTATION_SECTIONS[3],
    ]
    if (encounterId > 0) {
      sections.push({ id: 'section-investigations', label: 'Investigations' })
    }
    sections.push(CONSULTATION_SECTIONS[4], CONSULTATION_SECTIONS[5])
    if (isFinalised) {
      sections.push({ id: 'section-addenda', label: 'Addenda' })
    }
    return sections
  }, [encounterId, isFinalised])

  const scrollToAnchor = useCallback((anchorId: string) => {
    setActiveAnchor(anchorId)
    // Hold the scroll spy while the smooth scroll passes the sections in between.
    spyPausedUntilRef.current = Date.now() + 900
    document.getElementById(anchorId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleRequestFinalise = () => {
    if (isReadOnly) return
    if (!effectivePatientId) {
      toast.error('Open a patient from the consultation queue first.')
      return
    }
    if (missingRequiredItems.length > 0) {
      setHighlightMissingRequired(true)
      if (missingRequiredItems.length === 1 && followUpMissingDate) {
        toast.error('Follow-up recommendation requires a scheduled date.')
      } else {
        const names = missingRequiredItems.map((item) => item.label).join(', ')
        toast.error(
          followUpMissingDate
            ? `Complete required fields before finalising: ${names}. Follow-up recommendation requires a scheduled date.`
            : `Complete required fields before finalising: ${names}.`,
        )
      }
      scrollToAnchor(missingRequiredItems[0].sectionId)
      return
    }
    setHighlightMissingRequired(false)
    setShowFinaliseConfirm(true)
  }

  // Finalisation Handler
  const handleFinaliseConsultation = async () => {
    if (isReadOnly) return
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (!effectivePatientId) {
      toast.error('Open a patient from the consultation queue first.')
      setShowFinaliseConfirm(false)
      return
    }
    if (missingRequiredItems.length > 0) {
      setHighlightMissingRequired(true)
      if (missingRequiredItems.length === 1 && followUpMissingDate) {
        toast.error('Follow-up recommendation requires a scheduled date.')
      } else {
        const names = missingRequiredItems.map((item) => item.label).join(', ')
        toast.error(
          followUpMissingDate
            ? `Complete required fields before finalising: ${names}. Follow-up recommendation requires a scheduled date.`
            : `Complete required fields before finalising: ${names}.`,
        )
      }
      setShowFinaliseConfirm(false)
      scrollToAnchor(missingRequiredItems[0].sectionId)
      return
    }

    setIsFinalising(true)
    try {
      // Everything typed so far reaches the server before the record locks: a finalised
      // encounter accepts no more vitals or assessment changes.
      const saved = await saveNow()
      if (!saved || encounterIdRef.current === 0) {
        toast.error(
          'Your latest changes could not be saved, so the consultation was not finalised. Check the connection and try again.',
        )
        setShowFinaliseConfirm(false)
        return
      }
      const targetId = encounterIdRef.current

      // Lock the encounter FIRST so a failed finalise (e.g. 409 conflict) never creates an orphaned follow-up.
      const res = await finaliseMutation.mutateAsync({
        id: targetId,
        body: {
          symptoms,
          diagnosis,
          clinical_notes: clinicalNotes,
          version_id: versionRef.current,
        },
      })
      isFinalisedRef.current = true
      setIsFinalised(true)
      isDirtyRef.current = false
      setUnsavedEdits(false)
      setHighlightMissingRequired(false)
      setFinalisedAt(res.finalised_at)
      versionRef.current = res.version_id
      setVersionId(res.version_id)
      setShowFinaliseConfirm(false)

      // Send follow-up recommendation only after finalisation succeeds; backend permits POST on finalised encounters.
      let followUpFailed = false
      if (followUpDate && !followUpRecordedRef.current) {
        try {
          await createFollowUpMutation.mutateAsync({
            encounterId: targetId,
            body: {
              recommended_date: followUpDate,
              recommended_doctor_id: followUpDoctorId,
              clinical_reason: followUpReason.trim() || undefined,
            },
          })
          followUpRecordedRef.current = true
          setFollowUpRetryError(null)
        } catch (fuErr: unknown) {
          followUpFailed = true
          const msg =
            fuErr instanceof Error
              ? fuErr.message
              : 'Unable to send follow-up recommendation to reception.'
          setFollowUpRetryError(msg)
          toast.warning(
            'Consultation was finalised and locked, but the follow-up recommendation could not be sent yet. Retry from the Follow-up section below.',
          )
        }
      }

      if (!followUpFailed) {
        toast.success('Consultation finalised and locked. Notes are now permanently immutable.')
      }
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        setConflictError('Encounter was modified in another session.')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to finalise consultation.')
      }
      setShowFinaliseConfirm(false)
    } finally {
      setIsFinalising(false)
    }
  }

  const handleRetrySendFollowUp = async () => {
    if (
      isOtherDoctorEncounter ||
      sendingFollowUpRef.current ||
      createFollowUpMutation.isPending ||
      followUpRecordedRef.current ||
      !followUpDate ||
      encounterIdRef.current === 0
    ) {
      return
    }
    sendingFollowUpRef.current = true
    try {
      await createFollowUpMutation.mutateAsync({
        encounterId: encounterIdRef.current,
        body: {
          recommended_date: followUpDate,
          recommended_doctor_id: followUpDoctorId,
          clinical_reason: followUpReason.trim() || undefined,
        },
      })
      followUpRecordedRef.current = true
      setFollowUpRetryError(null)
      toast.success('Follow-up recommendation sent to reception.')
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to send follow-up recommendation to reception.'
      setFollowUpRetryError(msg)
      toast.error(`Follow-up recommendation failed: ${msg}`)
    } finally {
      sendingFollowUpRef.current = false
    }
  }

  // Addendum Handler
  const handleAddAddendum = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isOtherDoctorEncounter || !addendumText.trim() || encounterId === 0) return
    try {
      const newAddendum = await addendumMutation.mutateAsync({
        id: encounterId,
        body: { addendum_text: addendumText.trim() },
      })
      setAddenda((prev) => [...prev, newAddendum])
      setAddendumText('')
      toast.success('Addendum successfully appended to consultation record.')
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        setConflictError('Encounter was modified in another session.')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to append addendum.')
      }
    }
  }

  // The page scrolls inside AppShell's <main>, which has 16px top padding. Sticky boxes stop at the
  // padding edge, so the header uses top: -16px to sit flush, and the side panel (top: header
  // height) lands 16px under it. Section jumps align to the scroll edge, so they need header + 16px.
  // The same effect moves the active section tab as the doctor scrolls.
  useEffect(() => {
    if (!workspaceVisible) return
    const header = headerRef.current
    const scroller = header?.closest('main')
    if (!header || !scroller) return

    const measure = () => {
      const headerHeight = header.offsetHeight
      setStickyLayout({
        headerHeight,
        asideMax: Math.max(scroller.clientHeight - headerHeight - 32, 240),
      })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(header)
    observer?.observe(scroller)

    const onScroll = () => {
      if (Date.now() < spyPausedUntilRef.current) return
      const line = header.getBoundingClientRect().bottom + 32
      let current: string = visibleSections[0].id
      for (const section of visibleSections) {
        const el = document.getElementById(section.id)
        if (el && el.getBoundingClientRect().top <= line) current = section.id
      }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        current = visibleSections[visibleSections.length - 1].id
      }
      setActiveAnchor(current)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer?.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [workspaceVisible, visibleSections])

  if (needsOpen) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        {openError ? (
          <div role="alert" className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            <p className="font-semibold">The consultation could not be opened.</p>
            <p>{openError}</p>
            <Link
              to="/doctor"
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 font-semibold text-red-800 hover:bg-red-100"
            >
              <IconArrowLeft size={16} aria-hidden="true" />
              Back to consultation queue
            </Link>
          </div>
        ) : (
          <div role="status" className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
            Opening consultation...
          </div>
        )}
      </AppShell>
    )
  }

  if (encounterId > 0 && isEncounterPending) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        <div role="status" className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Loading clinical encounter workspace...
        </div>
      </AppShell>
    )
  }

  if (encounterId > 0 && isEncounterError) {
    return (
      <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          Encounter access restricted or not found: {encounterError?.message}
        </div>
      </AppShell>
    )
  }

  // Never fill clinical identity with stand-in values: an unknown patient, URN or token is shown
  // as missing, so nobody mistakes a placeholder for a real record.
  const patientName = patient?.full_name || existingEncounter?.patient_name || null
  const patientUrn = patient?.urn || existingEncounter?.patient_urn || null
  const queueToken = bookedAppointment?.token_number ?? null
  const departmentName =
    deptTemplate?.name_en ||
    myDepartments.find((d) => d.id === departmentId)?.name_en ||
    'General consultation'
  const recordedAllergies = patient?.allergies
  const patientAllergies = hasReportedAllergies(recordedAllergies) ? recordedAllergies : null
  const patientSex = patient
    ? patient.gender === 'M'
      ? 'Male'
      : patient.gender === 'F'
        ? 'Female'
        : 'Other'
    : null

  const stageLabel = isFinalised
    ? 'Finalised consultation'
    : isOtherDoctorEncounter
      ? 'Consultation draft (view only)'
      : encounterId > 0
        ? 'Consultation draft'
        : 'New consultation'

  const rxAuthorised = activeRxRecord?.status === 'AUTHORISED'
  // Medicines only reach the server when the prescription is authorised.
  const unauthorisedMedicines = rxAuthorised ? 0 : prescriptionItems.length
  const unauthorisedRxPending =
    !rxAuthorised &&
    (prescriptionItems.length > 0 || Boolean(dietaryAdvice.trim() || generalAdvice.trim()))
  // A follow-up is sent on Finalise; until then, leaving the page would lose it.
  const followUpPending = !followUpRecorded && Boolean(followUpDate || followUpReason.trim())
  const followUpNeedsRetry = isFinalised && Boolean(followUpDate) && !followUpRecorded && Boolean(followUpRetryError)

  const investigationsCount = Array.isArray(investigationsQuery.data) ? investigationsQuery.data.length : 0
  const hasVitalsEntered = Object.values(vitals).some((v) => v !== null && v !== undefined && v !== '')
  const sectionFilled: Record<string, boolean> = {
    'section-complaints': symptoms.trim().length >= 2,
    'section-vitals': hasVitalsEntered,
    'section-specialty': hasSpecialtyInput,
    'section-diagnosis': diagnosis.trim().length >= 2,
    'section-investigations': investigationsCount > 0,
    'section-prescriptions': rxAuthorised || prescriptionItems.length > 0,
    'section-followup': followUpRecorded || Boolean(followUpDate),
    'section-addenda': addenda.length > 0,
  }

  const rxStatusMeta = rxAuthorised
    ? { label: 'Authorised', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
    : activeRxRecord?.status === 'DRAFT' || unauthorisedRxPending
      ? { label: 'Draft (unauthorised)', className: 'border-amber-200 bg-amber-50 text-amber-800' }
      : { label: 'No prescription', className: 'border-slate-200 bg-slate-50 text-slate-600' }

  const followUpStatusMeta = followUpRecorded
    ? { label: 'Sent to reception', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
    : followUpNeedsRetry
      ? { label: 'Send failed — retry', className: 'border-red-200 bg-red-50 text-red-800' }
      : followUpPending
        ? { label: 'Pending on finalise', className: 'border-amber-200 bg-amber-50 text-amber-800' }
        : { label: 'None', className: 'border-slate-200 bg-slate-50 text-slate-600' }

  let statusPill: ReactNode
  if (isFinalised) {
    statusPill = (
      <span className={`${STATUS_PILL} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <IconLock size={14} className="shrink-0" aria-hidden="true" />
        Finalised & Locked
      </span>
    )
  } else if (isOtherDoctorEncounter) {
    statusPill = (
      <span className={`${STATUS_PILL} border-amber-200 bg-amber-50 text-amber-900`}>
        <IconLock size={14} className="shrink-0" aria-hidden="true" />
        Read-only (other doctor)
      </span>
    )
  } else if (autoSaveStatus === 'OFFLINE_ERROR') {
    statusPill = (
      <span role="alert" data-testid="auto-save-pill" className={`${STATUS_PILL} border-red-200 bg-red-50 text-red-800`}>
        <IconAlertTriangle size={14} className="shrink-0" aria-hidden="true" />
        Network error — unsaved changes present. Retrying connection...
      </span>
    )
  } else if (autoSaveStatus === 'SAVING') {
    statusPill = (
      <span data-testid="auto-save-pill" className={`${STATUS_PILL} border-amber-200 bg-amber-50 text-amber-800`}>
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
        Saving consultation draft...
      </span>
    )
  } else if (encounterId === 0) {
    statusPill = (
      <span className={`${STATUS_PILL} border-slate-200 bg-slate-50 text-slate-600`}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
        Not saved yet
      </span>
    )
  } else if (unsavedEdits) {
    statusPill = (
      <span className={`${STATUS_PILL} border-amber-200 bg-amber-50 text-amber-800`}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        Unsaved changes
      </span>
    )
  } else if (autoSaveStatus === 'SAVED' && lastSavedTime) {
    statusPill = (
      <span data-testid="auto-save-pill" className={`${STATUS_PILL} border-emerald-200 bg-emerald-50 text-emerald-800 tabular-nums`}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
        Saved to server at {lastSavedTime}
      </span>
    )
  } else {
    statusPill = (
      <span className={`${STATUS_PILL} border-slate-200 bg-slate-50 text-slate-600`}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
        Draft
      </span>
    )
  }

  const stickyVars = stickyLayout
    ? ({
      '--consult-aside-top': `${stickyLayout.headerHeight}px`,
      '--consult-scroll-margin': `${stickyLayout.headerHeight + 16}px`,
      '--consult-aside-max': `${stickyLayout.asideMax}px`,
    } as CSSProperties)
    : undefined

  const hasBanners = Boolean(conflictError || isOtherDoctorEncounter)
  const patientCareAdvice =
    [generalAdvice.trim(), dietaryAdvice.trim()].filter(Boolean).join('\n\n') || undefined

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      <UnsavedChangesGuard
        dirty={
          !isOtherDoctorEncounter &&
          (((unsavedEdits || unauthorisedRxPending || followUpPending) && !isReadOnly) || followUpNeedsRetry)
        }
        bypassRef={bypassGuardRef}
      />
      <div className="pb-10 text-slate-900" style={stickyVars}>
        {/* Sticky clinical header: patient identity, save state, actions and section tabs. */}
        <header
          ref={headerRef}
          data-testid="sticky-clinical-header"
          className="sticky -top-4 z-30 -mx-4 -mt-4 border-b border-slate-200 bg-white shadow-2xs sm:-mx-6 xl:-mx-8"
        >
          <div className="px-4 pt-3 sm:px-6 xl:px-8">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-[1_1_320px] items-start gap-3">
                <Link
                  to="/doctor"
                  className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900"
                  title="Back to consultation queue"
                  aria-label="Back to consultation queue"
                >
                  <IconArrowLeft size={16} className="shrink-0" />
                </Link>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-slate-500">
                    <span>{stageLabel}</span>
                    {queueToken !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span data-testid="queue-token" className="font-mono font-semibold text-slate-700 tabular-nums">
                          Token #{String(queueToken).padStart(3, '0')}
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="truncate text-xl font-semibold tracking-tight leading-tight text-slate-900 sm:text-2xl">
                    {patientName ?? 'No patient selected'}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-slate-600">
                    {patientUrn ? (
                      <span className="font-mono text-xs font-medium text-slate-700 tabular-nums">{patientUrn}</span>
                    ) : (
                      <span data-testid="no-patient-hint" className="text-xs font-semibold text-amber-700">
                        Open a patient from the consultation queue to start.
                      </span>
                    )}
                    {patient && (
                      <>
                        <span aria-hidden="true" className="text-slate-500">·</span>
                        <span className="tabular-nums">
                          {patient.age_years} y · {patientSex}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true" className="text-slate-500">·</span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {departmentName}
                    </span>
                    {patientAllergies && (
                      <span
                        data-testid="allergy-alert-badge"
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#8E1C3D] px-2 py-0.5 text-xs font-semibold text-white"
                      >
                        <IconAlertTriangle size={14} className="shrink-0" aria-hidden="true" />
                        <span>Allergy: {patientAllergies}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!isFinalised}
                  onClick={() => setShowPrintSummary(true)}
                  title={isFinalised ? undefined : 'Available after the consultation is finalised.'}
                  className={`${HEADER_BUTTON} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-500 disabled:hover:bg-white`}
                >
                  <IconPrinter size={16} className="shrink-0" aria-hidden="true" />
                  <span>Print Consultation Summary</span>
                </button>
                {!isOtherDoctorEncounter && (
                  <button
                    type="button"
                    onClick={handleRequestFinalise}
                    disabled={isFinalised}
                    className={`${HEADER_BUTTON} bg-[#8E1C3D] text-white shadow-2xs hover:bg-[#721631] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none`}
                  >
                    <IconCheck size={16} className="shrink-0" aria-hidden="true" />
                    <span>Finalise Consultation</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2.5 flex items-end justify-between gap-4">
              <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <nav
                  data-testid="jump-navigation-rail"
                  aria-label="Consultation sections"
                  className="flex min-w-max items-center gap-1"
                >
                  {visibleSections.map((section, index) => {
                    const isActive = activeAnchor === section.id
                    const isFilled = Boolean(sectionFilled[section.id])
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => scrollToAnchor(section.id)}
                        aria-current={isActive ? 'location' : undefined}
                        className={`inline-flex cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1.5 text-sm transition-colors duration-150 ${isActive
                          ? 'border-[#8E1C3D] font-semibold text-[#8E1C3D]'
                          : 'border-transparent font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900'
                          }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${isActive ? 'bg-[#8E1C3D] text-white' : 'bg-slate-100 text-slate-600'
                            }`}
                        >
                          {index + 1}
                        </span>
                        {section.label}
                        {isFilled && (
                          <span
                            data-testid={`tab-filled-${section.id}`}
                            aria-hidden="true"
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          />
                        )}
                      </button>
                    )
                  })}
                </nav>
              </div>
              <div className="shrink-0 pb-2">{statusPill}</div>
            </div>
          </div>
        </header>

        {hasBanners && (
          <div className="space-y-3 pt-4">
            {isOtherDoctorEncounter && (
              <div
                role="status"
                data-testid="encounter-readonly-banner"
                className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                <IconLock size={16} className="mt-0.5 shrink-0 text-amber-800" aria-hidden="true" />
                <p>
                  <span className="font-semibold">View-only consultation.</span> This consultation belongs to{' '}
                  {existingEncounter?.doctor_name ? withDoctorTitle(existingEncounter.doctor_name) : 'another doctor'}.
                  You can review the clinical record, but editing, billing, and finalisation are disabled.
                </p>
              </div>
            )}
            {conflictError && (
              <ConflictBanner
                message={conflictError}
                actionLabel="Reload Latest Encounter"
                onReload={() => {
                  void handleReloadLatest()
                }}
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-5 pt-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* Consultation sections, in the same order as the tabs above. */}
          <div className="min-w-0 space-y-5">
            {/* 1. Chief complaints */}
            <section id="section-complaints" data-testid="section-complaints" className={SECTION_CARD}>
              <SectionHeading title="Chief Complaints & History" required={!isReadOnly} />
              {!isReadOnly && (
                <QuickPhraseBar
                  departmentId={departmentId}
                  section="COMPLAINTS"
                  onSelectPhrase={handleAppendQuickPhrase}
                  readOnly={isReadOnly}
                />
              )}
              <div>
                <label htmlFor="symptoms-input" className={FIELD_LABEL}>
                  Chief Complaints & Symptoms
                  {!isReadOnly && (
                    <span className="text-red-700" aria-hidden="true">
                      {' '}*
                    </span>
                  )}
                </label>
                {isReadOnly ? (
                  <div className={READ_ONLY_FIELD}>{symptoms || '—'}</div>
                ) : (
                  <>
                    <textarea
                      id="symptoms-input"
                      rows={4}
                      value={symptoms}
                      onChange={(e) => {
                        setSymptoms(e.target.value)
                        scheduleAutoSave()
                      }}
                      onBlur={handleSectionBlur}
                      placeholder="e.g. Lower back pain for 2 weeks, worse on bending. Or pick a quick phrase above."
                      aria-invalid={showValidationHints && symptoms.trim().length < 2 ? true : undefined}
                      className={`${TEXT_FIELD} leading-relaxed ${showValidationHints && symptoms.trim().length < 2 ? 'border-red-400 focus:border-red-600 focus:ring-red-600/15' : ''}`}
                    />
                    {showValidationHints && symptoms.trim().length < 2 && (
                      <p className="mt-1.5 text-xs font-medium text-red-700">
                        Chief complaint is required (minimum 2 characters) before finalising.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* 2. Vitals */}
            <section id="section-vitals" data-testid="section-vitals" className={SECTION_CARD}>
              <VitalsBiometricsSection
                vitals={vitals}
                onChange={(newVitals) => {
                  setVitals(newVitals)
                  scheduleAutoSave()
                }}
                onBlur={handleSectionBlur}
                readOnly={isReadOnly}
                serverBmi={serverVitals?.bmi ? Number(serverVitals.bmi) : null}
              />
              {!isReadOnly && (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  Optional. Record only the observations that are relevant.
                </p>
              )}
            </section>

            {/* 3. Specialty assessment */}
            <section id="section-specialty" data-testid="section-specialty" className={SECTION_CARD}>
              {showValidationHints && missingSpecialtyItems.length > 0 && (
                <div
                  role="alert"
                  data-testid="specialty-validation-alert"
                  className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                >
                  Complete required assessment fields before finalising:{' '}
                  {missingSpecialtyItems.map((item) => item.label).join(', ')}.
                </div>
              )}
              {isPhysiotherapy ? (
                <>
                  <SpecialtyPhysiotherapyForm
                    data={specialtyData as PhysiotherapyFormData}
                    onChange={(newData) => {
                      setSpecialtyData(newData)
                      scheduleAutoSave()
                    }}
                    onBlur={handleSectionBlur}
                    readOnly={isReadOnly}
                  />
                  {encounterId > 0 && effectivePatientId > 0 && !isOtherDoctorEncounter && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50/50 px-3.5 py-2.5">
                      <span className="text-xs text-teal-900">
                        Multi-session packages, modalities &amp; daily VAS progress are tracked in Physiotherapy Treatment.
                      </span>
                      <Link
                        to={`/doctor/treatment-plans?patient_id=${effectivePatientId}&encounter_id=${encounterId}`}
                        data-testid="physio-treatment-plan-link"
                        className="shrink-0 whitespace-nowrap text-xs font-semibold text-teal-800 underline-offset-2 transition-colors hover:text-teal-950 hover:underline"
                      >
                        Manage Physiotherapy Treatment Plan →
                      </Link>
                    </div>
                  )}
                </>
              ) : isOphthalmology ? (
                <SpecialtyOphthalmologyForm
                  data={specialtyData as OphthalmologyFormData}
                  onChange={(newData) => {
                    setSpecialtyData(newData)
                    scheduleAutoSave()
                  }}
                  onBlur={handleSectionBlur}
                  readOnly={isReadOnly}
                />
              ) : departmentId != null && isTemplatePending ? (
                <>
                  <SectionHeading title={`Clinical Assessment — ${departmentName}`} />
                  <p
                    role="status"
                    data-testid="specialty-loading"
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600"
                  >
                    Loading department assessment template...
                  </p>
                </>
              ) : departmentId != null ? (
                <>
                  <SectionHeading title={`Clinical Assessment — ${departmentName}`} />
                  <p
                    data-testid="specialty-general-info"
                    className="max-w-prose rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-700"
                  >
                    No department-specific structured form is configured for this department. Record
                    examination findings under Diagnosis &amp; Clinical Impressions below.
                  </p>
                </>
              ) : (
                <>
                  <SectionHeading title="Specialty Assessment" />
                  <p
                    data-testid="specialty-unknown"
                    className="max-w-prose rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm leading-relaxed text-amber-900"
                  >
                    No specialty form for this consultation, because it has no department. The
                    appointment was booked without one, or your department is not set. Ask the
                    administrator to assign your department under Doctors &amp; Fees, then
                    Departments.
                  </p>
                </>
              )}
            </section>

            {/* 4. Diagnosis */}
            <section id="section-diagnosis" data-testid="section-diagnosis" className={SECTION_CARD}>
              <SectionHeading title="Diagnosis & Clinical Impressions" required={!isReadOnly} />
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label htmlFor="clinical-notes-input" className="block text-xs font-semibold text-slate-700">
                      Examination findings
                    </label>
                    {!isReadOnly && (
                      <button
                        type="button"
                        data-testid="toggle-examination-phrases"
                        aria-expanded={showExamQuickPhrases}
                        onClick={() => setShowExamQuickPhrases((prev) => !prev)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                      >
                        {showExamQuickPhrases ? (
                          <IconChevronDown size={13} aria-hidden="true" />
                        ) : (
                          <IconChevronRight size={13} aria-hidden="true" />
                        )}
                        <span>Quick phrases</span>
                      </button>
                    )}
                  </div>
                  {!isReadOnly && showExamQuickPhrases && (
                    <QuickPhraseBar
                      departmentId={departmentId}
                      section="EXAMINATION"
                      onSelectPhrase={handleAppendExaminationPhrase}
                      readOnly={isReadOnly}
                    />
                  )}
                  {isReadOnly ? (
                    <div className={READ_ONLY_FIELD}>{clinicalNotes || '—'}</div>
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
                      placeholder="Examination findings and clinical impressions..."
                      className={`${TEXT_FIELD} leading-relaxed`}
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="diagnosis-input" className={FIELD_LABEL}>
                    Diagnosis
                    {!isReadOnly && (
                      <span className="text-red-700" aria-hidden="true">
                        {' '}*
                      </span>
                    )}
                  </label>
                  {isReadOnly ? (
                    <div className={`${READ_ONLY_FIELD} font-semibold`}>{diagnosis || '—'}</div>
                  ) : (
                    <>
                      <input
                        id="diagnosis-input"
                        type="text"
                        value={diagnosis}
                        onChange={(e) => {
                          setDiagnosis(e.target.value)
                          scheduleAutoSave()
                        }}
                        onBlur={handleSectionBlur}
                        placeholder="e.g. Mechanical low back pain"
                        aria-invalid={showValidationHints && diagnosis.trim().length < 2 ? true : undefined}
                        className={`${TEXT_FIELD} ${showValidationHints && diagnosis.trim().length < 2 ? 'border-red-400 focus:border-red-600 focus:ring-red-600/15' : ''}`}
                      />
                      {showValidationHints && diagnosis.trim().length < 2 && (
                        <p className="mt-1.5 text-xs font-medium text-red-700">
                          Diagnosis is required (minimum 2 characters) before finalising.
                        </p>
                      )}
                    </>
                  )}
                </div>

                {encounterId > 0 && (
                  <EncounterStructuredDiagnosesPanel
                    encounterId={encounterId}
                    patientId={effectivePatientId}
                    isReadOnly={isReadOnly}
                  />
                )}
              </div>
            </section>

            {/* Collapsible Investigation Orders (saved encounters only) */}
            {encounterId > 0 && (
              <section
                id="section-investigations"
                data-testid="section-investigations"
                aria-label="Investigation orders"
                className={SECTION_CARD}
              >
                <EncounterInvestigationOrdersPanel
                  encounterId={encounterId}
                  patientId={effectivePatientId}
                  isReadOnly={isReadOnly}
                />
              </section>
            )}

            {/* 5. Prescription */}
            <section id="section-prescriptions" data-testid="section-prescriptions" className={SECTION_CARD}>
              <PrescriptionFormSection
                prescription={activeRxRecord}
                items={prescriptionItems}
                diagnosis={diagnosis}
                dietaryAdvice={dietaryAdvice}
                generalAdvice={generalAdvice}
                onItemsChange={(newItems) => {
                  setPrescriptionItems(newItems)
                }}
                onDietaryAdviceChange={(val) => {
                  setDietaryAdvice(val)
                }}
                onGeneralAdviceChange={(val) => {
                  setGeneralAdvice(val)
                }}
                onAuthorise={handleAuthorisePrescription}
                onCancelAndReissue={handleCancelAndReissuePrescription}
                onBlur={handleSectionBlur}
                readOnly={isReadOnly}
                isAuthorising={authoriseRxMutation.isPending || createRxMutation.isPending}
                isCancelling={cancelRxMutation.isPending}
              />
            </section>

            {/* 6. Follow-up */}
            <section id="section-followup" data-testid="section-followup" className={SECTION_CARD}>
              <FollowUpSection
                recommendedDate={followUpDate}
                recommendedDoctorId={followUpDoctorId}
                clinicalReason={followUpReason}
                doctors={doctors}
                onDateChange={setFollowUpDate}
                onDoctorChange={setFollowUpDoctorId}
                onReasonChange={setFollowUpReason}
                onBlur={handleSectionBlur}
                readOnly={isReadOnly || followUpRecorded}
                dateError={
                  showValidationHints && followUpMissingDate
                    ? 'Follow-up recommendation requires a scheduled date.'
                    : null
                }
                retryError={!isOtherDoctorEncounter && followUpNeedsRetry ? followUpRetryError : null}
                onRetrySend={handleRetrySendFollowUp}
                isSendingFollowUp={createFollowUpMutation.isPending}
              />
              {(!isReadOnly || followUpRecorded) && (
                <p data-testid="follow-up-save-note" className="mt-3 text-xs leading-relaxed text-slate-500">
                  {followUpRecorded
                    ? 'This follow-up recommendation has been sent to reception and cannot be changed here.'
                    : 'The follow-up recommendation is sent to reception when you finalise this consultation.'}
                </p>
              )}
            </section>

            {/* Addenda after finalisation */}
            {isFinalised && (
              <section id="section-addenda" data-testid="section-addenda" className={SECTION_CARD}>
                <div className="-mx-4 -mt-4 mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:-mx-5 sm:-mt-5 sm:px-5">
                  <h2 className="text-base font-semibold tracking-tight text-slate-900 tabular-nums">
                    Dated Clinical Addenda ({addenda.length})
                  </h2>
                  <span className="text-xs text-slate-500">Each addendum is kept permanently</span>
                </div>

                {addenda.length === 0 ? (
                  <p className="text-sm leading-relaxed text-slate-500">No addenda recorded for this encounter.</p>
                ) : (
                  <ol className="space-y-3">
                    {addenda.map((ad: AddendumRead, idx: number) => (
                      <li key={ad.id} className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm">
                        <div className="flex flex-wrap justify-between gap-2 text-xs font-semibold text-amber-900 tabular-nums">
                          <span>
                            Addendum #{idx + 1} · {withDoctorTitle(ad.doctor_name)}
                          </span>
                          <span>{formatIst(ad.created_at)}</span>
                        </div>
                        <p className="max-w-prose whitespace-pre-wrap leading-relaxed text-slate-800">{ad.addendum_text}</p>
                      </li>
                    ))}
                  </ol>
                )}

                {!isOtherDoctorEncounter && (
                  <form onSubmit={handleAddAddendum} className="space-y-2.5 pt-4">
                    <label htmlFor="addendum-field" className={FIELD_LABEL}>
                      Append Addendum Note
                    </label>
                    <textarea
                      id="addendum-field"
                      rows={3}
                      value={addendumText}
                      onChange={(e) => setAddendumText(e.target.value)}
                      placeholder="Record follow-up remarks, phone consultation, or post-finalisation consultation addendum note..."
                      className={`${TEXT_FIELD} leading-relaxed`}
                    />
                    <button
                      type="submit"
                      disabled={addendumMutation.isPending || !addendumText.trim()}
                      className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-500"
                    >
                      {addendumMutation.isPending ? 'Appending...' : '+ Append Addendum'}
                    </button>
                  </form>
                )}
              </section>
            )}
          </div>

          {/* Side panel: 3 compact groups — Clinical Context, Encounter Status, Billing. */}
          <aside
            data-testid="persistent-side-panel"
            aria-label="Patient summary and previous consultation"
            className="min-w-0 space-y-4 xl:sticky xl:top-[var(--consult-aside-top)] xl:max-h-[var(--consult-aside-max)] xl:overflow-y-auto"
          >
            {/* Group 1: Clinical Context */}
            <section
              data-testid="sidebar-group-context"
              aria-labelledby="sidebar-context-heading"
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
            >
              <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
                <h2
                  id="sidebar-context-heading"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Clinical Context
                </h2>
              </div>

              <div className="divide-y divide-slate-200">
                {patient && (
                  <div className="space-y-2.5 p-3.5">
                    {patientAllergies ? (
                      <div className="rounded-lg bg-[#8E1C3D] p-3 text-white">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <IconAlertTriangle size={14} className="shrink-0" aria-hidden="true" />
                          <span>Allergy alert</span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed">{patientAllergies}</p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">Allergies:</span> None reported
                      </div>
                    )}

                    <div>
                      <button
                        type="button"
                        onClick={() => setShowPatientDetails((prev) => !prev)}
                        aria-expanded={showPatientDetails}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-1.5">
                          {showPatientDetails ? (
                            <IconChevronDown size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
                          ) : (
                            <IconChevronRight size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
                          )}
                          <span>Patient details</span>
                        </span>
                        <span className="font-mono text-xs font-medium text-slate-500 tabular-nums">
                          {patient.mobile || '—'}
                        </span>
                      </button>
                      {showPatientDetails && (
                        <dl className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1 text-xs">
                          <div className="flex justify-between gap-3 py-1.5">
                            <dt className="text-slate-500">Mobile</dt>
                            <dd className="font-mono text-slate-900 tabular-nums">{patient.mobile || '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-3 py-1.5">
                            <dt className="text-slate-500">Emergency contact</dt>
                            <dd className="text-right text-slate-900 tabular-nums">{patient.emergency_contact || '—'}</dd>
                          </div>
                          <div className="py-1.5">
                            <dt className="text-slate-500">Address</dt>
                            <dd className="mt-0.5 leading-relaxed text-slate-900">{patient.address || '—'}</dd>
                          </div>
                        </dl>
                      )}
                    </div>
                  </div>
                )}

                <div data-testid="prior-encounter-card" className="p-3.5">
                  <div className="flex items-start gap-2">
                    <IconHistory size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-slate-900">Previous Consultation</h3>
                      <p className="text-xs leading-relaxed text-slate-500">
                        Most recent visit, read only. Nothing is copied unless you click.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3">
                    {!priorEncounter ? (
                      <div className="space-y-1 py-1 text-center">
                        <h4 className="text-xs font-semibold text-slate-700">No Prior Encounters Recorded</h4>
                        <p className="text-xs leading-relaxed text-slate-500">
                          This patient has no earlier consultation records in Kalyan Hospital. Complete this initial consultation to establish the clinical baseline.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5 text-sm">
                        <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 tabular-nums">
                          <span>{formatVisitDate(priorEncounter.encounter_date)}</span>
                          <span>{withDoctorTitle(priorEncounter.doctor_name)}</span>
                        </div>

                        <div className="divide-y divide-slate-200 border-t border-slate-200 pt-1">
                          <PriorFinding
                            title="Complaints"
                            copyLabel="complaints"
                            onCopy={isReadOnly ? undefined : handleCopySymptoms}
                          >
                            <p className="line-clamp-3 leading-relaxed text-slate-800">{priorEncounter.symptoms || '—'}</p>
                          </PriorFinding>

                          {priorEncounter.vitals && (
                            <PriorFinding
                              title="Vitals"
                              copyLabel="vitals"
                              onCopy={isReadOnly ? undefined : handleCopyVitals}
                            >
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700 tabular-nums">
                                <div>
                                  <dt className="inline text-slate-500">BP </dt>
                                  <dd className="inline font-mono">
                                    {priorEncounter.vitals.systolic_bp ?? '—'}/{priorEncounter.vitals.diastolic_bp ?? '—'}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="inline text-slate-500">Pulse </dt>
                                  <dd className="inline font-mono">{priorEncounter.vitals.pulse_bpm ?? '—'}</dd>
                                </div>
                                <div>
                                  <dt className="inline text-slate-500">SpO2 </dt>
                                  <dd className="inline font-mono">
                                    {priorEncounter.vitals.spo2_percent != null ? `${priorEncounter.vitals.spo2_percent}%` : '—'}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="inline text-slate-500">BMI </dt>
                                  <dd className="inline font-mono">{priorEncounter.vitals.bmi ?? '—'}</dd>
                                </div>
                              </dl>
                            </PriorFinding>
                          )}

                          <PriorFinding
                            title="Diagnosis"
                            copyLabel="diagnosis"
                            onCopy={isReadOnly ? undefined : handleCopyDiagnosis}
                          >
                            <p className="line-clamp-2 font-semibold text-slate-900">{priorEncounter.diagnosis || '—'}</p>
                          </PriorFinding>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {effectivePatientId > 0 && (
                  <div className="bg-slate-50/50 px-3.5 py-2.5">
                    <Link
                      to={`/reception/patients/${effectivePatientId}?tab=clinical`}
                      className="inline-flex items-center text-xs font-semibold text-[#8E1C3D] transition-colors hover:text-[#721631]"
                    >
                      Full patient history →
                    </Link>
                  </div>
                )}
              </div>
            </section>

            {/* Group 2: Encounter Status */}
            <section
              data-testid="sidebar-group-status"
              aria-labelledby="sidebar-status-heading"
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
            >
              <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
                <h2
                  id="sidebar-status-heading"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                >
                  Encounter Status
                </h2>
              </div>

              <div className="divide-y divide-slate-200">
                {isFinalised ? (
                  <div className="p-3.5 text-xs text-emerald-800">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <IconLock size={13} className="shrink-0" aria-hidden="true" />
                      <span>Consultation finalised</span>
                    </div>
                    {finalisedAt && (
                      <p className="mt-1 text-slate-500 tabular-nums">{formatIst(finalisedAt)}</p>
                    )}
                  </div>
                ) : isOtherDoctorEncounter ? (
                  <div className="p-3.5 text-xs text-amber-900">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <IconLock size={13} className="shrink-0" aria-hidden="true" />
                      <span>View-only draft</span>
                    </div>
                    <p className="mt-1 text-slate-600">
                      Owned by{' '}
                      {existingEncounter?.doctor_name ? withDoctorTitle(existingEncounter.doctor_name) : 'another doctor'}.
                    </p>
                  </div>
                ) : (
                  <div className="p-3.5">
                    <h3 className="text-xs font-semibold tracking-tight text-slate-900">Needed to finalise</h3>
                    {showValidationHints && (
                      <p
                        role="alert"
                        data-testid="finalise-validation-alert"
                        className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-800"
                      >
                        Complete the missing required items below before finalising.
                      </p>
                    )}
                    <ul className="mt-2 space-y-1">
                      {requiredItems.map((item) => {
                        const isHighlightedMissing = showValidationHints && !item.done
                        return (
                          <li key={item.key}>
                            <button
                              type="button"
                              onClick={() => scrollToAnchor(item.sectionId)}
                              className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs transition-colors duration-150 ${isHighlightedMissing
                                ? 'bg-red-50 ring-1 ring-inset ring-red-200 hover:bg-red-100/70'
                                : 'hover:bg-slate-50'
                                }`}
                            >
                              <span className="flex items-center gap-2 font-medium text-slate-800">
                                {item.done ? (
                                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden="true">
                                    <IconCheck size={11} stroke={3} className="shrink-0" />
                                  </span>
                                ) : (
                                  <span
                                    className={`h-4 w-4 shrink-0 rounded-full border-2 ${isHighlightedMissing ? 'border-red-400' : 'border-slate-300'}`}
                                    aria-hidden="true"
                                  />
                                )}
                                {item.label}
                              </span>
                              <span
                                className={`text-xs font-medium ${item.done
                                  ? 'text-emerald-700'
                                  : isHighlightedMissing
                                    ? 'font-semibold text-red-700'
                                    : 'text-amber-700'
                                  }`}
                              >
                                {item.done ? 'Added' : 'Missing'}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                <dl className="space-y-2 p-3.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="font-medium text-slate-600">Prescription</dt>
                    <dd>
                      <span
                        data-testid="sidebar-rx-status"
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${rxStatusMeta.className}`}
                      >
                        {rxStatusMeta.label}
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="font-medium text-slate-600">Follow-up</dt>
                    <dd>
                      <span
                        data-testid="sidebar-followup-status"
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${followUpStatusMeta.className}`}
                      >
                        {followUpStatusMeta.label}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            {/* Group 3: Billing (omitted for cross-doctor viewers to avoid 404 on /bill-items) */}
            {canLoadOwnAppointmentBilling && (
              <section
                data-testid="sidebar-group-billing"
                aria-labelledby="sidebar-billing-heading"
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
              >
                <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
                  <h2
                    id="sidebar-billing-heading"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                  >
                    Billing
                  </h2>
                </div>
                {effectiveAppointmentId != null ? (
                  <DoctorChargesPanel
                    appointmentId={effectiveAppointmentId}
                    patientId={effectivePatientId}
                    embedded
                  />
                ) : (
                  <p className="p-4 text-xs text-slate-500">
                    Charges apply to consultations linked to an appointment.
                  </p>
                )}
              </section>
            )}
          </aside>
        </div>

        {/* Finalise Confirmation Modal */}
        {showFinaliseConfirm && (
          <Modal
            open
            variant="destructive"
            title="Finalise Consultation?"
            onClose={() => setShowFinaliseConfirm(false)}
            busy={isFinalising}
            className="max-w-md"
          >
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-600">
                Once finalised, this clinical encounter will be permanently locked against modifications or deletions. Any subsequent changes can only be added as dated addenda.
              </p>
              {unauthorisedMedicines > 0 && (
                <p
                  data-testid="unauthorised-medicines-warning"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900"
                >
                  {unauthorisedMedicines === 1 ? '1 medicine is' : `${unauthorisedMedicines} medicines are`} in
                  Prescription but not authorised. Unauthorised medicines are not saved and will not
                  appear on a prescription slip. Cancel and choose Authorise Prescription if the
                  patient needs them.
                </p>
              )}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFinaliseConfirm(false)}
                  className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleFinaliseConsultation}
                  disabled={isFinalising}
                  className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-[#721631] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isFinalising ? 'Finalising...' : 'Yes, Lock & Finalise'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Patient Consultation Summary Print Modal (DWS-09, T-19-12) */}
        {showPrintSummary && (
          <ConsultationSummaryPrint
            encounter={
              existingEncounter
                ? {
                  ...existingEncounter,
                  symptoms,
                  clinical_notes: clinicalNotes,
                  diagnosis,
                  is_finalised: isFinalised,
                  finalised_at: finalisedAt,
                  version_id: versionId,
                  addenda,
                }
                : {
                  id: encounterId,
                  patient_id: effectivePatientId,
                  patient_urn: patientUrn ?? '',
                  patient_name: patientName ?? '',
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
                  addenda,
                }
            }
            patient={patient || null}
            departmentName={departmentName}
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
            advice={patientCareAdvice}
            onClose={() => setShowPrintSummary(false)}
          />
        )}
      </div>
    </AppShell>
  )
}

/** Sections of the consultation, in page order. The tabs in the sticky header jump to these. */
const CONSULTATION_SECTIONS = [
  { id: 'section-complaints', label: 'Complaints' },
  { id: 'section-vitals', label: 'Vitals' },
  { id: 'section-specialty', label: 'Assessment' },
  { id: 'section-diagnosis', label: 'Diagnosis' },
  { id: 'section-prescriptions', label: 'Prescription' },
  { id: 'section-followup', label: 'Follow-up' },
] as const

const SECTION_CARD =
  'scroll-mt-[var(--consult-scroll-margin)] rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5'
const HEADER_BUTTON =
  'inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed'
const STATUS_PILL = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium'
const FIELD_LABEL = 'mb-1.5 block text-xs font-medium text-slate-700'
const TEXT_FIELD =
  'min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'
const READ_ONLY_FIELD =
  'whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-800'

const VISIT_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

/** A visit date as hospital staff read it: "15 Nov 2026". */
function formatVisitDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : VISIT_DATE.format(date)
}

function SectionHeading({ title, required = false }: { title: string; required?: boolean }) {
  return (
    <div className="-mx-4 -mt-4 mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:-mx-5 sm:-mt-5 sm:px-5">
      <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
      {required && (
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Required</span>
      )}
    </div>
  )
}

/** One block of the previous visit, with an explicit copy action (nothing is copied automatically). */
function PriorFinding({
  title,
  copyLabel,
  onCopy,
  children,
}: {
  title: string
  copyLabel: string
  onCopy?: () => void
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5 py-2.5 first:pt-2 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{title}</span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
          >
            <IconCopy size={12} className="shrink-0" aria-hidden="true" />
            <span>Copy Section Findings</span>
            <span className="sr-only"> ({copyLabel})</span>
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

const SPECIALTY_FIELD_LABELS: Record<string, string> = {
  pain_site: 'Pain Site / Joint',
  starting_vas: 'Pain Intensity (VAS)',
  va_distance_uncorrected_od: 'Visual Acuity Distance (OD)',
  va_distance_uncorrected_os: 'Visual Acuity Distance (OS)',
  va_distance_od: 'Visual Acuity Distance (OD)',
  va_distance_os: 'Visual Acuity Distance (OS)',
}

function hasMeaningfulSpecialtyData(data: Record<string, unknown>): boolean {
  return Object.values(data).some(
    (v) => v !== null && v !== undefined && (typeof v === 'number' ? !Number.isNaN(v) : String(v).trim() !== ''),
  )
}

function resolveSpecialtyFieldLabel(
  schemaJson: Record<string, unknown> | undefined,
  fieldKey: string,
): string {
  const sections = Array.isArray(schemaJson?.sections) ? schemaJson.sections : []
  for (const sec of sections) {
    const fields = Array.isArray((sec as { fields?: unknown[] })?.fields)
      ? ((sec as { fields: unknown[] }).fields)
      : []
    for (const f of fields) {
      const candidate = f as { key?: unknown; label?: unknown }
      if (candidate?.key === fieldKey && typeof candidate.label === 'string' && candidate.label.trim()) {
        return candidate.label.trim()
      }
    }
  }
  return (
    SPECIALTY_FIELD_LABELS[fieldKey] ||
    fieldKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

export default ClinicalEncounterWorkspace
