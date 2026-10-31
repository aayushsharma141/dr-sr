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
              const { AreaHome } = await import('./pages/AreaHome')
              return {
                Component: function DoctorArea() {
                  return <AreaHome area="doctor" />
                },
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
