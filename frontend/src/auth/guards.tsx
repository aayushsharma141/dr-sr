import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router'
import { onAuthLost, setCsrfToken } from '../api/client'
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // The API client reports invalid/expired sessions from any protected request.
  // Clear all potentially sensitive cached data before returning to sign-in.
  useEffect(() => {
    return onAuthLost((reason) => {
      setCsrfToken(null)
      queryClient.clear()
      navigate(reason === 'session_expired' ? '/login?reason=expired' : '/login', {
        replace: true,
      })
    })
  }, [navigate, queryClient])

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

  if (me.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return <Outlet context={me} />
}

export function RequireRole({ role }: { role: Role | Role[] }) {
  const me = useOutletContext<Me>()
  const allowed = Array.isArray(role) ? role : [role]

  if (!me || !allowed.includes(me.role)) {
    const targetHome = me ? ROLE_HOME[me.role] : '/login'
    return <Navigate to={targetHome} replace />
  }

  return <Outlet context={me} />
}
