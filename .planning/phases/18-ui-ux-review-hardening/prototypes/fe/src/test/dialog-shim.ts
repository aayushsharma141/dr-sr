const modalStack: HTMLDialogElement[] = []
const previouslyFocused = new WeakMap<HTMLDialogElement, Element | null>()
const returnValues = new WeakMap<HTMLDialogElement, string>()
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function install() {
  if (typeof HTMLDialogElement === 'undefined') return
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>
  if (typeof proto.showModal === 'function') return            // a newer jsdom implements it natively
  Object.defineProperty(proto, 'returnValue', { configurable: true,
    get(this: HTMLDialogElement) { return returnValues.get(this) ?? '' },
    set(this: HTMLDialogElement, v: string) { returnValues.set(this, String(v)) } })
  proto.show = function (this: HTMLDialogElement) {
    if (this.hasAttribute('open')) { if (modalStack.includes(this)) throw new DOMException('Already open as modal.', 'InvalidStateError'); return }
    this.setAttribute('open', '')
  }
  proto.showModal = function (this: HTMLDialogElement) {
    if (this.hasAttribute('open')) { if (modalStack.includes(this)) return; throw new DOMException('Already open.', 'InvalidStateError') }
    if (!this.isConnected) throw new DOMException('Not connected.', 'InvalidStateError')
    this.setAttribute('open', ''); modalStack.push(this)
    const a = document.activeElement; previouslyFocused.set(this, a && a !== document.body ? a : null)
    ;(this.querySelector<HTMLElement>('[autofocus]') ?? this.querySelector<HTMLElement>(FOCUSABLE))?.focus()
  }
  proto.close = function (this: HTMLDialogElement, rv?: string) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open'); if (rv !== undefined) returnValues.set(this, String(rv))
    const i = modalStack.indexOf(this); if (i >= 0) modalStack.splice(i, 1)
    const opener = previouslyFocused.get(this); previouslyFocused.delete(this)
    if (opener && opener.isConnected) (opener as HTMLElement).focus()
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)      // spec: queued task, not synchronous
  }
  proto.requestClose = function (this: HTMLDialogElement, rv?: string) {
    if (!this.hasAttribute('open')) return
    const cancel = new Event('cancel', { cancelable: true }); this.dispatchEvent(cancel)
    if (!cancel.defaultPrevented) this.close(rv)
  }
  document.addEventListener('keydown', (e) => {                      // Esc closes the topmost modal, like the close watcher
    if (e.key !== 'Escape' || e.defaultPrevented) return
    while (modalStack.length && !modalStack[modalStack.length - 1].isConnected) modalStack.pop()
    modalStack[modalStack.length - 1]?.requestClose()
  })
}
install()
