# Phase 1 Summary: App Shell & Dashboard Foundation

**Completed:** 2026-10-28  
**Phase Status:** Complete ✓  
**Requirements Delivered:** `DASH-01`, `DASH-02`, `DASH-03`  

---

## 1. What Was Delivered

1. **Application Shell & Window Hierarchy:**
   - Standalone Windows desktop window built with Python and PySide6 (`MainWindow`).
   - Left navigation sidebar featuring authentic Kalyan Hospital branding ("कल्याण हॉस्पीटल", "KALYAN HOSPITAL", "PHYSIOTHERAPY DEPARTMENT", and "श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित").
   - Signal-driven view switcher (`QStackedWidget`) routing between Dashboard, Patients, Treatment Sessions, Billing, and Backup.

2. **Official Hospital Design System:**
   - Theme styling tokens matching the physical prescription pad: Deep Maroon (`#6B1736`), Slate Dark (`#0F172A`), and Clinical Teal (`#0D9488`).
   - Segoe UI readable typography, accessible contrast, card containers, and smooth button interactions.

3. **SQLite Database Connection & Canonical Schema:**
   - `connection.py` enforcing `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;`.
   - `schema.sql` implementing tables for `patients` (canonical fields 1–10 + photo), `treatment_cases` (field 11 no. of sessions & field 12 total fee in paise), `treatment_sessions`, `payments` (amount paid in paise), `users`, and `id_sequences`.

4. **Live Operational Dashboard:**
   - Real-time stat cards: Total Patients, Today's Admissions, Active Treatment Cases, and Pending Fee Balance.
   - Zero hardcoded mock numbers; metrics pull directly from SQLite aggregate queries.
   - Quick-action shortcuts ("Register New Patient", "Search Patients", "Treatment Sessions").
   - Recent admissions table with alternating row colors.

5. **Entry Point & Documentation:**
   - `main.py` entrypoint initializing the database and launching the Qt event loop.
   - `README.md` with setup, launch (`python main.py`), and test commands (`pytest`).

6. **Automated Test Matrix:**
   - Headless test configuration (`tests/conftest.py`).
   - `tests/test_main_window.py`: Window smoke test, branding verification, navigation signals.
   - `tests/test_dashboard.py`: Schema DDL, foreign key enforcement, zero-count validation on empty DB, and live calculation accuracy.

---

## 2. Requirements Traceability

| Requirement | Description | Status | Verification |
|---|---|---|---|
| **DASH-01** | Real-time counts for patients, today's admissions, active cases, and balance calculated from SQLite. | Complete ✓ | `tests/test_dashboard.py` |
| **DASH-02** | Sidebar navigation between all primary clinic modules. | Complete ✓ | `tests/test_main_window.py` |
| **DASH-03** | Display authentic Kalyan Hospital and Sri Vashishtha Kalyan Trust branding. | Complete ✓ | `tests/test_main_window.py` |

---

## 3. Next Milestone

**Phase 2: Patient Registration & Search (Stage B)**
- Implement `PatientRepository` and atomic `KH-YYYY-XXXX` sequence generator.
- Implement `PatientService` with field validation and local photo manager (`data/photos/`).
- Build Patient Registration Form view (fields 1–10).
- Build searchable Patient Directory view.
