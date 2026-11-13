import React, { useState } from 'react'
import type { PatientOut, AdminPatientDemographicCorrection } from '../../api/types'
import { Modal } from '../Modal'

export interface DemographicCorrectionModalProps {
  open: boolean
  patient: PatientOut
  proposed: Omit<AdminPatientDemographicCorrection, 'reason' | 'version_id'>
  onConfirm: (reason: string) => Promise<void> | void
  onClose: () => void
  isSubmitting?: boolean
}

interface DiffField {
  label: string
  key: keyof Omit<AdminPatientDemographicCorrection, 'reason' | 'version_id'>
  currentVal: string
  proposedVal: string
  isChanged: boolean
}

export const DemographicCorrectionModal: React.FC<DemographicCorrectionModalProps> = ({
  open,
  patient,
  proposed,
  onConfirm,
  onClose,
  isSubmitting = false,
}) => {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const formatGender = (g: string) => (g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Other')

  const diffFields: DiffField[] = [
    {
      label: 'Full Name',
      key: 'full_name',
      currentVal: patient.full_name,
      proposedVal: proposed.full_name,
      isChanged: patient.full_name !== proposed.full_name,
    },
    {
      label: 'Guardian Name',
      key: 'guardian_name',
      currentVal: patient.guardian_name,
      proposedVal: proposed.guardian_name,
      isChanged: patient.guardian_name !== proposed.guardian_name,
    },
    {
      label: 'Gender',
      key: 'gender',
      currentVal: formatGender(patient.gender),
      proposedVal: formatGender(proposed.gender),
      isChanged: patient.gender !== proposed.gender,
    },
    {
      label: 'Date of Birth',
      key: 'dob',
      currentVal: patient.dob || '—',
      proposedVal: proposed.dob || '—',
      isChanged: (patient.dob || null) !== (proposed.dob || null),
    },
    {
      label: 'Age (Years)',
      key: 'age_years',
      currentVal: `${patient.age_years}`,
      proposedVal: `${proposed.age_years}`,
      isChanged: patient.age_years !== proposed.age_years,
    },
    {
      label: 'Mobile Number',
      key: 'mobile',
      currentVal: patient.mobile,
      proposedVal: proposed.mobile,
      isChanged: patient.mobile !== proposed.mobile,
    },
    {
      label: 'Address',
      key: 'address',
      currentVal: patient.address,
      proposedVal: proposed.address,
      isChanged: patient.address !== proposed.address,
    },
    {
      label: 'District',
      key: 'district',
      currentVal: patient.district,
      proposedVal: proposed.district,
      isChanged: patient.district !== proposed.district,
    },
    {
      label: 'State',
      key: 'state',
      currentVal: patient.state,
      proposedVal: proposed.state,
      isChanged: patient.state !== proposed.state,
    },
    {
      label: 'Emergency Contact',
      key: 'emergency_contact',
      currentVal: patient.emergency_contact || '—',
      proposedVal: proposed.emergency_contact || '—',
      isChanged: (patient.emergency_contact || null) !== (proposed.emergency_contact || null),
    },
  ]

  const hasModifications = diffFields.some((f) => f.isChanged)

  const handleApplyClick = () => {
    const trimmed = reason.trim()
    if (trimmed.length < 5) {
      setReasonError('Demographic correction requires a documented reason of at least 5 characters.')
      return
    }
    setReasonError(null)
    setShowConfirmDialog(true)
  }

  const handleFinalConfirm = async () => {
    await onConfirm(reason.trim())
    setShowConfirmDialog(false)
  }

  const handleClose = () => {
    if (isSubmitting) return
    setShowConfirmDialog(false)
    setReasonError(null)
    onClose()
  }

  return (
    <>
      <Modal
        open={open && !showConfirmDialog}
        onClose={handleClose}
        title="Review Demographic Correction"
        variant="warning"
        className="max-w-3xl"
        busy={isSubmitting}
      >
        <div className="space-y-4 text-slate-800">
          {/* Explanatory callout */}
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
            <div className="flex items-start gap-2">
              <span className="font-bold text-amber-800 text-sm">ℹ️</span>
              <p className="leading-relaxed font-medium">
                Demographic corrections update future patient documents, but historical printouts retain their issued details.
              </p>
            </div>
          </div>

          {/* Patient identification header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 text-xs">
            <div>
              <span className="text-slate-600">Patient:</span>{' '}
              <span className="font-bold text-slate-900">{patient.full_name}</span>
            </div>
            <div>
              <span className="text-slate-600">URN:</span>{' '}
              <span className="font-mono font-bold text-slate-900">{patient.urn}</span>
              {patient.legacy_urn && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                  Prior: {patient.legacy_urn}
                </span>
              )}
            </div>
          </div>

          {/* Side-by-side Before/After diff table */}
          <div className="max-h-[380px] overflow-y-auto rounded border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 w-1/4">Demographic Field</th>
                  <th className="py-2.5 px-3 w-3/8">Current Stored Record</th>
                  <th className="py-2.5 px-3 w-3/8">Proposed Correction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {diffFields.map((field) => (
                  <tr
                    key={field.key}
                    className={
                      field.isChanged
                        ? 'bg-rose-50/70 border-l-4 border-l-[#8E1C3D]'
                        : 'bg-white hover:bg-slate-50/50'
                    }
                  >
                    <td className="py-2 px-3 font-medium text-slate-700 flex items-center gap-1.5">
                      <span>{field.label}</span>
                      {field.isChanged && (
                        <span className="inline-block rounded border border-[#8E1C3D] bg-[#8E1C3D]/10 px-1.5 py-0.2 text-xs font-bold uppercase tracking-wider text-[#8E1C3D]">
                          Modified
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-600 break-words">
                      {field.currentVal}
                    </td>
                    <td
                      className={`py-2 px-3 break-words ${
                        field.isChanged
                          ? 'font-bold text-[#8E1C3D]'
                          : 'text-slate-800'
                      }`}
                    >
                      {field.proposedVal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!hasModifications && (
            <p className="text-xs text-amber-700 font-medium">
              No demographic values were changed from the stored record.
            </p>
          )}

          {/* Mandatory reason textarea */}
          <div className="space-y-1.5 pt-2">
            <label
              htmlFor="demographic-correction-reason"
              className="block text-xs font-bold text-slate-800"
            >
              Reason for Demographic Correction (Audited) <span className="text-red-700">*</span>
            </label>
            <textarea
              id="demographic-correction-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                if (reasonError && e.target.value.trim().length >= 5) {
                  setReasonError(null)
                }
              }}
              placeholder="Document the exact clinical or administrative reason for this correction (minimum 5 characters)..."
              rows={3}
              className={`w-full min-h-11 rounded-md border px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D] ${
                reasonError ? 'border-red-600 bg-red-50/30' : 'border-slate-300 bg-white'
              }`}
            />
            {reasonError && (
              <p className="text-xs font-semibold text-red-700" role="alert">
                {reasonError}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-500 disabled:opacity-50"
            >
              Cancel Correction Edit
            </button>
            <button
              type="button"
              data-testid="modal-apply-correction-button"
              onClick={handleApplyClick}
              disabled={isSubmitting || !hasModifications}
              className="min-h-11 cursor-pointer rounded-md bg-[#8E1C3D] px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#731631] focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Apply Demographic Correction'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Dialog per UI-SPEC copywriting contract */}
      <Modal
        open={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        title="Confirm Demographic Correction"
        variant="destructive"
        className="max-w-md"
        busy={isSubmitting}
      >
        <div className="space-y-4 text-slate-800">
          <p className="text-sm leading-relaxed text-slate-700">
            Are you sure you want to update the official demographic record for{' '}
            <strong className="text-slate-900">{patient.full_name}</strong> (URN:{' '}
            <strong className="font-mono text-slate-900">{patient.urn}</strong>)? This change will be permanently audited with your documented reason and will update future cards, but historical printouts will retain their issued details. Click &apos;Confirm Demographic Correction&apos; to proceed or &apos;Cancel Correction Edit&apos; to abort.
          </p>

          <div className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs">
            <span className="font-bold text-slate-700">Documented Reason:</span>{' '}
            <span className="italic text-slate-900">&quot;{reason.trim()}&quot;</span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setShowConfirmDialog(false)}
              disabled={isSubmitting}
              className="min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-500 disabled:opacity-50"
            >
              Cancel Correction Edit
            </button>
            <button
              type="button"
              onClick={handleFinalConfirm}
              disabled={isSubmitting}
              className="min-h-11 cursor-pointer rounded-md bg-[#8E1C3D] px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#731631] focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
            >
              {isSubmitting ? 'Applying...' : 'Confirm Demographic Correction'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
