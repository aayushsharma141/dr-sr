# Kalyan Hospital — End-to-End Test Plan (WF-001 to WF-017)

| Workflow ID | Workflow Title | Actor | Preconditions | Steps to Execute | Verification Assertions |
|---|---|---|---|---|---|
| **WF-001** | Patient Registration | Receptionist | App running, logged in | 1. Open `/patients/register`<br>2. Fill name, age, phone, gender, address<br>3. Submit form | URN generated (`KLY-YYYY-NNNNNN`), patient row in DB, redirect to detail. |
| **WF-002** | Repeat Patient Visit | Receptionist | Existing patient in DB | 1. Search URN/phone in `/patients`<br>2. Select patient<br>3. Create new visit | New visit created under same URN, historical visits untouched. |
| **WF-003** | Appointment Booking | Receptionist | Doctor configured | 1. Open `/reception/appointments`<br>2. Pick doctor, date, slot<br>3. Confirm booking | Appointment created, status `SCHEDULED`, token allocated. |
| **WF-004** | Walk-in Queue Registration| Receptionist | Active OPD doctor | 1. Quick register or select patient<br>2. Select doctor<br>3. Click "Issue Token" | Appointment created with status `ARRIVED`, printed token generated. |
| **WF-005** | Doctor-wise Queue Lifecycle | Doctor | Patient arrived in queue | 1. Doctor opens `/doctor`<br>2. Calls next patient<br>3. Starts consultation | Status changes `ARRIVED` -> `IN_CONSULTATION`. Queue counter updates. |
| **WF-006** | Doctor Encounter & Notes | Doctor | Patient in consultation | 1. Open `/doctor/encounter/:id`<br>2. Enter vitals, complaints, Rx<br>3. Click "Finalize Encounter" | Encounter marked `is_finalised=true`, locked in DB by trigger. |
| **WF-007** | Multi-Doctor Transfer | Doctor / Reception | Patient completed Doctor 1 | 1. Refer to Doctor 2 (e.g. Physiotherapy)<br>2. Transfer appointment<br>3. Doctor 2 queue updates | Doctor 2 sees patient in queue, unified visit tracks both encounters. |
| **WF-008** | Consolidated Billing | Cashier | Completed encounters | 1. Open `/billing`<br>2. Select patient visit<br>3. View line items (Consultation + Procedures) | Invoice aggregates all charges for that visit. |
| **WF-009** | Payment & Receipt | Cashier | Outstanding invoice | 1. Record payment (Cash/UPI)<br>2. Submit payment<br>3. Print receipt | Payment row created, invoice marked `PAID` or `PARTIAL`, 80mm receipt ready. |
| **WF-010** | Physiotherapy Package | Doctor | Patient with rehab need | 1. Open `/doctor/treatment-plans`<br>2. Select package (e.g. 10 sessions)<br>3. Prescribe | Treatment plan created: `total_sessions=10`, `completed_sessions=0`. |
| **WF-011** | Treatment Session Log | Physiotherapist | Active treatment plan | 1. Open patient plan<br>2. Log session notes & VAS score<br>3. Mark session complete | `completed_sessions` increments to 1, remaining is 9. |
| **WF-012** | Dashboard Synchronization | All | Operations active | 1. Register patient, book token, collect fee<br>2. Check Reception/Doctor/Admin overview | Counters update consistently across views. |
| **WF-013** | Patient History Timeline | Doctor | Multi-visit patient | 1. Open `/patients/:id`<br>2. Inspect timeline | Chronological log of visits, diagnoses, prescriptions, and payments displayed. |
| **WF-014** | Role-Based Permissions | Admin / Reception / Doctor | User accounts configured | 1. Login as Receptionist -> verify no access to clinical notes/admin<br>2. Login as Doctor -> verify no access to admin settings | 403 Forbidden on API and hidden UI routes. |
| **WF-015** | Reports & Financial Audit | Admin | Transactions present | 1. Open `/admin/audit` and `/admin/overview`<br>2. Reconcile daily cash/UPI collections | Totals match sum of payments. Zero discrepancy. |
| **WF-016** | Offline LAN Operation | Network Operator | Disconnect WAN | 1. Unplug internet cable from LAN router<br>2. Execute registration, consultation, billing | 100% functionality works without failure. |
| **WF-017** | Backup & Restoration | Admin | Database populated | 1. Trigger backup in `/admin/backups`<br>2. Verify archive file on disk<br>3. Run test restore in `kalyan_test` | All records intact, checksum verified. |

