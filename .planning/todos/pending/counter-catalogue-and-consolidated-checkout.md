---
title: Implement Hospital Counter Product Catalogue and Consolidated Checkout Billing UI
date: 2026-11-06
priority: high
---

# Implement Hospital Counter Product Catalogue and Consolidated Checkout Billing UI

Realizes requirements **REC-05** and **REC-06** as defined in `.planning/notes/reception-post-consultation-hybrid-checkout.md`.

## 1. Backend Counter Catalogue & Visit Accumulator

- [ ] Create table `counter_items` (`id`, `code`, `name_en`, `name_hi`, `category`, `unit_price_paise`, `is_active`, `version_id`, `created_at`, `updated_at`).
- [ ] Add Alembic migration with runtime table grants in `backup_service.py` to preserve restore drills.
- [ ] Implement CRUD router `/api/billing/counter-items` restricted to `Role.ADMIN` (`FEE_MANAGE`), with active item listing available to `Role.RECEPTION`.
- [ ] Implement `GET /api/billing/visits/{visit_id}/checkout-summary` aggregating:
  - Doctor consultation fees (including multi-doctor referral consultations on the same visit).
  - Clinical billable procedures recorded by doctor encounters.
  - Active follow-up validity discounts (Ophthalmology/OPD) or active package session coverage (Physiotherapy).
  - Outstanding visit balance.
- [ ] Guard: Ensure Physiotherapy package deduction occurs exclusively when `TreatmentSession` status transitions to `DONE`, never on reception arrival.

## 2. Frontend Consolidated Checkout Interface

- [ ] Build Counter Product Catalogue management screen in Admin workspace (`/admin/counter-items`).
- [ ] Build `CheckoutBillingModal.tsx` on the Reception board:
  - Reviews auto-populated consultation charges and doctor procedures.
  - Quick-search counter items selector (add OTC remedies, eye drops, braces with quantity and price).
  - Shows consolidated summary: Total Billable Paise, Payment Amount, Payment Mode (Cash, UPI, Card), and Outstanding Balance.
  - Posts consolidated payment transaction via `useCreatePayment()`.
  - Immediately opens the consolidated A4 Bill & Receipt print dialog.
- [ ] Update `ReceiptPrint.tsx` to format the itemized table:
  - Section A: Consultations (Doctor name, Department, Fee)
  - Section B: Clinical Procedures / Services
  - Section C: Hospital Counter Products / Medicines Supplied
  - Totals: Grand Total, Paid Amount, Net Balance.
- [ ] Unit tests for checkout calculation, multi-doctor fee accumulation, and counter items.
