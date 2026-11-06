---
id: SEED-261106-sms-whatsapp-notifications
status: dormant
planted: 2026-11-06
planted_during: Phase 18 / Phase 19
trigger_when: When hospital LAN infrastructure gains an external SMS/WhatsApp gateway or internet connectivity
scope: medium (external notification worker)
---

# SEED-261106-sms-whatsapp-notifications: Automated Patient Queue Token and Revisit Reminders

## Why This Matters

Currently, Kalyan Hospital operates strictly offline on a closed local area network (DEP-01). All patient communication occurs through physical printed slips (OPD token slip, A4 payment receipt, prescription slip).

When the hospital infrastructure eventually acquires an external outbound gateway (e.g. GSM SMS dongle, DLT-registered SMS provider, or WhatsApp Business API), automated outbound notifications will:
- Send patients their daily queue token number and estimated wait status via SMS upon reception check-in.
- Send digital receipt links and payment acknowledgments.
- Dispatch automated revisit reminders before follow-up validity windows expire (e.g. 2 days prior to 7-day validity lapse).
- Notify Physiotherapy package holders when package sessions are running low or near expiration date.

## When to Surface

**Trigger:** When hospital LAN infrastructure gains an external SMS/WhatsApp gateway or internet connectivity.

This seed will surface during `/gsd-new-milestone` when an integration milestone or connectivity phase is planned.

## Scope Estimate

**Medium** — Outbound background queue worker (isolated from core LAN clinical loop), SMS/WhatsApp adapter interface, message template library (Devanagari Hindi & English), patient opt-out flag, and retry queue.

## Breadcrumbs

- `backend/src/kalyan_api/services/token_service.py` (Daily token generation hook)
- `backend/src/kalyan_api/models.py` (`Patient.mobile`, `DailyTokenSequence`, `TreatmentPlan`)
- `.planning/notes/reception-post-consultation-hybrid-checkout.md` (Token and revisit lifecycle)
- `docs/reception-module-spec-v1.2.md` (§3 Queue & Token Workflow)

## Notes

Captured during `/gsd-explore` on the reception workflow and deliverable boundaries (2026-11-06). Explicitly deferred so that core v3.0 remains 100% offline and operational on the isolated LAN without external internet dependency.
