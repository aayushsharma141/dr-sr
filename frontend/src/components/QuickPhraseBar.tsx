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
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <IconNotes size={14} className="text-slate-500" aria-hidden="true" />
          <span>Quick phrases — click to add</span>
        </span>

        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
            title="Add a custom quick phrase for one-click re-use"
          >
            <IconPlus size={13} stroke={2.2} aria-hidden="true" />
            <span>Add Custom Phrase</span>
          </button>
        )}
      </div>

      {isAdding && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
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
            placeholder="Type a phrase you use often (e.g. Lumbar spine spasm)..."
            className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
            autoFocus
          />
          <button
            type="button"
            onClick={handleAddCustomPhrase}
            className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
          >
            <IconCheck size={14} aria-hidden="true" />
            <span>Save</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAdding(false)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Cancel"
            aria-label="Cancel adding phrase"
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
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-left text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            + {phrase}
          </button>
        ))}

        {customPhrases.map((phrase) => (
          <span
            key={phrase}
            className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 text-xs text-slate-800"
          >
            <button
              type="button"
              onClick={() => onSelectPhrase(phrase)}
              className="rounded-l-full py-1 pl-3 pr-1.5 text-left hover:text-slate-950"
            >
              + {phrase}
            </button>
            <button
              type="button"
              onClick={(e) => handleDeleteCustomPhrase(phrase, e)}
              className="mr-1 rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-red-700"
              title="Remove quick phrase"
              aria-label={`Remove quick phrase: ${phrase}`}
            >
              <IconX size={11} stroke={2.5} />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
