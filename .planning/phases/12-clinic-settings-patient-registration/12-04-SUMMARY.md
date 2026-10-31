# Plan 12-04 Summary: Multi-Modal Search, Demographic Edit & Photo Storage

**Execution Wave:** 4  
**Date:** 2026-11-01  
**Status:** Completed  
**Requirements Covered:** `PAT-02`, `PAT-03`, `PAT-05`

---

## 1. Accomplishments
1. **Multi-Modal Patient Search (`PAT-02`):**
   - Implemented `GET /api/patients` supporting query string `q` matching against URN, mobile number, English name, and Hindi Devanagari name (`PATIENT_READ` permission required).
   - Supports paginated output ordered by registration date.
2. **Demographic Modification & Concurrency Control (`PAT-03`):**
   - Implemented `GET /api/patients/{id}` and `PATCH /api/patients/{id}` (`PATIENT_UPDATE` permission required).
   - Enforces optimistic concurrency via `version_id`: returns HTTP 409 Conflict with error code `version_conflict` if `version_id` does not match the database state.
   - Automatically computes demographic before/after diffs and logs a structured `PATIENT_UPDATED` audit record.
3. **Secure Photo Storage & Authenticated Streaming (`PAT-05`):**
   - Built `backend/src/kalyan_api/services/photo_service.py` to validate JPEG/PNG magic bytes and max size (5 MB), storing files safely under `backend/var/photos/<uuid>.<ext>`.
   - Implemented `POST /api/patients/{id}/photo` (`PHOTO_WRITE` permission required) and `GET /api/patients/{id}/photo` (`PHOTO_READ` permission required).
   - Streaming endpoint requires authenticated session and sets `Cache-Control: private, no-cache`.
4. **Verification & Testing:**
   - `test_patient_search.py` tests multi-modal search, Hindi Devanagari query matching, and mobile/URN lookups.
   - `test_patient_edit_photo.py` tests demographic editing, 409 conflict detection, photo magic byte validation, and authenticated streaming access control.
   - Updated RBAC matrix test coverage and OpenAPI golden snapshot (`openapi.snapshot.json`).
