import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuditLogs, usePatient, useMe } from '../api/queries'
import { AppShell } from '../components/AppShell'
import { PatientEditModal } from '../components/PatientEditModal'
import { PatientTimeline } from '../components/PatientTimeline'
import type { PatientOut } from '../api/types'

type PatientDetailTab = 'profile' | 'visits' | 'clinical' | 'therapy' | 'billing' | 'audit'

function PatientAuditHistory({ patientId }: { patientId: number }) {
  const { data, isPending, isError, error, refetch } = useAuditLogs({
    entity_type: 'patient',
    entity_id: String(patientId),
    page: 1,
    page_size: 50,
  })

  if (isPending) {
    return <div className="p-8 text-center text-sm text-slate-500" role="status">Loading patient audit history…</div>
  }
  if (isError) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">Unable to load audit history: {error.message}</div>
  }

  const records = data?.items ?? []
  return (
    <section className="space-y-3" aria-label="Patient audit history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">Patient audit history</h3>
          <p className="mt-1 text-xs text-slate-500">Administrative access · immutable audit events for this patient record</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
        >
          Refresh
        </button>
      </div>
      {records.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No patient-specific audit events were found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3">Date & time</th>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                    {new Date(record.occurred_at).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-800">{record.actor_username || 'System'}</span>
                    <span className="ml-1 text-xs text-slate-500">{record.actor_role || ''}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{record.action}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${record.outcome === 'SUCCESS' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'}`}>
                      {record.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.total > records.length && (
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
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

  const { data: me } = useMe()
  const { data: patient, isPending, isError, error, refetch } = usePatient(
    isNaN(patientId) ? null : patientId,
  )

  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<PatientDetailTab>('profile')

  if (isNaN(patientId) || patientId <= 0) {
    return (
      <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
        <div className="p-8 text-center bg-white rounded-lg border border-neutral-200">
          <p className="text-red-800 font-medium">Invalid Patient ID.</p>
          <Link to="/reception/patients" className="text-sm text-red-900 underline mt-2 inline-block">
            &larr; Return to Patient Directory
          </Link>
        </div>
      </AppShell>
    )
  }

  const handleEditSuccess = (_updated: PatientOut) => {
    setIsEditModalOpen(false)
    setSuccessBanner(`Patient details updated successfully.`)
    refetch()
  }

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Link
              to="/reception/patients"
              className="text-sm text-red-900 hover:underline font-medium inline-flex items-center gap-1"
            >
              &larr; Back to Patient Directory
            </Link>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight mt-1">
              Patient Profile
            </h2>
          </div>
          {patient && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-neutral-500 min-h-[44px] cursor-pointer"
              >
                Edit Demographics
              </button>
              <Link
                to={`/reception/patients/${patient.id}/print`}
                className="px-4 py-2 bg-red-900 hover:bg-red-800 text-white rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-red-800 min-h-[44px] inline-flex items-center justify-center cursor-pointer shadow-xs"
              >
                Print Card
              </Link>
            </div>
          )}
        </div>

        {successBanner && (
          <div
            role="status"
            className="p-4 bg-emerald-50 border border-emerald-300 rounded text-emerald-900 text-sm flex items-center justify-between"
          >
            <span>{successBanner}</span>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold ml-4"
              aria-label="Dismiss message"
            >
              &times;
            </button>
          </div>
        )}

        {isPending ? (
          <div className="bg-white p-12 text-center rounded-lg border border-neutral-200">
            <p className="text-sm text-neutral-500" role="status">
              Loading patient profile...
            </p>
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-900 text-sm"
          >
            Failed to load patient: {error.message}
          </div>
        ) : !patient ? (
          <div className="bg-white p-12 text-center rounded-lg border border-neutral-200">
            <p className="text-neutral-700 font-medium">Patient not found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <nav
              role="tablist"
              aria-label="Patient record sections"
              className="flex flex-wrap gap-1 border-b border-slate-200"
            >
              {([
                { key: 'profile', label: 'Demographic Profile' },
                { key: 'visits', label: 'Visits & Appointments' },
                ...(me?.permissions.includes('encounter:read') && me.permissions.includes('prescription:read')
                  ? [{ key: 'clinical' as const, label: 'Clinical Records' }]
                  : []),
                { key: 'therapy', label: 'Physiotherapy' },
                { key: 'billing', label: 'Financial Ledger' },
                ...(me?.role === 'ADMIN' && me.permissions.includes('audit:read') ? [{ key: 'audit' as const, label: 'Audit History' }] : []),
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  id={`patient-tab-${tab.key}`}
                  aria-controls={`patient-panel-${tab.key}`}
                  aria-selected={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={[
                    'min-h-11 rounded-t-lg border-b-2 px-3 text-xs font-semibold transition-colors sm:px-4 sm:text-sm',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8E1C3D]',
                    activeTab === tab.key
                      ? 'border-[#C39A35] bg-white text-[#5D0B26]'
                      : 'border-transparent text-slate-600 hover:bg-white hover:text-[#5D0B26]',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeTab === 'profile' ? (
          <div id="patient-panel-profile" role="tabpanel" aria-labelledby="patient-tab-profile" className="bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xs">
            {/* Top Identity Banner */}
            <div className="p-6 bg-neutral-50 border-b border-neutral-200 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="w-20 h-20 rounded-full border-2 border-red-900/20 bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                  {patient.photo_path ? (
                    <img
                      src={`/api/patients/${patient.id}/photo`}
                      alt={patient.full_name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <span className="text-2xl font-bold text-red-900">
                      {patient.full_name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-neutral-900">
                      {patient.full_name}
                    </h3>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        patient.is_active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-neutral-200 text-neutral-600'
                      }`}
                    >
                      {patient.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1">
                    Care of: <span className="font-medium text-neutral-900">{patient.guardian_name}</span>
                  </p>
                  <div className="mt-2 flex items-center gap-4 text-xs font-mono text-neutral-500">
                    <span>Registered: {new Date(patient.created_at).toLocaleDateString()}</span>
                    <span>Version: v{patient.version_id}</span>
                  </div>
                </div>
              </div>

              <div className="md:text-right">
                <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  Universal Record Number (URN)
                </p>
                <div className="mt-1 inline-block px-4 py-2 bg-red-900 text-white rounded-md font-mono text-xl font-bold tracking-wider shadow-xs">
                  {patient.urn}
                </div>
              </div>
            </div>

            {/* Demographics Information Grid */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Personal & Biological Details */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                  Demographic Details
                </h4>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-neutral-500 text-xs">Gender</dt>
                    <dd className="font-semibold text-neutral-900 mt-0.5">
                      {patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : 'Other'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500 text-xs">Age</dt>
                    <dd className="font-semibold text-neutral-900 mt-0.5">
                      {patient.age_years} Years
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500 text-xs">Date of Birth</dt>
                    <dd className="font-semibold text-neutral-900 mt-0.5 font-mono">
                      {patient.dob || 'Not specified'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Contact Information */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                  Contact Information
                </h4>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-neutral-500 text-xs">Primary Mobile</dt>
                    <dd className="font-semibold text-neutral-900 mt-0.5 font-mono">
                      {patient.mobile}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500 text-xs">Emergency Contact</dt>
                    <dd className="font-semibold text-neutral-900 mt-0.5 font-mono">
                      {patient.emergency_contact || 'None listed'}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-neutral-500 text-xs">Address</dt>
                    <dd className="font-medium text-neutral-900 mt-0.5">
                      {patient.address}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500 text-xs">District</dt>
                    <dd className="font-semibold text-neutral-900 mt-0.5">
                      {patient.district}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500 text-xs">State</dt>
                    <dd className="font-semibold text-neutral-900 mt-0.5">
                      {patient.state}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Medical Alerts & Allergies */}
              <div className="md:col-span-2 border-t border-neutral-100 pt-6">
                <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">
                  Clinical & Medical Alerts
                </h4>
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
                    Known Drug & Substance Allergies
                  </p>
                  <p className="text-sm font-bold text-amber-950 mt-1">
                    {patient.allergies}
                  </p>
                </div>
              </div>

              {/* Clinical & Administrative Notes */}
              {patient.notes && (
                <div className="md:col-span-2">
                  <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                    Administrative & Background Notes
                  </h4>
                  <div className="p-4 rounded-lg bg-neutral-50 border border-neutral-200 text-sm text-neutral-800 whitespace-pre-wrap">
                    {patient.notes}
                  </div>
                </div>
              )}
            </div>
          </div>
            ) : (
              <section
                id={`patient-panel-${activeTab}`}
                role="tabpanel"
                aria-labelledby={`patient-tab-${activeTab}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5"
              >
                {activeTab === 'visits' && (
                  <PatientTimeline
                    patientId={patient.id}
                    eventTypes={['APPOINTMENT']}
                    heading="Appointment & visit history"
                  />
                )}
                {activeTab === 'clinical' && (
                  <PatientTimeline
                    patientId={patient.id}
                    eventTypes={['ENCOUNTER', 'PRESCRIPTION']}
                    heading="Clinical encounters & prescriptions"
                  />
                )}
                {activeTab === 'therapy' && (
                  <PatientTimeline
                    patientId={patient.id}
                    eventTypes={['TREATMENT_PLAN', 'TREATMENT_SESSION']}
                    heading="Physiotherapy plans & sessions"
                  />
                )}
                {activeTab === 'billing' && (
                  <PatientTimeline
                    patientId={patient.id}
                    eventTypes={['PAYMENT']}
                    heading="Financial ledger & receipts"
                  />
                )}
                {activeTab === 'audit' && me?.role === 'ADMIN' && (
                  <PatientAuditHistory patientId={patient.id} />
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Demographic Edit Modal */}
      {patient && (
        <PatientEditModal
          patient={patient}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={handleEditSuccess}
        />
      )}
    </AppShell>
  )
}
