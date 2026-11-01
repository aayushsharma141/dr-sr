# Summary 13-02: Daily Token Service & Appointment Booking Endpoints

**Date:** 2026-11-01  
**Status:** Complete  
**Plan:** `.planning/phases/13-appointments-clinical-encounters/13-02-PLAN.md`

## What Was Done

1. **Daily Token Generator (`backend/src/kalyan_api/services/token_service.py`):**
   - Implemented `generate_next_daily_token(session, doctor_id, appointment_date) -> int`.
   - Uses `insert ... on_conflict_do_nothing` to ensure sequence record exists, followed by `SELECT ... FOR UPDATE` row lock.
   - Atomically increments and updates `last_token`, returning sequential token integers (1, 2, 3...) per doctor per calendar date.

2. **Pydantic Schemas (`backend/src/kalyan_api/schemas/appointments.py`):**
   - `AppointmentCreate`, `AppointmentStatusUpdate`, `AppointmentRead`, `AppointmentListResponse`.

3. **REST Endpoints (`backend/src/kalyan_api/routers/appointments.py`):**
   - `POST /api/appointments`: Books appointment, validates active patient and doctor, allocates atomic daily token, assigns `BOOKED` status, records `AuditAction.APPOINTMENT_CREATED`.
   - `GET /api/appointments`: Lists appointments with date, doctor, patient, status filtering. Role-scoped: Doctors can only view their own appointments; reception and admin can view across all doctors.
   - `GET /api/appointments/{id}`: Retrieves single appointment with scope protection.
   - Registered router under `/api` in `main.py`.

4. **Automated Verification:**
   - `backend/tests/test_token_concurrency.py`: 20 parallel threads concurrently allocated tokens for the same doctor and date. Asserted strictly 20 unique tokens with 0 duplicates and 0 gaps (`set(results) == set(range(1, 21))`).
   - `backend/tests/test_appointment_booking.py`: Functional test verifying reception booking lifecycle, sequential token incrementing (token 1, token 2), appointment listing, and 404 validation gates.
   - `ruff check backend`: 100% clean.

## Verification Run
```bash
backend\.venv\Scripts\pytest.exe backend\tests\test_appointment_models.py backend\tests\test_token_concurrency.py backend\tests\test_appointment_booking.py
6 passed, 1 warning in 1.63s
```
