---
name: release-verification
description: Independent QA and release verification gate for Kalyan Hospital release readiness.
---
# Release Verification

## Verification Checklist
1. Review test suites (Vitest frontend + pytest backend).
2. Validate relational constraints and schema triggers on test database.
3. Validate offline LAN operation (no remote assets, local fonts/crests, offline auth).
4. Run regression suite for all resolved P0/P1 defects.
5. Compile evidence in `docs/engineering/RELEASE_READINESS_REPORT.md`.

