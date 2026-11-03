import { useState, useId, useRef } from 'react'
import { useSearchParams, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PrescriptionPrint } from '../components/PrescriptionPrint'
import { UnsavedChangesGuard, hasReportedAllergies } from '../components/UnsavedChangesGuard'
import {
  usePatient,
  usePatientPrescriptions,
  usePrescription,
  useCreatePrescription,
  useMe,
} from '../api/queries'
import type { PrescriptionItemCreate, PrescriptionOut } from '../api/types'

const FREQUENCY_PRESETS = ['1-0-1', '1-0-0', '0-0-1', '1-1-1', '0-1-0', 'SOS']
const FORMULATION_PRESETS = ['Tab.', 'Cap.', 'Syp.', 'Inj.', 'Oint.', 'Drops']
const INSTRUCTION_PRESETS = [
  'After food / भोजन के बाद',
  'Before food / भोजन से पहले',
  'At bedtime / सोते समय',
  'SOS (As needed)',
]

function estimateTotalDoses(frequency: string, days: number): number | null {
  const map: Record<string, number> = {
    '1-0-1': 2,
    '1-0-0': 1,
    '0-0-1': 1,
    '1-1-1': 3,
    '0-1-0': 1,
  }
  const perDay = map[frequency]
  if (!perDay || days <= 0) return null
  return perDay * days
}

function checkAllergyContraindication(
  medicineName: string,
  patientAllergies: string | null | undefined,
): string | null {
  if (!patientAllergies || !hasReportedAllergies(patientAllergies)) return null
  const med = medicineName.trim().toLowerCase()
  if (!med) return null

  const tokens = patientAllergies
    .toLowerCase()
    .split(/[\s,;/+]+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        !['allergy', 'allergic', 'reaction', 'history', 'none', 'reported'].includes(w),
    )

  for (const token of tokens) {
    if (med.includes(token)) {
      return token
    }
  }
  return null
}

interface EditableItem extends PrescriptionItemCreate {
  tempId: string
}

function blankItem(): EditableItem {
  return {
    tempId: 'item-1',
    item_order: 1,
    medicine_name: '',
    dosage: '',
    frequency: '1-0-1',
    duration_days: 5,
    instructions: 'After meals',
  }
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
  const [items, setItems] = useState<EditableItem[]>([blankItem()])
  const issuedRef = useRef(false)

  const dirty =
    Boolean(diagnosis || dietaryAdvice || generalAdvice || followUpDate) ||
    items.some((it) => it.medicine_name.trim() || it.dosage.trim())

  const resetForm = () => {
    setDiagnosis('')
    setDietaryAdvice('')
    setGeneralAdvice('')
    setFollowUpDate('')
    setItems([blankItem()])
  }

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
    if (createPrescriptionMutation.isPending) return
    setErrorBanner(null)
    setSuccessBanner(null)

    if (!patientId) {
      setErrorBanner('Please select or specify a valid patient.')
      return
    }

    if (!diagnosis.trim()) {
      setErrorBanner('Clinical diagnosis is required.')
      return
    }

    // Validate medication rows
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.medicine_name.trim()) {
        setErrorBanner(`Item #${i + 1}: Medicine name is required.`)
        return
      }
      if (!it.dosage.trim()) {
        setErrorBanner(`Item #${i + 1}: Dosage is required.`)
        return
      }
      if (!it.duration_days || it.duration_days < 1) {
        setErrorBanner(`Item #${i + 1}: Duration must be at least 1 day.`)
        return
      }
    }

    const payload = {
      patient_id: patientId,
      encounter_id: paramEncounterId,
      diagnosis: diagnosis.trim(),
      dietary_advice: dietaryAdvice.trim() || null,
      general_advice: generalAdvice.trim() || null,
      follow_up_date: followUpDate ? followUpDate : null,
      items: items.map((it) => ({
        item_order: it.item_order,
        medicine_name: it.medicine_name.trim(),
        dosage: it.dosage.trim(),
        frequency: it.frequency,
        duration_days: Number(it.duration_days),
        instructions: it.instructions?.trim() || null,
      })),
    }

    try {
      const createdRx = await createPrescriptionMutation.mutateAsync(payload)
      setSuccessBanner('Prescription created successfully!')
      // Clear the form so a second click cannot issue the same prescription twice.
      issuedRef.current = true
      resetForm()
      setActivePrintRx(createdRx)
      refetchPast()
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to save prescription.')
    }
  }

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      {/* Print Slip Modal */}
      {activePrintRx && (
        <PrescriptionPrint
          prescription={activePrintRx}
          onClose={() => setActivePrintRx(null)}
        />
      )}

      {/* Historical Rx Print Modal */}
      {historicalRx && (
        <PrescriptionPrint
          prescription={historicalRx}
          onClose={() => setViewHistoryRxId(null)}
        />
      )}

      <div className="space-y-6 w-full max-w-7xl mx-auto">
        {/* Header Breadcrumb & Patient Info */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-neutral-200 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/doctor"
              className="text-xs font-bold text-rose-900 hover:underline flex items-center gap-1.5"
            >
              &larr; Back to Queue
            </Link>
            <span className="text-neutral-500">|</span>
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">Patient:</span>
            {patient ? (
              <span className="font-bold text-neutral-900 text-sm">
                {patient.full_name} <span className="font-mono text-xs text-neutral-600">({patient.urn})</span> · {patient.age_years}y / {patient.gender}
              </span>
            ) : (
              <span className="text-xs text-neutral-500 italic">No patient selected</span>
            )}
          </div>

          {paramEncounterId && (
            <span className="text-xs bg-rose-50 text-rose-950 font-bold px-3 py-1 rounded-full border border-rose-200">
              Linked to Encounter #{paramEncounterId}
            </span>
          )}
        </div>

        <UnsavedChangesGuard dirty={dirty} bypassRef={issuedRef} />

        {patient && (
          hasReportedAllergies(patient.allergies) ? (
            <div role="alert" className="p-3 bg-red-50 border border-red-300 rounded-lg text-red-900 text-sm font-bold">
              ⚠️ Reported allergies: <span className="underline">{patient.allergies}</span>
            </div>
          ) : (
            <div className="text-xs text-neutral-700 font-medium bg-neutral-50 px-3 py-2 rounded-lg border border-neutral-200">
              Allergies: None reported
            </div>
          )
        )}

        {/* Notifications */}
        {errorBanner && (
          <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-300 text-sm text-red-900 font-medium">
            {errorBanner}
          </div>
        )}
        {successBanner && (
          <div role="status" className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-sm text-emerald-950 font-semibold flex justify-between items-center shadow-xs">
            <span>&check; {successBanner}</span>
            <button
              type="button"
              onClick={() => setActivePrintRx(activePrintRx)}
              className="underline font-bold text-emerald-900 hover:text-emerald-950"
            >
              Print Slip Again &rarr;
            </button>
          </div>
        )}

        {/* Prescription Authoring Form */}
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-xs border border-neutral-200 space-y-6">
          <div className="border-b border-neutral-100 pb-3 flex justify-between items-center">
            <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <span className="text-rose-900 font-serif font-black text-2xl">℞</span> New Prescription
            </h2>
            <span className="text-xs text-neutral-600 font-semibold">Itemized clinical medication builder</span>
          </div>

          {/* Clinical Diagnosis */}
          <div>
            <label htmlFor="rx-diagnosis" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
              Diagnosis (निदान) *
            </label>
            <input
              id="rx-diagnosis"
              type="text"
              required
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Lumbar Canal Stenosis with Radiculopathy"
              className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
            />
          </div>

          {/* Medications Table */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                Prescribed Medications (औषधियां)
              </span>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-bold bg-rose-50 text-rose-950 hover:bg-rose-100 px-3.5 py-1.5 rounded-lg border border-rose-200 transition-colors"
              >
                + Add Medication (+ दवा जोड़ें)
              </button>
            </div>

            <div className="overflow-x-auto border border-neutral-200 rounded-lg">
              <table className="w-full text-left text-sm divide-y divide-neutral-200">
                <thead className="bg-neutral-50 text-xs font-bold uppercase tracking-wider text-neutral-600">
                  <tr>
                    <th scope="col" className="py-3 px-3 w-10 text-center">#</th>
                    <th scope="col" className="py-3 px-3 min-w-[200px]">Medicine Name *</th>
                    <th scope="col" className="py-3 px-3 w-32">Dosage *</th>
                    <th scope="col" className="py-3 px-3 w-36">Frequency</th>
                    <th scope="col" className="py-3 px-3 w-28">Days *</th>
                    <th scope="col" className="py-3 px-3">Instructions</th>
                    <th scope="col" className="py-3 px-2 w-12 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {items.map((item, index) => {
                    const allergyFlag = checkAllergyContraindication(
                      item.medicine_name,
                      patient?.allergies,
                    )
                    const totalDoses = estimateTotalDoses(item.frequency, item.duration_days)

                    return (
                      <tr key={item.tempId} className="hover:bg-neutral-50/60">
                        <td className="py-2.5 px-3 text-center font-mono text-neutral-600 text-xs font-semibold align-top pt-4">
                          {item.item_order}
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <input
                            type="text"
                            required
                            aria-label={`Medicine name, item ${item.item_order}`}
                            value={item.medicine_name}
                            onChange={(e) => handleItemChange(index, 'medicine_name', e.target.value)}
                            placeholder="e.g. Tab Pregabalin"
                            className="w-full rounded-md border border-neutral-300 p-2 text-xs text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                          />
                          {allergyFlag && (
                            <p className="mt-1 text-xs font-bold text-red-800">
                              ⚠️ Contraindication alert: matches allergy "{allergyFlag}"
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-1.5" aria-label="Quick drug formulation">
                            {FORMULATION_PRESETS.map((form) => (
                              <button
                                key={form}
                                type="button"
                                onClick={() => {
                                  const current = item.medicine_name.trim()
                                  const hasForm = FORMULATION_PRESETS.some((f) => current.startsWith(f))
                                  const updated = hasForm
                                    ? current.replace(/^[A-Za-z.]+/, form)
                                    : `${form} ${current}`.trim()
                                  handleItemChange(index, 'medicine_name', updated)
                                }}
                                className="px-1.5 py-0.5 text-xs font-semibold rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-colors"
                              >
                                {form}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <input
                            type="text"
                            required
                            aria-label={`Dosage, item ${item.item_order}`}
                            value={item.dosage}
                            onChange={(e) => handleItemChange(index, 'dosage', e.target.value)}
                            placeholder="75 mg"
                            className="w-full rounded-md border border-neutral-300 p-2 text-xs text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                          />
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <select
                            aria-label={`Frequency, item ${item.item_order}`}
                            value={item.frequency}
                            onChange={(e) => handleItemChange(index, 'frequency', e.target.value)}
                            className="w-full rounded-md border border-neutral-300 p-2 text-xs text-neutral-900 bg-white focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                          >
                            {FREQUENCY_PRESETS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <input
                            type="number"
                            required
                            min={1}
                            max={365}
                            aria-label={`Duration in days, item ${item.item_order}`}
                            value={item.duration_days}
                            onChange={(e) => handleItemChange(index, 'duration_days', Number(e.target.value))}
                            className="w-full rounded-md border border-neutral-300 p-2 text-xs text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                          />
                          {totalDoses !== null && (
                            <span className="block mt-1 text-xs font-semibold text-neutral-600">
                              Qty: {totalDoses} doses
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <input
                            type="text"
                            aria-label={`Instructions, item ${item.item_order}`}
                            value={item.instructions || ''}
                            onChange={(e) => handleItemChange(index, 'instructions', e.target.value)}
                            placeholder="After food, at bedtime"
                            className="w-full rounded-md border border-neutral-300 p-2 text-xs text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                          />
                          <div className="flex flex-wrap gap-1 mt-1.5" aria-label="Quick instructions">
                            {INSTRUCTION_PRESETS.slice(0, 2).map((ins) => (
                              <button
                                key={ins}
                                type="button"
                                onClick={() => handleItemChange(index, 'instructions', ins)}
                                className="px-1.5 py-0.5 text-xs font-medium rounded bg-rose-50 text-rose-950 hover:bg-rose-100 transition-colors"
                              >
                                {ins.split(' / ')[0]}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-center align-top pt-3">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(index)}
                            disabled={items.length <= 1}
                            className="text-red-700 hover:text-red-900 disabled:opacity-30 text-base font-bold p-2 min-h-[44px] min-w-[44px] cursor-pointer"
                            title="Remove item"
                            aria-label={`Remove medication ${item.item_order}`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Advice & Instructions in 2-Column Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label htmlFor="rx-general-advice" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                General Advice (सामान्य सलाह)
              </label>
              <textarea
                id="rx-general-advice"
                rows={3}
                value={generalAdvice}
                onChange={(e) => setGeneralAdvice(e.target.value)}
                placeholder="Ergonomic posture, core stabilization exercises, avoid forward bending..."
                className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              />
            </div>

            <div>
              <label htmlFor="rx-dietary-advice" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                Dietary Guidance (आहार संबंधी सलाह)
              </label>
              <textarea
                id="rx-dietary-advice"
                rows={3}
                value={dietaryAdvice}
                onChange={(e) => setDietaryAdvice(e.target.value)}
                placeholder="High calcium & protein intake, adequate hydration, avoid excess sodium..."
                className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              />
            </div>
          </div>

          {/* Follow-up date */}
          <div className="w-full md:w-72">
            <label htmlFor="rx-follow-up-date" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
              Follow-up Consultation Date
            </label>
            <input
              id="rx-follow-up-date"
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
            />
          </div>

          {/* Form Actions */}
          <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-4 border-t border-neutral-200 bg-white rounded-b-xl flex justify-end items-center gap-3">
            <button
              type="button"
              onClick={resetForm}
              className="px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors min-h-[44px]"
            >
              Clear Form
            </button>
            <button
              type="submit"
              disabled={createPrescriptionMutation.isPending}
              className="px-6 py-2.5 text-sm font-bold text-white bg-[#8E1C3D] hover:bg-[#721631] rounded-lg shadow-xs transition-colors min-h-[44px] focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
            >
              {createPrescriptionMutation.isPending ? 'Saving...' : 'Issue Prescription (प्रिस्क्रिप्शन जारी करें)'}
            </button>
          </div>
        </form>

        {/* Historical Prescriptions for Patient */}
        {pastPrescriptions && pastPrescriptions.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-xs border border-neutral-200 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-800">
              Previous Prescriptions for this Patient ({pastPrescriptions.length})
            </h3>
            <div className="divide-y divide-neutral-200">
              {pastPrescriptions.map((rx) => (
                <div key={rx.id} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-neutral-900 text-sm">
                      {rx.diagnosis} · <span className="text-neutral-600 font-medium">{rx.items_count} medications</span>
                    </div>
                    <div className="text-xs text-neutral-600 mt-0.5">
                      Prescribed by {rx.doctor_name} on {new Date(rx.created_at).toLocaleDateString('en-IN')}
                      {rx.follow_up_date && ` · Next review: ${new Date(rx.follow_up_date).toLocaleDateString('en-IN')}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewHistoryRxId(rx.id)}
                    className="text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 px-3.5 py-2 rounded-lg transition-colors min-h-[36px]"
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
