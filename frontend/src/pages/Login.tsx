import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLogin, useSetupStatus } from '../api/queries'
import { ApiError } from '../api/client'
import { ROLE_HOME } from '../auth/roles'
import { TakeoverSessionModal, type ActiveSessionInfo } from '../components/TakeoverSessionModal'
import { IconEye, IconEyeOff, IconLock, IconLogin, IconUser } from '../components/icons'

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
          const conflictData = (err.active_session ?? (err as any)?.extra?.active_session) as ActiveSessionInfo
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
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-red-200 bg-red-50 text-red-800'

  return (
    <main className="relative min-h-screen h-full w-full overflow-y-auto overflow-x-hidden bg-[#FAF6F3] text-slate-900">
      {/* Desktop Background Layer */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden lg:block bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('/assets/login_clean_full_bg.png')` }}
      />

      {/* Main 2-column structure */}
      <div className="relative z-10 grid min-h-screen w-full lg:grid-cols-[1.1fr_0.9fr] xl:grid-cols-[1.15fr_0.85fr]">
        {/* Left Hero Section (Desktop) */}
        <section
          aria-label="Kalyan Hospital"
          className="relative hidden min-h-screen flex-col justify-between overflow-hidden p-8 text-white lg:flex xl:p-12"
        >
          {/* Accessible screen-reader content that mirrors the visual banner */}
          <div className="sr-only">
            <p>Sri Vashishtha Kalyan Trust</p>
            <h1>Better care starts with a clearer picture.</h1>
            <p>Hospital Management Workspace</p>
            <p>Trusted care. Connected records. EST. ARA, BIHAR</p>
          </div>
        </section>

        {/* Right Section / Form Card */}
        <section
          aria-label="Staff Sign In"
          className="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:px-6 lg:px-10 xl:px-14"
        >
          {/* Mobile Hospital Crest Header (visible only on small screens) */}
          <div className="mb-6 flex w-full max-w-[500px] items-center gap-3.5 lg:hidden">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#E7DDD5] bg-white p-1.5 shadow-sm">
              <img
                src="/api/assets/active-logo"
                alt="Sri Vashishtha Kalyan Trust crest"
                className="h-full w-full rounded-xl object-contain"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).src = '/assets/kalyan_hospital_logo.png'
                }}
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-800">
                Sri Vashishtha Kalyan Trust
              </p>
              <p className="text-xl font-bold tracking-tight text-brand-900">
                Kalyan Hospital
              </p>
              <p className="text-xs text-slate-600">कल्याण अस्पताल · Hospital Management Workspace</p>
            </div>
          </div>

          {/* Floating Sign-in Card */}
          <div className="relative w-full max-w-[510px] rounded-[28px] border border-[#E7DDD5] bg-white/95 p-8 shadow-[0_20px_50px_-16px_rgba(93,11,38,0.12),0_4px_16px_-4px_rgba(15,23,42,0.06)] ring-1 ring-white/70 backdrop-blur-sm sm:p-11 after:pointer-events-none after:absolute after:bottom-0 after:left-14 after:right-14 after:h-[2px] after:bg-gradient-to-r after:from-transparent after:via-gold-400/65 after:to-transparent">
            {/* Header: Gold accent dash + Title + Subtitle */}
            <div className="mb-7">
              <div
                aria-hidden="true"
                className="mb-3.5 h-1.5 w-9 rounded-full bg-gradient-to-r from-gold-400 to-gold-600"
              />
              <h2 className="text-[32px] sm:text-[34px] font-bold tracking-tight text-brand-900 leading-tight">
                Welcome back
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Sign in with your hospital staff account to continue.
              </p>
            </div>

            {/* Status & Feedback Notices */}
            {notice === 'created' && (
              <div
                role="status"
                className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                Administrator created. Please sign in.
              </div>
            )}

            {notice === 'closed' && (
              <div
                role="status"
                className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                Setup wizard is closed. Administrator already exists.
              </div>
            )}

            {reason === 'expired' && (
              <div
                role="status"
                className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                You were signed out after 30 minutes of inactivity
              </div>
            )}

            {setupStatus?.setup_required && (
              <div
                role="status"
                className="mb-5 flex flex-col gap-1 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
              >
                <p>No administrator exists yet - open the setup wizard</p>
                <Link
                  to="/setup"
                  className="inline-block w-fit rounded-sm font-semibold text-sky-900 underline underline-offset-4 transition-colors hover:text-sky-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                >
                  Setup Wizard
                </Link>
              </div>
            )}

            {setupStatusError && (
              <div
                role="status"
                className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
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

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loginMutation.isPending}>
              {/* Username Input */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <IconUser className="h-[18px] w-[18px] text-brand-800" stroke={1.8} />
                  <label htmlFor="username-input">Username</label>
                </div>
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
                  className="min-h-[50px] w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors duration-150 hover:border-slate-400 focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
                />
              </div>

              {/* Password Input */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <IconLock className="h-[18px] w-[18px] text-brand-800" stroke={1.8} />
                    <label htmlFor="password-input">Password</label>
                  </div>
                  <span className="text-xs text-slate-600">Keep it private</span>
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
                    className="min-h-[50px] w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors duration-150 hover:border-slate-400 focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-1.5 my-auto inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                  >
                    {showPassword ? (
                      <IconEyeOff className="h-4 w-4" stroke={1.8} />
                    ) : (
                      <IconEye className="h-4 w-4" stroke={1.8} />
                    )}
                  </button>
                </div>
              </div>

              {/* Sign in Button */}
              <button
                type="submit"
                disabled={loginMutation.isPending || !username.trim() || !password}
                className="mt-4 flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-brand-800 via-brand-700 to-brand-800 px-5 py-3.5 text-base font-semibold text-white shadow-[0_6px_18px_-4px_rgba(116,23,50,0.4)] transition-all duration-150 hover:-translate-y-0.5 hover:from-brand-900 hover:via-brand-800 hover:to-brand-900 hover:shadow-[0_10px_24px_-4px_rgba(93,11,38,0.45)] active:translate-y-0 active:shadow-[0_4px_12px_-2px_rgba(93,11,38,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {loginMutation.isPending ? (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
                  />
                ) : (
                  <IconLogin className="h-5 w-5" stroke={2} />
                )}
                <span>{loginMutation.isPending ? 'Signing in…' : 'Sign in to workspace'}</span>
              </button>
            </form>
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