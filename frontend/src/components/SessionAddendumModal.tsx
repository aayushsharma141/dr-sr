import { useState } from 'react'
import type { TreatmentSessionOut } from '../api/types'
import { useAddSessionAddendum } from '../api/queries'

interface SessionAddendumModalProps {
  session: TreatmentSessionOut
  onClose: () => void
  onSuccess?: () => void
}

export function SessionAddendumModal({ session, onClose, onSuccess }: SessionAddendumModalProps) {
  const [note, setNote] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const addAddendumMutation = useAddSessionAddendum()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!note.trim() || note.trim().length < 2) {
      setErrorMessage('Addendum note must contain at least 2 characters.')
      return
    }

    try {
      await addAddendumMutation.mutateAsync({
        id: session.id,
        body: { note: note.trim() },
      })
      onSuccess?.()
      onClose()
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to append session addendum.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 my-8">
        <div className="border-b border-gray-200 pb-3 flex justify-between items-start">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Session Addendum · परिशिष्ट टिप्पणी
            </span>
            <h3 className="text-lg font-bold text-gray-900 mt-0.5">
              Append Addendum to Session #{session.session_number}
            </h3>
            <p className="text-xs text-gray-500">
              Conducted on {new Date(session.session_date).toLocaleDateString('en-IN')} by {session.doctor_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Existing Session Summary Card */}
        <div className="rounded-lg bg-gray-50 p-3 text-xs border border-gray-200 space-y-1">
          <div className="font-semibold text-gray-700">Original Clinical Notes:</div>
          <p className="text-gray-800 italic">{session.clinical_notes}</p>
          <div className="text-[11px] text-gray-500 pt-1">
            VAS Score: {session.vas_score}/10 · Modalities: {session.modalities.join(', ') || 'None'}
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="addendum-text" className="block text-xs font-semibold text-gray-700 mb-1">
              Addendum Observation or Correction (सुधार अथवा अतिरिक्त टिप्पणी) *
            </label>
            <textarea
              id="addendum-text"
              rows={4}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Record retrospective clinical remarks, patient feedback reported later, or protocol adjustment..."
              className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-amber-600 focus:ring-1 focus:ring-amber-600"
            />
          </div>

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
              disabled={addAddendumMutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg shadow transition disabled:opacity-50"
            >
              {addAddendumMutation.isPending ? 'Appending...' : '+ Append Dated Addendum'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
