import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useSetupAdmin, useSetupStatus } from '../api/queries'
import { ApiError } from '../api/client'

export function Setup() {
  const navigate = useNavigate()
  const { data: setupStatus, isPending: isCheckingStatus } = useSetupStatus()
  const setupAdminMutation = useSetupAdmin()

  const [setupCode, setSetupCode] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [codeError, setCodeError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)

  const codeInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const confirmInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isCheckingStatus && setupStatus && !setupStatus.setup_required) {
      navigate('/login?notice=closed', { replace: true })
    }
  }, [setupStatus, isCheckingStatus, navigate])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setCodeError(null)
    setPasswordError(null)
    setConfirmError(null)
    setGeneralError(null)

    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match')
      confirmInputRef.current?.focus()
      return
    }

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters long')
      passwordInputRef.current?.focus()
      return
    }

    try {
      await setupAdminMutation.mutateAsync({
        setup_code: setupCode.trim(),
        username: username.trim(),
        full_name: fullName.trim(),
        password,
      })
      navigate('/login?notice=created', { replace: true })
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 410 || err.code === 'setup_closed') {
          navigate('/login?notice=closed', { replace: true })
        } else if (err.code === 'setup_code_invalid' || err.status === 403) {
          setCodeError('The setup code is not correct. Read it again on the server PC.')
          codeInputRef.current?.focus()
        } else if (err.code === 'password_policy' || err.status === 422) {
          setPasswordError(err.message)
          passwordInputRef.current?.focus()
        } else {
          setGeneralError(err.message)
        }
      } else {
        setGeneralError('Failed to complete setup. Please check the network connection.')
      }
    }
  }

  if (isCheckingStatus) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
        <p role="status" className="text-sm text-neutral-600">
          Checking system setup status...
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-8 rounded-lg border border-neutral-200 shadow-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-red-900 tracking-tight">
            Initial System Setup
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            Initialize the Kalyan Hospital LAN Platform and bootstrap the primary administrator.
          </p>
        </div>

        {generalError && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="setup-code-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Setup code
            </label>
            <input
              ref={codeInputRef}
              id="setup-code-input"
              type="text"
              required
              autoComplete="off"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              aria-invalid={!!codeError}
              aria-describedby="setup-code-hint setup-code-error"
              className="w-full px-3 py-2 font-mono uppercase tracking-wider border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
            <p id="setup-code-hint" className="mt-1 text-xs text-neutral-500">
              Displayed on the server console and saved in backend\var\setup-code.txt on the server PC.
            </p>
            {codeError && (
              <p id="setup-code-error" role="alert" className="mt-1 text-xs text-red-700">
                {codeError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="setup-username-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Username
            </label>
            <input
              id="setup-username-input"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
          </div>

          <div>
            <label
              htmlFor="setup-fullname-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Full name
            </label>
            <input
              id="setup-fullname-input"
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
          </div>

          <div>
            <label
              htmlFor="setup-password-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Password
            </label>
            <input
              ref={passwordInputRef}
              id="setup-password-input"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!passwordError}
              aria-describedby="setup-pwd-hint setup-pwd-error"
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
            <p id="setup-pwd-hint" className="mt-1 text-xs text-neutral-500">
              Must be at least 8 characters long.
            </p>
            {passwordError && (
              <p id="setup-pwd-error" role="alert" className="mt-1 text-xs text-red-700">
                {passwordError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="setup-confirm-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Confirm password
            </label>
            <input
              ref={confirmInputRef}
              id="setup-confirm-input"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!confirmError}
              aria-describedby={confirmError ? 'setup-confirm-error' : undefined}
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
            {confirmError && (
              <p id="setup-confirm-error" role="alert" className="mt-1 text-xs text-red-700">
                {confirmError}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={setupAdminMutation.isPending}
            className="w-full px-4 py-2 text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
          >
            {setupAdminMutation.isPending ? 'Creating Administrator...' : 'Complete Setup'}
          </button>
        </form>
      </div>
    </div>
  )
}
