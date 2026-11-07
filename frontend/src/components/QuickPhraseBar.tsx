import { useState, useEffect } from 'react'
import { IconPlus, IconCheck, IconX, IconNotes } from './icons'

const DEFAULT_PHYSIO_PHRASES = [
  'Low back pain radiating to leg',
  'Bilateral knee pain with crepitus',
  'Cervical stiffness & neck pain',
  'Shoulder periarthritis / frozen shoulder',
  'Sciatica nerve pain left leg',
  'Post-fracture stiffness & reduced mobility',
  'Heel pain / plantar fasciitis',
]

const DEFAULT_OPHTHALMOLOGY_PHRASES = [
  'Blurry vision for distance & near',
  'Redness, burning sensation & itching',
  'Foreign body sensation in eye',
  'Watering of eyes & photophobia',
  'Eye strain & frontal headache',
  'Gradual decrease in vision both eyes',
]

const DEFAULT_GENERAL_PHRASES = [
  'Fever with generalized body ache',
  'Persistent dry cough with throat pain',
  'Severe headache & vertigo',
  'Acid reflux, nausea & epigastric pain',
]

interface QuickPhraseBarProps {
  departmentCode?: string
  onSelectPhrase: (phrase: string) => void
}

export function QuickPhraseBar({ departmentCode, onSelectPhrase }: QuickPhraseBarProps) {
  const isPhysio = departmentCode?.toUpperCase().includes('PHYSIO')
  const isEye = departmentCode?.toUpperCase().includes('OPHTHAL')

  const defaultPhrases = isPhysio
    ? DEFAULT_PHYSIO_PHRASES
    : isEye
    ? DEFAULT_OPHTHALMOLOGY_PHRASES
    : DEFAULT_GENERAL_PHRASES

  const storageKey = `kalyan_quick_phrases_${departmentCode || 'general'}`

  const [customPhrases, setCustomPhrases] = useState<string[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [newPhraseText, setNewPhraseText] = useState('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        setCustomPhrases(JSON.parse(saved))
      }
    } catch {
      // Fallback if localStorage disabled or unavailable
    }
  }, [storageKey])

  const handleAddCustomPhrase = () => {
    const trimmed = newPhraseText.trim()
    if (!trimmed) return
    if (!customPhrases.includes(trimmed) && !defaultPhrases.includes(trimmed)) {
      const updated = [...customPhrases, trimmed]
      setCustomPhrases(updated)
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated))
      } catch {
        // Storage fallback
      }
    }
    onSelectPhrase(trimmed)
    setNewPhraseText('')
    setIsAdding(false)
  }

  const handleDeleteCustomPhrase = (phraseToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = customPhrases.filter((p) => p !== phraseToDelete)
    setCustomPhrases(updated)
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated))
    } catch {
      // Storage fallback
    }
  }

  return (
    <div className="space-y-2 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
          <IconNotes size={14} className="text-teal-700" />
          <span>Quick Symptoms & Complaints (Click to insert):</span>
        </span>

        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200/80 px-2 py-0.5 rounded-md transition-colors"
            title="Add a custom quick phrase for one-click re-use"
          >
            <IconPlus size={13} stroke={2.2} />
            <span>Add Custom Phrase</span>
          </button>
        )}
      </div>

      {isAdding && (
        <div className="flex items-center gap-2 p-2 bg-teal-50/70 border border-teal-200 rounded-lg">
          <input
            type="text"
            aria-label="New quick phrase text"
            value={newPhraseText}
            onChange={(e) => setNewPhraseText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAddCustomPhrase()
              } else if (e.key === 'Escape') {
                setIsAdding(false)
              }
            }}
            placeholder="Type doctor's common phrase (e.g. Lumbar spine spasm)..."
            className="flex-1 text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-teal-600 focus:outline-none"
            autoFocus
          />
          <button
            type="button"
            onClick={handleAddCustomPhrase}
            className="px-2.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded text-xs font-semibold inline-flex items-center gap-1 shadow-2xs"
          >
            <IconCheck size={14} />
            <span>Save</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAdding(false)}
            className="p-1.5 text-slate-500 hover:text-slate-700 rounded text-xs"
            title="Cancel"
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      {/* Phrases Pill Cloud */}
      <div className="flex flex-wrap items-center gap-1.5">
        {defaultPhrases.map((phrase) => (
          <button
            key={phrase}
            type="button"
            onClick={() => onSelectPhrase(phrase)}
            className="text-xs px-2.5 py-1 bg-white hover:bg-teal-50 text-slate-700 hover:text-teal-900 border border-slate-200 hover:border-teal-300 rounded-md font-normal transition-all shadow-2xs text-left"
          >
            + {phrase}
          </button>
        ))}

        {customPhrases.map((phrase) => (
          <span
            key={phrase}
            onClick={() => onSelectPhrase(phrase)}
            className="group cursor-pointer inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 rounded-md font-medium transition-all shadow-2xs"
          >
            <span>+ {phrase}</span>
            <button
              type="button"
              onClick={(e) => handleDeleteCustomPhrase(phrase, e)}
              className="opacity-40 group-hover:opacity-100 text-teal-700 hover:text-red-700 p-0.5 rounded"
              title="Remove quick phrase"
            >
              <IconX size={11} stroke={2.5} />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
