---
name: healthcare-emr-hms
description: "Clinical guidelines, domain workflows, data contracts, and best practices for Hospital Management Systems (HMS), Electronic Medical Records (EMR), and Clinic Billing Software. Use when designing clinical data schemas, patient identifiers (UHID), OPD/IPD flows, treatment logs, thermal receipt printing, barcode integration, or medical audit logging."
---

# Healthcare EMR & Hospital Management Systems (HMS) Guide

This skill provides domain engineering standards and workflows for building resilient clinic and hospital management software.

## 1. Patient Identification: Unique Health ID (UHID / URN)
* Never rely on auto-incrementing database integers (`1, 2, 3`) as patient-facing identifiers.
* Implement sequential, tamper-evident identifiers:
  * Format: `[HOSPITAL_PREFIX]-[YEAR]-[SEQUENCE]` (e.g., `KH-2026-0001`).
* Use atomic database sequences (backed by a dedicated `sqlite_sequence` or lock table) to ensure zero duplicate IDs across concurrent operations.

## 2. Deterministic Financial Math (Paise Integer Rule)
* **Never use IEEE-754 floating-point numbers (`float`) for currency or billing amounts.**
* Store all financial values as integers in **paise** (1 INR = 100 paise):
  * `₹ 350.00` is stored as `35000` integer.
* Formatting utility:
```python
def format_inr(paise: int) -> str:
    rupees = paise / 100.0
    return f"₹ {rupees:,.2f}"

def parse_inr_to_paise(rupee_str: str) -> int:
    cleaned = rupee_str.replace("₹", "").replace(",", "").strip()
    return int(round(float(cleaned) * 100))
```
* Ledger integrity rule: `Balance = Total Fee - Sum(Receipt Payments)`. Always calculate balance from ledger entries rather than storing unverified mutable balance fields.

## 3. Peripheral Hardware Integration

### Barcode & QR Scanners (HID Wedge Mode)
* Most USB/Bluetooth barcode scanners emulate a rapid keyboard followed by `Enter`.
* When capturing barcode input in UI:
  * Fast-track input detection: Scanner characters arrive within <15ms intervals, whereas human keystrokes are >80ms.
  * Connect `returnPressed` on search input fields to immediately trigger record fetch.
  * Standard symbology for wristbands/charts: **Code-128** or **DataMatrix**.

### Thermal Receipt Printers (58mm / 80mm ESC/POS)
* Use raw ESC/POS byte sequences for thermal receipts (cash receipts, OPD tokens, appointment slips):
  * `0x1B, 0x40`: Initialize printer
  * `0x1B, 0x61, 0x01`: Center alignment
  * `0x1D, 0x56, 0x41, 0x00`: Cut paper (full cut)
* Thermal printers require fixed character widths:
  * 58mm printer: ~32 characters per line (Font A).
  * 80mm printer: ~48 characters per line (Font A).

## 4. Clinical Workflow & Status Lifecycle
* **OPD Flow:** Registration (Patient Master) ➔ Token Generation ➔ Doctor Consultation ➔ Diagnosis & Prescription ➔ Pharmacy/Physiotherapy Service ➔ Billing & Discharge.
* **Physiotherapy Case Sessions:**
  * Track `total_sessions_prescribed` vs `sessions_completed`.
  * Log modalities applied per session (e.g., IFT, Traction, Ultrasound Therapy, TENS, Exercise Therapy) with clinician notes and pain scale (1–10).
* **Immutable Medical Records:**
  * Once a clinical consultation or doctor note is finalized, modifications must be recorded as an addendum with doctor timestamp, never silently updated in place.

## 5. Audit Logging & Compliance
* Every action that views, updates, exports, or prints patient records must generate an audit log entry:
  * Fields: `timestamp`, `user_id`, `action` (VIEW / UPDATE / EXPORT / PRINT), `patient_urn`, `ip_or_terminal`, `reason`.
