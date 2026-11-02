import { createBrowserRouter, Navigate, useOutletContext, useSearchParams } from 'react-router'
import { RequireAuth, RequireRole } from './auth/guards'
import { ROLE_HOME } from './auth/roles'
import { Login } from './pages/Login'
import { Setup } from './pages/Setup'
import { ChangePassword } from './pages/ChangePassword'
import { Forbidden, NotFound } from './pages/StatusPages'
import { useSetupStatus } from './api/queries'
import type { Me } from './api/types'

function RootRedirect() {
  const me = useOutletContext<Me>()
  return <Navigate to={ROLE_HOME[me.role]} replace />
}

export function LoginRoute() {
  const { data: setupStatus } = useSetupStatus()
  const [searchParams] = useSearchParams()
  if (setupStatus?.setup_required && !searchParams.get('notice')) {
    return <Navigate to="/setup" replace />
  }
  return <Login />
}

export function RootRoute() {
  const { data: setupStatus } = useSetupStatus()
  if (setupStatus?.setup_required) {
    return <Navigate to="/setup" replace />
  }
  return <RootRedirect />
}

export const router = createBrowserRouter([
  {
    path: '/setup',
    element: <Setup />,
  },
  {
    path: '/login',
    element: <LoginRoute />,
  },
  {
    path: '/403',
    element: <Forbidden />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/change-password',
        element: <ChangePassword />,
      },
      {
        path: '/',
        element: <RootRoute />,
      },
      {
        element: <RequireRole role="ADMIN" />,
        children: [
          {
            path: '/admin',
            lazy: async () => {
              const { AreaHome } = await import('./pages/AreaHome')
              return {
                Component: function AdminArea() {
                  return <AreaHome area="admin" />
                },
              }
            },
          },
          {
            path: '/admin/users',
            lazy: async () => {
              const { Users } = await import('./pages/admin/Users')
              return {
                Component: Users,
              }
            },
          },
          {
            path: '/admin/settings',
            lazy: async () => {
              const { Settings } = await import('./pages/Settings')
              return {
                Component: Settings,
              }
            },
          },
          {
            path: '/admin/doctors',
            lazy: async () => {
              const { Doctors } = await import('./pages/Doctors')
              return {
                Component: Doctors,
              }
            },
          },
        ],
      },
      {
        element: <RequireRole role={['ADMIN', 'RECEPTION', 'DOCTOR']} />,
        children: [
          {
            path: '/reception/appointments',
            lazy: async () => {
              const { AppointmentsReception } = await import('./pages/AppointmentsReception')
              return {
                Component: AppointmentsReception,
              }
            },
          },
          {
            path: '/reception/patients',
            lazy: async () => {
              const { PatientsDirectory } = await import('./pages/PatientsDirectory')
              return {
                Component: PatientsDirectory,
              }
            },
          },
          {
            path: '/reception/patients/new',
            lazy: async () => {
              const { PatientRegister } = await import('./pages/PatientRegister')
              return {
                Component: PatientRegister,
              }
            },
          },
          {
            path: '/reception/patients/:id',
            lazy: async () => {
              const { PatientDetail } = await import('./pages/PatientDetail')
              return {
                Component: PatientDetail,
              }
            },
          },
          {
            path: '/reception/patients/:id/print',
            lazy: async () => {
              const { PatientCardPrint } = await import('./pages/PatientCardPrint')
              return {
                Component: PatientCardPrint,
              }
            },
          },
          {
            path: '/reception/dues',
            lazy: async () => {
              const { PendingDuesPage } = await import('./pages/PendingDuesPage')
              return {
                Component: PendingDuesPage,
              }
            },
          },
        ],
      },
      {
        element: <RequireRole role="RECEPTION" />,
        children: [
          {
            path: '/reception',
            lazy: async () => {
              const { AreaHome } = await import('./pages/AreaHome')
              return {
                Component: function ReceptionArea() {
                  return <AreaHome area="reception" />
                },
              }
            },
          },
        ],
      },
      {
        element: <RequireRole role="DOCTOR" />,
        children: [
          {
            path: '/doctor',
            lazy: async () => {
              const { DoctorDashboard } = await import('./pages/DoctorDashboard')
              return {
                Component: DoctorDashboard,
              }
            },
          },
          {
            path: '/doctor/encounters/new',
            lazy: async () => {
              const { ClinicalEncounterWorkspace } = await import('./pages/ClinicalEncounterWorkspace')
              return {
                Component: ClinicalEncounterWorkspace,
              }
            },
          },
          {
            path: '/doctor/encounters/:id',
            lazy: async () => {
              const { ClinicalEncounterWorkspace } = await import('./pages/ClinicalEncounterWorkspace')
              return {
                Component: ClinicalEncounterWorkspace,
              }
            },
          },
          {
            path: '/doctor/prescriptions/new',
            lazy: async () => {
              const { PrescriptionWorkspace } = await import('./pages/PrescriptionWorkspace')
              return {
                Component: PrescriptionWorkspace,
              }
            },
          },
          {
            path: '/doctor/treatment-plans',
            lazy: async () => {
              const { TreatmentPlanWorkspace } = await import('./pages/TreatmentPlanWorkspace')
              return {
                Component: TreatmentPlanWorkspace,
              }
            },
          },
          {
            path: '/doctor/treatment-plans/:id',
            lazy: async () => {
              const { TreatmentPlanWorkspace } = await import('./pages/TreatmentPlanWorkspace')
              return {
                Component: TreatmentPlanWorkspace,
              }
            },
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
])
