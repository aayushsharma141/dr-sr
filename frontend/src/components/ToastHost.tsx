import { useEffect, useId, useSyncExternalStore } from 'react'
import { IconAlertCircle, IconAlertTriangle, IconBell, IconCheck, IconX } from './icons'

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  id?: string
  title?: string
  duration?: number
  action?: ToastAction
}

export interface ToastEntry {
  id: string
  tone: ToastTone
  title?: string
  message: string
  duration: number
  action?: ToastAction
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  warning: 4000,
  error: 6000,
}

const MAX_TOASTS = 4

interface TimerState {
  timer: ReturnType<typeof setTimeout> | null
  remaining: number
  startedAt: number
}

let nextSeq = 1
let entries: ToastEntry[] = []
const timers = new Map<string, TimerState>()
const listeners = new Set<() => void>()
// Tracks mounted hosts so only the latest mounted ToastHost renders (prevents duplicates in tests).
const hostStack: string[] = []

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ToastEntry[] {
  return entries
}

function clearTimer(id: string) {
  const state = timers.get(id)
  if (state?.timer != null) {
    clearTimeout(state.timer)
    state.timer = null
  }
  timers.delete(id)
}

function startTimer(id: string, duration: number) {
  clearTimer(id)
  if (duration <= 0) return
  const startedAt = Date.now()
  const timer = setTimeout(() => {
    dismissToast(id)
  }, duration)
  timers.set(id, { timer, remaining: duration, startedAt })
}

export function pauseToast(id: string) {
  const state = timers.get(id)
  if (!state || state.timer == null) return
  clearTimeout(state.timer)
  state.timer = null
  const elapsed = Date.now() - state.startedAt
  state.remaining = Math.max(0, state.remaining - elapsed)
}

export function resumeToast(id: string) {
  const state = timers.get(id)
  if (!state || state.timer != null) return
  if (state.remaining <= 0) {
    dismissToast(id)
    return
  }
  state.startedAt = Date.now()
  state.timer = setTimeout(() => {
    dismissToast(id)
  }, state.remaining)
}

export function dismissToast(id: string) {
  clearTimer(id)
  const next = entries.filter((item) => item.id !== id)
  if (next.length !== entries.length) {
    entries = next
    emit()
  }
}

export function clearToasts() {
  for (const state of timers.values()) {
    if (state.timer != null) clearTimeout(state.timer)
  }
  timers.clear()
  if (entries.length > 0) {
    entries = []
    emit()
  }
}

function pushToast(tone: ToastTone, message: string, options: ToastOptions = {}): string {
  const trimmed = message.trim()
  if (!trimmed) return ''

  const duration = options.duration ?? DEFAULT_DURATION[tone]
  const existing = options.id
    ? entries.find((item) => item.id === options.id)
    : entries.find(
        (item) =>
          item.tone === tone &&
          item.message === trimmed &&
          (item.title ?? '') === (options.title ?? ''),
      )

  const id = existing?.id ?? options.id ?? `toast-${nextSeq++}`
  const nextEntry: ToastEntry = {
    id,
    tone,
    title: options.title,
    message: trimmed,
    duration,
    action: options.action,
  }

  if (existing) {
    entries = entries.map((item) => (item.id === id ? nextEntry : item))
  } else {
    const nextList = [...entries, nextEntry]
    while (nextList.length > MAX_TOASTS) {
      const removed = nextList.shift()
      if (removed) clearTimer(removed.id)
    }
    entries = nextList
  }

  startTimer(id, duration)
  emit()
  return id
}

export const toast = {
  success: (message: string, options?: ToastOptions) => pushToast('success', message, options),
  error: (message: string, options?: ToastOptions) => pushToast('error', message, options),
  warning: (message: string, options?: ToastOptions) => pushToast('warning', message, options),
  info: (message: string, options?: ToastOptions) => pushToast('info', message, options),
  dismiss: dismissToast,
  clear: clearToasts,
}

const TONE_STYLES: Record<
  ToastTone,
  {
    container: string
    iconWrap: string
    title: string
    body: string
    action: string
    close: string
  }
> = {
  success: {
    container: 'border-emerald-300 bg-emerald-50 text-emerald-950 shadow-lg shadow-emerald-950/10',
    iconWrap: 'bg-emerald-700 text-white',
    title: 'text-emerald-950',
    body: 'text-emerald-900',
    action: 'border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100',
    close: 'text-emerald-800 hover:bg-emerald-100 hover:text-emerald-950',
  },
  error: {
    container: 'border-red-300 bg-red-50 text-red-950 shadow-lg shadow-red-950/10',
    iconWrap: 'bg-red-700 text-white',
    title: 'text-red-950',
    body: 'text-red-900',
    action: 'border-red-300 bg-white text-red-900 hover:bg-red-100',
    close: 'text-red-800 hover:bg-red-100 hover:text-red-950',
  },
  warning: {
    container: 'border-amber-300 bg-amber-50 text-amber-950 shadow-lg shadow-amber-950/10',
    iconWrap: 'bg-amber-700 text-white',
    title: 'text-amber-950',
    body: 'text-amber-900',
    action: 'border-amber-300 bg-white text-amber-950 hover:bg-amber-100',
    close: 'text-amber-800 hover:bg-amber-100 hover:text-amber-950',
  },
  info: {
    container: 'border-sky-300 bg-sky-50 text-sky-950 shadow-lg shadow-sky-950/10',
    iconWrap: 'bg-sky-700 text-white',
    title: 'text-sky-950',
    body: 'text-sky-900',
    action: 'border-sky-300 bg-white text-sky-900 hover:bg-sky-100',
    close: 'text-sky-800 hover:bg-sky-100 hover:text-sky-950',
  },
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  switch (tone) {
    case 'success':
      return <IconCheck className="h-4 w-4" stroke={2.4} aria-hidden="true" />
    case 'error':
      return <IconAlertCircle className="h-4 w-4" stroke={2.1} aria-hidden="true" />
    case 'warning':
      return <IconAlertTriangle className="h-4 w-4" stroke={2.1} aria-hidden="true" />
    case 'info':
      return <IconBell className="h-4 w-4" stroke={2.1} aria-hidden="true" />
  }
}

/**
 * Top-center toast notification host mounted once at the app root.
 * Success/info/warning toasts auto-dismiss after 4s; error toasts after 6s.
 * Hovering or focusing a toast pauses its timer until pointer/focus leaves.
 */
export function ToastHost() {
  const hostId = useId()
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    const hadOtherHosts = hostStack.length > 0
    hostStack.push(hostId)
    if (hadOtherHosts) emit()
    return () => {
      const idx = hostStack.indexOf(hostId)
      if (idx !== -1) hostStack.splice(idx, 1)
      if (hostStack.length > 0) emit()
    }
  }, [hostId])

  const isActiveHost = hostStack.length === 0 || hostStack[hostStack.length - 1] === hostId
  if (!isActiveHost || items.length === 0) return null

  return (
    <div
      data-testid="toast-host"
      className="pointer-events-none fixed top-4 left-1/2 z-[70] flex w-[min(calc(100vw-2rem),34rem)] -translate-x-1/2 flex-col items-center gap-2.5 print:hidden"
    >
      {items.map((item) => {
        const styles = TONE_STYLES[item.tone]
        const role = item.tone === 'error' ? 'alert' : 'status'
        const ariaLive = item.tone === 'error' ? 'assertive' : 'polite'

        return (
          <div
            key={item.id}
            role={role}
            aria-live={ariaLive}
            aria-atomic="true"
            onMouseEnter={() => pauseToast(item.id)}
            onMouseLeave={() => resumeToast(item.id)}
            onFocus={() => pauseToast(item.id)}
            onBlur={() => resumeToast(item.id)}
            className={`toast-enter pointer-events-auto flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-sm ${styles.container}`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${styles.iconWrap}`}
            >
              <ToastIcon tone={item.tone} />
            </span>

            <div className="min-w-0 flex-1 space-y-1">
              {item.title && (
                <p className={`font-semibold leading-snug ${styles.title}`}>{item.title}</p>
              )}
              <p className={`leading-snug font-medium break-words ${styles.body}`}>{item.message}</p>
              {item.action && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      item.action?.onClick()
                      dismissToast(item.id)
                    }}
                    className={`inline-flex min-h-8 cursor-pointer items-center rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${styles.action}`}
                  >
                    {item.action.label}
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              aria-label="Dismiss message"
              className={`-mr-1 -mt-0.5 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${styles.close}`}
            >
              <IconX className="h-4 w-4" stroke={2.2} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
