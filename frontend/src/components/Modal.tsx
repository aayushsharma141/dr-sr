// frontend/src/components/Modal.tsx
// One shared overlay for the whole app. Built on the native <dialog> element
// (showModal): the browser provides the inert background, focus containment,
// Esc handling and focus return. Do not add a dialog role, aria-modal or a focus trap.
import { useEffect, useId, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ModalDismiss = 'closerequest' | 'any' | 'none'
export type ModalVariant = 'info' | 'success' | 'warning' | 'error' | 'destructive'
export interface ModalProps {
  open: boolean
  onClose: () => void            // called once on user dismissal; the parent must set open=false
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  variant?: ModalVariant         // visual and spoken label; colour is never the only signal
  dismiss?: ModalDismiss         // closerequest (default): Esc only; any: Esc + backdrop; none: buttons only
  busy?: boolean                 // blocks Esc / backdrop / close button while a mutation is pending
  className?: string             // width utility, e.g. 'max-w-md' (full static class strings only: Tailwind scans source)
  print?: 'a4' | 'receipt'       // portal to <body>, add .print-portal and data-print-page; mounted only while open
}

const VARIANT_STYLE: Record<ModalVariant, { label: string; bar: string; text: string }> = {
  info: { label: 'Information', bar: 'bg-blue-700', text: 'text-blue-900' },
  success: { label: 'Success', bar: 'bg-emerald-700', text: 'text-emerald-900' },
  warning: { label: 'Warning', bar: 'bg-amber-600', text: 'text-amber-900' },
  error: { label: 'Error', bar: 'bg-red-700', text: 'text-red-900' },
  destructive: { label: 'Confirm action', bar: 'bg-red-800', text: 'text-red-900' },
}

// Every browser this app supports has showModal/close. The attribute fallback only keeps an
// environment without them (old jsdom) rendering the content; it is not a supported mode.
function openDialog(d: HTMLDialogElement) {
  if (typeof d.showModal === 'function') d.showModal()
  else d.setAttribute('open', '')
}
function closeDialog(d: HTMLDialogElement) {
  if (typeof d.close === 'function') d.close()
  else d.removeAttribute('open')
}

function requestClose(dialog: HTMLDialogElement) {   // Chrome/Edge 134+ has requestClose
  if (typeof dialog.requestClose === 'function') return dialog.requestClose()
  if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) closeDialog(dialog)
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  variant = 'info',
  dismiss = 'closerequest',
  busy = false,
  className = 'max-w-lg',
  print,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const openRef = useRef(open)
  const onCloseRef = useRef(onClose)
  const pressedBackdrop = useRef(false)
  const titleId = useId()
  const descId = useId()
  const style = VARIANT_STYLE[variant]

  useEffect(() => { openRef.current = open; onCloseRef.current = onClose })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    let opener: HTMLElement | null = null
    if (open && !dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      openDialog(dialog)
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()   // React autoFocus cannot work here
    }
    return () => {                                   // also StrictMode's mount/unmount/mount and parent unmount
      if (dialog.open) closeDialog(dialog)
      queueMicrotask(() => {                         // browsers do not restore focus when the open <dialog> is REMOVED
        if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus()
      })
    }
  }, [open])

  const handleClose = () => {                        // async 'close' event
    const d = ref.current
    if (!d || d.open || !openRef.current) return     // ignore our own close() and stale StrictMode events
    onCloseRef.current()
  }
  const handlePointerDown = (e: PointerEvent<HTMLDialogElement>) => { pressedBackdrop.current = e.target === e.currentTarget }
  const handleClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (dismiss !== 'any' || busy) return
    if (e.target === e.currentTarget && pressedBackdrop.current && ref.current) requestClose(ref.current)
    pressedBackdrop.current = false                  // panel fills the dialog (p-0) so only ::backdrop presses hit it
  }

  // A print dialog must not stay in the DOM while closed: the print CSS hides the app
  // whenever a .print-portal exists, so a closed one would blank every other print.
  if (print && !open) return null

  const dialog = (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      data-print-page={print}
      data-variant={variant}
      onCancel={(e) => { if (busy || dismiss === 'none') e.preventDefault() }}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      // m-auto: preflight margin:0 would un-centre it. pointer-events-auto: usable over an open Radix Sheet.
      // max-h + overflow: long English or Hindi content scrolls inside the dialog, never off screen.
      className={`pointer-events-auto m-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/50 ${print ? 'print-portal ' : ''}${className}`}
    >
      {open && (
        <div className="flex min-h-0 flex-col print:block">
          <div className={`h-1.5 shrink-0 rounded-t-xl ${style.bar} print:hidden`} aria-hidden="true" />
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 pb-3 pt-4 print:hidden">
            <div className="min-w-0 break-words">
              <p className={`text-xs font-semibold uppercase tracking-wide ${style.text}`}>{style.label}</p>
              <h2 id={titleId} className="text-lg font-bold">{title}</h2>
              {description && <p id={descId} className="text-sm text-neutral-600">{description}</p>}
            </div>
            <button
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={() => onClose()}
              className="shrink-0 rounded p-2 text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 cursor-pointer"
            >
              {'✕'}
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto break-words px-6 pb-6 pt-4 print:overflow-visible print:p-0">{children}</div>
        </div>
      )}
    </dialog>
  )
  return print ? createPortal(dialog, document.body) : dialog
}
