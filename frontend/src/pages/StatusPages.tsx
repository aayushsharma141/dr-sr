import { Link, useNavigate } from 'react-router'
import { useMe } from '../api/queries'

function getRoleHome(role?: string): string {
  switch (role) {
    case 'ADMIN':
      return '/admin'
    case 'DOCTOR':
      return '/doctor'
    case 'RECEPTION':
      return '/reception'
    default:
      return '/login'
  }
}

export function Forbidden() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const roleHome = me?.role ? getRoleHome(me.role) : null

  return (
    <div className="min-h-screen h-full w-full overflow-y-auto bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-6 rounded-lg border border-neutral-200 text-center space-y-4 shadow-sm">
        <h1 className="text-2xl font-bold text-red-900">403 - Forbidden</h1>
        <p className="text-sm text-neutral-600">
          You do not have permission to access this resource with your current role.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {roleHome ? (
            <>
              <Link
                to={roleHome}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] cursor-pointer shadow-xs"
              >
                Return to Workspace
              </Link>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded min-h-[44px] cursor-pointer"
              >
                Go Back
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] cursor-pointer"
            >
              Back to Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export function NotFound() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const roleHome = me?.role ? getRoleHome(me.role) : null

  return (
    <div className="min-h-screen h-full w-full overflow-y-auto bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-6 rounded-lg border border-neutral-200 text-center space-y-4 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">404 - Not found</h1>
        <p className="text-sm text-neutral-600">
          The requested page could not be found on this hospital LAN server.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {roleHome ? (
            <>
              <Link
                to={roleHome}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] cursor-pointer shadow-xs"
              >
                Return to Workspace
              </Link>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded min-h-[44px] cursor-pointer"
              >
                Go Back
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] cursor-pointer"
            >
              Return to Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
