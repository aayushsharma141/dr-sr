import { useState } from 'react'
import { Link } from 'react-router'
import { usePatientTreatmentPlans, useTreatmentSessions } from '../../api/queries'
import type { Role, TreatmentPlanOut } from '../../api/types'
import { formatIst, formatPaise, withDoctorTitle } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { PatientTimeline } from '../PatientTimeline'
import { VasTrendChart } from '../VasTrendChart'
import { IconChevronDown, IconChevronRight, IconRefresh } from '../icons'

export interface PatientTreatmentPlansTabProps {
  patientId: number
  role: Role
  permissions: string[]
}

const IST_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatSessionDateIst(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '—'
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+05:30`)
    : new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return IST_DATE_FORMATTER.format(parsed)
}

function planStatusBadgeClass(status: string): string {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return 'border border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'COMPLETED':
      return 'border border-sky-200 bg-sky-50 text-sky-900'
    case 'CANCELLED':
      return 'border border-rose-200 bg-rose-50 text-rose-900'
    default:
      return 'border border-slate-200 bg-slate-100 text-slate-800'
  }
}

function PlanSessionLog({ planId }: { planId: number }) {
  const { data: sessions, isPending, isError, error, refetch } = useTreatmentSessions(planId)

  if (isPending) {
    return (
      <p role="status" className="py-3 text-xs text-slate-600">
        Loading clinical session log…
      </p>
    )
  }

  if (isError) {
    return (
      <InlineAlert tone="error">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Unable to load session history{error?.message ? `: ${error.message}` : '.'}
          </span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 hover:bg-red-50 cursor-pointer"
          >
            Retry
          </button>
        </div>
      </InlineAlert>
    )
  }

  const list = Array.isArray(sessions) ? sessions : []
  if (list.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        No treatment sessions logged under this plan yet.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <VasTrendChart sessions={list} />

      <div className="space-y-2.5">
        <h4 className="text-sm font-semibold tracking-tight tabular-nums text-slate-900">
          Clinical Session History ({list.length})
        </h4>

        <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/40">
          {list.map((sess) => (
            <div key={sess.id} className="space-y-2.5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="rounded-full bg-teal-800 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-white">
                    Session #{sess.session_number}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-slate-700">
                    {formatSessionDateIst(sess.session_date)}
                  </span>
                  {sess.doctor_name && (
                    <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
                      · {withDoctorTitle(sess.doctor_name)}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-900">
                    VAS: {sess.vas_score}/10
                  </span>
                  {sess.is_finalised && (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      Finalised
                    </span>
                  )}
                </div>
              </div>

              {sess.modalities && sess.modalities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sess.modalities.map((mod) => (
                    <span
                      key={mod}
                      className="rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800"
                    >
                      {mod}
                    </span>
                  ))}
                </div>
              )}

              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {sess.clinical_notes}
              </p>

              {sess.addenda && sess.addenda.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-200 pt-2.5">
                  <p className="text-xs font-semibold tabular-nums text-amber-900">
                    Addenda ({sess.addenda.length})
                  </p>
                  {sess.addenda.map((ad, idx) => (
                    <div
                      key={ad.id}
                      className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-slate-800"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-amber-900">
                        <span className="tabular-nums">
                          #{idx + 1} {ad.author_name}
                        </span>
                        <span className="font-mono tabular-nums">{formatIst(ad.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{ad.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DoctorTreatmentPlansPanel({
  patientId,
  canCreatePlan,
}: {
  patientId: number
  canCreatePlan: boolean
}) {
  const { data, isPending, isError, error, refetch, isFetching } =
    usePatientTreatmentPlans(patientId)
  const [toggledPlans, setToggledPlans] = useState<Record<string, boolean>>({})

  const plans: TreatmentPlanOut[] = Array.isArray(data) ? data : []
  const defaultExpandedPlanId =
    plans.find((plan) => plan.status === 'ACTIVE')?.id ?? plans[0]?.id ?? null

  const isPlanExpanded = (planId: number): boolean => {
    const key = `${patientId}:${planId}`
    if (key in toggledPlans) return toggledPlans[key]
    return planId === defaultExpandedPlanId
  }

  const togglePlan = (planId: number) => {
    const key = `${patientId}:${planId}`
    setToggledPlans((prev) => ({
      ...prev,
      [key]: !(key in prev ? prev[key] : planId === defaultExpandedPlanId),
    }))
  }

  return (
    <section aria-labelledby="patient-treatment-plans-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0">
          <h2 id="patient-treatment-plans-heading" className="text-base font-semibold tracking-tight text-slate-900">
            Treatment Plans &amp; Physiotherapy Progress
          </h2>
          <p className="mt-0.5 text-xs tabular-nums text-slate-600">
            {plans.length > 0
              ? `${plans.length} treatment ${plans.length === 1 ? 'plan' : 'plans'} recorded`
              : 'Multi-session rehabilitation packages, session logs, and VAS pain trends'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canCreatePlan && (
            <Link
              to={`/doctor/treatment-plans?patient_id=${patientId}`}
              className="inline-flex min-h-[38px] items-center rounded-lg bg-[#5D0B26] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#7A1235] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
            >
              Manage Treatment Plans &rarr;
            </Link>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh treatment plans"
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
          >
            <IconRefresh size={15} stroke={1.8} aria-hidden="true" />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {isPending ? (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-600 shadow-2xs"
        >
          Loading treatment plans…
        </div>
      ) : isError ? (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Could not load treatment plans{error?.message ? `: ${error.message}` : '.'}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label="Retry loading treatment plans"
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 transition-colors duration-150 hover:bg-red-50 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </InlineAlert>
      ) : plans.length === 0 ? (
        <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-2xs">
          <p className="text-sm font-medium text-slate-700">
            No treatment plans recorded for this patient yet.
          </p>
          <p className="text-xs text-slate-600">
            Physiotherapy or multi-session rehabilitation packages will appear here once created.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => {
            const expanded = isPlanExpanded(plan.id)
            const completionPct =
              plan.total_sessions > 0
                ? Math.min(100, Math.round((plan.completed_sessions / plan.total_sessions) * 100))
                : 0

            return (
              <article
                key={plan.id}
                aria-label={`Treatment plan ${plan.plan_name}`}
                className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-3.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-900 sm:text-base">
                        {plan.plan_name}
                      </h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${planStatusBadgeClass(plan.status)}`}
                      >
                        {plan.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">Condition:</span>{' '}
                      {plan.condition_diagnosis}
                      {plan.referred_by ? ` · Ref: ${plan.referred_by}` : ''}
                    </p>
                    <p className="text-xs tabular-nums text-slate-600">
                      {plan.doctor_name ? `${withDoctorTitle(plan.doctor_name)} · ` : ''}
                      Created {formatIst(plan.created_at)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-3.5">
                    <div className="text-right">
                      <span className="block text-xs text-slate-600">Agreed Package Fee</span>
                      <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {formatPaise(plan.agreed_price_paise)}
                      </span>
                    </div>
                    <Link
                      to={`/doctor/treatment-plans/${plan.id}`}
                      aria-label={`Open treatment plan workspace for ${plan.plan_name}`}
                      className="inline-flex min-h-[38px] items-center rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-[#8E1C3D] transition-colors duration-150 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                    >
                      Open Workspace &rarr;
                    </Link>
                  </div>
                </div>

                {/* Session Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                    <span className="text-slate-700">Session Progress</span>
                    <span className="font-mono tabular-nums text-teal-800">
                      {plan.completed_sessions} / {plan.total_sessions} sessions ({completionPct}%)
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`Session progress for ${plan.plan_name}`}
                    aria-valuenow={completionPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200"
                  >
                    <div
                      className="h-full rounded-full bg-teal-700 transition-all duration-300"
                      style={{ width: `${completionPct}%` }}
                    />
                  </div>
                </div>

                {plan.cancellation_reason && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-900">
                    <span className="font-semibold">Cancelled:</span> {plan.cancellation_reason}
                  </p>
                )}

                {/* Expandable Clinical Session Log + VAS Trend Chart */}
                <div className="border-t border-slate-100 pt-3.5">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => togglePlan(plan.id)}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
                  >
                    {expanded ? (
                      <IconChevronDown size={15} stroke={1.8} aria-hidden="true" />
                    ) : (
                      <IconChevronRight size={15} stroke={1.8} aria-hidden="true" />
                    )}
                    {expanded
                      ? 'Hide Clinical Session Log & VAS Trend'
                      : 'View Clinical Session Log & VAS Trend'}
                  </button>

                  {expanded && (
                    <div className="mt-4">
                      <PlanSessionLog planId={plan.id} />
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function PatientTreatmentPlansTab({
  patientId,
  role,
  permissions,
}: PatientTreatmentPlansTabProps) {
  // Strict D-04 isolation: Reception/Admin never mount DoctorTreatmentPlansPanel
  // and therefore never call usePatientTreatmentPlans or useTreatmentSessions.
  const canReadClinicalPlans = role === 'DOCTOR' && permissions.includes('plan:read')

  if (canReadClinicalPlans) {
    return (
      <DoctorTreatmentPlansPanel
        patientId={patientId}
        canCreatePlan={permissions.includes('plan:write')}
      />
    )
  }

  return (
    <section aria-labelledby="patient-treatment-timeline-heading" className="space-y-5">
      <div>
        <h2
          id="patient-treatment-timeline-heading"
          className="text-base font-semibold tracking-tight text-slate-900"
        >
          Treatment Plans &amp; Session Progress
        </h2>
        <p className="mt-0.5 text-xs text-slate-600">
          Non-clinical package milestones and session activity for reception and administrative
          coordination.
        </p>
      </div>

      <PatientTimeline
        patientId={patientId}
        eventTypes={['TREATMENT_PLAN', 'TREATMENT_SESSION']}
        heading="Treatment Plan & Session Activity"
      />
    </section>
  )
}
