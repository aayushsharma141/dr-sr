---
title: Get sign-off on doctor access change and collect eye doctor details
date: 2026-11-05
priority: high
---

# Get sign-off on doctor access change and collect eye doctor details

Blocks DWS-04 in Phase 19. The rest of the phase can go ahead without it.

## 1. Agree the EG-6 change in writing

EG-6 / D-03 is locked as a strict doctor silo. The proposed change is that doctors can read all clinical records and edit only their own, with cross-doctor reads audited.

Agreement needed from:

- [ ] Dr. Madan Mohan Dwivedi
- [ ] Dr. Chandan Kr. Dwivedi
- [ ] The eye doctor. EG-6 predates this doctor, but their notes become readable by the others
- [ ] The trust administrator

Once agreed, record the change in `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md` and the Key Decisions table in `.planning/PROJECT.md`. Reception and Admin stay default-denied on clinical content (D-04).

Also record the EG-10 change in the same two places: one login per account at a time, with an audited takeover (DWS-10). EG-10 lists the project owner as decider, with the trust administrator informed.

## 2. Collect the eye doctor's details

- [ ] Name in English and Hindi
- [ ] Qualification and registration number
- [ ] Default consultation fee
- [ ] Time to review the Ophthalmology template fields
- [ ] Department membership once PR #17 is merged, with the Physiotherapy and Ophthalmology departments created
