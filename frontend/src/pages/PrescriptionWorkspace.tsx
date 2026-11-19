import { useState, useId } from 'react'
import { useSearchParams, Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PrescriptionPrint } from '../components/PrescriptionPrint'
import { toast } from '../components/ToastHost'
import { UnsavedChangesGuard, hasReportedAllergies } from '../components/UnsavedChangesGuard'
import { IconAlertTriangle, IconShieldCheck } from '../components/icons'
import {
  usePatient,
  usePatientAllergies,
  usePatientPrescriptions,
  usePrescription,
  useCreatePrescription,
  useMe,
} from '../api/queries'
import type { PrescriptionItemCreate, PrescriptionOut, PrescriptionStatus } from '../api/types'
import { withDoctorTitle } from '../format'

const FREQUENCY_PRESETS = ['1-0-1', '1-0-0', '0-0-1', '1-1-1', '0-1-0', 'SOS']

function prescriptionStatusBadge(status: PrescriptionStatus): { label: string; className: string } {
  switch (status) {
    case 'AUTHORISED':
      return {
        label: 'Authorised',
        className: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
      }
    case 'SUPERSEDED':
      return {
        label: 'Superseded',
        className: 'border border-slate-300 bg-slate-100 text-slate-700',
      }
    case 'DRAFT':
      return {
        label: 'Draft',
        className: 'border border-amber-200 bg-amber-50 text-amber-900',
      }
    case 'CANCELLED':
      return {
        label: 'Cancelled',
        className: 'border border-rose-200 bg-rose-50 text-rose-900 line-through',
      }
    default:
      return {
        label: status,
        className: 'border border-slate-200 bg-slate-100 text-slate-700',
      }
  }
}

function formatIstDate(value: string): string {
  const trimmed = value.trim()
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+05:30`)
    : new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
}

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
  const paramAppointmentId = searchParams.get('appointment_id')
    ? Number(searchParams.get('appointment_id'))
    : null

  const patientId = paramPatientId || 0
  const { data: me } = useMe()
  const {
    data: patient,
    isPending: isPatientLoading,
    isError: isPatientError,
  } = usePatient(patientId)
  const {
    data: patientAllergiesData,
    isPending: isAllergiesLoading,
    isError: isAllergiesError,
  } = usePatientAllergies(patientId > 0 ? patientId : null, patientId > 0)
  const { data: pastPrescriptions, refetch: refetchPast } = usePatientPrescriptions(patientId)
  const createPrescriptionMutation = useCreatePrescription()

  const structuredAllergies = Array.isArray(patientAllergiesData)
    ? patientAllergiesData.filter((a) => a.status === 'ACTIVE')
    : []
  const legacyAllergyText =
    patient && hasReportedAllergies(patient.allergies) ? patient.allergies?.trim() || null : null
  const rawLegacyAllergies = (patient?.allergies ?? '').trim().toLowerCase().replace(/\.$/, '')
  const hasConfirmedNegativeAllergies = Boolean(
    rawLegacyAllergies &&
      rawLegacyAllergies !== '-' &&
      !hasReportedAllergies(rawLegacyAllergies),
  )
  const allergyDataLoading = patientId > 0 && (isPatientLoading || isAllergiesLoading)
  const allergyDataUnavailable =
    patientId > 0 &&
    !allergyDataLoading &&
    (isPatientError || isAllergiesError || !patient || !Array.isArray(patientAllergiesData))

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
  const [activePrintRx, setActivePrintRx] = useState<PrescriptionOut | null>(null)
  const [viewHistoryRxId, setViewHistoryRxId] = useState<number | null>(null)

  // Query for historical prescription viewing
  const { data: historicalRx } = usePrescription(viewHistoryRxId || 0)

  // Any field typed into or medication added means leaving now would lose work.
  const isDirty =
    Boolean(diagnosis.trim() || dietaryAdvice.trim() || generalAdvice.trim() || followUpDate) ||
    items.length > 1 ||
    items.some(
      (it, index) =>
        it.medicine_name.trim() !== '' ||
        it.dosage.trim() !== '' ||
        (index === 0 &&
          (it.frequency !== '1-0-1' ||
            it.duration_days !== 5 ||
            (it.instructions ?? '') !== 'After meals')),
    )

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

    if (!patientId) {
      toast.error('Please select or specify a valid patient.')
      return
    }

    if (!diagnosis.trim()) {
      toast.error('Diagnosis is mandatory.')
      return
    }

    // Validate medication lines
    for (const item of items) {
      if (!item.medicine_name.trim()) {
        toast.error(`Item #${item.item_order}: Medicine name cannot be empty.`)
        return
      }
      if (!item.dosage.trim()) {
        toast.error(`Item #${item.item_order}: Dosage is required.`)
        return
      }
      if (item.duration_days < 1 || item.duration_days > 365) {
        toast.error(`Item #${item.item_order}: Duration must be between 1 and 365 days.`)
        return
      }
    }

    const payload = {
      patient_id: patientId,
      encounter_id: paramEncounterId,
      ...(paramAppointmentId ? { appointment_id: paramAppointmentId } : {}),
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
      toast.success('Prescription issued successfully!', {
        action: {
          label: 'Print Slip Again',
          onClick: () => setActivePrintRx(result),
        },
      })
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
      toast.error(err.message || 'Failed to issue prescription.')
    }
  }

  return (
    <AppShell name={me?.full_name || 'Doctor'} role="DOCTOR">
      <UnsavedChangesGuard dirty={isDirty} />
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

      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        {/* Navigation & Patient Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-2xs sm:px-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/doctor"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 transition-colors duration-150 hover:text-teal-900"
            >
              ← Back to Queue
            </Link>
            <span className="text-gray-500" aria-hidden="true">|</span>
            <span className="text-xs font-medium text-gray-600">Patient:</span>
            {patient ? (
              <span className="text-sm font-semibold text-gray-900 tabular-nums">
                {patient.full_name} (<span className="font-mono">{patient.urn}</span>) · {patient.age_years}y / {patient.gender}
              </span>
            ) : (
              <span className="text-sm text-gray-500 italic">No patient selected</span>
            )}
          </div>

          {paramEncounterId ? (
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 tabular-nums">
              Linked to Encounter #{paramEncounterId}
            </span>
          ) : paramAppointmentId ? (
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 tabular-nums">
              Linked to Appointment #{paramAppointmentId}
            </span>
          ) : null}
        </div>

        {/* Clinical Allergy Safety Banner (C4) */}
        {patientId > 0 && (
          allergyDataLoading ? (
            <div
              role="status"
              data-testid="rx-allergy-loading"
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-600"
            >
              Checking patient allergy records...
            </div>
          ) : allergyDataUnavailable ? (
            <div
              role="alert"
              data-testid="rx-allergy-unavailable"
              className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <IconAlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <p className="font-semibold">Allergy status unavailable</p>
                <p className="text-xs text-amber-900">
                  Could not verify patient allergy records from the server. Confirm allergies directly with the patient before prescribing.
                </p>
              </div>
            </div>
          ) : structuredAllergies.length > 0 || legacyAllergyText ? (
            <div
              role="alert"
              data-testid="rx-allergy-alert"
              className="flex items-start gap-2.5 rounded-xl border border-[#8E1C3D] bg-[#8E1C3D] px-4 py-3 text-sm text-white shadow-2xs"
            >
              <IconAlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">Allergy Alert — Review Before Prescribing</p>
                {structuredAllergies.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 text-xs">
                    {structuredAllergies.map((allergy) => (
                      <li
                        key={allergy.id}
                        className="rounded-md bg-white/15 px-2 py-0.5 font-medium"
                      >
                        {allergy.substance} ({allergy.severity.replace('_', ' ')})
                        {allergy.reaction ? ` — ${allergy.reaction}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {legacyAllergyText && (
                  <p className="text-xs text-white/90">
                    Recorded allergy note: {legacyAllergyText}
                  </p>
                )}
              </div>
            </div>
          ) : hasConfirmedNegativeAllergies ? (
            <div
              data-testid="rx-allergy-clear"
              className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-900"
            >
              <IconShieldCheck size={16} className="shrink-0 text-emerald-700" aria-hidden="true" />
              <span>No known allergies recorded</span>
            </div>
          ) : (
            <div
              data-testid="rx-allergy-unrecorded"
              className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900"
            >
              <IconAlertTriangle size={16} className="shrink-0 text-amber-700" aria-hidden="true" />
              <span>Allergy screening not recorded. Verify with patient before prescribing.</span>
            </div>
          )
        )}

        {/* Prescription Authoring Form */}
        <form onSubmit={handleSubmit} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-5">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight leading-tight text-gray-900 sm:text-2xl">
              <span className="shrink-0 font-serif text-2xl font-black text-teal-700" aria-hidden="true">℞</span>
              New Prescription
            </h1>
            <span className="text-xs font-medium text-gray-500">Step-by-step medication builder</span>
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            {/* Clinical Diagnosis */}
            <div>
              <label htmlFor="rx-diagnosis" className="mb-1.5 block text-xs font-medium text-gray-700">
                Diagnosis (निदान) *
              </label>
              <input
                id="rx-diagnosis"
                type="text"
                required
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g. Lumbar Canal Stenosis with Radiculopathy"
                className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            {/* Medications Table */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-gray-900">
                  Prescribed Medications (औषधियां)
                </h2>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-1.5 text-xs font-medium text-teal-800 transition-colors duration-150 hover:bg-teal-100"
                >
                  + Add Medication (+ दवा जोड़ें)
                </button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full divide-y divide-gray-200 text-left text-sm">
                  <thead className="bg-gray-50 text-xs font-medium text-gray-600">
                    <tr>
                      <th scope="col" className="w-10 whitespace-nowrap px-3 py-2.5 text-center">#</th>
                      <th scope="col" className="min-w-[200px] px-3 py-2.5">Medicine Name *</th>
                      <th scope="col" className="w-32 whitespace-nowrap px-3 py-2.5">Dosage *</th>
                      <th scope="col" className="w-36 whitespace-nowrap px-3 py-2.5">Frequency</th>
                      <th scope="col" className="w-28 whitespace-nowrap px-3 py-2.5">Days *</th>
                      <th scope="col" className="px-3 py-2.5">Instructions</th>
                      <th scope="col" className="w-14 whitespace-nowrap px-3 py-2.5 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {items.map((item, index) => (
                      <tr key={item.tempId} className="transition-colors duration-150 hover:bg-gray-50/50">
                        <td className="whitespace-nowrap px-3 py-2.5 text-center font-mono text-xs text-gray-500 tabular-nums">
                          {item.item_order}
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            required
                            aria-label={`Medicine name, row ${index + 1}`}
                            value={item.medicine_name}
                            onChange={(e) => handleItemChange(index, 'medicine_name', e.target.value)}
                            placeholder="e.g. Tab Pregabalin"
                            className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            required
                            aria-label={`Dosage, row ${index + 1}`}
                            value={item.dosage}
                            onChange={(e) => handleItemChange(index, 'dosage', e.target.value)}
                            placeholder="75 mg"
                            className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 tabular-nums transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            aria-label={`Frequency, row ${index + 1}`}
                            value={item.frequency}
                            onChange={(e) => handleItemChange(index, 'frequency', e.target.value)}
                            className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 tabular-nums transition-colors duration-150 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                          >
                            {FREQUENCY_PRESETS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="number"
                            required
                            min={1}
                            max={365}
                            aria-label={`Days, row ${index + 1}`}
                            value={item.duration_days}
                            onChange={(e) => handleItemChange(index, 'duration_days', Number(e.target.value))}
                            className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 tabular-nums transition-colors duration-150 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            aria-label={`Instructions, row ${index + 1}`}
                            value={item.instructions || ''}
                            onChange={(e) => handleItemChange(index, 'instructions', e.target.value)}
                            placeholder="After food, at bedtime"
                            className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(index)}
                            disabled={items.length <= 1}
                            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-sm font-medium text-red-600 transition-colors duration-150 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="rx-general-advice" className="mb-1.5 block text-xs font-medium text-gray-700">
                  General Advice (सामान्य सलाह)
                </label>
                <textarea
                  id="rx-general-advice"
                  rows={3}
                  value={generalAdvice}
                  onChange={(e) => setGeneralAdvice(e.target.value)}
                  placeholder="Ergonomic posture, core stabilization exercises, avoid forward bending..."
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
              </div>

              <div>
                <label htmlFor="rx-dietary-advice" className="mb-1.5 block text-xs font-medium text-gray-700">
                  Dietary Guidance (आहार संबंधी सलाह)
                </label>
                <textarea
                  id="rx-dietary-advice"
                  rows={3}
                  value={dietaryAdvice}
                  onChange={(e) => setDietaryAdvice(e.target.value)}
                  placeholder="High calcium & protein intake, adequate hydration, avoid excess sodium..."
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
              </div>
            </div>

            {/* Follow-up date */}
            <div className="w-full md:w-64">
              <label htmlFor="rx-follow-up-date" className="mb-1.5 block text-xs font-medium text-gray-700">
                Follow-up Consultation Date
              </label>
              <input
                id="rx-follow-up-date"
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="min-h-[38px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 tabular-nums transition-colors duration-150 hover:border-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            {/* Form Actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  setDiagnosis('')
                  setDietaryAdvice('')
                  setGeneralAdvice('')
                  setFollowUpDate('')
                }}
                className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50"
              >
                Clear Form
              </button>
              <button
                type="submit"
                disabled={createPrescriptionMutation.isPending}
                className="inline-flex min-h-[38px] cursor-pointer items-center rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createPrescriptionMutation.isPending ? 'Saving...' : 'Issue Prescription (प्रिस्क्रिप्शन जारी करें)'}
              </button>
            </div>
          </div>
        </form>

        {/* Historical Prescriptions for Patient */}
        {pastPrescriptions && pastPrescriptions.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
            <div className="border-b border-gray-200 px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 tabular-nums">
                Previous Prescriptions for this Patient ({pastPrescriptions.length})
              </h2>
            </div>
            <div className="divide-y divide-gray-200 px-4 sm:px-5">
              {pastPrescriptions.map((rx) => {
                const statusBadge = prescriptionStatusBadge(rx.status)
                const canPrint = rx.status === 'AUTHORISED'
                return (
                  <div key={rx.id} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                        <span>
                          {rx.diagnosis} ·{' '}
                          <span className="font-normal text-gray-600 tabular-nums">
                            {rx.items_count} medications
                          </span>
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge.className}`}
                        >
                          {statusBadge.label}
                        </span>
                      </div>
                      <div className="text-xs leading-relaxed text-gray-600 tabular-nums">
                        Prescribed by {withDoctorTitle(rx.doctor_name)} on {formatIstDate(rx.created_at)}
                        {rx.follow_up_date && ` · Next review: ${formatIstDate(rx.follow_up_date)}`}
                      </div>
                    </div>
                    {canPrint ? (
                      <button
                        type="button"
                        onClick={() => setViewHistoryRxId(rx.id)}
                        className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-1.5 text-xs font-medium text-gray-800 transition-colors duration-150 hover:bg-gray-100"
                      >
                        View / Print Slip
                      </button>
                    ) : (
                      <span className="inline-flex min-h-[36px] shrink-0 items-center whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600">
                        Not printable ({statusBadge.label})
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  )
}
