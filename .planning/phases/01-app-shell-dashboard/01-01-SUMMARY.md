---
phase: 01-app-shell-dashboard
plan: 01
subsystem: ui
tags: [pyside6, qt, styling, navigation, sidebar]

requires: []
provides:
  - "Runnable PySide6 application window shell with Segoe UI typography and custom QSS"
  - "Navigation sidebar with official Kalyan Hospital and Sri Vashishtha Kalyan Trust branding"
  - "Central QStackedWidget container hosting placeholder views for all 5 clinic workflows"
  - "Headless pytest smoke test suite validating window hierarchy and navigation signals"
affects: [01-02, 02-patient-registration, 03-treatment-billing]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [PySide6, pytest]
  patterns: [Layered UI container with QStackedWidget, Signal-driven navigation, Unified QSS styling tokens]

key-files:
  created:
    - requirements.txt
    - .gitignore
    - app/config.py
    - app/ui/styles.py
    - app/ui/sidebar.py
    - app/ui/main_window.py
    - app/ui/views/placeholder_view.py
    - tests/conftest.py
    - tests/test_main_window.py

key-decisions:
  - "Official deep maroon palette (#6B1736) from Kalyan Hospital physical slip adopted as primary UI brand accent."
  - "Qt QPA platform set to offscreen in conftest.py for zero-GUI headless testing."

requirements-completed:
  - DASH-02
  - DASH-03

coverage:
  - id: D1
    description: "PySide6 QMainWindow shell with navigation sidebar and stacked views"
    requirement: DASH-02
    verification:
      - kind: unit
        ref: "tests/test_main_window.py#test_sidebar_navigation_switching"
        status: pass
  - id: D2
    description: "Official Kalyan Hospital and Sri Vashishtha Kalyan Trust sidebar branding"
    requirement: DASH-03
    verification:
      - kind: unit
        ref: "tests/test_main_window.py#test_sidebar_branding"
        status: pass
---

# Plan 01-01 Summary: App Shell & Navigation Foundation

Implemented the base desktop application shell for Kalyan Hospital using Python and PySide6:
1. **Config & Styles:** Established `app/config.py` with directory resolution for local data/photos/backups and `app/ui/styles.py` with hospital QSS styling tokens.
2. **Branded Sidebar:** Implemented `app/ui/sidebar.py` featuring "कल्याण हॉस्पीटल", "KALYAN HOSPITAL", "PHYSIOTHERAPY DEPARTMENT", and "श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित" with 5 navigable sections.
3. **Main Window & Stacked Views:** Created `app/ui/main_window.py` wiring sidebar button clicks to page transitions in `QStackedWidget`.
4. **Smoke Testing:** Established `tests/conftest.py` (headless `qapp`) and `tests/test_main_window.py`.
