---
name: python-pytest-excellence
description: "Advanced testing practices for Python desktop and healthcare software. Use when writing unit tests with pytest, testing PySide6 widgets with pytest-qt (qtbot), setting up isolated SQLite in-memory fixtures, mocking hardware peripherals (scanners, printers), or measuring code coverage."
---

# Python & Pytest Healthcare Testing Excellence

This skill provides testing patterns for high-reliability clinical and financial desktop software.

## 1. PySide6 UI Testing with `pytest-qt` (`qtbot`)
Never rely purely on manual clicking to verify UI behavior. Use `pytest-qt` to simulate user interactions:

```python
import pytest
from PySide6.QtCore import Qt
from app.ui.views.patient_form_view import PatientFormView

def test_patient_form_submission(qtbot, tmp_path):
    # Initialize view
    view = PatientFormView(db_path=str(tmp_path / "test.db"))
    qtbot.addWidget(view)

    # Simulate keyboard typing into fields
    qtbot.keyClicks(view.name_input, "Ramesh Sharma")
    qtbot.keyClicks(view.age_input, "45")
    qtbot.keyClicks(view.mobile_input, "9876543210")
    qtbot.keyClicks(view.address_input, "Station Road, Ara")

    # Simulate clicking save button
    with qtbot.waitSignal(view.patient_saved, timeout=2000):
        qtbot.mouseClick(view.save_button, Qt.LeftButton)

    # Verify input was cleared and status shows success
    assert view.name_input.text() == ""
```

## 2. In-Memory Isolated Database Fixtures
Always isolate tests so they do not touch the production or development database file:

```python
import pytest
import sqlite3
from app.db.connection import get_db_connection, init_db

@pytest.fixture
def test_db(tmp_path):
    """Provides a fresh isolated database file per test function."""
    db_file = str(tmp_path / "test_hospital.db")
    init_db(db_file)
    yield db_file
    # Cleanup happens automatically when tmp_path is removed
```

## 3. Mocking Hardware Peripherals
Thermal printers and barcode scanners cannot be assumed to be physically connected during automated CI/CD runs:

```python
from unittest.mock import MagicMock, patch

def test_print_receipt_handles_printer_offline():
    with patch("app.services.print_service.serial.Serial") as mock_serial:
        mock_serial.side_effect = IOError("Printer port COM3 not found")
        
        # Test that service fails gracefully with user alert rather than application crash
        success, message = PrintService.print_thermal_receipt("KH-2026-0001")
        assert not success
        assert "Printer port COM3 not found" in message
```

## 4. Coverage Thresholds
Run coverage reports regularly:
```powershell
pytest --cov=app --cov-report=term-missing --cov-fail-under=85
```
Ensure 100% coverage on financial billing math (`BillingService`, paise arithmetic) and sequential ID generation (`PatientRepository`).
