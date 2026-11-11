# Kalyan Hospital — Core Business Invariants & Rules

Organization: श्री वशिष्ठ कल्याण ट्रस्ट
Location: Ara, Bhojpur, Bihar, India
Deployment Mode: Offline-First Local LAN Server with multi-workstation client access.

## Mandatory Architectural & Business Distinctions
1. **Patient Identity ≠ Hospital Visit**
   - A patient retains exactly one permanent hospital-wide identity (URN) across all specialties and departments.
   - URN must never be duplicated or re-generated for repeat visits.

2. **Hospital Visit ≠ Doctor Consultation**
   - One hospital visit can contain multiple doctor consultations (e.g. general physician consultation followed by physiotherapy or specialist evaluation).
   - Each consultation belongs to a specific visit and doctor.

3. **Doctor Consultation ≠ Queue Token**
   - Each doctor maintains an independent queue.
   - Tokens are doctor-specific and visit-specific.
   - Queue entries must accurately reflect arrival, in-consultation, and completed states.

4. **Consultation ≠ Clinical Record**
   - Clinical notes, prescriptions, diagnosis, and vitals belong to a consultation lifecycle and are immutable once finalized.

5. **Invoice ≠ Payment Transaction**
   - Multiple billable charges (consultation, procedures, physiotherapy packages, medications) can accumulate within a single visit onto a unified invoice.
   - Payments are discrete transactions against an invoice (supporting partial payment, split payment, and multiple receipts).
   - Payment history must NEVER be overwritten or silently edited.

6. **Package Purchase ≠ Treatment Session**
   - Physiotherapy and rehabilitation packages track authorized total sessions vs. completed sessions.
   - Sessions are deducted strictly when a treatment session is completed and signed off, never at purchase or scheduling time.

7. **Reception Controls Routine Payment Collection**
   - Routine billing and payments are owned by Reception / Cashier.
   - Doctors cannot collect payments directly inside consultation workspaces.

8. **Offline LAN Architecture Invariant**
   - All client workstations connect to the centralized local LAN server database.
   - Normal hospital operations must execute without any external internet dependency.
   - Authoritative data resides exclusively on the central LAN server.

