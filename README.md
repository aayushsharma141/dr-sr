# Kalyan Hospital — Patient & Physiotherapy Management System

A standalone, 100% offline Windows desktop application built with Python, PySide6 (Qt 6), and SQLite 3 for **Kalyan Hospital** (operated by श्री वशिष्ठ कल्याण ट्रस्ट, Ara, Bhojpur, Bihar).

---

## Features (Phase 1 — Stage A)

- **Official Hospital Branding:** Deep maroon theme (`#6B1736`) with clinician credentials (Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi) and both clinic branch addresses (Ara & Gadhani).
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
