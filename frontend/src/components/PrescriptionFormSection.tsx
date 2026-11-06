import { useState } from 'react'
import { Modal } from './Modal'
import type { PrescriptionItemCreate, PrescriptionOut } from '../api/types'

export interface PrescriptionFormSectionProps {
  prescription: PrescriptionOut | null
  items: PrescriptionItemCreate[]
  diagnosis: string
  dietaryAdvice: string
  generalAdvice: string
  onItemsChange: (items: PrescriptionItemCreate[]) => void
  onDietaryAdviceChange: (val: string) => void
  onGeneralAdviceChange: (val: string) => void
  onAuthorise: () => Promise<void>
  onCancelAndReissue: (reason: string) => Promise<void>
  onBlur?: () => void
  readOnly?: boolean
  isAuthorising?: boolean
  isCancelling?: boolean
}

export function PrescriptionFormSection({
  prescription,
  items,
  diagnosis: _diagnosis,
  dietaryAdvice,
  generalAdvice,
  onItemsChange,
  onDietaryAdviceChange,
  onGeneralAdviceChange,
  onAuthorise,
  onCancelAndReissue,
  onBlur,
  readOnly = false,
  isAuthorising = false,
  isCancelling = false,
}: PrescriptionFormSectionProps) {
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const status = prescription?.status || 'DRAFT'
  const isLocked = status === 'AUTHORISED' || status === 'CANCELLED' || readOnly

  const formOptions = ['Tablet', 'Capsule', 'Eye Drops', 'Eye Ointment', 'Syrup', 'Gel', 'Injection']
  const routeOptions = ['Oral', 'Right Eye (OD)', 'Left Eye (OS)', 'Both Eyes (OU)', 'Topical', 'Inhalation']
  const freqOptions = ['OD', 'BD', 'TDS', 'QID', 'SOS', 'HS']

  const handleAddItem = () => {
    if (isLocked) return
    const newItem: PrescriptionItemCreate = {
      item_order: items.length + 1,
      medicine_name: '',
      dosage: '1 tab',
      frequency: 'BD',
      duration_days: 5,
      strength: '',
      form: 'Tablet',
      route: 'Oral',
      instructions: '',
    }
    onItemsChange([...items, newItem])
  }

  const handleItemChange = (index: number, field: keyof PrescriptionItemCreate, val: any) => {
    if (isLocked) return
    const next = [...items]
    next[index] = {
      ...next[index],
      [field]: val,
    }
    onItemsChange(next)
  }

  const handleRemoveItem = (index: number) => {
    if (isLocked) return
    const next = items
      .filter((_, i) => i !== index)
      .map((it, idx) => ({ ...it, item_order: idx + 1 }))
    onItemsChange(next)
  }

  const handleAuthoriseClick = async () => {
    setValidationError(null)
    if (items.length === 0) {
      setValidationError('At least one medication item is required to authorise a prescription.')
      return
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.medicine_name.trim()) {
        setValidationError(`Medication item #${i + 1} is missing medicine name.`)
        return
      }
      if (!it.dosage.trim()) {
        setValidationError(`Medication item #${i + 1} is missing dosage.`)
        return
      }
      if (!it.frequency.trim()) {
        setValidationError(`Medication item #${i + 1} is missing frequency.`)
        return
      }
      if (!it.duration_days || it.duration_days < 1) {
        setValidationError(`Medication item #${i + 1} must have a duration of at least 1 day.`)
        return
      }
    }
    try {
      await onAuthorise()
    } catch (err: unknown) {
      if (err instanceof Error) {
        setValidationError(err.message)
      } else {
        setValidationError('Failed to authorise prescription.')
      }
    }
  }

  const handleConfirmCancel = async () => {
    setCancelError(null)
    if (!cancelReason.trim() || cancelReason.trim().length < 3) {
      setCancelError('Cancellation explanation must be at least 3 characters.')
      return
    }
    try {
      await onCancelAndReissue(cancelReason.trim())
      setShowCancelModal(false)
      setCancelReason('')
    } catch (err: unknown) {
      if (err instanceof Error) {
        setCancelError(err.message)
      } else {
        setCancelError('Failed to cancel prescription.')
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Header with status pill and CTAs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-neutral-900">
            Prescriptions & Medication Orders
          </h3>
          {status === 'DRAFT' && (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-neutral-200 text-neutral-800">
              DRAFT
            </span>
          )}
          {status === 'AUTHORISED' && (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800 border border-green-300">
              ✓ AUTHORISED (Locked)
            </span>
          )}
          {status === 'CANCELLED' && (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 line-through">
              CANCELLED
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {status === 'DRAFT' && !readOnly && (
            <button
              type="button"
              onClick={handleAuthoriseClick}
              disabled={isAuthorising || items.length === 0}
              className="px-3.5 py-1.5 bg-[#8E1C3D] text-white rounded text-xs font-semibold hover:bg-[#721631] disabled:opacity-50 transition-colors shadow-xs"
            >
              {isAuthorising ? 'Authorising...' : 'Authorise Prescription'}
            </button>
          )}

          {status === 'AUTHORISED' && (
            <>
              {prescription?.id && (
                <a
                  href={`/doctor/prescriptions/${prescription.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 border border-neutral-300 rounded text-xs font-semibold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print Prescription Slip
                </a>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setShowCancelModal(true)}
                  className="px-3 py-1.5 border border-red-300 text-red-700 rounded text-xs font-semibold hover:bg-red-50"
                >
                  Cancel Prescription & Re-issue
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {validationError && (
        <div role="alert" className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-xs font-medium">
          {validationError}
        </div>
      )}

      {/* Cancellation note banner if cancelled */}
      {status === 'CANCELLED' && prescription?.cancellation_reason && (
        <div className="p-3 bg-red-50/60 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
          <div className="font-semibold uppercase tracking-wider">Prescription Cancelled</div>
          <p>Reason: {prescription.cancellation_reason}</p>
        </div>
      )}

      {/* Medication Orders Table */}
      {items.length === 0 ? (
        <div className="p-6 bg-neutral-50 rounded-lg border border-neutral-200 text-center space-y-3">
          <h4 className="text-sm font-semibold text-neutral-800">No Medications Added</h4>
          <p className="text-xs text-neutral-600 max-w-md mx-auto">
            No medications have been prescribed for this consultation. Click &apos;Add Medication Item&apos; to author a prescription, or finalise with clinical advice only.
          </p>
          {!isLocked && (
            <button
              type="button"
              onClick={handleAddItem}
              className="px-4 py-2 bg-neutral-900 text-white rounded text-xs font-semibold hover:bg-neutral-800"
            >
              Add Medication Item
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto border border-neutral-200 rounded-lg">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
              <thead className="bg-[#F1F5F9] font-semibold text-neutral-700 uppercase tracking-wider">
                <tr>
                  <th className="px-2.5 py-2 w-10">#</th>
                  <th className="px-2.5 py-2">Medicine Name</th>
                  <th className="px-2 py-2 w-24">Strength</th>
                  <th className="px-2 py-2 w-28">Form</th>
                  <th className="px-2 py-2 w-28">Route</th>
                  <th className="px-2 py-2 w-24">Dosage</th>
                  <th className="px-2 py-2 w-20">Freq</th>
                  <th className="px-2 py-2 w-16">Days</th>
                  <th className="px-2 py-2">Instructions</th>
                  {!isLocked && <th className="px-2 py-2 w-10 text-center">Act</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white">
                {items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-neutral-50/50">
                    <td className="px-2.5 py-2 font-mono text-neutral-500">{it.item_order}</td>
                    <td className="px-2.5 py-2">
                      <input
                        type="text"
                        aria-label={`Medicine name row ${idx + 1}`}
                        value={it.medicine_name}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'medicine_name', e.target.value)}
                        onBlur={onBlur}
                        placeholder="e.g. Paracetamol"
                        className="w-full px-2 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Strength row ${idx + 1}`}
                        value={it.strength ?? ''}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'strength', e.target.value)}
                        onBlur={onBlur}
                        placeholder="500mg"
                        className="w-full px-2 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Form row ${idx + 1}`}
                        value={it.form ?? 'Tablet'}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'form', e.target.value)}
                        onBlur={onBlur}
                        className="w-full px-1.5 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      >
                        {formOptions.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Route row ${idx + 1}`}
                        value={it.route ?? 'Oral'}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'route', e.target.value)}
                        onBlur={onBlur}
                        className="w-full px-1.5 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      >
                        {routeOptions.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Dosage row ${idx + 1}`}
                        value={it.dosage}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'dosage', e.target.value)}
                        onBlur={onBlur}
                        placeholder="1 tab"
                        className="w-full px-2 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Frequency row ${idx + 1}`}
                        value={it.frequency}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'frequency', e.target.value)}
                        onBlur={onBlur}
                        className="w-full px-1 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      >
                        {freqOptions.map((freq) => (
                          <option key={freq} value={freq}>{freq}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        aria-label={`Duration days row ${idx + 1}`}
                        value={it.duration_days}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'duration_days', Number(e.target.value))}
                        onBlur={onBlur}
                        className="w-full px-1.5 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Instructions row ${idx + 1}`}
                        value={it.instructions ?? ''}
                        disabled={isLocked}
                        onChange={(e) => handleItemChange(idx, 'instructions', e.target.value)}
                        onBlur={onBlur}
                        placeholder="After food"
                        className="w-full px-2 py-1 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
                      />
                    </td>
                    {!isLocked && (
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          aria-label={`Remove item #${it.item_order}`}
                          className="text-red-600 hover:text-red-800 font-bold text-sm"
                        >
                          &times;
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isLocked && (
            <button
              type="button"
              onClick={handleAddItem}
              className="px-3 py-1.5 border border-dashed border-neutral-300 rounded text-xs font-semibold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1.5"
            >
              + Add Medication Item
            </button>
          )}
        </div>
      )}

      {/* Advice notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        <div>
          <label htmlFor="rx-dietary-advice" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1">
            Dietary Advice
          </label>
          <textarea
            id="rx-dietary-advice"
            rows={2}
            value={dietaryAdvice}
            disabled={isLocked}
            onChange={(e) => onDietaryAdviceChange(e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. Avoid sour foods, drink warm water"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        <div>
          <label htmlFor="rx-general-advice" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1">
            General Clinical Advice
          </label>
          <textarea
            id="rx-general-advice"
            rows={2}
            value={generalAdvice}
            disabled={isLocked}
            onChange={(e) => onGeneralAdviceChange(e.target.value)}
            onBlur={onBlur}
            placeholder="e.g. Ergonomic chair setup, back support belt"
            className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>
      </div>

      {/* Cancel Prescription Confirmation Modal */}
      {showCancelModal && (
        <Modal
          open
          variant="destructive"
          title={`Cancel Prescription #${prescription?.id}?`}
          onClose={() => {
            setShowCancelModal(false)
            setCancelReason('')
            setCancelError(null)
          }}
          busy={isCancelling}
          className="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-xs text-neutral-600 leading-relaxed">
              Are you sure you want to cancel Prescription #{prescription?.id}? This action cannot be undone and requires entering an explanation of at least 3 characters. Click &apos;Confirm Prescription Cancellation&apos; to proceed or &apos;Keep Existing Prescription&apos; to abort.
            </p>

            <div>
              <label htmlFor="cancel-reason-input" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1">
                Cancellation Reason <span className="text-red-600">*</span>
              </label>
              <textarea
                id="cancel-reason-input"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Medication dosage change required due to adverse drug reaction"
                className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-red-800"
              />
              {cancelError && (
                <p role="alert" className="text-xs text-red-600 mt-1 font-medium">{cancelError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowCancelModal(false)
                  setCancelReason('')
                  setCancelError(null)
                }}
                className="px-3 py-1.5 border border-neutral-300 rounded text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Keep Existing Prescription
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
                className="px-3.5 py-1.5 bg-[#B91C1C] text-white rounded text-xs font-semibold hover:bg-red-800 disabled:opacity-50"
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Prescription Cancellation'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
