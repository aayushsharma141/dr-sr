# Kalyan Hospital — Complete Module Inventory

| Module Code | Module Name | Primary User Roles | Frontend Routes / Components | Backend Router / Services | Database Tables | Status |
|---|---|---|---|---|---|---|
| **MOD-AUTH** | Authentication & RBAC | All Roles | `/login`, `AuthContext.tsx` | `routers/auth.py`, `core/security.py` | `users`, `user_sessions`, `roles` | Functional |
| **MOD-RECP** | Reception Desk & Registration | Receptionist, Admin | `/reception`, `/patients/register`, `AppointmentsReception.tsx` | `routers/patients.py`, `routers/appointments.py` | `patients`, `appointments`, `visits` | Functional |
| **MOD-DIR** | Patient Directory & History | Receptionist, Doctor, Admin | `/patients`, `/patients/:id`, `PatientDetail.tsx` | `routers/patients.py`, `routers/timeline.py` | `patients`, `encounters`, `invoices` | Functional |
| **MOD-QUE** | Doctor Queue & Tokens | Receptionist, Doctor | `/reception/tokens`, `/doctor/queue`, `TokenGenerationPage.tsx` | `routers/appointments.py`, `services/queue.py` | `appointments` | Functional |
| **MOD-CLIN** | Clinical Encounter & Vitals | Doctor | `/doctor/encounter/:id`, `ClinicalEncounterWorkspace.tsx` | `routers/encounters.py`, `services/encounter.py` | `encounters`, `vitals`, `diagnoses` | Functional |
| **MOD-RX** | Prescriptions & Rx Pad | Doctor | `/doctor/prescriptions`, `PrescriptionWorkspace.tsx` | `routers/encounters.py` | `prescriptions`, `prescription_items` | Functional |
| **MOD-PT** | Treatment Plans & Rehab Packages | Doctor, Physiotherapist | `/doctor/treatment-plans`, `TreatmentPlanWorkspace.tsx` | `routers/treatments.py`, `services/treatment.py` | `treatment_plans`, `treatment_sessions` | Functional |
| **MOD-BILL** | Billing, Invoicing & Dues | Receptionist, Cashier, Admin | `/billing`, `/reception/dues`, `ReceptionBillingPage.tsx` | `routers/billing.py`, `services/billing.py` | `invoices`, `invoice_items`, `payments` | Functional |
| **MOD-ADM** | Admin Operations & SSOT Nav | Administrator | `/admin/*`, `AdminDashboard.tsx`, `IntegrityDashboard.tsx` | `routers/operations.py`, `routers/areas.py` | `departments`, `doctors`, `assets`, `system_setup` | In Progress (Test fixes needed) |
| **MOD-BAK** | Backup, Restore & Archiving | Administrator | `/admin/backups`, `BackupManagerPage.tsx` | `routers/operations.py`, `services/backup_service.py` | `backup_runs`, `integrity_runs` | In Progress (Test fixes needed) |
| **MOD-AUD** | Security Audit & Logs | Administrator | `/admin/audit`, `AuditViewerPage.tsx` | `routers/audit.py`, `core/audit.py` | `audit_logs` | Functional |

