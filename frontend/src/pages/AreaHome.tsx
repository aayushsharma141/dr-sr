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

              <div>
                <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wider mb-3">
                  Administration Modules
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Link
                    to="/admin/settings"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">Clinic Settings</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Clinic identity, numbering cycles & print slips
                    </p>
                  </Link>
                  <Link
                    to="/admin/doctors"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">Doctors & Fees</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Doctor profiles, qualifications & fee schedules
                    </p>
                  </Link>
                  <Link
                    to="/admin/users"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">User Management</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      User accounts, roles, locks & passwords
                    </p>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {area === 'reception' && (
            <div className="mt-4 text-sm text-neutral-600">
              Reception area active. Ready for patient check-ins and appointments.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
