// frontend/src/components/Modal.tsx
import { useEffect, useId, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ModalDismiss = 'closerequest' | 'any' | 'none'
export interface ModalProps {
  open: boolean
  onClose: () => void            // called once on user dismissal; the parent must set open=false
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  dismiss?: ModalDismiss         // closerequest (default): Esc only; any: Esc + backdrop; none: buttons only
  busy?: boolean                 // blocks Esc / backdrop / close button while a mutation is pending
  className?: string             // width utility, e.g. 'max-w-md' (full static class strings only: Tailwind scans source)
  print?: 'a4' | 'receipt'       // portal to <body>, add .print-portal and data-print-page
}

function requestClose(dialog: HTMLDialogElement) {   // Chrome/Edge 134+ has requestClose
  if (typeof dialog.requestClose === 'function') return dialog.requestClose()
  if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close()
}

export function Modal({ open, onClose, title, description, children, dismiss = 'closerequest', busy = false, className = 'max-w-lg', print }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const openRef = useRef(open)
  const onCloseRef = useRef(onClose)
  const pressedBackdrop = useRef(false)
  const titleId = useId()
  const descId = useId()

  useEffect(() => { openRef.current = open; onCloseRef.current = onClose })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    let opener: HTMLElement | null = null
    if (open && !dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()   // React autoFocus cannot work here
    }
    return () => {                                   // also StrictMode's mount/unmount/mount and parent unmount
      if (dialog.open) dialog.close()
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

  const dialog = (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      data-print-page={print}
      onCancel={(e) => { if (busy || dismiss === 'none') e.preventDefault() }}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      // m-auto: preflight margin:0 would un-centre it. pointer-events-auto: usable over an open Radix Sheet.
      className={`pointer-events-auto m-auto w-full rounded-xl bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/50 ${print ? 'print-portal ' : ''}${className}`}
    >
      {open && (
        <div className="p-6 print:p-0">
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200 pb-3 print:hidden">
            <div>
              <h2 id={titleId} className="text-lg font-bold">{title}</h2>
              {description && <p id={descId} className="text-sm text-neutral-600">{description}</p>}
            </div>
            <button type="button" aria-label="Close" disabled={busy} onClick={() => ref.current && requestClose(ref.current)}
              className="rounded p-1 text-neutral-600 hover:bg-neutral-100">{'\u2715'}</button>
          </div>
          <div className="pt-4 print:pt-0">{children}</div>
        </div>
      )}
    </dialog>
  )
  return print ? createPortal(dialog, document.body) : dialog
}
