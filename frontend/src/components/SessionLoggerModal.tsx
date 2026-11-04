import { useState } from 'react'
import { Modal } from './Modal'
import type { TreatmentPlanOut } from '../api/types'
import { useLogTreatmentSession } from '../api/queries'

const MODALITY_OPTIONS = [
  'IFT (Interferential Therapy)',
  'Ultrasound Therapy',
  'Cervical Traction',
  'Lumbar Traction',
  'TENS',
  'Hot Pack',
  'Wax Bath',
  'Joint Mobilization',
  'Strengthening Exercises',
  'Gait Training',
]

interface SessionLoggerModalProps {
  plan: TreatmentPlanOut
  onClose: () => void
  onSuccess?: () => void
}

function getVasDescription(score: number): { label: string; color: string } {
  if (score === 0) return { label: '0 - No Pain (दर्द नहीं)', color: 'text-emerald-700 bg-emerald-50' }
  if (score <= 3) return { label: `${score} - Mild Pain (हल्का दर्द)`, color: 'text-teal-700 bg-teal-50' }
  if (score <= 6) return { label: `${score} - Moderate Pain (मध्यम दर्द)`, color: 'text-amber-700 bg-amber-50' }
  if (score <= 9) return { label: `${score} - Severe Pain (तीव्र दर्द)`, color: 'text-orange-700 bg-orange-50' }
  return { label: '10 - Worst Possible Pain (असहनीय दर्द)', color: 'text-red-700 bg-red-50' }
}

export function SessionLoggerModal({ plan, onClose, onSuccess }: SessionLoggerModalProps) {
  const nextSessionNumber = plan.completed_sessions + 1
  const today = new Date().toISOString().split('T')[0]

  const [sessionDate, setSessionDate] = useState(today)
  const [vasScore, setVasScore] = useState(5)
  const [selectedModalities, setSelectedModalities] = useState<string[]>([])
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const logSessionMutation = useLogTreatmentSession()

  const handleToggleModality = (modality: string) => {
    setSelectedModalities((prev) =>
      prev.includes(modality) ? prev.filter((m) => m !== modality) : [...prev, modality]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!clinicalNotes.trim()) {
      setErrorMessage('Clinical notes and patient observations are required.')
      return
    }

    try {
      await logSessionMutation.mutateAsync({
        planId: plan.id,
        body: {
          session_date: sessionDate || null,
          vas_score: vasScore,
          modalities: selectedModalities,
          clinical_notes: clinicalNotes.trim(),
        },
      })
      onSuccess?.()
      onClose()
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to log treatment session.')
    }
  }

  const vasInfo = getVasDescription(vasScore)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Log Session #${nextSessionNumber} of ${plan.total_sessions}`}
      description={`Session Logger · सत्र प्रविष्टि · ${plan.plan_name}`}
      busy={logSessionMutation.isPending}
      className="max-w-lg"
    >
      <div className="space-y-5">

        {errorMessage && (
          <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Session Date */}
          <div>
            <label htmlFor="session-date" className="block text-xs font-semibold text-gray-700 mb-1">
              Session Date (सत्र दिनांक)
            </label>
            <input
              id="session-date"
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              required
            />
          </div>

          {/* VAS Pain Slider */}
          <div className="space-y-1.5 rounded-lg border border-gray-200 p-3 bg-gray-50/50">
            <div className="flex justify-between items-center">
              <label htmlFor="vas-slider" className="text-xs font-semibold text-gray-700">
                VAS Pain Rating (दर्द का पैमाना 0–10)
              </label>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${vasInfo.color}`}>
                {vasInfo.label}
              </span>
            </div>
            <input
              id="vas-slider"
              type="range"
              min={0}
              max={10}
              step={1}
              value={vasScore}
              onChange={(e) => setVasScore(Number(e.target.value))}
              className="w-full accent-teal-700 cursor-pointer"
            />
            <div className="flex justify-between text-sm text-gray-600 font-mono px-1">
              <span>0 (None)</span>
              <span>2</span>
              <span>4</span>
              <span>6</span>
              <span>8</span>
              <span>10 (Severe)</span>
            </div>
          </div>

          {/* Modalities Multi-select Checkboxes */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-gray-700">
              Modalities Applied (प्रयुक्त चिकित्सा विधियाँ)
            </span>
            <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-2 border border-gray-200 rounded-lg bg-white">
              {MODALITY_OPTIONS.map((mod) => (
                <label key={mod} className="flex items-center gap-2 text-xs text-gray-800 cursor-pointer p-1 rounded hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedModalities.includes(mod)}
                    onChange={() => handleToggleModality(mod)}
                    className="rounded border-gray-300 text-teal-700 focus:ring-teal-600"
                  />
                  <span>{mod}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Clinical Notes */}
          <div>
            <label htmlFor="session-notes" className="block text-xs font-semibold text-gray-700 mb-1">
              Clinical Observations & Patient Response (चिकित्सीय विवरण) *
            </label>
            <textarea
              id="session-notes"
              rows={3}
              required
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              placeholder="Record range of motion, muscle spasm, tolerance to modalities, and home exercise instructions..."
              className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={logSessionMutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow transition disabled:opacity-50"
            >
              {logSessionMutation.isPending ? 'Logging Session...' : `Finalise & Lock Session #${nextSessionNumber}`}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

