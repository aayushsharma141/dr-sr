# Kalyan Hospital — Functionality & Screen Audit

| Route / Screen | Role Required | Component | API Integration | Key Interactions | Verified Status |
|---|---|---|---|---|---|
| `/login` | Public | `Login.tsx` | `/api/auth/login` | Username/password submit, validation, redirect | PASS |
| `/reception` | Receptionist, Admin | `AreaHome.tsx` | `/api/areas/reception/overview` | Queue overview, quick actions, metric cards | PASS |
| `/patients/register` | Receptionist, Admin | `PatientRegister.tsx` | `/api/patients` | Demographic form, URN generation, print token | PASS |
| `/patients` | All Roles | `PatientsDirectory.tsx` | `/api/patients` | Search by URN/Phone, filter by date, pagination | PASS |
| `/patients/:id` | All Roles | `PatientDetail.tsx` | `/api/patients/{id}`, `/timeline` | History timeline, encounters, invoices, plans | PASS |
| `/reception/appointments` | Receptionist, Admin | `AppointmentsReception.tsx` | `/api/appointments` | Daily schedule, mark arrived, cancellation | PASS |
| `/reception/tokens` | Receptionist, Admin | `TokenGenerationPage.tsx` | `/api/appointments` | Doctor token slip generation & printing | PASS |
| `/reception/dues` | Receptionist, Admin | `PendingDuesPage.tsx` | `/api/billing/dues` | Outstanding patient ledger & quick pay | PASS |
| `/doctor` | Doctor, Admin | `DoctorDashboard.tsx` | `/api/areas/doctor/overview` | Live queue list, call next patient, status updates | PASS |
| `/doctor/encounter/:id` | Doctor | `ClinicalEncounterWorkspace.tsx`| `/api/encounters` | Vitals, complaints, auto-save, final lock | PASS |
| `/doctor/prescriptions` | Doctor | `PrescriptionWorkspace.tsx` | `/api/encounters` | Rx pad, drug search, dose instructions | PASS |
| `/doctor/treatment-plans`| Doctor | `TreatmentPlanWorkspace.tsx` | `/api/treatments` | Package setup, session logger, VAS pain gauge | PASS |
| `/billing` | Receptionist, Admin | `ReceptionBillingPage.tsx` | `/api/billing` | Invoice generation, discount, payment receipt | PASS |
| `/admin` | Admin | `AdminDashboard.tsx` | `/api/areas/admin/overview` | Executive management overview & KPIs | NEEDS TEST FIX |
| `/admin/backups` | Admin | `BackupManagerPage.tsx` | `/api/admin/backups` | Backup creation, restore modal, archive list | NEEDS TEST FIX |
| `/admin/integrity` | Admin | `IntegrityDashboard.tsx` | `/api/admin/integrity-run` | DB integrity checker & foreign key audit | PASS |
| `/admin/audit` | Admin | `AuditViewerPage.tsx` | `/api/admin/audit` | Append-only audit search & export | PASS |
| `/admin/users` | Admin | `Users.tsx` | `/api/admin/users` | Staff creation, role assignment, password reset | PASS |

