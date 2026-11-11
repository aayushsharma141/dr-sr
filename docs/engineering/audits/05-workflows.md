# Hospital Business Workflows Audit (T05)

- **Auditor**: Workflow Explorer
- **Repository Scope**: Connected business processes, patient lifecycle, clinical workflows, billing
- **Date**: 2026-11-09
- **Status**: AUDITED

---

## 1. Primary Hospital Business Lifecycles

### Lifecycle 1: Outpatient Journey (OPD)
1. **Patient Arrival**:
   - New Patient: Registration -> Generates permanent URN -> Generates Visit.
   - Returning Patient: Search by URN/Phone/Name -> Select patient -> Generates Visit.
2. **Doctor Queue Assignment**:
   - Select Department & Doctor -> Allocate daily token number -> Status set to `ARRIVED` in Doctor Queue.
3. **Doctor Consultation**:
   - Doctor opens queue -> Selects patient -> Status transitions to `IN_CONSULTATION`.
   - Vitals recorded -> Chief complaints & clinical examination -> Prescriptions & advice entered.
   - Finalize Encounter -> Triggers encounter lock and status set to `COMPLETED`.
4. **Billing & Discharge**:
   - Invoice generated at Reception with Consultation Fee.
   - Cashier records Payment (Cash/UPI) -> Issues printed Receipt.

---

### Lifecycle 2: Physiotherapy & Rehabilitation Package
1. **Package Prescription**:
   - Doctor creates Treatment Plan (e.g. 10 Sessions of Cervical Spondylosis Rehab).
   - Invoiced at Reception -> Paid in full or partial.
2. **Session Execution**:
   - Patient arrives for Session #N.
   - Physiotherapist / Doctor logs session details (VAS pain score, modality, exercise).
   - Session marked completed -> System automatically increments completed count and checks remaining sessions.
   - Invariant: Zero session deduction prior to actual session completion.

---

## 2. Identified Workflow Gaps & Edge Cases
1. **[WF-GAP-01] Multi-Doctor Consultations in Same Visit**:
   - Current UI requires separate appointment bookings for second doctor instead of seamless transfer.
2. **[WF-GAP-02] Real-time Doctor Queue Sync**:
   - Doctor dashboard queue relies on periodic polling or manual refresh; needs robust fallback for intermittent network latency on LAN.

