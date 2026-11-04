import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useChangePassword, useLogout, useMe, usePasswordPolicy } from '../api/queries'
import { ApiError } from '../api/client'
import { ROLE_HOME } from '../auth/roles'

export function ChangePassword() {
  const navigate = useNavigate()
  const { data: me, refetch: refetchMe } = useMe()
  const changePasswordMutation = useChangePassword()
  const logoutMutation = useLogout()
  const passwordPolicy = usePasswordPolicy()
  const policy = passwordPolicy.data

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null)
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null)
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSignOut = async () => {
    try {
      await logoutMutation.mutateAsync()
    } finally {
      navigate('/login')
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setCurrentPasswordError(null)
    setNewPasswordError(null)
    setConfirmPasswordError(null)
    setGeneralError(null)

    // Client-side mismatch validation
    if (newPassword !== confirmPassword) {
      setConfirmPasswordError('New passwords do not match')
      return
    }

    // Length rules come from the server (GET /security/password-policy). If they could not be
    // loaded, the server still enforces them on submit and its password_policy error is shown.
    if (policy && newPassword.length < policy.min_length) {
      setNewPasswordError(`Password must be at least ${policy.min_length} characters long`)
      return
    }
    if (policy && newPassword.length > policy.max_length) {
      setNewPasswordError(`Password must be at most ${policy.max_length} characters long`)
      return
    }

    try {
      await changePasswordMutation.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setSuccessMessage('Password changed successfully.')

      // Refresh 'me' to clear must_change_password flag
      const updatedMeResult = await refetchMe()
      const targetUser = updatedMeResult.data || me
      if (targetUser) {
        navigate(ROLE_HOME[targetUser.role])
      } else {
        navigate('/login')
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'current_password_invalid') {
          setCurrentPasswordError(err.message)
        } else if (err.code === 'password_policy') {
          setNewPasswordError(err.message)
        } else {
          setGeneralError(err.message)
        }
      } else {
        setGeneralError('Failed to change password. Please check your connection.')
      }
    }
  }

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-6 text-neutral-900">
      <div className="max-w-md w-full bg-white p-8 rounded-lg border border-neutral-200 shadow-sm space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-red-900 tracking-tight">
              Change Password
            </h1>
            <p className="text-sm text-neutral-600 mt-1">
              {me?.must_change_password
                ? 'Your account requires an immediate password update.'
                : 'Update your account login password.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={logoutMutation.isPending}
            className="text-xs text-neutral-600 hover:text-neutral-900 underline min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer"
          >
            Sign out
          </button>
        </div>

        {generalError && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
            {generalError}
          </div>
        )}

        {successMessage && (
          <div role="status" className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-900">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="current-password-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Current password
            </label>
            <input
              id="current-password-input"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              aria-invalid={!!currentPasswordError}
              aria-describedby={currentPasswordError ? 'current-pwd-error' : undefined}
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
            {currentPasswordError && (
              <p id="current-pwd-error" role="alert" className="mt-1 text-xs text-red-700">
                {currentPasswordError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-password-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              New password
            </label>
            <input
              id="new-password-input"
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-invalid={!!newPasswordError}
              aria-describedby="new-pwd-hint new-pwd-error"
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
            <p id="new-pwd-hint" className="mt-1 text-sm text-neutral-600">
              {policy
                ? `Must be ${policy.min_length} to ${policy.max_length} characters long.`
                : passwordPolicy.isPending
                  ? 'Loading password rules...'
                  : 'The password rules could not be loaded. The server checks the length when you submit.'}
            </p>
            {newPasswordError && (
              <p id="new-pwd-error" role="alert" className="mt-1 text-xs text-red-700">
                {newPasswordError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirm-password-input"
              className="block text-sm font-medium text-neutral-800 mb-1"
            >
              Confirm new password
            </label>
            <input
              id="confirm-password-input"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!confirmPasswordError}
              aria-describedby={confirmPasswordError ? 'confirm-pwd-error' : undefined}
              className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
            {confirmPasswordError && (
              <p id="confirm-pwd-error" role="alert" className="mt-1 text-xs text-red-700">
                {confirmPasswordError}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={changePasswordMutation.isPending}
            className="w-full px-4 py-2 text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
          >
            {changePasswordMutation.isPending ? 'Updating...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
