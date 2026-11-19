import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { BillPaymentOut } from '../api/bill'
import {
  downloadPatientDocumentBlob,
  useMe,
  useVisitWorkspace,
} from '../api/queries'
import type {
  AllergySeverity,
  DiagnosisType,
  EncounterDiagnosisOut,
  InvestigationOrderOut,
  PaymentMethod,
  PaymentOut,
  PrescriptionOut,
  PrescriptionStatus,
  Role,
  VisitWorkspaceConsultationOut,
  VisitWorkspacePatientStrip,
  VitalObservationInput,
  WorkspaceTemplateSummaryOut,
} from '../api/types'
import { TableSkeleton } from '../components/AdminSkeleton'
import { AppShell } from '../components/AppShell'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import { toast } from '../components/ToastHost'
import { PrescriptionPrint } from '../components/PrescriptionPrint'
import { ReceiptDialog } from '../components/ReceiptDialog'
import { VitalsBiometricsSection } from '../components/VitalsBiometricsSection'
import { BillPanel } from '../components/billing/BillPanel'
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconCalendar,
  IconNotes,
  IconPhone,
  IconPrescription,
  IconPrinter,
  IconRefresh,
  IconReportMedical,
  IconStethoscope,
} from '../components/icons'
import { formatIst, formatPaise, formatToken, withDoctorTitle } from '../format'

const NOOP_VITALS = (_next: VitalObservationInput) => {}

const IST_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const GENDER_LABEL: Record<string, string> = {
  M: 'Male',
  F: 'Female',
  O: 'Other',
}

const REFERRAL_LABEL: Record<string, string> = {
  SELF: 'Self / Walk-in',
  DOCTOR: 'Doctor Referral',
  PATIENT: 'Patient Referral',
  CAMP: 'Health Camp',
  ONLINE: 'Online',
  OTHER: 'Other',
}

const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  MILD: 'Mild',
  MODERATE: 'Moderate',
  SEVERE: 'Severe',
  LIFE_THREATENING: 'Life-threatening',
}

const SEVERITY_BADGE_CLASS: Record<AllergySeverity, string> = {
  MILD: 'bg-amber-100 text-amber-900 border border-amber-300',
  MODERATE: 'bg-amber-200 text-amber-950 border border-amber-400',
  SEVERE: 'bg-rose-100 text-rose-900 border border-rose-300',
  LIFE_THREATENING: 'bg-rose-800 text-white border border-rose-900',
}

const DIAGNOSIS_TYPE_BADGE: Record<DiagnosisType, string> = {
  PRIMARY: 'border border-rose-300 bg-rose-50 text-rose-900',
  SECONDARY: 'border border-sky-200 bg-sky-50 text-sky-900',
  PROVISIONAL: 'border border-amber-200 bg-amber-50 text-amber-900',
}

function parsePositiveId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const num = Number(raw)
  return Number.isSafeInteger(num) && num > 0 ? num : null
}

function formatIstDateOnly(value: string | null | undefined): string {
  if (!value) return '—'
  const trimmed = value.trim()
  if (!trimmed) return '—'
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+05:30`)
    : new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return IST_DATE_FORMATTER.format(parsed)
}

function formatSafePaise(paise: number): string {
  return paise < 0 ? `-${formatPaise(Math.abs(paise))}` : formatPaise(paise)
}

function visitStatusBadgeClass(status: string): string {
  switch (status.toUpperCase()) {
    case 'OPEN':
      return 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200'
    case 'CLOSED':
      return 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
    case 'CANCELLED':
      return 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

function consultationStatusBadgeClass(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
    case 'IN_CONSULTATION':
      return 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200'
    case 'WAITING':
      return 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200'
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

function paymentStatusBadge(status: string | null | undefined): { label: string; className: string } {
  switch ((status ?? '').toUpperCase()) {
    case 'PAID':
      return {
        label: 'Paid',
        className: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
      }
    case 'PARTIAL':
      return {
        label: 'Partial',
        className: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200',
      }
    case 'UNPAID':
      return {
        label: 'Unpaid',
        className: 'bg-red-50 text-red-800 ring-1 ring-inset ring-red-200',
      }
    case 'NO_CHARGES':
      return {
        label: 'No charges',
        className: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
      }
    default:
      return {
        label: status || '—',
        className: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
      }
  }
}

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

function investigationStatusClass(status: string): string {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return 'border border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'SAMPLE_COLLECTED':
      return 'border border-sky-200 bg-sky-50 text-sky-900'
    case 'CANCELLED':
      return 'border border-rose-200 bg-rose-50 text-rose-900'
    default:
      return 'border border-amber-200 bg-amber-50 text-amber-900'
  }
}

function formatEnumLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ')
}

function formatTemplateKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatTemplateValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatTemplateValue(item))
      .filter((text) => text !== '—')
    return items.length > 0 ? items.join(', ') : '—'
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${formatTemplateKey(k)}: ${formatTemplateValue(v)}`)
      .filter(Boolean)
    return entries.length > 0 ? entries.join(' · ') : '—'
  }
  return String(value)
}

function normalizePaymentMethod(method: string): PaymentMethod {
  const upper = method.toUpperCase()
  if (upper === 'UPI' || upper === 'CARD' || upper === 'CASH') return upper
  return 'CASH'
}

function toReceiptPayment(
  payment: BillPaymentOut,
  patient: VisitWorkspacePatientStrip,
  visitId: number,
): PaymentOut {
  return {
    id: payment.id,
    receipt_number: payment.receipt_number,
    patient_id: patient.patient_id,
    patient_urn: patient.urn,
    patient_name: patient.full_name,
    patient_mobile: patient.mobile,
    patient_address: null,
    treatment_plan_id: null,
    treatment_plan_name: null,
    appointment_id: payment.appointment_id ?? null,
    visit_id: payment.visit_id ?? visitId,
    amount_paise: payment.amount_paise,
    payment_method: normalizePaymentMethod(payment.payment_method),
    notes: null,
    is_reversed: payment.is_reversed,
    reversal_reason: null,
    reversed_by_username: null,
    reversed_at: null,
    created_by_username: payment.created_by_username ?? 'staff',
    created_at: payment.created_at,
  }
}

function DiagnosisChip({ diag }: { diag: EncounterDiagnosisOut }) {
  const badgeClass =
    DIAGNOSIS_TYPE_BADGE[diag.diagnosis_type] ??
    'border border-slate-200 bg-slate-100 text-slate-800'
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${badgeClass}`}
    >
      <span className="font-bold">{diag.diagnosis_type}</span>
      {diag.icd10_code && (
        <span className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-900 ring-1 ring-inset ring-slate-300">
          {diag.icd10_code}
        </span>
      )}
      <span className="font-semibold text-slate-900">{diag.diagnosis_name}</span>
      <span className="rounded-full bg-white/75 px-1.5 py-0.5 text-xs font-medium text-slate-700">
        {diag.status}
      </span>
    </span>
  )
}

function SpecialtyTemplateCard({ summary }: { summary: WorkspaceTemplateSummaryOut }) {
  const entries = Object.entries(summary.response_data ?? {}).filter(
    ([, val]) => val !== null && val !== undefined && val !== '',
  )

  return (
    <div className="space-y-2.5 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-900">
            Specialty Template: {summary.template_name_en}
          </h4>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700 tabular-nums">
            {summary.template_code} v{summary.version_number}
          </span>
        </div>
        <span className="text-xs text-slate-600 tabular-nums">Updated {formatIst(summary.updated_at)}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-600">No structured template responses recorded.</p>
      ) : (
        <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([key, val]) => (
            <div
              key={key}
              className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2"
            >
              <dt className="text-xs font-medium text-slate-600">{formatTemplateKey(key)}</dt>
              <dd className="mt-0.5 break-words text-xs font-semibold text-slate-900">
                {formatTemplateValue(val)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function InvestigationOrderCard({
  order,
  loadingDocId,
  onOpenReport,
}: {
  order: InvestigationOrderOut
  loadingDocId: number | null
  onOpenReport: (documentId: number, title: string) => void
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200/90 bg-slate-50/50 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-900">{order.test_name}</span>
            <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900">
              {order.category}
            </span>
            {order.priority === 'URGENT' && (
              <span className="rounded border border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900">
                URGENT
              </span>
            )}
          </div>
          {order.instructions && (
            <p className="text-xs leading-relaxed text-slate-700">Instructions: {order.instructions}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${investigationStatusClass(order.status)}`}
          >
            {formatEnumLabel(order.status)}
          </span>
          <span className="text-xs text-slate-600 tabular-nums">{formatIst(order.ordered_at)}</span>
        </div>
      </div>

      {order.results.length > 0 ? (
        <ul className="divide-y divide-slate-200 border-t border-slate-200 pt-2">
          {order.results.map((result) => (
            <li
              key={result.id}
              className="flex flex-wrap items-start justify-between gap-3 py-2 text-xs first:pt-0 last:pb-0"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{result.summary_text}</span>
                  {result.is_abnormal && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900">
                      Abnormal
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-700">
                  {result.result_value && (
                    <span>
                      Value:{' '}
                      <strong className="font-mono text-slate-900 tabular-nums">
                        {result.result_value}
                        {result.unit ? ` ${result.unit}` : ''}
                      </strong>
                    </span>
                  )}
                  {result.reference_range && (
                    <span className="tabular-nums">Ref: {result.reference_range}</span>
                  )}
                  <span className="text-slate-600 tabular-nums">Reported {formatIst(result.reported_at)}</span>
                </div>
              </div>
              {result.document_id != null && (
                <button
                  type="button"
                  disabled={loadingDocId === result.document_id}
                  onClick={() =>
                    onOpenReport(
                      result.document_id!,
                      result.document_title || `${order.test_name} Report`,
                    )
                  }
                  className="inline-flex min-h-[34px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-[#8E1C3D] transition-colors duration-150 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                >
                  <IconReportMedical size={15} stroke={1.8} className="shrink-0" aria-hidden="true" />
                  {loadingDocId === result.document_id
                    ? 'Opening…'
                    : result.document_title
                      ? `View Report (${result.document_title})`
                      : 'View Report'}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-relaxed text-slate-600">No results recorded yet.</p>
      )}
    </div>
  )
}

function DoctorConsultationCard({
  consultation,
  loadingDocId,
  onOpenReport,
  onPreviewPrescription,
}: {
  consultation: VisitWorkspaceConsultationOut
  loadingDocId: number | null
  onOpenReport: (documentId: number, title: string) => void
  onPreviewPrescription: (rx: PrescriptionOut, departmentName?: string | null) => void
}) {
  const diagnoses = consultation.diagnoses ?? []
  const investigations = consultation.investigations ?? []
  const prescriptions = consultation.prescriptions ?? []
  const treatmentPlans = consultation.treatment_plans ?? []
  const addenda = consultation.addenda ?? []
  const clinicalCharges = consultation.clinical_charges ?? []

  return (
    <article
      aria-label={`Consultation with ${withDoctorTitle(consultation.doctor_name)}`}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
    >
      {/* Consultation Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3.5 sm:px-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {consultation.encounter_code ? (
              <span className="inline-flex items-center rounded-md bg-slate-900 px-2.5 py-0.5 font-mono text-xs font-semibold text-white tabular-nums">
                {consultation.encounter_code}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-800">
                No clinical encounter yet
              </span>
            )}
            {consultation.is_finalised !== null && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  consultation.is_finalised
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                {consultation.is_finalised ? 'Finalised' : 'Draft'}
              </span>
            )}
            {consultation.consultation_status && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${consultationStatusBadgeClass(consultation.consultation_status)}`}
              >
                {formatEnumLabel(consultation.consultation_status)}
              </span>
            )}
            {consultation.priority_level && consultation.priority_level !== 'NORMAL' && (
              <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-900">
                {consultation.priority_level}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-800">
            <span className="font-semibold text-slate-900">
              {withDoctorTitle(consultation.doctor_name)}
            </span>
            {consultation.department_name && (
              <span className="text-xs font-medium text-slate-600">
                {consultation.department_name}
              </span>
            )}
            <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
              Token: {formatToken(consultation.token_number)}
            </span>
            {consultation.visit_kind && (
              <span className="text-xs text-slate-600">
                {formatEnumLabel(consultation.visit_kind)}
              </span>
            )}
          </div>
        </div>

        {consultation.encounter_id != null && (
          <Link
            to={`/doctor/encounters/${consultation.encounter_id}`}
            className="inline-flex min-h-[38px] items-center rounded-lg bg-[#5D0B26] px-3.5 py-2 text-xs font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-[#7A1235] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
          >
            Open Authoring Workspace &rarr;
          </Link>
        )}
      </div>

      {/* Clinical Body: clean inset dividers instead of double-nested cards */}
      <div className="divide-y divide-slate-200 px-4 py-4 sm:px-5 sm:py-5">
        {/* Read-Only Vitals Snapshot */}
        {consultation.vitals && (
          <div className="py-4 first:pt-0 last:pb-0">
            <VitalsBiometricsSection
              vitals={consultation.vitals}
              onChange={NOOP_VITALS}
              readOnly
              serverBmi={consultation.vitals.bmi}
            />
          </div>
        )}

        {/* Chief Complaint / Symptoms & Clinical Notes */}
        {(consultation.encounter_id != null ||
          consultation.symptoms ||
          consultation.clinical_notes ||
          consultation.diagnosis) && (
          <div className="grid grid-cols-1 gap-5 py-4 first:pt-0 last:pb-0 lg:grid-cols-2">
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <IconNotes size={16} stroke={1.8} className="shrink-0 text-[#8E1C3D]" aria-hidden="true" />
                Chief Complaint / Symptoms
              </h4>
              <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {consultation.symptoms?.trim() || 'No chief complaint recorded.'}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                Clinical Notes
              </h4>
              <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {consultation.clinical_notes?.trim() || 'No clinical notes recorded.'}
              </p>
            </div>
          </div>
        )}

        {/* Structured Diagnoses + Legacy Diagnosis */}
        {(diagnoses.length > 0 || consultation.diagnosis) && (
          <div className="space-y-2.5 py-4 first:pt-0 last:pb-0">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <IconStethoscope
                size={16}
                stroke={1.8}
                className="shrink-0 text-[#8E1C3D]"
                aria-hidden="true"
              />
              Diagnoses
            </h4>
            {diagnoses.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {diagnoses.map((diag) => (
                  <DiagnosisChip key={diag.id} diag={diag} />
                ))}
              </div>
            )}
            {consultation.diagnosis && (
              <p className="max-w-prose text-xs leading-relaxed text-slate-700">
                <span className="font-semibold text-slate-800">Clinical impression:</span>{' '}
                <span className="whitespace-pre-wrap">{consultation.diagnosis}</span>
              </p>
            )}
          </div>
        )}

        {/* Specialty Template Summary */}
        {consultation.template_response_summary && (
          <SpecialtyTemplateCard summary={consultation.template_response_summary} />
        )}

        {/* Investigations & Results */}
        {investigations.length > 0 && (
          <div className="space-y-3 py-4 first:pt-0 last:pb-0">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 tabular-nums">
              <IconActivity size={16} stroke={1.8} className="shrink-0 text-[#8E1C3D]" aria-hidden="true" />
              Investigations &amp; Results ({investigations.length})
            </h4>
            <div className="space-y-3">
              {investigations.map((order) => (
                <InvestigationOrderCard
                  key={order.id}
                  order={order}
                  loadingDocId={loadingDocId}
                  onOpenReport={onOpenReport}
                />
              ))}
            </div>
          </div>
        )}

        {/* Versioned Prescriptions */}
        {prescriptions.length > 0 && (
          <div className="space-y-3 py-4 first:pt-0 last:pb-0">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 tabular-nums">
              <IconPrescription
                size={16}
                stroke={1.8}
                className="shrink-0 text-[#8E1C3D]"
                aria-hidden="true"
              />
              Prescriptions ({prescriptions.length})
            </h4>
            <div className="space-y-3">
              {prescriptions.map((rx) => {
                const statusBadge = prescriptionStatusBadge(rx.status)
                const canPrint = rx.status === 'AUTHORISED' && rx.is_printable !== false
                return (
                  <div
                    key={rx.id}
                    className="space-y-2.5 rounded-lg border border-slate-200/90 bg-slate-50/50 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs font-semibold text-white tabular-nums">
                          v{rx.revision_number ?? 1}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge.className}`}
                        >
                          {statusBadge.label}
                        </span>
                        <span className="text-xs text-slate-600 tabular-nums">{formatIst(rx.created_at)}</span>
                      </div>
                      {canPrint ? (
                        <button
                          type="button"
                          onClick={() => onPreviewPrescription(rx, consultation.department_name)}
                          className="inline-flex min-h-[34px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                        >
                          <IconPrinter size={15} stroke={1.8} className="shrink-0" aria-hidden="true" />
                          Preview / Print Rx
                        </button>
                      ) : (
                        <span className="inline-flex min-h-[34px] shrink-0 items-center whitespace-nowrap rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                          Not printable ({statusBadge.label})
                        </span>
                      )}
                    </div>
                    {rx.diagnosis && (
                      <p className="text-xs leading-relaxed text-slate-800">
                        <span className="font-semibold text-slate-700">Rx Diagnosis:</span>{' '}
                        {rx.diagnosis}
                      </p>
                    )}
                    {rx.items.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                        <table className="w-full text-left text-xs text-slate-800">
                          <thead className="border-b border-slate-200 bg-slate-50 font-medium text-slate-700">
                            <tr>
                              <th scope="col" className="px-4 py-2.5">
                                Medicine
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
                              <th scope="col" className="px-4 py-2.5">
                                Instructions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rx.items.map((item) => (
                              <tr key={item.id}>
                                <td className="px-4 py-2.5 font-semibold text-slate-900">
                                  {item.medicine_name}
                                  {item.strength ? ` (${item.strength})` : ''}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{item.dosage}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 font-medium tabular-nums">{item.frequency}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                                  {item.duration_days} {item.duration_days === 1 ? 'day' : 'days'}
                                </td>
                                <td className="px-4 py-2.5 text-slate-700">
                                  {item.instructions || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {rx.amendment_reason && (
                      <p className="text-xs leading-relaxed text-amber-900">
                        Amendment note: {rx.amendment_reason}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Treatment Plans Summary */}
        {treatmentPlans.length > 0 && (
          <div className="space-y-2.5 py-4 first:pt-0 last:pb-0">
            <h4 className="text-sm font-semibold text-slate-900 tabular-nums">
              Treatment Plans ({treatmentPlans.length})
            </h4>
            <ul className="divide-y divide-slate-100">
              {treatmentPlans.map((plan) => (
                <li
                  key={plan.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{plan.plan_name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        {plan.status}
                      </span>
                    </div>
                    <p className="text-slate-700 tabular-nums">
                      {plan.condition_diagnosis} · {plan.completed_sessions} / {plan.total_sessions}{' '}
                      sessions completed
                    </p>
                  </div>
                  <Link
                    to={`/doctor/treatment-plans/${plan.id}`}
                    className="inline-flex min-h-[34px] shrink-0 items-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 font-medium text-[#8E1C3D] transition-colors duration-150 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                  >
                    Open Plan &rarr;
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Follow-up Recommendation */}
        {consultation.follow_up && (
          <div className="space-y-1.5 py-4 text-xs first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">
                Follow-up Recommendation
              </h4>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-800">
                {formatEnumLabel(consultation.follow_up.status)}
              </span>
            </div>
            <p className="leading-relaxed text-slate-800">
              Recommended date:{' '}
              <strong className="text-slate-900 tabular-nums">
                {formatIstDateOnly(consultation.follow_up.recommended_date)}
              </strong>{' '}
              with{' '}
              <strong className="text-slate-900">
                {withDoctorTitle(consultation.follow_up.recommended_doctor_name)}
              </strong>
            </p>
            {consultation.follow_up.clinical_reason && (
              <p className="max-w-prose leading-relaxed text-slate-700">
                Reason: {consultation.follow_up.clinical_reason}
              </p>
            )}
          </div>
        )}

        {/* Dated Addenda */}
        {addenda.length > 0 && (
          <div className="py-4 first:pt-0 last:pb-0">
            <div className="space-y-2.5 rounded-lg border border-sky-200 bg-sky-50/40 p-3.5">
              <h4 className="text-sm font-semibold text-sky-900 tabular-nums">
                Dated Addenda ({addenda.length})
              </h4>
              <ul className="divide-y divide-sky-200/60">
                {addenda.map((addendum) => (
                  <li key={addendum.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        {withDoctorTitle(addendum.doctor_name)}
                      </span>
                      <span className="text-slate-600 tabular-nums">{formatIst(addendum.created_at)}</span>
                    </div>
                    <p className="mt-1 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {addendum.addendum_text}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Own Clinical Charges Summary (Q13 — strictly read-only, zero payment collection controls) */}
        {clinicalCharges.length > 0 && (
          <div className="space-y-2.5 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900 tabular-nums">
                Clinical Charges ({clinicalCharges.length})
              </h4>
              <span className="text-xs text-slate-600">
                Read-only consultation &amp; doctor-authored charges
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs text-slate-800">
                <thead className="border-b border-slate-200 bg-slate-50 font-medium text-slate-700">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">
                      Description
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                      Category
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right">
                      Qty &times; Rate
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clinicalCharges.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {line.description}
                        {line.unit ? ` (${line.unit})` : ''}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                        {formatEnumLabel(line.category)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                        {line.quantity} &times; {formatSafePaise(line.rate_paise)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {formatSafePaise(line.amount_paise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

export function VisitWorkspacePage() {
  const { id, visitId } = useParams<{ id: string; visitId: string }>()
  const validPatientId = parsePositiveId(id)
  const validVisitId = parsePositiveId(visitId)

  const { data: me } = useMe()
  const role: Role = me?.role ?? 'RECEPTION'
  const isDoctor = role === 'DOCTOR'
  const isReception = role === 'RECEPTION'
  const canViewBilling = role === 'ADMIN' || role === 'RECEPTION'

  const {
    data: workspace,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useVisitWorkspace(validPatientId, validVisitId)

  const [previewPrescription, setPreviewPrescription] = useState<{
    prescription: PrescriptionOut
    departmentName?: string | null
  } | null>(null)
  const [receiptPayment, setReceiptPayment] = useState<PaymentOut | null>(null)
  const [loadingDocId, setLoadingDocId] = useState<number | null>(null)
  const [imagePreview, setImagePreview] = useState<{
    title: string
    filename: string
    url: string
  } | null>(null)

  useEffect(() => {
    const urlToRevoke = imagePreview?.url
    return () => {
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke)
      }
    }
  }, [imagePreview?.url])

  const closeImagePreview = () => {
    setImagePreview(null)
  }

  const handleOpenReport = async (documentId: number, title: string) => {
    setLoadingDocId(documentId)
    try {
      const { url, filename, contentType } = await downloadPatientDocumentBlob(documentId)
      if (contentType.startsWith('image/')) {
        setImagePreview({ title, filename, url })
      } else {
        const opened = window.open(url, '_blank', 'noopener,noreferrer')
        if (!opened) {
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = filename
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
        }
        // Delay revocation so a newly opened browser PDF viewer tab can read the blob URL.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to open the attached report.')
    } finally {
      setLoadingDocId(null)
    }
  }

  const handleReprintPayment = (paymentId: number) => {
    if (!workspace?.financial_summary) return
    const found = workspace.financial_summary.payments.find((p) => p.id === paymentId)
    if (found) {
      setReceiptPayment(toReceiptPayment(found, workspace.patient, workspace.visit.visit_id))
    }
  }

  if (validPatientId === null || validVisitId === null) {
    return (
      <AppShell name={me?.full_name || 'Staff'} role={role}>
        <div className="mx-auto w-full max-w-[1400px] space-y-4">
          <InlineAlert tone="error">
            Invalid patient or visit identifier in the URL.
          </InlineAlert>
          <Link
            to="/reception/patients"
            className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-[#8E1C3D] hover:underline"
          >
            <IconArrowLeft size={16} stroke={1.8} aria-hidden="true" />
            Return to Patient Records
          </Link>
        </div>
      </AppShell>
    )
  }

  const patient = workspace?.patient ?? null
  const visit = workspace?.visit ?? null
  const consultations = workspace?.consultations ?? []
  const financialSummary = canViewBilling ? (workspace?.financial_summary ?? null) : null
  const showAllergyAlert =
    (role === 'DOCTOR' || role === 'RECEPTION') &&
    Boolean(patient?.allergy_alert?.has_allergies)
  const allergyAlert = showAllergyAlert ? patient?.allergy_alert ?? null : null
  const allergyIsHighSeverity =
    allergyAlert?.highest_severity === 'SEVERE' ||
    allergyAlert?.highest_severity === 'LIFE_THREATENING'

  return (
    <AppShell name={me?.full_name || 'Staff'} role={role}>
      <div className="mx-auto w-full max-w-[1440px] space-y-5">
        {/* Top Navigation Back Link */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to={`/reception/patients/${validPatientId}?tab=visits`}
            className="inline-flex min-h-[38px] items-center gap-1.5 text-sm font-medium text-[#8E1C3D] transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
          >
            <IconArrowLeft size={16} stroke={1.8} className="shrink-0" aria-hidden="true" />
            Back to Patient Record
          </Link>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh visit workspace"
            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-2xs transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
          >
            <IconRefresh size={15} stroke={1.8} className="shrink-0" aria-hidden="true" />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {isPending ? (
          <TableSkeleton label="Loading visit workspace..." rows={5} columns={4} />
        ) : isError ? (
          <InlineAlert tone="error">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Could not load visit workspace{error?.message ? `: ${error.message}` : '.'}
              </span>
              <button
                type="button"
                onClick={() => void refetch()}
                className="cursor-pointer rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-900 transition-colors duration-150 hover:bg-red-50"
              >
                Retry
              </button>
            </div>
          </InlineAlert>
        ) : !workspace || !patient || !visit ? (
          <InlineAlert tone="info">Visit workspace data was not found.</InlineAlert>
        ) : (
          <>
            {/* Compact Patient Identity Strip */}
            <header
              aria-label="Patient identity strip"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center rounded-md bg-[#5D0B26] px-2.5 py-1 font-mono text-xs font-semibold tracking-wide text-white tabular-nums">
                    {patient.urn}
                  </span>
                  <h1 className="text-xl font-semibold tracking-tight leading-tight text-slate-900 sm:text-2xl">
                    {patient.full_name}
                  </h1>
                  {patient.merged_into_id ? (
                    <Link
                      to={`/reception/patients/${patient.merged_into_id}`}
                      className="inline-flex min-h-7 items-center rounded-full border border-amber-300 bg-amber-100 px-2.5 text-xs font-medium text-amber-900 hover:underline"
                    >
                      Merged into{' '}
                      {patient.merged_into_urn ?? `Patient #${patient.merged_into_id}`}
                    </Link>
                  ) : patient.is_archived ? (
                    <span className="inline-flex min-h-7 items-center rounded-full border border-slate-300 bg-slate-200 px-2.5 text-xs font-medium text-slate-800">
                      Archived
                    </span>
                  ) : !patient.is_active ? (
                    <span className="inline-flex min-h-7 items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 text-xs font-medium text-slate-700">
                      Inactive
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-700">
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <IconCalendar size={15} stroke={1.8} className="shrink-0 text-[#8E1C3D]" aria-hidden="true" />
                    {patient.computed_age_years} yrs · {GENDER_LABEL[patient.gender] ?? patient.gender}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-slate-900 tabular-nums">
                    <IconPhone size={15} stroke={1.8} className="shrink-0 text-[#8E1C3D]" aria-hidden="true" />
                    {patient.mobile}
                  </span>
                </div>
              </div>

              {/* Role-adapted allergy alert pill (DOCTOR & RECEPTION only; strictly omitted for ADMIN) */}
              {allergyAlert && (
                <div
                  role="region"
                  aria-label={isDoctor ? 'Active clinical allergies' : 'Allergy safety alert'}
                  className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    allergyIsHighSeverity
                      ? 'border-rose-300 bg-rose-50 text-rose-900'
                      : 'border-amber-300 bg-amber-50 text-amber-900'
                  }`}
                >
                  <IconAlertTriangle size={16} stroke={1.8} className="shrink-0" aria-hidden="true" />
                  <span className="font-semibold tabular-nums">
                    {isDoctor ? 'Allergy Alert' : 'Allergy Safety Alert'} ({allergyAlert.count})
                  </span>
                  {allergyAlert.highest_severity && (
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[allergyAlert.highest_severity]}`}
                    >
                      {SEVERITY_LABEL[allergyAlert.highest_severity]}
                    </span>
                  )}
                  {allergyAlert.alert_labels.map((label) => (
                    <span
                      key={label}
                      className="rounded-md border border-current/20 bg-white/85 px-2 py-0.5 font-semibold text-slate-900"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </header>

            {/* Visit Header Card */}
            <section
              aria-label="Visit summary"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-0.5 font-mono text-sm font-semibold text-slate-900 ring-1 ring-inset ring-slate-200 tabular-nums">
                      {visit.visit_code}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${visitStatusBadgeClass(visit.status)}`}
                    >
                      {visit.status}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-600">
                    Visit Date:{' '}
                    <strong className="font-semibold text-slate-900 tabular-nums">
                      {formatIstDateOnly(visit.visit_date)}
                    </strong>
                  </p>
                </div>

                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                  <div>
                    <dt className="font-medium text-slate-600">Token(s)</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                      {visit.token_numbers.length > 0
                        ? visit.token_numbers.map((t) => formatToken(t)).join(', ')
                        : '—'}
                    </dd>
                  </div>
                  {(visit.referral_source || visit.referrer_name) && (
                    <div>
                      <dt className="font-medium text-slate-600">Referral</dt>
                      <dd className="mt-0.5 font-semibold text-slate-900">
                        {visit.referral_source
                          ? (REFERRAL_LABEL[visit.referral_source] ??
                            formatEnumLabel(visit.referral_source))
                          : 'Referred'}
                        {visit.referrer_name ? ` · ${visit.referrer_name}` : ''}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="font-medium text-slate-600">Consultations</dt>
                    <dd className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                      {consultations.length}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            {/* Role-Adapted Workspace Body */}
            {isDoctor ? (
              <section aria-labelledby="doctor-visit-consultations-heading" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="doctor-visit-consultations-heading"
                    className="text-base font-semibold tracking-tight text-slate-900 tabular-nums"
                  >
                    Clinical Consultations ({consultations.length})
                  </h2>
                </div>

                {consultations.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm leading-relaxed text-slate-600 shadow-2xs">
                    No consultations are linked to this visit yet.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {consultations.map((consultation, index) => (
                      <DoctorConsultationCard
                        key={
                          consultation.encounter_id ??
                          consultation.appointment_id ??
                          `${consultation.doctor_id}-${index}`
                        }
                        consultation={consultation}
                        loadingDocId={loadingDocId}
                        onOpenReport={handleOpenReport}
                        onPreviewPrescription={(rx, departmentName) =>
                          setPreviewPrescription({ prescription: rx, departmentName })
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <div className="space-y-5">
                {/* RECEPTION & ADMIN: Consultation Status Timeline (zero clinical leakage per D-04) */}
                <section
                  aria-labelledby="admin-reception-consultations-heading"
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
                    <h2
                      id="admin-reception-consultations-heading"
                      className="text-base font-semibold tracking-tight text-slate-900 tabular-nums"
                    >
                      Consultation Status Timeline ({consultations.length})
                    </h2>
                    <span className="text-xs text-slate-600">
                      Administrative queue &amp; doctor assignment summary
                    </span>
                  </div>

                  {consultations.length === 0 ? (
                    <p className="p-4 text-sm leading-relaxed text-slate-600 sm:p-5">
                      No doctor consultations recorded on this visit yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm text-slate-800">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-700">
                          <tr>
                            <th scope="col" className="px-4 py-2.5">
                              Doctor
                            </th>
                            <th scope="col" className="px-4 py-2.5">
                              Department
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                              Token
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                              Visit Kind
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {consultations.map((c, index) => (
                            <tr key={c.appointment_id ?? `${c.doctor_id}-${index}`}>
                              <td className="px-4 py-2.5 font-semibold text-slate-900">
                                {withDoctorTitle(c.doctor_name)}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-slate-700">
                                {c.department_name || '—'}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                {formatToken(c.token_number)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">
                                {formatEnumLabel(c.visit_kind)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5">
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${consultationStatusBadgeClass(c.consultation_status)}`}
                                >
                                  {formatEnumLabel(c.consultation_status ?? 'SCHEDULED')}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* RECEPTION & ADMIN: Visit Billing, Payments & Refunds */}
                <section aria-labelledby="visit-billing-heading" className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id="visit-billing-heading" className="text-base font-semibold tracking-tight text-slate-900">
                        Visit Billing &amp; Payments
                      </h2>
                      {financialSummary && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${paymentStatusBadge(financialSummary.payment_status).className}`}
                        >
                          {paymentStatusBadge(financialSummary.payment_status).label}
                        </span>
                      )}
                    </div>

                    {isReception && (
                      <Link
                        to={`/reception/billing?visit_id=${visit.visit_id}`}
                        className="inline-flex min-h-[38px] items-center rounded-lg bg-[#5D0B26] px-4 py-2 text-xs font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-[#7A1235] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                      >
                        Open Billing &amp; Checkout &rarr;
                      </Link>
                    )}
                  </div>

                  {/* Full Visit Bill via existing BillPanel */}
                  <BillPanel visitId={visit.visit_id} onReprint={handleReprintPayment} />

                  {/* Visit Payments & Receipts (with ReceiptDialog preview/print) */}
                  {financialSummary && financialSummary.payments.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                      <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
                        <h3 className="text-sm font-semibold tracking-tight text-slate-900 tabular-nums">
                          Recorded Payment Receipts ({financialSummary.payments.length})
                        </h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-slate-800">
                          <thead className="border-b border-slate-200 bg-slate-50 font-medium text-slate-700">
                            <tr>
                              <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                                Receipt #
                              </th>
                              <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                                Date &amp; Time (IST)
                              </th>
                              <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                                Method
                              </th>
                              <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right">
                                Amount
                              </th>
                              <th scope="col" className="whitespace-nowrap px-4 py-2.5">
                                Status
                              </th>
                              <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {financialSummary.payments.map((payment) => (
                              <tr key={payment.id}>
                                <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold text-slate-900 tabular-nums">
                                  {payment.receipt_number}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-slate-700 tabular-nums">
                                  {formatIst(payment.created_at)}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5">
                                  <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-800">
                                    {payment.payment_method}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-800">
                                  {formatSafePaise(payment.amount_paise)}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5">
                                  {payment.is_reversed ? (
                                    <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-800 ring-1 ring-inset ring-red-200">
                                      Reversed
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                                      Active
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setReceiptPayment(
                                        toReceiptPayment(payment, patient, visit.visit_id),
                                      )
                                    }
                                    aria-label={`Print Receipt ${payment.receipt_number}`}
                                    className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                                  >
                                    <IconPrinter size={14} stroke={1.8} className="shrink-0" aria-hidden="true" />
                                    Print Receipt
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Refunds Issued on This Visit */}
                  {financialSummary && financialSummary.refunds.length > 0 && (
                    <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-2xs sm:p-5">
                      <h3 className="text-sm font-semibold tracking-tight text-amber-900 tabular-nums">
                        Issued Refunds ({financialSummary.refunds.length})
                      </h3>
                      <ul className="divide-y divide-amber-200/70 text-xs text-slate-800">
                        {financialSummary.refunds.map((refund) => (
                          <li
                            key={refund.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                          >
                            <div className="space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                  {refund.refund_number}
                                </span>
                                {refund.payment_receipt_number && (
                                  <span className="text-slate-600 tabular-nums">
                                    against {refund.payment_receipt_number}
                                  </span>
                                )}
                                <span className="rounded bg-white px-1.5 py-0.5 font-medium text-slate-700 ring-1 ring-inset ring-amber-200">
                                  {refund.refund_method}
                                </span>
                              </div>
                              <p className="leading-relaxed text-slate-700 tabular-nums">
                                {refund.reason} · by {refund.refunded_by_username} ·{' '}
                                {formatIst(refund.created_at)}
                              </p>
                            </div>
                            <span className="whitespace-nowrap font-mono font-semibold tabular-nums text-amber-900">
                              {formatSafePaise(refund.amount_paise)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>

      {/* Doctor Prescription Print Preview Modal */}
      {isDoctor && previewPrescription && (
        <PrescriptionPrint
          prescription={previewPrescription.prescription}
          departmentName={previewPrescription.departmentName}
          onClose={() => setPreviewPrescription(null)}
        />
      )}

      {/* Reception / Admin Payment Receipt Reprint Dialog */}
      {canViewBilling && receiptPayment && (
        <ReceiptDialog
          payment={receiptPayment}
          isReprint
          onClose={() => setReceiptPayment(null)}
        />
      )}

      {/* CSP-safe Image Report Preview Modal (zero <iframe>) */}
      {imagePreview && (
        <Modal
          open
          onClose={closeImagePreview}
          title={imagePreview.title}
          dismiss="any"
          className="max-w-4xl"
        >
          <div className="space-y-4">
            <div className="flex justify-end">
              <a
                href={imagePreview.url}
                download={imagePreview.filename}
                className="inline-flex min-h-10 items-center rounded-lg bg-[#5D0B26] px-4 text-xs font-semibold text-white hover:bg-[#7A1235]"
              >
                Download ({imagePreview.filename})
              </a>
            </div>
            <div className="flex justify-center overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              <img
                src={imagePreview.url}
                alt={imagePreview.title}
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
