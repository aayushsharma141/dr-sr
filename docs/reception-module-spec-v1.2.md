# Reception Module Specification v1.2

**Project:** Kalyan Hospital — Centralized Offline LAN Platform  
**Specification Date:** 2026-11-06  
**Status:** Frozen Baseline Specification (Reconciles payment permissions, finalizes token monotonicity, incorporates Epson A4 hardware profile, and separates engineering refinements from client operational policies).  
**Predecessor:** Supersedes [Reception Module Specification v1.1](reception-module-spec-v1.1.md).

---

## 1. Confirmed Architectural & Operating Decisions

1. **All-Specialty Intake & OPD Routing:** Reception supports intake, registration, and OPD routing across all configured hospital departments and specialties. Full IPD/bed management, pharmacy, laboratory, inventory, insurance, and specialty-specific clinical modules remain excluded unless separately scoped and approved (with the approved exception of Physiotherapy and Ophthalmology consultation templates in Phase 19 under D-19-01).
2. **Independent Doctor Queue Model:** Each doctor maintains an independent daily queue and token sequence. Token uniqueness is strictly scoped to `(doctor_id, appointment_date)`.
3. **Queue Token Monotonicity & Permanent Consumption (ADR-26):**
   - Tokens are positive integers allocated strictly monotonically ($1, 2, 3...$) per `(doctor_id, appointment_date)`.
   - **No Reuse or Backfill:** Once assigned, a token number is permanently consumed. If an appointment is subsequently marked `CANCELLED` or `NO_SHOW`, the token number is never backfilled, recycled, or reassigned to another patient.
   - **Queue Gaps:** Gaps in the active waiting queue are expected, audited, and preserved in appointment history.
4. **Strict Separation of Duties for Payment Ownership (D-06, ADR-23, PRD REC-04):**
   - **Reception:** Sole role authorized to collect and post payments (`payment:create`). Posts ledger transactions and prints receipts. Cannot reverse payments.
   - **Admin:** Authorized to inspect ledger records (`payment:read`), reverse payments (`payment:reverse`) with mandatory justification, and reprint receipts (`receipt:reprint`). **Admin cannot collect or post payments**; API calls to `POST /api/billing/payments` by an Admin return HTTP 403 Forbidden.
   - **Doctor:** Strictly zero billing write access. Cannot record, edit, or reverse payments (`payment:create: False`, `payment:reverse: False`).
5. **Patient Identity & Master Index:** One permanent hospital-wide URN is shared across all departments. Visits, appointments, clinical encounters, and payments remain separate linked child records. Pre-registration search by URN, name, or mobile phone must display possible duplicates before a new record is created.
6. **Physical Printer Profile (OD-06 Resolved):**
   - Hardware: Standard Epson A4 desktop printer on plain A4 sheet paper.
   - Thermal receipt paper (80mm) is not used.
   - All print documents (Patient Registration Card, OPD Payment Receipt, Doctor Prescription Slip) are formatted for A4 portrait with 12 mm margins, 100% scale (no fit-to-page distortion), and zero blank second pages. Duplicate receipts must display an indelible `DUPLICATE` watermark.

---

## 2. Authoritative Role Permission Matrix

| Capability | Admin | Reception | Doctor | Implementation Status |
|---|---|---|---|---|
| Configure Departments & Specialties | **Yes** | No | No | Implemented (PR #17) |
| Assign Doctors to Departments | **Yes** | No | No | Implemented (PR #17) |
| List Inactive Doctors (`include_inactive=true`) | **Yes** | No (Active only) | No (Active only) | Implemented (PR #17) |
| Register New Patient & Allocate URN | **Yes** | **Yes** | No | Implemented |
| Search Patient Directory | **Yes** | **Yes** | Yes (Assigned) | Implemented |
| Edit Patient Demographics | **Yes** | **Yes** (Audited) | Limited / Pending | Implemented |
| Book Appointment (Department & Doctor) | **Yes** | **Yes** | No | Implemented (PR #17) |
| Check In / Mark Arrived | **Yes** | **Yes** | No | Implemented |
| Cancel Appointment (with Reason) | **Yes** | **Yes** | No | Implemented |
| Record / Post Payment (`payment:create`) | **No (HTTP 403)** | **Yes (Exclusive)** | **No (HTTP 403)** | Implemented (PR #17) |
| Reverse Payment with Reason (`payment:reverse`) | **Yes (Exclusive)** | **No (HTTP 403)** | **No (HTTP 403)** | Implemented |
| View Financial Ledger / Receipts | **Yes** | **Yes** | No | Implemented |
| Author Clinical Consultation / Rx Notes | No | No | **Yes (Assigned)** | Implemented (Doctor WS) |
| Real-time Queue Polling (10s interval) | No | **Yes (10s poll)** | **Yes (10s poll)** | Implemented (`feature/reception-refinements`) |
| Persistent LAN Heartbeat / Connectivity Status | **Yes** | **Yes** | **Yes** | Implemented in `AppShell` (`feature/reception-refinements`) |
| Walk-in Quick Intake (Immediate Check-in) | **Yes** | **Yes** | No | Implemented in `AppointmentBookingModal` (`feature/reception-refinements`) |

---

## 3. End-to-End Reception OPD Workflow

```
1. PATIENT INTAKE & LOOKUP
   ├── Search by URN, Full Name, or 10-digit Mobile Number.
   ├── If existing: Verify demographics, view past visits & outstanding dues.
   └── If new: Deduplication preview -> Create Patient record -> Allocate sequential URN.

2. DEPARTMENT & DOCTOR SELECTION (Cascaded)
   ├── Reception selects target Department/Specialty (e.g., General Medicine, Ophthalmology).
   └── Doctor dropdown dynamically filters to active doctors assigned to that department.
       Server rejects bookings if doctor does not belong to the selected department (HTTP 422).

3. APPOINTMENT CREATION & QUEUE ENTRY
   ├── Reception chooses appointment date (defaults to today for walk-ins).
   ├── System atomically generates the next monotonic token number for (doctor_id, appointment_date).
   └── Appointment created in BOOKED state.

4. CHECK-IN / ARRIVAL
   ├── When patient arrives at the clinic desk, Reception marks status as ARRIVED.
   └── Patient enters the doctor's active waiting queue in ascending token order.

5. PAYMENT POSTING & RECEIPT PRINTING
   ├── Reception creates payment transaction with payment mode (Cash, UPI, Card).
   ├── Payment transaction is append-only; balance updates automatically from ledger.
   └── Reception prints A4 OPD Payment Receipt on the standard Epson printer.

6. DOCTOR CONSULTATION & STATUS TRACKING
   ├── Doctor sees arrived patient in their workspace queue.
   ├── Doctor transitions status: ARRIVED -> IN_CONSULTATION -> DONE.
   └── Reception observes operational status updates on the queue board without clinical write access.
```

---

## 4. Required Queue States & Transition Rules

Allowed queue states:
- `BOOKED`: Appointment created and token assigned; patient has not yet arrived at desk.
- `ARRIVED`: Patient checked in at reception desk; waiting in doctor's physical queue.
- `IN_CONSULTATION`: Patient is inside the consultation room with the assigned doctor.
- `DONE`: Consultation completed; clinical notes finalized.
- `CANCELLED`: Appointment cancelled prior to consultation. Requires mandatory reason. Token is burned and never reused.
- `NO_SHOW`: Patient did not report for consultation. Token is burned and never reused.

**Invariants:**
- Every status change must record an immutable audit event with actor ID, timestamp, prior state, new state, and reason (if cancelled).
- A patient cannot have duplicate active appointments (`BOOKED`, `ARRIVED`, `IN_CONSULTATION`) for the same doctor on the same date.

---

## 5. Department and Doctor Configuration Rules

1. **Administrator Management:** Departments/specialties are managed exclusively by `Role.ADMIN` (`/admin/departments`).
2. **Multi-Department Membership:** A doctor may belong to one or more configured departments. Every doctor must be assigned to at least one active department.
3. **Department Deactivation Semantics (ADR-24):** Deactivating a department does not delete existing doctor memberships. Inactive departments cannot receive new doctor assignments or new appointments. Existing historical appointments retain their department linkage.
4. **Inactive Doctor Scoping (ADR-25):** Inactive or retired doctors are visible only to Admins requesting `include_inactive=true`. Receptionists and Doctors always receive active doctors only.

---

## 6. Open Operational Policies Requiring Client Confirmation

The following policies require on-site client operational sign-off:

1. **Controlled Doctor Transfers:** When a patient needs to be transferred between doctors (intra-department or cross-department) on the same day:
   - Does Reception cancel the first appointment and issue a new token in the second doctor's queue?
   - Or can a doctor initiate a direct referral/transfer that preserves the patient's arrival priority?
2. **Walk-in vs. Pre-Booked Interleaving Priority:**
   - If pre-booked appointments exist alongside walk-in arrivals, should the doctor's queue strictly follow Token Number order, Arrival Time (`ARRIVED` timestamp), or an interleaved slot policy?
3. **Emergency Priority Handling:**
   - Client policy for emergency intake (e.g., immediate bypass to `IN_CONSULTATION` without a queue token, or priority flag on token).
4. **Initial Department Seed Catalogue:**
   - Formal sign-off on the active departments (e.g., General Medicine, Ophthalmology, Physiotherapy, Dental, ENT, Orthopedics) and doctor assignments.

---

## 7. Scope Boundaries & Release Criteria

- **In Scope for Reception Module:**
  - All-specialty patient registration, URN allocation, and deduplication.
  - Department catalog management and doctor-department association.
  - Cascaded appointment booking and check-in.
  - Monotonic daily token allocation per doctor.
  - Exclusive Reception payment collection and A4 receipt generation.
  - Admin financial reversal with mandatory justification.
- **Out of Scope (Deferred to Future Modules):**
  - Inpatient (IPD) bed allocation and ward nursing management.
  - Pharmacy point-of-sale and batch inventory management.
  - Diagnostic laboratory machine interfacing and sample barcoding.
  - Third-party insurance / TPA claim processing.
  - Specialty-specific clinical templates (except Physiotherapy and Ophthalmology approved under Phase 19).
