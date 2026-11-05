import { useState, useId } from 'react'
import { useSearchParams, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PrescriptionPrint } from '../components/PrescriptionPrint'
import {
  usePatient,
  usePatientPrescriptions,
  usePrescription,
  useCreatePrescription,
  useMe,
} from '../api/queries'
import type { PrescriptionItemCreate, PrescriptionOut } from '../api/types'

const FREQUENCY_PRESETS = ['1-0-1', '1-0-0', '0-0-1', '1-1-1', '0-1-0', 'SOS']

interface EditableItem extends PrescriptionItemCreate {
  tempId: string
}

export function PrescriptionWorkspace() {
  const [searchParams] = useSearchParams()
  const baseId = useId()
  const paramPatientId = searchParams.get('patient_id')
    ? Number(searchParams.get('patient_id'))
    : null
  const paramEncounterId = searchParams.get('encounter_id')
    ? Number(searchParams.get('encounter_id'))
    : null

  const patientId = paramPatientId || 0
  const { data: me } = useMe()
  const { data: patient } = usePatient(patientId)
  const { data: pastPrescriptions, refetch: refetchPast } = usePatientPrescriptions(patientId)
  const createPrescriptionMutation = useCreatePrescription()

  // Form State
  const [diagnosis, setDiagnosis] = useState('')
  const [dietaryAdvice, setDietaryAdvice] = useState('')
  const [generalAdvice, setGeneralAdvice] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [items, setItems] = useState<EditableItem[]>([
    {
      tempId: 'item-1',
      item_order: 1,
      medicine_name: '',
      dosage: '',
      frequency: '1-0-1',
      duration_days: 5,
      instructions: 'After meals',
    },
  ])

  // UI States
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)
  const [activePrintRx, setActivePrintRx] = useState<PrescriptionOut | null>(null)
  const [viewHistoryRxId, setViewHistoryRxId] = useState<number | null>(null)

  // Query for historical prescription viewing
  const { data: historicalRx } = usePrescription(viewHistoryRxId || 0)

  const handleAddItem = () => {
    const nextOrder = items.length + 1
    setItems((prev) => [
      ...prev,
      {
        tempId: `${baseId}-item-${Date.now()}`,
        item_order: nextOrder,
        medicine_name: '',
        dosage: '',
        frequency: '1-0-1',
        duration_days: 5,
        instructions: 'After meals',
      },
    ])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    const updated = items.filter((_, idx) => idx !== index)
    // Re-index item_order to guarantee continuous 1..N sequence
    const reindexed = updated.map((it, idx) => ({ ...it, item_order: idx + 1 }))
    setItems(reindexed)
  }

  const handleItemChange = (index: number, field: keyof PrescriptionItemCreate, value: any) => {
    setItems((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorBanner(null)
    setSuccessBanner(null)

    if (!patientId) {
      setErrorBanner('Please select or specify a valid patient.')
      return
    }

    if (!diagnosis.trim()) {
      setErrorBanner('Diagnosis is mandatory.')
      return
    }

    // Validate medication lines
    for (const item of items) {
      if (!item.medicine_name.trim()) {
        setErrorBanner(`Item #${item.item_order}: Medicine name cannot be empty.`)
        return
      }
      if (!item.dosage.trim()) {
        setErrorBanner(`Item #${item.item_order}: Dosage is required.`)
        return
      }
      if (item.duration_days < 1 || item.duration_days > 365) {
        setErrorBanner(`Item #${item.item_order}: Duration must be between 1 and 365 days.`)
        return
      }
    }

    const payload = {
      patient_id: patientId,
      encounter_id: paramEncounterId,
      diagnosis: diagnosis.trim(),
      dietary_advice: dietaryAdvice.trim() || null,
      general_advice: generalAdvice.trim() || null,
      follow_up_date: followUpDate || null,
      items: items.map((it) => ({
        item_order: it.item_order,
        medicine_name: it.medicine_name.trim(),
        dosage: it.dosage.trim(),
        frequency: it.frequency.trim(),
        duration_days: Number(it.duration_days),
        instructions: it.instructions?.trim() || null,
      })),
    }

    try {
      const result = await createPrescriptionMutation.mutateAsync(payload)
      setSuccessBanner('Prescription issued successfully!')
      setActivePrintRx(result)
      refetchPast()
      // Reset form
      setDiagnosis('')
      setDietaryAdvice('')
      setGeneralAdvice('')
      setFollowUpDate('')
      setItems([
        {
          tempId: 'item-1',
          item_order: 1,
          medicine_name: '',
          dosage: '',
          frequency: '1-0-1',
          duration_days: 5,
          instructions: 'After meals',
        },
      ])
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to issue prescription.')
    }
  }

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      {/* Printable slip modal */}
      {activePrintRx && (
        <PrescriptionPrint
          prescription={activePrintRx}
          onClose={() => setActivePrintRx(null)}
        />
      )}

      {/* Historical prescription print modal */}
      {historicalRx && (
        <PrescriptionPrint
          prescription={historicalRx}
          onClose={() => setViewHistoryRxId(null)}
        />
      )}

      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Navigation & Patient Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3">
            <Link
              to="/doctor"
              className="text-sm font-medium text-teal-700 hover:text-teal-900 flex items-center gap-1"
            >
              ← Back to Queue
            </Link>
            <span className="text-gray-600">|</span>
            <span className="text-sm font-semibold text-gray-700">Patient:</span>
            {patient ? (
              <span className="font-bold text-gray-900">
                {patient.full_name} ({patient.urn}) · {patient.age_years}y / {patient.gender}
              </span>
            ) : (
              <span className="text-sm text-gray-500 italic">No patient selected</span>
            )}
          </div>

          {paramEncounterId && (
            <span className="text-xs bg-teal-50 text-teal-800 font-medium px-2.5 py-1 rounded-full border border-teal-200">
              Linked to Encounter #{paramEncounterId}
            </span>
          )}
        </div>

        {/* Notifications */}
        {errorBanner && (
          <div role="alert" className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
            {errorBanner}
          </div>
        )}
        {successBanner && (
          <div role="status" className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex justify-between items-center">
            <span>{successBanner}</span>
            <button
              type="button"
              onClick={() => setActivePrintRx(activePrintRx)}
              className="underline font-semibold hover:text-emerald-950"
            >
              Print Slip Again
            </button>
          </div>
        )}

        {/* Prescription Authoring Form */}
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-6">
          <div className="border-b border-gray-200 pb-3 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span className="text-teal-700 font-serif font-black text-xl">℞</span> New Prescription
            </h2>
            <span className="text-xs text-gray-500 font-medium">Step-by-step medication builder</span>
          </div>

          {/* Clinical Diagnosis */}
          <div>
            <label htmlFor="rx-diagnosis" className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
              Diagnosis (निदान) *
            </label>
            <input
              id="rx-diagnosis"
              type="text"
              required
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Lumbar Canal Stenosis with Radiculopathy"
              className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            />
          </div>

          {/* Medications Table */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                Prescribed Medications (औषधियां)
              </span>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-semibold bg-teal-50 text-teal-800 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200 transition"
              >
                + Add Medication (+ दवा जोड़ें)
              </button>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-left text-sm divide-y divide-gray-200">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-3 min-w-[200px]">Medicine Name *</th>
                    <th className="py-2.5 px-3 w-32">Dosage *</th>
                    <th className="py-2.5 px-3 w-36">Frequency</th>
                    <th className="py-2.5 px-3 w-28">Days *</th>
                    <th className="py-2.5 px-3">Instructions</th>
                    <th className="py-2.5 px-2 w-12 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {items.map((item, index) => (
                    <tr key={item.tempId} className="hover:bg-gray-50/50">
                      <td className="py-2 px-3 text-center font-mono text-gray-500 text-xs">
                        {item.item_order}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          required
                          aria-label={`Medicine name, row ${index + 1}`}
                          value={item.medicine_name}
                          onChange={(e) => handleItemChange(index, 'medicine_name', e.target.value)}
                          placeholder="e.g. Tab Pregabalin"
                          className="w-full rounded border border-gray-300 p-1.5 text-xs focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          required
                          aria-label={`Dosage, row ${index + 1}`}
                          value={item.dosage}
                          onChange={(e) => handleItemChange(index, 'dosage', e.target.value)}
                          placeholder="75 mg"
                          className="w-full rounded border border-gray-300 p-1.5 text-xs focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select
                          aria-label={`Frequency, row ${index + 1}`}
                          value={item.frequency}
                          onChange={(e) => handleItemChange(index, 'frequency', e.target.value)}
                          className="w-full rounded border border-gray-300 p-1.5 text-xs focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                        >
                          {FREQUENCY_PRESETS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          required
                          min={1}
                          max={365}
                          aria-label={`Days, row ${index + 1}`}
                          value={item.duration_days}
                          onChange={(e) => handleItemChange(index, 'duration_days', Number(e.target.value))}
                          className="w-full rounded border border-gray-300 p-1.5 text-xs focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          aria-label={`Instructions, row ${index + 1}`}
                          value={item.instructions || ''}
                          onChange={(e) => handleItemChange(index, 'instructions', e.target.value)}
                          placeholder="After food, at bedtime"
                          className="w-full rounded border border-gray-300 p-1.5 text-xs focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                        />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          disabled={items.length <= 1}
                          className="text-red-600 hover:text-red-700 disabled:opacity-30 text-base"
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Advice & Instructions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rx-general-advice" className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                General Advice (सामान्य सलाह)
              </label>
              <textarea
                id="rx-general-advice"
                rows={3}
                value={generalAdvice}
                onChange={(e) => setGeneralAdvice(e.target.value)}
                placeholder="Ergonomic posture, core stabilization exercises, avoid forward bending..."
                className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              />
            </div>

            <div>
              <label htmlFor="rx-dietary-advice" className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                Dietary Guidance (आहार संबंधी सलाह)
              </label>
              <textarea
                id="rx-dietary-advice"
                rows={3}
                value={dietaryAdvice}
                onChange={(e) => setDietaryAdvice(e.target.value)}
                placeholder="High calcium & protein intake, adequate hydration, avoid excess sodium..."
                className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              />
            </div>
          </div>

          {/* Follow-up date */}
          <div className="w-full md:w-64">
            <label htmlFor="rx-follow-up-date" className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
              Follow-up Consultation Date
            </label>
            <input
              id="rx-follow-up-date"
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
            />
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setDiagnosis('')
                setDietaryAdvice('')
                setGeneralAdvice('')
                setFollowUpDate('')
              }}
              className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition"
            >
              Clear Form
            </button>
            <button
              type="submit"
              disabled={createPrescriptionMutation.isPending}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow transition disabled:opacity-50"
            >
              {createPrescriptionMutation.isPending ? 'Saving...' : 'Issue Prescription (प्रिस्क्रिप्शन जारी करें)'}
            </button>
          </div>
        </form>

        {/* Historical Prescriptions for Patient */}
        {pastPrescriptions && pastPrescriptions.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">
              Previous Prescriptions for this Patient ({pastPrescriptions.length})
            </h3>
            <div className="divide-y divide-gray-200">
              {pastPrescriptions.map((rx) => (
                <div key={rx.id} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">
                      {rx.diagnosis} · <span className="text-gray-500 font-normal">{rx.items_count} medications</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Prescribed by {rx.doctor_name} on {new Date(rx.created_at).toLocaleDateString('en-IN')}
                      {rx.follow_up_date && ` · Next review: ${new Date(rx.follow_up_date).toLocaleDateString('en-IN')}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewHistoryRxId(rx.id)}
                    className="text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded transition"
                  >
                    View / Print Slip
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
