---
title: Merge PR #17 and PR #12 before Phase 19 starts
date: 2026-11-05
priority: high
---

# Merge PR #17 and PR #12 before Phase 19 starts

Phase 19 reuses the departments from PR #17 and the visit type from PR #12, so both must land on `main` first (D-19-02).

- [ ] **PR #17, `feature/reception-all-specialties`:** still a draft. Its Reception spec v1.1 excludes specialty-specific clinical forms; add the exception for the Physiotherapy and Ophthalmology templates (D-19-01) when it merges.
- [ ] **PR #12, `fix/hybrid-appointment-workflow-review`:** its `0006_hybrid_appointment_booking.py` migration collides with `0006_admin_panel_hardening.py` on `main`, and it overlaps PR #17 in `AppointmentBookingModal.tsx`, `AppointmentsReception.tsx` and the appointment routers. Renumber the migration after `0009` and retest.
- [ ] Check the merged appointment flow: token at check-in, department and visit type together.

`feature/reception-all-specialties` is checked out in the worktree at `D:/ci-backend-worktree`.
