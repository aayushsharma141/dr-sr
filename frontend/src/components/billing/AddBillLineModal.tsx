import { useEffect, useState, type FormEvent } from 'react'
import { useAddBillLine, usePrescribedMedicines } from '../../api/bill'
import { formatPaise, rupeesToPaise } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'

export interface AddBillLineModalProps {
  open: boolean
  onClose: () => void
  visitId: number
  mode: 'medicine' | 'particular'
}

export function AddBillLineModal({ open, onClose, visitId, mode }: AddBillLineModalProps) {
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('')
  const [quantity, setQuantity] = useState(mode === 'particular' ? '1' : '')
  const [rateRupees, setRateRupees] = useState('')
  const [prescriptionItemId, setPrescriptionItemId] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: prescribedMeds } = usePrescribedMedicines(visitId, open && mode === 'medicine')
  const addBillLineMutation = useAddBillLine(visitId)

  // Reset form when dialog opens fresh
  useEffect(() => {
    if (open) {
      setDescription('')
      setUnit('')
      setQuantity(mode === 'particular' ? '1' : '')
      setRateRupees('')
      setPrescriptionItemId(null)
      setErrorMsg(null)
    }
  }, [open, mode])

  const parsedRatePaise = rupeesToPaise(rateRupees)
  const numQty = Number(quantity.trim())
  const validQty = !isNaN(numQty) && numQty > 0 && /^\d+(\.\d{1,2})?$/.test(quantity.trim())
  const previewPaise = validQty && parsedRatePaise != null ? Math.round(numQty * parsedRatePaise) : null

  const missing: string[] = []
  if (!description.trim()) {
    missing.push(mode === 'medicine' ? 'medicine name' : 'particular name')
  }
  if (!quantity.trim() || !validQty) {
    missing.push('quantity')
  }
  if (!rateRupees.trim() || parsedRatePaise == null) {
    missing.push('rate')
  }

  const handleSelectPrescribed = (med: { prescription_item_id: number; medicine_name: string }) => {
    setDescription(med.medicine_name)
    setPrescriptionItemId(med.prescription_item_id)
    setQuantity('')
  }

  const handleDescriptionChange = (val: string) => {
    setDescription(val)
    if (prescriptionItemId != null) {
      const match = prescribedMeds?.find((m) => m.prescription_item_id === prescriptionItemId)
      if (!match || match.medicine_name.trim().toLowerCase() !== val.trim().toLowerCase()) {
        setPrescriptionItemId(null)
      }
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (missing.length > 0 || parsedRatePaise == null || !validQty) {
      return
    }

    try {
      await addBillLineMutation.mutateAsync({
        category: mode === 'medicine' ? 'MEDICINE' : 'ADDITIONAL',
        description: description.trim(),
        unit: mode === 'medicine' && unit.trim() ? unit.trim() : null,
        quantity: quantity.trim(),
        rate_paise: parsedRatePaise,
        prescription_item_id: mode === 'medicine' ? prescriptionItemId : null,
      })
      onClose()
    } catch (err: unknown) {
      // Keeps typed values in inputs on error so user can retry by hand (CONTEXT adviser rule)
      if (err instanceof Error) {
        setErrorMsg(err.message)
      } else {
        setErrorMsg('Network connection lost. Please verify connection and retry.')
      }
    }
  }

  const title = mode === 'medicine' ? 'Add medicine' : 'Add particular'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      variant="info"
      busy={addBillLineMutation.isPending}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        {errorMsg && (
          <InlineAlert tone="error">
            {errorMsg}
          </InlineAlert>
        )}

        {/* Prescribed reference list for medicine mode (OD-B, B2) */}
        {mode === 'medicine' && prescribedMeds && prescribedMeds.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Prescribed medicines (reference)
            </label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {prescribedMeds.map((med) => {
                const isSelected = prescriptionItemId === med.prescription_item_id
                return (
                  <button
                    key={med.prescription_item_id}
                    type="button"
                    onClick={() => handleSelectPrescribed(med)}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-[#8E1C3D] bg-rose-50 text-[#8E1C3D]'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{med.medicine_name}</span>
                    {med.form && (
                      <span className="rounded bg-slate-100 px-1 py-0.5 text-xs font-normal text-slate-600">
                        {med.form}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Description field */}
        <div className="space-y-1">
          <label htmlFor="bill-line-desc" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            {mode === 'medicine' ? 'Medicine name *' : 'Particular name *'}
          </label>
          <input
            id="bill-line-desc"
            type="text"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder={mode === 'medicine' ? 'e.g. Paracetamol 500mg' : 'e.g. Dressing charge'}
            data-autofocus
            className="w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
          />
          {mode === 'medicine' && prescriptionItemId != null && (
            <p className="text-xs font-semibold text-emerald-700">
              Linked to doctor's prescription
            </p>
          )}
        </div>

        {/* Unit field (medicine mode only) */}
        {mode === 'medicine' && (
          <div className="space-y-1">
            <label htmlFor="bill-line-unit" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Unit (optional)
            </label>
            <input
              id="bill-line-unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. strip, bottle, tab"
              className="w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
            />
          </div>
        )}

        {/* Quantity and Rate row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="bill-line-qty" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Quantity *
            </label>
            <input
              id="bill-line-qty"
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 2"
              className="w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="bill-line-rate" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Rate (₹) *
            </label>
            <input
              id="bill-line-rate"
              type="text"
              inputMode="decimal"
              value={rateRupees}
              onChange={(e) => setRateRupees(e.target.value)}
              placeholder="e.g. 50.00"
              className="w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
            />
          </div>
        </div>

        {/* Live amount preview */}
        {previewPaise != null && parsedRatePaise != null && (
          <div className="rounded-lg bg-slate-50 p-2.5 text-center font-mono text-xs font-bold tabular-nums text-slate-800">
            Preview: {quantity.trim()} × {formatPaise(parsedRatePaise)} = {formatPaise(previewPaise)}
          </div>
        )}

        {/* Submit blocked / Still needed */}
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {missing.length > 0 && (
            <p className="text-xs text-slate-500">Still needed: {missing.join(', ')}.</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={addBillLineMutation.isPending}
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addBillLineMutation.isPending || missing.length > 0}
              className="min-h-11 rounded-lg bg-[#8E1C3D] px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer"
            >
              {addBillLineMutation.isPending ? 'Saving...' : title}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
