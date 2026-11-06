---
title: Reception post-consultation checkout and consolidated billing architecture
date: 2026-11-06
context: Crystallized from Socratic exploration (/gsd-explore) of the whole reception workflow, operational boundaries, and deliverable functions for Kalyan Hospital v3.0 LAN platform.
---

# Reception Post-Consultation Checkout and Consolidated Billing Architecture

## 1. Architectural Entity Separation

To prevent systemic corruption across patient referrals, repeat visits, queue operations, and financial auditing, the system strictly separates six distinct entities:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. PATIENT REGISTRATION (Permanent hospital-wide URN: KH-YYYY-XXXX)    │
│    └── Single master identity shared across all departments.           │
├────────────────────────────────────────────────────────────────────────┤
│ 2. HOSPITAL VISIT (One OPD visit container per patient per date)       │
│    └── Aggregates all clinical events, queues, and billing for the day.│
├────────────────────────────────────────────────────────────────────────┤
│ 3. DOCTOR CONSULTATIONS / ENCOUNTERS (One or multiple per visit)       │
│    └── Distinct clinical encounters created per treating doctor.       │
├────────────────────────────────────────────────────────────────────────┤
│ 4. QUEUE TOKENS (Separate per doctor and date)                         │
│    └── Monotonic daily sequence per (doctor_id, date); permanent token.│
├────────────────────────────────────────────────────────────────────────┤
│ 5. BILLING ACCOUNT / VISIT LEDGER (Consolidated across the visit)      │
│    └── Accumulates all doctor fees, procedures, and counter items.     │
├────────────────────────────────────────────────────────────────────────┤
│ 6. PAYMENT TRANSACTIONS (One or multiple per visit ledger)             │
│    └── Append-only receipts; Reception exclusive collection authority. │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Patient Registration:** Permanent URN issued once. Canonical demographics and deduplication preview.
2. **Hospital Visit:** The operational visit container for a calendar date. Links all consultations, procedures, orders, and payments.
3. **Doctor Consultation:** An individual encounter with a doctor. A single hospital visit can contain *multiple* consultations (e.g., initial intake with General Medicine followed by an internal referral to Ophthalmology).
4. **Queue Token:** Scoped strictly to `(doctor_id, appointment_date)`. Allocated monotonically and permanently consumed. If a patient is transferred from Doctor A to Doctor B, Doctor A's token remains in history, and a new priority token is generated in Doctor B's queue.
5. **Billing Account / Visit Ledger:** A unified ledger container for the visit. Both Doctor A's charges, Doctor B's charges, and Reception counter items accumulate on this single ledger.
6. **Payment Transactions:** Append-only ledger credits recorded exclusively by `Role.RECEPTION` with payment mode, receipt number, and paise precision.

---

## 2. Core Decisions & Operating Refinements

### Decision 1: Post-Consultation Consolidated Checkout
- **Workflow:** Patient checks in at Reception and receives a compact plain-paper **OPD Token / Intake Slip**. The patient proceeds directly to the doctor's waiting lounge without upfront payment.
- **Completion Event:** When the doctor marks consultation as `DONE`, the system auto-generates a pending consultation charge on the visit billing account, along with any billable procedures/services recorded during the encounter.
- **Single Consolidated A4 Bill:** When the patient returns to the Reception desk, Reception reviews the doctor consultation fee, clinical procedures, and adds any physical counter remedies or OTC products actually dispensed. All items appear on **one consolidated A4 Bill & Payment Receipt** printed on the Epson desktop printer.

### Refinement 1: Multi-Doctor Consultations within One Visit
- If a patient is transferred or internally referred from Doctor A to Doctor B on the same day:
  - The patient retains the **same Hospital Visit container** and **same Visit Ledger**.
  - Doctor A's consultation fee and completed procedures remain on the visit ledger.
  - Doctor B's consultation fee and completed procedures accumulate on the **same ledger**.
  - Reception prints a single, consolidated A4 bill at final checkout reflecting both consultations and all combined services.

### Refinement 2: Package Session Deduction Timing
- For treatment packages (e.g., Physiotherapy Rehab Plans):
  - Sessions must be deducted **only when the clinician marks the treatment session as completed (`DONE`)**, never merely when the patient checks in at reception.
  - If a patient arrives but the session is interrupted or deferred, no session count is deducted from the package balance.

### Decision 2: Prescription vs. Counter Product Boundary
- Clinical prescriptions authored by doctors represent medical instructions (for external pharmacies or patient regimen). They **do not** automatically become billable counter line items.
- Only products, ointments, eye drops, or medical remedies **actually dispensed across the reception counter** from the configurable item catalogue are charged on the bill.

### Decision 3: Department-Wise Follow-Up & Validity Windows
- **Physiotherapy:** Managed via multi-session treatment packages (`total_sessions`, `validity_days`, `package_price_paise`). Active package balance is displayed during intake; completed sessions decrement the package balance without generating new consultation charges. Renewals and top-ups are billed at reception.
- **Ophthalmology & General OPD:** Managed via configurable revisit validity windows (e.g., 7 days). Revisit consultations within the window are automatically zero-rated (Rs. 0) or discounted per clinic configuration. Clinical procedures and counter items remain billable.

---

## 3. Printed Document Outputs

| Document | Trigger Point | Content & Layout | Target Printer |
|---|---|---|---|
| **OPD Token / Intake Slip** | Reception Check-in | Patient URN, Name, Age, Gender, Department, Doctor, Date, Token # | Plain sheet / Desk Printer |
| **Consolidated Bill & Receipt** | Post-Consultation Checkout | Bilingual letterhead, URN, Itemized Table (Consultation(s), Procedures, Counter Items), Grand Total, Paid, Balance, Cashier Signature | Epson A4 (100% scale, 12mm margins) |
| **Doctor Prescription Slip** | Consultation Finalization | Bilingual letterhead, Patient demographics, Rx table, Diagnosis, Advice, Follow-up date, Doctor signature | Epson A4 Portrait |
| **Duplicate Receipt** | Admin / Reception Reprint | Identical to Consolidated Receipt, with solid bordered indelible `DUPLICATE` stamp | Epson A4 Portrait |
