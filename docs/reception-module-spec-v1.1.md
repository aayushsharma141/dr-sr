# Reception Module Specification v1.1

> **Note (2026-11-06):** This specification has been frozen and updated to **[Reception Module Specification v1.2](reception-module-spec-v1.2.md)**, which reconciles payment permissions, finalizes queue token monotonicity (ADR-26), and incorporates the confirmed Epson A4 printer profile (OD-06).

**Project:** Kalyan Hospital — centralized offline LAN platform  
**Decision date:** 2026-11-04  
**Status:** User-confirmed operating decisions; detailed client operational policies remain open.

## Confirmed decisions

1. **Patient coverage:** Reception supports intake and OPD routing across all configured hospital departments and specialties. This does not imply delivery of full IPD, pharmacy, laboratory, inventory or specialty-specific clinical modules.
2. **Queue model:** Each doctor has an independent daily queue and token sequence. Token uniqueness is scoped to `(doctor_id, appointment_date)`.
3. **Payment ownership:** Reception is the only role that can create/post payment transactions. Admin can read and perform explicitly authorized financial reversals; admin cannot collect/post payments. Doctors cannot create, edit or reverse payments.
4. **Patient identity:** One permanent hospital-wide URN is shared across departments. Visits, appointments, clinical encounters and payments remain separate linked records.

## Reception workflow

1. Search by URN, name or mobile; show possible duplicates before creating a patient.
2. Register a new patient or select an existing patient.
3. Select department/specialty and an active doctor belonging to it.
4. Create a booked appointment or register a walk-in.
5. On arrival, check in and allocate a token in the selected doctor's queue.
6. Reception records applicable payment and prints the receipt.
7. Doctor sees the patient in their own queue and records clinical work in the doctor workspace.
8. Doctor updates consultation status; reception sees operational status but cannot edit clinical notes.

## Required queue states

`BOOKED`, `ARRIVED`, `IN_CONSULTATION`, `DONE`, `CANCELLED`, `NO_SHOW`.

Queue events must retain timestamps and actor attribution. Prevent duplicate active queue entries for the same visit. Doctor queue visibility remains doctor-scoped unless separately approved.

## Department and doctor configuration

- Departments/specialties are administrator-managed configuration records.
- Doctors must be associated with one or more configured departments/specialties.
- Reception selects department first; doctor choices are filtered to active doctors in that department.
- Assignment and transfer must be validated server-side; frontend filtering is not authorization.
- Preserve historical department/doctor assignment on existing visits when configuration changes.

## Payment rules

- Only `RECEPTION` receives `payment:create`.
- `ADMIN` retains payment read and authorized reversal permissions but not payment creation.
- `DOCTOR` has no payment-write permission.
- Posted transactions are append-only; corrections use an authorized compensating reversal with a mandatory reason.
- Balances are computed from the ledger; no manually editable balance field.

## Acceptance tests

- Register and route patients to doctors in multiple configured specialties.
- Same patient visits multiple departments without duplicate patient records.
- Department selection restricts doctor choices to active matching doctors.
- Doctor queues and token sequences remain independent and unique under concurrent bookings.
- Walk-in and booked appointments enter the queue only once after check-in.
- Reception can post a valid payment; Admin and Doctor receive 403 on payment creation.
- Admin can reverse only with authorization and reason; original transaction remains visible.
- Reception cannot read or edit clinical notes.
- LAN outage does not report unsaved operations as successful.

## Operational policies still requiring client confirmation

- Department list and each doctor's department membership.
- Emergency priority and walk-in ordering.
- Token reset policy and handling of cancelled/no-show tokens.
- Doctor transfer and cancellation authority.
- Which visit types are enabled in the first deployment.
- Receipt numbering cycle and actual printer models.

## Scope boundary

All-specialty intake and routing is in the reception scope. Full IPD/bed management, pharmacy, laboratory, inventory, insurance and specialty-specific clinical forms remain excluded unless separately priced and approved. Exception, decided 2026-11-05: the Physiotherapy and Ophthalmology consultation templates are included in Phase 19 within the existing budget (D-19-01 in `.planning/phases/19-universal-consultation-workspace/19-CONTEXT.md`). Forms for any other specialty stay excluded.
