---
phase: "22"
slug: "integrated-opd-workflow"
status: draft
shadcn_initialized: false
preset: none
created: "2026-11-15"
---

# Phase 22 — UI Design Contract (Integrated OPD Workflow)

> Visual and interaction contract for the OPD workflow: Check-in & Token, Waiting Room, doctor queue with the emergency banner and Call action, Billing & Checkout, Receipts, the doctor charges panel, and the referral report. Behaviour is owned by `22-DESIGN.md` (owner decisions OD-22-01 to OD-22-19, frozen 2026-11-15). This file adds visual and interaction detail only. It adds no business rule. Where a visual choice has no upstream answer it is marked PROPOSED and listed under Open Questions, not decided silently.

## Source Tags

Every contract line carries one tag:

| Tag | Meaning |
|-----|---------|
| `OD-22-nn` | Owner decision, frozen. Not re-opened here. |
| `§7` / `§8` / `§9` | Section of `22-DESIGN.md`. |
| `BUILT` | Implemented in Wave 1 (`frontend/src`), verified in code 2026-11-15. Uncommitted on branch `fix/sidebar-daily-flow`. |
| `CONVENTION` | Existing in-repo pattern reused unchanged. |
| `PROPOSED` | Not in any upstream artifact. Owner confirmation required before the wave that builds it. Each one maps to an Open Question. |

## Scope and Build Status (2026-11-15)

| Surface | Wave | Status |
|---------|------|--------|
| Check-in & Token (two columns) | 1 | BUILT. Migration 0026 not applied to `kalyan_dev`; `:8000` not restarted; `frontend/dist` not rebuilt (`22-DESIGN.md` §8a). |
| Waiting Room kanban | 2 | NOT BUILT. Reassign endpoint exists (§8b). |
| Doctor queue: suggested order, badges, Call on any waiting card | 2 | NOT BUILT. A "Call" button already exists on the doctor dashboard (pre-phase). |
| Emergency banner and Acknowledge | 2 | NOT BUILT. Acknowledge endpoint exists (§8b). |
| Billing & Checkout | 4 | NOT BUILT. Pre-phase base is `/reception/billing` (`ReceptionBillingPage`, `components/billing/VisitCheckout.tsx`). |
| Receipts | 4 | NOT BUILT. |
| Doctor charges panel | 4 | NOT BUILT. Consultation page is `/doctor/encounters/:id` (`pages/ClinicalEncounterWorkspace.tsx`). |
| Referral report (admin) | 5 | NOT BUILT. |

Wave 3 (bill lines, back-fill, fee snapshot) has no screen of its own. Its UI contract is the bill panel in S4.

Roadmap note: `.planning/ROADMAP.md` lists Phase 22 as "Advanced Data Operations" (deferred). The OPD workflow is not in the roadmap. See Q2.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none. `components.json` is absent (verified 2026-11-15). shadcn is not initialised because the brief says not to introduce a new design system. See Q1. |
| Preset | not applicable |
| Component library | none. Hand-built components in `frontend/src/components`. The shared dialog is `components/Modal.tsx`, built on the native `<dialog>` element. |
| Icon library | `@tabler/icons-react` 3.50.0, imported only through `frontend/src/components/icons/index.ts`. Stroke 1.8, 18 to 22px. Never import from `@tabler/icons-react` directly. |
| Font | System UI stack from `frontend/src/index.css`: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Nirmala UI", "Noto Sans Devanagari", Roboto, … sans-serif`. No bundled webfont. Hindi relies on the Windows "Nirmala UI" font on LAN PCs (Q18). |
| Styling | Tailwind CSS 4.3.3 via `@tailwindcss/vite`. Tokens are in the `@theme` block of `frontend/src/index.css`. There is no `tailwind.config.*` file. |

### Reuse Map (in-repo; non-exhaustive, not a closed allowlist)

Enumerated by `find frontend/src/components -name "*.tsx" ! -path "*__tests__*" | wc -l` — 46 component files — in-repo source, no package version — 2026-11-15. Every file path in this map was checked to exist on that date, and the `VisitCheckout` and `VisitDuesSection` exports were checked. The other symbols named in the table (formatters, polling hooks, Modal `variant` prop) were not re-verified on that date.

Non-exhaustive: the map names the reuse candidates for Phase 22. It is not a closed allowlist. Any other file under `frontend/src` may be used. Do not add a component that is not in the codebase.

| Existing item | Path | Use in Phase 22 |
|---------------|------|-----------------|
| Modal | `components/Modal.tsx` | Every dialog in this phase (reassign, receipt-adjacent confirms, fee adjust). Pass `variant`. Do not add `role="dialog"` or a focus trap. |
| InlineAlert | `components/InlineAlert.tsx` | Persistent error and success messages. Errors use `role="alert"`. |
| ConflictBanner | `components/ConflictBanner.tsx` | 409 stale-write message ("Record was modified by another user", action "Reload latest"). |
| LANStatusPill | `components/LANStatusPill.tsx` | Connection state. Defined with Connected and Disconnected states, but NOT mounted in AppShell today. Mounting it is a Wave 2 decision (Q19 covers the offline state). |
| PriorityBadge | `components/checkin/PriorityBadge.tsx` | The only classification badge. Use on every list and card. |
| TodayAppointmentsPanel | `components/checkin/TodayAppointmentsPanel.tsx` | Right column of Check-in & Token. |
| VisitCheckout, VisitDuesSection | `components/billing/VisitCheckout.tsx` | Billing & Checkout payment and close-visit forms. Extend, do not fork. |
| PaymentModal, ReceiptDialog, ReceiptHost | `components/` | Payment dialog and receipt after payment. |
| PendingDuesPage | `pages/PendingDuesPage.tsx` | Previous-dues ledger view. |
| Formatters | `frontend/src/format.ts` | `formatPaise` (₹40,000.50), `formatToken` (`A-05` or `#5`, em dash when none), `formatIst` (timestamps), `istToday`. |
| Polling hooks | `frontend/src/api/queries.ts` | `useAppointments` refetches every 10 s by default. Doctor queue refetches every 10 s (line 1035). |

---

## Component Inventory

Omitted. The design system is `none`, so this section does not apply. The Reuse Map above is the in-repo reuse list. It carries its own provenance line and is non-exhaustive.

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline padding |
| sm | 8px | Compact element spacing, gap between chips |
| md | 16px | Default element spacing, panel padding |
| lg | 24px | Section padding |
| xl | 32px | Layout gaps between columns |
| 2xl | 48px | Major section breaks |
| 3xl | 64px | Page-level spacing |

Exceptions: none. Every declared value is on the 4px scale. The off-scale values that Wave 1 code uses (2px, 6px, 10px, 12px) are not exceptions. They are migrated to the scale below (PROPOSED; Q14).

Migration of Wave 1 off-scale values (`BUILT` values, PROPOSED targets, applied on Phase 22 surfaces from Wave 2):

| Wave 1 value | Wave 1 utility | Migrated to | Migrated utility | Where |
|--------------|----------------|-------------|------------------|-------|
| 2px | `py-0.5` | 4px | `py-1` | Badge, chip and compact button vertical padding |
| 6px | `gap-1.5` | 8px | `gap-2` | Gap between badges and chips |
| 10px | `px-2.5` | 8px | `px-2` | Badge, chip and compact button horizontal padding |
| 12px | `p-3` on a card or panel | 16px | `p-4` | Card and panel inset |
| 12px | `p-3` on a dense list row | 8px vertical, 16px horizontal | `py-2 px-4` | Dense list row inset |
| 12px | `gap-3` / `space-y-3` | 16px / 8px | `gap-4` / `space-y-2` | Panel gaps / dense list stacks |

- Touch and click targets: 44px minimum (`min-h-11`) for primary actions and every form input. 32px minimum (`min-h-8`) is allowed only for secondary row actions in dense lists (the S1 row actions). Both values are on the scale.
- Layout: Check-in puts the form (left) and the appointments list (right) side by side at 1024px and up (`lg`). Below 1024px they stack, form first. `CONVENTION` from the built `lg:grid-cols-12`.
- PROPOSED for the Waiting Room: columns side by side at 1024px and up, each at least 280px wide, scrolling horizontally below that. Primary card actions (Call, Reassign) at 44px.

---

## Typography

Declared sizes: exactly 4. Declared weights: exactly 2 (400 and 700).

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Label | 12px | 700 | 16px (1.33) | Field labels (uppercase, `tracking-wider`), column headers, classification badges, source tags, meta text. 12px is the legibility floor. |
| Body | 14px | 400 | 1.5 (21px) | Body and helper text, input and select text, list rows, button text |
| Heading | 16px | 700 | 1.25 (20px) | Panel and section headings, patient name on cards, bill totals, total outstanding |
| Display | 36px | 700 | 1.0 | Issued token number only (`BUILT` token display uses 36px in the Wave 1 issued card) |

Rules:

- Numbers in money, token and receipt columns use `tabular-nums` so they align.
- Text sizes below 12px are blocked by the Phase 18 legibility guard (`frontend/src/test/guards/guards.test.ts`). The guard also blocks `text-slate-300`, `text-slate-400` and the grey 300/400 shades, and `text-red-500`, `text-emerald-600`, `text-amber-600`, `text-teal-600` on screens. Use the -700, -800 and -900 shades for coloured text.
- Weight drift: Wave 1 code uses 500, 600 and 900 (`font-medium`, `font-semibold`, `font-black`) in places. Any Phase 22 surface rebuilt from Wave 2 onward uses 400 or 700 only. Q14.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8FAFC` (slate-50) | Page canvas behind cards |
| Secondary (30%) | `#FFFFFF` (white) | Cards, panels, kanban columns, inputs. Borders `#E2E8F0` (slate-200). |
| Accent (10%) | `#8E1C3D` (`brand-700`) | See the reserved list below |
| Destructive | `#C81E1E` (`danger-600`) | Cancel, reverse, void, reassign confirm. Destructive actions only. |

Accent reserved for (explicit list, not "all interactive elements"):

1. Primary action button, one per panel: "Register & issue token", "Check in booking & issue token", "Check in & issue token", "Call", "Collect ₹X & Issue Receipt", "Patient Out".
2. Keyboard focus: input focus border and focus ring (`#8E1C3D` at 15% ring, as built `BUILT`).
3. The selected tab or selected segmented option.
4. The issued token number text (`brand-900`, `#5D0B26`, `BUILT`).

Not accent: card borders, row hover, status pills, badges, section headings, plain links.

### Meaning colours (fixed; not part of the 60/30/10 split)

| State | Badge or surface | Edge or accent | Source |
|-------|------------------|----------------|--------|
| EMERGENCY | `bg-red-600` (#DC2626), white text (4.8:1), alert-triangle icon | 4px left edge `red-600` on the row | `BUILT` PriorityBadge and today's list |
| PRIORITY | `bg-amber-100` (#FEF3C7), `text-amber-900`, `ring-amber-300` | 4px left edge `amber-400` | `BUILT` |
| NORMAL | No badge, no edge | None | `BUILT` |
| Emergency banner (doctor) | `bg-red-600`, white text. Same token as the EMERGENCY badge (`PriorityBadge.tsx`) | None | PROPOSED (changed 2026-11-15 from red-700) |
| Waiting | `bg-slate-100`, `text-slate-800` (neutral) | None | PROPOSED. Wave 1 shows Waiting in amber, which collides with PRIORITY (Q4). |
| In Cabin | `bg-violet-50`, `text-violet-800` | None | `BUILT` (labelled "With doctor" in Wave 1; Q3) |
| Completed | `bg-emerald-50`, `text-emerald-800` | None | `BUILT` (labelled "Seen by doctor" in Wave 1; Q3) |
| Booked | `bg-sky-50`, `text-sky-800` | None | `BUILT` |
| No-show | `bg-slate-100`, `text-slate-700` | None | `BUILT` (labelled "Not arrived"; Q3) |
| Cancelled | `bg-slate-100`, `text-slate-600` | None | PROPOSED. Wave 1 uses red-50 for Cancelled, which breaks the red rule (see below). Red is reserved for EMERGENCY, destructive actions and error messages. |
| Source tag: Doctor | `bg-consult-100` (#E0E7FF), `text-consult-800` | None | PROPOSED. Always paired with the text "Doctor". |
| Source tag: Reception | `bg-slate-100`, `text-slate-800` | None | PROPOSED. Always paired with the text "Reception". |
| Error message | `bg-red-50`, `border-red-300`, `text-red-900` | None | `BUILT` InlineAlert |
| Success message | `bg-emerald-50`, `border-emerald-300`, `text-emerald-900` | None | `BUILT` InlineAlert |
| Info message | `bg-blue-50`, `border-blue-300`, `text-blue-900` | None | `BUILT` InlineAlert |

Rules:

- Red means EMERGENCY or a destructive action. The InlineAlert error message is the one other red use (`BUILT`: pale surface, red-300 border, red-900 text). This rule was changed rather than the error style: a non-red error would lose its failure signal, and amber is reserved for PRIORITY (Q4). Error messages never use the EMERGENCY fill (`red-600`), the destructive colour (`danger-600`), a red badge or a red row edge.
- Amber means PRIORITY. Nothing else uses amber, including status pills.
- Colour is never the only signal. Every classification and source has a text label.
- Secondary text is `slate-500` at minimum on white cards. On the `slate-50` canvas use `slate-600`.
- Two filled reds exist by design: `red-600` for EMERGENCY (as built, including the emergency banner) and `danger-600` for destructive actions. The pale-red error treatment is a third use, text and border only. The meaning rule above keeps all three apart.

### Motion

- No blinking, pulsing or flashing on any waiting-room element or alert (OD-22-09; §7 "No blinking across the waiting room"). Q8 covers the existing pulse dot.
- Transitions are colour and opacity only, 150ms or less. Honour `prefers-reduced-motion`.

---

## Copywriting Contract

| Element | Copy | Source |
|---------|------|--------|
| Primary CTA (new patient) | Register & issue token | `BUILT` |
| Primary CTA (booking from list) | Check in booking & issue token | `BUILT` |
| Primary CTA (walk-in, existing patient) | Check in & issue token | `BUILT` |
| Primary CTA (queue) | Call (bell icon, no emoji) | PROPOSED. Existing doctor buttons read "🔔 Call" and "🔔 Call Next Waiting". Replace the emoji with the icon hub bell. |
| Primary CTA (payment) | Collect ₹X & Issue Receipt | `BUILT` (`VisitCheckout`) |
| Secondary CTA (after payment) | Print receipt | §7 |
| Visit close | Patient Out | §7. Existing label "Close Visit / Patient Out" is `BUILT`; Q12. |
| Empty: To arrive tab | No one booked for today is still to arrive. | `BUILT` |
| Empty: Checked in tab | No one has been checked in yet today. | `BUILT` |
| Empty: All tab | No appointments today. | `BUILT` |
| Empty: patient search | No registered patient matches. Switch to New patient to register them. | `BUILT` |
| Empty: Waiting column | No one is waiting. | PROPOSED |
| Empty: In Cabin column | No one is in a cabin. | PROPOSED |
| Empty: Completed column | No consultations completed yet today. | PROPOSED |
| Empty: checkout list | Nothing to check out. Patients appear here when their doctor completes the consultation. | PROPOSED |
| Empty: doctor queue | No patients waiting. | PROPOSED |
| Empty: bill | No charges on this visit yet. | PROPOSED |
| Empty: payments | No payments recorded on this visit yet. | `BUILT` |
| Empty: doctor charges | No charges added for this consultation yet. | PROPOSED |
| Empty: receipts today | No receipts issued today. | PROPOSED |
| Empty: referral report | No visits in this date range. | PROPOSED |
| Error: load failure | Could not load today's appointments: {message} | `BUILT`, persistent `role="alert"` |
| Error: token not issued | The token was not issued. Please try again. | `BUILT` |
| Error: submit blocked | Still needed: {list of missing fields}. The button stays disabled until the list is empty. | Pattern `BUILT`, wording PROPOSED |
| Error: action failed | Could not cancel the booking. / Could not move the booking. / Could not change the priority. / Could not mark the booking as not arrived. | `BUILT` pattern "Could not {verb} the booking." |
| Error: stale write | Record was modified by another user. [Reload latest] | `BUILT` ConflictBanner |
| Error: alert already acknowledged (409 `alert_already_acknowledged`) | This alert was already acknowledged. | PROPOSED |
| Error: acknowledge failed | Could not record the acknowledgement. The alert is still active. Try again. | PROPOSED. The UI never shows the alert as acknowledged before the server confirms. |
| Error: connection lost | Disconnected from the clinic server. Screens show the last data received. Retrying. | PROPOSED. Connection states come from LANStatusPill (`BUILT`). |
| Error: Patient Out blocked | Reason for closing with ₹X unpaid * (button disabled until a reason is entered) | `BUILT` |
| Destructive: cancel booking | Reason * (placeholder "e.g. Patient called to cancel"). Minimum 3 characters, checked on submit (`BUILT`, inline form). Form title "Cancel {patient name}'s booking"; submit "Cancel booking". | `BUILT` |
| Row action: cancel booking (Check-in list) | Built row label is "Cancel" (`TodayAppointmentsPanel.tsx`). Target label: "Cancel booking", the same words the built inline form already submits. | Target `PROPOSED`. Renaming the row button is a Wave 2 pass item. Until then the built label is "Cancel". |
| Row action: cancel consultation (Waiting card, S2) | Cancel consultation | PROPOSED. Opens the inline reason form. Submit label: "Cancel consultation". Reason rule as "Destructive: cancel booking". |
| Destructive: reassign (Wave 2) | Title: "Reassign token {old} to {doctor}?" Body: "Token {old} is cancelled. The patient gets a new token {new} from {doctor}'s sequence. The old token stays in history." Buttons: "Reassign & issue new token" / "Keep with current doctor". Reason is required. When the new doctor is not in the current department, a required "Department" select lists only the new doctor's departments (Q19). The error when none is chosen: "Choose one of {doctor}'s departments." | PROPOSED, behaviour from §5; department rule DECIDED Q19 |
| Priority hint: Normal | Seen in token order | `BUILT` |
| Priority hint: Priority | Amber: elderly, pregnant, disabled… | `BUILT`. The examples are copy, not a rule (Q15). |
| Priority hint: Emergency | Red: the doctor is alerted | `BUILT` |
| Priority reason label | Reason for priority * / Reason for emergency * (min 3 characters) | `BUILT` (OD-22-06) |
| Emergency banner | EMERGENCY · Token {token} · {patient name}. Reason line below. Button: Acknowledge. | PROPOSED |
| Emergency banner: acknowledging | Recording… | PROPOSED |
| Bill locked | Visit closed on {date and time}. The bill is locked. | PROPOSED, behaviour from §5 |
| Previous dues heading | Previous dues (separate ledger) | PROPOSED, behaviour from OD-22-17 |
| Previous dues button | Collect previous dues | PROPOSED |
| Receipt line (after payment) | Receipt {number} issued for ₹X. | `BUILT` (`VisitCheckout`) |

---

## Screen Contracts

### S1. Check-in & Token (Wave 1, BUILT)

Layout:

- Left column: patient mode (New / Existing) as a segmented control.
  - New: Name*, Age*, Phone*, Sex* (Male, Female, Other), Guardian, Referred By*, Consulting Doctor*, Address. `OD-22-03`
  - Existing: search by URN, name or mobile. Visit type (NEW or FOLLOW_UP) is shown for existing patients only. `§7`, `OD-22-05`
  - Classification (NORMAL default). A reason field appears only for PRIORITY or EMERGENCY, minimum 3 characters. `OD-22-06`
  - Referred By defaults to Self. The name field appears only for DOCTOR, PERSONAL and ORGANIZATION. `OD-22-16`
  - Submit button at the bottom. Disabled, with the "Still needed" list, until valid.
- After success: the form is replaced by the issued card (URN, doctor, token, priority badge) with "Check in next patient". `BUILT`
- Right column: `TodayAppointmentsPanel`. Tabs To arrive, Checked in, All, with counts in `font-mono`. Rows show time, patient, phone, doctor and status. Row actions: Check in (loads the booking into the left form, doctor fixed), No-show, Reschedule, Cancel (built label; target "Cancel booking", see Copywriting), Change priority. `BUILT`
- Priority edge on rows: 4px red-600 (EMERGENCY) or amber-400 (PRIORITY).
- The payment line "No payment is taken at check-in." stays as built. Payment is not a queue condition (`OD-22-18`).

Data: the list refreshes every 10 s (`§9`). Mutations refetch on success.

Accessibility gaps (to fix in the Wave 2 pass):

- The tablist uses `role="tab"` with no keyboard handling. There is no arrow-key navigation and no roving `tabindex`. Zero `onKeyDown` handlers in `TodayAppointmentsPanel.tsx`. Risk R1.
- Each input has a visible label. Errors use `InlineAlert` `role="alert"`.

Visual truth to verify on `:8000` after `frontend/dist` is rebuilt: the two-column layout, the priority edges, the tab counts, and the issued card. Per the owner's memory note, the check is on `:8000`, not on Vite `:5173`.

### S2. Waiting Room (Wave 2, NOT BUILT, §7 item 5)

PROPOSED route: `/reception/waiting`. Q11 covers the overlap with the dashboard.

- Three columns: Waiting, In Cabin, Completed. These are the design's labels (§7) and match the labels already used on the reception dashboard status tabs (`pages/ReceptionDashboard.tsx`).
- Column header: label (12px uppercase) with the count in `font-mono`.
- Filters across the top: doctor, department, search by name, URN or token. Same input style as Check-in (`BUILT`).
- Waiting cards: token (`font-mono`, bold), patient name (16px bold, one line, truncated with ellipsis, full name shown in the card detail), doctor, URN, `PriorityBadge`, and a computed position number. Order is the suggested order (`OD-22-07`: EMERGENCY by classification time, then PRIORITY by token, then NORMAL by token). Positions are recomputed on every refresh and never stored.
- Waiting card actions (reception only): Reassign (opens a Modal) and Cancel consultation (inline reason; the same pattern as the built check-in cancel; label PROPOSED, see Copywriting). No "Complete" control anywhere on this screen (`OD-22-19`).
- In Cabin cards: token, name, doctor, badge. No actions.
- Completed cards: token, name, doctor, and an "Open bill" link to Billing & Checkout (§7).
- Cards move between columns only through server actions. No drag and drop. PROPOSED.
- Column content scrolls on its own. The page does not scroll as a whole.
- Refresh every 10 s. No animation or flashing on any card (OD-22-09).

### S3. Doctor Queue, Emergency Banner and Call (Wave 2, banner and order NOT BUILT; Call partly built)

- Queue order: suggested order (`OD-22-07`), shown in the existing doctor queue layout.
- Each waiting card shows `PriorityBadge`. The doctor's existing card badge colours (rose allergy, indigo, sky, slate) stay for their own meanings. The classification badge is always the `PriorityBadge`.
- Call: available on any waiting card, not only the first (`OD-22-08`). The existing "Call" buttons are reused. Replace the emoji with the icon-hub bell.
- Reordering never interrupts a consultation. The active card is pinned in an "In consultation" section at the top and is not re-sorted. PROPOSED, behaviour from `OD-22-08`.
- Emergency banner (PROPOSED throughout this bullet group):
  - Placement: in the doctor app shell, so it shows on every doctor screen, including the consultation page, until acknowledged (Q7).
  - Content: "EMERGENCY · Token {token} · {patient name}", the reason on the next line, and an Acknowledge button. Multiple unacknowledged alerts stack, oldest classification first.
  - Style: `bg-red-600` (the EMERGENCY badge token), white text, 16px heading, 14px body.
  - Not a Modal. It does not block Call or the consultation.
  - No dismiss (X) button. The only exit is Acknowledge, because the alert stays until acknowledged (`OD-22-09`).
  - Announcement: one persistent live region. Announce when the first alert appears. Updates in place do not re-announce on each 5-second refresh.
  - Refresh: every 5 s (`§9`).
  - Acknowledge: shows "Recording…" while pending. On success the row is removed after the refetch. On 409 it shows "This alert was already acknowledged." On other failure it shows an `InlineAlert` error inside the banner and the alert stays. Never shows acknowledged before the server confirms.
  - Sound: none added (Q6). Motion: none (Q8).
  - Only the assigned doctor's own consultations appear (server-enforced; the UI renders only what is returned).
- Reception never sees Acknowledge.

### S4. Billing & Checkout (Wave 4, NOT BUILT; base is the existing `/reception/billing`)

Label: "Billing & Checkout" (`§7`). The built tab reads "Billing & Payments" (Q9).

Layout:

- Left: patients whose consultation is completed. Each row shows name, URN, token, doctor, completion time (`formatIst`) and outstanding amount (`formatPaise`).
- Right: the bill panel, and beside it the financial history panel (`§7`). Stacks below 1024px, bill first.

Bill panel (`OD-22-14`):

- Sections in this order: Consultation, Procedures / Services, Treatment Packages, Medicines, Additional Particulars. Each section heading is a 12px uppercase label with its subtotal.
- Each line: description, then "quantity × rate = amount" (for example "2 × ₹120.00 = ₹240.00"), then a source tag. The source tag text is "Doctor" or "Reception" (see Color). Doctor and reception lines stay distinguishable (`OD-22-14`).
- Adjusted line: the current amount, then "Changed from ₹X · {reason} · {staff name} · {time}" (`OD-22-15`). Previous values are kept and shown, never overwritten.
- Voided lines: hidden from the total and listed in a collapsed "Voided lines" disclosure, each with its reason. PROPOSED. History is never removed silently.
- Reception actions (`bill:write`, reception only): "Add medicine" (from the prescription or typed: name, quantity, unit, rate) and "Add particular" (name, quantity, rate, total). Both sit in the section footer.
- Consultation line: "Fee as billed at check-in" (`OD-22-10`). The fee is a snapshot. No live fee lookup.
- Locked after the visit closes: no add, adjust or void controls. The "Bill locked" line in the Copywriting table appears.

Previous dues (`OD-22-17`):

- A separate card below or beside the current bill, titled "Previous dues (separate ledger)". Never merged into the bill total.
- Each prior visit's due: date, visit reference and amount. Collected with its own button ("Collect previous dues"), which issues its own receipt. PROPOSED label.
- Zero dues: the card reads "No previous dues" so the layout does not jump. PROPOSED.

Totals block, in this exact order (`§7`):

1. Bill total (this visit)
2. Paid earlier (this visit)
3. Paying now
4. Remaining on this visit
5. Previous dues (separate line, not summed into rows 1 to 4)
6. Total outstanding (= row 4 + row 5, with the breakdown visible)

Labels 14px regular. Values 16px bold, `tabular-nums`, right-aligned. Row 6 is the only summed total and is labelled with its breakdown.

Payment (`BUILT` pattern in `VisitCheckout`):

- Payment mode: Cash, UPI, Card (segmented, "Payment Mode *").
- Amount: full or partial. Default is the remaining amount on this visit.
- Partial payment is allowed. The CTA is "Collect ₹X & Issue Receipt".
- On server confirmation only: the receipt dialog opens (existing `ReceiptDialog`). Reprints are marked DUPLICATE (`BIL-04`). The receipt prints on one A4 page (`UX-01`, client decision 2026-11-02).
- A failed submit shows a persistent `InlineAlert`. The button is re-enabled. No receipt is shown for a payment the server did not confirm.

Patient Out (`OD-22-18`):

- Shown after the receipt step. Label "Patient Out".
- If a balance remains: a reason field "Reason for closing with ₹X unpaid *" is required. The button is disabled until a reason is entered (`BUILT`).
- Patient Out with a balance is allowed. The balance stays in the ledger.

Financial history panel (`§7`):

- Packages with sessions used and sessions left. Shown in the Packages section, never double-counted in the bill (`§4`).
- Payments list: receipt number, date, method, amount. Reversed payments stay visible with a "Reversed" tag. Never removed.

Data: list refreshes every 10 s. The bill refetches after each mutation. A 409 shows `ConflictBanner`.

Money: all amounts through `formatPaise`. Rupee inputs through `rupeesToPaise` and `paiseToRupees`.

Permissions shown in the UI (server enforces them; the UI hides what the server would refuse):

- Reception: payment, Patient Out, add lines.
- Adjust consultation fee: shown only if the user holds `bill:adjust`.
- Doctors have no route to this page.

### S5. Receipts (Wave 4, NOT BUILT)

- Tab "Receipts" (`OD-22-01`).
- Reception: today's receipts. Columns: time (`formatIst`), receipt number (`font-mono`), patient, method, amount (right-aligned, `tabular-nums`), and a "Reprint" action. Reprints are marked DUPLICATE. Newest first. Totals line: receipt count and sum. PROPOSED.
- Admin: full ledger with a date-range filter. Reversed items stay visible with the "Reversed" tag (`BIL-05`). The reversal UI is not part of Phase 22 (backlog 999.1).

### S6. Doctor Charges Panel (Wave 4, NOT BUILT, on the consultation page)

Location: the consultation page, `pages/ClinicalEncounterWorkspace.tsx`, mounted at `/doctor/encounters/:id` in its test harness. Confirm the production route and the panel position when T22-10 starts.

- Consultation fee, read-only: "₹X, billed at check-in" (`OD-22-10`).
- "Add charge": category (procedure or service, or package), description, quantity, rate. Source tag "Doctor".
- "Adjust fee" (reduce, discount or waive, `OD-22-11`): reason required. Opens a Modal. Shows the original amount and the revised amount: "Original ₹X → Revised ₹Y · {reason} · {you} · {time}".
- Waived lines show ₹0.00 with a "Waived" text tag. PROPOSED.
- The doctor sees no payment or collect control (`OD-22-19`).
- Locked when the visit is closed.
- Visibility of reception lines and the visit total to the doctor is not specified (Q13). This panel shows the doctor's own lines only.

### S7. Referral Report (Wave 5, NOT BUILT, admin only)

- Route and placement: PROPOSED, under the admin "Patient & Data Management" group. Reception's own Reports tab (OD-22-01, DECIDED Q10) shows today's collection summary, not this report. See Wave 5 in the Q10 row.
- Filters: date range (from, to), referral source (Self, Doctor, Personal, Organisation, Other, from `OD-22-16`), referrer name.
- Table: source label, referrer name (shown only where the source requires a name), visit count.
- Empty: "No visits in this date range." PROPOSED.
- No export is specified in the design, so none is designed here.

---

## UI Considerations

Applicable state considerations (probe, 2026-11-15): 80 raised across 11 surfaces. Resolution: **backstop for all** (owner choice). Each one is confirmed only by a visual or held-out check at verify time; anything without that check routes to human review, never a silent pass.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | E1 S1 Check-in | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E1 S1 Check-in | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E1 S1 Check-in | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E1 S1 Check-in | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E1 S1 Check-in | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E1 S1 Check-in | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E1 S1 Check-in | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| long-text | E1 S1 Check-in | 🧪 backstop | What happens with unusually long text — truncation, wrapping, ellipsis, or reflow? Verify with a visual or held-out check. |
| empty | E2 S1 Today's | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E2 S1 Today's | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E2 S1 Today's | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E2 S1 Today's | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E2 S1 Today's | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E2 S1 Today's | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E2 S1 Today's | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| long-text | E2 S1 Today's | 🧪 backstop | What happens with unusually long text — truncation, wrapping, ellipsis, or reflow? Verify with a visual or held-out check. |
| empty | E3 S2 Waiting | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E3 S2 Waiting | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E3 S2 Waiting | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E3 S2 Waiting | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E3 S2 Waiting | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E3 S2 Waiting | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E3 S2 Waiting | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| empty | E4 S3 Doctor | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E4 S3 Doctor | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E4 S3 Doctor | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E4 S3 Doctor | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E4 S3 Doctor | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E4 S3 Doctor | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E4 S3 Doctor | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| long-text | E4 S3 Doctor | 🧪 backstop | What happens with unusually long text — truncation, wrapping, ellipsis, or reflow? Verify with a visual or held-out check. |
| empty | E5 S4 Billing | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E5 S4 Billing | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E5 S4 Billing | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E5 S4 Billing | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E5 S4 Billing | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E5 S4 Billing | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E5 S4 Billing | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| empty | E6 S4 Bill | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E6 S4 Bill | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E6 S4 Bill | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| partial | E6 S4 Bill | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| long-text | E6 S4 Bill | 🧪 backstop | What happens with unusually long text — truncation, wrapping, ellipsis, or reflow? Verify with a visual or held-out check. |
| empty | E7 S4 Previous | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E7 S4 Previous | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E7 S4 Previous | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E7 S4 Previous | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E7 S4 Previous | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E7 S4 Previous | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E7 S4 Previous | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| empty | E8 S4 Payment | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E8 S4 Payment | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E8 S4 Payment | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E8 S4 Payment | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E8 S4 Payment | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E8 S4 Payment | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E8 S4 Payment | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| long-text | E8 S4 Payment | 🧪 backstop | What happens with unusually long text — truncation, wrapping, ellipsis, or reflow? Verify with a visual or held-out check. |
| empty | E9 S5 Receipts | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E9 S5 Receipts | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E9 S5 Receipts | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E9 S5 Receipts | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E9 S5 Receipts | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E9 S5 Receipts | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E9 S5 Receipts | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| empty | E10 S6 Doctor | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E10 S6 Doctor | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E10 S6 Doctor | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E10 S6 Doctor | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E10 S6 Doctor | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E10 S6 Doctor | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E10 S6 Doctor | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |
| long-text | E10 S6 Doctor | 🧪 backstop | What happens with unusually long text — truncation, wrapping, ellipsis, or reflow? Verify with a visual or held-out check. |
| empty | E11 S7 Referral | 🧪 backstop | What is shown when there is no data — zero items, an unfilled form, or absent media? Verify with a visual or held-out check. |
| loading | E11 S7 Referral | 🧪 backstop | What is shown while data or content is still loading (skeleton, spinner, progressive reveal)? Verify with a visual or held-out check. |
| error | E11 S7 Referral | 🧪 backstop | What is shown when the load or submit fails (message, retry affordance, partial fallback)? Verify with a visual or held-out check. |
| populated | E11 S7 Referral | 🧪 backstop | What does the normal populated (happy-path) state look like at a typical volume of content? Verify with a visual or held-out check. |
| partial | E11 S7 Referral | 🧪 backstop | What is shown for partial or incomplete data — some fields or rows present, others missing? Verify with a visual or held-out check. |
| overflow | E11 S7 Referral | 🧪 backstop | What happens when content exceeds its container — scroll, clip, wrap, or truncate? Verify with a visual or held-out check. |
| zero-one-many | E11 S7 Referral | 🧪 backstop | How does the layout read at zero, one, and many items (singular vs plural copy, spacing)? Verify with a visual or held-out check. |

Hand-written resolutions from the earlier draft, kept as written. They do not change the backstop status above:

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Today's appointments list (list-collection) | ✅ covered | Three empty copies by tab (Copywriting table). |
| loading | Today's appointments list | ✅ covered | "Loading today's appointments…" inside the panel (`BUILT`). |
| error | Today's appointments list | ✅ covered | Persistent inline error with the message (`BUILT`). |
| zero-one-many | Tab counts (list-collection) | ✅ covered | Each tab label shows its count in `font-mono`; no plural copy depends on the count. |
| overflow | Today's list at about 50 rows | 🧪 backstop | Panel scrolls inside its own container. Visual check at 50 rows on `:8000`. |
| long-text | Patient name and address on the check-in form and cards | 🧪 backstop | Form fields wrap. Waiting cards truncate to one line. Visual check at 60 characters. |
| empty | Waiting Room columns (list-collection) | ✅ covered | Per-column copy (Copywriting table). |
| overflow | Waiting Room columns | 🧪 backstop | Each column scrolls; columns fill the viewport height. |
| error | Waiting Room data (stale) | ⚠ unresolved | Planner assumption: keep the last data and show a "Last updated" time. Q19 covers the offline state. |
| loading | Emergency banner Acknowledge | ✅ covered | "Recording…" while pending (Copywriting table). |
| error | Emergency banner Acknowledge | ✅ covered | 409 and failure messages. The alert stays until the server confirms. |
| empty | Billing checkout list (list-collection) | ✅ covered | "Nothing to check out" copy. |
| empty | Bill with no lines (list-collection) | ✅ covered | "No charges on this visit yet." The consultation line is always present (`OD-22-10`, back-fill), so this is a defensive state only. |
| zero-one-many | Previous dues (list-collection) | ✅ covered | Zero shows "No previous dues". One and many use the same list layout. |
| overflow | Bill panel with many lines (list-collection) | 🧪 backstop | Bill panel scrolls. Totals stay visible in a footer. Visual check with 40 lines. |
| long-text | Previous dues card with many prior visits | ⚠ unresolved | Pagination is not in the design. Planner assumption: scroll inside the card. |
| error | Payment submit (interactive-control) | ✅ covered | Persistent `InlineAlert`. Button re-enabled. No receipt shown without server confirmation. |
| error | Stale write (form) | ✅ covered | `ConflictBanner` with "Reload latest". |
| empty | Receipts table (list-collection) | ✅ covered | "No receipts issued today." |
| empty | Doctor charges panel (list-collection) | ✅ covered | "No charges added for this consultation yet." |
| empty | Referral report table (list-collection) | ✅ covered | "No visits in this date range." |
| long-text | Reason fields (form) | ⚠ unresolved | Maximum length is not in the design. Planner assumption: no limit beyond the server column type. Q17. |
| loading | Doctor queue on first load | 🧪 backstop | Skeleton rows keep the card layout still while loading. Visual check. |

Status key: 🧪 backstop means the truth is confirmed only by a visual or held-out check; ⚠ unresolved in the retained rows means the planner treats it as an explicit assumption.

---
## Open Questions

Each question has the default this spec uses. The owner confirms or overrides before the wave that builds the item. None of these stops the Wave 1 record.

| ID | Question | Default used in this spec | Blocks |
|----|----------|---------------------------|--------|
| Q1 | The shadcn gate: `components.json` is absent. Initialise shadcn, or keep no design system? | Tool: none. No new design system (the brief). | Nothing |
| Q2 | ROADMAP lists Phase 22 as "Advanced Data Operations" (deferred). This OPD work is not in the roadmap. Register it. **DECIDED 2026-11-15: register it in ROADMAP.md.** | This spec lives in `phases/22-integrated-opd-workflow`. | Planning registration |
| Q3 | Status vocabulary. Design §7 and the reception dashboard use Waiting / In Cabin / Completed. Wave 1 Check-in list uses Waiting / With doctor / Seen by doctor, and shows NO_SHOW as "Not arrived" where §7 says No-show. | Design and dashboard terms for every new screen. Align the Check-in list. | Wave 1 label fix |
| Q4 | Amber collision. Wave 1 Check-in shows Waiting in amber, the same colour as PRIORITY. | Waiting is neutral slate. Amber means PRIORITY only. | Wave 1 fix, before Wave 2 |
| Q5 | `AppointmentsReception.tsx` shows "EMERGENCY HOLD (THIS SCREEN ONLY)", a screen-only delay state. It shares the word with the OD-22-06 classification. | **DECIDED 2026-11-15: renamed to "ON HOLD (THIS SCREEN ONLY)".** The word EMERGENCY is not used for holds. | Done in code (frontend) |
| Q6 | Sound on an emergency alert. Calling a patient plays a waiting-room chime today. The design is silent on sound for alerts. | No sound added for EMERGENCY. The existing Call chime is unchanged. | Wave 2 |
| Q7 | Banner placement: every doctor screen (app shell), or the dashboard only. | App shell, so the alert is not missed on the consultation page. | Wave 2 |
| Q8 | Animation. §7 forbids blinking across the waiting room. The doctor dashboard has an `animate-pulse` dot on the in-cabin card (pre-phase). | No animation on any classification or alert. The new Waiting Room has no pulse. The existing doctor dot stays until the owner decides. | Wave 2 |
| Q9 | Billing label and tabs. §7 says "Billing & Checkout", with Receipts a separate tab. Built: "Billing & Payments" at `/reception/billing`, with tabs checkout, ledger, dues. | Rename to Billing & Checkout. Receipts becomes its own tab. Dues stays reachable. | Wave 4 |
| Q10 | OD-22-01 lists a reception "Reports" tab. Wave 5 is an admin-only referral report. | **DECIDED 2026-11-15: keep the reception Reports tab (OD-22-01 as written). It shows today's collection summary from `GET /billing/receipts/today`, with reversed payments shown separately. The referral report stays admin-only.** | Wave 5 |
| Q11 | Waiting Room and dashboard overlap. §7 says the dashboard is unchanged, and it already has Waiting, In Cabin and Completed tabs. | Both exist. The Waiting Room adds ordering, filters, cancel and reassign. | Wave 2 |
| Q12 | Patient Out label. Built: "Close Visit / Patient Out". §7: "Patient Out". | "Patient Out". | Wave 4 |
| Q13 | Doctor visibility of the visit bill. The design is silent. | The doctor sees only their own charges and the consultation fee. No visit total. | Wave 4 |
| Q14 | Type and spacing drift. Wave 1 uses 6 sizes (12 to 24px), weights 500, 600, 900, and off-scale spacing (2, 6, 10, 12px). This spec declares 4 sizes, weights 400 and 700, and the 4px spacing scale with the migration table. | Applies to Phase 22 surfaces from Wave 2. Wave 1 is listed for the auditor, not rebuilt now. | None |
| Q15 | Priority hint examples ("elderly, pregnant, disabled") are not defined as a rule in the design. | Kept as example copy. The owner confirms the wording. | None |
| Q16 | Patient Out reason. The design requires a reason when a balance remains, with no length. Built: non-empty after trim. The priority reason requires 3 characters. | Non-empty after trim, as built. | Wave 4 confirm |
| Q17 | Maximum length for reason fields. Not in the design. | No limit beyond the server column type. | None |
| Q18 | Hindi font. There is no bundled Devanagari font. Hindi renders with the Windows "Nirmala UI" font on LAN PCs. Phase 18 plan 18-06 is not built. | System stack. UX-05 stays open. | None for Phase 22 |
| Q19 | Offline and reassign scope. Mounting LANStatusPill in the app shell, and whether the reassign target list is limited to the same department. §7 says "filter by doctor and department" and §5 does not restrict reassign. | **DECIDED 2026-11-15 (reassign): any consulting doctor. The current department is kept when the new doctor belongs to it; otherwise reception picks one of the new doctor's departments (the reassign form shows that picker).** LANStatusPill mounting remains PROPOSED. | Wave 2 |

---

## Risks

| ID | Risk | Mitigation in this contract |
|----|------|-----------------------------|
| R1 | The Check-in tablist has no arrow-key handling (zero `onKeyDown`). | Add roving `tabindex` and arrow keys in the Wave 2 pass. |
| R2 | Wave 1 is built but not deployed: migration 0026 not applied to `kalyan_dev`, `:8000` not restarted, `frontend/dist` not rebuilt (`§8a`). A new dist against the old server breaks check-in. | All three happen together. Verify on `:8000` after the rebuild. |
| R3 | Two reds (`red-600` for EMERGENCY, `danger-600` for destructive) look similar. | Meaning rule in the Color section. Red fills and red row edges are used only for EMERGENCY and destructive actions. The pale-red InlineAlert error is the one text-and-border exception. |
| R4 | Waiting Room duplicates the dashboard's status tabs. | Q11. Shared labels from one source. |
| R5 | The "🔔 Call" emoji in doctor buttons is not an icon-hub icon. | Replace with the icon-hub bell (Copywriting table). |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable. shadcn is not initialised (Q1). |
| Third-party | none declared | not applicable. No registry vetting gate is triggered. |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Dimension 7 Inventory Provenance: PASS (Reuse Map carries a provenance line and is marked non-exhaustive; Component Inventory omitted because Tool is none)

**Approval:** pending
