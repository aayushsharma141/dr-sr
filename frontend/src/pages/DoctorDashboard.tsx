import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Modal } from '../components/Modal'
import { DoctorDashboardUnfinishedCard } from '../components/DoctorDashboardUnfinishedCard'
import {
  useDoctorQueue,
  useDoctors,
  useMe,
  usePatientEncounters,
  usePatientPrescriptions,
  useUpdateAppointmentStatus,
} from '../api/queries'
import type { DoctorQueueItem } from '../api/types'
import { formatToken, withDoctorTitle } from '../format'

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
      <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-950 shadow-2xs">
        <div className="font-bold uppercase tracking-wider text-rose-900">Drug allergy recorded</div>
        <div className="mt-1 text-sm font-bold text-rose-900">{status.text}</div>
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

export function DoctorDashboard() {
  const { data: me } = useMe()
  const { data: doctors } = useDoctors(false)
  const navigate = useNavigate()
  const { data: queue, isPending, isError, error, refetch } = useDoctorQueue()
  const updateStatusMutation = useUpdateAppointmentStatus()

  // Find logged in doctor record
  const myDoctor = Array.isArray(doctors) ? doctors.find((d) => d.id === me?.doctor_id) : undefined
  const doctorName = queue?.doctor_name || me?.full_name
  const cabinCode = myDoctor?.cabin_code || 'Room 104'

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('3ZONE')
  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus>(() => {
    try {
      return (localStorage.getItem('kh.doctor.status') as DoctorStatus) || 'AVAILABLE'
    } catch {
      return 'AVAILABLE'
    }
  })

  // Selected patient for Center Workspace (Zone 2)
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)

  // Track patient appointments placed on Lab Hold
  const [labHoldIds, setLabHoldIds] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem('kh.doctor.labHold')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  // SOAP notes scratchpad for active patient
  const [soapNotes, setSoapNotes] = useState({
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
  })

  // Rapid order states
  const [prescribedMeds, setPrescribedMeds] = useState<typeof QUICK_MEDS>([])
  const [orderedLabs, setOrderedLabs] = useState<string[]>([])
  const [followUpDays, setFollowUpDays] = useState<string | null>('7')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [unsavedFinishItem, setUnsavedFinishItem] = useState<DoctorQueueItem | null>(null)
  const [finishError, setFinishError] = useState<{ item: DoctorQueueItem; message: string } | null>(null)

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
        return item.status === 'ARRIVED' && !item.notes?.toLowerCase().includes('follow')
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
    try {
      localStorage.setItem('kh.doctor.status', newStatus)
    } catch {
      // ignore
    }
    setToastMessage(`Status changed to ${newStatus.replace('_', ' ')}`)
    setTimeout(() => setToastMessage(null), 3000)
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
    const target = item || waitingPatients[0]
    if (!target) {
      setToastMessage('No waiting patients in queue.')
      setTimeout(() => setToastMessage(null), 3000)
      return
    }

    // Play chime announcement
    playWaitingRoomChime()

    // If item was on lab hold, remove from hold
    if (labHoldIds.includes(target.id)) {
      const updated = labHoldIds.filter((id) => id !== target.id)
      setLabHoldIds(updated)
      try {
        localStorage.setItem('kh.doctor.labHold', JSON.stringify(updated))
      } catch {
        // ignore
      }
    }

    setSelectedPatientId(target.id)

    // Advance status to IN_CONSULTATION if it is currently ARRIVED or BOOKED
    if (target.status === 'ARRIVED' || target.status === 'BOOKED') {
      try {
        await updateStatusMutation.mutateAsync({
          id: target.id,
          body: {
            status: 'IN_CONSULTATION',
            version_id: target.version_id,
          },
        })
        setToastMessage(`Called Token ${formatToken(target.token_number)} (${target.patient_name}) → Room ${cabinCode}`)
      } catch {
        // Optimistic / fallback: select patient even if status mutation is in progress
        setToastMessage(`Token ${formatToken(target.token_number)} called`)
      }
    } else {
      setToastMessage(`Selected Token ${formatToken(target.token_number)} (${target.patient_name})`)
    }
    setTimeout(() => setToastMessage(null), 4000)
  }

  // Toggle Lab / Diagnostics Hold
  const handleToggleLabHold = (item: DoctorQueueItem) => {
    const isHeld = labHoldIds.includes(item.id)
    let updated: number[]
    if (isHeld) {
      updated = labHoldIds.filter((id) => id !== item.id)
      setToastMessage(`Resumed Token ${formatToken(item.token_number)} from Lab Hold`)
    } else {
      updated = [...labHoldIds, item.id]
      setToastMessage(`Token ${formatToken(item.token_number)} placed on Lab Hold (Pending Diagnostics)`)
    }
    setLabHoldIds(updated)
    try {
      localStorage.setItem('kh.doctor.labHold', JSON.stringify(updated))
    } catch {
      // ignore
    }
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Finish consultation & queue next
  const hasUnsavedScratchpad =
    Object.values(soapNotes).some((v) => v.trim() !== '') || prescribedMeds.length > 0 || orderedLabs.length > 0

  const handleFinishConsultation = async (item: DoctorQueueItem, discardScratchpad = false) => {
    // The scratchpad belongs to the patient on the chart and is never saved by this screen.
    // Finishing that patient must not silently throw it away.
    if (item.id === currentChartPatient?.id && hasUnsavedScratchpad && !discardScratchpad) {
      setUnsavedFinishItem(item)
      return
    }
    setUnsavedFinishItem(null)
    setFinishError(null)
    try {
      await updateStatusMutation.mutateAsync({
        id: item.id,
        body: {
          status: 'DONE',
          version_id: item.version_id,
        },
      })
      setToastMessage(`Consultation finished for Token ${formatToken(item.token_number)}.`)
      if (item.id === currentChartPatient?.id) {
        setSoapNotes({ subjective: '', objective: '', assessment: '', plan: '' })
        setPrescribedMeds([])
        setOrderedLabs([])
      }

      // If more patients are waiting, auto call next
      const remaining = waitingPatients.filter((p) => p.id !== item.id)
      if (remaining.length > 0) {
        setTimeout(() => handleCallNext(remaining[0]), 500)
      } else {
        setSelectedPatientId(null)
      }
    } catch (err: unknown) {
      // Say why it failed; the doctor decides whether to open the consultation record.
      setFinishError({
        item,
        message: err instanceof Error ? err.message : 'The server did not accept the status change.',
      })
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
    const isUrgent = item.notes?.toLowerCase().includes('emergency') || item.notes?.toLowerCase().includes('urgent')
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
        className={`group relative rounded-xl border p-4 transition-all cursor-pointer shadow-2xs hover:shadow-md ${
          isSelected
            ? 'border-[#8E1C3D] bg-white ring-2 ring-[#8E1C3D]/20'
            : context === 'in_consultation'
            ? 'border-purple-300 bg-purple-50/50 hover:bg-white'
            : context === 'lab_hold'
            ? 'border-amber-300 bg-amber-50/40 hover:bg-white'
            : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
      >
        {/* Card Header: Token Number & Priority Tag */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center min-w-[36px] h-7 px-2 rounded-lg font-mono font-bold text-sm shadow-2xs ${
                context === 'in_consultation'
                  ? 'bg-purple-700 text-white'
                  : context === 'lab_hold'
                  ? 'bg-amber-600 text-white'
                  : context === 'completed'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-900 text-white'
              }`}
            >
              {formatToken(item.token_number)}
            </span>

            {/* Priority & Type Badges */}
            {isUrgent ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">
                🚨 Emergency
              </span>
            ) : isFollowup ? (
              <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
                🔄 Follow-up
              </span>
            ) : context === 'booked' ? (
              <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                📅 Scheduled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                🚶 Walk-in
              </span>
            )}
          </div>

          {/* Status Badge */}
          {context === 'in_consultation' ? (
            <span className="flex items-center gap-1.5 text-xs font-bold text-purple-700">
              <span className="h-2 w-2 rounded-full bg-purple-600 animate-pulse" />
              In Consult
            </span>
          ) : context === 'lab_hold' ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
              🧪 Lab Hold
            </span>
          ) : context === 'waiting' ? (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
              🟢 Ready
            </span>
          ) : context === 'completed' ? (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
              ✓ Seen
            </span>
          ) : (
            <span className="text-xs font-medium text-slate-500">Booked</span>
          )}
        </div>

        {/* Patient Demographics */}
        <div>
          <div className="flex items-baseline gap-2">
            <h4 className="font-bold text-sm text-slate-900 group-hover:text-[#8E1C3D] transition-colors truncate">
              {item.patient_name}
            </h4>
            <span className="text-xs font-mono text-slate-500 shrink-0">
              ({item.patient_urn})
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
            <span>{item.patient_age} yrs</span>
            <span>•</span>
            <span>{item.patient_gender}</span>
            <span>•</span>
            <span>📞 {item.patient_mobile}</span>
          </div>

          {/* Allergies, exactly as recorded on the patient record */}
          {allergyStatus(item.patient_allergies).kind === 'recorded' && (
            <div className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs font-bold text-rose-800 border border-rose-200">
              ⚠️ Allergies: {allergyStatus(item.patient_allergies).text}
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
                className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-[#8E1C3D] hover:bg-[#721530] text-white rounded-lg text-xs font-semibold shadow-2xs transition"
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
                className="inline-flex items-center justify-center px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition"
              >
                <span>🔔 Call</span>
              </button>
            </div>
          )}

          {context === 'in_consultation' && (
            <div className="w-full flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartConsultation(item)
                }}
                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-semibold shadow-2xs transition"
              >
                <span>Resume Clinical Notes &rarr;</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggleLabHold(item)
                }}
                title="Send patient for diagnostics (Lab/X-Ray Hold)"
                className="inline-flex items-center justify-center px-2 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-xs font-semibold transition"
              >
                <span>🧪 Hold</span>
              </button>
            </div>
          )}

          {context === 'lab_hold' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleCallNext(item)
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition"
            >
              <span>Resume Consult &rarr;</span>
            </button>
          )}

          {context === 'booked' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleStartConsultation(item)
              }}
              className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition"
            >
              <span>Start Consultation &rarr;</span>
            </button>
          )}

          {context === 'completed' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleStartConsultation(item)
              }}
              className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition"
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
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
        {/* Sticky Header with Demographics & Close button */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center justify-center h-6 px-2 rounded-md font-mono font-bold text-xs bg-slate-900 text-white">
                {formatToken(patient.token_number)}
              </span>
              <h3 className="text-base font-bold text-slate-900 truncate">
                {patient.patient_name}
              </h3>
              <span className="font-mono text-xs text-slate-500 font-medium">
                ({patient.patient_urn})
              </span>
              {labHoldIds.includes(patient.id) && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                  🧪 Lab Hold
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 flex-wrap">
              <span>{patient.patient_age} yrs</span>
              <span>•</span>
              <span>{patient.patient_gender}</span>
              <span>•</span>
              <span>📞 {patient.patient_mobile}</span>
              <span>•</span>
              <span className="font-semibold text-slate-700">Room {cabinCode}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleCallNext(patient)}
              title="Call patient into cabin"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition"
            >
              <span>🔔 Call</span>
            </button>
            {isDrawer && (
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                title="Collapse clinical sheet"
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-slate-200/70 hover:bg-slate-300 text-slate-700 text-xs font-bold transition"
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
            <div className="bg-amber-50/70 p-2.5 rounded-lg border border-amber-200 text-xs text-amber-950">
              <span className="font-bold text-amber-900 block mb-0.5">Reception Chief Complaint:</span>
              <span>{patient.notes}</span>
            </div>
          )}

          {/* Smart Clinical Notes / SOAP Format */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
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
                  className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-[#8E1C3D]/10 hover:text-[#8E1C3D] transition"
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
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
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
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
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
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                />
              </div>
            </div>
          </div>

          {/* Past Visits & Prescriptions Timeline */}
          <div className="pt-3 border-t border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Past Visits & Clinical Timeline
            </h4>
            {pastEncounters && pastEncounters.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-32 overflow-y-auto">
                {pastEncounters.map((enc) => (
                  <div key={enc.id} className="py-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-500 text-xs">
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
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                  Past Prescriptions ({pastPrescriptions.length})
                </span>
                <div className="mt-1 space-y-1">
                  {pastPrescriptions.slice(0, 2).map((rx) => (
                    <div key={rx.id} className="text-xs text-slate-600 bg-slate-50 p-1.5 rounded">
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
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  E-Prescription Favorites
                </span>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/doctor/prescriptions/new?patient_id=${patient.patient_id}&appointment_id=${patient.id}`
                    )
                  }
                  className="text-xs font-semibold text-[#8E1C3D] hover:underline"
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
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-bold'
                          : 'border-slate-200 bg-slate-50 hover:bg-white text-slate-800'
                      }`}
                    >
                      <span className="truncate">{med.name}</span>
                      <span className="text-xs text-slate-500 shrink-0 font-mono">
                        {isAdded ? '✓' : `+`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Diagnostic Orders & Lab Hold */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
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
                        className="rounded border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D]"
                      />
                      <span className="text-slate-800 truncate">{test}</span>
                    </label>
                  )
                })}
              </div>

              {/* Lab Hold Button */}
              <button
                type="button"
                onClick={() => handleToggleLabHold(patient)}
                className={`mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  labHoldIds.includes(patient.id)
                    ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                    : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>🧪</span>
                <span>
                  {labHoldIds.includes(patient.id) ? 'Remove from Lab Hold' : 'Place on Lab Hold'}
                </span>
              </button>
            </div>

            {/* Follow-up Selector */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Clinical Follow-Up
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {['3', '7', '14', '30'].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setFollowUpDays(days)}
                    className={`py-1 text-xs font-semibold rounded border transition ${
                      followUpDays === days
                        ? 'bg-[#8E1C3D] text-white border-[#8E1C3D]'
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
            onClick={() => handleFinishConsultation(patient)}
            className="flex-1 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm transition"
          >
            <span>✓ Finish Consultation & Call Next</span>
          </button>
          <button
            type="button"
            onClick={() => handleStartConsultation(patient)}
            className="shrink-0 inline-flex items-center justify-center px-3 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold transition"
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
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#8E1C3D]/10 text-[#8E1C3D]">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">
                    Doctor Dashboard
                  </h1>
                  <span className="hidden sm:inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    Live Queue
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Consultation workstation for {doctorName ? withDoctorTitle(doctorName) : 'the clinician'} ({queue?.queue_date || 'Today'})
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
                  <option value="AVAILABLE">🟢 Available</option>
                  <option value="IN_CONSULTATION">🟣 In Consultation</option>
                  <option value="ON_BREAK">☕ On Break</option>
                  <option value="IN_OT">🏥 In OT / Procedure</option>
                </select>
              </div>

              {/* Room / Cabin Badge */}
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs">
                <span className="text-slate-500">Cabin:</span>
                <span className="text-[#8E1C3D]">{cabinCode}</span>
              </div>

              {/* Current Active Token Indicator */}
              <div
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold shadow-2xs ${
                  activeConsultationItem
                    ? 'border border-purple-300 bg-purple-50 text-purple-900'
                    : 'border border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <span>Current Token:</span>
                <span className="font-mono text-sm">
                  {activeConsultationItem ? formatToken(activeConsultationItem.token_number) : 'None'}
                </span>
              </div>

              {/* View Mode Toggle: 3-Zone Workspace vs Kanban Board */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('3ZONE')}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    viewMode === '3ZONE'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  3-Zone EMR
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('KANBAN')}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    viewMode === 'KANBAN'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
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
                <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh Queue</span>
              </button>
            </div>
          </div>

          {/* Optional Action Feedback Toast Banner */}
          {toastMessage && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-800">
              <span className="flex items-center gap-2">
                <span>✓</span>
                <span>{toastMessage}</span>
              </span>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="text-emerald-700 hover:text-emerald-900 font-bold"
              >
                ✕
              </button>
            </div>
          )}
        </header>

        {/* Doctor Incomplete Drafts Card (D-19-24, DWS-02) */}
        <DoctorDashboardUnfinishedCard />

        {/* Loading / Error states */}
        {isPending ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-[#8E1C3D] mr-2 align-middle" />
            Loading today&rsquo;s consultation queue...
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800">
            Failed to load queue: {error.message}
          </div>
        ) : !queue ? null : (
          <>
            {/* Queue summary figures (Waiting, Scheduled, Completed) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4" aria-label="Queue summary">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-2xs">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-900">Waiting</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-amber-950">{waitingPatients.length}</p>
                <p className="text-xs text-amber-700 mt-0.5">Checked-in at reception</p>
              </div>
              <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 shadow-2xs">
                <p className="text-xs font-bold uppercase tracking-wider text-purple-900">In Consult</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-purple-950">
                  {queue.in_consultation.length}
                </p>
                <p className="text-xs text-purple-700 mt-0.5">Active consultation</p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-2xs">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-900">Scheduled</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-blue-950">{queue.booked.length}</p>
                <p className="text-xs text-blue-700 mt-0.5">Booked for today</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-2xs">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-900">Completed</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-950">{queue.completed.length}</p>
                <p className="text-xs text-emerald-700 mt-0.5">Seen today</p>
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
                  <div className="rounded-xl border border-slate-200 bg-white shadow-2xs p-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Live Queue ({waitingPatients.length + (activeConsultationItem ? 1 : 0) + labHoldPatients.length})
                        </h2>
                        <p className="text-xs text-slate-500">Synced in real-time with reception</p>
                      </div>

                      {/* One-click Call Next button */}
                      <button
                        type="button"
                        onClick={() => handleCallNext()}
                        disabled={waitingPatients.length === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8E1C3D] hover:bg-[#721530] text-white text-xs font-bold shadow-2xs disabled:opacity-50 transition"
                      >
                        <span>🔔 Call Next Waiting</span>
                      </button>
                    </div>

                    {/* Queue Kanban Card Stream */}
                    <div className="mt-4 space-y-3 max-h-[780px] overflow-y-auto pr-1">
                      {/* Section: Currently In Consultation */}
                      {activeConsultationItem && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-purple-900">
                            <span className="h-2 w-2 rounded-full bg-purple-600 animate-pulse" />
                            <span>In Consultation</span>
                          </div>
                          {renderKanbanCard(activeConsultationItem, 'in_consultation')}
                        </div>
                      )}

                      {/* Section: Lab / Diagnostics Hold */}
                      {labHoldPatients.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-900">
                            <span>🧪</span>
                            <span>Pending Diagnostics ({labHoldPatients.length})</span>
                          </div>
                          <div className="space-y-2.5">
                            {labHoldPatients.map((item) => renderKanbanCard(item, 'lab_hold'))}
                          </div>
                        </div>
                      )}

                      {/* Section: Waiting Room (ARRIVED Patients) */}
                      <div>
                        <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-700">
                          <span>Waiting Room ({waitingPatients.length})</span>
                          <span className="text-xs text-emerald-700 normal-case font-semibold">Ready for consult</span>
                        </div>
                        {waitingPatients.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
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
                          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-700">
                            <span>Scheduled Bookings ({queue.booked.length})</span>
                            <span className="text-xs text-slate-500 normal-case">Not yet checked in</span>
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
                      <AllergyBanner allergies={currentChartPatient.patient_allergies} />

                      {/* Patient Identity Strip */}
                      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <h3 className="text-lg font-bold text-slate-900">
                              {currentChartPatient.patient_name}
                            </h3>
                            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                              {currentChartPatient.patient_urn}
                            </span>
                            <span className="rounded bg-purple-100 px-2 py-0.5 font-mono text-xs font-bold text-purple-900">
                              Token {formatToken(currentChartPatient.token_number)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            Age: {currentChartPatient.patient_age} yrs · Gender: {currentChartPatient.patient_gender} · 📞 {currentChartPatient.patient_mobile}
                          </p>
                          {currentChartPatient.notes && (
                            <p className="text-xs text-slate-700 mt-1.5 font-medium bg-amber-50/60 p-2 rounded border border-amber-200">
                              Reception Chief Complaint: {currentChartPatient.notes}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleStartConsultation(currentChartPatient)}
                          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition"
                        >
                          <span>Full Encounter ↗</span>
                        </button>
                      </div>

                      {/* Smart Clinical Notes (SOAP Format) */}
                      <div className="p-4 sm:p-5 space-y-4">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
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
                                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-[#8E1C3D]/10 hover:text-[#8E1C3D] transition"
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
                                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
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
                                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
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
                                className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Chronological Mini-Timeline: Past Visits & Reports */}
                        <div className="pt-3 border-t border-slate-100">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                            Past Visits & Clinical Timeline
                          </h4>
                          {pastEncounters && pastEncounters.length > 0 ? (
                            <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                              {pastEncounters.map((enc) => (
                                <div key={enc.id} className="py-2 text-xs">
                                  <div className="flex items-center justify-between text-slate-500 text-xs">
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
                              <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                                Past Prescriptions ({pastPrescriptions.length})
                              </span>
                              <div className="mt-1 space-y-1">
                                {pastPrescriptions.slice(0, 2).map((rx) => (
                                  <div key={rx.id} className="text-xs text-slate-600 bg-slate-50 p-1.5 rounded">
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
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
                      Select a patient from the Live Queue to display their clinical chart.
                    </div>
                  )}
                </div>

                {/* -------------------------------------------------------------
                    ZONE 3: RIGHT PANEL (Rapid Order & Checkout Bar)
                ------------------------------------------------------------- */}
                <div className="lg:col-span-3 space-y-4">
                  {currentChartPatient ? (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-2xs p-4 sm:p-5 space-y-5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Rapid Orders & Checkout
                        </h3>
                        <p className="text-xs text-slate-500">Fast action bar for OPD speed</p>
                      </div>

                      {/* One-Click E-Prescription Favorites */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                            E-Prescription Favorites
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/doctor/prescriptions/new?patient_id=${currentChartPatient.patient_id}&appointment_id=${currentChartPatient.id}`
                              )
                            }
                            className="text-xs font-semibold text-[#8E1C3D] hover:underline"
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
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-bold'
                                    : 'border-slate-200 bg-slate-50 hover:bg-white text-slate-800'
                                }`}
                              >
                                <span className="truncate">{med.name}</span>
                                <span className="text-xs text-slate-500 shrink-0 font-mono">
                                  {isAdded ? '✓ Added' : `+ ${med.dosage}`}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Diagnostic Orders & Lab Hold */}
                      <div>
                        <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
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
                                  className="rounded border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D]"
                                />
                                <span className="text-slate-800">{test}</span>
                              </label>
                            )
                          })}
                        </div>

                        {/* Place on Lab Hold Button */}
                        <button
                          type="button"
                          onClick={() => handleToggleLabHold(currentChartPatient)}
                          className={`mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition ${
                            labHoldIds.includes(currentChartPatient.id)
                              ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                              : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>🧪</span>
                          <span>
                            {labHoldIds.includes(currentChartPatient.id)
                              ? 'Remove from Lab Hold'
                              : 'Place on Lab Hold'}
                          </span>
                        </button>
                      </div>

                      {/* Follow-up Selector */}
                      <div>
                        <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                          Clinical Follow-Up
                        </span>
                        <div className="grid grid-cols-4 gap-1.5">
                          {['3', '7', '14', '30'].map((days) => (
                            <button
                              key={days}
                              type="button"
                              onClick={() => setFollowUpDays(days)}
                              className={`py-1.5 text-xs font-semibold rounded border transition ${
                                followUpDays === days
                                  ? 'bg-[#8E1C3D] text-white border-[#8E1C3D]'
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
                          onClick={() => handleFinishConsultation(currentChartPatient)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm transition"
                        >
                          <span>✓ Finish Consultation & Call Next</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartConsultation(currentChartPatient)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition"
                        >
                          <span>Open Full Clinical Form &rarr;</span>
                        </button>
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
                      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                        Kanban Queue Pipeline
                      </h2>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                        {allItems.length} Patients Total
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Drag cards between columns to transition status, or click to examine clinical record.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Split vs Full Board Toggle */}
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          setKanbanLayout('SPLIT')
                          if (!currentChartPatient && allItems.length > 0) {
                            setSelectedPatientId(allItems[0].id)
                          }
                          setIsDrawerOpen(true)
                        }}
                        className={`rounded-md px-2.5 py-1 transition ${
                          kanbanLayout === 'SPLIT' && isDrawerOpen
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
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
                        className={`rounded-md px-2.5 py-1 transition ${
                          kanbanLayout === 'FULL' || !isDrawerOpen
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Full Board
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCallNext()}
                      disabled={waitingPatients.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#8E1C3D] hover:bg-[#721530] disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-2xs transition"
                    >
                      <span>🔔 Call Next</span>
                    </button>
                  </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                  {/* Search input */}
                  <div className="relative flex-1 max-w-md">
                    <span className="pointer-events-none absolute left-3 top-2.5 text-slate-500">
                      🔍
                    </span>
                    <input
                      type="search"
                      value={kanbanSearch}
                      onChange={(e) => setKanbanSearch(e.target.value)}
                      placeholder="Search token, patient name, URN or mobile..."
                      aria-label="Filter Kanban patients"
                      className="w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-8 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                    />
                    {kanbanSearch && (
                      <button
                        type="button"
                        onClick={() => setKanbanSearch('')}
                        className="absolute right-2.5 top-2 text-xs text-slate-500 hover:text-slate-600"
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
                        { key: 'URGENT', label: '🚨 Urgent' },
                        { key: 'WALKIN', label: '🚶 Walk-ins' },
                        { key: 'SCHEDULED', label: '📅 Scheduled' },
                        { key: 'LAB_HOLD', label: `🧪 Lab Hold (${labHoldPatients.length})` },
                        { key: 'DONE', label: `✓ Seen (${queue.completed.length})` },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setKanbanFilter(f.key)}
                        className={`rounded-full px-3 py-1 font-semibold transition shrink-0 ${
                          kanbanFilter === f.key
                            ? 'bg-slate-900 text-white shadow-2xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Banner when patient is active but drawer is minimized in Full Board mode */}
                {currentChartPatient && !isDrawerOpen && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-950 text-xs shadow-2xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-purple-600 animate-pulse" />
                      <span className="font-semibold">
                        Selected Patient: <strong className="font-bold">Token {formatToken(currentChartPatient.token_number)} · {currentChartPatient.patient_name}</strong> ({currentChartPatient.patient_urn})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDrawerOpen(true)
                        setKanbanLayout('SPLIT')
                      }}
                      className="px-3 py-1 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-2xs transition"
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
                        className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
                          dragOverCol === 'waiting'
                            ? 'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-400/40'
                            : 'border-amber-200 bg-amber-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-amber-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                            <h3 className="font-bold text-xs uppercase tracking-wider text-amber-950">
                              Waiting Room
                            </h3>
                          </div>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                            {waitingPatients.length}
                          </span>
                        </div>
                        {filterKanbanItems(waitingPatients).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-500 bg-white/60 rounded-lg border border-dashed border-amber-200">
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

                      {/* Column 2: In Consultation */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('in_consultation')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'in_consultation')}
                        className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
                          dragOverCol === 'in_consultation'
                            ? 'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-400/40'
                            : 'border-purple-200 bg-purple-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-purple-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-purple-600 animate-pulse" />
                            <h3 className="font-bold text-xs uppercase tracking-wider text-purple-950">
                              In Consultation
                            </h3>
                          </div>
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-900">
                            {queue.in_consultation.length}
                          </span>
                        </div>
                        {filterKanbanItems(queue.in_consultation).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-500 bg-white/60 rounded-lg border border-dashed border-purple-200">
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

                      {/* Column 3: Lab / Diagnostics Hold */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('lab_hold')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'lab_hold')}
                        className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
                          dragOverCol === 'lab_hold'
                            ? 'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-400/40'
                            : 'border-amber-200 bg-amber-50/20'
                        }`}
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-amber-200">
                          <div className="flex items-center gap-2">
                            <span className="text-xs">🧪</span>
                            <h3 className="font-bold text-xs uppercase tracking-wider text-amber-950">
                              Lab Hold
                            </h3>
                          </div>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                            {labHoldPatients.length}
                          </span>
                        </div>
                        {filterKanbanItems(labHoldPatients).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-500 bg-white/60 rounded-lg border border-dashed border-amber-200">
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

                      {/* Column 4: Scheduled Bookings */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('booked')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'booked')}
                        className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
                          dragOverCol === 'booked'
                            ? 'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-400/40'
                            : 'border-blue-200 bg-blue-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-blue-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                            <h3 className="font-bold text-xs uppercase tracking-wider text-blue-950">
                              Scheduled
                            </h3>
                          </div>
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-900">
                            {queue.booked.length}
                          </span>
                        </div>
                        {filterKanbanItems(queue.booked).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-500 bg-white/60 rounded-lg border border-dashed border-blue-200">
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

                      {/* Column 5: Completed Consultations */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCol('completed')
                        }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={(e) => handleDropToColumn(e, 'completed')}
                        className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
                          dragOverCol === 'completed'
                            ? 'border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-400/40'
                            : 'border-emerald-200 bg-emerald-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-emerald-200">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                            <h3 className="font-bold text-xs uppercase tracking-wider text-emerald-950">
                              Seen Today
                            </h3>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900">
                            {queue.completed.length}
                          </span>
                        </div>
                        {filterKanbanItems(queue.completed).length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-500 bg-white/60 rounded-lg border border-dashed border-emerald-200">
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
      {finishError && (
        <div role="alert" className="fixed bottom-4 right-4 z-40 max-w-md rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 shadow-lg">
          <p className="font-bold">Could not finish Token {formatToken(finishError.item.token_number)}</p>
          <p className="mt-1">{finishError.message}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setFinishError(null)} className="min-h-9 rounded-lg border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-900 hover:bg-rose-100">
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => handleStartConsultation(finishError.item)}
              className="min-h-9 rounded-lg bg-[#5D0B26] px-3 text-xs font-semibold text-white hover:bg-[#8E1C3D]"
            >
              Open consultation record
            </button>
          </div>
        </div>
      )}

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
              className="min-h-9 rounded-lg bg-[#5D0B26] px-3 text-sm font-semibold text-white hover:bg-[#8E1C3D]"
            >
              Open consultation record
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
