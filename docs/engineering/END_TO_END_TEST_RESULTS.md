# Kalyan Hospital — End-to-End Test Results

## Current Campaign Phase: Baseline (M0) Initial Results

| Workflow ID | Workflow Description | Automated Test Reference | Status | Evidence Summary |
|---|---|---|---|---|
| **WF-001** | Patient Registration | `test_patient_registration.py` | VERIFIED | URN generated, contact & age validated, stored in DB. |
| **WF-002** | Repeat Patient Visit | `test_patients_api.py` | VERIFIED | URN preserved across visits, unique patient identity invariant holds. |
| **WF-003** | Appointment Booking | `test_appointment_booking.py` | VERIFIED | Date/time, doctor slot, status transitions verified. |
| **WF-004** | Walk-in Registration | `test_appointment_status.py` | VERIFIED | Direct token assignment and queue insertion verified. |
| **WF-005** | Doctor-wise Queue | `test_doctor_queue.py` | VERIFIED | Independent token sequence per doctor per day, no gap or duplicate. |
| **WF-006** | Doctor Encounter | `test_encounters_api.py` | VERIFIED | Finalized encounter trigger locks row against updates. |
| **WF-007** | Multi-Doctor Transfer | `test_timeline_api.py` | PENDING AUDIT | Needs workflow test for seamless second doctor referral. |
| **WF-008** | Consolidated Billing | `test_billing_api.py` | VERIFIED | Consultation fee + procedures billed onto single invoice. |
| **WF-009** | Payment & Receipt | `test_receipt_concurrency.py` | VERIFIED | Cash/UPI transaction recorded, invoice balance updated, receipt issued. |
| **WF-010** | Physiotherapy Package | `test_treatment_plans_api.py` | VERIFIED | Multi-session plan created with initial 0 completed count. |
| **WF-011** | Treatment Session | `test_treatment_sessions_api.py`| VERIFIED | Completed session increments plan count and decrements balance. |
| **WF-012** | Dashboard Sync | `test_admin_overview.py` | VERIFIED | KPI endpoints calculate revenue, queue counts, and patient metrics. |
| **WF-013** | Patient History | `test_timeline_api.py` | VERIFIED | Chronological ordering of encounters, diagnoses, invoices. |
| **WF-014** | Role-Based Permissions | `test_route_policies.py` | VERIFIED | 101/101 endpoints verify RBAC enforcement. |
| **WF-015** | Reports & Ledger | `test_billing_models.py` | VERIFIED | Ledger consistency and payment calculations verified. |
| **WF-016** | Offline LAN Operation | Network Check | PENDING AUDIT | Zero external CDN assets confirmed. Needs multi-client LAN test. |
| **WF-017** | Backup & Restoration | `test_backup_service.py` | PENDING AUDIT | Tar archive created and restored; frontend test has heading mismatch. |

