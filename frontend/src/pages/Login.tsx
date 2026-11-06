import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLogin, useSetupStatus } from '../api/queries'
import { ApiError } from '../api/client'
import { ROLE_HOME } from '../auth/roles'
import { TakeoverSessionModal, type ActiveSessionInfo } from '../components/TakeoverSessionModal'

type LoginNotice = {
  title: string
  message: string
  tone: 'danger' | 'warning'
}

export function Login() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const reason = searchParams.get('reason')
  const notice = searchParams.get('notice')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loginNotice, setLoginNotice] = useState<LoginNotice | null>(null)
  const [showTakeoverModal, setShowTakeoverModal] = useState(false)
  const [activeSessionConflict, setActiveSessionConflict] = useState<ActiveSessionInfo | null>(null)
  const [isTakingOver, setIsTakingOver] = useState(false)

  const loginMutation = useLogin()
  const {
    data: setupStatus,
    isError: setupStatusError,
  } = useSetupStatus()

  const handleConfirmTakeover = async () => {
    setIsTakingOver(true)
    try {
      const me = await loginMutation.mutateAsync({
        username: username.trim(),
        password,
        takeover: true,
      })
      setShowTakeoverModal(false)
      if (me.must_change_password) {
        navigate('/change-password', { replace: true })
      } else {
        navigate(ROLE_HOME[me.role], { replace: true })
      }
    } catch (err: unknown) {
      setShowTakeoverModal(false)
      if (err instanceof ApiError) {
        setLoginNotice({
          title: 'Takeover unsuccessful',
          message: err.message,
          tone: 'danger',
        })
      }
    } finally {
      setIsTakingOver(false)
    }
  }

  const handleCancelTakeover = () => {
    setShowTakeoverModal(false)
    setActiveSessionConflict(null)
    setPassword('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoginNotice(null)

    const cleanUsername = username.trim()
    if (!cleanUsername) {
      setLoginNotice({
        title: 'Username required',
        message: 'Enter the username provided by your hospital administrator.',
        tone: 'danger',
      })
      return
    }

    try {
      const me = await loginMutation.mutateAsync({
        username: cleanUsername,
        password,
      })

      if (me.must_change_password) {
        navigate('/change-password', { replace: true })
      } else {
        navigate(ROLE_HOME[me.role], { replace: true })
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (
          err.status === 409 &&
          (err.code === 'session_in_use' || (err as any).extra?.code === 'session_in_use')
        ) {
          const conflictData = (err.active_session || (err.extra as any)?.active_session) as ActiveSessionInfo
          setActiveSessionConflict(conflictData || null)
          setShowTakeoverModal(true)
          return
        }
        if (err.code === 'too_many_attempts') {
          setLoginNotice({
            title: 'Sign-in temporarily paused',
            message: err.message,
            tone: 'warning',
          })
        } else if (err.code === 'csrf_failed') {
          setLoginNotice({
            title: 'Request could not be verified',
            message:
              'Refresh the page and try again. Open the application using the hospital server address, not a different browser address.',
            tone: 'danger',
          })
        } else if (err.status >= 500) {
          setLoginNotice({
            title: 'Hospital server unavailable',
            message:
              'The local server could not complete sign-in. Check that the hospital server is running, then try again.',
            tone: 'danger',
          })
        } else {
          setLoginNotice({
            title: 'Sign-in unsuccessful',
            message: err.message,
            tone: 'danger',
          })
        }
      } else {
        setLoginNotice({
          title: 'Unable to connect',
          message:
            'The hospital application could not be reached. Check your local network connection and try again.',
          tone: 'danger',
        })
      }
    }
  }

  const noticeClasses =
    loginNotice?.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : 'border-rose-200 bg-rose-50 text-rose-950'

  return (
    <main className="min-h-screen bg-[#F4F6F2] text-[#202B33]">
      <div className="grid min-h-screen lg:grid-cols-[1.04fr_0.96fr]">
        <section
          aria-label="Kalyan Hospital"
          className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-[#5D0B26] px-10 py-10 text-white lg:flex xl:px-16"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -right-44 -top-40 h-[34rem] w-[34rem] rounded-full border border-white/10" />
            <div className="absolute -right-24 -top-20 h-[25rem] w-[25rem] rounded-full border border-white/10" />
            <div className="absolute -bottom-48 -left-36 h-[34rem] w-[34rem] rounded-full border border-[#D4B45F]/20" />
            <div className="absolute bottom-0 left-0 h-1 w-40 bg-[#D4B45F]" />
          </div>

          <div className="relative z-10 flex items-center gap-4">
            <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-2xl bg-white p-1.5 shadow-xl">
              <img
                src="/kalyan-hospital-crest.webp"
                alt="Sri Vashishtha Kalyan Trust crest"
                className="h-full w-full rounded-xl object-contain"
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8D7A4]">
                Sri Vashishtha Kalyan Trust
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight">Kalyan Hospital</p>
              <p className="mt-1 text-sm text-white/65">Ara, Bhojpur, Bihar</p>
            </div>
          </div>

          <div className="relative z-10 max-w-xl py-16">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.28em] text-[#E8D7A4]">
              Hospital Management Workspace
            </p>
            <h1 className="max-w-lg text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">
              Better care starts with a clearer picture.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/75">
              A dedicated workspace for patient records, clinical care and hospital
              operations — designed for the people who keep the hospital running.
            </p>

            <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
              {[
                { label: 'Patient records', detail: 'One history' },
                { label: 'Staff access', detail: 'Role-based' },
                { label: 'Data storage', detail: 'Local-first' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-white/15 bg-white/[0.06] px-3 py-3 backdrop-blur-sm"
                >
                  <p className="text-xs font-medium text-white/60">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between border-t border-white/15 pt-5 text-xs text-white/55">
            <span>Trusted care. Connected records.</span>
            <span>EST. ARA, BIHAR</span>
          </div>
        </section>

        <section className="flex min-h-screen flex-col items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
          <div className="mb-7 flex w-full max-w-[440px] items-center gap-3 lg:hidden">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-[#DDE5DF]">
              <img
                src="/kalyan-hospital-crest.webp"
                alt="Sri Vashishtha Kalyan Trust crest"
                className="h-full w-full rounded-lg object-contain"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#7A1B3C]">
                Sri Vashishtha Kalyan Trust
              </p>
              <p className="mt-1 text-lg font-semibold text-[#202B33]">Kalyan Hospital</p>
            </div>
          </div>

          <div className="w-full max-w-[440px]">
            <div className="rounded-[26px] border border-[#E1E7E1] bg-white p-7 shadow-[0_24px_70px_rgba(28,46,36,0.09)] sm:p-9">
              <div className="mb-8">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#E6D8DE] bg-[#FBF5F7] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#7A1B3C]">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#9E1B42]" />
                  Authorized staff access
                </div>
                <h2 className="text-[30px] font-semibold tracking-tight text-[#202B33]">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#64736D]">
                  Sign in with your hospital staff account to continue.
                </p>
              </div>

              {notice === 'created' && (
                <div
                  role="status"
                  className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
                >
                  Administrator created. Please sign in.
                </div>
              )}

              {notice === 'closed' && (
                <div
                  role="status"
                  className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  Setup wizard is closed. Administrator already exists.
                </div>
              )}

              {reason === 'expired' && (
                <div
                  role="status"
                  className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  You were signed out after 30 minutes of inactivity
                </div>
              )}

              {setupStatus?.setup_required && (
                <div
                  role="status"
                  className="mb-5 rounded-xl border border-[#D7E4F2] bg-[#F2F7FC] px-4 py-3 text-sm text-[#21486B] flex flex-col gap-1"
                >
                  <p>No administrator exists yet - open the setup wizard</p>
                  <Link
                    to="/setup"
                    className="font-semibold underline underline-offset-4 hover:text-[#14334F] inline-block"
                  >
                    Setup Wizard
                  </Link>
                </div>
              )}

              {setupStatusError && (
                <div
                  role="status"
                  className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  Could not verify the setup status. You can still try signing in; check the local server if this continues.
                </div>
              )}

              {loginNotice && (
                <div
                  id="login-alert"
                  role="alert"
                  aria-live="assertive"
                  className={`mb-5 rounded-xl border px-4 py-3 ${noticeClasses}`}
                >
                  <p className="text-sm font-semibold">{loginNotice.title}</p>
                  <p className="mt-1 text-sm leading-5">{loginNotice.message}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loginMutation.isPending}>
                <div>
                  <label
                    htmlFor="username-input"
                    className="mb-2 block text-sm font-semibold text-[#34423B]"
                  >
                    Username
                  </label>
                  <input
                    id="username-input"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setLoginNotice(null)
                    }}
                    aria-invalid={loginNotice?.title === 'Username required'}
                    aria-describedby={loginNotice?.title === 'Username required' ? 'login-alert' : undefined}
                    placeholder="Enter your staff username"
                    className="min-h-[50px] w-full rounded-xl border border-[#D7E0D9] bg-[#FBFCFA] px-4 text-sm text-[#202B33] outline-none transition placeholder:text-[#98A39C] hover:border-[#AEBDB2] focus:border-[#9E1B42] focus:ring-4 focus:ring-[#9E1B42]/10"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label
                      htmlFor="password-input"
                      className="block text-sm font-semibold text-[#34423B]"
                    >
                      Password
                    </label>
                    <span className="text-xs text-[#87928B]">Keep it private</span>
                  </div>
                  <div className="relative">
                    <input
                      id="password-input"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setLoginNotice(null)
                      }}
                      aria-invalid={loginNotice?.tone === 'danger' && loginNotice.title !== 'Username required'}
                      aria-describedby={loginNotice && loginNotice.title !== 'Username required' ? 'login-alert' : undefined}
                      placeholder="Enter your password"
                      className="min-h-[50px] w-full rounded-xl border border-[#D7E0D9] bg-[#FBFCFA] px-4 pr-20 text-sm text-[#202B33] outline-none transition placeholder:text-[#98A39C] hover:border-[#AEBDB2] focus:border-[#9E1B42] focus:ring-4 focus:ring-[#9E1B42]/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-2 inline-flex min-w-14 items-center justify-center rounded-lg px-3 text-xs font-semibold text-[#7A1B3C] hover:bg-[#FBF5F7] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#9E1B42]"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loginMutation.isPending || !username.trim() || !password}
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#7A1B3C] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(122,27,60,0.18)] transition hover:bg-[#64142F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B42] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {loginMutation.isPending && (
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
                    />
                  )}
                  {loginMutation.isPending ? 'Signing in…' : 'Sign in to workspace'}
                </button>
              </form>

              <div className="mt-6 border-t border-[#EEF1ED] pt-5">
                <p className="text-center text-xs leading-5 text-[#7B8780]">
                  Need an account or password reset? Contact your hospital administrator.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center gap-2 text-center">
              <p className="text-xs font-medium text-[#64736D]">
                Kalyan Hospital · Ara, Bhojpur, Bihar
              </p>
              <p className="max-w-sm text-xs leading-5 text-[#8A968E]">
                This application runs on the hospital's local network. Internet access is not required for normal use.
              </p>
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.15em] text-[#A1AAA4]">
                For authorized hospital staff only
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Concurrent Session Takeover Modal (D-19-26, DWS-10) */}
      <TakeoverSessionModal
        open={showTakeoverModal}
        activeSession={activeSessionConflict}
        isSubmitting={isTakingOver}
        onConfirm={handleConfirmTakeover}
        onCancel={handleCancelTakeover}
      />
    </main>
  )
}
