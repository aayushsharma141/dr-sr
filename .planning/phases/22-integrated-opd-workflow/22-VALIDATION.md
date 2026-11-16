---
phase: "22"
slug: "integrated-opd-workflow"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-16"
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 22-RESEARCH.md "Validation Architecture", updated with the owner answers recorded in 22-CONTEXT.md on 2026-11-15 and 2026-11-16.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: pytest 9.2.0 (`backend/pyproject.toml`, `timeout = 60`, `--import-mode=importlib`). Frontend: vitest (`frontend/package.json` `test`). |
| **Config file** | `backend/pyproject.toml`, `backend/tests/conftest.py`, `frontend/vite.config.*` |
| **Quick run command** | `cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings <touched test files>` and `cd D:/dr-sr/frontend && npx vitest run --maxWorkers=2 <touched test files>` |
| **Full suite command** | `cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest tests -p no:warnings` (run in background, ~4–7 min); `cd D:/dr-sr/frontend && npx vitest run && npm run typecheck && npm run lint` |
| **Estimated runtime** | Quick: ~5–120 s. Full backend: ~240–420 s. Full frontend: ~60 s. |

Database rules: backend tests run only on `kalyan_test` (conftest rebuilds its schema). Never run tests against `kalyan_dev`. Backend pytest runs never run concurrently, because they share `kalyan_test`.

---

## Sampling Rate

- **After every task commit:** quick run of the touched test files, plus `test_rbac_matrix.py`, `test_permissions_catalogue.py` and `test_openapi_snapshot.py` when an API or permission changed.
- **After every plan wave:** full backend suite, full frontend suite, `npm run typecheck`, `npm run lint`.
- **Before `/gsd-verify-work`:** full suites green and the UAT script re-run on `kalyan_test` with evidence per row.
- **Max feedback latency:** 120 seconds for quick runs.

---

## Per-Task Verification Map

Plan-level map. Each plan's tasks carry their own `<automated>` command; this table records which test proves which requirement.

| Requirement | Plan | Behaviour | Test Type | Automated Command / File | File Exists | Status |
|-------------|------|-----------|-----------|--------------------------|-------------|--------|
| PRI-07..09 | 22-01 | Doctor queue shows PriorityBadge and suggested order; alert acknowledged | component + API | `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`, `backend/tests/test_phase22_wave2.py` | ✅ / extend | ⬜ pending |
| QUE-10, AUD-08 | 22-02 | Reassign same visit, audit row; Waiting Room labels | API + component | `test_phase22_wave2.py`, `waiting-room.test.tsx`, `today-appointments-panel.test.tsx` | ✅ / ❌ W0 | ⬜ pending |
| FEE-05 | 22-03 | Reception refused fee adjustment (403) | matrix | `test_rbac_matrix.py`, `test_phase22_fee_adjustment.py` | ✅ | ⬜ pending |
| FEE-06 | 22-03 | Authorised adjustment = admin correction (OD-A admin-only) | API | `test_phase22_fee_adjustment.py::test_admin_may_correct_a_fee_with_a_reason` | ✅ | ⬜ pending |
| Migration 0029 | 22-04 | Single head; model matches migration; grants cover every table | schema | `test_migrations.py`, `test_phase22_bill_schema.py` | ✅ / ❌ W0 | ⬜ pending |
| FEE-07, balance switch | 22-05 | Every existing visit's due identical before and after; fee change leaves bills unchanged | regression | `test_phase22_balance_switch.py`, `test_phase22_bill_snapshot.py` | ❌ W0 / ✅ | ⬜ pending |
| Visit payment guard, AUD-04 | 22-06 | Overpayment 422; concurrent payments, one wins; adjustment history | API + concurrency | `test_phase22_balance_switch.py`, `test_phase22_fee_adjustment.py` | ❌ W0 / ✅ | ⬜ pending |
| BILL-12 | 22-07 | Visit checkout and dues forms pay visit_id; receipt prints totals only (BILL-12) | component | `receipt-print.test.tsx` | ❌ W0 | ⬜ pending |
| MED-03..06, MED-08, MED-12, BILL-18 | 22-08 | Add medicine/particular; qty × rate rounded to whole paise (OD-E); negative/zero rejected (MED-12) | API + DB | `test_phase22_bill_lines.py` | ❌ W0 | ⬜ pending |
| LED-03..07 | 22-09 | Visit bill view API; checkout list token and completion time | API | `test_phase22_bill_view.py` | ❌ W0 | ⬜ pending |
| BILL-06, OD-G | 22-10 | Reception voids own line same day with reason; admin void route per owner decision | API | `test_phase22_bill_void.py` | ❌ W0 | ⬜ pending |
| MED-07, MED-09..11 | 22-11 | Reception sees medicine name and form; enters supplied quantity (B2); change qty recalculates with history (MED-11); typed lines (MED-07) | API + authz | `test_phase22_prescribed_medicines.py`, `test_phase22_bill_correct.py` | ❌ W0 | ⬜ pending |
| BILL-03, doctor charges (B3, Q13) | 22-12 | Doctor adds own charges while visit OPEN, including after completion; locked after close; sees own lines only | API + DB | `test_phase22_doctor_lines.py` | ❌ W0 | ⬜ pending |
| FEE-09, BILL-04, LED-01..02 | 22-13 | Bill view totals (BILL-04); adjustment history readable (FEE-09); visit payments list | component | `bill-panel.test.tsx` | ❌ W0 | ⬜ pending |
| MED-02, BILL-05 | 22-14 | Add service/particular modal (BILL-05); prescribed medicines picker with supplied qty (MED-02); admin adjust actions | component | `bill-line-actions.test.tsx` | ❌ W0 | ⬜ pending |
| SCENARIO-02, FEE-03/04 | 22-16 | Follow-up with fee waived end to end; doctor charges panel UI | API + component | `test_phase22_scenario02.py`, `doctor-charges-panel.test.tsx` | ❌ W0 | ⬜ pending |
| Referral report (OD-I) | 22-17, 22-18 | By source and referrer, date filter, cancelled excluded; admin-only | API + matrix | `test_phase22_referral_report.py`, `referral-report.test.tsx` | ❌ W0 | ⬜ pending |
| LED-10, reception Reports | 22-15 | Receipts page; reception Reports shows today's collection summary | component | `receipts-page.test.tsx`, `reception-reports.test.tsx` | ❌ W0 | ⬜ pending |
| Full UAT re-run | 22-19 | Every open UAT ID re-run with evidence | script | `scripts/qa_opd_full_suite.py` on `kalyan_test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_phase22_balance_switch.py` — before/after due comparison, visit payment guard, concurrency
- [ ] `backend/tests/test_phase22_visit_payments.py` — created by 22-06; used by 22-07 and 22-13 (visit-level payments and checkout gate)
- [ ] `backend/tests/test_phase22_bill_schema.py`
- [ ] `backend/tests/test_phase22_bill_lines.py`, `test_phase22_bill_view.py`, `test_phase22_bill_void.py`, `test_phase22_bill_correct.py`, `test_phase22_prescribed_medicines.py`, `test_phase22_doctor_lines.py`, `test_phase22_scenario02.py`, `test_phase22_referral_report.py`
- [ ] Frontend: `today-appointments-panel.test.tsx`, `bill-panel.test.tsx`, `doctor-charges-panel.test.tsx`, `receipts-page.test.tsx`, `reception-reports.test.tsx`, `referral-report.test.tsx`
- [ ] Update `scripts/qa_opd_full_suite.py` rows so the UAT re-run reports real status and real evidence (not the actual-result text copied into evidence)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Screens render correctly on the served build | All UI plans | Visual layout and the built bundle on :8000 | After the owner-approved deploy (22-20): open `:8000`, sign in as reception and doctor, check Waiting Room, banner, Billing & Checkout, Receipts, Reports, doctor charges panel; reload to confirm persistence |
| Printed receipt fits one A4 page | BILL-12, UX-01 | Printer output | Print a receipt on the hospital printer |
| Hindi text on hospital PCs | UX-05 | Fonts on real machines | Check Hindi names and labels on a hospital PC |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
