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
            path: '/admin/roles',
            lazy: async () => {
              const { RolesMatrixPage } = await import('./pages/admin/RolesMatrixPage')
              return {
                Component: RolesMatrixPage,
              }
            },
          },
          {
            path: '/admin/security',
            lazy: async () => {
              const { SecurityCenterPage } = await import('./pages/admin/SecurityCenterPage')
              return {
                Component: SecurityCenterPage,
              }
            },
          },
          {
            path: '/admin/system',
            lazy: async () => {
              const { SystemHealthPage } = await import('./pages/admin/SystemHealthPage')
              return {
                Component: SystemHealthPage,
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
            path: '/admin/billing',
            lazy: async () => {
              const { BillingAdminPage } = await import('./pages/admin/BillingAdminPage')
              return {
                Component: BillingAdminPage,
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
          {
            path: '/admin/audit',
            lazy: async () => {
              const { AuditViewerPage } = await import('./pages/admin/AuditViewerPage')
              return {
                Component: AuditViewerPage,
              }
            },
          },
          {
            path: '/admin/backups',
            lazy: async () => {
              const { BackupManagerPage } = await import('./pages/admin/BackupManagerPage')
              return {
                Component: BackupManagerPage,
              }
            },
          },
          {
            path: '/admin/integrity',
            lazy: async () => {
              const { IntegrityDashboard } = await import('./pages/admin/IntegrityDashboard')
              return {
                Component: IntegrityDashboard,
              }
            },
          },
          {
            path: '/admin/assets',
            lazy: async () => ({
              Component: function HospitalAssetsPage() {
                return (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                    <h1 className="text-xl font-bold text-slate-900">Hospital Identity & Logo</h1>
                    <p className="text-sm text-slate-600">
                      Manage official hospital logos, crests, and identity assets.
                    </p>
                  </div>
                )
              },
            }),
          },
          {
            path: '/admin/templates',
            lazy: async () => ({
              Component: function PrintTemplatesPage() {
                return (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                    <h1 className="text-xl font-bold text-slate-900">Print Templates</h1>
                    <p className="text-sm text-slate-600">
                      Configure bilingual print header and footer templates.
                    </p>
                  </div>
                )
              },
            }),
          },
          {
            path: '/admin/patients/correct',
            lazy: async () => ({
              Component: function DemographicCorrectionPage() {
                return (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                    <h1 className="text-xl font-bold text-slate-900">Patient Demographic Correction</h1>
                    <p className="text-sm text-slate-600">
                      Audited administrative correction of patient demographic records.
                    </p>
                  </div>
                )
              },
            }),
          },
          {
            path: '/admin/imports',
            lazy: async () => ({
              Component: function ImportCentrePage() {
                return (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                    <h1 className="text-xl font-bold text-slate-900">Import Centre</h1>
                    <p className="text-sm text-slate-600">
                      Staged CSV and XLSX patient register import pipeline.
                    </p>
                  </div>
                )
              },
            }),
          },
          {
            path: '/admin/exports',
            lazy: async () => ({
              Component: function ExportCentrePage() {
                return (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                    <h1 className="text-xl font-bold text-slate-900">Export Centre</h1>
                    <p className="text-sm text-slate-600">
                      Field-selective patient dataset export and reporting.
                    </p>
                  </div>
                )
              },
            }),
          },
        ],
      },
      {
        element: <RequireRole role={['ADMIN', 'RECEPTION']} />,
        children: [
          {
            path: '/reception/billing',
            lazy: async () => {
              const { ReceptionBillingPage } = await import('./pages/ReceptionBillingPage')
              return {
                Component: ReceptionBillingPage,
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
            path: '/reception/patients/new',
            lazy: async () => {
              const { PatientRegister } = await import('./pages/PatientRegister')
              return {
                Component: PatientRegister,
              }
            },
          },
          {
            path: '/reception/tokens',
            lazy: async () => {
              const { TokenGenerationPage } = await import('./pages/TokenGenerationPage')
              return {
                Component: TokenGenerationPage,
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
