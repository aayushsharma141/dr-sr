# Phase 18: UI/UX Review Hardening - Research

**Researched:** 2026-11-02
**Domain:** React 19 + Tailwind v4 frontend (native dialogs, print CSS, a11y, offline fonts) and Windows LAN TLS for Uvicorn
**Confidence:** HIGH for items 1-5 and 7 (each recommendation was built and run in a throwaway copy of `frontend/` and in headless Edge 156); MEDIUM for item 6 (certificate generation and TLS handshake verified; the client-PC trust steps are cited, not exercised).

Provenance tags: `[VERIFIED: ...]` = read in this repo or reproduced by an experiment this session; `[CITED: url]` = official doc; `[ASSUMED]` = not verified (all listed in the Assumptions Log). Experiments ran in `C:\Users\147ha\AppData\Local\Temp\claude\D--dr-sr\f7fa14c1-5e6a-4e63-959c-8226d274306b\scratchpad\` (session scratch: `fe\` = copy of frontend with prototypes, plus the `*.mjs`/`*.py`/`*.ps1` helpers). The repo was left exactly as found (`git status` = the same 21 entries as at the start; nothing committed).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use native `<dialog>` (no new modal or focus-trap library). No new UI component library.
- Keep the approved SAMPLE.pdf letterhead and crimson `#9E1B42` for printed documents; do not change print layouts beyond the receipt wiring and named pages.
- Print documents keep their own small type; the 12px floor applies to on-screen UI only.
- No new network dependency at runtime. A font package may be added at build time only, and its files must ship in the built assets.
- The PySide6 desktop app is untouched.

Coordination constraints (CONTEXT): at review time `frontend/src/components/AppShell.tsx`, `frontend/src/pages/AreaHome.tsx`, `frontend/package.json` and `package-lock.json` had uncommitted edits from another agent (shadcn-style redesign, `lucide-react` added). Phase 18 plans that touch those files must start by confirming they are committed (or merging with them), and must never revert them. Phase 18 adds files and changes only what each task names; no drive-by redesign.

### Claude's Discretion
CONTEXT.md has no "Claude's Discretion" section. Everything not locked above is open to recommendation: modal API and mounting pattern, test shim design, named-page technique, font packaging, `lang="hi"` mechanism, validation bridge, guard design, certificate tooling, receipt wiring.

### Deferred Ideas (OUT OF SCOPE)
- Replacing the removed decorative barcode with a real scannable barcode.
- Rewiring `RegistrationCard` to show the Patient In/Out, referral, condition, session and fee values (the patient record does not hold them; handwritten lines remain).
- Dark mode, additional languages, and any shadcn migration of the application shell.
- The unused `physiotherapy_header.jpg` and `.ico` assets in `frontend/public/assets` (owned by the other agent).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-01 | Receipts print from the app (80 mm, after payment and from history, DUPLICATE reprints, header from settings, per-document page sizes) | Item 7 (wiring), item 2 (named page, invalid `size: 80mm auto`), Prerequisite P1 (payment POST is broken), Pitfalls 1-6 |
| UX-02 | One shared native modal for every pop-up | Item 1 (verified `Modal` + jsdom shim + Edge behaviour); full overlay inventory (CONTEXT list is incomplete) |
| UX-03 | No blocking `alert()`; persistent announced inline messages | Section "UX-03 inline alerts" (2 `alert()` sites, about 17 candidate banners without `role`; heuristic scan, verify while editing) + P1 (backup calls always 422 today) |
| UX-04 | >=12px, 4.5:1, automated guard | Item 5 (guard code, contrast table, baselines) + P3 (root font-size 14px breaks the 12px floor) |
| UX-05 | `lang="hi"` + bundled Devanagari font, offline | Item 3 (121 KB woff2, 57 runs / 10 files, guard) |
| UX-06 | Every control named; errors announced only after interaction | Item 4 (only 7 unnamed controls; `userInvalid` bridge verified in Edge) |
| UX-07 | HTTPS-for-webcam decision recorded and implemented or documented | Item 6 (PowerShell CA + Uvicorn TLS verified; fallback policy option; CSP blocks previews) |
| UX-08 | Typecheck, lint, tests, headless one-page print checks, manual sheet | Item 2 (self-building Edge print harness, about 7 s for one document), Validation Architecture |
</phase_requirements>

## Project Constraints (from GEMINI.md and project memory)

- Treat `.planning/` as the source of truth; read it before acting and keep it current (GEMINI.md).
- Prefer the smallest change that satisfies the phase's verification criteria; run the project's tests and linters before declaring done (GEMINI.md).
- Commit only when the user asks; check `.planning` direction first; printed documents follow the approved SAMPLE.pdf letterhead (project memory index).
- Tooling: Node is at `C:\Program Files\nodejs` and is not on the Git Bash PATH; run `npm run typecheck`, `npx oxlint`, `npm test` from `D:\dr-sr\frontend` in PowerShell or cmd. `oxlint` prints nothing on success (exit 0).
- Do not modify, revert or format the other agent's uncommitted files (`AppShell.tsx`, `AreaHome.tsx`, `package.json`, `package-lock.json`, and the other files listed in the file-impact map).

## Summary

All seven research questions have a verified answer. The native-dialog `Modal` (about 120 lines) plus a 70-line jsdom shim passes 11 behaviour tests (Esc, focus return, StrictMode, sequential and nested dialogs, backdrop, print portal) and the existing `payment-modal` and `pending-dues` tests unchanged; Edge 156 confirmed centring, initial focus, focus return, `cancel`/`close` events. Named print pages work in Chromium only with an explicit height (`size: 80mm auto` is invalid and ignored), the `page` property must sit on `<html>` for a top-layer dialog, and a headless Edge + PDF text-scan check runs in about 7 s without new dependencies.

**Corrections to CONTEXT.md found while verifying (the planner must not copy these claims):**
1. `@page receipt { size: 80mm auto }` does not work: `auto` is only valid as the whole `size` value [CITED: developer.mozilla.org/en-US/docs/Web/CSS/@page/size]; Edge 156 fell back to US Letter 215.9x279.4 mm [VERIFIED: print experiment t2]. Use `80mm <height>mm` (fixed, or content-fit via CSSOM, item 2).
2. "Filter and form inputs in AuditViewerPage, BackupManagerPage and Users have no accessible name" is false: all their controls have `<label htmlFor>`. A brace-aware scan of 106 controls found exactly 7 unnamed ones, in other files (item 4).
3. The modal inventory is larger than the 5 files listed: 18 overlays in 13 files (table in item 1), including 4 in `Users.tsx`, 2 in `Doctors.tsx`, 2 in `TreatmentPlanWorkspace.tsx` and confirms in `AppointmentsReception`, `ClinicalEncounterWorkspace`, `BackupManagerPage`.
4. `PaymentReversalModal` and `PatientTimeline` are not mounted by any page, and `PatientDetail` has no payment history. "Reprint from payment history" needs a new UI surface (item 7).
5. **Blocking defect not in CONTEXT:** `useRecordPayment`, `useReversePayment`, `useCreateBackup`, `useRestoreBackup` pass `body: JSON.stringify(payload)` into `apiFetch`, which stringifies again, so the server receives a JSON string and answers 422 (reproduced with the real Pydantic schemas). Payments, reversals and backups cannot succeed from the UI today; UX-01 and UX-03 depend on fixing this first (Prerequisite P1).
6. The uncommitted `index.css` sets `:root`/`html` `font-size: 14px`, so every Tailwind `text-xs` (338 uses) renders at 10.5px, defeating the 12px floor (Prerequisite P3).
7. The backend CSP (`default-src 'self'`) blocks `blob:` and `data:` images and inline `<style>` elements: the PhotoUploader upload and webcam previews are broken in production regardless of HTTPS, and a `<style>`-based dynamic `@page` would silently fail (Prerequisite P2).
8. The shell redesign already depends on Radix `Dialog`/`Sheet` (`components/ui/sheet.tsx`, `dialog.tsx`). A native modal opened over an open Radix Sheet is unclickable unless the dialog sets `pointer-events: auto` (verified); `PatientsDirectory` does exactly that ("Edit Profile" over the preview Sheet).
9. Baseline is now 27 test files / 98 tests (CONTEXT says 26 / 92) because the other agent added `components/ui/__tests__/primitives.test.tsx`.

**Primary recommendation:** Wave 0 fixes the four verified prerequisites (P1 body encoding, P2 CSP `img-src blob:` plus CSSOM-only dynamic `@page`, P3 root font-size, P4 `dark:` variants in the four billing components), then build `Modal` + shim + print CSS once and migrate the 18 overlays mechanically; ship HTTPS as a separate, client-gated wave with the PowerShell generator and Uvicorn `--ssl-*`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Modal semantics, inert background, Esc, focus return | Browser (native `<dialog>`) | React wrapper (`Modal`) | Browser provides them; wrapper only sequences open/close and state |
| Printed page size and isolation | Browser (CSS `@page`, `page`, `:has()`) | React hook (CSSOM height) | Pure CSS; JS only measures content height |
| Receipt header text | API (`/settings`) | React (`useClinicSettings`) | Settings are server data; fall back to standard text |
| Hindi glyphs | Static assets (`dist/assets`, served by FastAPI `app.frontend`) | Browser font loading | Same-origin file, no CDN |
| Error announcement after interaction | Browser (`:user-invalid`) | Small JS bridge for `aria-invalid` | Native pseudo-class drives the visual and ARIA state |
| TLS termination | Uvicorn (API host) | Client OS trust store | No proxy: `client_ip()` reads the TCP peer, so a proxy would hide client IPs from audit and throttling |
| CSP and security headers | API (`SecurityHeadersMiddleware`) | - | Single source of truth for all responses |

## Standard Stack

### Core (no new runtime dependency)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| native `<dialog>` + `showModal()` | Edge 156 here; Baseline | Every modal | Locked decision; provides inert, Esc, top layer, focus return |
| React / ReactDOM | 19.3.1 | UI | Existing [VERIFIED: frontend/package.json:25-26] |
| Vitest + jsdom + Testing Library + user-event | 5.0.5 / 30.1.3 / 16.3.3 / 14.6.8 | Tests | Existing [VERIFIED: frontend/package.json:32-45] |
| Tailwind CSS + `@tailwindcss/vite` | 4.3.3 | Styling; `backdrop:` and `print:` variants exist | Existing; v4 floor is Chrome 111 [CITED: tailwindcss.com/docs/compatibility] |
| Noto Sans Devanagari variable woff2 (OFL-1.1) | v30 build from `@fontsource-variable/noto-sans-devanagari@5.3.0` | Bundled Hindi font, 121,192 bytes | Same-origin, hashed into `dist/assets` [VERIFIED: vite build experiment] |
| Microsoft Edge headless `--print-to-pdf` | 156.0.4314.58 installed | Print check | Already on the dev PC |
| Windows PowerShell 5.1 + .NET Framework 4.8 `CertificateRequest` | 5.1.26100 | LAN CA + server certificate | Zero extra tooling on the server [VERIFIED: generated and chain-verified] |
| Uvicorn `--ssl-keyfile/--ssl-certfile` | 0.54.0 | TLS on the existing process | Flags present in installed version [VERIFIED: `uvicorn --help`] |

### Supporting
| Tool | Version | Use |
|------|---------|-----|
| oxlint `--jsx-a11y-plugin` | 1.90.0 | Optional lint guard for unassociated labels (flags `AppointmentBookingModal:128`, `PhotoUploader:236`) |
| PySide6 QtPdf (`D:\dr-sr\.venv`) | 6.12.0 | Optional richer PDF inspection (page text, size) |
| `dom-accessibility-api` (already installed via Testing Library) | - | Optional DOM-level accessible-name guard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Commit woff2 under `src/assets/fonts` | `npm i -D @fontsource-variable/noto-sans-devanagari` | Package ships 3 subsets (160 KB) and edits `package.json`/lockfile that the other agent has uncommitted; names are `[ASSUMED]` (legitimacy seam could not run: "GSD runtime library is not built") |
| PowerShell `.NET` generator | mkcert / OpenSSL / Python `cryptography` | mkcert not installed; OpenSSL 3.5.9 exists only via Git for Windows on the dev PC; `cryptography` is not in `backend/requirements.lock.txt`; all need extra files on the server |
| Direct Uvicorn TLS | Reverse proxy (Caddy/nginx) | Proxy makes every request come from 127.0.0.1 (`core/net.py:34-42` reads the socket peer only), breaking audit IPs and login throttling |
| Own `Modal` | Radix Dialog (already in the working tree) | Locked decision says native; Radix keeps a second focus-trap system |

**No new npm package is required.** Package Legitimacy Audit: none installed. Evaluated only: `@fontsource-variable/noto-sans-devanagari@5.3.0` and `@fontsource/noto-sans-devanagari@5.3.0` - `npm view`: license OFL-1.1, repository fontsource/font-files, no `postinstall`, unpacked 733,677 and 1,502,382 bytes. Tagged `[ASSUMED]` (package names came from training knowledge); the committed-asset route avoids the install and any checkpoint.

**Version verification:** `npm view` timestamps both packages 2026-07-19. Browser baseline for the app is Chrome/Edge 111 (Tailwind v4); `requestClose()` and `closedby` need 134 so `Modal` carries a fallback (item 1).

## Prerequisites found during verification (do these first)

### P1. Double JSON encoding of request bodies [VERIFIED]
`frontend/src/api/client.ts:95` already stringifies: `body: init.body === undefined ? undefined : isFormData ? (init.body as BodyInit) : JSON.stringify(init.body),`. Four hooks pre-stringify (`queries.ts:822`, `:839`, `:904`, `:918`: `body: JSON.stringify(payload),`). Reproduced with the real schemas: object body -> 200; current behaviour -> `422 model_attributes_type "Input should be a valid dictionary or object to extract fields from"` for `PaymentCreate` and `PaymentReversalCreate`. Fix: pass `body: payload`. Hook tests mock the hooks, so nothing caught it; add a `renderHook` test that stubs `fetch` and asserts `JSON.parse(init.body)` is an object (not a string).

### P2. CSP vs previews and dynamic `@page` [VERIFIED]
Served through the real `SecurityHeadersMiddleware` (`backend/src/kalyan_api/main.py:45-47`: `"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"`), Edge 156 reported: font from `/assets` loads; `<img src="blob:...">` blocked; `data:` image blocked; a dynamically inserted `<style>@page ...</style>` ignored (page stayed Letter) while `document.adoptedStyleSheets` and `CSSStyleSheet.insertRule` worked (80.1x78.0 mm). `PhotoUploader.tsx:140,206` use `URL.createObjectURL` for the upload and webcam previews, so both previews are broken in production today. Fix (one line, outside the stated frontend scope, needs approval): append `img-src 'self' blob:` to the CSP; `backend/tests/test_health_tracer.py:229` only asserts the substring `"default-src 'self'"`, so no backend test changes. Alternative without touching the backend: draw previews on a `<canvas>`.

### P3. Root font-size 14px [VERIFIED]
Working-tree `frontend/src/index.css` line 20 (`font-size: 14px;` in `:root`) and lines 187-189 (`html { font-size: 14px; }`). Edge computed `rootFontSizePx: 14px`; Tailwind `--text-xs: 0.75rem` (theme.css) = 10.5px; `text-xs` appears 338 times. This also contradicts guide `respect-os-text-scale` ("Do not set a custom font size on `:root` or `html`"). Recommendation R1: delete both root declarations and set `body { font-size: 0.875rem; }` (14px body, `text-xs` = 12px). Side effect: rem-based spacing grows 14 percent (the other agent's density was tuned at 14px) - needs a visual pass at 100/125/150 percent. Fallback R2 keeps the 14px root and overrides `--text-xs: 0.8572rem` (12px) in `@theme`, but then the guard must assert the product `--text-xs x root >= 12px`. Decide with the other agent before touching `index.css`.

### P4. `dark:` variants follow the OS theme [VERIFIED: built CSS]
`dark:` appears only in `PatientTimeline`, `PaymentModal`, `PaymentReversalModal`, `ReceiptPrint` (14, 14, 10, 30 uses). Tailwind v4 emits them under `@media (prefers-color-scheme:dark)` (26 `.dark\:` selectors in the built CSS), so with Windows dark mode the billing UI renders half dark and a receipt preview/print can too (printing behaviour could not be emulated: `[ASSUMED]`). Dark mode is out of scope, so strip the `dark:` classes while these four components are rewritten (or add `@custom-variant dark (&:where(.dark, .dark *));` to `index.css`).

## Recommendations by focus item

### 1. Native `<dialog>` as the shared `Modal`

**Verified facts**
- jsdom 30.1.3 defines `HTMLDialogElement` with only the reflected `open` attribute: `showModal`, `show`, `close`, `requestClose` are `undefined`, `returnValue` is `undefined`, no `cancel`/`close` events, `:modal` never matches. A closed dialog computes `display: none`, an `open` one `block` (so `getByRole('dialog')` finds only open dialogs) [VERIFIED: jsdom probe].
- Edge 156 [VERIFIED: lab runs]: Tailwind v4 preflight sets `margin: 0` on every element, so a dialog without `m-auto` renders at (0,0) uncentred; `<dialog>` opened in a `useEffect` with React `autoFocus` inside focuses the first focusable (the close button), not the field, because React focuses before the dialog is displayed (`autofocus` attribute is not rendered); native `close()` returns focus to the opener, but a `<dialog>` that is removed from the DOM while open does not (focus lands on `<body>`); `requestClose()` fires `cancel` then `close` asynchronously and a prevented `cancel` keeps it open; opened over an open Radix Sheet (`body{pointer-events:none}`) a native dialog gets `pointer-events: none` (hit-test returns `<html>`) unless it sets `pointer-events: auto`.
- React StrictMode (on in `main.tsx`) runs showModal -> close -> showModal; the async `close` event of the dev-only cleanup arrives after the re-open. Without a guard `onClose` fires on mount. Mutation test: removing the guard makes 3 of 8 tests fail (double `onClose`, StrictMode, sequential flow).

**Recommended API** (prototype passes 11 tests under jsdom + shim; typechecks under `tsc -b`)
```tsx
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
```
Conventions: no `role`, `aria-modal`, focus trap, Esc handler or `inert` (guide `dialog`). Prefer `<Modal open={flag}>` always mounted; children render only while open so state resets and `getByText('Cancel')` before opening is unambiguous (`appointments-reception.test.tsx:247-250` relies on that). A conditionally mounted `<Modal open>` also works (fallback verified: focus returns to the opener). Mark the safe action `data-autofocus` on destructive confirms (Users deactivate/reset, Backup restore, finalise note, cancel plan) and the first field on forms. Use `dismiss="none"` plus `busy` for the one-time temporary password dialog (`Users.tsx:561-606`); note the browser may still close on a repeated Esc without user activation (guide), the admin can reset again. `dismiss="any"` only for read-only dialogs.

**Required CSS** (guide `prevent-page-scroll-under-modal-dialog`, add to `index.css`)
```css
dialog:modal { overscroll-behavior: contain; }
dialog::backdrop { overflow: hidden; overscroll-behavior: contain; }
```

**jsdom shim** (`frontend/src/test/dialog-shim.ts`, imported first from `src/test/setup.ts`; mirrors the WHATWG steps so assertions stay real)
```ts
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
```
Limits to state in the test file header: jsdom has no inertness, so `document.activeElement` assertions while two dialogs overlap are unreliable; real behaviour is covered by the Edge check and the manual sheet.

**Tests to write for `Modal`** (prototype names): hidden while closed and named when open (no `role`/`aria-modal` attribute); Esc closes once, calls `onClose` once, returns focus; Close button and parent-driven close do not double-fire; Esc ignored while `busy`; backdrop closes only with `dismiss="any"` and ignores a drag that ends on the backdrop; StrictMode does not call `onClose`; payment -> receipt sequential flow where Esc closes only the receipt; `data-autofocus` and opener restore when unmounted while open; `requestClose` fallback (delete the prototype method); print portal attributes; state resets on reopen.

**Overlay inventory to migrate (18 overlays, 13 files)** [VERIFIED: grep `fixed inset-0|role="dialog"` + reads]
| File | Overlays | Tests that exercise it |
|------|----------|------------------------|
| `components/PaymentModal.tsx` (`role=dialog`) | 1 | `payment-modal.test.tsx:81` (`getByRole('dialog')`), `pending-dues.test.tsx:69` - both pass unchanged with shim [VERIFIED] |
| `components/PaymentReversalModal.tsx` (`role=dialog`) | 1 (unmounted by any page) | `payment-reversal-modal.test.tsx` |
| `components/PatientEditModal.tsx` (`role=dialog`) | 1 | `patients-directory.test.tsx` (edit + 409 reload) |
| `components/AppointmentBookingModal.tsx`, `SessionLoggerModal.tsx`, `SessionAddendumModal.tsx` | 3 (no semantics; the last two are conditionally mounted by the parent) | `treatment-plan-workspace.test.tsx` (session logger) |
| `components/PrescriptionPrint.tsx` (fixed print-portal) | 1 | `prescription-print.test.tsx`, `prescription-workspace.test.tsx:260-279` |
| `pages/admin/Users.tsx` | 4 (create, edit, confirm, temp password) | `conflict-banner.test.tsx` (imports Users) |
| `pages/Doctors.tsx` | 2 (doctor, fee) | `doctors.test.tsx` |
| `pages/AppointmentsReception.tsx:340` | 1 (cancel reason) | `appointments-reception.test.tsx:194-265` |
| `pages/ClinicalEncounterWorkspace.tsx:462` | 1 (finalise confirm) | `doctor-workspace.test.tsx:250` |
| `pages/admin/BackupManagerPage.tsx:223` | 1 (restore confirm) | `backup-manager.test.tsx:66-80` |
| `pages/TreatmentPlanWorkspace.tsx:159,203` | 2 (cancel plan, new plan) | `treatment-plan-workspace.test.tsx` |
Radix `Sheet`s in `AppShell` (mobile nav) and `PatientsDirectory` (preview drawer) are already accessible; leave them (other agent's files) but keep `pointer-events-auto` on `Modal`, and note `handleEditSuccess` in `PatientsDirectory.tsx:49-57` assumes the Sheet stays open under the edit dialog. Do not mount new centred modals with `components/ui/dialog.tsx` (Radix, unused today).

### 2. Named CSS print pages

**Verified in Edge 156 headless** (`--headless=new --print-to-pdf --no-pdf-header-footer --user-data-dir=<unique>`; page sizes read from the PDF)
| Case | Result |
|------|--------|
| Existing `@media print { @page { size: A4; margin: 6mm } }` | 1 page 209.9x297 mm (works inside `@media`) |
| `@page receipt { size: 80mm auto; margin: 3mm }` + `page: receipt` | **ignored**: 215.9x279.4 mm Letter (invalid `size`) |
| `size: 80mm 200mm` named, inside or outside `@media print` | 80.1x200.1 mm, 1 page |
| `size: 80mm` (single length) | square 80x80 mm, content split over 2 pages |
| Mixed document (A4 section then receipt section) | 2 pages with different sizes (name change forces a break) |
| `page: receipt` on a top-layer modal `<dialog>` | **ignored** (Letter): the property applies to in-flow boxes only [CITED: developer.mozilla.org/en-US/docs/Web/CSS/page] |
| Same, `page: receipt` on `html:has(dialog[open][data-print-page="receipt"])` | 80.1x200.1 mm |
| UA-styled modal dialog with 40 rows | **clipped** to one page (UA `max-height` + `overflow:auto`) |
| Same with print overrides (static position, no max-height, overflow visible) | 2 pages, nothing lost |
| Dialog placed inside `#root` while `#root` is hidden | prints nothing - the dialog must be portaled to `<body>` |
| Old rule `body:has(.print-portal) > #root{display:none}` with a CLOSED `dialog.print-portal` present | **blank print** of other documents; scoped to `dialog.print-portal[open]` prints normally |
| Dynamic height via `<style>` text under the app CSP | ignored; via `adoptedStyleSheets` or `insertRule` -> 80.1x78.0 mm |
Default paper in headless Edge is Letter, so unnamed pages still need the explicit A4 `@page`. Minimum browser: `page` property is Baseline widely available since Feb 2023 [CITED: MDN `page`]; `:has()` and the rest are within Tailwind v4's Chrome 111 floor; Chrome 85 as the first `page` release is `[ASSUMED]`.

**Recommended CSS** (replace the print block at `index.css:240-256`; verified end to end by the harness below; keep the unnamed A4 default so the registration card and prescription need no name)
```css
@page receipt { size: 80mm 200mm; margin: 3mm; }          /* fallback height; JS shortens it to fit content */
@media print {
  @page { size: A4; margin: 6mm; }                         /* existing default, unnamed */
  body:has(dialog.print-portal[open]) > #root { display: none !important; }   /* [open]: closed dialogs must not blank other prints */
  html:has(dialog[open][data-print-page="receipt"]) { page: receipt; }
  dialog.print-portal[open] {
    position: static !important; inset: auto !important; width: auto !important; height: auto !important;
    max-width: none !important; max-height: none !important; overflow: visible !important;
    margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important;
    box-shadow: none !important; border-radius: 0 !important;
  }
  dialog.print-portal::backdrop { display: none !important; }
  html, body { background: #ffffff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
```
Lightning CSS (Tailwind v4 build) keeps `@page receipt{...}`, `page:`, `:has()`, `dialog:modal`, `::backdrop` rules verbatim [VERIFIED: built CSS]. The registration card is an ordinary route (`PatientCardPrint`, no dialog) and keeps working because no `.print-portal` exists there.

**Content-fit height (optional, CSP-safe):**
```ts
// useReceiptPageHeight(ref): measure the 74 mm-wide receipt block, then set the named page via CSSOM
useLayoutEffect(() => {
  const el = ref.current
  if (!el || !('adoptedStyleSheets' in document)) return           // jsdom: no-op
  const mm = Math.min(297, Math.max(60, Math.ceil((el.getBoundingClientRect().height * 25.4) / 96) + 8))
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`@page receipt { size: 80mm ${mm}mm; margin: 3mm; }`)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet) }
}, [ref, payment?.id])
```
Mechanism verified under the real CSP; the hook wrapper itself is `[ASSUMED]` until written. Screen padding of `ReceiptPrint` (`p-6`, `my-6`) over-measures, which errs on the safe side (extra blank paper, never a cut). Real thermal drivers may feed the full page length; Phase 17 used "80mm x Receipt or Roll Paper 80 x 297 mm" (`17-MANUAL-CHECKS.md:64`) and v2 used 80x240: choose fixed vs content-fit at the printer check (Open Question 3).

**Cheapest reliable automated check** (UX-08; verified: 6 documents print and pass in about 15 s including the fresh CSS build, no new dependency): a Vitest file that builds the CSS fresh (`vite build` to a temp dir, about 1.5 s), renders the real components with Testing Library, serialises the DOM to an HTML file, re-opens any `<dialog>` with a script calling the real `showModal()` (jsdom cannot create a top layer), runs Edge, and text-scans the PDF (Skia writes plain PDF-1.4 page dictionaries; split on `endobj`, match `/Type /Page` not `/Pages`, read `/MediaBox`). Asserts: card = 1 page 210 mm; prescription slip with a realistic fixture = 1 page (10 short medicines still fit; a stress fixture with long brand names spills to 2, so state the fixture in the plan); receipt = 1 page, width 80 mm; a taller dialog paginates instead of clipping. `describe.skipIf(!edge)` keeps `npm test` green on machines without Edge/Chrome; there is no frontend CI job (`.github/workflows/tests.yml` only runs the v2 pytest).
```ts
// frontend/src/print-check/print-check.test.tsx (condensed from the verified prototype)
const edge = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => existsSync(p!))
beforeAll(async () => { dist = mkdtempSync(join(tmpdir(), 'kh-dist-')); await build({ root: process.cwd(), logLevel: 'silent', build: { outDir: dist, emptyOutDir: true } }); css = readdirSync(join(dist, 'assets')).find((f) => /^index-.*\.css$/.test(f))! }, 120_000)
function fixtureHtml(body: string) {            // images use absolute /assets/... URLs, so rewrite them to file:// of the temp dist
  const base = pathToFileURL(dist).href
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="${base}/assets/${css}"></head><body>${body.replaceAll('src="/assets/', `src="${base}/assets/`)}<script>document.querySelectorAll("dialog[open]").forEach(d=>{d.removeAttribute("open");d.showModal()})</script></body></html>`
}
function printToPdf(html: string, name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'kh-print-')); writeFileSync(join(dir, `${name}.html`), html, 'utf8')
  spawnSync(edge!, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(dir, 'p')}`, '--no-pdf-header-footer', '--virtual-time-budget=4000', `--print-to-pdf=${join(dir, `${name}.pdf`)}`, pathToFileURL(join(dir, `${name}.html`)).href], { timeout: 60_000, windowsHide: true })
  const pdf = readFileSync(join(dir, `${name}.pdf`)).toString('latin1')
  return pdf.split('endobj').filter((o) => /\/Type\s*\/Page(?![s\w])/.test(o)).map((o) => { const m = o.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/)!; return { w: ((+m[3] - +m[1]) * 25.4) / 72, h: ((+m[4] - +m[2]) * 25.4) / 72 } })
}
// receipt: <Modal open print="receipt" title="Receipt" onClose={noop}><ReceiptPrint payment={p} isReprint /></Modal>  -> 1 page, |w-80| < 1
// A4:      <Modal open print="a4" ...><RegistrationCard .../></Modal>                                            -> 1 page, |w-210| < 1
```
Pitfalls for the harness: launch Edge with a fresh `--user-data-dir` (otherwise it can hand over to a running instance and exit with no PDF); in PowerShell use `Start-Process -Wait` for GUI exes (stdout is not captured otherwise); a zero-page parse must fail the test (assert `pages.length > 0`); `tsconfig` has `noUnusedLocals`, so unused imports break `tsc -b` for test files too. Python alternative: `D:\dr-sr\.venv\Scripts\python.exe -I pdfinfo_qt.py file.pdf` (QtPdf gives page count, size and text).

### 3. Offline Devanagari font and `lang="hi"`

**Recommendation: commit the file, no npm dependency.** Copy `noto-sans-devanagari-devanagari-wght-normal.woff2` (121,192 bytes, `font-weight 100 900`) from `@fontsource-variable/noto-sans-devanagari@5.3.0` to `frontend/src/assets/fonts/NotoSansDevanagari-wght.woff2` with the package `LICENSE` as `OFL.txt` (Copyright 2022 The Noto Project Authors, SIL OFL 1.1: redistribution allowed with the licence text, not sold alone). Only the Devanagari subset is needed; Latin text stays on the system UI font via `unicode-range`. Static weights would cost 50-54 KB each (400+700 = 104 KB) with inexact 500/600/800; the variable file is smaller than three statics.
```css
/* frontend/src/fonts.css, imported from main.tsx after index.css (no edit to the other agent's index.css) */
@font-face {
  font-family: "Noto Sans Devanagari";
  font-style: normal; font-weight: 100 900; font-display: swap;
  src: url("./assets/fonts/NotoSansDevanagari-wght.woff2") format("woff2");
  unicode-range: U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09;
}
```
and add `"Noto Sans Devanagari"` before `"Nirmala UI"` in the `:root` font stack (`index.css:17-19`). Vite hashes it to `dist/assets/NotoSansDevanagari-wght-DWI_L5Cu.woff2`, rewrites the `url()` to `/assets/...`, and emits no `data:` URL [VERIFIED]. Served through the real middleware: `Cache-Control: public, max-age=31536000, immutable`; `Content-Type: application/octet-stream` (Python `mimetypes` has no `.woff2` on this machine) with `nosniff` - Edge still loaded it (`document.fonts` = "Noto Sans Devanagari 100 900 loaded", `check()` true) [VERIFIED]. Optional hygiene: `mimetypes.add_type('font/woff2', '.woff2')` in the backend. Keep fonts above 4 KB or set `build.assetsInlineLimit: 0` so nothing becomes a CSP-blocked `data:` URI. "No network" proof: all `performance.getEntriesByType('resource')` entries were same-origin; also grep `dist/index.html` and `dist/assets/*.css` for `https?://` (clean today).

**`lang="hi"`:** inventory = 57 Devanagari runs in 10 non-test files, 0 `lang=` attributes anywhere: `PrescriptionPrint` 17, `SessionLoggerModal` 10, `AppShell` 8, `PrintLetterhead` 6, `PrescriptionWorkspace` 6, `RegistrationCard` 4, `ReceiptPrint` 2, `SessionAddendumModal` 2, `VasTrendChart` 1, `TreatmentPlanWorkspace` 1. Use a 3-line helper and put the attribute on the smallest element holding only Hindi:
```tsx
export const Hi = ({ children }: { children: ReactNode }) => <span lang="hi">{children}</span>
// "Print Prescription Slip (<Hi>प्रिंट करें</Hi>)"   or   <p lang="hi" ...>मरीज / परिचारक के हस्ताक्षर</p>
```
Runtime Hindi data (`name_hi` on doctors/settings) is wrapped at the render site; patient names typed in Devanagari are out of scope (not statically knowable). Tests: whole-Hindi elements keep passing (`registration-card.test.tsx:93`, `doctors.test.tsx:107`, `receipt-print.test.tsx:30`); only two assertions that match a mixed English+Hindi string in one node must change: `prescription-workspace.test.tsx:268` (`/Prescribed Medications \(दवा का विवरण\)/`) and `:277` (`/Close \(बंद करें\)/`) - match the English part and assert `toHaveTextContent` for the Hindi part. Find every Hindi string: `[\u0900-\u097F]` (script used: `hindi-scan.mjs`). Guard: a Vitest source scan failing any non-test `.tsx` line that has a Devanagari character but neither `lang="hi"` nor `<Hi`; data-literal lines (e.g. `DEFAULT_CLINIC_ADDRESSES`, `DOCTORS` in `PrintLetterhead.tsx`) get a `// lang-hi-ok` marker and are wrapped where rendered.

### 4. Accessible validation and unnamed controls

**Unnamed controls** (brace-aware scan: 106 `input/select/textarea`, 7 offenders; none in AuditViewer/BackupManager/Users): `AppointmentBookingModal.tsx:148` (patient search, placeholder only), `AppointmentsReception.tsx:346` (cancel reason textarea, placeholder only), `PrescriptionWorkspace.tsx:293,303,313,326,337` (per-row medicine name, dosage, frequency select, days, instructions). Also `AppointmentBookingModal.tsx:159` result rows are clickable `<div>`s with no keyboard access (oxlint `click-events-have-key-events`), and the `<label>` at `:128` and `PhotoUploader.tsx:236` are not associated with a control. Fix with `aria-label`/visible labels (rows: `aria-label="Medicine name, row N"`), turn result rows into `<button type="button">`. Guard: a Vitest scan (below) or `oxlint --jsx-a11y-plugin -D jsx-a11y/label-has-associated-control` (note: that plugin also flags the `role` prop of `AppShell` as `aria-role` false positives, so enable only the one rule, and `Modal`'s backdrop handlers trip `click-events-have-key-events` - disable per line).
The guard is the `accessible names guard` describe in the `guards.test.ts` listed in item 5 (brace-aware tag extraction; a control passes with `aria-label`/`aria-labelledby`, `type="hidden"`, a spread, an `id` matched by a `htmlFor` in the same file, or an enclosing `<label>`). On the current tree it reports exactly the 7 controls above (verified; red until fixed).

**Announce errors only after interaction** (guide `accessible-error-announcement`). Existing pattern: Login/Setup/ChangePassword already render state-driven `aria-invalid={!!error}` + `aria-describedby` (submit-time), and `role="alert"` banners announce on insertion. Smallest consistent addition: one document-level bridge, installed once in `main.tsx`, for the 106 native-constraint controls; keep the state-driven pattern where it exists. Verified in Edge 156: untouched required field -> no `aria-invalid`; blocked `requestSubmit()` -> `:user-invalid` true and `aria-invalid="true"`; fixing the value clears it.
```ts
// frontend/src/a11y/user-invalid.ts   (native :user-invalid where supported, WeakMap fallback otherwise and in jsdom)
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
const state = new WeakMap<Element, { interacted: boolean; blurred: boolean; submitted: boolean }>()
const owned = new WeakSet<Element>()           // only attributes THIS module added are ever removed (React-rendered aria-invalid is untouched)
const native = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('selector(:user-invalid)')
const isField = (t: EventTarget | null): t is Field => t instanceof Element && t.matches('input, textarea, select')
function shown(el: Field) {
  if (native()) return el.matches(':user-invalid')
  const s = state.get(el)
  return !!s && (s.submitted || (s.interacted && s.blurred)) && !el.validity.valid   // NOT checkValidity(): it fires 'invalid' and recurses
}
function sync(el: Field) {
  if (shown(el)) { if (!el.hasAttribute('aria-invalid')) { el.setAttribute('aria-invalid', 'true'); owned.add(el) } }
  else if (owned.has(el)) { el.removeAttribute('aria-invalid'); owned.delete(el) }
}
const touch = (el: Field, p: object) => state.set(el, { interacted: false, blurred: false, submitted: false, ...state.get(el), ...p })
export function installUserInvalidSync(root: Document = document) {
  const onBlur = (e: Event) => { if (isField(e.target)) { touch(e.target, { blurred: true }); sync(e.target) } }
  const onInput = (e: Event) => { if (isField(e.target)) { touch(e.target, { interacted: true }); if (owned.has(e.target) || state.get(e.target)?.blurred) sync(e.target) } }
  const onInvalid = (e: Event) => { if (isField(e.target)) { touch(e.target, { submitted: true }); sync(e.target) } }   // blocked submit
  root.addEventListener('blur', onBlur, true); root.addEventListener('input', onInput, true)
  root.addEventListener('change', onInput, true); root.addEventListener('invalid', onInvalid, true)
  return () => { root.removeEventListener('blur', onBlur, true); root.removeEventListener('input', onInput, true); root.removeEventListener('change', onInput, true); root.removeEventListener('invalid', onInvalid, true) }
}
```
jsdom facts for its 4 tests (all pass): `CSS.supports('selector(...)')` is `false`, `matches(':user-invalid')` is always `false` (no throw), so jsdom exercises the fallback. Keep the browser's native bubbles (do not add `noValidate`); add a visual rule `input:user-invalid, select:user-invalid, textarea:user-invalid { border-color: var(--kh-danger); }` to `index.css`. Banner errors keep `role="alert"`; field-specific server errors can add `aria-errormessage` pointing at the banner id (only effective while `aria-invalid="true"`). Screen-reader behaviour (NVDA) is in the manual sheet, not automated.

**UX-03 inline alerts.** `BackupManagerPage.tsx:27` and `Users.tsx:194` call `alert()` (the unlock catch also swallows non-`ApiError` errors silently). Add one small `InlineAlert` (`role="alert"` for errors, `role="status"` for success, dismiss button with `aria-label`, `id` for `aria-describedby`), keep the failure in state until dismissed or the next attempt. Banners rendered without any `role` today (verify while editing): `PaymentModal:176`, `PaymentReversalModal:111`, `SessionLoggerModal:101`, `SessionAddendumModal:71`, `AuditViewerPage:130`, `BackupManagerPage:77,149`, `IntegrityDashboard:37`, `AppointmentsReception:107,231`, `ClinicalEncounterWorkspace:202`, `DoctorDashboard:45`, `PrescriptionWorkspace:215`, `TreatmentPlanWorkspace:352`, `PatientTimeline:37`, `Settings:143`. Remember P1: until fixed, the backup create call always returns 422, so the new persistent alert would show on every click. Guard: `vi.spyOn(window, 'alert')` expected not called in the backup and users tests, plus a source scan for `\balert\(`.

### 5. Automated guards and contrast

**Contrast** (WCAG, computed from Tailwind 4.3.3 `theme.css` oklch values; `contrast.mjs`):
| Step | neutral | slate | gray | on white | on `#F5F7FA` (`--kh-surface`) | on neutral-100 |
|------|---------|-------|------|----------|-----------------------------|----------------|
| 300 | #d4d4d4 | #cad5e2 | #d1d5dc | 1.48 / 1.48 / 1.47 FAIL | 1.38 FAIL | 1.36 FAIL |
| 400 | #a1a1a1 | #90a1b9 | #99a1af | 2.59 / 2.63 / 2.60 FAIL | 2.42 FAIL | 2.38 FAIL |
| 500 | #737373 | #62748e | #6a7282 | 4.73 / 4.77 / 4.84 pass | 4.41 / 4.44 FAIL, gray 4.51 pass | 4.34 / 4.37 FAIL |
| 600 | #525252 | #45556c | #4a5565 | 7.80 / 7.56 / 7.56 pass | 7.27 / 7.05 / 7.04 pass | 7.15 / 6.93 pass |
The lightest passing step for normal text on pure white is `-500` (all of neutral, slate, gray, zinc, stone: 4.73-4.84); on the app surface and on `bg-neutral-50/100` headers and cards only `-600` is safe (neutral-500 on `#F5F7FA` = 4.41). Policy: forbid 300/400 (the guard), use `-600` for secondary text on tinted surfaces and `-500` only on white. Semantic text: `red-500` 3.82, `emerald-600` 3.67, `amber-600` 3.19, `teal-600` 3.66 fail on white; `red-600` 4.76, `emerald-700` 5.37, `amber-700` 5.05 pass. Project tokens: `--kh-text-muted #64748B` 4.76, `--kh-text-placeholder #94A3B8` 2.56 (placeholder only).

**Baseline for the guard** (script `legibility-scan.mjs`, working tree incl. the other agent's edits; on-screen = outside the allow-list): `text-[<12px]` = 54 uses - `AppShell` 21, `AreaHome` 16, `PatientsDirectory` 7, `TreatmentPlanWorkspace` 5, and one each in `PatientTimeline`, `SessionLoggerModal`, `SessionAddendumModal`, `VasTrendChart`, `BackupManagerPage`; grey 300/400 text = 39 uses in 18 files (`PatientsDirectory` 9, `AuditViewerPage` 5, `PatientDetail` 4, ...), including `ui/dialog.tsx` and `ui/sheet.tsx` (1 each, other agent); `text-xs` = 338. Allow-listed print files hold 16 small-size and 2 grey uses. `VasTrendChart` SVG text uses `fontSize="9"/"10"` attributes (not Tailwind): include in the guard.
```ts
// frontend/src/test/guards/guards.test.ts   (typechecks under tsc -b; runs red on today's tree: ~96 legibility hits, the 7 controls, the 2 alert() files)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const files = walk(SRC).filter((f) => f.endsWith('.tsx') && !/__tests__|\.test\./.test(f))
const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/')
const PRINT_ONLY = new Set(['PrintLetterhead.tsx', 'RegistrationCard.tsx', 'PrescriptionPrint.tsx', 'ReceiptPrint.tsx'])

describe('legibility guard (UX-04)', () => {
  const SIZE = /(?<![\w-])(?:[a-z-]+:)*text-\[(\d+(?:\.\d+)?)(px|rem)\]/g   // below 12px fails (rem x 16)
  const GREY = /(?<![\w-])((?:[a-z-]+:)*)text-(?:neutral|slate|gray|zinc|stone)-(?:300|400)(?![\w-])/g
  it('no on-screen text below 12px and no 300/400 greys (placeholder:/dark: variants excluded)', () => {
    const bad: string[] = []
    for (const f of files) {
      if (PRINT_ONLY.has(f.split(/[\\/]/).pop()!)) continue
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(SIZE)) if ((m[2] === 'px' ? +m[1] : +m[1] * 16) < 12) bad.push(`${rel(f)}: ${m[0]}`)
      for (const m of src.matchAll(GREY)) if (!/(^|:)(placeholder|dark):/.test(m[1])) bad.push(`${rel(f)}: ${m[0]}`)
      for (const m of src.matchAll(/fontSize=["'](\d+(?:\.\d+)?)["']/g)) if (+m[1] < 12) bad.push(`${rel(f)}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
  // add: readFileSync('src/index.css') must not set font-size on html/:root (R1), or --text-xs x root >= 12px (R2)
})

describe('accessible names guard (UX-06)', () => {
  /** Opening tags of the wanted elements, skipping > inside {...} and quotes (arrow functions contain >). */
  function* tags(src: string, names: string[]) {
    const re = new RegExp(`<(${names.join('|')})(?=[\\s/>])`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length, depth = 0, quote: string | null = null
      for (; i < src.length; i++) {
        const c = src[i]
        if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue }
        if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue }
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) break
      }
      yield { tag: m[1], attrs: src.slice(m.index + m[0].length, i), index: m.index }
    }
  }
  it('every input/select/textarea has an accessible name', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const forIds = new Set([...src.matchAll(/htmlFor=(?:"([^"]+)"|\{\s*[`'"]([^`'"]+)[`'"]\s*\})/g)].map((m) => m[1] ?? m[2]))
      for (const { tag, attrs, index } of tags(src, ['input', 'select', 'textarea'])) {
        if (/type=["']hidden["']/.test(attrs) || /\baria-label=|\baria-labelledby=/.test(attrs) || /\{\.\.\./.test(attrs)) continue
        const id = attrs.match(/\bid=(?:"([^"]+)"|\{[`'"]([^`'"]+)[`'"]\})/)
        if (id && forIds.has(id[1] ?? id[2])) continue
        const before = src.slice(0, index)
        if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue   // wrapped by a label
        bad.push(`${rel(f)}:${before.split('\n').length} <${tag}>`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('no blocking dialogs (UX-03)', () => {
  it('no alert(), confirm() or prompt() calls', () => {
    expect(files.filter((f) => /(?<![\w.])(alert|confirm|prompt)\(/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([])
  })
})
```
Sequencing: land the guard in the same plan that fixes `AppShell`/`AreaHome`/`PatientsDirectory`, after the other agent commits, or it fails on files Phase 18 does not own (`ui/dialog.tsx` and `ui/sheet.tsx` each carry one grey-400 icon button). The same file covers UX-03 (`BackupManagerPage`, `Users` today) and UX-06.

### 6. HTTPS on the LAN for webcam capture (UX-07)

**What exists:** the server is `uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000` (`deploy/start-server.bat:30`), run as SYSTEM by the scheduled task (`deploy/register-autostart.ps1:16`). Today on `http://<LAN IP>:8000` Edge reports `isSecureContext: false` and `navigator.mediaDevices` undefined [VERIFIED]; `localhost`/127.0.0.1 are secure [CITED: MDN getUserMedia]. `PhotoUploader.tsx:61-69` already explains the HTTPS requirement on screen, so the "upload-only" branch of UX-07 only needs a clearer sentence. Repo stance: `DEPLOYMENT.md:59` and `SECURITY.md:62` say HTTPS preferred, HTTP only with written approval; `DECISIONS.md:46` OD-07 is still "Pending".

**Options compared**
| Option | Pros | Cons |
|--------|------|------|
| A. Local CA + server certificate (recommended) | One `ca.cer` to import per PC; leaf renewals invisible if the CA is kept; also encrypts passwords and patient data on the LAN | Needs admin rights on each client once |
| B. Single self-signed certificate imported as trusted on each PC | Simplest file | Every renewal re-imports everywhere; no benefit over A |
| C. Keep HTTP, set the Edge/Chrome policy `OverrideSecurityRestrictionsOnInsecureOrigin` to the server origin on each PC | No certificate, no server change | Still unencrypted (needs written HTTP approval per `DEPLOYMENT.md:59`); registry/GPO edit and a browser restart on every PC [CITED: learn.microsoft.com/deployedge/microsoft-edge-browser-policies/overridesecurityrestrictionsoninsecureorigin] |
| D. Upload-only | Zero effort | Webcam stays disabled on LAN PCs |
Recommendation: A, with D as the documented default until the client approves trust import, and C only if the client refuses certificates but wants the camera.

**Generator (verified):** `deploy/make-lan-cert.ps1` using only Windows PowerShell 5.1 / .NET 4.8 (`CertificateRequest`, ephemeral CNG keys with `[NullString]::Value` as the key name - passing `$null` persists a key container named "" and the second call fails with "Object already exists"). Output: `ca.cer` (DER, for clients), `ca.pem`, `server.pem` (leaf + CA chain), `server.key` (PKCS#8). Nothing is added to any Windows certificate store. Validated: OpenSSL shows SAN `IP:<lan>, IP:127.0.0.1, DNS:kalyan-server, DNS:localhost`, EKU serverAuth, CA:FALSE, CA `pathlen:0`, `openssl verify` OK, key modulus matches; Python `ssl` with `ca.pem` handshakes TLS 1.3 for the LAN IP, host name, localhost and 127.0.0.1 and rejects any other name; Edge's net log for the untrusted case reports `ERR_CERT_AUTHORITY_INVALID` (-202) and no other certificate error code (a SAN-name or date problem would be reported ahead of it, `[ASSUMED]` precedence), i.e. the only thing a client PC lacks is trust in `ca.cer`.
```powershell
param([Parameter(Mandatory)][string]$ServerIp, [string]$ServerName = "kalyan-server",
      [string]$OutDir = (Join-Path $PSScriptRoot "certs"), [int]$LeafYears = 2, [int]$CaYears = 10)
$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Security
$X = "System.Security.Cryptography.X509Certificates"; $sha = [Security.Cryptography.HashAlgorithmName]::SHA256; $pad = [Security.Cryptography.RSASignaturePadding]::Pkcs1
function New-ExportableRsa([int]$Bits) {
  $p = New-Object Security.Cryptography.CngKeyCreationParameters
  $p.ExportPolicy = [Security.Cryptography.CngExportPolicies]::AllowPlaintextExport; $p.KeyUsage = [Security.Cryptography.CngKeyUsages]::AllowAllUsages
  $p.Parameters.Add((New-Object Security.Cryptography.CngProperty("Length", [BitConverter]::GetBytes($Bits), [Security.Cryptography.CngPropertyOptions]::None)))
  New-Object Security.Cryptography.RSACng([Security.Cryptography.CngKey]::Create([Security.Cryptography.CngAlgorithm]::Rsa, [NullString]::Value, $p))
}
function ConvertTo-Pem([byte[]]$Der, $Label) { "-----BEGIN $Label-----`n" + [Convert]::ToBase64String($Der, "InsertLineBreaks") + "`n-----END $Label-----`n" }
$nb = [DateTimeOffset]::UtcNow.AddMinutes(-5)
$caKey = New-ExportableRsa 3072
$caReq = New-Object "$X.CertificateRequest" ("CN=Kalyan Hospital LAN CA", $caKey, $sha, $pad)
$caReq.CertificateExtensions.Add((New-Object "$X.X509BasicConstraintsExtension" ($true, $true, 0, $true)))
$caReq.CertificateExtensions.Add((New-Object "$X.X509KeyUsageExtension" (([int][Enum]::Parse("$X.X509KeyUsageFlags","KeyCertSign") -bor [int][Enum]::Parse("$X.X509KeyUsageFlags","CrlSign")), $true)))
$caReq.CertificateExtensions.Add((New-Object "$X.X509SubjectKeyIdentifierExtension" ($caReq.PublicKey, $false)))
$ca = $caReq.CreateSelfSigned($nb, $nb.AddYears($CaYears))
$key = New-ExportableRsa 2048
$req = New-Object "$X.CertificateRequest" ("CN=$ServerName", $key, $sha, $pad)
$san = New-Object "$X.SubjectAlternativeNameBuilder"; $san.AddIpAddress([Net.IPAddress]::Parse($ServerIp)); $san.AddIpAddress([Net.IPAddress]::Loopback); $san.AddDnsName($ServerName); $san.AddDnsName("localhost")
$req.CertificateExtensions.Add($san.Build())
$req.CertificateExtensions.Add((New-Object "$X.X509BasicConstraintsExtension" ($false, $false, 0, $true)))
$req.CertificateExtensions.Add((New-Object "$X.X509KeyUsageExtension" (([int][Enum]::Parse("$X.X509KeyUsageFlags","DigitalSignature") -bor [int][Enum]::Parse("$X.X509KeyUsageFlags","KeyEncipherment")), $true)))
$eku = New-Object Security.Cryptography.OidCollection; [void]$eku.Add((New-Object Security.Cryptography.Oid("1.3.6.1.5.5.7.3.1")))
$req.CertificateExtensions.Add((New-Object "$X.X509EnhancedKeyUsageExtension" ($eku, $false)))
$req.CertificateExtensions.Add((New-Object "$X.X509SubjectKeyIdentifierExtension" ($req.PublicKey, $false)))
$serial = New-Object byte[] 16; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($serial); $serial[0] = $serial[0] -band 0x7F
$leaf = $req.Create($ca, $nb, $nb.AddYears($LeafYears), $serial)
New-Item -ItemType Directory -Force $OutDir | Out-Null; $u8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllBytes("$OutDir\ca.cer", $ca.RawData)
[IO.File]::WriteAllText("$OutDir\ca.pem",     (ConvertTo-Pem $ca.RawData "CERTIFICATE"), $u8)
[IO.File]::WriteAllText("$OutDir\server.pem", (ConvertTo-Pem $leaf.RawData "CERTIFICATE") + (ConvertTo-Pem $ca.RawData "CERTIFICATE"), $u8)
[IO.File]::WriteAllText("$OutDir\server.key", (ConvertTo-Pem ($key.Key.Export([Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)) "PRIVATE KEY"), $u8)
```
Run it on the server PC (or the dev PC) with the fixed IP; the CA private key is never written, so a new CA is needed at renewal (default). If the client wants invisible leaf renewals, add an optional password-protected CA `.pfx` export held by the hospital administrator (offline copy). Chrome's 398-day maximum applies only to publicly trusted CAs, not locally operated ones [CITED: chromium.googlesource.com/chromium/src/+/HEAD/net/docs/certificate_lifetimes.md], so a 2-5 year leaf is fine; set a calendar reminder 60 days before expiry. The certificate pins the IP: a changed server IP needs a new certificate (DEPLOYMENT.md already requires a fixed/reserved IP).

**Server changes** (verified flags; all in `deploy/` and docs)
```bat
rem deploy\start-server.bat: use TLS when certificates exist
set CERT_DIR=%REPO_ROOT%\deploy\certs
if exist "%CERT_DIR%\server.pem" if exist "%CERT_DIR%\server.key" (
  "%VENV_PYTHON%" -m uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8443 --ssl-keyfile "%CERT_DIR%\server.key" --ssl-certfile "%CERT_DIR%\server.pem" --access-log
) else (
  "%VENV_PYTHON%" -m uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000 --access-log
)
```
`backend/.env`: `KALYAN_COOKIE_SECURE=true` (flip it together with HTTPS - a Secure cookie is not sent over HTTP; `routers/auth.py:253-260` sets `httponly=True, samesite="strict", secure=settings.cookie_secure, path="/"`). No other backend change: `verify_origin` compares the `Origin` netloc with `Host` (`core/csrf.py:49-53`), which are equal for `https://<ip>:8443`; `KALYAN_EXTRA_ALLOWED_ORIGINS` only needs the https origins if a dev proxy is used. Do not enable HSTS (an expired certificate would lock staff out). `deploy/health-check.ps1` default `http://localhost:8000` must become parameterised `https://localhost:8443`; Windows PowerShell 5.1 validates against the Windows store, so import `ca.cer` on the server PC too, or skip validation for the loopback probe. Add `deploy/certs/` (and `*.key`) to `.gitignore` - it currently has no rule and `server.key` is a private key. Restrict the key: `icacls deploy\certs\server.key /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(F)"` (SYSTEM runs the task). Firewall (DEPLOYMENT.md step 9 has no script): `New-NetFirewallRule -DisplayName "Kalyan Hospital HTTPS" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet`. Update `.env.production.template`, `DEPLOYMENT.md` sections 3/5, `17-MANUAL-CHECKS.md` URLs, and `DECISIONS.md` OD-07 (record Decided + the option chosen + client sign-off line).

**Client PC steps** (once per PC; `certutil -addstore` syntax `[CITED: learn.microsoft.com/windows-server/administration/windows-commands/certutil]`): copy `ca.cer`, then as administrator `certutil -addstore -f Root ca.cer` or `Import-Certificate -FilePath ca.cer -CertStoreLocation Cert:\LocalMachine\Root`; per-user alternative `certutil -user -addstore Root ca.cer` (shows a confirmation dialog, `[ASSUMED]`); domain PCs can push it by Group Policy (`[ASSUMED]` standard path). Edge and Chrome use the Windows store; Firefox needs `security.enterprise_roots.enabled` or its own import (`[ASSUMED]`). Then open `https://<ip>:8443`, update the bookmark/desktop shortcut (the old `http://...:8000` URL stops working), and run the camera check on that PC.

**Cheap automated camera check:** a static `camera-check` page that prints `isSecureContext`, `!!navigator.mediaDevices` and a `getUserMedia` result; `msedge --headless=new --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --dump-dom <url>` returned the JSON for the HTTP case and an empty DOM for an untrusted certificate [VERIFIED]. I could not demonstrate the trusted-HTTPS success case here because Edge ignored `--ignore-certificate-errors` and `--ignore-certificate-errors-spki-list`, and importing a CA would alter the Windows trust store; this step is a manual LAN check on a client PC. Remember P2: the capture preview needs the CSP `img-src blob:` change.

**Client must decide:** (1) approve importing a private CA on 3-5 PCs (or choose upload-only / the policy fallback); (2) who has admin rights on each client PC and which browsers are used (Edge/Chrome vs Firefox, Windows version); (3) fixed server IP and optional host name; (4) who keeps the CA/renewal duty and the reminder date; (5) whether HTTP (8000) may stay available at all.

### 7. Receipt printing integration (UX-01)

**Current state** [VERIFIED by reading]: `PaymentModal.tsx:67-79` calls `onSuccess(payment)` then `onClose()`; `PendingDuesPage.tsx:270-311` is the only mount and its `onSuccess` shows a status notice (no receipt). `ReceiptPrint.tsx:41-52` hardcodes the Hindi/English names, the address and `Phone: +91 94310 00000 · Emergency: 24x7`; its screen button calls `window.print()` with the whole app visible. `PatientDetail.tsx` shows no payments; `PatientTimeline.tsx:105-115` has `onViewReceipt(paymentId)` but no page mounts it. `usePatientPayments(patientId)` (`GET /api/patients/{id}/payments`) returns full `PaymentOut` rows, so a reprint needs no extra fetch; `GET /api/payments/{id}/receipt` (permission `RECEIPT_REPRINT`) exists but no hook uses it. Reception and Admin hold `PAYMENT_READ`, `PAYMENT_CREATE`, `RECEIPT_REPRINT` (`core/permissions.py:96-99,120-122`); doctors hold none, so show the history only to those two roles.

**Recommended wiring (keeps existing tests):**
1. `ReceiptPrint` gains an optional `settings?: ClinicSettingsOut | null` prop (stays pure, no `QueryClientProvider` needed). With settings: `name_hi`, `name_en`, `address_1` + `address_2`, `phone`, footer from `print_footer_hi`; without: keep today's standard names and address (existing tests assert them) and drop the fake phone line. Add `lang="hi"`, remove all `dark:` classes, add `data-autofocus` to its screen "Print receipt" button.
2. New `ReceiptDialog({ payment, isReprint, onClose })`: calls `useClinicSettings()` and renders `<Modal open={!!payment} print="receipt" className="max-w-[86mm]" title=...>` containing `<ReceiptPrint .../>` in a 74 mm wide block (plus the optional `useReceiptPageHeight`). One DOM copy: the same dialog is the preview and the print source (item 2), so tests never see duplicate text.
3. `PendingDuesPage`: in `onSuccess` also `setReceipt(payment)`; render `{receipt && <ReceiptDialog payment={receipt} isReprint={false} onClose={() => setReceipt(null)} />}` (conditional mount so the page test's partial `vi.mock('../../api/queries')` - which lacks `useClinicSettings` - keeps working, or add `useClinicSettings: () => ({ data: undefined })` to that mock). PaymentModal closes and the receipt dialog opens in the same commit; the opener stays the "Collect Payment" button, which may disappear when the balance reaches zero (the `Modal` fallback and the existing status notice cover it).
3b. P1 must land first, otherwise `onSuccess` is unreachable from the real UI.
4. `PatientDetail`: a "Payments & receipts" card (Admin/Reception only) using `usePatientPayments`: receipt number, date, amount, mode, status, "Reprint receipt" opening `ReceiptDialog isReprint`. Optionally mount `PatientTimeline` with `onViewReceipt` later.
5. Reprint marking: `isReprint` already shows the `(DUPLICATE COPY)` title text and a 30 percent opacity red stamp; on a 1-bit thermal printer the faint stamp may vanish while the title text stays solid - check on the real printer (Open Question 3).

**Existing tests that change:** `pending-dues.test.tsx` (new receipt assertion; mock `useClinicSettings` if mounted always), `patients-directory.test.tsx` "renders patient detail view" (its catch-all `url.includes('/api/patients/101')` branch at about line 305 would answer `/api/patients/101/payments` with the patient object - route `/payments` separately and keep the component defensive with `Array.isArray`), `receipt-print.test.tsx` and `print-layouts.test.tsx` (unchanged; add settings-driven header cases). New: receipt-dialog test (opens after payment, Print calls `window.print`, reprint shows DUPLICATE), payment-history test, the `queries` body-encoding regression test.

## Architecture and file-impact map

**New files:** `components/Modal.tsx` (+ `__tests__/modal.test.tsx`), `test/dialog-shim.ts`, `components/InlineAlert.tsx`, `components/Hi.tsx`, `components/ReceiptDialog.tsx`, `components/PaymentHistory.tsx`, `a11y/user-invalid.ts` (+ test), `fonts.css`, `assets/fonts/NotoSansDevanagari-wght.woff2` + `OFL.txt`, `test/guards/{guards,lang-hi,dist-clean}.test.ts`, `print-check/print-check.test.tsx`, `deploy/make-lan-cert.ps1`, an `18-MANUAL-CHECKS.md`.

**Edited (frontend):** `api/queries.ts` (4 body fixes), `index.css` (print block, dialog scroll CSS, font stack, root font-size, `:user-invalid` style), `index.html` (optional `<meta name="text-scale" content="scale">` [CITED guide `respect-os-text-scale`]), `main.tsx` (import `fonts.css`, `installUserInvalidSync()`), `test/setup.ts` (import the shim; shows modified in git only for line endings), the 13 modal files, `ReceiptPrint`, `PendingDuesPage`, `PatientDetail`, `PhotoUploader` (clearer fallback text; previews depend on P2), `BackupManagerPage`, `Users`, the 10 Hindi files, `AppointmentBookingModal`/`AppointmentsReception`/`PrescriptionWorkspace` (names), and the `text-[<12px]`/grey files.
**Edited (deploy/docs/backend):** `deploy/start-server.bat`, `deploy/health-check.ps1`, `deploy/.env.production.template`, `.gitignore`, `DEPLOYMENT.md`, `DECISIONS.md` (OD-07, OD-06), `17-MANUAL-CHECKS.md` URLs, and, if approved, `backend/src/kalyan_api/main.py` (CSP `img-src 'self' blob:`).

**Files the other agent has uncommitted (Phase 18 must wait, merge, never revert):** `AppShell.tsx`, `AreaHome.tsx`, `PatientsDirectory.tsx`, `PendingDuesPage.tsx`, `pending-dues.test.tsx`, `index.css`, `vite.config.ts`, `package.json`, `package-lock.json`, `test/setup.ts` (line endings), untracked `components/ui/*`, `lib/utils.ts`. Phase 18 needs `index.css`, `PendingDuesPage`, `PatientsDirectory`, `AppShell`, `AreaHome`: first task of each plan touching them = confirm committed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Focus trap, inert background, Esc, focus return | custom overlay + trap | native `<dialog>.showModal()` | Locked; browser handles all of it; only two gaps found (removal while open, React autoFocus) and both are covered above |
| Certificate generation | hand-written ASN.1/OpenSSL wrapper | .NET `CertificateRequest` (PowerShell 5.1) | Verified; no new binary on the server |
| `:user-invalid` tracking | per-field `touched` state in each form | one document-level bridge | 106 controls, no per-form changes |
| PDF reading for the print check | PDF library | Skia text scan (or QtPdf already in the venv) | Page count/MediaBox only |
| Contrast maths | ad-hoc eyeballing | `contrast.mjs` against `theme.css` | One-off table, then a class-name guard |

## Common Pitfalls

1. **Payments/backups return 422 from the UI** (P1). Prevention: fix the four hooks first; regression test through the real `apiFetch`.
2. **`size: 80mm auto` is dropped** and the receipt prints on Letter. Prevention: `80mm <N>mm`; harness asserts width 80 +/- 1.
3. **`page` is ignored on top-layer dialogs** and **UA dialog styles clip long prints**. Prevention: `html:has(dialog[open][data-print-page=...]) { page: ... }` and the `dialog.print-portal[open]` overrides.
4. **Always-mounted dialog with `.print-portal` blanks every other print** under the old `body:has(.print-portal) > #root` rule (blank PDF verified). Prevention: scope to `dialog.print-portal[open]` in the same task that mounts print dialogs.
5. **CSP**: no `<style>` injection (use `adoptedStyleSheets`/`insertRule`), no `blob:`/`data:` images until P2; Vite must not inline assets as `data:` (keep fonts/images above 4 KB or `assetsInlineLimit: 0`).
6. **Tailwind v4**: preflight `margin: 0` un-centres dialogs (`m-auto`); utilities are found by scanning source, so size classes must be complete literals (`'max-w-md'`, never `` `max-w-${n}` ``); `html font-size: 14px` shrinks `text-xs` to 10.5px.
7. **StrictMode + `showModal`**: stale async `close` events; guard with the open ref/`dialog.open` check (mutation-tested).
8. **React `autoFocus` does not work inside `<dialog>`**; use `data-autofocus` and focus after `showModal()`.
9. **Unmounting an open dialog drops focus**; keep `Modal` mounted or rely on the cleanup fallback.
10. **`checkValidity()` inside an `invalid` listener recurses** (found as a Vitest "Maximum call stack size exceeded" unhandled error); use `validity.valid`.
11. **Radix Sheet + native Modal**: `body{pointer-events:none}` makes the native dialog unclickable; `pointer-events-auto` on the dialog (or render it inside `SheetContent`).
12. **jsdom gaps**: no dialog methods, `CSS.supports('selector(...)')` false, `:user-invalid` always false, `window.print` not implemented (mock it), no inertness, `form.requestSubmit` not implemented.
13. **Edge in tests**: unique `--user-data-dir`, `Start-Process -Wait` in PowerShell, a Letter default page, A4 PDFs are 209.9 mm wide (use tolerance); `--ignore-certificate-errors` is not honoured by this Edge build.
14. **Bilingual strings asserted verbatim** in `prescription-workspace.test.tsx:268,277` break when Hindi runs get their own `<span lang="hi">`.
15. **PowerShell 5.1 file edits**: `Get-Content` without `-Encoding UTF8` mangles Devanagari and `Set-Content -Encoding utf8` adds a BOM; edit TSX with the editor tools, keep `.ps1` ASCII.
16. **`dark:` classes** in the four billing components change with the OS theme (P4).
17. **Private key in git**: no `.gitignore` rule for `deploy/certs/`/`*.key` today.
18. **Python `mimetypes`** serves `.woff2` as `application/octet-stream` (harmless; verified).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Chrome 85 first shipped the `page` property; `:has()` Chrome 105 | Item 2 | Low: Tailwind v4's Chrome 111 floor already exceeds both |
| A2 | `certutil -user -addstore Root` shows a confirmation dialog and works without admin | Item 6 | Medium: the per-user install path may need adjusting |
| A3 | Group Policy "Trusted Root Certification Authorities" import is available on the clinic PCs | Item 6 | Low if PCs are not domain joined (manual import instead) |
| A4 | Firefox needs `security.enterprise_roots.enabled` or its own import | Item 6 | Low if only Edge/Chrome are used |
| A5 | Thermal drivers feed the whole requested page length; content-fit vs fixed height needs the real printer | Items 2, 7 | Medium: wasted paper or a cut receipt |
| A6 | `prefers-color-scheme` may apply when printing (could not emulate) | P4 | Low: dark classes are removed anyway |
| A7 | Client PCs run a browser at Chrome/Edge 111+ (Tailwind floor) | Summary | High if any PC is Windows 7/8.1 (Chrome 109 max): the app would not style correctly regardless of Phase 18 |
| A8 | `@fontsource*` package names | Stack | None if the committed-asset route is used |
| A9 | `SYSTEM` can read `deploy\certs\server.key` with the explicit `icacls` grant | Item 6 | Low: verify at install |
| A10 | NVDA announces `role="alert"`/`aria-invalid` as intended | Item 4 | Medium: manual check only |
| A11 | Name constraints on the local CA would add safety | Item 6 | Optional, not recommended for this size |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | all frontend commands | yes (PowerShell/cmd; not on Git Bash PATH) | 26.13.0 / 11.20.0 (`engines >=22.22.2`) | - |
| Microsoft Edge | print check, camera check, lab | yes `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` | 156.0.4314.58 | Chrome path candidates in the test; `describe.skipIf` |
| Python venvs | backend tests, QtPdf helper | yes | 3.12.10; PySide6 6.12.0 | the Node text-scan parser |
| OpenSSL | optional verification only | yes via Git for Windows | 3.5.9 | .NET `CertificateRequest` generator needs none |
| mkcert | not used | no | - | not needed |
| Windows PowerShell | cert script, deploy | yes | 5.1.26100.9711 | - |
| Uvicorn TLS flags | HTTPS | yes | 0.54.0 | - |
| Frontend CI | - | none (`.github/workflows/tests.yml` runs v2 pytest only) | - | local gates |
| `gsd-tools` package-legitimacy seam | font package audit | no ("GSD runtime library is not built") | - | no npm install planned |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.5 + jsdom 30.1.3 + Testing Library 16.3.3 + user-event 14.6.8 |
| Config file | `frontend/vite.config.ts` (`test.setupFiles: ['./src/test/setup.ts']`, `css: false`, `cache: false`, `globals: true`) |
| Quick run command | from `D:\dr-sr\frontend`: `npm run typecheck` (about 3 s) then `npx vitest run <paths>` (a few seconds) |
| Full suite command | `npm run typecheck`, `npx oxlint` (silent, exit 0 = clean, 0.2 s), `npm test` (baseline 27 files / 98 tests, about 25 s); backend: `D:\dr-sr\backend\.venv\Scripts\python.exe -m pytest backend/tests -q` (needs PostgreSQL) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UX-01 | Body encoding; settings-driven header; receipt dialog after payment; reprint shows DUPLICATE; 80 mm one page | unit + print | `npx vitest run src/api/__tests__/queries-body.test.ts src/components/__tests__/receipt-print.test.tsx src/components/__tests__/receipt-dialog.test.tsx src/pages/__tests__/pending-dues.test.tsx src/pages/__tests__/patients-directory.test.tsx`; print: `npx vitest run src/print-check` | existing + Wave 0 |
| UX-02 | Native modal semantics, Esc, focus return, StrictMode, every migrated modal | unit | `npx vitest run src/components/__tests__/modal.test.tsx` plus the 12 modal-bearing test files in the inventory | Wave 0 + existing |
| UX-03 | No `alert()`; persistent `role=alert` | unit + scan | `npx vitest run src/pages/__tests__/backup-manager.test.tsx src/pages/__tests__/users-alerts.test.tsx` and `npx vitest run src/test/guards/guards.test.ts -t "no blocking dialogs"` | Wave 0 |
| UX-04 | No `text-[<12px]` / grey 300-400 outside print files; no root font-size override | scan | `npx vitest run src/test/guards/guards.test.ts -t "legibility guard"` | Wave 0 |
| UX-05 | `lang="hi"` on every Devanagari run; font in `dist`; no external URL | scan + build | `npx vitest run src/test/guards/lang-hi.test.ts src/test/guards/dist-clean.test.ts` | Wave 0 |
| UX-06 | Every control named; `aria-invalid` only after interaction | scan + unit | `npx vitest run src/test/guards/guards.test.ts -t "accessible names guard"` and `npx vitest run src/a11y/__tests__/user-invalid.test.tsx` (`-t` filters every file in the run, so keep them separate; optional: `npx oxlint --jsx-a11y-plugin -D jsx-a11y/label-has-associated-control src`) | Wave 0 |
| UX-07 | Decision recorded; cert generated; TLS handshake; camera on a client | script + manual | `powershell -ExecutionPolicy Bypass -File deploy\make-lan-cert.ps1 -ServerIp <ip>`; `openssl verify -CAfile deploy\certs\ca.pem deploy\certs\server.pem`; manual camera check per client PC | Wave 0 |
| UX-08 | Typecheck, lint, suite, one-page print checks, manual sheet | gate | `npm run typecheck && npx oxlint && npm test` | existing + Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run typecheck` + `npx vitest run` on the touched test files (under 30 s).
- **Per wave merge:** `npm run typecheck`, `npx oxlint`, `npm test` (plus `npx vitest run src/print-check` for print waves).
- **Phase gate:** full frontend suite + print check + backend suite green, then the manual sheet.

### Wave 0 Gaps
- [ ] `src/test/dialog-shim.ts` + `src/components/Modal.tsx` + `modal.test.tsx` (UX-02)
- [ ] `src/api/__tests__/queries-body.test.ts` (P1)
- [ ] `src/print-check/print-check.test.tsx` (UX-01, UX-08)
- [ ] `src/test/guards/guards.test.ts` (legibility, accessible names, no `alert()`; item 5), `lang-hi.test.ts`, `dist-clean.test.ts` (font present in a fresh build, no `https?://` in `dist` html/css, no `data:` URLs)
- [ ] `src/a11y/user-invalid.ts` + test; `src/components/InlineAlert.tsx` + tests
- [ ] `deploy/make-lan-cert.ps1`, `.gitignore` entry, `18-MANUAL-CHECKS.md`
- [ ] Framework install: none.

### Manual-check sheet (UX-08)
Real printers (A4 card, A4 prescription, receipt on the thermal/A5 device: width, cut position, DUPLICATE visibility, Devanagari glyphs); NVDA pass (dialog name announced, errors announced only after interaction, Hindi voice switch); keyboard-only pass (Tab, Esc, focus return to the opener); Windows display scaling 100/125/150 percent on `AppShell`, modals, tables; Windows dark mode on (billing UI stays light); internet disconnected (font and pages load, no external requests); per-client HTTPS camera check; Edge/Chrome version per PC.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V3 Session Management | yes | `KALYAN_COOKIE_SECURE=true` with HTTPS; HttpOnly + SameSite=Strict already set |
| V5 Input Validation | partly | server Pydantic stays authoritative; UI bridge is presentation only |
| V6 Cryptography | yes | .NET CNG RSA-2048/3072, SHA-256, TLS 1.3 via Python `ssl`; never hand-roll |
| V9 Communications | yes | TLS for all staff traffic; no HSTS (lock-out risk) |
| V14 Configuration | yes | `server.key` ACL + `.gitignore`; CSP change limited to `img-src 'self' blob:` |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LAN sniffing of passwords/PHI on HTTP | Information disclosure | HTTPS (Option A) |
| Stolen CA key mints certificates for any site on trusting PCs | Spoofing | Discard the CA key after signing (default) or keep it offline with a passphrase |
| Expired certificate locks staff out | Denial of service | Calendar reminder; no HSTS; documented renewal runbook |
| Cross-origin POST | Tampering | Existing `verify_origin` + CSRF token (unchanged) |
| Receipt/payment tampering | Tampering | Server-side ledger rules unchanged; UI only prints |

## Open Questions (RESOLVED)

1. **Root font-size and density** (P3): remove the 14px root (R1) or keep it and override Tailwind text tokens (R2)? Needs agreement with the owner of the shell redesign before `index.css` is touched. **RESOLVED: plan 05 Tasks 0/2/3/4, user decision R1 (remove the 14px root, browser 16px) only after the user reviewed the index.css diff and said `go R1`; default defer-root.**
2. **Backend CSP** (P2): approve the one-line `img-src 'self' blob:` change (and its place in a "frontend-only" phase), or switch previews to `<canvas>`? **RESOLVED: plan 07 Tasks 1 and 3, user decision canvas previews, backend untouched; `csp-blob` only on explicit approval (Task 4).**
3. **Receipt printer** (OD-06): thermal 80 mm roll, A5 or A4? Fixed page height (200/240/297 mm) or content-fit? Does the 30 percent opacity DUPLICATE stamp print legibly on it, or should DUPLICATE be a solid bordered mark? **RESOLVED: plan 04 Tasks 1 and 5, NOT assumed; blocking until the user confirms the actual printer and paper; real-printer check mandatory.**
4. **HTTPS** (OD-07): client decision, admin rights, browsers and Windows versions per client PC, fixed IP/host name, CA custody, whether `http://...:8000` may remain. **RESOLVED: plan 07 Tasks 2, 5 and 6; default upload-only, no CA install unless the user approves option A.**
5. **PatientsDirectory**: close the Radix preview Sheet before opening `PatientEditModal`, or keep both (works with `pointer-events-auto`, but `handleEditSuccess` assumes the Sheet stays open)? **RESOLVED: plan 02 Task 3 (PatientsDirectory untouched; `pointer-events-auto` keeps the edit dialog clickable over the Radix Sheet; `handleEditSuccess` unchanged).**
6. **Payment history placement and reversal**: confirm `PatientDetail` as the home for "Payments & receipts"; wire `PaymentReversalModal` for Admin there now, or defer (it is unreachable today, so BIL-05 has no UI)? **RESOLVED: plan 04 Task 3 (history on PatientDetail for Admin/Reception; the payment-reversal UI is NOT in Phase 18, tracked separately).**
7. **One-page definition for the prescription slip**: how many medicines and how much advice text must fit (10 short rows fit; long brand names spill)? Fix the fixture in the plan. **RESOLVED: plan 04 Task 4 (fixture: 10 short medicines + 2 advice lines must fit one A4 page; stress fixture not asserted).**
8. **Radix coexistence**: keep Radix `Dialog`/`Sheet` for shell drawers and delete or ignore the unused `components/ui/dialog.tsx`? **RESOLVED: plan 02 (keep Radix for shell drawers; `components/ui/dialog.tsx` stays unused and untouched).**
9. **Runtime Hindi data** (patient names in Devanagari): in scope for `lang="hi"` or deferred? **RESOLVED: plan 06 Task 2 (`name_hi` wrapped at render site; patient names typed in Devanagari deferred).**
10. **Minimum supported browser**: record Chrome/Edge 111+ (Tailwind v4) in `DEPLOYMENT.md`; `Modal` degrades on 111-133 via its `requestClose` fallback. **RESOLVED: plan 07 Task 5 (DEPLOYMENT.md records Chrome/Edge 111+) and plan 08 Task 4 (M-18-13 per-PC browser version).**

## Sources

### Primary (HIGH confidence)
- Repo files read this session: `frontend/package.json`, `vite.config.ts`, `src/index.css` (working tree), `index.html`, `tsconfig.json`, `src/api/{client,queries,types}.ts`, `src/components/*` (Payment*, Receipt*, Prescription*, Registration*, PrintLetterhead, PhotoUploader, PatientEditModal, AppointmentBookingModal, Session*Modal, PatientTimeline, `ui/dialog.tsx`, `ui/sheet.tsx`), `src/pages/*` (PendingDues, PatientDetail, PatientsDirectory, Users, Doctors, Backup/Audit pages, PrescriptionWorkspace/TreatmentPlanWorkspace excerpts), 24 test files, `backend/src/kalyan_api/{main,config}.py`, `core/{csrf,net,permissions}.py`, `routers/{auth,billing}.py`, `deploy/*`, `DEPLOYMENT.md`, `DECISIONS.md`, `SECURITY.md`, `docs/plans/frontend-ui-plan.md`, `.planning/{REQUIREMENTS,ROADMAP,STATE}.md`, `18-CONTEXT.md`, `17-MANUAL-CHECKS.md`.
- Experiments (this session): jsdom 30.1.3 dialog probe; React 19.3.1 attribute rendering; 14 Vitest tests (Modal + existing payment tests) with a mutation check; Edge 156 lab pages (centring, focus, autofocus, removal, cancel, Radix pointer-events, user-invalid); 25+ print-to-pdf cases; Vite 8 build outputs; real-middleware font/CSP test; Pydantic 422 reproduction; PowerShell certificate generation, OpenSSL and Python `ssl` verification, Uvicorn TLS handshake; contrast, Devanagari, legibility and unnamed-control scans.
- modern-web-guidance guides `dialog`, `prevent-page-scroll-under-modal-dialog`, `accessible-error-announcement`, `respect-os-text-scale` (retrieved via `npx -y modern-web-guidance@latest retrieve`).
- MDN: developer.mozilla.org/en-US/docs/Web/CSS/@page/size, /CSS/page, /API/MediaDevices/getUserMedia, /API/HTMLDialogElement/requestClose, /CSS/Reference/Selectors/:user-invalid
- tailwindcss.com/docs/compatibility (Chrome 111, Safari 16.4, Firefox 128)
- learn.microsoft.com/windows-server/administration/windows-commands/certutil (`-addstore`, `-user`)
- learn.microsoft.com/deployedge/microsoft-edge-browser-policies/overridesecurityrestrictionsoninsecureorigin
- chromium.googlesource.com/chromium/src/+/HEAD/net/docs/certificate_lifetimes.md (398-day limit scope)

### Secondary / Tertiary
- npm registry metadata for the two Fontsource packages (`npm view`), cross-checked by downloading and inspecting the tarballs (`[ASSUMED]` names).
- Chrome 85 / `:has()` 105 versions and client-side trust specifics: `[ASSUMED]` (A1-A4).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new runtime packages; versions read from `package.json`.
- Architecture: HIGH - each pattern built, tested in jsdom and exercised in Edge 156.
- Pitfalls: HIGH - nearly all reproduced; A5-A7 are the residual unknowns (real printer, client browsers).

**Research date:** 2026-11-02
**Valid until:** 2026-12-02 (Edge, Vite and Tailwind move quickly; re-run the print harness after a browser major update)
