import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useParams, useSearchParams, useNavigate, useLocation, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import { VitalsBiometricsSection } from '../components/VitalsBiometricsSection'
import { SpecialtyPhysiotherapyForm, type PhysiotherapyFormData } from '../components/SpecialtyPhysiotherapyForm'
import { SpecialtyOphthalmologyForm, type OphthalmologyFormData } from '../components/SpecialtyOphthalmologyForm'
import { PrescriptionFormSection } from '../components/PrescriptionFormSection'
import { FollowUpSection } from '../components/FollowUpSection'
import { AppointmentBookingModal } from '../components/AppointmentBookingModal'
import { ConsultationSummaryPrint } from '../components/ConsultationSummaryPrint'
import { QuickPhraseBar } from '../components/QuickPhraseBar'
import { asSpecialty, useBookedAppointment, useMyDepartments } from '../api/specialty'
import { ApiError, isVersionConflict } from '../api/client'
import { UnsavedChangesGuard, hasReportedAllergies } from '../components/UnsavedChangesGuard'
import {
  IconPill,
  IconCheck,
  IconAlertTriangle,
  IconPrinter,
  IconArrowLeft,
  IconLock,
  IconHistory,
  IconCopy,
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
  const bookedAppointment = useBookedAppointment(existingEncounter?.appointment_id ?? paramApptId)
  const departmentId: number | null =
    existingEncounter?.department_id ??
    bookedAppointment?.department_id ??
    (myDepartments.length === 1 ? myDepartments[0].id : null)
  const { data: deptTemplate } = useDepartmentTemplate(departmentId)
  const templateResponseQuery = useEncounterTemplateResponse(encounterId)

  // 4. Follow-up recommendation
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
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [showFinaliseConfirm, setShowFinaliseConfirm] = useState(false)
  const [finaliseError, setFinaliseError] = useState<string | null>(null)
  const [isFinalising, setIsFinalising] = useState(false)
  const [addendumText, setAddendumText] = useState('')
  const [activeAnchor, setActiveAnchor] = useState('section-complaints')
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [showPrintSummary, setShowPrintSummary] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

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
  const editSeqRef = useRef(0)
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const runSaveRef = useRef<() => Promise<boolean>>(async () => true)
  const followUpRecordedRef = useRef(false)
  const bypassGuardRef = useRef(false)
  const mountedRef = useRef(true)
  const openStartedRef = useRef(false)
  // Each part of the form is loaded from the server once. Later cache updates (our own saves)
  // must not overwrite what the doctor typed while a save was in flight.
  const hydratedRef = useRef({ encounter: false, vitals: false, template: false, followUp: false })

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
    if (isFinalisedRef.current) return true
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
        hydratedRef.current = { encounter: true, vitals: true, template: true, followUp: true }
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
      if (activeVersionId && Object.keys(specialtyData).length > 0) {
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
        setGeneralError(`Auto-save failed: ${err.message}`)
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
    if (isFinalisedRef.current) return
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
    if (!isDirtyRef.current || isFinalisedRef.current) return
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
  }

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
      // The prescription belongs to this consultation, so a new consultation is saved first.
      if (encounterIdRef.current === 0) {
        const saved = await saveNow()
        if (!saved || encounterIdRef.current === 0) {
          setGeneralError(
            'The consultation could not be saved, so the prescription was not authorised. Check the connection and try again.',
          )
          return
        }
      }
      const res = await createRxMutation.mutateAsync({
        patient_id: effectivePatientId,
        encounter_id: encounterIdRef.current,
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
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
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
    if (!effectivePatientId) {
      setFinaliseError('Open a patient from the consultation queue first.')
      setShowFinaliseConfirm(false)
      return
    }

    setIsFinalising(true)
    try {
      // Everything typed so far reaches the server before the record locks: a finalised
      // encounter accepts no more vitals or assessment changes.
      const saved = await saveNow()
      if (!saved || encounterIdRef.current === 0) {
        setFinaliseError(
          'Your latest changes could not be saved, so the consultation was not finalised. Check the connection and try again.',
        )
        setShowFinaliseConfirm(false)
        return
      }
      const targetId = encounterIdRef.current

      if (followUpDate && !followUpRecordedRef.current) {
        await createFollowUpMutation.mutateAsync({
          encounterId: targetId,
          body: {
            recommended_date: followUpDate,
            recommended_doctor_id: followUpDoctorId,
            clinical_reason: followUpReason || undefined,
          },
        })
        followUpRecordedRef.current = true
      }

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
      setFinalisedAt(res.finalised_at)
      versionRef.current = res.version_id
      setVersionId(res.version_id)
      setShowFinaliseConfirm(false)
      setActionSuccess('Consultation finalised and locked. Notes are now permanently immutable.')
    } catch (err: any) {
      setFinaliseError(err?.message || 'Failed to finalise consultation.')
      setShowFinaliseConfirm(false)
    } finally {
      setIsFinalising(false)
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
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        setConflictError('Encounter was modified in another session.')
      } else {
        setGeneralError(err instanceof Error ? err.message : 'Failed to append addendum.')
      }
    }
  }

  const specialty = asSpecialty(deptTemplate?.code)
  const isPhysiotherapy = specialty === 'PHYSIOTHERAPY'
  const isOphthalmology = specialty === 'OPHTHALMOLOGY'

  const headerRef = useRef<HTMLElement | null>(null)
  const spyPausedUntilRef = useRef(0)
  const [stickyLayout, setStickyLayout] = useState<{
    headerHeight: number
    asideMax: number
  } | null>(null)
  const workspaceVisible =
    !needsOpen && !(encounterId > 0 && (isEncounterPending || isEncounterError))

  const scrollToAnchor = (anchorId: string) => {
    setActiveAnchor(anchorId)
    // Hold the scroll spy while the smooth scroll passes the sections in between.
    spyPausedUntilRef.current = Date.now() + 900
    document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      let current: string = CONSULTATION_SECTIONS[0].id
      for (const section of CONSULTATION_SECTIONS) {
        const el = document.getElementById(section.id)
        if (el && el.getBoundingClientRect().top <= line) current = section.id
      }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        current = CONSULTATION_SECTIONS[CONSULTATION_SECTIONS.length - 1].id
      }
      setActiveAnchor(current)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer?.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [workspaceVisible])

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
    : encounterId > 0
      ? 'Consultation draft'
      : 'New consultation'

  // Same minimums the Finalise handler enforces.
  const requiredItems = [
    { id: 'section-complaints', label: 'Chief complaint', done: symptoms.trim().length >= 2 },
    { id: 'section-diagnosis', label: 'Diagnosis', done: diagnosis.trim().length >= 2 },
  ]

  const rxAuthorised = activeRxRecord?.status === 'AUTHORISED'
  // Medicines only reach the server when the prescription is authorised.
  const unauthorisedMedicines = rxAuthorised ? 0 : prescriptionItems.length
  // A follow-up is sent on Finalise; until then, leaving the page would lose it.
  const followUpPending = !followUpRecorded && Boolean(followUpDate || followUpReason.trim())
  const authoriseDisabled = isFinalised || rxAuthorised || prescriptionItems.length === 0
  const authoriseHint = isFinalised
    ? 'This consultation is locked.'
    : rxAuthorised
      ? 'The prescription is already authorised.'
      : prescriptionItems.length === 0
        ? 'Add a medicine under Prescription first.'
        : undefined

  let statusPill: ReactNode
  if (isFinalised) {
    statusPill = (
      <span className={`${STATUS_PILL} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <IconLock size={14} aria-hidden="true" />
        Finalised & Locked
      </span>
    )
  } else if (autoSaveStatus === 'OFFLINE_ERROR') {
    statusPill = (
      <span role="alert" data-testid="auto-save-pill" className={`${STATUS_PILL} border-red-200 bg-red-50 text-red-800`}>
        <IconAlertTriangle size={14} aria-hidden="true" />
        Network error — unsaved changes present. Retrying connection...
      </span>
    )
  } else if (autoSaveStatus === 'SAVING') {
    statusPill = (
      <span data-testid="auto-save-pill" className={`${STATUS_PILL} border-amber-200 bg-amber-50 text-amber-800`}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
        Saving consultation draft...
      </span>
    )
  } else if (encounterId === 0) {
    statusPill = (
      <span className={`${STATUS_PILL} border-slate-200 bg-slate-50 text-slate-600`}>
        <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
        Not saved yet
      </span>
    )
  } else if (unsavedEdits) {
    statusPill = (
      <span className={`${STATUS_PILL} border-amber-200 bg-amber-50 text-amber-800`}>
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
        Unsaved changes
      </span>
    )
  } else if (autoSaveStatus === 'SAVED' && lastSavedTime) {
    statusPill = (
      <span data-testid="auto-save-pill" className={`${STATUS_PILL} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
        Saved to server at {lastSavedTime}
      </span>
    )
  } else {
    statusPill = (
      <span className={`${STATUS_PILL} border-slate-200 bg-slate-50 text-slate-600`}>
        <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
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

  const hasBanners = Boolean(conflictError || generalError || actionSuccess || finaliseError)

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      <UnsavedChangesGuard dirty={(unsavedEdits || followUpPending) && !isFinalised} bypassRef={bypassGuardRef} />
      <div className="pb-10 text-slate-900" style={stickyVars}>
        {/* Sticky clinical header: patient identity, save state, actions and section tabs. */}
        <header
          ref={headerRef}
          data-testid="sticky-clinical-header"
          className="sticky -top-4 z-30 -mx-4 -mt-4 border-b border-slate-200 bg-white shadow-xs sm:-mx-6 xl:-mx-8"
        >
          <div className="px-4 pt-3 sm:px-6 xl:px-8">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-[1_1_320px] items-start gap-3">
                <Link
                  to="/doctor"
                  className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                  title="Back to consultation queue"
                  aria-label="Back to consultation queue"
                >
                  <IconArrowLeft size={16} />
                </Link>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span>{stageLabel}</span>
                    {queueToken !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span data-testid="queue-token" className="font-mono text-slate-700">
                          Token #{String(queueToken).padStart(3, '0')}
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="truncate text-2xl font-semibold leading-tight text-slate-900">
                    {patientName ?? 'No patient selected'}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-slate-600">
                    {patientUrn ? (
                      <span className="font-mono text-xs text-slate-700">{patientUrn}</span>
                    ) : (
                      <span data-testid="no-patient-hint" className="text-xs font-semibold text-amber-700">
                        Open a patient from the consultation queue to start.
                      </span>
                    )}
                    {patient && (
                      <>
                        <span aria-hidden="true" className="text-slate-500">·</span>
                        <span>
                          {patient.age_years} y · {patientSex}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true" className="text-slate-500">·</span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {departmentName}
                    </span>
                    {patientAllergies && (
                      <span
                        data-testid="allergy-alert-badge"
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#8E1C3D] px-2 py-0.5 text-xs font-semibold text-white"
                      >
                        <IconAlertTriangle size={14} aria-hidden="true" />
                        <span>Allergy: {patientAllergies}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAuthorisePrescription}
                  disabled={authoriseDisabled}
                  title={authoriseHint}
                  className={`${HEADER_BUTTON} border border-[#8E1C3D]/50 bg-white text-[#8E1C3D] hover:bg-[#8E1C3D]/5 disabled:border-slate-200 disabled:text-slate-500 disabled:hover:bg-white`}
                >
                  <IconPill size={16} aria-hidden="true" />
                  <span>Authorise Prescription</span>
                </button>
                <button
                  type="button"
                  disabled={!isFinalised}
                  onClick={() => setShowPrintSummary(true)}
                  title={isFinalised ? undefined : 'Available after the consultation is finalised.'}
                  className={`${HEADER_BUTTON} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-500 disabled:hover:bg-white`}
                >
                  <IconPrinter size={16} aria-hidden="true" />
                  <span>Print Consultation Summary</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFinaliseConfirm(true)}
                  disabled={isFinalised}
                  className={`${HEADER_BUTTON} bg-[#8E1C3D] text-white shadow-xs hover:bg-[#721631] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none`}
                >
                  <IconCheck size={16} aria-hidden="true" />
                  <span>Finalise Consultation</span>
                </button>
              </div>
            </div>

            <div className="mt-2 flex items-end justify-between gap-4">
              <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <nav
                  data-testid="jump-navigation-rail"
                  aria-label="Consultation sections"
                  className="flex min-w-max items-center gap-1"
                >
                  {CONSULTATION_SECTIONS.map((section, index) => {
                    const isActive = activeAnchor === section.id
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => scrollToAnchor(section.id)}
                        aria-current={isActive ? 'location' : undefined}
                        className={`inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1.5 text-sm transition-colors ${
                          isActive
                            ? 'border-[#8E1C3D] font-semibold text-[#8E1C3D]'
                            : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                            isActive ? 'bg-[#8E1C3D] text-white' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {index + 1}
                        </span>
                        {section.label}
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
            {conflictError && (
              <ConflictBanner
                message={conflictError}
                actionLabel="Reload Latest Encounter"
                onReload={() => {
                  void handleReloadLatest()
                }}
              />
            )}
            {generalError && (
              <InlineAlert tone="error" onDismiss={() => setGeneralError(null)}>
                {generalError}
              </InlineAlert>
            )}
            {actionSuccess && (
              <InlineAlert tone="success" onDismiss={() => setActionSuccess(null)}>
                {actionSuccess}
              </InlineAlert>
            )}
            {finaliseError && (
              <InlineAlert tone="error" onDismiss={() => setFinaliseError(null)}>
                {finaliseError}
              </InlineAlert>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 pt-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* Consultation sections, in the same order as the tabs above. */}
          <div className="min-w-0 space-y-5">
            {/* 1. Chief complaints */}
            <section id="section-complaints" data-testid="section-complaints" className={SECTION_CARD}>
              <SectionHeading title="Chief Complaints & History" required={!isFinalised} />
              {!isFinalised && (
                <QuickPhraseBar departmentCode={deptTemplate?.code} onSelectPhrase={handleAppendQuickPhrase} />
              )}
              <div>
                <label htmlFor="symptoms-input" className={FIELD_LABEL}>
                  Chief Complaints & Symptoms
                  {!isFinalised && (
                    <span className="text-red-700" aria-hidden="true">
                      {' '}*
                    </span>
                  )}
                </label>
                {isFinalised ? (
                  <div className={READ_ONLY_FIELD}>{symptoms}</div>
                ) : (
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
                    className={TEXT_FIELD}
                  />
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
                readOnly={isFinalised}
                serverBmi={serverVitals?.bmi ? Number(serverVitals.bmi) : null}
              />
              {!isFinalised && (
                <p className="mt-3 text-xs text-slate-500">Optional. Record only the observations that are relevant.</p>
              )}
            </section>

            {/* 3. Specialty assessment */}
            <section id="section-specialty" data-testid="section-specialty" className={SECTION_CARD}>
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
              ) : isOphthalmology ? (
                <SpecialtyOphthalmologyForm
                  data={specialtyData as OphthalmologyFormData}
                  onChange={(newData) => {
                    setSpecialtyData(newData)
                    scheduleAutoSave()
                  }}
                  onBlur={handleSectionBlur}
                  readOnly={isFinalised}
                />
              ) : (
                <>
                  <SectionHeading title="Specialty Assessment" />
                  <p
                    data-testid="specialty-unknown"
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
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
              <SectionHeading title="Diagnosis & Clinical Impressions" required={!isFinalised} />
              <div className="space-y-4">
                <div>
                  <label htmlFor="clinical-notes-input" className={FIELD_LABEL}>
                    Examination findings
                  </label>
                  {isFinalised ? (
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
                      className={TEXT_FIELD}
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="diagnosis-input" className={FIELD_LABEL}>
                    Diagnosis
                    {!isFinalised && (
                      <span className="text-red-700" aria-hidden="true">
                        {' '}*
                      </span>
                    )}
                  </label>
                  {isFinalised ? (
                    <div className={`${READ_ONLY_FIELD} font-semibold`}>{diagnosis}</div>
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
                      placeholder="e.g. Mechanical low back pain"
                      className={TEXT_FIELD}
                    />
                  )}
                </div>
              </div>
            </section>

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
                onBookNow={() => setShowBookingModal(true)}
                onBlur={handleSectionBlur}
                readOnly={isFinalised || followUpRecorded}
              />
              {!isFinalised && (
                <p data-testid="follow-up-save-note" className="mt-3 text-xs text-slate-500">
                  {followUpRecorded
                    ? 'This follow-up has already been sent to reception and cannot be changed here.'
                    : 'The follow-up is sent to reception when you finalise this consultation.'}
                </p>
              )}
            </section>

            {/* Addenda after finalisation */}
            {isFinalised && (
              <section data-testid="section-addenda" className={SECTION_CARD}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <h2 className="text-base font-semibold text-slate-900">
                    Dated Clinical Addenda ({addenda.length})
                  </h2>
                  <span className="text-xs text-slate-500">Each addendum is kept permanently</span>
                </div>

                {addenda.length === 0 ? (
                  <p className="text-sm text-slate-500">No addenda recorded for this encounter.</p>
                ) : (
                  <ol className="space-y-3">
                    {addenda.map((ad: AddendumRead, idx: number) => (
                      <li key={ad.id} className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2 text-xs font-semibold text-amber-900">
                          <span>
                            Addendum #{idx + 1} · {withDoctorTitle(ad.doctor_name)}
                          </span>
                          <span>{formatIst(ad.created_at)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-slate-800">{ad.addendum_text}</p>
                      </li>
                    ))}
                  </ol>
                )}

                <form onSubmit={handleAddAddendum} className="space-y-2 pt-4">
                  <label htmlFor="addendum-field" className={FIELD_LABEL}>
                    Append Addendum Note
                  </label>
                  <textarea
                    id="addendum-field"
                    rows={3}
                    value={addendumText}
                    onChange={(e) => setAddendumText(e.target.value)}
                    placeholder="Record follow-up remarks, phone consultation, or post-finalisation consultation addendum note..."
                    className={TEXT_FIELD}
                  />
                  <button
                    type="submit"
                    disabled={addendumMutation.isPending || !addendumText.trim()}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    {addendumMutation.isPending ? 'Appending...' : '+ Append Addendum'}
                  </button>
                </form>
              </section>
            )}
          </div>

          {/* Side panel: allergy, what finalising needs, previous visit, contact details. */}
          <aside
            data-testid="persistent-side-panel"
            aria-label="Patient summary and previous consultation"
            className="min-w-0 space-y-4 xl:sticky xl:top-[var(--consult-aside-top)] xl:max-h-[var(--consult-aside-max)] xl:overflow-y-auto"
          >
            {patient &&
              (patientAllergies ? (
                <div className="rounded-xl bg-[#8E1C3D] p-4 text-white shadow-xs">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                    <IconAlertTriangle size={15} aria-hidden="true" />
                    <span>Allergy alert</span>
                  </div>
                  <p className="mt-1 text-sm">{patientAllergies}</p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  <span className="font-semibold text-slate-800">Allergies:</span> None reported
                </div>
              ))}

            {!isFinalised && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <h2 className="text-sm font-semibold text-slate-900">Needed to finalise</h2>
                <ul className="mt-2 space-y-1">
                  {requiredItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => scrollToAnchor(item.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-2 text-slate-800">
                          {item.done ? (
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden="true">
                              <IconCheck size={11} stroke={3} />
                            </span>
                          ) : (
                            <span className="h-4 w-4 rounded-full border-2 border-slate-300" aria-hidden="true" />
                          )}
                          {item.label}
                        </span>
                        <span className={`text-xs font-semibold ${item.done ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {item.done ? 'Added' : 'Missing'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div data-testid="prior-encounter-card" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-start gap-2 border-b border-slate-200 pb-2">
                <IconHistory size={16} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Previous Consultation</h2>
                  <p className="text-xs text-slate-500">Most recent visit, read only. Nothing is copied unless you click.</p>
                </div>
              </div>

              {!priorEncounter ? (
                <div className="space-y-1 pt-3 text-center">
                  <h3 className="text-sm font-semibold text-slate-700">No Prior Encounters Recorded</h3>
                  <p className="text-xs leading-relaxed text-slate-500">
                    This patient has no earlier consultation records in Kalyan Hospital. Complete this initial consultation to establish the clinical baseline.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 pt-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                    <span>{formatVisitDate(priorEncounter.encounter_date)}</span>
                    <span>{withDoctorTitle(priorEncounter.doctor_name)}</span>
                  </div>

                  <PriorFinding
                    title="Complaints"
                    copyLabel="complaints"
                    onCopy={isFinalised ? undefined : handleCopySymptoms}
                  >
                    <p className="line-clamp-3 text-slate-800">{priorEncounter.symptoms || '—'}</p>
                  </PriorFinding>

                  {priorEncounter.vitals && (
                    <PriorFinding
                      title="Vitals"
                      copyLabel="vitals"
                      onCopy={isFinalised ? undefined : handleCopyVitals}
                    >
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-700">
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
                    onCopy={isFinalised ? undefined : handleCopyDiagnosis}
                  >
                    <p className="line-clamp-2 font-semibold text-slate-900">{priorEncounter.diagnosis || '—'}</p>
                  </PriorFinding>
                </div>
              )}
            </div>

            {patient && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <h2 className="text-sm font-semibold text-slate-900">Patient details</h2>
                <dl className="mt-2 divide-y divide-slate-100 text-sm">
                  <div className="flex justify-between gap-4 py-1.5">
                    <dt className="text-slate-500">Mobile</dt>
                    <dd className="font-mono text-slate-900">{patient.mobile || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-1.5">
                    <dt className="text-slate-500">Emergency contact</dt>
                    <dd className="text-right text-slate-900">{patient.emergency_contact || '—'}</dd>
                  </div>
                  <div className="py-1.5">
                    <dt className="text-slate-500">Address</dt>
                    <dd className="mt-0.5 text-slate-900">{patient.address || '—'}</dd>
                  </div>
                </dl>
              </div>
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
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  {unauthorisedMedicines === 1 ? '1 medicine is' : `${unauthorisedMedicines} medicines are`} in
                  Prescription but not authorised. Unauthorised medicines are not saved and will not
                  appear on a prescription slip. Cancel and choose Authorise Prescription if the
                  patient needs them.
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFinaliseConfirm(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleFinaliseConsultation}
                  disabled={isFinalising}
                  className="rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#721631] disabled:opacity-50"
                >
                  {isFinalising ? 'Finalising...' : 'Yes, Lock & Finalise'}
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
  'scroll-mt-[var(--consult-scroll-margin)] rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6'
const HEADER_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed'
const STATUS_PILL = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold'
const FIELD_LABEL = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600'
const TEXT_FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'
const READ_ONLY_FIELD =
  'whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800'

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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {required && (
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Required</span>
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
    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200/70 hover:text-slate-900"
          >
            <IconCopy size={12} aria-hidden="true" />
            <span>Copy Section Findings</span>
            <span className="sr-only"> ({copyLabel})</span>
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export default ClinicalEncounterWorkspace
