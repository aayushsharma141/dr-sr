import { Link } from 'react-router'

export function Forbidden() {
  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-6 rounded-lg border border-neutral-200 text-center space-y-4">
        <h1 className="text-2xl font-bold text-red-900">403 - Forbidden</h1>
        <p className="text-sm text-neutral-600">
          You do not have permission to access this resource.
        </p>
        <div>
          <Link
            to="/login"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] cursor-pointer"
          >
            Back to Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

export function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-6 rounded-lg border border-neutral-200 text-center space-y-4">
        <h1 className="text-2xl font-bold text-neutral-900">404 - Not found</h1>
        <p className="text-sm text-neutral-600">
          The requested page could not be found.
        </p>
        <div>
          <Link
            to="/login"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] cursor-pointer"
          >
            Return to Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

export function ChangePasswordPending() {
  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-6 rounded-lg border border-neutral-200 text-center space-y-4">
        <h1 className="text-xl font-bold text-neutral-900">Change Password Required</h1>
        <p className="text-sm text-neutral-600">
          Your account requires a password change before continuing.
        </p>
      </div>
    </div>
  )
}
