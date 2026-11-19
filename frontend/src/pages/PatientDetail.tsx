import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuditLogs, useMe, usePatient, usePatientSummary } from '../api/queries'
import type { Role } from '../api/types'
import { AppShell } from '../components/AppShell'
import { toast } from '../components/ToastHost'
import { PatientBillingLedgerTab } from '../components/patient/PatientBillingLedgerTab'
import { PatientClinicalRecordsTab } from '../components/patient/PatientClinicalRecordsTab'
import { PatientDocumentsTab } from '../components/patient/PatientDocumentsTab'
import { PatientIdentityHeader } from '../components/patient/PatientIdentityHeader'
import { PatientInvestigationsTab } from '../components/patient/PatientInvestigationsTab'
import { PatientOverviewTab } from '../components/patient/PatientOverviewTab'
import { PatientPrescriptionsTab } from '../components/patient/PatientPrescriptionsTab'
import { PatientTreatmentPlansTab } from '../components/patient/PatientTreatmentPlansTab'
import { PatientVisitHistoryTab } from '../components/patient/PatientVisitHistoryTab'

export type PatientDetailTab =
  | 'overview'
  | 'visits'
  | 'clinical'
  | 'prescriptions'
  | 'investigations'
  | 'therapy'
  | 'billing'
  | 'documents'
  | 'audit'

interface TabDefinition {
  key: PatientDetailTab
  label: string
}

function PatientAuditHistory({ patientId }: { patientId: number }) {
  const { data, isPending, isError, error, refetch } = useAuditLogs({
    entity_type: 'patient',
    entity_id: String(patientId),
    page: 1,
    page_size: 50,
  })

  if (isPending) {
    return (
      <div className="p-8 text-center text-sm text-slate-600" role="status">
        Loading patient audit history…
      </div>
    )
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
        Unable to load audit history: {error.message}
      </div>
    )
  }

  const records = data?.items ?? []
  return (
    <section className="space-y-3" aria-label="Patient audit history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">Patient audit history</h2>
          <p className="mt-1 text-xs text-slate-600">Admin access · audit events for this record</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer transition-colors"
        >
          Refresh
        </button>
      </div>
      {records.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
          No patient-specific audit events were found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3">Date &amp; time</th>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-xs text-slate-600">
                    {new Date(record.occurred_at).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-800">{record.actor_username || 'System'}</span>
                    <span className="ml-1 text-xs text-slate-600">{record.actor_role || ''}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{record.action}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${
                        record.outcome === 'SUCCESS'
                          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                          : 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'
                      }`}
                    >
                      {record.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.total > records.length && (
            <p className="border-t border-slate-100 px-4 py-3 tabular-nums text-xs text-slate-600">
              Showing the latest {records.length} of {data.total} audit events. Open the Audit Logs workspace for full pagination.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export function PatientDetail() {
  const { id } = useParams<{ id: string }>()
  const patientId = Number(id)
  const validPatientId = !Number.isNaN(patientId) && patientId > 0 ? patientId : null

  const { data: me } = useMe()
  const { data: patient, isPending, isError, error } = usePatient(validPatientId)
  const {
    data: summary,
    isPending: summaryLoading,
    isError: summaryError,
  } = usePatientSummary(validPatientId)

  const role: Role = me?.role ?? 'RECEPTION'
  const permissions = useMemo(() => me?.permissions ?? [], [me?.permissions])

  // Editing happens in the registration form, which returns here with a one-time notice.
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const visibleTabs = useMemo<TabDefinition[]>(() => {
    const currentRole = me?.role
    const tabs: TabDefinition[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'visits', label: 'Visit History' },
    ]
    if (currentRole === 'DOCTOR' && permissions.includes('encounter:read')) {
      tabs.push({ key: 'clinical', label: 'Clinical Records' })
    }
    if (currentRole === 'DOCTOR' && permissions.includes('prescription:read')) {
      tabs.push({ key: 'prescriptions', label: 'Prescriptions' })
    }
    if (currentRole === 'DOCTOR' && permissions.includes('encounter:read')) {
      tabs.push({ key: 'investigations', label: 'Investigations' })
    }
    tabs.push({ key: 'therapy', label: 'Treatment Plans' })
    if ((currentRole === 'ADMIN' || currentRole === 'RECEPTION') && permissions.includes('payment:read')) {
      tabs.push({ key: 'billing', label: 'Billing & Ledger' })
    }
    tabs.push({ key: 'documents', label: 'Documents' })
    if (currentRole === 'ADMIN' && permissions.includes('audit:read')) {
      tabs.push({ key: 'audit', label: 'Change History' })
    }
    return tabs
  }, [me?.role, permissions])

  const rawTab = searchParams.get('tab')
  const activeTab: PatientDetailTab = visibleTabs.some((t) => t.key === rawTab)
    ? (rawTab as PatientDetailTab)
    : 'overview'

  // The notice is shown once as a centered toast; drop it from the history entry while preserving ?tab= query params.
  useEffect(() => {
    const notice = (location.state as { notice?: string } | null)?.notice
    if (notice) {
      toast.success(notice)
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }
  }, [location.state, location.pathname, location.search, navigate])

  // Redirect invalid or unauthorized ?tab= values back to overview once auth resolves.
  useEffect(() => {
    if (!me || rawTab === null) return
    if (!visibleTabs.some((t) => t.key === rawTab)) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'overview')
      setSearchParams(next, { replace: true })
    }
  }, [me, rawTab, visibleTabs, searchParams, setSearchParams])

  const handleSelectTab = (tabKey: string) => {
    if (!visibleTabs.some((t) => t.key === tabKey)) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', tabKey)
    setSearchParams(next, { replace: true })
  }

  if (validPatientId === null) {
    return (
      <AppShell name={me?.full_name || 'Staff'} role={role}>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-2xs">
          <p className="font-medium text-red-800">Invalid Patient ID.</p>
          <Link to="/reception/patients" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:text-brand-800 underline">
            &larr; Return to Patient Directory
          </Link>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell name={me?.full_name || 'Staff'} role={role}>
      <div className="mx-auto w-full max-w-[1600px] space-y-3.5">
        {/* Back Breadcrumb */}
        <div>
          <Link
            to="/reception/patients"
            className="inline-flex items-center gap-1 rounded text-xs font-semibold text-slate-600 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 sm:text-sm transition-colors"
          >
            &larr; Back to Patient Records
          </Link>
          {!patient && (
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
              Patient Record
            </h1>
          )}
        </div>

        {isPending ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-2xs">
            <p className="text-sm text-slate-600" role="status">
              Loading patient profile...
            </p>
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900"
          >
            Failed to load patient: {error.message}
          </div>
        ) : !patient ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-2xs">
            <p className="font-medium text-slate-700">Patient not found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Persistent Identity Header + Attached 9-Section Tab Bar */}
            <div className="space-y-2.5">
              <PatientIdentityHeader
                patient={patient}
                summary={summary}
                summaryLoading={summaryLoading}
                summaryError={summaryError}
                role={role}
                permissions={permissions}
                onOpenTab={handleSelectTab}
              />

              {/* Responsive 9-Section Navigation */}
              <div>
                {/* Mobile section selector */}
                <div className="sm:hidden">
                  <select
                    aria-label="Jump to patient record section"
                    value={activeTab}
                    onChange={(e) => handleSelectTab(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-2xs focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/15"
                  >
                    {visibleTabs.map((tab) => (
                      <option key={tab.key} value={tab.key}>
                        {tab.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Desktop horizontal scrollable tab bar */}
                <nav
                  role="tablist"
                  aria-label="Patient record sections"
                  className="hidden gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white px-2 pt-1 shadow-2xs sm:flex"
                >
                  {visibleTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      id={`patient-tab-${tab.key}`}
                      aria-controls={`patient-panel-${tab.key}`}
                      aria-selected={activeTab === tab.key}
                      onClick={() => handleSelectTab(tab.key)}
                      className={[
                        'min-h-11 shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3.5 text-sm font-semibold transition-colors cursor-pointer',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700',
                        activeTab === tab.key
                          ? 'border-brand-700 bg-brand-50/70 text-brand-800'
                          : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-brand-800',
                      ].join(' ')}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>
            </div>

            {/* Active Workspace Section Panel */}
            {activeTab === 'overview' ? (
              <div
                id="patient-panel-overview"
                role="tabpanel"
                aria-labelledby="patient-tab-overview"
              >
                <PatientOverviewTab
                  patient={patient}
                  summary={summary}
                  role={role}
                  permissions={permissions}
                  currentDoctorId={me?.doctor_id}
                  onOpenTab={handleSelectTab}
                />
              </div>
            ) : (
              <section
                id={`patient-panel-${activeTab}`}
                role="tabpanel"
                aria-labelledby={`patient-tab-${activeTab}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5"
              >
                {activeTab === 'visits' && (
                  <PatientVisitHistoryTab patientId={patient.id} role={role} />
                )}
                {activeTab === 'clinical' && role === 'DOCTOR' && (
                  <PatientClinicalRecordsTab patientId={patient.id} />
                )}
                {activeTab === 'prescriptions' && role === 'DOCTOR' && (
                  <PatientPrescriptionsTab
                    patientId={patient.id}
                    currentDoctorId={me?.doctor_id}
                  />
                )}
                {activeTab === 'investigations' && role === 'DOCTOR' && (
                  <PatientInvestigationsTab
                    patientId={patient.id}
                    currentDoctorId={me?.doctor_id}
                  />
                )}
                {activeTab === 'therapy' && (
                  <PatientTreatmentPlansTab
                    patientId={patient.id}
                    role={role}
                    permissions={permissions}
                  />
                )}
                {activeTab === 'billing' &&
                  (role === 'ADMIN' || role === 'RECEPTION') &&
                  permissions.includes('payment:read') && (
                    <PatientBillingLedgerTab
                      patientId={patient.id}
                      role={role}
                      permissions={permissions}
                    />
                  )}
                {activeTab === 'documents' &&
                  (permissions.includes('document:read') ? (
                    <PatientDocumentsTab
                      patientId={patient.id}
                      role={role}
                      permissions={permissions}
                      isActive={patient.is_active}
                      isArchived={patient.is_archived}
                      isMerged={patient.merged_into_id != null}
                      currentUserId={me?.id}
                      currentDoctorId={me?.doctor_id}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
                      <h2 className="text-base font-bold text-slate-900">
                        Documents &amp; Attachments
                      </h2>
                      <p className="mt-2 text-sm text-slate-600">
                        You do not have permission to view patient documents.
                      </p>
                    </div>
                  ))}
                {activeTab === 'audit' && role === 'ADMIN' && permissions.includes('audit:read') && (
                  <PatientAuditHistory patientId={patient.id} />
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
