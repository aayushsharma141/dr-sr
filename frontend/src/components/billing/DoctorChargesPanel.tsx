import { useState, type FormEvent } from 'react'
import {
  useAddDoctorCharge,
  useAdjustOwnFee,
  useDoctorCharges,
  type BillLineOut,
} from '../../api/doctorCharges'
import { usePatientTreatmentPlans } from '../../api/queries'
import { formatIst, formatPaise } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'

export interface DoctorChargesPanelProps {
  appointmentId: number | null | undefined
  patientId?: number | null
  isVisitClosed?: boolean
  embedded?: boolean
}

export function DoctorChargesPanel({
  appointmentId,
  patientId,
  isVisitClosed = false,
  embedded = false,
}: DoctorChargesPanelProps) {
  const { data, isPending, isError, error } = useDoctorCharges(appointmentId)

  // Modals state
  const [isAdjustOpen, setIsAdjustOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)

  // Fee Adjustment form state
  const [adjustKind, setAdjustKind] = useState<'DISCOUNT' | 'WAIVER'>('DISCOUNT')
  const [adjustAmountRupees, setAdjustAmountRupees] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustError, setAdjustError] = useState<string | null>(null)

  // Add Charge form state
  const [addCategory, setAddCategory] = useState<'PROCEDURE' | 'PACKAGE'>('PROCEDURE')
  const [procDesc, setProcDesc] = useState('')
  const [procQty, setProcQty] = useState('1')
  const [procUnit, setProcUnit] = useState('')
  const [procRateRupees, setProcRateRupees] = useState('')
  const [packagePlanId, setPackagePlanId] = useState<string>('')
  const [addError, setAddError] = useState<string | null>(null)

  // Treatment plans for Package mode
  const effectivePatientId = patientId ?? 0
  const { data: treatmentPlans } = usePatientTreatmentPlans(effectivePatientId)

  // Mutations
  const adjustMutation = useAdjustOwnFee(appointmentId ?? 0)
  const addMutation = useAddDoctorCharge(appointmentId ?? 0)

  if (!appointmentId) {
    return null
  }

  const consultationLine = data?.consultation_line
  const doctorLines = (data?.doctor_lines ?? []).filter((line) => line.status !== 'VOIDED')

  // Check if consultation fee is waived
  const isWaived =
    consultationLine != null &&
    (consultationLine.amount_paise === 0 ||
      (consultationLine.history.length > 0 &&
        consultationLine.history[consultationLine.history.length - 1].kind === 'WAIVER'))

  // Latest fee adjustment history for S6 copy
  const latestAdjustment =
    consultationLine && consultationLine.history && consultationLine.history.length > 0
      ? consultationLine.history[consultationLine.history.length - 1]
      : null

  // Open Adjust Modal
  const handleOpenAdjust = () => {
    setAdjustKind('DISCOUNT')
    setAdjustAmountRupees('')
    setAdjustReason('')
    setAdjustError(null)
    setIsAdjustOpen(true)
  }

  // Open Add Modal
  const handleOpenAdd = () => {
    setAddCategory('PROCEDURE')
    setProcDesc('')
    setProcQty('1')
    setProcUnit('')
    setProcRateRupees('')
    setPackagePlanId('')
    setAddError(null)
    setIsAddOpen(true)
  }

  // Submit Fee Adjustment
  const handleAdjustSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAdjustError(null)

    const trimmedReason = adjustReason.trim()
    if (trimmedReason.length < 3 || adjustReason.length > 500) {
      setAdjustError('Reason must be between 3 and 500 characters.')
      return
    }

    let newPaise = 0
    if (adjustKind === 'DISCOUNT') {
      const parsedRupees = Number(adjustAmountRupees.trim())
      if (isNaN(parsedRupees) || parsedRupees < 0) {
        setAdjustError('Please enter a valid reduced amount.')
        return
      }
      newPaise = Math.round(parsedRupees * 100)
      if (consultationLine && newPaise >= consultationLine.amount_paise) {
        setAdjustError('Discounted fee must be lower than the current fee.')
        return
      }
    } else {
      newPaise = 0
    }

    try {
      await adjustMutation.mutateAsync({
        kind: adjustKind,
        new_amount_paise: newPaise,
        reason: trimmedReason,
      })
      toast.success(adjustKind === 'WAIVER' ? 'Consultation fee waived.' : 'Consultation fee adjusted.')
      setIsAdjustOpen(false)
    } catch (err: any) {
      setAdjustError(err.message || 'Failed to adjust fee.')
    }
  }

  // Submit Add Charge
  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAddError(null)

    if (addCategory === 'PROCEDURE') {
      const trimmedDesc = procDesc.trim()
      if (!trimmedDesc) {
        setAddError('Description is required.')
        return
      }
      const qtyNum = Number(procQty.trim())
      if (isNaN(qtyNum) || qtyNum <= 0) {
        setAddError('Quantity must be greater than zero.')
        return
      }
      const rateNum = Number(procRateRupees.trim())
      if (isNaN(rateNum) || rateNum < 0) {
        setAddError('Rate must be zero or greater.')
        return
      }
      const ratePaise = Math.round(rateNum * 100)

      try {
        await addMutation.mutateAsync({
          category: 'PROCEDURE',
          description: trimmedDesc,
          quantity: procQty.trim(),
          rate_paise: ratePaise,
          unit: procUnit.trim() || null,
        })
        toast.success(`Added charge: ${trimmedDesc}.`)
        setIsAddOpen(false)
      } catch (err: any) {
        setAddError(err.message || 'Failed to add charge.')
      }
    } else if (addCategory === 'PACKAGE') {
      const planId = Number(packagePlanId)
      if (!planId) {
        setAddError('Please select a treatment plan.')
        return
      }
      try {
        await addMutation.mutateAsync({
          category: 'PACKAGE',
          treatment_plan_id: planId,
        })
        toast.success('Treatment package linked to consultation.')
        setIsAddOpen(false)
      } catch (err: any) {
        setAddError(err.message || 'Failed to link package.')
      }
    }
  }

  // Preview for Procedure add modal
  const previewQty = Number(procQty) || 0
  const previewRate = Number(procRateRupees) || 0
  const previewAmount = (previewQty * previewRate).toFixed(2)

  // Reason validation for adjust fee
  const isReasonValid = adjustReason.trim().length >= 3 && adjustReason.length <= 500
  const isAdjustValid =
    isReasonValid &&
    (adjustKind === 'WAIVER' ||
      (adjustAmountRupees.trim() !== '' &&
        !isNaN(Number(adjustAmountRupees)) &&
        Number(adjustAmountRupees) >= 0 &&
        (consultationLine == null || Math.round(Number(adjustAmountRupees) * 100) < consultationLine.amount_paise)))

  return (
    <div
      data-testid="doctor-charges-panel"
      className={embedded ? 'p-4' : 'rounded-xl border border-slate-200 bg-white p-4 shadow-xs'}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-sm font-semibold text-slate-900">Charges</h2>
        {!isVisitClosed && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenAdjust}
              disabled={!consultationLine}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-500"
            >
              Adjust fee
            </button>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="rounded-lg bg-[#8E1C3D] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#731732]"
            >
              Add charge
            </button>
          </div>
        )}
      </div>

      {isPending && (
        <div className="py-4 text-center text-xs text-slate-500">Loading charges...</div>
      )}

      {isError && (
        <div className="py-2">
          <InlineAlert tone="error">
            {error instanceof Error ? error.message : 'Could not load charges.'}
          </InlineAlert>
        </div>
      )}

      {!isPending && !isError && (
        <div className="mt-3 space-y-4">
          {/* Consultation Fee Line */}
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-800">
                {consultationLine?.description || 'OPD Consultation'}
              </span>
              <div className="flex items-center gap-2">
                {isWaived && (
                  <span className="inline-flex items-center rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                    Waived
                  </span>
                )}
                <span className="font-semibold tabular-nums text-slate-900">
                  {consultationLine
                    ? `${formatPaise(consultationLine.amount_paise)}, billed at check-in`
                    : '—'}
                </span>
              </div>
            </div>

            {/* S6 copy: Original ₹X → Revised ₹Y · {reason} · {you} · {time} */}
            {latestAdjustment && (
              <p className="mt-1 text-xs text-slate-500">
                Original {formatPaise(latestAdjustment.old_amount_paise)} → Revised{' '}
                {formatPaise(latestAdjustment.new_amount_paise)} · {latestAdjustment.reason} ·{' '}
                {latestAdjustment.actor_username || latestAdjustment.actor || 'Doctor'} ·{' '}
                {formatIst(latestAdjustment.created_at)}
              </p>
            )}
          </div>

          {/* Doctor Lines: Procedures & Packages */}
          <div className="border-t border-slate-100 pt-3">
            <h3 className="text-xs font-semibold text-slate-500">
              Procedures & Packages
            </h3>

            {doctorLines.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No charges added for this consultation yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {doctorLines.map((line: BillLineOut) => (
                  <li key={line.id} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{line.description}</p>
                        {line.category === 'PACKAGE' ? (
                          <p className="text-xs text-slate-500">Package (information only)</p>
                        ) : (
                          <p className="text-xs text-slate-500">
                            {Number(line.quantity)} × {formatPaise(line.rate_paise)} ={' '}
                            {formatPaise(line.amount_paise)}
                          </p>
                        )}
                      </div>
                      <span className="inline-flex shrink-0 items-center rounded-sm bg-[#E0E7FF] px-2 py-0.5 text-xs font-semibold text-[#1E1B4B]">
                        Doctor
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Adjust Fee Modal */}
      <Modal
        open={isAdjustOpen}
        onClose={() => setIsAdjustOpen(false)}
        title="Adjust Consultation Fee"
        description="Discount or waive the fee of this consultation. A reason is required."
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4">
          {adjustError && (
            <InlineAlert tone="error" onDismiss={() => setAdjustError(null)}>
              {adjustError}
            </InlineAlert>
          )}

          {/* Type: Discount or Waive */}
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Adjustment Type
            </label>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="adjustKind"
                  value="DISCOUNT"
                  checked={adjustKind === 'DISCOUNT'}
                  onChange={() => setAdjustKind('DISCOUNT')}
                  className="accent-[#8E1C3D]"
                />
                Discount
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="adjustKind"
                  value="WAIVER"
                  checked={adjustKind === 'WAIVER'}
                  onChange={() => setAdjustKind('WAIVER')}
                  className="accent-[#8E1C3D]"
                />
                Waive
              </label>
            </div>
          </div>

          {/* Amount input for Discount */}
          {adjustKind === 'DISCOUNT' ? (
            <div>
              <label
                htmlFor="adjustAmount"
                className="block text-xs font-semibold text-slate-700"
              >
                Revised fee (₹) *
              </label>
              <input
                id="adjustAmount"
                type="number"
                step="0.01"
                min="0"
                value={adjustAmountRupees}
                onChange={(e) => setAdjustAmountRupees(e.target.value)}
                placeholder="e.g. 300"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] focus:outline-hidden"
              />
              {consultationLine && (
                <p className="mt-1 text-xs text-slate-500">
                  Current fee: {formatPaise(consultationLine.amount_paise)}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              Fee will be set to <span className="font-semibold text-slate-900">₹0.00</span> (100%
              waiver).
            </div>
          )}

          {/* Reason input with character counter */}
          <div>
            <div className="flex justify-between">
              <label
                htmlFor="adjustReason"
                className="block text-xs font-semibold text-slate-700"
              >
                Reason (3-500 characters) *
              </label>
              <span className="text-xs text-slate-500">{adjustReason.length} / 500</span>
            </div>
            <textarea
              id="adjustReason"
              rows={3}
              maxLength={500}
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="e.g. Follow-up review within 7 days, senior citizen discretionary discount..."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] focus:outline-hidden"
            />
          </div>

          {/* Modal Actions */}
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setIsAdjustOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isAdjustValid || adjustMutation.isPending}
              className="rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#731732] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {adjustMutation.isPending
                ? 'Adjusting...'
                : adjustKind === 'WAIVER'
                  ? 'Confirm fee waiver'
                  : 'Confirm fee discount'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Charge Modal */}
      <Modal
        open={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Add Charge"
        description="Add a procedure/service or link a treatment package to this consultation."
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          {addError && (
            <InlineAlert tone="error" onDismiss={() => setAddError(null)}>
              {addError}
            </InlineAlert>
          )}

          {/* Category selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Charge Type
            </label>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="addCategory"
                  value="PROCEDURE"
                  checked={addCategory === 'PROCEDURE'}
                  onChange={() => setAddCategory('PROCEDURE')}
                  className="accent-[#8E1C3D]"
                />
                Procedure / Service
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="addCategory"
                  value="PACKAGE"
                  checked={addCategory === 'PACKAGE'}
                  onChange={() => setAddCategory('PACKAGE')}
                  className="accent-[#8E1C3D]"
                />
                Package
              </label>
            </div>
          </div>

          {addCategory === 'PROCEDURE' ? (
            <>
              {/* Description */}
              <div>
                <label
                  htmlFor="procDesc"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Description *
                </label>
                <input
                  id="procDesc"
                  type="text"
                  maxLength={200}
                  value={procDesc}
                  onChange={(e) => setProcDesc(e.target.value)}
                  placeholder="e.g. Ultrasound therapy, Wound dressing..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] focus:outline-hidden"
                />
              </div>

              {/* Quantity & Unit */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="procQty"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Quantity *
                  </label>
                  <input
                    id="procQty"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={procQty}
                    onChange={(e) => setProcQty(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] focus:outline-hidden"
                  />
                </div>
                <div>
                  <label
                    htmlFor="procUnit"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Unit (optional)
                  </label>
                  <input
                    id="procUnit"
                    type="text"
                    maxLength={32}
                    value={procUnit}
                    onChange={(e) => setProcUnit(e.target.value)}
                    placeholder="e.g. session, injection"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Rate in ₹ */}
              <div>
                <label
                  htmlFor="procRate"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Rate (₹) *
                </label>
                <input
                  id="procRate"
                  type="number"
                  step="0.01"
                  min="0"
                  value={procRateRupees}
                  onChange={(e) => setProcRateRupees(e.target.value)}
                  placeholder="e.g. 350"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] focus:outline-hidden"
                />
              </div>

              {/* Preview */}
              <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Preview: </span>
                {previewQty} × ₹{previewRate.toFixed(2)} = ₹{previewAmount}
              </div>
            </>
          ) : (
            <>
              {/* Package mode: select patient treatment plan */}
              <div>
                <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
                  <span className="font-semibold">Package (information only).</span> No amount is
                  charged here; sessions are tracked on the treatment plan.
                </div>

                <div className="mt-3">
                  <label
                    htmlFor="packageSelect"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Treatment Plan *
                  </label>
                  {treatmentPlans && treatmentPlans.length > 0 ? (
                    <select
                      id="packageSelect"
                      value={packagePlanId}
                      onChange={(e) => setPackagePlanId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] focus:outline-hidden"
                    >
                      <option value="">Select a treatment plan...</option>
                      {treatmentPlans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.plan_name} ({plan.total_sessions} sessions)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      No treatment plans found for this patient.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Modal Actions */}
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                addMutation.isPending ||
                (addCategory === 'PROCEDURE' &&
                  (!procDesc.trim() || Number(procQty) <= 0 || Number(procRateRupees) < 0 || procRateRupees.trim() === '')) ||
                (addCategory === 'PACKAGE' && !packagePlanId)
              }
              className="rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#731732] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {addMutation.isPending ? 'Saving...' : 'Save charge'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
