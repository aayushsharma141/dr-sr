import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLogin, useSetupStatus } from '../api/queries'
import { ApiError } from '../api/client'
import { ROLE_HOME } from '../auth/roles'

export function Login() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const reason = searchParams.get('reason')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loginMutation = useLogin()
  const { data: setupStatus } = useSetupStatus()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    try {
      const me = await loginMutation.mutateAsync({ username, password })
      if (me.must_change_password) {
        navigate('/change-password')
      } else {
        navigate(ROLE_HOME[me.role])
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage('An unexpected error occurred while connecting to the server.')
      }
    }
  }

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-8 rounded-lg border border-neutral-200 shadow-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-red-900 tracking-tight">
            Kalyan Hospital
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            Offline LAN Management Platform
          </p>
        </div>

        {setupStatus?.setup_required && (
          <div
            role="status"
            className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900 flex flex-col gap-1"
          >
            <p>No administrator exists yet - open the setup wizard</p>
            <Link
              to="/setup"
              className="font-medium underline hover:text-blue-950 inline-block"
            >
              Setup Wizard
            </Link>
          </div>
        )}

        {reason === 'expired' && (
          <div
            role="status"
            className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900"
          >
            You were signed out after 30 minutes of inactivity
          </div>
        )}

        {errorMessage && (
          <div
            id="login-alert"
            role="alert"
            className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900"
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Username
            </label>
            <input
              id="username-input"
              name="username"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={!!errorMessage}
              aria-describedby={errorMessage ? 'login-alert' : undefined}
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
          </div>

          <div>
            <label
              htmlFor="password-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Password
            </label>
            <input
              id="password-input"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errorMessage}
              aria-describedby={errorMessage ? 'login-alert' : undefined}
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full px-4 py-2 text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
          >
            {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
