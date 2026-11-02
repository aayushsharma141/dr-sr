# Kalyan Hospital — Hybrid Appointment & Token Workflow

**Status:** Approved direction; implementation in progress  
**Date:** 2026-11-02  
**Branch:** `feat/hybrid-appointment-workflow`

## Decision

Adopt a hybrid model with two separate operational flows:

1. **Walk-in / same-day token queue** — keep the current fast reception workflow. A token is allocated atomically when a walk-in is booked for the clinic's current IST date.
2. **Scheduled visit by date** — book a patient, doctor, visit type and future date. Do not allocate a daily token at booking. Allocate the token when reception marks the patient arrived on the booked date.

A prescription follow-up date is a clinical reminder, not an appointment. A physiotherapy visit is a visit category and must not create a treatment session or consume a treatment-plan session until the clinician records the actual session.

## Critical scope decision: no fake time slots

The current application has no configured doctor working hours, shift templates, appointment durations or resource calendars. Therefore the first iteration must **not** show invented 15/30-minute slots or claim a time is available.

Scheduled visits are date-based in this iteration. UI wording must say **"Scheduled for [date] · no fixed time · token assigned at check-in"**. Fixed-time scheduling is a later phase that requires approved doctor working hours, durations and capacity rules.

This is a deliberate scope boundary, not a permanent limitation.

## Evidence from current repository

- `Appointment` stores `appointment_date` and a non-null `token_number`; there is no start/end time, duration or doctor-hours model.
- `book_appointment()` calls the daily token generator for every appointment, including future-dated bookings.
- The appointment form does not receive the queue's selected doctor/date.
- The patient search hook runs on an empty string; the backend consequently returns recent patients. The picker does not request active-only results.
- Current visit/clinical state is recorded separately by Encounters and TreatmentPlan/TreatmentSession services. Booking a physiotherapy visit must not insert a TreatmentSession.

## Target workflow

### A. Walk-in / same-day token

1. Open **Add Walk-in Token**.
2. Search an active patient by URN, name or mobile (no results before at least two characters).
3. Select visit type: New Consultation, Follow-up Review, or Physiotherapy Visit.
4. Keep the currently selected doctor.
5. Date is locked to the current Asia/Kolkata date.
6. Confirm; backend validates the patient and doctor, checks duplicate active booking, allocates a daily token atomically, and records an audit event.
7. Show a confirmation with token and doctor.

### B. Future scheduled visit

1. Open **Schedule Future Visit**.
2. Search/select an active patient.
3. Select visit type and doctor.
4. Select a future clinic date.
5. Show a clear no-fixed-time disclosure.
6. Confirm; backend validates the date, persists booking mode and visit type, checks for an active duplicate, but does **not** allocate a token.
7. On the booked date, reception selects **Mark Arrived**. The backend rejects early check-in and allocates the per-doctor daily token in the same transaction as the status change.
8. Doctor queue sees the scheduled patient only after check-in/token allocation.

### C. Follow-up reminder

Prescription follow-up date remains separate. It can guide reception/doctor to create a scheduled visit, but it does not silently create an appointment, reserve capacity or allocate a token.

### D. Physiotherapy visit

Booking a physiotherapy visit is an administrative visit record. It does not create a treatment session, increment plan completion or modify clinical notes. The actual session is logged through the existing clinician-controlled treatment workflow.

## Data contract

Add to `appointments`:
- `booking_mode`: `WALK_IN` or `SCHEDULED`
- `visit_type`: `NEW_CONSULTATION`, `FOLLOW_UP`, `PHYSIOTHERAPY_SESSION`, or `REVIEW`
- Make `token_number` nullable until check-in for scheduled visits.

Existing rows are backfilled as `WALK_IN`; existing tokens remain unchanged. Legacy visit types are backfilled as `UNSPECIFIED` so the migration does not infer clinical intent.

The public API returns `booking_mode`, `visit_type` and nullable `token_number`. Query filters support booking mode and a date range.

## Invariants

- All clinic-day comparisons use Asia/Kolkata, not UTC calendar dates or the browser's local offset.
- A walk-in must be booked for the current clinic date and receives its token during creation.
- A scheduled visit must be dated today or later and receives no token until check-in.
- A scheduled visit cannot be checked in before its appointment date.
- Duplicate active bookings for the same patient + doctor + date are rejected (terminal CANCELLED/NO_SHOW/DONE rows do not block a new booking).
- Patient and doctor must be active at creation time.
- Appointment status transitions and token assignment remain transactional and optimistic-lock protected.
- Booking, check-in/token allocation and rescheduling/cancellation are audited.
- Reception may book operational visits but does not gain access to prescription content, encounter notes or treatment-plan clinical details.
- No payment, consultation fee, integer-paise calculation or treatment-session behavior is changed.

## UI hierarchy

Appointments workspace:
- **Today's Queue** — walk-ins and scheduled patients who have checked in; doctor/date filters; token, patient, visit type, doctor, status and action.
- **Scheduled Visits** — upcoming date-based bookings; filter date range/doctor/status; no token displayed until check-in.
- **Prescription Follow-up Reminders** — doctor-only existing tab; reminder only, with explicit "Schedule visit" action to create a separate booking.

Booking panel:
- Mode choice first (Walk-in token / Schedule future visit).
- Patient search and identity confirmation.
- Visit type.
- Doctor.
- Date (locked today for walk-in; today or future for schedule).
- Administrative reception note (not clinical notes).
- Confirmation wording reflects whether token is assigned now or later.

## Implementation phases

1. **Schema/API safety:** additive Alembic migration, backward-compatible API, IST date rules, duplicate protection, active patient filtering, delayed scheduled token allocation.
2. **Booking UX:** mode-aware booking dialog, prefilled doctor/date, search threshold, keyboard-accessible results, clear confirmation.
3. **Appointments workspace:** scheduled-visit tab and range filters; show token only when allocated; check-in action.
4. **Regression coverage:** legacy walk-in behavior, scheduled no-token create, check-in allocation, early check-in rejection, duplicate, inactive patient, IST date boundary, role boundaries, frontend modal and scheduled list.
5. **Later fixed-time scheduling:** only after the hospital provides doctor weekly hours, leave/holiday rules, visit durations, buffer rules, overbooking policy and whether shared/group therapy sessions are allowed. Then add Schedule/Slot-like resources and conflict enforcement.

## Research basis

- HL7 FHIR Appointment: a booking of a healthcare event; a booking can lead to one or more Encounters. https://hl7.org/fhir/appointment.html
- HL7 FHIR Encounter: distinguishes planned activities from the actual activities delivered. https://fhir.hl7.org/fhir/encounter.html
- HL7 FHIR Slot: a time interval available for booking; slots can have capacity and different durations, but need an actual Schedule. https://fhir.hl7.org/fhir/slot.html
- ABDM FHIR R4 Appointment profile: India-specific implementation guide profile for healthcare appointments. https://www.nrces.in/ndhm/fhir/r4/StructureDefinition-Appointment.html
- AHRQ Strategy 6A: open-access scheduling balances same-day demand with necessary follow-up capacity; recommends measuring supply/demand and simplifying appointment categories. https://www.ahrq.gov/cahps/quality-improvement/improvement-guide/6-strategies-for-improving/access/strategy6a-openaccess.html

The first release is an operational scheduling workflow, not a claim of full FHIR/ABDM conformance. Any future ABDM exchange mapping must be validated against the deployed ABDM FHIR version/profile, including required appointment start/end semantics.

## Acceptance checklist

- Existing walk-in bookings continue to receive the same atomic per-doctor daily token sequence.
- Existing appointments retain their token numbers after migration.
- Future scheduled booking persists with token null.
- Scheduled check-in on the booked date receives the next daily token exactly once.
- Early check-in and back-dated walk-in booking are rejected with actionable validation errors.
- Same patient/doctor/date duplicate active bookings are rejected.
- Patient search does not query/show results until the operator has entered at least two characters, and the booking picker returns only active patients.
- Selected doctor/date from the board is carried into the booking workflow.
- Follow-up reminder does not silently create a booking.
- Physiotherapy visit booking does not increment completed treatment sessions.
- Existing role permissions and audit requirements are preserved.
- Full Python/Qt, Vitest, TypeScript, Oxlint and Vite build pass.
