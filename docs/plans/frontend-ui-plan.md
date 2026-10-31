# Kalyan Hospital v3.0 — Frontend UI Plan

Status: proposal for review. Scope follows the v3.0 final plan (Rs 22,000 ceiling, offline LAN, FastAPI + PostgreSQL, one React + TypeScript app). Nothing here is client-approved until the scope is confirmed.

The v2.0 PySide6 desktop app is reference only: reuse its domain rules, the approved letterhead (SAMPLE.pdf) and its layout lessons, never its code.

## 1. Principles

- Clean and minimal: white/neutral surfaces, one restrained accent (crimson `#9E1B42`, from the approved letterhead), few steps for common tasks.
- Fast data entry for reception; calm, readable screens for doctors; nothing decorative.
- Required fields never pre-filled with guessed values (age, sex, doctor start empty; age 0 stays valid).
- The UI only hides what a role cannot do. FastAPI enforces every permission.
- Works with no internet: no CDN fonts, icons, scripts or analytics.
- Honest feedback: non-blocking toasts for success, inline errors for validation, errors stay visible until read. Modal confirmation only for destructive or financial actions (reversals, restore).

## 2. Stack (recommended)

| Need | Choice | Notes |
|---|---|---|
| Build | Vite + React + TypeScript (strict) | Static build served by the LAN server. |
| Components | Tailwind CSS + shadcn/ui (Radix) | Components are copied into the repo; no runtime UI-library licence concern; accessible focus and keyboard handling built in. |
| Routing | React Router | `/admin`, `/reception`, `/doctor`, role-guarded. |
| Server state | TanStack Query | Cache, refetch after writes, optimistic concurrency conflicts surfaced to the user. |
| Tables | TanStack Table | Server-side paging, search and filters (replaces the old 500-row cap). |
| Forms | React Hook Form + Zod | Same rules as the API; inline errors. |
| Icons | lucide-react | Bundled, no network. |
| i18n | react-i18next | English text, static Hindi labels; bundle Noto Sans Devanagari locally. |
| API contract | `openapi-typescript` generated from FastAPI's OpenAPI | Typed client; CI fails if the contract drifts. |
| Unit/UI tests | Vitest + Testing Library | |
| E2E / print | Playwright | Includes a check that A4 print pages stay on one sheet. |

Avoid: component libraries that need a licence for commercial use, CDN-loaded assets, heavy chart libraries (add Recharts only if a real report needs it).

## 3. App structure

```
frontend/
  src/
    app/            router, providers, role guards, error boundary
    api/            generated client + query hooks
    components/     shadcn/ui primitives + shared (DataTable, FormField, Toast, ConfirmDialog)
    features/
      auth/         login, idle-timeout, lockout messages
      patients/     registration form, search, profile, photo capture
      appointments/ daily list per doctor, tokens, status
      clinical/     encounters, notes + addenda, prescriptions, plans, sessions, timeline
      billing/      fees, payments, receipts, reversals, pending dues
      admin/        users, clinic settings, doctors, fees, audit viewer, backup/restore
      print/        registration card, receipt, prescription layouts
    styles/         design tokens (CSS variables), print.css
  public/fonts/     Noto Sans Devanagari (local)
```

## 4. Design tokens

Defined once as CSS variables and mapped into Tailwind.

- Accent crimson `#9E1B42`, dark ink `#7A1B3C`, doctor-name purple `#7131A0` (print only), success green, warning amber, danger red.
- Neutral background `#F5F7F5`, surface white, border `#DDE5DF`, text `#202B33` / secondary `#64736D`.
- Type scale 12 / 14 / 16 / 20 / 24; body never below 14px on screen (the audit flagged 9-10px text).
- Spacing 4-px grid; radius 8; one shadow level.
- Visible focus ring on every interactive element (2px accent, offset).
- Dark mode is out of scope.

## 5. Role dashboards

Shell: left sidebar (only items the role may use), top bar with global search (Ctrl+K: URN, name or mobile), clinic name, user menu, offline/LAN status.

**Reception (`/reception`)**
- Dashboard: today's registrations and appointments per doctor, pending dues, quick actions (Register patient, Find patient, Record payment).
- Register patient: photo left, Patient and Visit sections right; the 12 fields; duplicate warning (same name + mobile) before save; URN assigned by the server.
- Registry: server-paged table, filters (today, active therapy, pending balance, doctor), quick-view side panel, doctor column.
- Appointments: per-doctor daily list, token number, status (waiting / in consultation / done / cancelled), doctor assignment.
- Billing desk: fee entry, instalments, receipt print and reprint (`DUPLICATE`), pending-dues list.

**Doctor (`/doctor`)**
- My day: today's queue by token, patient timeline (encounters, sessions, payments in one chronological list).
- Encounter: notes with finalise (locks) and addendum; prescription builder (medicine, dosage, advice; English text, static Hindi labels); treatment plan and package; immutable session log with VAS 0-10 (number plus severity label, never colour alone).
- Doctors see their own patients by default; cross-doctor visibility follows the decision recorded in the decisions gate.

**Admin (`/admin`)**
- Users and roles, idle timeout, lockout status; clinic details, doctor profiles, fee lists.
- Audit viewer (append-only, filters by user, patient, action, date).
- Reversals (reason required), backup now, backup list with checksums, verified restore, integrity report.

## 6. Key interactions

- Global search: Ctrl+K opens a command palette (patients and actions), keyboard-first.
- Concurrency: edits send the record version; a conflict shows "changed by another user" with a reload action.
- Lists show "Showing X of Y"; never silently truncate.
- Money: integer paise on the wire, formatted as Rs with Indian grouping in the UI only; overpayment blocked client-side and server-side.
- Session expiry: warn before idle timeout; unsaved forms keep a local draft.

## 7. Patient photo (webcam)

- Use `navigator.mediaDevices.getUserMedia`, started only when staff click "Take photo"; release the stream on close.
- Flow: live preview, capture, retake, use photo; fallback "Upload photo"; clear messages for no camera, camera busy, permission denied.
- Crop to the 35:45 passport ratio and cap at ~720px high before upload (JPEG ~0.88) so backups stay small.
- Browsers only allow camera access on `localhost` or HTTPS. The LAN server must serve HTTPS with a certificate trusted on each reception PC (for example a local CA created with mkcert). Decide this in the decisions gate; without it the webcam will not work on LAN PCs.

## 8. Printing

- Browser print with a dedicated `print.css`: `@page { size: A4; margin: 6mm }`, mm-based sizes, bundled Devanagari font, `print-color-adjust: exact`.
- Registration card matches the approved SAMPLE.pdf: crimson banner (logo, KALYAN HOSPITAL, PHYSIOTHERAPY DEPARTMENT), both doctors around the caduceus, ruled Name / Age-Sex / Date / Add. / Ref. strip, 12 fields with the 35 x 45 mm photo frame, payment boxes, dual signatures, crimson clinic-address footer. Must fit one page.
- Receipt: 80 mm thermal layout sized to content; sequential numbers; `DUPLICATE` watermark on reprints.
- Playwright print-to-PDF test asserts one page for registration and prescription with a photo and long text.
- Final sign-off on the real hospital printer (owned by the printing/acceptance phase).

## 9. Accessibility and usability

- Full keyboard use with visible focus; logical Tab order; `Esc` closes dialogs; labels tied to inputs.
- Contrast of AA or better for text and controls; status never conveyed by colour alone.
- Target sizes 40px or larger for primary actions; test at 100%, 125% and 150% display scaling.

## 10. Testing and workflow

- CI: type-check, lint, Vitest, generated-client drift check, Playwright smoke (login per role, register patient, record payment, print one page).
- Component-level visual checks against screenshots of each state (normal, hover, focus, disabled, error).
- Design handoff: optional Figma file for the registration form, dashboard and card print; tokens above are the source of truth. No extra connector is required to build this.

## 11. Mapping to delivery priorities

1. Foundation, auth, permissions: app shell, role routes and guards, login, idle timeout, lockout, design tokens, generated API client.
2. Clinic settings, doctors, registration: admin settings screens, registration form, photo capture, registry, print spike.
3. Appointments and clinical: appointment lists, encounters, notes/addenda, prescriptions, plans, sessions, timeline.
4. Billing: payments, receipts and reprints, reversals, pending dues.
5. Audit, backup, integrity: audit viewer, backup and restore screens, integrity report.
6. LAN deployment and acceptance: HTTPS and certificate on client PCs, real-printer sign-off, accessibility and scaling pass, acceptance tests.

## 12. Open decisions

- HTTPS approach for LAN camera access (local CA vs self-signed per PC).
- Whether doctors can see each other's clinical notes, and whether reception sees clinical text.
- Department names for the two doctors (placeholders used in the desktop reference).
- Whether the registration card keeps the Patient / Attendant signature line (the v2.0 client-approved layout keeps both).
- Appointment slots vs token-only queue.
