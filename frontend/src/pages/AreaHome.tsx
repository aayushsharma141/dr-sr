import { AppShell } from '../components/AppShell'
import { useOverview } from '../api/queries'
import { ReceptionDashboard } from './ReceptionDashboard'
import type { AdminOverview, DoctorOverview, ReceptionOverview, Role } from '../api/types'
// Real figures only; the old Management Overview fell back to invented expense and utilisation numbers.
import { AdminDashboard } from '../components/admin/AdminDashboard'

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
        {area === 'reception' ? (
          <ReceptionDashboard overview={data as ReceptionOverview} />
        ) : area === 'admin' ? (
          <AdminDashboard overview={data as Partial<AdminOverview>} />
        ) : (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg border border-neutral-200 shadow-xs">
              <h1 className="text-xl font-bold text-neutral-900">
                Doctor Dashboard
              </h1>
              <p className="text-sm text-neutral-600 mt-1">
                Welcome, {data.name} ({role})
              </p>

              <div className="mt-4 p-4 bg-neutral-50 rounded border border-neutral-200">
                <p className="text-sm text-neutral-700">
                  Doctor ID: {(data as DoctorOverview).doctor_id}
                </p>
                <p className="text-sm text-neutral-700">
                  Doctor Name: {(data as DoctorOverview).doctor_name_en}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
