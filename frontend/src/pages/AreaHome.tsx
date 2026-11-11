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
        {area !== 'admin' ? (
          <p role="status" className="text-neutral-600">Loading overview...</p>
        ) : (
          <div role="status" className="space-y-4">
            <span className="sr-only">Loading overview...</span>
            <div className="h-8 w-64 animate-pulse rounded bg-neutral-200" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100 lg:col-span-5" />
              <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100 lg:col-span-4" />
              <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100 lg:col-span-3" />
            </div>
          </div>
        )}
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
