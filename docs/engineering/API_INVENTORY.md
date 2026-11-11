# Kalyan Hospital — API Route Inventory & Security Markers

Total Endpoints Audited: 101 routes. All routes enforce explicit RBAC policies.

| HTTP Method | Route Path | Handler / Service | Policy Marker | Purpose |
|---|---|---|---|---|
| `POST` | `/api/auth/login` | `auth.login` | `public` | Session establishment with Argon2id |
| `POST` | `/api/auth/logout` | `auth.logout` | `authenticated_only` | Invalidate active session cookie |
| `GET` | `/api/auth/me` | `auth.me` | `authenticated_only` | Current user profile and role |
| `POST` | `/api/auth/change-password` | `auth.change_password` | `authenticated_only` | User password rotation |
| `GET` | `/api/areas/reception/overview` | `areas.reception_overview` | `require("RECEPTIONIST", "ADMIN")` | Reception queue and appointments metrics |
| `GET` | `/api/areas/doctor/overview` | `areas.doctor_overview` | `require("DOCTOR", "ADMIN")` | Doctor daily queue and patient counters |
| `GET` | `/api/areas/admin/overview` | `areas.admin_overview` | `require("ADMIN")` | Hospital executive KPIs and system health |
| `GET` | `/api/patients` | `patients.list_patients` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Patient search by URN, phone, name |
| `POST` | `/api/patients` | `patients.create_patient` | `require("RECEPTIONIST", "ADMIN")` | Register new patient & allocate URN |
| `GET` | `/api/patients/{id}` | `patients.get_patient` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Demographic and visit details |
| `GET` | `/api/appointments` | `appointments.list_appointments` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Day-wise appointment schedule |
| `POST` | `/api/appointments` | `appointments.create_appointment` | `require("RECEPTIONIST", "ADMIN")` | Book appointment & generate token |
| `PATCH` | `/api/appointments/{id}/status` | `appointments.update_status` | `require("RECEPTIONIST", "DOCTOR", "ADMIN")` | Queue state transition (Arrived, In-Consultation, Completed) |
| `POST` | `/api/encounters` | `encounters.create_encounter` | `require("DOCTOR")` | Initiate clinical consultation |
| `POST` | `/api/encounters/{id}/finalize` | `encounters.finalize_encounter` | `require("DOCTOR")` | Finalize & lock medical record |
| `POST` | `/api/billing/invoices` | `billing.create_invoice` | `require("RECEPTIONIST", "ADMIN")` | Aggregate consultation and service charges |
| `POST` | `/api/billing/payments` | `billing.record_payment` | `require("RECEPTIONIST", "ADMIN")` | Record cash/UPI payment and issue receipt |
| `GET` | `/api/treatments/plans` | `treatments.list_plans` | `require("DOCTOR", "ADMIN")` | Physiotherapy package plans |
| `POST` | `/api/treatments/sessions` | `treatments.log_session` | `require("DOCTOR")` | Log completed session & decrement balance |
| `POST` | `/api/admin/backups` | `operations.create_backup` | `require("ADMIN")` | Trigger snapshot database backup |
| `POST` | `/api/admin/backups/restore` | `operations.restore_backup` | `require("ADMIN")` | Restore database archive |
| `GET` | `/api/admin/audit` | `audit.list_logs` | `require("ADMIN")` | Query immutable security audit trail |

