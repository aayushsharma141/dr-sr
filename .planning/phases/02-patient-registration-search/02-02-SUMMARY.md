---
phase: 02-patient-registration-search
plan: 02
subsystem: ui
tags: [pyside6, patient-form, patient-list, instant-search, stacked-navigation]

requires:
  - phase: 02-patient-registration-search
    provides: [PatientRepository, PatientService]
provides:
  - "PatientFormView capturing fields 1-10 + photo with inline validation"
  - "PatientListView with instant search filtering across ID, Name, and Mobile in real time"
  - "PatientModuleView composite stacked container managing list/form transitions"
  - "MainWindow integration at index 1 and automated UI test suite in tests/test_patient_ui.py"
affects: [03-treatment-billing, 04-print-backup]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [PySide6]
  patterns: [Instant search filtering on textChanged, Form load/clear state management, Composite stacked module]

key-files:
  created:
    - app/ui/views/patient_form_view.py
    - app/ui/views/patient_list_view.py
    - app/ui/views/patient_module_view.py
    - tests/test_patient_ui.py
  modified:
    - app/ui/main_window.py

key-decisions:
  - "Patient intake form adheres to canonical fields 1-10 matching official prescription pad."
  - "Search triggers dynamically on textChanged with zero lag against local SQLite index."
  - "Patient module operates in a sub-stack, allowing seamless switching between directory and form."

requirements-completed:
  - PAT-04
  - PAT-05

coverage:
  - id: D1
    description: "Instant patient search filtering by URN, Name, or Mobile"
    requirement: PAT-04
    verification:
      - kind: unit
        ref: "tests/test_patient_ui.py#test_patient_list_search_filtering"
        status: pass
  - id: D2
    description: "Patient profile editing through interactive UI form"
    requirement: PAT-05
    verification:
      - kind: unit
        ref: "tests/test_patient_ui.py#test_patient_module_transitions"
        status: pass
---

# Plan 02-02 Summary: Patient Registration & Search UI

Delivered the visual patient intake and directory management interfaces:
1. **Patient Registration Form:** `PatientFormView` captures all canonical demographic fields (1–10 + Photo) with inline validation and photo file picking.
2. **Searchable Directory:** `PatientListView` features instant search filtering, sortable columns, and quick action buttons for editing and starting treatment sessions.
3. **Module View & MainWindow Integration:** `PatientModuleView` embeds into `MainWindow` at index 1, managing smooth transitions between list and form modes.
4. **Automated UI Testing:** `tests/test_patient_ui.py` confirms form validation, search filtering, and module transitions.
