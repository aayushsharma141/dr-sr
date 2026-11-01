# Permission Policy

## Policy model

Authorization is enforced by the backend using named permissions assigned to fixed application roles. Frontend navigation and hidden controls do not grant or revoke access. Every protected endpoint must independently enforce its required permission and any applicable record-level scope.

## Current roles

The current fixed role catalogue is:

- **Admin** — administrative and oversight capabilities represented in the permission catalogue.
- **Reception** — patient registration/updates, photo handling, appointment operations, payment-related permissions represented in the current map.
- **Doctor** — clinical workflow permissions, appointment operations, and doctor-scoped access.

The exact permission definitions and grants in code are authoritative. Review `backend/src/kalyan_api/core/permissions.py` before changing this document.

## Verified current findings

- Reception currently receives `PHOTO_READ` and `PHOTO_WRITE`; Admin and Doctor do not receive `PHOTO_READ`.
- The patient-photo download endpoint requires `PHOTO_READ`. Therefore Admin and Doctor cannot use that endpoint under the current role map.
- Reception currently receives `PATIENT_UPDATE`; Admin does not. Patient demographic PATCH requires `PATIENT_UPDATE`, so Admin cannot edit demographics under the current map.
- Doctor appointment and encounter access is scoped to the authenticated doctor's identity in the current implementation.
- Reception is denied encounter access under the current permission map.
- The permission catalogue contains values for future modules; their presence does not establish that those modules are implemented.

These are implementation observations, not approved clinical/business policy. The client must confirm intended access before any permission grant is changed.

## Required authorization behavior

1. Deny by default when a permission is absent.
2. Enforce permissions on every protected backend route.
3. Apply record-level scoping after role-level permission checks.
4. Test both allowed and denied roles for each sensitive operation.
5. Audit sensitive mutations with actor, action, target, timestamp, and relevant before/after data where supported.
6. Avoid broad Admin bypasses unless explicitly approved and tested.
7. Keep permission matrix documentation synchronized with code and tests.

## Client decisions required

See [Open questions](../decisions/open-questions.md) for:
- Whether Admin may view patient photographs.
- Whether Admin may edit patient demographics.
- Whether doctor isolation should remain strict or allow cross-doctor clinical access.
