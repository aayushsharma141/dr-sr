import { useId, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import {
  useAmendPrescription,
  useAuthorisePrescription,
  usePatientPrescriptions,
  usePrescription,
} from '../../api/queries'
import type {
  PrescriptionItemCreate,
  PrescriptionOut,
  PrescriptionStatus,
  PrescriptionSummary,
} from '../../api/types'
import { formatIst, withDoctorTitle } from '../../format'
import { TableSkeleton } from '../AdminSkeleton'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'
import { PrescriptionPrint } from '../PrescriptionPrint'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconPill,
  IconPlus,
  IconPrescription,
  IconPrinter,
  IconRefresh,
  IconTrash,
} from '../icons'

export interface PatientPrescriptionsTabProps {
  patientId: number
  currentDoctorId?: number | null
}

const IST_DATE_GROUP_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const FORM_OPTIONS = [
  'Tablet',
  'Capsule',
  'Eye Drops',
  'Eye Ointment',
  'Syrup',
  'Gel',
  'Injection',
  'Cream',
  'Other',
]

const ROUTE_OPTIONS = [
  'Oral',
  'Right Eye (OD)',
  'Left Eye (OS)',
  'Both Eyes (OU)',
  'Topical',
  'Inhalation',
  'Other',
]

const INPUT_CLASS =
  'min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

const CELL_INPUT_CLASS =
  'min-h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 transition-colors duration-150 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]'

const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-700'

function formatIstDateOnly(value: string | null | undefined): string {
  if (!value) return '—'
  const trimmed = value.trim()
  if (!trimmed) return '—'
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+05:30`)
    : new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return IST_DATE_GROUP_FORMATTER.format(parsed)
}

function statusBadgeConfig(status: PrescriptionStatus): { label: string; className: string } {
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

interface EditableMedicationRow extends PrescriptionItemCreate {
  rowKey: string
}

function makeEmptyRow(order: number, keySuffix: number): EditableMedicationRow {
  return {
    rowKey: `new-${keySuffix}`,
    item_order: order,
    medicine_name: '',
    strength: '',
    form: 'Tablet',
    route: 'Oral',
    dosage: '1 tab',
    frequency: 'BD',
    duration_days: 5,
    instructions: '',
  }
}

function AmendPrescriptionForm({
  patientId,
  sourceRx,
  onClose,
  onAmended,
  onPendingChange,
}: {
  patientId: number
  sourceRx: PrescriptionOut
  onClose: () => void
  onAmended: (newRx: PrescriptionOut) => void
  onPendingChange: (pending: boolean) => void
}) {
  const amendMutation = useAmendPrescription(patientId)
  const [amendmentReason, setAmendmentReason] = useState('')
  const [diagnosis, setDiagnosis] = useState(sourceRx.diagnosis ?? '')
  const [generalAdvice, setGeneralAdvice] = useState(sourceRx.general_advice ?? '')
  const [dietaryAdvice, setDietaryAdvice] = useState(sourceRx.dietary_advice ?? '')
  const [followUpDate, setFollowUpDate] = useState(sourceRx.follow_up_date ?? '')
  const [authoriseImmediately, setAuthoriseImmediately] = useState(true)
  const [nextRowSeq, setNextRowSeq] = useState(sourceRx.items.length + 1)
  const [rows, setRows] = useState<EditableMedicationRow[]>(() =>
    sourceRx.items.length > 0
      ? sourceRx.items.map((item, idx) => ({
          rowKey: `src-${item.id}`,
          item_order: idx + 1,
          medicine_name: item.medicine_name,
          strength: item.strength ?? '',
          form: item.form ?? 'Tablet',
          route: item.route ?? 'Oral',
          dosage: item.dosage,
          frequency: item.frequency,
          duration_days: item.duration_days,
          instructions: item.instructions ?? '',
        }))
      : [makeEmptyRow(1, 1)],
  )
  const [formError, setFormError] = useState<string | null>(null)

  const handleRowChange = <K extends keyof PrescriptionItemCreate>(
    index: number,
    field: K,
    value: PrescriptionItemCreate[K],
  ) => {
    setRows((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const handleAddRow = () => {
    setRows((prev) => [...prev, makeEmptyRow(prev.length + 1, nextRowSeq)])
    setNextRowSeq((n) => n + 1)
  }

  const handleRemoveRow = (index: number) => {
    setRows((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((row, idx) => ({ ...row, item_order: idx + 1 })),
    )
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const reasonTrimmed = amendmentReason.trim()
    if (reasonTrimmed.length < 5) {
      setFormError('Amendment reason is required (minimum 5 characters).')
      return
    }

    const diagnosisTrimmed = diagnosis.trim()
    if (diagnosisTrimmed.length < 2) {
      setFormError('Diagnosis is required (minimum 2 characters).')
      return
    }

    if (rows.length === 0) {
      setFormError('At least one medication item is required to amend a prescription.')
      return
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row.medicine_name.trim()) {
        setFormError(`Medication row #${i + 1} requires a medicine name.`)
        return
      }
      if (!row.dosage.trim()) {
        setFormError(`Medication row #${i + 1} requires a dosage.`)
        return
      }
      if (!row.frequency.trim()) {
        setFormError(`Medication row #${i + 1} requires a frequency.`)
        return
      }
      if (!Number.isInteger(row.duration_days) || row.duration_days < 1 || row.duration_days > 365) {
        setFormError(`Medication row #${i + 1} duration must be between 1 and 365 days.`)
        return
      }
    }

    onPendingChange(true)
    try {
      const created = await amendMutation.mutateAsync({
        prescriptionId: sourceRx.id,
        body: {
          amendment_reason: reasonTrimmed,
          diagnosis: diagnosisTrimmed,
          general_advice: generalAdvice.trim() || null,
          dietary_advice: dietaryAdvice.trim() || null,
          follow_up_date: followUpDate.trim() || null,
          items: rows.map((row, idx) => ({
            item_order: idx + 1,
            medicine_name: row.medicine_name.trim(),
            strength: row.strength?.trim() || null,
            form: row.form?.trim() || null,
            route: row.route?.trim() || null,
            dosage: row.dosage.trim(),
            frequency: row.frequency.trim(),
            duration_days: row.duration_days,
            instructions: row.instructions?.trim() || null,
          })),
          authorise_immediately: authoriseImmediately,
        },
      })
      onAmended(created)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to amend prescription.')
    } finally {
      onPendingChange(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      {formError && (
        <InlineAlert tone="error" onDismiss={() => setFormError(null)}>
          {formError}
        </InlineAlert>
      )}

      <div>
        <label htmlFor="amend-rx-reason" className={LABEL_CLASS}>
          Amendment Reason <span className="text-red-700">*</span>
        </label>
        <textarea
          id="amend-rx-reason"
          data-autofocus
          rows={2}
          required
          minLength={5}
          maxLength={1000}
          value={amendmentReason}
          onChange={(e) => setAmendmentReason(e.target.value)}
          placeholder="Explain why this authorised prescription is being revised (min. 5 characters)..."
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-xs tabular-nums text-slate-600">
          Recorded permanently in the clinical audit trail ({amendmentReason.trim().length}/5 min chars).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="amend-rx-diagnosis" className={LABEL_CLASS}>
            Diagnosis <span className="text-red-700">*</span>
          </label>
          <input
            id="amend-rx-diagnosis"
            type="text"
            required
            minLength={2}
            maxLength={1000}
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="amend-rx-follow-up" className={LABEL_CLASS}>
            Follow-up Date
          </label>
          <input
            id="amend-rx-follow-up"
            type="date"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </div>
      </div>

      {/* Editable Medications */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight tabular-nums text-slate-900">
            Medications ({rows.length})
          </h3>
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
          >
            <IconPlus size={14} stroke={1.8} aria-hidden="true" />
            Add Medication
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[820px] divide-y divide-slate-200 text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th scope="col" className="w-8 whitespace-nowrap px-2 py-2.5 text-center">
                  #
                </th>
                <th scope="col" className="whitespace-nowrap px-2 py-2.5">
                  Medicine
                </th>
                <th scope="col" className="w-24 whitespace-nowrap px-2 py-2.5">
                  Strength
                </th>
                <th scope="col" className="w-28 whitespace-nowrap px-2 py-2.5">
                  Form
                </th>
                <th scope="col" className="w-28 whitespace-nowrap px-2 py-2.5">
                  Route
                </th>
                <th scope="col" className="w-24 whitespace-nowrap px-2 py-2.5">
                  Dosage
                </th>
                <th scope="col" className="w-24 whitespace-nowrap px-2 py-2.5">
                  Frequency
                </th>
                <th scope="col" className="w-20 whitespace-nowrap px-2 py-2.5">
                  Days
                </th>
                <th scope="col" className="whitespace-nowrap px-2 py-2.5">
                  Instructions
                </th>
                <th scope="col" className="w-10 whitespace-nowrap px-2 py-2.5 text-center">
                  Del
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row, idx) => {
                const formChoices =
                  row.form && !FORM_OPTIONS.includes(row.form)
                    ? [row.form, ...FORM_OPTIONS]
                    : FORM_OPTIONS
                const routeChoices =
                  row.route && !ROUTE_OPTIONS.includes(row.route)
                    ? [row.route, ...ROUTE_OPTIONS]
                    : ROUTE_OPTIONS

                return (
                  <tr key={row.rowKey}>
                    <td className="px-2 py-2 text-center font-mono tabular-nums text-slate-600">{idx + 1}</td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Medicine name for row ${idx + 1}`}
                        required
                        value={row.medicine_name}
                        onChange={(e) => handleRowChange(idx, 'medicine_name', e.target.value)}
                        placeholder="e.g. Paracetamol"
                        className={CELL_INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Strength for row ${idx + 1}`}
                        value={row.strength ?? ''}
                        onChange={(e) => handleRowChange(idx, 'strength', e.target.value)}
                        placeholder="500mg"
                        className={CELL_INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Form for row ${idx + 1}`}
                        value={row.form ?? 'Tablet'}
                        onChange={(e) => handleRowChange(idx, 'form', e.target.value)}
                        className={CELL_INPUT_CLASS}
                      >
                        {formChoices.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Route for row ${idx + 1}`}
                        value={row.route ?? 'Oral'}
                        onChange={(e) => handleRowChange(idx, 'route', e.target.value)}
                        className={CELL_INPUT_CLASS}
                      >
                        {routeChoices.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Dosage for row ${idx + 1}`}
                        required
                        value={row.dosage}
                        onChange={(e) => handleRowChange(idx, 'dosage', e.target.value)}
                        placeholder="1 tab"
                        className={CELL_INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Frequency for row ${idx + 1}`}
                        required
                        value={row.frequency}
                        onChange={(e) => handleRowChange(idx, 'frequency', e.target.value)}
                        placeholder="BD / 1-0-1"
                        className={CELL_INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        aria-label={`Duration in days for row ${idx + 1}`}
                        required
                        min={1}
                        max={365}
                        value={row.duration_days}
                        onChange={(e) =>
                          handleRowChange(idx, 'duration_days', Number.parseInt(e.target.value, 10) || 0)
                        }
                        className={`${CELL_INPUT_CLASS} tabular-nums`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Instructions for row ${idx + 1}`}
                        value={row.instructions ?? ''}
                        onChange={(e) => handleRowChange(idx, 'instructions', e.target.value)}
                        placeholder="After food"
                        className={CELL_INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(idx)}
                        disabled={rows.length <= 1}
                        aria-label={`Remove medication row ${idx + 1}`}
                        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded border border-slate-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                      >
                        <IconTrash size={14} stroke={1.8} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Advice Fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="amend-rx-general-advice" className={LABEL_CLASS}>
            General Advice
          </label>
          <textarea
            id="amend-rx-general-advice"
            rows={2}
            maxLength={1000}
            value={generalAdvice}
            onChange={(e) => setGeneralAdvice(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="amend-rx-dietary-advice" className={LABEL_CLASS}>
            Dietary Advice
          </label>
          <textarea
            id="amend-rx-dietary-advice"
            rows={2}
            maxLength={1000}
            value={dietaryAdvice}
            onChange={(e) => setDietaryAdvice(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
        <input
          type="checkbox"
          checked={authoriseImmediately}
          onChange={(e) => setAuthoriseImmediately(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-[#5D0B26]"
        />
        Authorise amended prescription immediately (ready to print)
      </label>

      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={amendMutation.isPending}
          className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-2xs"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={amendMutation.isPending}
          className="inline-flex min-h-[38px] items-center rounded-lg bg-[#5D0B26] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#7A1235] disabled:opacity-50 cursor-pointer"
        >
          {amendMutation.isPending ? 'Saving Amendment…' : 'Save Amended Revision'}
        </button>
      </div>
    </form>
  )
}

function AmendPrescriptionDialog({
  patientId,
  prescriptionId,
  onClose,
  onAmended,
}: {
  patientId: number
  prescriptionId: number
  onClose: () => void
  onAmended: (newRx: PrescriptionOut) => void
}) {
  const rxQuery = usePrescription(prescriptionId)
  const [submitting, setSubmitting] = useState(false)
  const currentRev = rxQuery.data?.revision_number ?? 1

  return (
    <Modal
      open
      onClose={onClose}
      busy={submitting}
      title={`Amend Prescription (v${currentRev} → v${currentRev + 1})`}
      description="The original authorised prescription will be marked SUPERSEDED and preserved in clinical history."
      variant="warning"
      className="max-w-5xl"
    >
      {rxQuery.isPending ? (
        <TableSkeleton label="Loading prescription details for amendment..." rows={3} columns={4} />
      ) : rxQuery.isError ? (
        <InlineAlert tone="error">
          Unable to load prescription details: {rxQuery.error.message}
        </InlineAlert>
      ) : rxQuery.data ? (
        <AmendPrescriptionForm
          key={rxQuery.data.id}
          patientId={patientId}
          sourceRx={rxQuery.data}
          onClose={onClose}
          onAmended={onAmended}
          onPendingChange={setSubmitting}
        />
      ) : null}
    </Modal>
  )
}

function PrescriptionCard({
  rx,
  currentDoctorId,
  defaultExpanded,
  onPrint,
  onAmend,
  onAuthorise,
  isAuthorising,
}: {
  rx: PrescriptionSummary
  currentDoctorId?: number | null
  defaultExpanded: boolean
  onPrint: (rxId: number) => void
  onAmend: (rxId: number) => void
  onAuthorise: (rx: PrescriptionSummary) => void
  isAuthorising: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const detailPanelId = useId()

  // Fetch full prescription detail (medications + advice) only when expanded.
  const detailQuery = usePrescription(expanded ? rx.id : 0)
  const detail = detailQuery.data

  const revisionNumber = rx.revision_number ?? 1
  const statusBadge = statusBadgeConfig(rx.status)
  const isSuperseded = rx.status === 'SUPERSEDED'
  const canPrint = rx.status === 'AUTHORISED'
  const canAuthorise =
    rx.status === 'DRAFT' && Boolean(currentDoctorId && rx.doctor_id === currentDoctorId)
  const canAmend =
    rx.status === 'AUTHORISED' && Boolean(currentDoctorId && rx.doctor_id === currentDoctorId)

  return (
    <article
      aria-label={`Prescription v${revisionNumber} (${statusBadge.label})`}
      className={`overflow-hidden rounded-xl border shadow-2xs transition-colors duration-150 ${
        isSuperseded
          ? 'border-slate-200 bg-slate-50/80'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3.5">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-slate-900 ring-1 ring-inset ring-slate-300">
                v{revisionNumber}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge.className}`}
              >
                {statusBadge.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-700">
                <IconPill size={14} stroke={1.8} aria-hidden="true" />
                {rx.items_count} {rx.items_count === 1 ? 'medication' : 'medications'}
              </span>
              {rx.supersedes_prescription_id != null && (
                <span className="text-xs font-medium tabular-nums text-slate-600">
                  Supersedes Rx #{rx.supersedes_prescription_id}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 truncate font-semibold text-slate-900">
                {withDoctorTitle(rx.doctor_name)}
              </span>
              <span className="text-xs font-medium tabular-nums text-slate-600">
                {formatIst(rx.created_at)}
              </span>
              {rx.follow_up_date && (
                <span className="text-xs font-medium tabular-nums text-slate-700">
                  Follow-up: {formatIstDateOnly(rx.follow_up_date)}
                </span>
              )}
              {rx.encounter_id != null && (
                <Link
                  to={`/doctor/encounters/${rx.encounter_id}`}
                  className="text-xs font-semibold tabular-nums text-[#8E1C3D] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                >
                  Encounter #{rx.encounter_id} &rarr;
                </Link>
              )}
            </div>

            {rx.diagnosis && (
              <p className="text-sm leading-relaxed text-slate-800">
                <span className="font-semibold text-slate-700">Diagnosis:</span> {rx.diagnosis}
              </p>
            )}

            {rx.amendment_reason && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="font-semibold">Amendment reason:</span> {rx.amendment_reason}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {canAuthorise && (
              <button
                type="button"
                onClick={() => onAuthorise(rx)}
                disabled={isAuthorising}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer shadow-2xs"
              >
                <IconCheck size={15} stroke={1.8} aria-hidden="true" />
                {isAuthorising ? 'Authorising…' : 'Authorise'}
              </button>
            )}
            {canPrint && (
              <button
                type="button"
                onClick={() => onPrint(rx.id)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
              >
                <IconPrinter size={15} stroke={1.8} aria-hidden="true" />
                Print / Preview
              </button>
            )}
            {canAmend && (
              <button
                type="button"
                onClick={() => onAmend(rx.id)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#5D0B26] px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-[#7A1235] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
              >
                <IconPrescription size={15} stroke={1.8} aria-hidden="true" />
                Amend Prescription
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              aria-controls={detailPanelId}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
            >
              {expanded ? (
                <IconChevronDown size={15} stroke={1.8} aria-hidden="true" />
              ) : (
                <IconChevronRight size={15} stroke={1.8} aria-hidden="true" />
              )}
              {expanded ? 'Hide Medications' : 'View Medications'}
            </button>
          </div>
        </div>
      </div>

      {/* Expandable Medication Table & Advice */}
      {expanded && (
        <div
          id={detailPanelId}
          className="space-y-4 border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5"
        >
          {detailQuery.isPending ? (
            <TableSkeleton label="Loading prescription medications..." rows={3} columns={5} />
          ) : detailQuery.isError ? (
            <InlineAlert tone="error">
              Unable to load prescription details: {detailQuery.error.message}
            </InlineAlert>
          ) : detail ? (
            <>
              {detail.cancellation_reason && (
                <InlineAlert tone="error">
                  <span className="font-semibold">Cancelled:</span> {detail.cancellation_reason}
                </InlineAlert>
              )}

              {detail.items.length === 0 ? (
                <p className="text-xs text-slate-600">No medication items recorded.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full min-w-[760px] divide-y divide-slate-200 text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <tr>
                        <th scope="col" className="w-10 whitespace-nowrap px-4 py-2.5 text-center">
                          #
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                          Medicine
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                          Strength
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                          Dosage
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                          Frequency
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                          Duration
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                          Route
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                          Instructions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.items.map((item) => (
                        <tr key={item.id} className="align-top transition-colors duration-150 hover:bg-slate-50/80">
                          <td className="whitespace-nowrap px-4 py-3 text-center font-mono text-xs tabular-nums text-slate-600">
                            {item.item_order}
                          </td>
                          <td className="max-w-[220px] px-4 py-3">
                            <span className="font-semibold text-slate-900">
                              {item.medicine_name}
                            </span>
                            {item.form && (
                              <span className="ml-1.5 text-xs text-slate-600">({item.form})</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-800">
                            {item.strength || '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-800">
                            {item.dosage}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-900">
                            {item.frequency}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-800">
                            {item.duration_days} {item.duration_days === 1 ? 'day' : 'days'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-800">
                            {item.route || '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700">
                            {item.instructions || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(detail.general_advice || detail.dietary_advice) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {detail.general_advice && (
                    <div className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs">
                      <span className="block font-semibold text-slate-700">General Advice</span>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                        {detail.general_advice}
                      </p>
                    </div>
                  )}
                  {detail.dietary_advice && (
                    <div className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs">
                      <span className="block font-semibold text-slate-700">Dietary Advice</span>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                        {detail.dietary_advice}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </article>
  )
}

export function PatientPrescriptionsTab({
  patientId,
  currentDoctorId = null,
}: PatientPrescriptionsTabProps) {
  const { data, isPending, isError, error, refetch, isFetching } =
    usePatientPrescriptions(patientId)
  const authoriseMutation = useAuthorisePrescription()

  const [printRxId, setPrintRxId] = useState<number | null>(null)
  const [amendRxId, setAmendRxId] = useState<number | null>(null)
  const [expandedNewId, setExpandedNewId] = useState<number | null>(null)

  const printQuery = usePrescription(printRxId ?? 0)

  const handleAuthorise = async (rx: PrescriptionSummary) => {
    try {
      await authoriseMutation.mutateAsync(rx.id)
      toast.success(`Prescription v${rx.revision_number ?? 1} authorised and ready to print.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to authorise prescription.')
    }
  }

  const prescriptions: PrescriptionSummary[] = useMemo(
    () => (Array.isArray(data) ? data : []),
    [data],
  )

  const groupedByDate = useMemo(() => {
    const groups: { dateLabel: string; items: PrescriptionSummary[] }[] = []
    const indexByLabel = new Map<string, number>()

    for (const rx of prescriptions) {
      const dateLabel = formatIstDateOnly(rx.created_at)
      const existingIndex = indexByLabel.get(dateLabel)
      if (existingIndex === undefined) {
        indexByLabel.set(dateLabel, groups.length)
        groups.push({ dateLabel, items: [rx] })
      } else {
        groups[existingIndex].items.push(rx)
      }
    }
    return groups
  }, [prescriptions])

  return (
    <section aria-labelledby="patient-prescriptions-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0">
          <h2 id="patient-prescriptions-heading" className="text-base font-semibold tracking-tight text-slate-900">
            Prescriptions
          </h2>
          <p className="mt-0.5 text-xs tabular-nums text-slate-600">
            {prescriptions.length > 0
              ? `${prescriptions.length} ${prescriptions.length === 1 ? 'prescription' : 'prescriptions'} including revision history`
              : 'Authorised prescriptions, medication schedules, and versioned amendments'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh prescriptions"
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
        >
          <IconRefresh size={15} stroke={1.8} aria-hidden="true" />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isPending ? (
        <TableSkeleton label="Loading patient prescriptions..." rows={4} columns={4} />
      ) : isError ? (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Could not load prescriptions{error?.message ? `: ${error.message}` : '.'}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label="Retry loading prescriptions"
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 transition-colors duration-150 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </InlineAlert>
      ) : prescriptions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-2xs space-y-1">
          <p className="text-sm font-medium text-slate-700">
            No prescriptions issued for this patient yet.
          </p>
          <p className="text-xs text-slate-600">
            Prescriptions authored during consultations and their amended revisions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedByDate.map((group) => (
            <div key={group.dateLabel} className="space-y-2.5">
              <h3 className="text-xs font-semibold tracking-tight tabular-nums text-slate-600">
                {group.dateLabel}
              </h3>
              <div className="space-y-3">
                {group.items.map((rx) => (
                  <PrescriptionCard
                    key={rx.id}
                    rx={rx}
                    currentDoctorId={currentDoctorId}
                    defaultExpanded={expandedNewId === rx.id}
                    onPrint={(id) => setPrintRxId(id)}
                    onAmend={(id) => setAmendRxId(id)}
                    onAuthorise={(item) => void handleAuthorise(item)}
                    isAuthorising={
                      authoriseMutation.isPending && authoriseMutation.variables === rx.id
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Print / Preview Portal (reusing PrescriptionPrint which wraps its own print Modal) */}
      {printRxId != null && printQuery.data && (
        <PrescriptionPrint
          prescription={printQuery.data}
          onClose={() => setPrintRxId(null)}
        />
      )}
      {printRxId != null && !printQuery.data && (
        <Modal
          open
          onClose={() => setPrintRxId(null)}
          title={printQuery.isError ? 'Prescription Print Error' : 'Preparing Prescription Slip'}
          variant={printQuery.isError ? 'error' : 'info'}
          dismiss="any"
        >
          {printQuery.isError ? (
            <InlineAlert tone="error">
              Unable to load prescription for printing: {printQuery.error.message}
            </InlineAlert>
          ) : (
            <TableSkeleton label="Loading prescription slip for print..." rows={3} columns={4} />
          )}
        </Modal>
      )}

      {/* Amend Prescription Modal */}
      {amendRxId != null && (
        <AmendPrescriptionDialog
          patientId={patientId}
          prescriptionId={amendRxId}
          onClose={() => setAmendRxId(null)}
          onAmended={(newRx) => {
            setAmendRxId(null)
            setExpandedNewId(newRx.id)
            toast.success(
              `Created amended prescription revision v${newRx.revision_number ?? 2} (${newRx.status}).`,
            )
          }}
        />
      )}
    </section>
  )
}
