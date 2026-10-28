# Kalyan Hospital — Patient & Physiotherapy Management System

A standalone, 100% offline Windows desktop application built with Python, PySide6 (Qt 6), and SQLite 3 for **Kalyan Hospital** (operated by श्री वशिष्ठ कल्याण ट्रस्ट, Ara, Bhojpur, Bihar).

---

## Features (Phase 1 — Stage A)

- **Trust-Led Clinical Branding:** Forest green (`#155B43`) and clinical blue (`#234B86`) with restrained gold accents (`#C39A35`), supplied hospital logo, bilingual trust identity, clinician credentials, and both clinic branch addresses (Ara & Gadhani). The printed A4 prescription retains the physical pad's maroon header.
- **Navigation Sidebar:** Seamless routing between Dashboard, Patients, Treatment Sessions, Billing & Payments, and Backups.
- **Live Database-Backed Dashboard:** Real-time metrics calculated from local SQLite database (Total Patients, Today's Admissions, Active Treatment Cases, and Outstanding Balance in ₹). Zero hardcoded mock numbers.
- **Local-First & Offline:** Zero internet dependency, no telemetry, no cloud accounts.

---

## Requirements

- Python 3.10+ (64-bit recommended)
- Windows 10 or Windows 11

---

## Quick Start (VS Code / PowerShell)

### 1. Create and Activate Virtual Environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

*(If PowerShell execution policy prevents activation, run commands directly via `.venv\Scripts\python.exe`)*

### 2. Install Dependencies

```powershell
pip install -r requirements.txt
```

### 3. Launch the Application

- **Option A (One-click double-click):** Double-click `run.bat` in File Explorer.
- **Option B (PowerShell):**
  ```powershell
  .\.venv\Scripts\python.exe main.py
  ```

---

## Build Standalone Windows Executable

After installing the development dependencies, run `build_exe.bat` from the repository root on Windows. The build includes the SQLite schema and `app/assets/` (hospital logo, physiotherapy banner, and Caduceus emblem) in the `dist/KalyanHospital/` folder.

Before distributing the build, launch `dist/KalyanHospital/KalyanHospital.exe` on a clean Windows workstation and verify the sidebar logo, dashboard therapy image, prescription letterhead emblem, print preview, and a test print. The headless test suite does not replace Windows printer validation.

---

## Running Automated Tests

Run the automated test suite in headless mode:

```powershell
pytest
```

---

## Project Structure

```text
├── main.py                     # Application entry point
├── requirements.txt            # Python dependencies (PySide6, pytest)
├── README.md                   # Setup and execution guide
├── PRD.md                      # Product Requirements Document
├── ARCHITECTURE.md             # Technical design & schema DDL
├── TASKS.md                    # Implementation breakdown
├── TEST_PLAN.md                # Quality assurance test matrix
├── SECURITY.md                 # Offline security controls
├── DECISIONS.md                # Architecture Decision Records (ADRs)
├── app/
│   ├── config.py               # Paths, constants, and clinic metadata
│   ├── db/
│   │   ├── connection.py       # SQLite connection factory (WAL, foreign keys)
│   │   └── schema.sql          # Canonical 12-field DDL
│   ├── services/
│   │   └── dashboard_service.py # Live metric calculations
│   └── ui/
│       ├── main_window.py      # Top QMainWindow and page container
│       ├── sidebar.py          # Left navigation sidebar
│       ├── styles.py           # Hospital QSS stylesheet
│       └── views/
│           ├── dashboard_view.py # Live clinic dashboard
│           └── placeholder_view.py # Staging placeholder cards
└── tests/
    ├── conftest.py             # Headless QApplication fixture
    ├── test_main_window.py     # Shell & navigation tests
    └── test_dashboard.py       # Database & dashboard metric tests
```
