# UI Interactive Inventory: Reception

Audit date: 2026-11-09. Branch `refactor/admin-modules-ssot`. Read-only audit of files as they are on disk (uncommitted edits included).

**Method.** Code reading only. No tests or builds were run; every status below is "by code". Backend endpoints, permissions and transitions were traced in `backend/src/kalyan_api/routers/{billing,appointments,patients,departments,areas,timeline}.py`, `services/appointment_service.py`, `core/permissions.py` and `main.py`.

**Working-tree note.** `ReceptionBillingPage.tsx` has an uncommitted rework (`git diff`: fee-schedule service types and `rupeesToPaise` replace the hard-coded Rs 400/200/500 options). `AppointmentsReception.tsx`, `PatientDetail.tsx`, `PatientsDirectory.tsx`, `PatientRegister.tsx`, `PendingDuesPage.tsx`, `TokenGenerationPage.tsx`, `api/queries.ts` and `routers/areas.py` are also modified and uncommitted. The audit covers the files as they are on disk now. None of them looks half-edited: callers and callees are consistent.

**Shared hook facts used below** (`frontend/src/api/queries.ts`):
- `queryClient` defaults: `staleTime` is 60 s, `retry` is false (L107-114). No reception query sets `refetchInterval`. Only `useDoctorQueue` polls (L823).
- `useRegisterPatient` (L679) invalidates `['patients']` only.
- `useUpdatePatient` (L723) sets `['patient',id]` and invalidates `['patients']`.
- `useUploadPatientPhoto` (L738) invalidates `['patient',id]` and `['patients']`.
- `useBookAppointment` (L788) invalidates `['appointments']` and `['doctor-queue']`.
- `useUpdateAppointmentStatus` (L803) sets `['appointment',id]` and invalidates `['appointments']` and `['doctor-queue']`.
- `useRecordPayment` (L1246) invalidates `['payments']`, `['billing','pending-dues']`, `['treatment-plans']` (no query uses this key) and `['timeline',patient_id]`.
- `useReversePayment` (L1263) invalidates `['payments']`, `['billing']`, `['treatment-plans']` and `['timeline']`.
- **No reception mutation invalidates `['overview','reception']`**, and `useRecordPayment` does not invalidate `['billing','ledger',...]`.

Status legend: **W** = working by code; **P** = partial; **B** = broken; **PH** = placeholder; **D** = dead (not reachable or not wired).

---

## 1. ReceptionDashboard (`pages/ReceptionDashboard.tsx`; rendered by `AreaHome` at `/reception`, RECEPTION only)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Refresh icon | `handleManualRefresh` L80 | `useAppointments`, `useOverview('reception')` refetch | GET /appointments?appointment_date, GET /reception/overview | - | sets lastUpdated | none (refetch errors silent) | no (spin only) | W |
| "+ New Patient" link | L236 | - | - | - | nav /reception/patients/new | - | - | W |
| "Generate Token" link | L244 | - | - | - | nav /reception/tokens | - | - | W |
| "Counter Checkout" link | L252 | - | - | - | nav /reception/billing | - | - | W |
| Error banner dismiss | L265 | - | - | - | - | - | - | W |
| KPI Registrations | L278 | - | - | - | filter ALL | - | - | W (value from overview, stale, see F-07) |
| KPI Waiting / In Cabin / Completed | L299/L323/L347 | - | - | - | set status filter | - | - | W |
| KPI Dues Pending | L373 | - | - | - | nav /reception/billing?tab=dues | - | - | W (stale value) |
| KPI Collection | L391 | - | - | - | nav /reception/billing?tab=ledger | - | - | **B** for RECEPTION: target tab gets 403 (F-02). Also nets gross minus reversals (F-15) |
| Needs-attention "View" (delayed) | L426 | - | - | - | onlyDelayed filter | - | - | W |
| Needs-attention "Review" (dues) | L447 | - | - | - | nav billing?tab=dues | - | - | W |
| Needs-attention "Filter" (booked) | L464 | - | - | - | BOOKED filter | - | - | W |
| Doctor filter select | L503 | `useDoctors(false)` | GET /doctors?include_inactive=true | - | - | - | - | W (lists inactive doctors too) |
| Status tabs All/Waiting/In Cabin/Completed/Booked | L534 | - | - | - | client filter | - | - | W (no tab for CANCELLED/NO_SHOW) |
| "Delayed Only" chip | L558 | - | - | - | clears filter | - | - | W |
| Queue search box + clear | L572/L581 | - | - | - | client filter (name/URN/mobile/token) | - | - | W |
| Patient name link | L643 | - | - | - | nav /reception/patients/:id | - | - | W |
| "Check In" (BOOKED) | `handleCheckIn` L152 | `useUpdateAppointmentStatus` | PATCH /appointments/{id}/status {ARRIVED, version_id} | - | invalidates appointments and doctor-queue; **not** overview (doctor-workload cards stale, F-07) | page banner L262 shows err.message | yes (global isPending) | P |
| "Billing →" (DONE) | L736 | - | - | - | nav /reception/billing?patient_id&appointment_id | - | - | **P**: `appointment_id` is ignored by the billing page (F-05) |
| Print icon → token-slip modal | L747 | - | - | - | opens modal | - | - | P |
| Cancel (X) icon | L758 | - | - | - | opens cancel modal | - | - | W |
| Doctor workload card (div onClick) | L807 | - | - | - | doctor filter | - | - | W (not keyboard-operable; department text wrong, F-11) |
| Cancel modal: preset reason chips | L986 | - | - | - | fill reason | - | - | W |
| Cancel modal: reason textarea | L995 | - | - | `required` + trim check | - | - | - | W |
| Cancel modal: "Keep Appointment" | L1009 | - | - | - | close | - | no | W |
| Cancel modal: "Confirm Cancellation" | `handleConfirmCancel` L172 | `useUpdateAppointmentStatus` | PATCH status {CANCELLED, cancellation_reason} | reason non-blank | closes modal | error goes to the page banner **behind the open modal** (inert `<dialog>`), so nothing is visible in the modal (F-13) | yes | P |
| Token slip modal: "Close" | L1071 | - | - | - | close | - | - | W |
| Token slip modal: "Print Slip" | L1078 `window.print()` | - | - | - | - | - | - | **B**: Modal has no `print` prop, so the app page prints, not a slip; hard-coded "Physiotherapy Department" and `P-` prefix (F-11) |

## 2. PatientRegister (`pages/PatientRegister.tsx`, `/reception/patients/new`, RECEPTION only)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| "Visit & Token Desk" / "Patient Records" links | L309/L316 | - | - | - | nav | - | - | W |
| Quick-success "Dismiss" | L337 | - | - | - | - | - | - | W |
| Success card "View Patient File & Card" | L387 | - | - | - | nav /reception/patients/:id | - | - | W |
| Success card "Print Registration Card" | L392 | - | - | - | nav .../print | - | - | W |
| Success card "Register Another Patient" | L400 | - | - | - | resets state | - | - | W |
| Duplicate confirm checkbox | L431 | `useCheckDuplicate` L113 | GET /patients/check-duplicate | name ≥2, mobile ≥10 (debounced 300 ms) | - | - | - | W |
| Photo box (div role=button) + hidden file input | L476/L483, `handlePhotoSelect` L141 | - | - | `accept` attr only; **no size/type check** | FileReader data: URL preview | none | - | **P**: preview is a `data:` URL, blocked by the server CSP `default-src 'self'` (F-09) |
| Photo "Remove" | `handleRemovePhoto` L153 | - | - | - | - | - | - | W |
| Patient Name | L533 | - | - | `required` | - | - | - | W |
| Age | L553 | - | - | `required`, min 0, max 150; JS check L194 | - | formError | - | W |
| Sex radios | L573/L585 | - | - | - | - | - | - | **P**: only M/F; backend accepts `O` (`schemas/patients.py` L42) (F-12) |
| Mobile | L612 | - | - | `required` only (no 10-digit pattern; backend enforces `^[0-9+ -]{10,15}$`) | - | server message | - | P |
| Address | L641 | - | - | `required` | - | - | - | W |
| Guardian / DOB / District / State / Emergency / Allergies / Notes | L677-L774 | - | - | district/state/allergies `required`; DOB auto-fills age L122 | - | - | - | W |
| Department select | L804 | `useDepartments` | GET /departments (active only, backend L48) | label says `*` but not required | resets doctor | - | - | P |
| Doctor select | L835 | `useDepartmentDoctors` | GET /departments/{id}/doctors (active only) | label says `*` but not required | - | - | - | P |
| Visit type Walk-in / Appointment | L858/L869 | - | - | - | - | - | - | P: "Appointment" books today only (F-17) |
| Reason for visit | L891 | - | - | - | sent as appointment notes; also copied into patient notes when notes are blank (L219) | - | - | W |
| QueueTicketPreview | L914 | - | - | - | display only | - | - | PH (static preview; keeps the previous patient's token after "Save and add another", L266 plus `handleClear`) |
| "Save and add another" checkbox | L933 | - | - | - | - | - | - | W |
| "Clear" | `handleClear` L162 | - | - | - | resets (does not clear the file input value or `allocatedToken`) | - | - | P |
| "Save Registration" (submit) | `handleSubmit` L189 | `useRegisterPatient`, then `useUploadPatientPhoto`, `useBookAppointment`, `useUpdateAppointmentStatus` | POST /patients, then POST /patients/{id}/photo, POST /appointments, PATCH /appointments/{id}/status | age, duplicate confirmation | patients list invalidated; success card or quick notice | registration error goes to formError. **Photo, booking and check-in errors are swallowed with console.warn** (L233, L261) (F-03) | **only while POST /patients is pending**; re-enabled during the photo, booking and status calls (F-04) | **P** |

## 3. PatientsDirectory (`pages/PatientsDirectory.tsx`, `/reception/patients`, ADMIN/RECEPTION/DOCTOR)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| "+ Register New Patient" link (also in the empty state) | L60/L149 | - | - | - | nav (route is RECEPTION only; ADMIN/DOCTOR get bounced by the guard) | - | - | P |
| Success banner dismiss | L74 | - | - | - | - | - | - | W |
| Search box (debounced 300 ms) + Clear | L91/L106 | `usePatients(q)` (limit 20, offset 0) | GET /patients?q&limit=20&offset=0 | - | - | isError alert L125 | - | W |
| Pagination | **absent** | - | - | - | only the 20 newest patients are ever listed without a search (F-16) | - | - | missing |
| Row photo img | L182 | - | GET /patients/{id}/photo (PHOTO_READ: RECEPTION only) | - | - | hidden onError | - | P (blank for ADMIN/DOCTOR) |
| "View Card" | L219 | - | - | - | nav /reception/patients/:id | - | - | W |
| "Edit" | `handleEditClick` L33 → PatientEditModal | `useUpdatePatient` | PATCH /patients/{id} | see §5 | `refetch()` plus banner | in the modal | in the modal | P: shown to ADMIN/DOCTOR, who lack `patient:update`, so they get 403 (F-14) |

## 4. PatientDetail (`pages/PatientDetail.tsx`, `/reception/patients/:id`, ADMIN/RECEPTION/DOCTOR)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| "Back to Patient Records" link | L127 | - | - | - | nav | - | - | W |
| "Edit Demographics" | L141 | `useUpdatePatient` (modal) | PATCH /patients/{id} | see §5 | banner plus `refetch()` | modal | modal | P (shown to ADMIN/DOCTOR → 403, F-14) |
| "Print Card" link | L146 | - | - | - | nav .../print | - | - | W |
| Success banner dismiss | L162 | - | - | - | - | - | - | W |
| Tabs Profile/Appointments/Consultations/Treatment Plans/Payments/Change History | L207 `setActiveTab` | `usePatientTimeline` (inside PatientTimeline) | GET /patients/{id}/timeline (whole timeline, filtered client side) | - | - | PatientTimeline error | - | **B (scope)**: the payload carries clinical or payment events the role must not see (F-01). Tab state is not in the URL, so reload returns to Profile |
| Change History "Refresh" | L37 | `useAuditLogs` | GET /audit-logs?entity_type=patient | - | - | alert L24 | - | W (ADMIN only) |
| PaymentHistory card | L424 → §11 | | | | | | | W |

## 5. PatientEditModal (`components/PatientEditModal.tsx`)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| All 12 fields | L154-L321 | - | - | `required` on name, guardian, age (0-150), mobile, address, district, state, allergies; JS age check L93 | - | errorMsg | - | W (no mobile pattern client side) |
| "Save Demographic Changes" | `handleSubmit` L88 | `useUpdatePatient` | PATCH /patients/{id} {version_id,...} | as above | onSuccess then onClose | 409 / `version_conflict` → ConflictBanner; else err.message | yes (`isPending` or `isConflict`) | W |
| ConflictBanner "Reload latest" | `handleReload` L62 | raw `apiFetch` | GET /patients/{id} | - | refills the form and version; does not update the query cache | "Failed to reload..." | yes (`isReloading`) | W |
| "Cancel" / ✕ / Esc | L327 | - | - | - | close | - | Esc and ✕ blocked while busy | W |
| Note | `useEffect` L42 resets every field whenever the `patient` prop identity changes, so a background refetch that returns changed data wipes in-progress edits without warning | | | | | | | P |

## 6. PatientCardPrint (`pages/PatientCardPrint.tsx`) and RegistrationCard (`components/RegistrationCard.tsx`)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Error state "Back to Patient Directory" | PatientCardPrint L28 | - | - | - | nav | - | - | W |
| Card "Close" | RegistrationCard L72 → onClose | - | - | - | nav /reception/patients/:id | - | - | W |
| "Print Card (A4)" | RegistrationCard L82 `window.print()` | `usePatient`, `useClinicSettings` | GET /patients/{id}, GET /settings | - | - | - | - | W (prints the page; controls are `print:hidden`). Doctor checkboxes are hard-coded to two names (L160-161) |
| Non-numeric `:id` | PatientCardPrint L10 | `usePatient(null)` stays disabled, so `isPending` stays true | - | - | spinner "Loading patient card..." forever | none | - | P |

## 7. AppointmentsReception (`pages/AppointmentsReception.tsx`, `/reception/appointments`, ADMIN/RECEPTION/DOCTOR)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Tabs Today's Queue / Follow-ups | `selectTab` L188 (URL `?tab`) | - | - | Follow-ups only with `prescription:read` | - | - | - | W |
| Follow-ups "Refresh" | L70 | `usePrescriptionFollowUps` | GET /prescriptions/follow-ups | - | - | alert L102 | - | W (doctor only) |
| Follow-up window chips | L79 | same | same with date_from/date_to | - | - | - | - | W (uses browser-local date, not `istToday`) |
| Follow-up "Open patient" / name links | L147/L162 | - | - | - | nav | - | - | W |
| "New Patient Registration" / "Issue Queue Token" links | L377/L384/L497/L504 | - | - | - | nav (RECEPTION-only routes; also shown to DOCTOR because the doctor has `appointment:write`) | - | - | P |
| Date ← / → / date input / "Today" | L407/L413/L421/L428 | `useAppointments` | GET /appointments?appointment_date&doctor_id | - | - | error text L491 | - | W (buttons lack `type`, harmless outside a form) |
| Doctor filter | L440 | `useDoctors(false)` | GET /doctors?include_inactive=true | - | - | - | - | W |
| Patient link | L536 | - | - | - | nav | - | - | W |
| "Mark Arrived" | `handleUpdateStatus` L221 | `useUpdateAppointmentStatus` | PATCH status ARRIVED | - | invalidates appointments and doctor-queue | **ConflictBanner with fixed text "Record was modified by another user"**; the real message is discarded (F-13) | yes | P |
| "Cancel" → modal | L577 | - | - | - | - | - | **no** | W |
| "No-Show" | L583 `handleUpdateStatus(appt,'NO_SHOW')` | same | PATCH status NO_SHOW (terminal) | **no confirmation** | - | ConflictBanner (fixed text) | **no** | P (F-13) |
| "Reception Billing →" (DONE) | L596 | - | - | - | nav /reception/billing?patient_id (no appointment_id) | - | - | P (F-05) |
| Cancel modal "Close" / "Confirm Cancellation" | L643 / L655 | same | PATCH status CANCELLED + reason | reason non-blank | closes modal | banner rendered behind the open modal (inert) | yes | P |

## 8. TokenGenerationPage (`pages/TokenGenerationPage.tsx`, `/reception/tokens`, RECEPTION only)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Header links | L189/L196 | - | - | - | nav | - | - | W |
| Success card "Open Today's Token Queue" / "Register Next Patient" | L239/L246 | - | - | - | nav / reset | - | - | W |
| Mode "Existing Patient" / "New Patient" | L282 / L293 | - | - | - | "New" navigates to /reception/patients/new | - | - | W |
| Patient search + clear | L306/L315 | `usePatients(q,8,0)` | GET /patients?q&limit=8 | dropdown shown at ≥2 chars | - | none (error shows "No matching patients") | - | P |
| Result row select | L332 | - | - | - | sets patient | - | - | W |
| "View Profile" | L386 | - | - | - | nav | - | - | W |
| Department select | L422 | `useDepartments` | GET /departments | JS check L120 | resets doctor | errorMsg | - | W |
| Doctor select | L453 | `useDepartmentDoctors` | GET /departments/{id}/doctors | JS check L124 | - | errorMsg | - | W |
| Visit type Walk-in / Appointment | L476/L487 | - | - | - | - | - | - | P ("Appointment" means BOOKED today, F-17) |
| **Consultation / Service select** | L509 `setSelectedServiceId` | `useFees(true)` | GET /fees | - | **value never used**. Hard-coded "OPD Consultation - ₹400.00" option. Banner "Consultation charge will be added to the visit billing" is false (F-10) | - | - | **PH** |
| Remarks | L538 | - | - | - | sent as appointment notes | - | - | W |
| Token Preview | L561 | `useAppointments({today, doctor_id?})` | GET /appointments | - | `nextTokenNum = list.length+1`; counts all doctors when none is selected | - | - | PH (indicative only) |
| "View Waiting Queue" | L578 | - | - | - | nav | - | - | W |
| "Clear" | `handleClear` L103 | - | - | - | reset | - | - | W |
| "Generate Token & Register Visit" | `handleGenerateToken` L114 | `useBookAppointment`, then `useUpdateAppointmentStatus` (walk-in) | POST /appointments, then PATCH status ARRIVED | patient, department, doctor | success card; **form stays filled and the button re-enables** (F-04) | booking error goes to errorMsg; **check-in failure swallowed** (L147) (F-03) | only while booking is pending | **P** |

## 9. ReceptionBillingPage (`pages/ReceptionBillingPage.tsx`, `/reception/billing`, ADMIN/RECEPTION)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Header links | L242/L249 | - | - | - | nav | - | - | W |
| Tabs Checkout / Today's Receipts / Pending Dues | `handleTabChange` L76 (sets `?tab`, **drops `patient_id`**) | - | - | - | - | - | - | P (tab state is not re-synced on browser back) |
| Success card "Print Receipt Slip (A4 / Thermal)" | L339 | - | (no reprint endpoint) | - | opens ReceiptDialog `isReprint` | - | - | P (first print is stamped DUPLICATE; no audit, F-08) |
| Success card "Checkout Next Patient" | `handleResetCheckout` L180 | - | - | - | **re-selects the URL patient** via the effect at L102 (F-06) | - | - | **B** when opened with `?patient_id` |
| Patient search + clear | L381/L390 | `usePatients(q,8,0)` | GET /patients | ≥2 chars | - | none | - | P |
| Result row | L407 | - | - | - | select | - | - | W |
| Selected patient "Change" | L448 | - | - | - | **re-selected immediately when `?patient_id` is present** (F-06) | - | - | **B** (URL entry) / W otherwise |
| Service Type select | `handleServiceChange` L109 | `useFees(true)`, `useDoctors(false)` | GET /fees, GET /doctors?include_inactive=true | - | fills amount | - | - | W (uncommitted rework) |
| Consulting Doctor select | `handleDoctorChange` L129 | - | - | - | fills amount only; **doctor is not sent with the payment** | - | - | P |
| Amount | L528 | - | - | `required`, min 1; `rupeesToPaise` regex L56 | - | formError | - | W |
| Payment mode CASH/UPI/CARD | L566 | - | - | - | - | - | - | W |
| Remarks | L586 | - | - | - | notes (falls back to service label) | - | - | W |
| "Collect ₹X & Issue Receipt" (submit) | `handleCollectPayment` L141 | `useRecordPayment` | POST /payments {patient_id, amount_paise, payment_method, notes}: **no appointment_id, no treatment_plan_id** | patient, amount | sets recordedPayment and dispatches `PAYMENT_RECORDED_EVENT` (ReceiptHost opens the receipt). **Form not cleared; button stays enabled** (F-04). Ledger and overview not invalidated (F-07) | formError | yes, only while in flight | **P** |
| Ledger search / status filter | L642/L650 | `useLedger` (called unconditionally at L196) | GET /billing/ledger. **Requires `payment:reverse` (ADMIN only)**, so RECEPTION gets 403 (F-02) | - | - | **none**: shows "No payment receipts found" | - | **B** for RECEPTION; W for ADMIN |
| Ledger row "Print" | L715 | - | - | - | ReceiptDialog `isReprint` | - | - | P (unaudited, F-08) |
| Dues search | L756 | `usePendingDues` | GET /billing/pending-dues | - | client filter | **none** (isError ignored; shows "No active packages") | - | P |
| Dues "Collect Payment" | L810 → PaymentModal | `useRecordPayment` | POST /payments {treatment_plan_id} | see §12 | sets recordedPayment (success card appears only on the Checkout tab) plus receipt | in the modal | in the modal | W for RECEPTION; **B for ADMIN** (403, F-14) |

## 10. PendingDuesPage (`pages/PendingDuesPage.tsx`, `/reception/dues`, ADMIN/RECEPTION)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Search | L59 | `usePendingDues` | GET /billing/pending-dues | - | client filter | "Failed to load..." L74 | - | W |
| "Collect Payment" | `handleCollect` L14 → PaymentModal | `useRecordPayment` | POST /payments {treatment_plan_id} | see §12 | dues invalidated; ReceiptHost receipt | modal | modal | W for RECEPTION; **B for ADMIN** (403, F-14) |

## 11. PaymentHistory / ReceiptDialog / ReceiptHost / ReceiptPrint

| Component | Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|---|
| PaymentHistory | "Reprint" (non-reversed rows) | L68 | `usePatientPayments` | GET /patients/{id}/payments (render only); reprint uses the cached object | - | opens ReceiptDialog `isReprint` | "Could not load payments" | - | P: never calls `GET /payments/{id}/receipt`, so no RECEIPT_REPRINTED audit (F-08) |
| ReceiptDialog | "Print receipt (A4)" | L32 `window.print()` | `useClinicSettings` | GET /settings | - | print portal `receipt` page | - | - | W |
| ReceiptDialog | ✕ / Esc | Modal | - | - | - | close | - | - | W |
| ReceiptHost | window listener | L57 | - | - | - | opens ReceiptDialog for each `kalyan:payment-recorded` event | - | - | W |
| ReceiptPrint | display only | - | - | - | - | DUPLICATE stamp when `isReprint`; REVERSED banner when `is_reversed` | - | - | W |

## 12. PaymentModal (`components/PaymentModal.tsx`; used by billing dues tab and PendingDuesPage)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Amount | L110 | - | - | `required`, min 0.01, `parseFloat > 0` L50; no client overpayment check (server returns 422 `overpayment_rejected`, billing.py L135-146) | - | errorMsg shows the server message | - | W |
| Method CASH/UPI/CARD | L130 | - | - | - | - | - | - | W |
| Notes | L151 | - | - | - | - | - | - | W |
| "Collect & Issue Receipt" | `handleSubmit` L46 | `useRecordPayment` | POST /payments | as above | onSuccess, dispatch event, close | role=alert | yes | W |
| "Cancel" / ✕ | L170 | - | - | - | close | - | yes | W |

## 13. PaymentReversalModal (`components/PaymentReversalModal.tsx`; used only by admin `BillingAdminPage`, not reachable from reception pages)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Reason textarea | L82 | - | - | `required`, ≥5 chars trimmed L37 | - | errorMsg | - | W |
| "Confirm Reversal" | `handleSubmit` L31 | `useReversePayment` | POST /payments/{id}/reverse (`payment:reverse`) | as above | invalidates payments, billing, timeline | role=alert | yes | W (reason state is not reset between payments) |
| "Cancel" | L106 | - | - | - | close (`dismiss="none"`) | - | yes | W |

## 14. AppointmentBookingModal (`components/AppointmentBookingModal.tsx`; used only by doctor `ClinicalEncounterWorkspace` L1465, not by any reception page)

| Element | Handler | Hook | Endpoint | Client validation | onSuccess / nav | Error display | Disabled while pending | Status |
|---|---|---|---|---|---|---|---|---|
| Patient search / result / "Change" | L151/L164/L143 | `usePatients(q,5,0)` | GET /patients | - | - | none | - | W |
| Department / doctor selects | L188/L210 | `useDepartments`, `useDepartmentDoctors` | GET /departments, /departments/{id}/doctors | `required` + JS checks | - | errorMsg | - | W |
| Date | L235 | - | - | `required`; **no minimum date** (backend has no past-date check either, `schemas/appointments.py`) | - | - | - | P |
| "Confirm & Allocate Token" | `handleSubmit` L43 | `useBookAppointment` | POST /appointments | patient, department, doctor | sets token, then calls `onSuccess`; the caller unmounts the modal at once, so the "Token #" confirmation is never seen | errorMsg | yes | P |
| "Done" / "Cancel" | L115/L262 | - | - | - | close | - | - | W |

## 15. PhotoUploader / QueueTicketPreview / ConflictBanner / InlineAlert / Modal

| Component | Element | Status |
|---|---|---|
| PhotoUploader (`components/PhotoUploader.tsx`) | "Take photo", file input, "Remove photo", Capture/Retake/"Use this photo"/Cancel | **D**: not imported by any page (grep). Its MIME/5 MB validation, webcam capture, HTTPS explanation and CSP-safe canvas preview are therefore missing from registration (F-09) |
| QueueTicketPreview | none (display only) | W (defaults `tokenNumber=14`, prefix `P`) |
| ConflictBanner | "Reload latest" → `onReload` | W (default message is fixed; callers that omit `message` hide the real error, F-13) |
| InlineAlert | dismiss ✕ | W (not used by any reception page) |
| Modal | ✕ / Esc / backdrop (`dismiss`), `busy` guard, `print` portal | W |

---

## Findings

Severity follows the task rubric. Line numbers refer to the files on disk at audit time.

### F-01 [P0, defect]: The patient timeline sends clinical and payment events to roles that must not see them, and PatientDetail renders them
- **Where.** `frontend/src/pages/PatientDetail.tsx` L197-414 and `components/PatientTimeline.tsx` L34-36: the whole timeline is fetched and filtered on the client.
- **Backend source.** `backend/src/kalyan_api/routers/timeline.py`:
  - L96-101 and L143-147: ADMIN gets ENCOUNTER (diagnosis and symptoms, L115-119) and PRESCRIPTION (medicine names and dosages, L163-167) with scope `true()`.
  - L216-221: RECEPTION gets TREATMENT_SESSION (VAS and modalities, L236-238) with scope `true()`, although RECEPTION lacks `session_log:read` (`core/permissions.py` L129-147).
  - L268-290: PAYMENT events go to every role, DOCTOR included, although DOCTOR lacks `payment:read`.
- **Conflicting rule.** `11-ENTRY-GATE.md` EG-7 (LOCKED): "Admin UI screens remain strictly denied direct clinical record viewing". PROJECT D-04: Reception and Admin are denied clinical views.
- **Tests enshrine it.** `backend/tests/test_timeline_api.py` L179-183 asserts that ADMIN receives ENCOUNTER and PRESCRIPTION.
- **Repro.** Log in as ADMIN, open `/reception/patients/<id>` for a patient with a finalised encounter, then open the Appointments tab and inspect the network response.

### F-02 [P2, defect]: The "Today's Receipts" ledger always returns 403 for RECEPTION, and the page shows a false empty state
- **Cause.** `ReceptionBillingPage.tsx` L196 calls `useLedger` unconditionally. `GET /billing/ledger` is gated on `Permission.PAYMENT_REVERSE` (`routers/billing.py` L330-333), which RECEPTION lacks (`core/permissions.py` L129-147). `backend/tests/support/matrix.py` L1575-1585 even asserts reception=403.
- **Symptom.** The page ignores the error (L664-667) and shows "No payment receipts found matching filter." The dashboard Collection KPI (`ReceptionDashboard.tsx` L391) sends the user to this tab.
- **Test gap.** `pages/__tests__/reception-billing.test.tsx` L162 mocks the ledger as 200 for a RECEPTION user.

### F-03 [P1, defect]: Registration and Token Desk report success when the photo upload, booking or walk-in check-in failed
- **Registration.** `PatientRegister.tsx` L227-236 and L240-264 catch the photo, booking and status-update errors and only `console.warn`. The success card then shows "Registration Successful". If booking worked but the ARRIVED update failed, it shows "Checked In (Arrived)" (L378) while the row stays BOOKED.
- **Token Desk.** `TokenGenerationPage.tsx` L139-149 does the same for check-in, and the success text says the patient "is placed in ... queue".
- **Consequence.** A photo over 5 MB (`photo_service.py` L24) is silently dropped. A walk-in left in BOOKED is not in the doctor's waiting list, and reception has no signal to fix it.

### F-04 [P1, defect]: Duplicate-submit holes create duplicate patients, tokens and payments
- **PatientRegister.** The submit button is disabled only by `registerMutation.isPending` (L955). After POST /patients resolves, the photo, booking and status awaits run with the button re-enabled and the form still filled (`createdPatient` is set at L275, at the end). The duplicate warning does not fire for the patient just created: `useRegisterPatient` invalidates `['patients']` only, and the `['check-duplicate']` result is cached for 5 s. A second click therefore registers a second URN for the same person (AGENTS invariant 1).
- **TokenGenerationPage.** After success the form keeps the patient, department and doctor, and the button stays enabled (L598). The backend has no same-day duplicate check (`routers/appointments.py` L74-165), so a second click mints another token.
- **ReceptionBillingPage.** After a successful payment, patient and amount stay filled and the "Collect" button stays enabled (L613). OPD payments have no balance cap or idempotency (`billing.py` L102-146 checks only plans), so a second click posts a second receipt for the same money. The only fix is an admin reversal.

### F-05 [P2, defect]: The billing checkout drops the appointment link the API supports and the dashboard supplies
- **Dashboard side.** `ReceptionDashboard.tsx` L737 passes `appointment_id`.
- **Billing side.** `ReceptionBillingPage.tsx` reads only `patient_id` (L68), and the POST body (L161-166) has no `appointment_id`. The backend accepts it and validates it (`billing.py` L148-155, L172).
- **Consequence.** Consultation payments are never linked to the visit. `areas.py` department collections then report them as "Not linked to a department" (L169-170, L652). AppointmentsReception's billing link (L597) does not pass it either.

### F-06 [P1, defect]: With `?patient_id` in the URL, "Change" and "Checkout Next Patient" cannot clear the patient
- **Cause.** `ReceptionBillingPage.tsx` L102-106 runs `if (preloadedPatient && !selectedPatient) setSelectedPatient(preloadedPatient)` whenever `selectedPatient` becomes null. Both "Change" (L448) and `handleResetCheckout` (L180) set it to null, so the URL patient is re-selected at once.
- **Repro.** Dashboard → "Billing →" for a DONE appointment. Collect a payment, click "Checkout Next Patient", and the same patient and the Collect button are back. Combined with F-04, this invites a duplicate charge to the previous patient.

### F-07 [P2, defect]: Reception counters and lists go stale after mutations, and the "live" labels are false
- **No overview invalidation.** No reception mutation invalidates `['overview','reception']` (`queries.ts` L679-817, L1246-1278). Registrations, Dues Pending, Collection, Hourly Collections and Doctor Workload (`overview.doctors_today`, `ReceptionDashboard.tsx` L791) stay stale. Doctor Workload stays stale even after a Check In on the same screen.
- **No ledger invalidation.** `useRecordPayment` does not invalidate `['billing','ledger',...]`. `['treatment-plans']` is a key no query uses.
- **No polling.** The comment at L46 and the header text "10s live queue sync" (L224) claim polling, but neither `useAppointments` nor `useOverview` sets `refetchInterval`. Reception sees doctors' IN_CONSULTATION/DONE changes only after a manual refresh, a window refocus or a remount after `staleTime`.

### F-08 [P2, defect]: Receipt reprints are never audited
- **Cause.** Every reprint (`PaymentHistory.tsx` L68, `ReceptionBillingPage.tsx` L339 and L717) renders ReceiptDialog from cached data. Nothing in the frontend calls `GET /payments/{id}/receipt` (grep finds no `/receipt` path). That endpoint is the one that writes the RECEIPT_REPRINTED audit row (`billing.py` L202-235, BIL-04).
- **Side effect.** The post-payment "Print Receipt Slip" is also stamped DUPLICATE on the patient's first copy, if they close the auto-opened original.

### F-09 [P2, defect / missing_feature]: The registration photo flow regressed: CSP-blocked preview, no validation, no photo after registration
- **Blocked preview.** `PatientRegister.tsx` L145-149 previews through a FileReader `data:` URL. The server CSP is `default-src 'self'` (`main.py` L58-60), which blocks `data:` images, so the preview is blank on :8000 (it works under Vite).
- **Dead component.** `PhotoUploader.tsx` is unused (grep). It held the CSP-safe canvas preview, the type and size validation and the UX-07 HTTPS explanation.
- **No later upload.** No reception screen can add or replace a photo after registration: PatientEditModal has no photo field (PAT-05).

### F-10 [P2, defect (placeholder) / spec_conflict]: The Token Desk "Consultation / Service" field and its billing promise are fake
- **Cause.** `TokenGenerationPage.tsx` L43 and L509-528: `selectedServiceId` is never read. The hard-coded "OPD Consultation - ₹400.00" is not a real fee. The banner "Consultation charge will be added to the visit billing" is false: no charge entity exists, and REC-05 (auto-generated consultation charge) is Deferred (`REQUIREMENTS.md` L97, L208).
- **AGENTS invariants.** Invariants 2, 3, 8 and 9 (visit container, multiple consultations per visit, charges accumulating in a visit, invoice with several payments) cannot be met by the appointment-centred model. Payments are standalone rows with optional `appointment_id`/`treatment_plan_id` (`billing.py` L163-176). This part is a spec_conflict, not a resolution.

### F-11 [P2, defect]: The dashboard hard-codes Physiotherapy in a multi-department hospital, and token-slip printing prints the dashboard
- **Hard-coded department.** `ReceptionDashboard.tsx` L664 shows "Physiotherapy" for every queue row. L1039 prints "Physiotherapy Department" with a `P-` prefix (L1044). The workload department label comes from `areas.py` L287 `department=qualification or "Physiotherapy"`.
- **Print.** The slip Modal (L1029) lacks `print`, so `window.print()` (L1078) prints `#root`. `index.css` L135 hides the app only when a `.print-portal` exists.
- **Inconsistency.** QueueTicketPreview derives the prefix from the department initial (`TokenGenerationPage.tsx` L93-96), so the same token prints differently from different screens.

### F-12 [P2, defect]: Registration offers no "Other" gender
- `PatientRegister.tsx` L573-595 has only M and F radios. The type (L50), the backend (`schemas/patients.py` L42 `^[MFO]$`) and the edit modal (L194) all support `O`, so such a patient has to be registered wrong and then edited.

### F-13 [P2, defect]: Appointment status errors are hidden or mislabelled, and No-Show is a one-click terminal action
- **Real message dropped.** `AppointmentsReception.tsx` L307-313 renders `ConflictBanner` without `message`. Every failure (422 `invalid_status_transition`, 403, network) shows "Record was modified by another user", and `conflictError` is never displayed.
- **Hidden behind modals.** When the cancel modal is open, both this page and `ReceptionDashboard.tsx` L262 render the error in the page behind an inert `<dialog>`, so the user sees nothing.
- **No-Show.** "No-Show" (L583) has no confirmation and is not disabled while pending, although NO_SHOW is terminal (`appointment_service.py` L26).

### F-14 [P3, defect]: Buttons are shown to roles the backend will refuse
- **Collect Payment for ADMIN.** ADMIN can open `/reception/billing` and `/reception/dues` (`router.tsx` L197-209) and sees the "Collect" form and "Collect Payment" buttons. The backend correctly returns 403 (ADMIN lacks `payment:create`, D-06), so this is not a security hole, but the UI invites a forbidden action.
- **Edit for ADMIN/DOCTOR.** "Edit" and "Edit Demographics" (`PatientsDirectory.tsx` L224, `PatientDetail.tsx` L139) are shown to ADMIN and DOCTOR, who lack `patient:update`.
- **Reception-only links for DOCTOR.** The doctor sees reception-only links on AppointmentsReception.

### F-15 [P2, defect]: The dashboard "Collection / Net payments today" applies a netting rule the backend explicitly does not define
- **Cause.** `ReceptionDashboard.tsx` L196-198 computes `max(0, gross - reversed)`. `areas.py` L79-86 documents that `gross_paise` counts payments created today, while `reversed_paise` counts reversals made today of any day's payments, "without applying any netting rule".
- **Consequences.** Reversing an earlier day's receipt lowers today's figure, and the clamp hides negatives. `formatPaise` (L23-26) also truncates the paise.

### F-16 [P2, missing_feature]: The patient directory has no pagination
- `PatientsDirectory.tsx` L31 calls `usePatients(debouncedQuery)` with limit 20 and offset 0, and no control changes the offset. Without a search, only the 20 newest patients are reachable. The backend supports `offset` (`patients.py` L148-178).

### F-17 [P2, missing_feature, low confidence]: Reception cannot book a future-dated appointment
- **Cause.** PatientRegister (L246) and TokenGenerationPage (L134) always send `istToday()`, and their "Appointment" toggle only skips check-in. The dated booking form (AppointmentBookingModal) is mounted only in the doctor workspace.
- **Uncertainty.** APT-01 does not state that future dates are required.

### F-18 [P3, test_gap]: The reception flows that fail above have no tests
- The billing test mocks the ledger as 200 for RECEPTION.
- No test covers double submit on register, token or checkout.
- No test covers the swallowed photo, booking or check-in failures.
- No test covers billing with `?patient_id` followed by Change or Reset.
- No test covers that reprints call the audited endpoint.
