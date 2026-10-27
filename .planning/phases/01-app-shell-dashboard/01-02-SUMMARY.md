---
phase: 01-app-shell-dashboard
plan: 02
subsystem: database-and-dashboard
tags: [sqlite, dashboard, metrics, main-entrypoint, readme]

requires:
  - phase: 01-app-shell-dashboard
    provides: [MainWindow shell, styles, sidebar]
provides:
  - "SQLite connection factory enforcing WAL journal mode and foreign key constraints"
  - "Canonical 12-field SQLite DDL schema (schema.sql) with check constraints"
  - "DashboardService executing aggregate queries for patient counts and pending fee balances"
  - "Live DashboardView with 4 real-time stat cards and recent admissions table"
  - "Application entry point main.py and setup documentation in README.md"
  - "Automated test suite in tests/test_dashboard.py"
affects: [02-patient-registration, 03-treatment-billing]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [sqlite3, PySide6]
  patterns: [Layered Service-Repository architecture, Integer paise currency arithmetic, Zero-mock real-time aggregates]

key-files:
  created:
    - app/db/__init__.py
    - app/db/connection.py
    - app/db/schema.sql
    - app/services/__init__.py
    - app/services/dashboard_service.py
    - app/ui/views/dashboard_view.py
    - main.py
    - README.md
    - tests/test_dashboard.py
  modified:
    - app/ui/main_window.py

key-decisions:
  - "All financial fields stored in integer paise to eliminate floating-point math inaccuracies."
  - "Dashboard stat cards query SQLite directly with zero mock numbers; display exact 0 values on clean launch."

requirements-completed:
  - DASH-01

coverage:
  - id: D1
    description: "Live dashboard stat cards calculating patient counts and balances from SQLite"
    requirement: DASH-01
    verification:
      - kind: unit
        ref: "tests/test_dashboard.py#test_dashboard_service_with_records"
        status: pass
---

# Plan 01-02 Summary: Database Layer & Live Dashboard

Implemented the SQLite data foundation and live operational clinic dashboard:
1. **SQLite Connection & Schema:** Created `app/db/connection.py` enforcing `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;`. `schema.sql` establishes tables for patients, treatment cases, sessions, payments, users, and ID sequences.
2. **Dashboard Service:** Implemented `DashboardService` calculating live metrics (Total Patients, Today's Admissions, Active Cases, and Pending Balances in integer paise).
3. **Live Dashboard View:** Replaced placeholder index 0 with `DashboardView`, featuring 4 metric cards, quick-action navigation, and a recent admissions table.
4. **Bootstrap & Documentation:** Created `main.py` entrypoint and comprehensive `README.md` setup and launch instructions.
5. **Automated Testing:** `tests/test_dashboard.py` verifies schema initialization, empty-state zeros, and record calculation accuracy.
