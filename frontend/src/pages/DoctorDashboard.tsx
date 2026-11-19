import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Modal } from '../components/Modal'
import { InlineAlert } from '../components/InlineAlert'
import { toast } from '../components/ToastHost'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import { DoctorDashboardUnfinishedCard } from '../components/DoctorDashboardUnfinishedCard'
import { IconBell, IconSearch } from '../components/icons'
import {
  useDoctorQueue,
  useDoctors,
  useMe,
  usePatientEncounters,
  usePatientPrescriptions,
  useUpdateAppointmentStatus,
} from '../api/queries'
import type { DoctorQueueItem } from '../api/types'
import { formatIst, formatToken, istToday, withDoctorTitle } from '../format'

type DoctorStatus = 'AVAILABLE' | 'IN_CONSULTATION' | 'ON_BREAK' | 'IN_OT'
type ViewMode = '3ZONE' | 'KANBAN'

const QUICK_SYMPTOMS = [
  'Fever, chills (3 days)',
  'Joint pain & stiffness',
  'Cough & throat irritation',
  'Headache & fatigue',
  'Normal systemic examination',
  'Follow-up visit: condition improving',
]

const QUICK_MEDS = [
  { name: 'Tab Paracetamol 650mg', dosage: '1-0-1', duration: '3 days' },
  { name: 'Cap Amoxicillin 500mg', dosage: '1-0-1', duration: '5 days' },
  { name: 'Tab Pantoprazole 40mg', dosage: '1-0-0', duration: '5 days' },
  { name: 'Tab Cetirizine 10mg', dosage: '0-0-1', duration: '3 days' },
  { name: 'Syp Multivitamin 10ml', dosage: '0-1-0', duration: '15 days' },
]

const DIAGNOSTIC_TESTS = [
  'CBC (Complete Blood Count)',
  'Chest X-Ray PA View',
  'Blood Sugar (F / PP)',
  'LFT & Kidney Profile',
  'Urine Routine & Micro',
]

/** Play gentle waiting room chime tone using browser Web Audio API */
/** Words reception types when the patient has no allergies; shown as recorded, never as a warning. */
const NO_ALLERGY_ENTRIES = new Set(['none', 'none reported', 'nil', 'no', 'nkda', 'no known allergies', 'no known drug allergies'])

/**
 * Reads the allergy text exactly as recorded on the patient. Nothing is ever filled in:
 * a blank record is "not recorded", which the doctor must ask about, not "no allergies".
 */
export function allergyStatus(raw: string | null | undefined): { kind: 'not_recorded' | 'none' | 'recorded'; text: string } {
  const text = (raw ?? '').trim()
  if (!text) return { kind: 'not_recorded', text: 'Not recorded' }
  if (NO_ALLERGY_ENTRIES.has(text.toLowerCase().replace(/\.$/, ''))) return { kind: 'none', text }
  return { kind: 'recorded', text }
}

/** Allergy line for the clinical sheet. Vitals and chronic conditions are not shown here: the queue does not carry them. */
function AllergyBanner({ allergies }: { allergies: string | null | undefined }) {
  const status = allergyStatus(allergies)
  if (status.kind === 'recorded') {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 shadow-2xs">
        <div className="font-bold text-red-800">Drug allergy recorded</div>
        <div className="mt-1 text-sm font-bold text-red-900">{status.text}</div>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
      <span className="font-semibold">Allergies:</span>{' '}
      {status.kind === 'none' ? status.text : 'Not recorded. Ask the patient before prescribing.'}
    </div>
  )
}

function playWaitingRoomChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    const now = ctx.currentTime

    // First tone (523Hz - C5)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.frequency.setValueAtTime(523.25, now)
    gain1.gain.setValueAtTime(0.12, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.45)

    // Second tone (659Hz - E5)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.frequency.setValueAtTime(659.25, now + 0.22)
    gain2.gain.setValueAtTime(0.12, now + 0.22)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.22)
    osc2.stop(now + 0.75)
  } catch {
    // Non-blocking fallback
  }
}

function isInConsultation(item: DoctorQueueItem | null | undefined): boolean {
  if (!item) return false
  return item.consultation_status != null
    ? item.consultation_status === 'IN_CONSULTATION'
    : item.status === 'IN_CONSULTATION'
}

export function DoctorDashboard({
  defaultViewMode = '3ZONE',
}: {
  defaultViewMode?: ViewMode
} = {}) {
  const [searchParams] = useSearchParams()
  const initialMode =
    (searchParams.get('view')?.toUpperCase() as ViewMode) || defaultViewMode
  const { data: me } = useMe()
  const { data: doctors } = useDoctors(false)
  const navigate = useNavigate()
  const { data: queue, isPending, isError, error, refetch, dataUpdatedAt } = useDoctorQueue()
  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt) : null
  const updateStatusMutation = useUpdateAppointmentStatus()

  // Find logged in doctor record
  const myDoctor = Array.isArray(doctors) ? doctors.find((d) => d.id === me?.doctor_id) : undefined
  const doctorName = queue?.doctor_name || me?.full_name
  // Only a cabin that is actually set on the doctor is shown; there is no default room.
  const cabinCode = myDoctor?.cabin_code?.trim() || null

  // Namespaced per doctor (and IST day for Lab Hold) so shared PCs never leak state across doctors/days
  const statusStorageKey = me?.doctor_id != null ? `kh.doctor.status.${me.doctor_id}` : null
  const labHoldStorageKey =
    me?.doctor_id != null ? `kh.doctor.labHold.${me.doctor_id}.${istToday()}` : null

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode)
  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus>(() => {
    if (!statusStorageKey) return 'AVAILABLE'
    try {
      return (localStorage.getItem(statusStorageKey) as DoctorStatus) || 'AVAILABLE'
    } catch {
      return 'AVAILABLE'
    }
  })

  // Selected patient for Center Workspace (Zone 2)
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)

  // Track patient appointments placed on Lab Hold
  const [labHoldIds, setLabHoldIds] = useState<number[]>(() => {
    if (!labHoldStorageKey) return []
    try {
      const stored = localStorage.getItem(labHoldStorageKey)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (!statusStorageKey) return
    try {
      setDoctorStatus((localStorage.getItem(statusStorageKey) as DoctorStatus) || 'AVAILABLE')
    } catch {
      setDoctorStatus('AVAILABLE')
    }
  }, [statusStorageKey])

  useEffect(() => {
    if (!labHoldStorageKey) return
    try {
      const stored = localStorage.getItem(labHoldStorageKey)
      setLabHoldIds(stored ? JSON.parse(stored) : [])
    } catch {
      setLabHoldIds([])
    }
  }, [labHoldStorageKey])

  const autoCallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (autoCallTimerRef.current !== null) {
        clearTimeout(autoCallTimerRef.current)
        autoCallTimerRef.current = null
      }
    }
  }, [])

  // Patient-scoped rough scratchpad state (keyed by patient_id so switching patients never leaks data)
  type SoapNotesState = { subjective: string; objective: string; assessment: string }
  type PatientScratchpad = {
    soapNotes: SoapNotesState
    prescribedMeds: typeof QUICK_MEDS
    orderedLabs: string[]
    followUpDays: string | null
  }
  const emptyScratchpad = (): PatientScratchpad => ({
    soapNotes: { subjective: '', objective: '', assessment: '' },
    prescribedMeds: [],
    orderedLabs: [],
    followUpDays: '7',
  })
  const [scratchpadByPatient, setScratchpadByPatient] = useState<Record<number, PatientScratchpad>>({})
  const [unsavedFinishItem, setUnsavedFinishItem] = useState<DoctorQueueItem | null>(null)

  // Kanban mode states & interactive controls
  const [kanbanSearch, setKanbanSearch] = useState('')
  const [kanbanFilter, setKanbanFilter] = useState<'ALL' | 'URGENT' | 'WALKIN' | 'SCHEDULED' | 'LAB_HOLD' | 'DONE'>('ALL')
  const [kanbanLayout, setKanbanLayout] = useState<'SPLIT' | 'FULL'>('SPLIT')
  const [isDrawerOpen, setIsDrawerOpen] = useState(true)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  const handleDragStart = (e: DragEvent, item: DoctorQueueItem) => {
    e.dataTransfer.setData('application/json', JSON.stringify(item))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDropToColumn = async (
    e: DragEvent,
    targetContext: 'waiting' | 'in_consultation' | 'lab_hold' | 'booked' | 'completed'
  ) => {
    e.preventDefault()
    setDragOverCol(null)
    try {
      const raw = e.dataTransfer.getData('application/json')
      if (!raw) return
      const item: DoctorQueueItem = JSON.parse(raw)
      if (targetContext === 'in_consultation') {
        await handleCallNext(item)
      } else if (targetContext === 'lab_hold') {
        if (isInConsultation(item) || item.status === 'BOOKED' || item.status === 'DONE') {
          return
        }
        if (!labHoldIds.includes(item.id)) {
          handleToggleLabHold(item)
        }
      } else if (targetContext === 'completed') {
        await handleFinishConsultation(item)
      } else if (targetContext === 'waiting') {
        if (labHoldIds.includes(item.id)) {
          handleToggleLabHold(item)
        }
      }
    } catch {
      // ignore drop parse error
    }
  }

  const filterKanbanItems = (items: DoctorQueueItem[]) => {
    return items.filter((item) => {
      if (kanbanSearch.trim()) {
        const q = kanbanSearch.toLowerCase().trim()
        const matches =
          item.patient_name.toLowerCase().includes(q) ||
          item.patient_urn.toLowerCase().includes(q) ||
          String(item.token_number ?? '').includes(q) ||
          (item.patient_mobile && item.patient_mobile.includes(q))
        if (!matches) return false
      }
      if (kanbanFilter === 'URGENT') {
        return item.notes?.toLowerCase().includes('emergency') || item.notes?.toLowerCase().includes('urgent')
      }
      if (kanbanFilter === 'WALKIN') {
        return (item.status === 'ARRIVED' || item.status === 'CHECKED_IN') && !item.notes?.toLowerCase().includes('follow')
      }
      if (kanbanFilter === 'SCHEDULED') {
        return item.status === 'BOOKED'
      }
      if (kanbanFilter === 'LAB_HOLD') {
        return labHoldIds.includes(item.id)
      }
      if (kanbanFilter === 'DONE') {
        return item.status === 'DONE'
      }
      return true
    })
  }

  // Sync doctor status to storage
  const handleStatusChange = (newStatus: DoctorStatus) => {
    setDoctorStatus(newStatus)
    if (statusStorageKey) {
      try {
        localStorage.setItem(statusStorageKey, newStatus)
      } catch {
        // ignore
      }
    }
    toast.info(`Status changed to ${newStatus.replace('_', ' ')}`)
  }

  // Active in consultation item (authoritative from queue)
  const activeConsultationItem = queue?.in_consultation?.[0] || null

  // Categorize queue items including Lab Hold
  const waitingPatients = useMemo(() => {
    if (!queue?.waiting) return []
    return queue.waiting.filter((item) => !labHoldIds.includes(item.id))
  }, [queue?.waiting, labHoldIds])

  const labHoldPatients = useMemo(() => {
    if (!queue?.waiting) return []
    return queue.waiting.filter((item) => labHoldIds.includes(item.id))
  }, [queue?.waiting, labHoldIds])

  // All combined items for quick lookup
  const allItems = useMemo(() => {
    if (!queue) return []
    return [
      ...(queue.in_consultation || []),
      ...(queue.waiting || []),
      ...(queue.booked || []),
      ...(queue.completed || []),
    ]
  }, [queue])

  // Determine active patient for the chart view
  const currentChartPatient: DoctorQueueItem | null = useMemo(() => {
    if (selectedPatientId) {
      const found = allItems.find((p) => p.id === selectedPatientId)
      if (found) return found
    }
    if (activeConsultationItem) return activeConsultationItem
    return null
  }, [selectedPatientId, allItems, activeConsultationItem])

  // Scoped scratchpad view & mutators for the currently selected patient only
  const activeScratchpadPatientId = currentChartPatient?.patient_id ?? null
  const activeScratchpad =
    activeScratchpadPatientId != null
      ? (scratchpadByPatient[activeScratchpadPatientId] ?? emptyScratchpad())
      : emptyScratchpad()
  const { soapNotes, prescribedMeds, orderedLabs, followUpDays } = activeScratchpad

  const updateActiveScratchpad = (updater: (prev: PatientScratchpad) => PatientScratchpad) => {
    if (activeScratchpadPatientId == null) return
    setScratchpadByPatient((map) => ({
      ...map,
      [activeScratchpadPatientId]: updater(map[activeScratchpadPatientId] ?? emptyScratchpad()),
    }))
  }
  const setSoapNotes = (next: SoapNotesState | ((prev: SoapNotesState) => SoapNotesState)) => {
    updateActiveScratchpad((prev) => ({
      ...prev,
      soapNotes: typeof next === 'function' ? next(prev.soapNotes) : next,
    }))
  }
  const setPrescribedMeds = (next: typeof QUICK_MEDS) => {
    updateActiveScratchpad((prev) => ({ ...prev, prescribedMeds: next }))
  }
  const setOrderedLabs = (next: string[]) => {
    updateActiveScratchpad((prev) => ({ ...prev, orderedLabs: next }))
  }
  const setFollowUpDays = (next: string | null) => {
    updateActiveScratchpad((prev) => ({ ...prev, followUpDays: next }))
  }
  const clearPatientScratchpad = (patientId: number) => {
    setScratchpadByPatient((map) => {
      if (!(patientId in map)) return map
      const next = { ...map }
      delete next[patientId]
      return next
    })
  }

  // Pre-load past visits and past prescriptions for the active chart patient
  const { data: pastEncounters } = usePatientEncounters(currentChartPatient?.patient_id || 0)
  const { data: pastPrescriptions } = usePatientPrescriptions(currentChartPatient?.patient_id || 0)

  // Auto-select when a patient is in consultation
  useEffect(() => {
    if (activeConsultationItem && !selectedPatientId) {
      setSelectedPatientId(activeConsultationItem.id)
    }
  }, [activeConsultationItem, selectedPatientId])

  // Call Next Waiting Patient
  const handleCallNext = async (item?: DoctorQueueItem) => {
    if (autoCallTimerRef.current !== null) {
      clearTimeout(autoCallTimerRef.current)
      autoCallTimerRef.current = null
    }
    const target = item || waitingPatients[0]
    if (!target) {
      toast.info('No waiting patients in queue.')
      return
    }

    if (target.status === 'BOOKED') {
      toast.info('Patient has not been checked in by reception yet.')
      return
    }

    // Play chime announcement
    playWaitingRoomChime()

    // If item was on lab hold, remove from hold
    if (labHoldIds.includes(target.id)) {
      const updated = labHoldIds.filter((id) => id !== target.id)
      setLabHoldIds(updated)
      if (labHoldStorageKey) {
        try {
          localStorage.setItem(labHoldStorageKey, JSON.stringify(updated))
        } catch {
          // ignore
        }
      }
    }

    setSelectedPatientId(target.id)

    // Advance status to IN_CONSULTATION only for checked-in waiting patients
    if (target.status === 'ARRIVED' || target.status === 'CHECKED_IN' || target.status === 'WAITING') {
      try {
        await updateStatusMutation.mutateAsync({
          id: target.id,
          body: {
            status: 'IN_CONSULTATION',
            version_id: target.version_id,
          },
        })
        toast.success(
          `Called Token ${formatToken(target.token_number)} (${target.patient_name})${cabinCode ? ` → Cabin ${cabinCode}` : ''}`,
        )
      } catch (err: unknown) {
        // The patient was not moved into consultation; say so rather than report success.
        toast.error(
          err instanceof Error ? err.message : 'The server did not accept the status change.',
          {
            title: `Could not call Token ${formatToken(target.token_number)}`,
            action: {
              label: 'Open consultation record',
              onClick: () => handleStartConsultation(target),
            },
          },
        )
      }
    } else {
      toast.info(`Selected Token ${formatToken(target.token_number)} (${target.patient_name})`)
    }
  }

  // Toggle Lab / Diagnostics Hold
  const handleToggleLabHold = (item: DoctorQueueItem) => {
    const isHeld = labHoldIds.includes(item.id)
    if (!isHeld && (isInConsultation(item) || item.status === 'BOOKED' || item.status === 'DONE')) {
      return
    }
    let updated: number[]
    if (isHeld) {
      updated = labHoldIds.filter((id) => id !== item.id)
      toast.success(`Resumed Token ${formatToken(item.token_number)} from Lab Hold`)
    } else {
      updated = [...labHoldIds, item.id]
      toast.info(`Token ${formatToken(item.token_number)} placed on Lab Hold (Pending Diagnostics)`)
    }
    setLabHoldIds(updated)
    if (labHoldStorageKey) {
      try {
        localStorage.setItem(labHoldStorageKey, JSON.stringify(updated))
      } catch {
        // ignore
      }
    }
  }

  // Finish consultation & queue next
  const hasUnsavedScratchpad =
    Object.values(soapNotes).some((v) => v.trim() !== '') || prescribedMeds.length > 0 || orderedLabs.length > 0

  const handleFinishConsultation = async (item: DoctorQueueItem, discardScratchpad = false) => {
    if (!isInConsultation(item)) {
      return
    }
    // The scratchpad belongs to the patient on the chart and is never saved by this screen.
    // Finishing that patient must not silently throw it away.
    if (item.id === currentChartPatient?.id && hasUnsavedScratchpad && !discardScratchpad) {
      setUnsavedFinishItem(item)
      return
    }
    setUnsavedFinishItem(null)
    try {
      await updateStatusMutation.mutateAsync({
        id: item.id,
        body: {
          status: 'DONE',
          version_id: item.version_id,
        },
      })
      toast.success(`Consultation finished for Token ${formatToken(item.token_number)}.`)
      clearPatientScratchpad(item.patient_id)

      // If more patients are waiting, auto call next
      const remaining = waitingPatients.filter((p) => p.id !== item.id)
      if (remaining.length > 0) {
        if (autoCallTimerRef.current !== null) {
          clearTimeout(autoCallTimerRef.current)
        }
        autoCallTimerRef.current = setTimeout(() => {
          autoCallTimerRef.current = null
          void handleCallNext(remaining[0])
        }, 500)
      } else {
        setSelectedPatientId(null)
      }
    } catch (err: unknown) {
      // Say why it failed; the doctor decides whether to open the consultation record.
      toast.error(
        err instanceof Error ? err.message : 'The server did not accept the status change.',
        {
          title: `Could not finish Token ${formatToken(item.token_number)}`,
          action: {
            label: 'Open consultation record',
            onClick: () => handleStartConsultation(item),
          },
        },
      )
    }
  }

  // Navigate to full encounter workspace
  const handleStartConsultation = (item: DoctorQueueItem) => {
    navigate(`/doctor/encounters/new?patient_id=${item.patient_id}&appointment_id=${item.id}`)
  }

  // Append symptom macro into SOAP notes
  const handleAddSymptomMacro = (macro: string) => {
    setSoapNotes((prev) => ({
      ...prev,
      subjective: prev.subjective ? `${prev.subjective}; ${macro}` : macro,
    }))
  }

  // Render a single reusable Kanban Card
  const renderKanbanCard = (
    item: DoctorQueueItem,
    context: 'waiting' | 'in_consultation' | 'lab_hold' | 'booked' | 'completed'
  ) => {
    const isSelected = currentChartPatient?.id === item.id
    const isFollowup = item.notes?.toLowerCase().includes('follow') || item.notes?.toLowerCase().includes('f/u')

    return (
      <div
        key={item.id}
        draggable
        onDragStart={(e) => handleDragStart(e, item)}
        onClick={() => {
          setSelectedPatientId(item.id)
          setIsDrawerOpen(true)
        }}
        className={`group relative rounded-xl border p-4 transition-colors cursor-pointer shadow-2xs hover:border-slate-300 ${
          isSelected
            ? 'border-brand-700 bg-white ring-2 ring-brand-700/20'
            : context === 'in_consultation'
            ? 'border-blue-200 bg-blue-50/40 hover:bg-white'
            : context === 'lab_hold'
            ? 'border-amber-200 bg-amber-50/40 hover:bg-white'
            : 'border-slate-200 bg-white'
        }`}
      >
        {/* Card Header: Token Number & Priority Tag */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center justify-center min-w-[36px] h-7 px-2 rounded-lg font-mono font-bold text-sm tabular-nums shadow-2xs ${
                context === 'in_consultation'
                  ? 'bg-blue-700 text-white'
                  : context === 'lab_hold'
                  ? 'bg-amber-700 text-white'
                  : context === 'completed'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-900 text-white'
              }`}
            >
              {formatToken(item.token_number)}
            </span>

            <PriorityBadge level={item.priority_level} reason={item.priority_reason} />

            {/* Priority & Type Badges */}
            {isFollowup ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
                Follow-up
              </span>
            ) : context === 'booked' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">
                Scheduled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                Walk-in
              </span>
            )}
          </div>

          {/* Status Badge */}
          {context === 'in_consultation' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800 shrink-0">
              <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
              In Consult
            </span>
          ) : context === 'lab_hold' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 shrink-0">
              Lab Hold
            </span>
          ) : context === 'waiting' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 shrink-0">
              Ready
            </span>
          ) : context === 'completed' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 shrink-0">
              Seen
            </span>
          ) : (
            <span className="text-xs font-medium text-slate-600 shrink-0">Booked</span>
          )}
        </div>

        {/* Patient Demographics */}
        <div>
          <div className="flex items-baseline gap-2">
            <h4 className="font-bold text-sm text-slate-900 group-hover:text-brand-700 transition-colors truncate">
              {item.patient_name}
            </h4>
            <span className="text-xs font-mono text-slate-500 shrink-0">
              ({item.patient_urn})
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 tabular-nums">
            <span>{item.patient_age} yrs</span>
            <span>•</span>
            <span>{item.patient_gender}</span>
            <span>•</span>
            <span>{item.patient_mobile}</span>
          </div>

          {/* Allergies, exactly as recorded on the patient record */}
          {allergyStatus(item.patient_allergies).kind === 'recorded' && (
            <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-800 border border-red-200">
              Allergies: {allergyStatus(item.patient_allergies).text}
            </div>
          )}

          {/* Reception remarks */}
          {item.notes && (
            <p className="mt-1.5 text-xs text-slate-600 italic line-clamp-2">
              Note: {item.notes}
            </p>
          )}
        </div>

        {/* Card Quick Actions */}
        <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
          {context === 'waiting' && (
            <div className="w-full flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartConsultation(item)
                }}
                className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-xs font-semibold shadow-2xs transition"
              >
                <span>Start Consultation &rarr;</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCallNext(item)
                }}
                title="Call next into room and update display"
                className="inline-flex items-center justify-center px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-lg text-xs font-semibold transition"
              >
                <span className="inline-flex items-center gap-1"><IconBell size={14} stroke={1.8} aria-hidden="true" />Call</span>
              </button>
            </div>
          )}

          {context === 'in_consultation' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleStartConsultation(item)
              }}
              className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-xs font-semibold shadow-2xs transition"
            >
              <span>Resume Clinical Notes &rarr;</span>
            </button>
          )}

          {context === 'lab_hold' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleCallNext(item)
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-xs font-semibold shadow-2xs transition"
            >
              <span>Resume Consult &rarr;</span>
            </button>
          )}

          {context === 'booked' && (
            <span className="w-full inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
              Awaiting Reception check-in
            </span>
          )}

          {context === 'completed' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleStartConsultation(item)
              }}
              className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition"
            >
              <span>View Consultation</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  // Reusable Clinical Inspector Sheet for Kanban mode (and split views)
  const renderClinicalInspector = (patient: DoctorQueueItem, isDrawer: boolean = false) => {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden flex flex-col">
        {/* Sticky Header with Demographics & Close button */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center justify-center h-6 px-2 rounded-md font-mono font-bold text-xs tabular-nums bg-slate-900 text-white">
                {formatToken(patient.token_number)}
              </span>
              <h3 className="text-base font-bold text-slate-900 truncate">
                {patient.patient_name}
              </h3>
              <span className="font-mono text-xs text-slate-600 font-medium">
                ({patient.patient_urn})
              </span>
              {labHoldIds.includes(patient.id) && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
                  Lab Hold
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 flex-wrap tabular-nums">
              <span>{patient.patient_age} yrs</span>
              <span>•</span>
              <span>{patient.patient_gender}</span>
              <span>•</span>
              <span>{patient.patient_mobile}</span>
              {cabinCode && (
                <>
                  <span>•</span>
                  <span className="font-semibold text-slate-700">Cabin {cabinCode}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleCallNext(patient)}
              title="Call patient into cabin"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition"
            >
              <span className="inline-flex items-center gap-1"><IconBell size={14} stroke={1.8} aria-hidden="true" />Call</span>
            </button>
            {isDrawer && (
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                title="Collapse clinical sheet"
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Clinical Sheet Body */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[calc(100vh-250px)] overflow-y-auto">
          <AllergyBanner allergies={patient.patient_allergies} />

          {/* Chief Complaint */}
          {patient.notes && (
            <div className="bg-amber-50 p-2.5 rounded-lg border border-amber-200 text-xs text-amber-900">
              <span className="font-bold text-amber-900 block mb-0.5">Reception Chief Complaint:</span>
              <span>{patient.notes}</span>
            </div>
          )}

          {/* Smart Clinical Notes / SOAP Format */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">
                Clinical Notes / SOAP
              </label>
              <span className="text-xs font-semibold text-amber-800">Rough notes: not saved to the patient record</span>
            </div>

            {/* Quick Symptom Macros */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SYMPTOMS.map((macro) => (
                <button
                  key={macro}
                  type="button"
                  onClick={() => handleAddSymptomMacro(macro)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 transition"
                >
                  + {macro}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div>
                <span className="block text-xs font-semibold text-slate-600 mb-0.5">
                  S — Subjective / Chief Complaint:
                </span>
                <textarea aria-label="Subjective / chief complaint"
                  rows={2}
                  value={soapNotes.subjective}
                  onChange={(e) => setSoapNotes({ ...soapNotes, subjective: e.target.value })}
                  placeholder="Patient reports fever since 3 days, body aches, no cough..."
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                />
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-600 mb-0.5">
                  O — Objective / Examination:
                </span>
                <textarea aria-label="Objective / examination"
                  rows={2}
                  value={soapNotes.objective}
                  onChange={(e) => setSoapNotes({ ...soapNotes, objective: e.target.value })}
                  placeholder="Chest clear bilaterally, throat mild congestion, abdomen soft..."
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                />
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-600 mb-0.5">
                  A — Assessment / Diagnosis:
                </span>
                <input aria-label="Assessment / diagnosis"
                  type="text"
                  value={soapNotes.assessment}
                  onChange={(e) => setSoapNotes({ ...soapNotes, assessment: e.target.value })}
                  placeholder="e.g. Acute Viral Pharyngitis / Lumbar Spondylosis"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                />
              </div>
            </div>
          </div>

          {/* Past Visits & Prescriptions Timeline */}
          <div className="pt-3 border-t border-slate-200">
            <h4 className="text-xs font-bold text-slate-700 mb-2">
              Past Visits & Clinical Timeline
            </h4>
            {pastEncounters && pastEncounters.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-32 overflow-y-auto">
                {pastEncounters.map((enc) => (
                  <div key={enc.id} className="py-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-500 text-xs tabular-nums">
                      <span>
                        {new Date(enc.encounter_date).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="font-medium text-slate-700">{enc.doctor_name}</span>
                    </div>
                    <p className="font-semibold text-slate-800 mt-0.5">
                      Dx: {enc.diagnosis || 'Clinical Consultation'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No prior recorded encounters.</p>
            )}

            {pastPrescriptions && pastPrescriptions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-600 tabular-nums">
                  Past Prescriptions ({pastPrescriptions.length})
                </span>
                <div className="mt-1 space-y-1">
                  {pastPrescriptions.slice(0, 2).map((rx) => (
                    <div key={rx.id} className="text-xs text-slate-600 bg-slate-50 p-1.5 rounded tabular-nums">
                      Rx #{rx.id} · {new Date(rx.created_at).toLocaleDateString('en-GB')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Rapid Orders: E-Prescription & Diagnostics */}
          <div className="pt-3 border-t border-slate-200 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-700">
                  E-Prescription Favorites
                </span>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/doctor/prescriptions/new?patient_id=${patient.patient_id}&appointment_id=${patient.id}`
                    )
                  }
                  className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                >
                  Full Rx ↗
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {QUICK_MEDS.map((med) => {
                  const isAdded = prescribedMeds.some((m) => m.name === med.name)
                  return (
                    <button
                      key={med.name}
                      type="button"
                      onClick={() => {
                        if (isAdded) {
                          setPrescribedMeds(prescribedMeds.filter((m) => m.name !== med.name))
                        } else {
                          setPrescribedMeds([...prescribedMeds, med])
                        }
                      }}
                      className={`text-left p-2 rounded-lg text-xs font-medium border transition flex items-center justify-between ${
                        isAdded
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 font-bold'
                          : 'border-slate-200 bg-slate-50 hover:bg-white text-slate-800'
                      }`}
                    >
                      <span className="truncate">{med.name}</span>
                      <span className="text-xs text-slate-600 shrink-0 font-mono">
                        {isAdded ? '✓' : `+`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Diagnostic Orders & Lab Hold */}
            <div>
              <span className="block text-xs font-bold text-slate-700 mb-1.5">
                Diagnostic Orders
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                {DIAGNOSTIC_TESTS.map((test) => {
                  const isChecked = orderedLabs.includes(test)
                  return (
                    <label
                      key={test}
                      className="flex items-center gap-1.5 p-1 rounded hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOrderedLabs([...orderedLabs, test])
                          } else {
                            setOrderedLabs(orderedLabs.filter((t) => t !== test))
                          }
                        }}
                        className="rounded border-slate-300 accent-brand-700 text-brand-700 focus:ring-brand-700/20"
                      />
                      <span className="text-slate-800 truncate">{test}</span>
                    </label>
                  )
                })}
              </div>

              {/* Lab Hold Button */}
              <button
                type="button"
                disabled={
                  !labHoldIds.includes(patient.id) &&
                  (isInConsultation(patient) || patient.status === 'BOOKED' || patient.status === 'DONE')
                }
                onClick={() => handleToggleLabHold(patient)}
                className={`mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  labHoldIds.includes(patient.id)
                    ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
                    : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>
                  {labHoldIds.includes(patient.id) ? 'Remove from Lab Hold' : 'Place on Lab Hold'}
                </span>
              </button>
            </div>

            {/* Follow-up Selector */}
            <div>
              <span className="block text-xs font-bold text-slate-700 mb-1.5">
                Clinical Follow-Up
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {['3', '7', '14', '30'].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setFollowUpDays(days)}
                    className={`py-1 text-xs font-semibold tabular-nums rounded-lg border transition ${
                      followUpDays === days
                        ? 'bg-brand-700 text-white border-brand-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-white'
                    }`}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center gap-2">
          <button
            type="button"
            disabled={!isInConsultation(patient) || updateStatusMutation.isPending}
            onClick={() => handleFinishConsultation(patient)}
            className="flex-1 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-2xs transition"
          >
            <span>✓ Finish Consultation & Call Next</span>
          </button>
          <button
            type="button"
            onClick={() => handleStartConsultation(patient)}
            className="shrink-0 inline-flex items-center justify-center px-3 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition"
          >
            <span>Full Form ↗</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <AppShell name={me?.full_name || 'Consulting Doctor'} role="DOCTOR">
      <div className="space-y-5">
        {/* =========================================================================
            TOP BAR: Doctor Status [Available v] | Room 104 | Current Token: #A-12
        ========================================================================= */}
        <header className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Left: Title & Live Queue Subtitle */}
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">
                    My Queue
                  </h1>
                  <span className="hidden sm:inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    Live Queue
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Consultation workstation for {doctorName ? withDoctorTitle(doctorName) : 'the clinician'} ({queue?.queue_date || 'Today'})
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {updatedAt
                    ? `Last updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
                    : 'Loading today’s queue…'}
                </p>
              </div>
            </div>

            {/* Center / Right: Doctor Status | Room Code | Current Token | View Toggle */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              {/* Doctor Status Dropdown */}
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 shadow-2xs">
                <span className="text-xs font-semibold text-slate-600">Status:</span>
                <select
                  value={doctorStatus}
                  onChange={(e) => handleStatusChange(e.target.value as DoctorStatus)}
                  aria-label="Doctor availability status"
                  className="rounded border-0 bg-transparent text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="IN_CONSULTATION">In consult</option>
                  <option value="ON_BREAK">On Break</option>
                  <option value="IN_OT">In OT / Procedure</option>
                </select>
              </div>

              {/* Room / Cabin Badge */}
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs">
                <span className="text-slate-500">Cabin:</span>
                <span className="text-brand-800">{cabinCode ?? 'Not assigned'}</span>
              </div>

              {/* Current Active Token Indicator */}
              <div
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold shadow-2xs ${
                  activeConsultationItem
                    ? 'border border-blue-200 bg-blue-50 text-blue-800'
                    : 'border border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <span>Current Token:</span>
                <span className="font-mono text-sm tabular-nums">
                  {activeConsultationItem ? formatToken(activeConsultationItem.token_number) : 'None'}
                </span>
              </div>

              {/* View Mode Toggle: 3-Zone EMR vs Kanban Board */}
              <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('3ZONE')}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                    viewMode === '3ZONE'
                      ? 'bg-brand-50 text-brand-800 border-brand-200'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  3-Zone EMR
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('KANBAN')}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                    viewMode === 'KANBAN'
                      ? 'bg-brand-50 text-brand-800 border-brand-200'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Kanban Cards
                </button>
              </div>

              {/* Refresh Queue Button */}
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
              >
                <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh Queue</span>
              </button>
            </div>
          </div>
        </header>

        {isError && (
          <InlineAlert tone="error">
            Could not refresh the queue. The data below may be out of date
            {updatedAt ? ` (last updated ${formatIst(updatedAt.toISOString())}).` : '.'} Try again.
          </InlineAlert>
        )}

        {/* Doctor Incomplete Drafts Card (D-19-24, DWS-02) */}
        <DoctorDashboardUnfinishedCard />

        {/* Loading / Error states */}
        {isPending && !queue ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-600 shadow-2xs">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-700 mr-2 align-middle" />
            Loading today&rsquo;s consultation queue...
          </div>
        ) : isError && !queue ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
            Failed to load queue: {error?.message || 'Failed to load queue.'}
          </div>
        ) : !queue ? null : (
          <>
            {/* Queue summary figures (Waiting, Scheduled, Completed) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4" aria-label="Queue summary">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700">Waiting</p>
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
                </div>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{waitingPatients.length}</p>
                <p className="text-xs font-medium text-amber-800 mt-0.5">Checked-in at reception</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700">In Consult</p>
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden="true" />
                </div>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
                  {queue.in_consultation.length}
                </p>
                <p className="text-xs font-medium text-blue-800 mt-0.5">Active consultation</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700">Scheduled</p>
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-400" aria-hidden="true" />
                </div>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{queue.booked.length}</p>
                <p className="text-xs font-medium text-slate-600 mt-0.5">Booked for today</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700">Completed</p>
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" aria-hidden="true" />
                </div>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{queue.completed.length}</p>
                <p className="text-xs font-medium text-emerald-800 mt-0.5">Seen today</p>
              </div>
            </div>

            {/* =========================================================================
                MODE A: 3-ZONE CLINICAL CONSULTATION & EMR DASHBOARD
            ========================================================================= */}
            {viewMode === '3ZONE' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* -------------------------------------------------------------
                    ZONE 1: LEFT SIDEBAR (Live Synced Queue with Kanban Cards)
                ------------------------------------------------------------- */}
                <div className="lg:col-span-4 space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-4 py-3.5 bg-slate-50 border-b border-slate-200">
                      <div>
                        <h2 className="text-sm font-bold text-slate-900 tabular-nums">
                          Live Queue ({queue.in_consultation.length + waitingPatients.length + labHoldPatients.length})
                          {queue.booked.length > 0 ? ` · ${queue.booked.length} Booked` : ''}
                        </h2>
                        <p className="text-xs text-slate-600">Synced with reception</p>
                      </div>

                      {/* One-click Call Next button */}
                      <button
                        type="button"
                        onClick={() => handleCallNext()}
                        disabled={waitingPatients.length === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-xs font-bold shadow-2xs disabled:opacity-50 transition"
                      >
                        <span className="inline-flex items-center gap-1"><IconBell size={14} stroke={1.8} aria-hidden="true" />Call Next Waiting</span>
                      </button>
                    </div>

                    {/* Queue Kanban Card Stream */}
                    <div className="p-4 space-y-3 max-h-[780px] overflow-y-auto">
                      {/* Section: Currently In Consultation */}
                      {queue.in_consultation.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-blue-800">
                            <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                            <span>In Consultation</span>
                          </div>
                          <div className="space-y-2.5">
                            {queue.in_consultation.map((item) => renderKanbanCard(item, 'in_consultation'))}
                          </div>
                        </div>
                      )}

                      {/* Section: Lab / Diagnostics Hold */}
                      {labHoldPatients.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-900 tabular-nums">
                            <span>Pending Diagnostics ({labHoldPatients.length})</span>
                          </div>
                          <div className="space-y-2.5">
                            {labHoldPatients.map((item) => renderKanbanCard(item, 'lab_hold'))}
                          </div>
                        </div>
                      )}

                      {/* Section: Waiting Room (ARRIVED Patients) */}
                      <div>
                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700 tabular-nums">
                          <span>Waiting Room ({waitingPatients.length})</span>
                          <span className="text-xs text-emerald-800 normal-case font-semibold">Ready for consult</span>
                        </div>
                        {waitingPatients.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-600">
                            Waiting room is currently empty.
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {waitingPatients.map((item) => renderKanbanCard(item, 'waiting'))}
                          </div>
                        )}
                      </div>

                      {/* Section: Scheduled Bookings */}
                      {queue.booked.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700 tabular-nums">
                            <span>Scheduled Bookings ({queue.booked.length})</span>
                            <span className="text-xs text-slate-600 normal-case">Not yet checked in</span>
                          </div>
                          <div className="space-y-2.5">
                            {queue.booked.map((item) => renderKanbanCard(item, 'booked'))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* -------------------------------------------------------------
                    ZONE 2: CENTER WORKSPACE (Single-Page Patient Summary & EMR)
                ------------------------------------------------------------- */}
                <div className="lg:col-span-5 space-y-4">
                  {currentChartPatient ? (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
                      {/* Patient Identity Strip */}
                      <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-bold text-slate-900">
                              {currentChartPatient.patient_name}
                            </h3>
                            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                              {currentChartPatient.patient_urn}
                            </span>
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-mono text-xs font-bold text-blue-800 tabular-nums">
                              Token {formatToken(currentChartPatient.token_number)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 tabular-nums">
                            Age: {currentChartPatient.patient_age} yrs · Gender: {currentChartPatient.patient_gender} · {currentChartPatient.patient_mobile}
                          </p>
                          {currentChartPatient.notes && (
                            <p className="text-xs text-amber-900 mt-1.5 font-medium bg-amber-50 p-2 rounded-lg border border-amber-200">
                              Reception Chief Complaint: {currentChartPatient.notes}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleStartConsultation(currentChartPatient)}
                          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold shadow-2xs transition"
                        >
                          <span>Full Encounter ↗</span>
                        </button>
                      </div>

                      {/* Smart Clinical Notes (SOAP Format) */}
                      <div className="p-4 sm:p-5 space-y-4">
                        <AllergyBanner allergies={currentChartPatient.patient_allergies} />

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-slate-700">
                              Clinical Notes / SOAP
                            </label>
                            <span className="text-xs font-semibold text-amber-800">Rough notes: not saved to the patient record</span>
                          </div>

                          {/* Quick Symptom Macros */}
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            {QUICK_SYMPTOMS.map((macro) => (
                              <button
                                key={macro}
                                type="button"
                                onClick={() => handleAddSymptomMacro(macro)}
                                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 transition"
                              >
                                + {macro}
                              </button>
                            ))}
                          </div>

                          <div className="space-y-2.5">
                            <div>
                              <span className="block text-xs font-semibold text-slate-600 mb-0.5">
                                S — Subjective / Chief Complaint:
                              </span>
                              <textarea aria-label="Subjective / chief complaint"
                                rows={2}
                                value={soapNotes.subjective}
                                onChange={(e) => setSoapNotes({ ...soapNotes, subjective: e.target.value })}
                                placeholder="Patient reports fever since 3 days, body aches, no cough..."
                                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                              />
                            </div>

                            <div>
                              <span className="block text-xs font-semibold text-slate-600 mb-0.5">
                                O — Objective / Clinical Examination:
                              </span>
                              <textarea aria-label="Objective / clinical examination"
                                rows={2}
                                value={soapNotes.objective}
                                onChange={(e) => setSoapNotes({ ...soapNotes, objective: e.target.value })}
                                placeholder="Chest clear bilaterally, throat mild congestion, abdomen soft..."
                                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                              />
                            </div>

                            <div>
                              <span className="block text-xs font-semibold text-slate-600 mb-0.5">
                                A — Assessment / Working Diagnosis:
                              </span>
                              <input aria-label="Assessment / working diagnosis"
                                type="text"
                                value={soapNotes.assessment}
                                onChange={(e) => setSoapNotes({ ...soapNotes, assessment: e.target.value })}
                                placeholder="e.g. Acute Viral Pharyngitis / Lumbar Spondylosis"
                                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Chronological Mini-Timeline: Past Visits & Reports */}
                        <div className="pt-3 border-t border-slate-100">
                          <h4 className="text-xs font-bold text-slate-700 mb-2">
                            Past Visits & Clinical Timeline
                          </h4>
                          {pastEncounters && pastEncounters.length > 0 ? (
                            <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                              {pastEncounters.map((enc) => (
                                <div key={enc.id} className="py-2 text-xs">
                                  <div className="flex items-center justify-between text-slate-500 text-xs tabular-nums">
                                    <span>
                                      {new Date(enc.encounter_date).toLocaleDateString('en-GB', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                      })}
                                    </span>
                                    <span className="font-medium text-slate-700">{enc.doctor_name}</span>
                                  </div>
                                  <p className="font-semibold text-slate-800 mt-0.5">
                                    Dx: {enc.diagnosis || 'Clinical Consultation'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">
                              No prior recorded encounters for this patient.
                            </p>
                          )}

                          {pastPrescriptions && pastPrescriptions.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-100">
                              <span className="text-xs font-bold text-slate-600 tabular-nums">
                                Past Prescriptions ({pastPrescriptions.length})
                              </span>
                              <div className="mt-1 space-y-1">
                                {pastPrescriptions.slice(0, 2).map((rx) => (
                                  <div key={rx.id} className="text-xs text-slate-600 bg-slate-50 p-1.5 rounded tabular-nums">
                                    Rx #{rx.id} · {new Date(rx.created_at).toLocaleDateString('en-GB')}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600 shadow-2xs">
                      Select a patient from the Live Queue to display their clinical chart.
                    </div>
                  )}
                </div>

                {/* -------------------------------------------------------------
                    ZONE 3: RIGHT PANEL (Rapid Order & Checkout Bar)
                ------------------------------------------------------------- */}
                <div className="lg:col-span-3 space-y-4">
                  {currentChartPatient ? (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
                      <div className="px-4 py-3.5 sm:px-5 bg-slate-50 border-b border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900">
                          Rapid Orders & Checkout
                        </h3>
                        <p className="text-xs text-slate-600">Fast action bar for OPD speed</p>
                      </div>

                      <div className="p-4 sm:p-5 space-y-5">
                      {/* One-Click E-Prescription Favorites */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-slate-700">
                            E-Prescription Favorites
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/doctor/prescriptions/new?patient_id=${currentChartPatient.patient_id}&appointment_id=${currentChartPatient.id}`
                              )
                            }
                            className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                          >
                            Full RX ↗
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {QUICK_MEDS.map((med) => {
                            const isAdded = prescribedMeds.some((m) => m.name === med.name)
                            return (
                              <button
                                key={med.name}
                                type="button"
                                onClick={() => {
                                  if (isAdded) {
                                    setPrescribedMeds(prescribedMeds.filter((m) => m.name !== med.name))
                                  } else {
                                    setPrescribedMeds([...prescribedMeds, med])
                                  }
                                }}
                                className={`w-full text-left p-2 rounded-lg text-xs font-medium border transition flex items-center justify-between ${
                                  isAdded
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 font-bold'
                                    : 'border-slate-200 bg-slate-50 hover:bg-white text-slate-800'
                                }`}
                              >
                                <span className="truncate">{med.name}</span>
                                <span className="text-xs text-slate-600 shrink-0 font-mono tabular-nums">
                                  {isAdded ? '✓ Added' : `+ ${med.dosage}`}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Diagnostic Orders & Lab Hold */}
                      <div>
                        <span className="block text-xs font-bold text-slate-700 mb-2">
                          Diagnostic Orders
                        </span>
                        <div className="space-y-1.5 text-xs">
                          {DIAGNOSTIC_TESTS.map((test) => {
                            const isChecked = orderedLabs.includes(test)
                            return (
                              <label
                                key={test}
                                className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setOrderedLabs([...orderedLabs, test])
                                    } else {
                                      setOrderedLabs(orderedLabs.filter((t) => t !== test))
                                    }
                                  }}
                                  className="rounded border-slate-300 accent-brand-700 text-brand-700 focus:ring-brand-700/20"
                                />
                                <span className="text-slate-800">{test}</span>
                              </label>
                            )
                          })}
                        </div>

                        {/* Place on Lab Hold Button */}
                        <button
                          type="button"
                          disabled={
                            !labHoldIds.includes(currentChartPatient.id) &&
                            (isInConsultation(currentChartPatient) ||
                              currentChartPatient.status === 'BOOKED' ||
                              currentChartPatient.status === 'DONE')
                          }
                          onClick={() => handleToggleLabHold(currentChartPatient)}
                          className={`mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                            labHoldIds.includes(currentChartPatient.id)
                              ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
                              : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>
                            {labHoldIds.includes(currentChartPatient.id)
                              ? 'Remove from Lab Hold'
                              : 'Place on Lab Hold'}
                          </span>
                        </button>
                      </div>

                      {/* Follow-up Selector */}
                      <div>
                        <span className="block text-xs font-bold text-slate-700 mb-2">
                          Clinical Follow-Up
                        </span>
                        <div className="grid grid-cols-4 gap-1.5">
                          {['3', '7', '14', '30'].map((days) => (
                            <button
                              key={days}
                              type="button"
                              onClick={() => setFollowUpDays(days)}
                              className={`py-1.5 text-xs font-semibold tabular-nums rounded-lg border transition ${
                                followUpDays === days
                                  ? 'bg-brand-700 text-white border-brand-700'
                                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-white'
                              }`}
                            >
                              {days}d
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Finish Consultation & Call Next */}
                      <div className="pt-3 border-t border-slate-200 space-y-2">
                        <button
                          type="button"
                          disabled={!isInConsultation(currentChartPatient) || updateStatusMutation.isPending}
                          onClick={() => handleFinishConsultation(currentChartPatient)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-2xs transition"
                        >
                          <span>✓ Finish Consultation & Call Next</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartConsultation(currentChartPatient)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition"
                        >
                          <span>Open Full Clinical Form &rarr;</span>
                        </button>
                      </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* =========================================================================
                MODE B: FULL KANBAN BOARD VIEW (Multi-Column Queue Cards)
            ========================================================================= */}
            {viewMode === 'KANBAN' && (
              <div className="space-y-4">
                {/* Kanban Top Toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-sm font-bold text-slate-900">
                        Kanban Queue Pipeline
                      </h2>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-bold text-slate-700 tabular-nums">
                        {allItems.length} Patients Total
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Drag cards between columns to transition status, or click to examine clinical record.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Split vs Full Board Toggle */}
                    <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          setKanbanLayout('SPLIT')
                          if (!currentChartPatient && allItems.length > 0) {
                            setSelectedPatientId(allItems[0].id)
                          }
                          setIsDrawerOpen(true)
                        }}
                        className={`rounded-md border px-2.5 py-1 transition ${
                          kanbanLayout === 'SPLIT' && isDrawerOpen
                            ? 'bg-brand-50 text-brand-800 border-brand-200'
                            : 'border-transparent text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Split EMR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setKanbanLayout('FULL')
                          setIsDrawerOpen(false)
                        }}
                        className={`rounded-md border px-2.5 py-1 transition ${
                          kanbanLayout === 'FULL' || !isDrawerOpen
                            ? 'bg-brand-50 text-brand-800 border-brand-200'
                            : 'border-transparent text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Full Board
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCallNext()}
                      disabled={waitingPatients.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-2xs transition"
                    >
                      <span className="inline-flex items-center gap-1"><IconBell size={14} stroke={1.8} aria-hidden="true" />Call Next</span>
                    </button>
                  </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                  {/* Search input */}
                  <div className="relative flex-1 max-w-md">
                    <span className="pointer-events-none absolute left-3 top-2 text-slate-500" aria-hidden="true">
                      <IconSearch className="h-3.5 w-3.5" />
                    </span>
                    <input
                      type="search"
                      value={kanbanSearch}
                      onChange={(e) => setKanbanSearch(e.target.value)}
                      placeholder="Search token, patient name, URN or mobile..."
                      aria-label="Filter Kanban patients"
                      className="w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-8 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                    />
                    {kanbanSearch && (
                      <button
                        type="button"
                        onClick={() => setKanbanSearch('')}
                        className="absolute right-2.5 top-2 text-xs text-slate-500 hover:text-slate-700"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Filter chips */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs">
                    {(
                      [
                        { key: 'ALL', label: `All (${allItems.length})` },
                        { key: 'URGENT', label: 'Urgent' },
                        { key: 'WALKIN', label: 'Walk-ins' },
                        { key: 'SCHEDULED', label: 'Scheduled' },
                        { key: 'LAB_HOLD', label: `Lab Hold (${labHoldPatients.length})` },
                        { key: 'DONE', label: `Seen (${queue.completed.length})` },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setKanbanFilter(f.key)}
                        className={`rounded-full border px-3 py-1 font-semibold tabular-nums transition shrink-0 ${
                          kanbanFilter === f.key
                            ? 'bg-brand-700 border-brand-700 text-white shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Banner when patient is active but drawer is minimized in Full Board mode */}
                {currentChartPatient && !isDrawerOpen && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs shadow-2xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-blue-600 animate-pulse" />
                      <span className="font-semibold tabular-nums">
                        Selected Patient: <strong className="font-bold">Token {formatToken(currentChartPatient.token_number)} · {currentChartPatient.patient_name}</strong> ({currentChartPatient.patient_urn})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDrawerOpen(true)
                        setKanbanLayout('SPLIT')
                      }}
                      className="px-3 py-1 rounded-lg bg-brand-700 hover:bg-brand-800 text-white font-bold text-xs shadow-2xs transition"
                    >
                      Open Clinical Sheet &rarr;
                    </button>
                  </div>
                )}

                {/* Main Kanban Columns & Clinical Sheet Container */}
                <div
                  className={
                    kanbanLayout === 'SPLIT' && currentChartPatient && isDrawerOpen
                      ? 'grid grid-cols-1 lg:grid-cols-12 gap-5 items-start'
                      : 'w-full'
                  }
                >
                  {/* Left / Columns Board */}
                  <div
                    className={
                      kanbanLayout === 'SPLIT' && currentChartPatient && isDrawerOpen
                        ? 'lg:col-span-7 xl:col-span-7 space-y-4'
                        : 'w-full'
                    }
                  >
                    <div
                      className={
                        kanbanLayout === 'SPLIT' && currentChartPatient && isDrawerOpen
                          ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-3.5 items-start'
                          : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-start'
                      }
                    >
                      {/* Column 1: Waiting Room (ARRIVED) */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('waiting')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'waiting')}
                        className={`rounded-xl border bg-white shadow-2xs overflow-hidden transition-colors ${
                          dragOverCol === 'waiting'
                            ? 'border-brand-700 ring-2 ring-brand-700/20'
                            : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                            <h3 className="font-bold text-xs text-slate-900">
                              Waiting Room
                            </h3>
                          </div>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900 tabular-nums">
                            {waitingPatients.length}
                          </span>
                        </div>
                        <div className="p-3 space-y-2.5">
                        {filterKanbanItems(waitingPatients).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-600 bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
                            {kanbanSearch || kanbanFilter !== 'ALL'
                              ? 'No matching waiting patients'
                              : 'No waiting patients in queue'}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {filterKanbanItems(waitingPatients).map((item) =>
                              renderKanbanCard(item, 'waiting')
                            )}
                          </div>
                        )}
                        </div>
                      </div>

                      {/* Column 2: In Consultation */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('in_consultation')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'in_consultation')}
                        className={`rounded-xl border bg-white shadow-2xs overflow-hidden transition-colors ${
                          dragOverCol === 'in_consultation'
                            ? 'border-brand-700 ring-2 ring-brand-700/20'
                            : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-blue-600 animate-pulse" />
                            <h3 className="font-bold text-xs text-slate-900">
                              In Consultation
                            </h3>
                          </div>
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800 tabular-nums">
                            {queue.in_consultation.length}
                          </span>
                        </div>
                        <div className="p-3 space-y-2.5">
                        {filterKanbanItems(queue.in_consultation).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-600 bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
                            No active consultation
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {filterKanbanItems(queue.in_consultation).map((item) =>
                              renderKanbanCard(item, 'in_consultation')
                            )}
                          </div>
                        )}
                        </div>
                      </div>

                      {/* Column 3: Lab / Diagnostics Hold */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('lab_hold')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'lab_hold')}
                        className={`rounded-xl border bg-white shadow-2xs overflow-hidden transition-colors ${
                          dragOverCol === 'lab_hold'
                            ? 'border-brand-700 ring-2 ring-brand-700/20'
                            : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-600" />
                            <h3 className="font-bold text-xs text-slate-900">
                              Lab Hold
                            </h3>
                          </div>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900 tabular-nums">
                            {labHoldPatients.length}
                          </span>
                        </div>
                        <div className="p-3 space-y-2.5">
                        {filterKanbanItems(labHoldPatients).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-600 bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
                            No tokens on diagnostics hold
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {filterKanbanItems(labHoldPatients).map((item) =>
                              renderKanbanCard(item, 'lab_hold')
                            )}
                          </div>
                        )}
                        </div>
                      </div>

                      {/* Column 4: Scheduled Bookings */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('booked')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'booked')}
                        className={`rounded-xl border bg-white shadow-2xs overflow-hidden transition-colors ${
                          dragOverCol === 'booked'
                            ? 'border-brand-700 ring-2 ring-brand-700/20'
                            : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
                            <h3 className="font-bold text-xs text-slate-900">
                              Scheduled
                            </h3>
                          </div>
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 tabular-nums">
                            {queue.booked.length}
                          </span>
                        </div>
                        <div className="p-3 space-y-2.5">
                        {filterKanbanItems(queue.booked).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-600 bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
                            No further bookings today
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {filterKanbanItems(queue.booked).map((item) =>
                              renderKanbanCard(item, 'booked')
                            )}
                          </div>
                        )}
                        </div>
                      </div>

                      {/* Column 5: Completed Consultations */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('completed')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'completed')}
                        className={`rounded-xl border bg-white shadow-2xs overflow-hidden transition-colors ${
                          dragOverCol === 'completed'
                            ? 'border-brand-700 ring-2 ring-brand-700/20'
                            : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                            <h3 className="font-bold text-xs text-slate-900">
                              Seen Today
                            </h3>
                          </div>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800 tabular-nums">
                            {queue.completed.length}
                          </span>
                        </div>
                        <div className="p-3 space-y-2.5">
                        {filterKanbanItems(queue.completed).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-600 bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
                            None completed yet
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {filterKanbanItems(queue.completed).map((item) =>
                              renderKanbanCard(item, 'completed')
                            )}
                          </div>
                        )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right / Clinical Inspector Drawer (When Split mode and patient selected) */}
                  {kanbanLayout === 'SPLIT' && currentChartPatient && isDrawerOpen && (
                    <div className="lg:col-span-5 xl:col-span-5 sticky top-4">
                      {renderClinicalInspector(currentChartPatient, true)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        open={unsavedFinishItem !== null}
        variant="warning"
        title="These notes are not saved"
        onClose={() => setUnsavedFinishItem(null)}
        busy={updateStatusMutation.isPending}
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            The notes, medicines and lab orders typed on this screen are rough notes only. They are not part of the
            patient record. Open the consultation record to save them before finishing.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                const item = unsavedFinishItem
                if (item) void handleFinishConsultation(item, true)
              }}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Discard notes and finish
            </button>
            <button
              type="button"
              data-autofocus
              onClick={() => {
                const item = unsavedFinishItem
                setUnsavedFinishItem(null)
                if (item) handleStartConsultation(item)
              }}
              className="min-h-9 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Open consultation record
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}

export { DoctorDashboard as DoctorQueuePage }
