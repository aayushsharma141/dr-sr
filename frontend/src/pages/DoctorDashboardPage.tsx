import { AppShell } from '../components/AppShell'
import { useMe } from '../api/queries'
import { DoctorDashboard } from '../features/dashboard/doctor/DoctorDashboard'

export function DoctorDashboardPage() {
  const { data: me } = useMe()

  return (
    <AppShell name={me?.full_name || 'Consulting Doctor'} role="DOCTOR">
      <DoctorDashboard />
    </AppShell>
  )
}
