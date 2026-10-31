import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router'
import { useMe } from '../api/queries'
import { ROLE_HOME } from './roles'
import type { Me, Role } from '../api/types'

/**
 * Route guards for client-side navigation UX.
 *
 * NOTE: Route guards are for user experience and navigation routing only.
 * They are NOT a security boundary: the backend server independently validates
 * session authentication and authorization permissions on every HTTP request.
 */

export function RequireAuth() {
  const { data: me, isPending, isError } = useMe()
  const location = useLocation()

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100">
        <p role="status" className="text-sm font-medium text-neutral-600">
          Loading…
        </p>
      </div>
    )
  }

  if (isError || !me) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (me.must_change_password) {
    return <Navigate to="/change-password" replace />
  }

  return <Outlet context={me} />
}

export function RequireRole({ role }: { role: Role }) {
  const me = useOutletContext<Me>()

  if (!me || me.role !== role) {
    const targetHome = me ? ROLE_HOME[me.role] : '/login'
    return <Navigate to={targetHome} replace />
  }

  return <Outlet context={me} />
}
