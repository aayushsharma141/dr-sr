# Kalyan Hospital — API Route Inventory & Security Markers

Total Endpoints Audited: 100+ routes across 30 routers. All routes enforce explicit RBAC policies tested by `test_rbac_matrix.py` (724 test assertions) and guarded by `test_route_policies.py`.

## Core API Routes

| HTTP Method | Route Path | Handler / Service | Policy Marker | Purpose |
| --- | --- | --- | --- | --- |
| **Authentication & Sessions** | | | | |
| `POST` | `/api/auth/login` | `auth.login` | `public` | Session establishment with Argon2id password hash |
| `POST` | `/api/auth/logout` | `auth.logout` | `authenticated_only` | Invalidate active session cookie |
| `GET` | `/api/auth/me` | `auth.me` | `authenticated_only` | Current user profile, role, and permissions |
| `POST` | `/api/auth/change-password` | `auth.change_password` | `authenticated_only` | User password rotation with verification |
| `GET` | `/api/sessions` | `sessions.list_sessions` | `require("ADMIN")` | Active LAN sessions inventory |
| `DELETE` | `/api/sessions/{session_id}` | `sessions.revoke_session` | `require("ADMIN")` | Remote session termination |
| **System Setup & Health** | | | | |
| `GET` | `/api/setup/status` | `setup.get_status` | `public` | Inspect first-run bootstrap state |
| `POST` | `/api/setup/bootstrap` | `setup.bootstrap_admin` | `public` (Atomic console code) | One-time initial admin setup |
| `GET` | `/api/health` | `health.health_check` | `public` | Liveness and DB connection tracer |
| **Area Overviews** | | | | |
| `GET` | `/api/areas/reception/overview` | `areas.reception_overview` | `require("RECEPTIONIST", "ADMIN")` | Reception queue and appointments metrics |
| `GET` | `/api/areas/doctor/overview` | `areas.doctor_overview` | `require("DOCTOR", "ADMIN")` | Doctor daily queue and patient counters |
| `GET` | `/api/areas/admin/overview` | `areas.admin_overview` | `require("ADMIN")` | Executive hospital KPIs and integrity summary |
| **Patient Directory & Demographics** | | | | |
| `GET` | `/api/patients` | `patients.list_patients` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Patient search by URN, phone, or name |
| `POST` | `/api/patients` | `patients.create_patient` | `require("RECEPTIONIST", "ADMIN")` | Register new patient & allocate permanent URN |
| `GET` | `/api/patients/{id}` | `patients.get_patient` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Demographic and visit history |
| `PATCH` | `/api/patients/{id}` | `patients.update_patient` | `require("RECEPTIONIST", "ADMIN")` | Demographic edit with before/after audit log |
| `POST` | `/api/patients/{id}/photo` | `patients.upload_photo` | `require("RECEPTIONIST", "ADMIN")` | Upload access-controlled patient photo |
| `GET` | `/api/patients/{id}/photo` | `patients.get_photo` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Stream private patient photo |
| `GET` | `/api/patients/check-duplicate` | `patients.check_duplicate` | `require("RECEPTIONIST", "ADMIN")` | Duplicate detection by phone/name |
| **OPD Check-in, Appointments & Queue (Phase 22)** | | | | |
| `POST` | `/api/patients/checkin` | `patients.checkin_patient` | `require("RECEPTIONIST", "ADMIN")` | Single-step registration/lookup, visit, token & classification |
| `GET` | `/api/appointments` | `appointments.list_appointments` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Day-wise appointment schedule with tokens & priority |
| `POST` | `/api/appointments` | `appointments.create_appointment` | `require("RECEPTIONIST", "ADMIN")` | Book appointment & generate monotonic token |
| `PATCH` | `/api/appointments/{id}/status` | `appointments.update_status` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Queue state transition (Booked, Arrived, In-Consultation, Done, Cancelled, No-show) |
| `POST` | `/api/appointments/{id}/reschedule` | `appointments.reschedule` | `require("RECEPTIONIST", "ADMIN")` | Reschedule appointment date/doctor |
| `POST` | `/api/appointments/{id}/reassign` | `appointments.reassign_doctor` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Doctor-to-doctor transfer on the same visit |
| `POST` | `/api/appointments/{id}/emergency-alert` | `appointments.create_emergency_alert` | `require("RECEPTIONIST", "ADMIN")` | Trigger emergency alert on doctor workstation |
| `POST` | `/api/appointments/{id}/acknowledge-alert` | `appointments.acknowledge_alert` | `require("DOCTOR")` | Doctor acknowledgment of emergency with audit timestamp |
| **Visits & Checkout** | | | | |
| `GET` | `/api/visits/{id}` | `visits.get_visit` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Visit details, consultations, and bill summary |
| `POST` | `/api/visits/{id}/checkout` | `visits.checkout_visit` | `require("RECEPTIONIST", "ADMIN")` | Visit checkout (`Patient Out`) |
| `POST` | `/api/visits/{id}/close` | `visits.close_visit_with_balance` | `require("RECEPTIONIST", "ADMIN")` | Close visit with outstanding dues and mandatory justification |
| **Clinical Encounters & Specialty Templates** | | | | |
| `POST` | `/api/encounters` | `encounters.create_encounter` | `require("DOCTOR")` | Initiate clinical consultation draft |
| `GET` | `/api/encounters/{id}` | `encounters.get_encounter` | `require("DOCTOR", "ADMIN")` | Retrieve consultation encounter details |
| `PATCH` | `/api/encounters/{id}` | `encounters.update_encounter` | `require("DOCTOR")` | Auto-save consultation draft edits |
| `POST` | `/api/encounters/{id}/finalize` | `encounters.finalize_encounter` | `require("DOCTOR")` | Finalize & permanently lock medical record |
| `POST` | `/api/encounters/{id}/addenda` | `encounters.create_addendum` | `require("DOCTOR")` | Add dated addendum to finalized record |
| `POST` | `/api/encounters/{id}/vitals` | `vitals.record_vitals` | `require("DOCTOR")` | Save vitals (BP, Pulse, Temp, Weight, Height, BMI) |
| **Prescriptions & Rx Pad** | | | | |
| `POST` | `/api/prescriptions` | `prescriptions.create_prescription` | `require("DOCTOR")` | Create prescription for encounter |
| `GET` | `/api/prescriptions/{id}` | `prescriptions.get_prescription` | `require("DOCTOR", "ADMIN")` | Retrieve prescription items & advice |
| `GET` | `/api/patients/{id}/timeline` | `timeline.get_patient_timeline` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Chronological clinical & financial timeline |
| **Physiotherapy & Treatment Plans** | | | | |
| `GET` | `/api/treatments/plans` | `treatment_plans.list_plans` | `require("DOCTOR", "ADMIN")` | List treatment plans & package balances |
| `POST` | `/api/treatments/plans` | `treatment_plans.create_plan` | `require("DOCTOR")` | Prescribe rehab package and assign sessions |
| `POST` | `/api/treatments/sessions` | `treatment_sessions.log_session` | `require("DOCTOR")` | Log completed session with VAS and modalities (decrements balance) |
| **Billing, Fee Snapshots, Payments & Receipts** | | | | |
| `POST` | `/api/billing/invoices` | `billing.create_invoice` | `require("RECEPTIONIST", "ADMIN")` | Create invoice aggregating services |
| `GET` | `/api/visits/{id}/bill` | `bill_items.get_visit_bill` | `require("RECEPTIONIST", "ADMIN")` | 5-section itemized visit bill breakdown, active & voided lines, and totals |
| `POST` | `/api/visits/{id}/bill-items` | `bill_items.add_bill_line` | `require("RECEPTIONIST")` | Add itemized bill line (MEDICINE, ADDITIONAL) with quantity & rate |
| `POST` | `/api/bill-items/{id}/void` | `bill_items.void_bill_line` | `require("RECEPTIONIST")` | Reception void own same-day bill line with reason |
| `POST` | `/api/bill-items/{id}/correct` | `bill_items.correct_bill_line` | `require("RECEPTIONIST")` | Reception correct quantity/rate of own same-day bill line with reason |
| `POST` | `/api/bill-items/{id}/admin-void` | `bill_items.admin_void_bill_line` | `require("ADMIN")` | Admin void any active bill line on open visit with reason |
| `POST` | `/api/bill-items/{id}/admin-correct` | `bill_items.admin_correct_bill_line` | `require("ADMIN")` | Admin correct quantity/rate of any active bill line with reason |
| `GET` | `/api/visits/{id}/prescribed-medicines` | `bill_items.list_prescribed_medicines` | `require("RECEPTIONIST")` | Scoped reference list of authorised prescribed medicine names & forms |
| `POST` | `/api/appointments/{id}/bill-items` | `bill_items.add_doctor_line` | `require("DOCTOR")` | Doctor records procedure or links package reference during consultation |
| `GET` | `/api/appointments/{id}/bill-items` | `bill_items.get_doctor_charges` | `require("DOCTOR")` | Doctor reads own consultation charge and recorded doctor lines |
| `POST` | `/api/payments` | `billing.record_payment` | `require("RECEPTIONIST", "ADMIN")` | Record cash/UPI/card payment (accepts appointment_id or optional visit_id) and issue receipt |
| `GET` | `/api/payments/{id}/receipt` | `billing.get_receipt` | `require("RECEPTIONIST", "ADMIN")` | Retrieve receipt layout for printing |
| `POST` | `/api/payments/{id}/reverse` | `billing.reverse_payment` | `require("ADMIN")` | Authorized payment reversal with mandatory reason |
| `GET` | `/api/billing/dues` | `billing.list_pending_dues` | `require("RECEPTIONIST", "ADMIN")` | Outstanding balance ledger query |
| `GET` | `/api/reports/referrals` | `reports.get_referral_report` | `require("ADMIN")` | Admin-only referral analytics and patient count aggregation |
| **Admin Governance, Templates & Operations** | | | | |
| `GET` | `/api/admin/departments` | `departments.list_departments` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Hospital departments & specialty catalogue |
| `POST` | `/api/admin/departments` | `departments.create_department` | `require("ADMIN")` | Create department |
| `PATCH` | `/api/admin/departments/{id}` | `departments.update_department` | `require("ADMIN")` | Update department details / active status |
| `GET` | `/api/admin/doctors` | `doctors.list_doctors` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Active doctors, cabins, and fee rates |
| `PATCH` | `/api/admin/doctors/{id}` | `doctors.update_doctor` | `require("ADMIN")` | Update doctor profile, departments, or fees |
| `GET` | `/api/admin/templates` | `templates.list_templates` | `require("ADMIN")` | Bilingual print templates registry |
| `PUT` | `/api/admin/templates/{doc_type}` | `templates.update_template` | `require("ADMIN")` | Update template layout & translations |
| `POST` | `/api/admin/assets/upload` | `assets.upload_asset` | `require("ADMIN")` | Upload hospital logo or letterhead asset |
| `POST` | `/api/admin/patients/import` | `imports.import_patients` | `require("ADMIN")` | Staged CSV/XLSX demographic import pipeline |
| `POST` | `/api/admin/patients/export` | `exports.export_patients` | `require("ADMIN")` | Controlled demographic export with audit |
| `POST` | `/api/admin/backups` | `operations.create_backup` | `require("ADMIN")` | Snapshot database & file store to secondary drive |
| `POST` | `/api/admin/backups/restore` | `operations.restore_backup` | `require("ADMIN")` | Isolated staging database restoration |
| `GET` | `/api/admin/integrity` | `operations.check_integrity` | `require("ADMIN")` | System-wide relational & financial integrity report |
| `GET` | `/api/admin/audit` | `audit.list_logs` | `require("ADMIN")` | Query immutable security audit journal |
