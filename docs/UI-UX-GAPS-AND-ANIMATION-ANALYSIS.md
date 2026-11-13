# UI/UX Gaps & Animation Opportunities Analysis

**Date:** 2026-11-11

**Scope:** Active React frontend in `frontend/src/`; legacy desktop UI excluded.

**Method:** Source inspection of the shell, patient, appointment, clinical, physiotherapy, billing, administration, authentication and print flows; comparison with `docs/plans/frontend-ui-plan.md` and the current Phase 18 records. No UI implementation is included.

## 1. Executive summary

The frontend already has useful foundations: a shared native `<dialog>` with focus return and busy/dismiss policies, persistent inline alerts in many flows, labelled form controls, visible global focus styles, textual loading/error/empty states in most data views, and a global `prefers-reduced-motion` override.

The next investment should therefore **not** be a wholesale component or animation-library replacement. The highest-value work is workflow correctness and continuity:

1. Correct misleading clinical error feedback.
2. Protect unsaved clinical and registration work.
3. Expose partial registration/photo failure honestly.
4. Restore the application shell on the billing ledger.
5. Add real patient-list pagination and role-appropriate actions.
6. Make the mobile drawer a proper keyboard/modal interaction.
7. Resolve small-text, responsive-table and async-feedback inconsistencies.

Animation should be sparse and functional: dialogs/drawers, loading stability, save confirmation, queue changes and treatment progress. It must never distract from patient identity, clinical values, warnings or irreversible actions.

### Priority key

- **P1 — Workflow/accessibility correction:** fix before motion polish; can lose work, mislead staff, block navigation, or exclude users.
- **P2 — Consistency and usability:** important follow-up; improves speed, comprehension and robustness.
- **P3 — Enhancement:** worthwhile, but not a substitute for P1/P2 corrections.
- **A — Animation opportunity:** optional functional polish, after the related interaction is correct.

## 2. Prioritized UI/UX gaps

### P1-1 — Clinical and appointment errors are mislabeled as concurrency conflicts

**Evidence**

- `frontend/src/pages/ClinicalEncounterWorkspace.tsx:82-89,114-123,201-211` stores required-field, save and network failures in `conflictError`, then renders `ConflictBanner`.
- `frontend/src/components/ConflictBanner.tsx:22-29` always says **“Record was modified by another user”** and offers **“Reload latest”**, regardless of the supplied error.
- `frontend/src/pages/AppointmentsReception.tsx:307-314` similarly routes every appointment-status error through the conflict banner.

**Impact**

A doctor who omitted a required field, lost connectivity, or received a validation/authorization error is told another user changed the record. That is incorrect recovery guidance in a clinical workflow. Reloading can also replace local encounter fields through the existing-record synchronization effect.

**Recommendation**

Classify errors explicitly: field validation, server validation, network failure, permission failure and version conflict. Reserve `ConflictBanner` for a confirmed 409/version conflict. Show the actual safe error message in the appropriate alert; focus the first invalid field for client validation. Warn before discarding local edits during conflict resolution.

**Acceptance check**

Submitting an empty encounter never mentions another user; a synthetic 409 does; a network failure offers retry without claiming a conflict.

---

### P1-2 — Unsaved clinical, prescription and registration work is not protected

**Evidence**

- `frontend/src/components/UnsavedChangesGuard.tsx` provides route blocking and browser-unload warnings, but current usage is only in `frontend/src/pages/Settings.tsx`.
- `ClinicalEncounterWorkspace`, `PrescriptionWorkspace`, `PatientRegister` and the treatment-plan/session forms maintain local input without that guard or a recoverable local draft.
- The encounter’s **Treatment Plan**, **Write Prescription** and queue/back links navigate away from unsaved notes.
- `docs/plans/frontend-ui-plan.md` calls for unsaved-form local drafts, especially around session expiry.

**Impact**

A wrong click, navigation, reload or expired session can discard consultation notes, a medication list or a completed registration form. The encounter’s cross-workflow links make accidental loss particularly easy.

**Recommendation**

Compute dirty state per workflow and apply the existing guard consistently. Add session-scoped, explicitly identified local drafts for long clinical forms; restore only for the same user and patient, show draft age, and clear after confirmed save. Do not silently replay clinical writes when connectivity returns.

**Acceptance check**

Every exit path warns while dirty; save deliberately bypasses the guard; restoring a draft never mixes users or patients.

---

### P1-3 — Registration reports success even when photo upload failed

**Evidence**

`frontend/src/pages/PatientRegister.tsx:112-127` catches photo-upload failure, logs only to the console, and then displays the normal registration-success state.

**Impact**

Reception may believe the identity photograph was saved when only the demographic record exists. The current success UI offers no retry-photo action, making the partial failure easy to miss and awkward to repair.

**Recommendation**

Use a distinct partial-success state: “Patient registered; photo not uploaded.” Keep the URN visible, retain the selected photo where safe, provide **Retry photo upload** and **Continue without photo**, and never describe the whole operation as fully successful until the selected photo is saved.

---

### P1-4 — Pending Dues loses the global application shell and navigation

**Evidence**

- `frontend/src/pages/PendingDuesPage.tsx` renders its own container without `AppShell`.
- `frontend/src/router.tsx:163-175` mounts it directly under the Admin/Reception role guard.

**Impact**

Opening **Billing & Payments** removes the sidebar, header, breadcrumbs, role context and sign-out control. Users must rely on browser history to recover, unlike every other primary operational area.

**Recommendation**

Render the ledger inside the shared `AppShell`, using the current user’s name/role. Align its header, table, feedback and responsive behavior with the patient and appointment workspaces.

---

### P1-5 — Patient directory silently limits browsing to 20 records

**Evidence**

- `frontend/src/api/queries.ts:624-631` defaults patient queries to `limit=20&offset=0`.
- `frontend/src/pages/PatientsDirectory.tsx:23-31` uses those defaults and has no page, next/previous, total-count or “showing X of Y” control.
- The UI plan explicitly says lists must never silently truncate.

**Impact**

Only the first 20 records are browsable. Search may still find a known patient, but staff receive no indication that more records exist, which makes the registry appear incomplete.

**Recommendation**

Add server-backed pagination with a total count, stable ordering and preserved search/page state. At minimum, provide next/previous controls and an honest result range even if the API count response needs extension.

**Acceptance check**

A 21st matching patient is reachable without guessing a search term, and the UI states the visible range and total.

---

### P1-6 — Patient actions are not consistently matched to role capability

**Evidence**

- `PatientsDirectory.tsx:60-65` always shows **Register New Patient**, although `router.tsx:177-186` permits that destination only to Reception.
- `PatientsDirectory.tsx:216-230` always shows Edit; `PatientDetail.tsx:137-152` always shows Edit Demographics and Print Card.
- The routes permit all three roles to open the directory/profile, so these controls are also visible to users who cannot perform every action.

**Impact**

Admin/Doctor users can be sent to a route guard or a server rejection after taking an action the UI presented as available. This creates dead ends and erodes trust in role-based navigation.

**Recommendation**

Derive action visibility and enabled state from actual role/permission capability, not page access alone. Keep read-only workflows clearly labelled. Add tests for Admin, Reception and Doctor variants.

---

### P1-7 — Mobile navigation is visually a drawer but not behaviorally modal

**Evidence**

`frontend/src/components/AppShell.tsx:701-715` conditionally renders a fixed overlay and sidebar, but supplies no dialog semantics, focus containment/initial focus, inert background, Escape handler or focus return. Existing tests only open it and find navigation controls.

**Impact**

Keyboard and screen-reader users can tab into obscured page content; Escape does not provide the expected dismissal; closing can lose focus context. Adding slide animation before fixing this would make the drawer look finished while remaining inaccessible.

**Recommendation**

Use the same native-dialog behavior as the shared Modal, or implement equivalent `role="dialog"`, accessible name, focus trap/initial focus, background inertness, Escape dismissal and opener focus restoration. Lock background scroll while open.

**Acceptance check**

At a mobile viewport, open/close using keyboard only; focus stays inside while open, Escape closes, and focus returns to **Open navigation menu**.

---

### P1-8 — LAN/offline and stale-data recovery is not explicit enough

**Evidence**

- The shared query defaults in `frontend/src/api/queries.ts:18-26` disable retries globally.
- The doctor queue polls every 10 seconds, but there is no persistent connection state, last-successful-sync indicator or stale/offline distinction.
- Several views expose a failure message without an inline retry; some manual refresh buttons replace their label but do not expose freshness.

**Impact**

On a hospital LAN, staff may not know whether a queue or ledger is current, stale or disconnected. Empty cached data and a failed refresh can be hard to distinguish.

**Recommendation**

Add a non-blocking offline/stale indicator, last-successful-update time for operational queues, and consistent retry actions. Preserve the last good data with a stale warning rather than replacing it with an empty state. Never auto-queue clinical or payment mutations for later submission.

## 3. Important P2 consistency and accessibility gaps

### P2-1 — Wide tables and small actions are weak on mobile and at display scaling

**Evidence**

- Patient, appointment, follow-up, dues, audit and backup views rely primarily on `overflow-x-auto`; several use minimum-width desktop tables.
- Patient row actions are explicitly `min-h-[36px]`; other queue/ledger actions use small padding and 12px labels.
- No persistent column priority, mobile row layout or sticky action/identity strategy is provided.

**Recommendation**

Define mobile representations rather than only horizontal scrolling: priority columns, wrapping identity metadata, expandable details or labelled row cards. Keep patient identity and the primary action visible. Target at least 44×44 CSS px for frequent touch actions. Verify at 320px width, 200% browser zoom and Windows 100/125/150% scaling.

### P2-2 — Typography, contrast and visual tokens remain inconsistent

**Evidence**

- Current source contains roughly 293 `text-xs` uses; at the current default 16px root these render at 12px, while the UI plan asks for body text not below 14px.
- On-screen sub-12px text remains in `TreatmentPlanWorkspace`, `PatientDetail`, `AppointmentsReception`, `BackupManagerPage` and `VasTrendChart` (including 9–10px SVG labels).
- `frontend/src/test/guards/guards.test.ts:65-77` records capped, unresolved legibility violations; a passing ratchet prevents regressions but does not make those cases compliant.
- Neutral/slate/gray palettes, crimson/teal/purple action colors, mixed shadows/radii, and `h1`/`h2` page-heading conventions vary by workspace. Dark-mode classes remain despite light-only scope.

**Recommendation**

Create shared screen tokens for page titles, body/secondary text, labels, status badges, buttons, cards, tables and alerts. Remove unused dark variants during component consolidation. Prioritize clinical notes, allergy warnings, financial values, form help and chart labels—not just decorative headings.

### P2-3 — Validation is mostly form-level rather than field-level

**Evidence**

Registration, prescription and encounter forms use top-level banners plus native `required`; custom errors do not consistently set `aria-invalid`, associate messages via `aria-describedby`, or focus/scroll to the failing field. Prescription medication-line errors identify an item number but do not move to that input.

**Recommendation**

Introduce a shared field/error pattern, preserve all entered values, focus the first invalid control, and provide a concise error summary for long forms. Keep server messages persistent until resolved. Avoid adding shake animation.

### P2-4 — Loading, error and result announcements are inconsistent

**Evidence**

Examples lacking the stronger patterns used elsewhere include `PatientTimeline` loading/error text without `role="status"`/`role="alert"`, similar plain states in Doctor Dashboard, Appointments and Pending Dues, and containers without consistent `aria-busy`. Error detail and retry availability vary by screen.

**Recommendation**

Standardize asynchronous states: stable container, textual status, `aria-busy` where appropriate, polite loading announcements, assertive actionable errors, and specific empty/search-empty states. Avoid announcing every polling refresh or repeatedly reading a whole queue.

### P2-5 — Tabs and patient search need complete keyboard interaction models

**Evidence**

- Patient, appointment and backup views use `role="tab"`/`tablist`, but do not implement the expected arrow-key navigation/roving `tabIndex` pattern consistently.
- Appointment patient search is an input plus a div of result buttons, with no combobox/listbox relationship, arrow-key selection, active descendant, or explicit no-results state (`AppointmentBookingModal.tsx:142-170`).
- Search there also queries on each input change, unlike the directory’s debounce.

**Recommendation**

Implement the WAI-ARIA keyboard patterns, or use simpler native controls where full tab/combobox behavior is unnecessary. Debounce patient search, announce result counts, provide no-results/error states, and support Enter/Escape and arrow navigation.

### P2-6 — Timeline and chart semantics need improvement

**Evidence**

- `PatientTimeline` uses decorative emoji without `aria-hidden`, generic div-based history items, hover-only elevation, and inconsistent async semantics.
- `VasTrendChart.tsx:40-44` provides an SVG without an accessible name/description; its small axis labels are difficult to read. The session records contain the underlying values, but there is no explicit chart summary or data-table association.

**Recommendation**

Hide decorative icons, use a semantic list with time elements, and provide actionable links to underlying records where authorized. Give the chart a concise accessible name and trend summary plus a labelled data-table alternative. Never rely on color alone for improvement/deterioration.

### P2-7 — Queue updates and mutation feedback need per-item clarity

**Evidence**

Appointment status changes use one shared pending flag, disabling actions across rows without identifying the row being changed. The Doctor Dashboard polls, but offers no last-updated text or concise changed-patient announcement. Several save buttons disable without an inline progress indicator.

**Recommendation**

Track pending action by appointment/patient ID, preserve token order during background refreshes, announce a concise status change, and show “last updated” plus manual refresh. Keep success messages visible long enough to review; do not use transient toast-only confirmation for clinical saves or payments.

### P2-8 — Dashboards still contain navigation duplication rather than role-specific work

**Evidence**

- Reception home provides generic readiness copy and links, but no today’s registration/queue/dues summary.
- Admin home ends with a full **Administration Modules** card grid duplicating destinations already present in the primary sidebar (`AreaHome.tsx:544-640`).
- The actual Doctor route correctly uses `DoctorDashboard`; the generic doctor identity block in `AreaHome` is not the active Doctor landing route and should not be treated as the current queue UI.

**Recommendation**

Make Reception operational: today’s arrivals, waiting count, follow-ups, dues and primary actions. Retain high-value Admin alerts/metrics and either remove the repeated module grid or make it a clearly secondary, searchable directory.

### P2-9 — Error-page recovery is not context aware

**Evidence**

`frontend/src/pages/StatusPages.tsx` sends both 403 and 404 users back to Sign in rather than their role home or previous safe page, even when they remain authenticated.

**Recommendation**

Offer role-home and back actions, preserve the current session, and distinguish insufficient permission from a nonexistent route without exposing sensitive resource details.

## 4. P3 enhancements worth considering

1. **Global patient/action search:** the UI plan specifies Ctrl+K search by URN/name/mobile, but no global command search exists. Add only after patient-list and combobox behavior are solid; include role-filtered actions and strong patient identity in results.
2. **Return context:** preserve patient-tab, filters and scroll position when returning from encounter, prescription, payment or print workflows.
3. **Progressive disclosure:** advanced admin/audit filters and secondary patient metadata can collapse on narrow screens, with explicit expanded state and result counts.
4. **Icon consistency:** replace mixed emoji and ad-hoc SVGs with one local icon set and accessible labels; do not make this a prerequisite for fixing interaction defects.
5. **Density preference:** after the base responsive layout works, consider comfortable/compact table density for desktop reception and administration. Do not solve density by shrinking clinical text below readable sizes.

## 5. Animation opportunities (functional, restrained)

| ID | Opportunity | Recommended treatment | Value and cautions |
|---|---|---|---|
| **A1** | Shared dialog enter/exit | 120–180ms opacity plus very small scale/translate; native `<dialog>`/backdrop transitions with correct exit lifecycle | Makes overlays feel connected to their trigger. Preserve focus trap, Escape/busy rules and focus return; no motion on irreversible warning icons. |
| **A2** | Mobile drawer/backdrop | 180–220ms transform for panel and opacity for backdrop; immediate close on selection when appropriate | Highest visual-motion opportunity, but implement **after P1-7** focus/inert/Escape behavior. |
| **A3** | Loading and refresh transitions | Stable-size skeleton or existing-content dimming, then a short content fade; no layout jump | Improves perceived stability. Use static placeholders under reduced motion; avoid indefinite shimmer and repeated polling flicker. |
| **A4** | Save/payment/registration success | 120–160ms banner entrance and a single checkmark transition | Reinforces completion. Keep textual confirmation and URN/receipt details persistent; animation alone must never indicate success. |
| **A5** | Queue/status changes | Brief 150–250ms row background/status-badge emphasis after a real update; per-item pending indicator | Helps staff notice arrival/consultation changes. Keep stable ordering, avoid flashing the whole list, and provide a concise live-region message. |
| **A6** | Timeline/history and disclosure changes | Subtle new-item highlight and short expand/collapse transition | Useful for addenda, timeline events, audit details and past encounters. Do not animate large clinical text blocks excessively or auto-scroll away from current work. |
| **A7** | Treatment progress | Animate the existing progress-bar width only after a confirmed session save; add proper progressbar semantics | The current 500ms transition is a reasonable base. Keep numeric text, honor reduced motion, and avoid animated clinical scores/count-up effects. |
| **A8** | Backup/restore/payment progress | Spinner plus truthful stage/elapsed-time text; determinate progress only if the server supplies it | Long tasks need reassurance, not fake percentages. Preserve busy dismissal policies and show a durable final result. |
| **A9** | Validation and error appearance | Immediate border/message change with a short opacity transition | Directs attention without motion sickness. **Do not shake forms**, pulse allergy warnings, or animate destructive confirmation buttons. |
| **A10** | Hover/focus/pressed states | Continue short color/border transitions; add a consistent pressed state where useful | Low-cost polish after shared button tokens exist. Focus must remain immediately visible and cannot wait for an animation. |

### Motion specification

- Use **opacity and transform**, not layout-changing width/height/top/left animation except the existing data-driven progress bar.
- Suggested easing: standard deceleration for entry, faster acceleration for exit; avoid bounce/spring effects in clinical workflows.
- Keep routine transitions around **120–220ms**; longer only for genuine progress, not decoration.
- No continuous background animation, parallax, animated sensitive values, auto-playing carousel, or celebratory clinical effects.
- The existing `frontend/src/index.css:14-23` reduced-motion rule is a good baseline. New JavaScript-driven motion must also query `prefers-reduced-motion`; reduced mode should remove spatial movement and nonessential fades while preserving instant state changes.
- A new animation dependency is **not currently justified**. Native CSS plus the existing React state is sufficient for these cases; reassess only if complex coordinated gestures become a real requirement.
- The existing Doctor queue pulse and login spinner are already covered by the global reduced-motion CSS; do not add more continuous indicators without a functional reason.

## 6. Verification gaps — not claimed as source defects

The Phase 18 manual record still lists real-Edge keyboard checks, NVDA announcements, long Hindi/English dialog layout, and 100/125/150% display scaling as not run. Physical-printer and printed-Devanagari checks were waived, not passed. These remain **verification gaps**, even where component tests and print-to-PDF checks are green.

Before sign-off, test with synthetic patients only:

1. Keyboard-only mobile drawer, tabs, comboboxes and all shared dialog variants in a real browser.
2. NVDA dialog titles, validation summaries, save/error/status messages, timeline and chart alternative.
3. 320px layout, 200% zoom and Windows 100/125/150% scaling for registration, encounters, patients, dues and backup tables.
4. Reduced-motion behavior for every new transition, including JavaScript-driven behavior and exit animations.
5. Long English/Hindi content, local Devanagari font rendering and physical A4 output on the actual hospital printer.
6. Offline/stale recovery and the guarantee that no clinical/payment mutation is silently replayed.

## 7. Recommended delivery order

1. **Clinical correctness and continuity:** P1-1 through P1-3; add regression tests for exact error copy, dirty navigation and partial photo success.
2. **Navigation and data reachability:** P1-4 through P1-7; cover all three roles and keyboard-only mobile use.
3. **Operational resilience:** P1-8 and per-item async feedback; test stale/offline states without automatic write replay.
4. **Responsive/accessibility consolidation:** tables, field errors, tabs/search, timeline/chart semantics, shared tokens and legibility.
5. **Functional motion:** A1/A2 first, then stable loading, save feedback and queue/progress emphasis—only after their underlying interactions pass keyboard and reduced-motion checks.
6. **Real-device acceptance:** NVDA, display scaling, Hindi rendering, physical printing and hospital-LAN interruption scenarios.

**Bottom line:** the strongest design improvement is a calmer, more predictable operational interface—not more motion. Fix misleading feedback, work preservation, navigation, pagination and keyboard behavior first; then use a small native-CSS motion vocabulary to clarify state changes.

