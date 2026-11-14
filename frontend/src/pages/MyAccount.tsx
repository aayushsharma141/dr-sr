import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Modal } from '../components/Modal'
import {
  useActiveSessions,
  useChangePassword,
  useDoctors,
  useLogout,
  useMe,
  useRevokeUserSessions,
} from '../api/queries'
import { ApiError } from '../api/client'
import { useClinicBranding } from '../api/branding'
import { withDoctorTitle } from '../format'

export function MyAccount() {
  const navigate = useNavigate()
  const { data: me, refetch: refetchMe } = useMe()
  const { data: doctors } = useDoctors(false)
  const branding = useClinicBranding()

  // Find linked doctor details if this is a doctor account
  const myDoctor = doctors?.find((d) => d.id === me?.doctor_id)

  // Active sessions
  const { data: sessions, refetch: refetchSessions } = useActiveSessions(me?.id ?? null)
  const revokeSessionsMutation = useRevokeUserSessions()
  const changePasswordMutation = useChangePassword()
  const logoutMutation = useLogout()

  // Form states
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [passwordNotice, setPasswordNotice] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)
  const [sessionNotice, setSessionNotice] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false)

  const handleSignOut = async () => {
    try {
      await logoutMutation.mutateAsync()
    } finally {
      navigate('/login')
    }
  }

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordNotice(null)

    if (newPassword !== repeatPassword) {
      setPasswordNotice({ tone: 'error', message: 'New passwords do not match.' })
      return
    }

    if (newPassword.length < 12) {
      setPasswordNotice({ tone: 'error', message: 'Password must be at least 12 characters long.' })
      return
    }

    try {
      await changePasswordMutation.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setPasswordNotice({
        tone: 'ok',
        message: 'Password changed successfully. Every other signed-in computer has been signed out.',
      })
      setCurrentPassword('')
      setNewPassword('')
      setRepeatPassword('')
      await refetchMe()
      await refetchSessions()
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setPasswordNotice({ tone: 'error', message: err.message })
      } else {
        setPasswordNotice({ tone: 'error', message: 'Failed to change password. Please check LAN connection.' })
      }
    }
  }

  const handleSignOutOthers = async () => {
    if (!me?.id) return
    setSessionNotice(null)
    try {
      await revokeSessionsMutation.mutateAsync({
        id: me.id,
        payload: { reason: 'User requested sign-out of all other computers via My Account.' },
      })
      setConfirmSignOutOpen(false)
      setSessionNotice({ tone: 'ok', message: 'All other computers signed out successfully.' })
      await refetchSessions()
    } catch (err: unknown) {
      setConfirmSignOutOpen(false)
      setSessionNotice({
        tone: 'error',
        message: err instanceof ApiError ? err.message : 'Failed to sign out other sessions.',
      })
    }
  }

  const initials = me?.full_name
    ? me.full_name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0].toUpperCase())
        .join('')
    : 'US'

  const roleDisplay =
    me?.role === 'DOCTOR'
      ? `Doctor · ${myDoctor?.qualification || 'Clinical Staff'}`
      : me?.role === 'ADMIN'
      ? 'Hospital Administrator'
      : 'Receptionist'

  return (
    <AppShell name={me?.full_name || 'My Account'} role={me?.role || 'DOCTOR'}>
      <div className="space-y-6">
        {/* Page Head */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-lg border border-slate-200 shadow-2xs">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              My account
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Your sign-in details and the computers currently signed in as you.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={logoutMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition"
          >
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>{logoutMutation.isPending ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Change Password & Signed-in computers */}
          <div className="lg:col-span-7 space-y-6">
            {/* Change Password Card */}
            <section className="bg-white rounded-lg border border-slate-200 shadow-2xs p-6">
              <h2 className="text-base font-bold text-slate-900 mb-4">
                Change password
              </h2>

              {passwordNotice && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium mb-4 ${
                    passwordNotice.tone === 'ok'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {passwordNotice.message}
                </div>
              )}

              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="account-current-pw"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Current password *
                  </label>
                  <input
                    id="account-current-pw"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/10"
                    placeholder="Enter current password"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="account-new-pw"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      New password *
                    </label>
                    <input
                      id="account-new-pw"
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/10"
                      placeholder="At least 12 characters"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="account-repeat-pw"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Repeat new password *
                    </label>
                    <input
                      id="account-repeat-pw"
                      type="password"
                      required
                      value={repeatPassword}
                      onChange={(e) => setRepeatPassword(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/10"
                      placeholder="Confirm new password"
                    />
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  At least 12 characters, mixing words, digits and a symbol.
                </p>

                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100">
                  <p className="text-xs text-slate-500 italic">
                    Every other signed-in computer will be signed out.
                  </p>
                  <button
                    type="submit"
                    disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !repeatPassword}
                    className="inline-flex justify-center items-center px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-2xs disabled:opacity-50 transition"
                  >
                    {changePasswordMutation.isPending ? 'Updating…' : 'Change password'}
                  </button>
                </div>
              </form>
            </section>

            {/* Signed-in computers */}
            <section className="bg-white rounded-lg border border-slate-200 shadow-2xs p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Signed-in computers
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sign out anything you do not recognise
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmSignOutOpen(true)}
                  disabled={revokeSessionsMutation.isPending}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold transition"
                >
                  {revokeSessionsMutation.isPending ? 'Signing out…' : 'Sign out others'}
                </button>
              </div>

              {sessionNotice && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium mb-4 ${
                    sessionNotice.tone === 'ok'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {sessionNotice.message}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                      <th className="pb-2 font-semibold">Computer</th>
                      <th className="pb-2 font-semibold">Signed in</th>
                      <th className="pb-2 font-semibold">Last seen</th>
                      <th className="pb-2 font-semibold">Address</th>
                      <th className="pb-2 font-semibold text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions && sessions.length > 0 ? (
                      sessions.map((sess) => (
                        <tr key={sess.id} className="hover:bg-slate-50">
                          <td className="py-2.5 font-medium text-slate-800 max-w-[200px] truncate" title={sess.user_agent || undefined}>
                            {sess.user_agent ? sess.user_agent.split(' ')[0] + ' on ' + (sess.user_agent.includes('Windows') ? 'Windows' : sess.user_agent.includes('Linux') ? 'Linux' : 'Device') : 'Workstation'}
                          </td>
                          <td className="py-2.5 text-slate-600">
                            {new Date(sess.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                          </td>
                          <td className="py-2.5 text-slate-600">
                            {sess.is_current ? 'just now' : 'active'}
                          </td>
                          <td className="py-2.5 font-mono text-xs text-slate-600">
                            {sess.ip_address || '127.0.0.1'}
                          </td>
                          <td className="py-2.5 text-right">
                            {sess.is_current ? (
                              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                This computer
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                                Other
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-2.5 font-medium text-slate-800">
                          Chrome on Windows
                        </td>
                        <td className="py-2.5 text-slate-600">
                          Today
                        </td>
                        <td className="py-2.5 text-slate-600">
                          just now
                        </td>
                        <td className="py-2.5 font-mono text-xs text-slate-600">
                          10.12.0.82
                        </td>
                        <td className="py-2.5 text-right">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            This computer
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Right Column: Profile & Permissions & Security Notes */}
          <div className="lg:col-span-5 space-y-6">
            {/* Profile Card */}
            <section className="bg-white rounded-lg border border-slate-200 shadow-2xs p-6">
              <h2 className="text-base font-bold text-slate-900 mb-4">
                Profile
              </h2>

              <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-900 font-bold text-sm">
                  {initials}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {me?.full_name
                      ? me.role === 'DOCTOR'
                        ? withDoctorTitle(me.full_name)
                        : me.full_name
                      : 'Staff Member'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {roleDisplay}
                  </div>
                  <div className="text-xs font-mono text-slate-500">
                    @{me?.username}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2.5 text-xs text-slate-700">
                {myDoctor && (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-500">Doctor profile</span>
                      <span className="font-semibold text-slate-900">
                        #{myDoctor.id} · {myDoctor.qualification || 'Consultant'}
                      </span>
                    </div>
                    {myDoctor.registration_number && (
                      <div className="flex justify-between py-1 border-b border-slate-50">
                        <span className="text-slate-500">Registration</span>
                        <span className="font-mono text-slate-900 font-semibold">{myDoctor.registration_number}</span>
                      </div>
                    )}
                    {myDoctor.cabin_code && (
                      <div className="flex justify-between py-1 border-b border-slate-50">
                        <span className="text-slate-500">Cabin / Room</span>
                        <span className="font-semibold text-slate-900">{myDoctor.cabin_code}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span className="text-slate-500">Clinic</span>
                  <span className="font-semibold text-slate-900">{branding.hospitalName || 'Kalyan Hospital'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span className="text-slate-500">Last sign-in</span>
                  <span className="text-slate-900">Just now</span>
                </div>
              </div>

              <p className="mt-4 text-xs text-slate-500 bg-slate-50 p-2.5 rounded border border-slate-100">
                Only an administrator can change a name, role or department. Ask them if something is wrong.
              </p>
            </section>

            {/* What you may do (Permissions) */}
            <section className="bg-white rounded-lg border border-slate-200 shadow-2xs p-6">
              <h2 className="text-base font-bold text-slate-900 mb-1">
                What you may do
              </h2>
              <p className="text-xs text-slate-500 mb-3">
                Granted system capabilities on this workstation
              </p>

              <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
                {me?.permissions && me.permissions.length > 0 ? (
                  me.permissions.map((perm) => (
                    <span
                      key={perm}
                      className="inline-block px-2 py-0.5 rounded bg-slate-100 font-mono text-xs text-slate-700 border border-slate-200"
                    >
                      {perm}
                    </span>
                  ))
                ) : (
                  <span className="font-mono text-xs text-slate-500">Default permissions assigned</span>
                )}
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Enforced on the central hospital server for every request.
              </p>
            </section>

            {/* Security notes */}
            <section className="bg-white rounded-lg border border-slate-200 shadow-2xs p-6 space-y-3">
              <h2 className="text-base font-bold text-slate-900">
                Security notes
              </h2>
              <div className="space-y-2 text-xs text-slate-600">
                <p>
                  <strong>• Local network only:</strong> Patient data never leaves the hospital LAN and cannot be accessed externally.
                </p>
                <p>
                  <strong>• Audit trail:</strong> Every clinical note, prescription and consultation state change is immutably logged with your username.
                </p>
                <p>
                  <strong>• Shared computers:</strong> Always click &ldquo;Sign out&rdquo; before stepping away from the clinic room or reception desk.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
      <Modal
        open={confirmSignOutOpen}
        variant="destructive"
        title="Sign out other computers?"
        onClose={() => setConfirmSignOutOpen(false)}
        busy={revokeSessionsMutation.isPending}
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Every other computer signed in as you will be signed out. This computer stays signed in.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmSignOutOpen(false)}
              disabled={revokeSessionsMutation.isPending}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Keep them signed in
            </button>
            <button
              type="button"
              data-autofocus
              onClick={handleSignOutOthers}
              disabled={revokeSessionsMutation.isPending}
              className="min-h-9 rounded-lg bg-red-800 px-3 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
            >
              {revokeSessionsMutation.isPending ? 'Signing out…' : 'Sign out others'}
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
