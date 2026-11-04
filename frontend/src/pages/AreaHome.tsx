import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { useOverview } from '../api/queries'
import type { AdminOverview, DoctorOverview, Role } from '../api/types'

interface AreaHomeProps {
  area: 'admin' | 'reception' | 'doctor'
}

export function AreaHome({ area }: AreaHomeProps) {
  const { data, isPending, isError, error } = useOverview(area)

  if (isPending) {
    return (
      <div className="p-6">
        <p role="status" className="text-neutral-600">Loading overview...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6">
        <p role="alert" className="text-red-700">
          Failed to load {area} overview: {error.message}
        </p>
      </div>
    )
  }

  if (!data) return null

  const role: Role =
    area === 'admin'
      ? 'ADMIN'
      : area === 'reception'
        ? 'RECEPTION'
        : 'DOCTOR'

  return (
    <AppShell name={data.name} role={role}>
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg border border-neutral-200 shadow-xs">
          <h2 className="text-xl font-bold capitalize text-neutral-900">
            {area} Dashboard
          </h2>
          <p className="text-sm text-neutral-600 mt-1">
            Welcome, {data.name} ({role})
          </p>

          {area === 'doctor' && (
            <div className="mt-4 p-4 bg-neutral-50 rounded border border-neutral-200">
              <p className="text-sm text-neutral-700">
                Doctor ID: {(data as DoctorOverview).doctor_id}
              </p>
              <p className="text-sm text-neutral-700">
                Doctor Name: {(data as DoctorOverview).doctor_name_en}
              </p>
            </div>
          )}

          {area === 'admin' && (
            <div className="mt-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wider mb-3">
                  System User Counts
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {Object.entries((data as AdminOverview).user_counts || {}).map(
                    ([rName, counts]) => (
                      <div
                        key={rName}
                        className="p-4 bg-neutral-50 rounded border border-neutral-200"
                      >
                        <p className="text-xs font-mono font-medium text-neutral-500">
                          {rName}
                        </p>
                        <p className="text-lg font-bold text-neutral-900 mt-1">
                          {counts.active} active
                        </p>
                        <p className="text-xs text-neutral-500">
                          {counts.inactive} inactive
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-900">Administration workspace</p>
                <p className="mt-1 text-sm text-neutral-600">
                  Use the single navigation menu to manage clinic settings, doctors and fees,
                  staff access, audit history, backups and system integrity.
                </p>
              </div>
            </div>
          )}

          {area === 'reception' && (
            <div className="mt-6 space-y-6">
              <div className="text-sm text-neutral-600">
                Reception area active. Ready for patient check-ins and appointments.
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wider mb-3">
                  Reception Operations
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Link
                    to="/reception/appointments"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">Appointments & Queue</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Book daily tokens, track arrived patients & manage waiting hall
                    </p>
                  </Link>
                  <Link
                    to="/reception/patients/new"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">+ New Registration</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Register patient demographics, capture photo & generate URN
                    </p>
                  </Link>
                  <Link
                    to="/reception/patients"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">Patient Directory</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Search patients by URN, mobile, or name & manage files
                    </p>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
