---
phase: 04-a4-printing-backup
plan: 01
subsystem: printing-and-export
tags: [a4-printing, prescription-slip, pdf-export, qtextdocument, qprinter]

requires:
  - phase: 02-patient-registration-search
    provides: [PatientService]
  - phase: 03-treatment-cases-payments
    provides: [BillingService, TreatmentService]
provides:
  - "DocumentBuilder generating ISO A4 printable HTML matching official prescription pad"
  - "PrintService providing QPrintPreviewDialog, QPrintDialog, and direct vector PDF export"
  - "Integrated Print Registration button on patient list view"
  - "Automated unit test suite in tests/test_print_service.py"
affects: [04-02, 05-demo-hardening]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [PySide6.QtPrintSupport, base64]
  patterns: [ISO A4 portrait HTML layout, Vector PDF generation, Base64 embedded patient photography]

key-files:
  created:
    - app/services/document_builder.py
    - app/services/print_service.py
    - tests/test_print_service.py
  modified:
    - app/ui/views/patient_list_view.py

key-decisions:
  - "Prescription slip header uses Deep Maroon (#6B1736) with gold accents, Caduceus emblem, both clinic branches, and clinicians."
  - "Form reproduces all 12 canonical fields, 35mm x 45mm Patient Picture box, and dual bottom signatures (Patient/Attendant & Authorized) + Date."
  - "Direct PDF export renders through QPrinter in A4 portrait format without external third-party dependencies."

requirements-completed:
  - PRN-01
  - PRN-02
  - PRN-03

coverage:
  - id: D1
    description: "Official hospital-branded A4 registration document generation"
    requirement: PRN-01, PRN-02
    verification:
      - kind: unit
        ref: "tests/test_print_service.py#test_document_builder_all_12_fields"
        status: pass
  - id: D2
    description: "Vector PDF file export"
    requirement: PRN-03
    verification:
      - kind: unit
        ref: "tests/test_print_service.py#test_pdf_export_generation"
        status: pass
---

# Plan 04-01 Summary: A4 Prescription Slip Generator & PDF Exporter

Delivered the official hospital-branded A4 patient registration card generator and PDF export pipeline:
1. **A4 Document Builder:** `DocumentBuilder` generates pixel-accurate HTML conforming to Kalyan Hospital's authentic physical prescription pad: Deep Maroon `#6B1736` banner, "श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित", Caduceus emblem, both Ara & Gadhani addresses, clinicians Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi, 12 numbered fields, top-right photo box, and bottom dual signatures + Date.
2. **Print & PDF Exporter:** `PrintService` wraps `QTextDocument` and `QPrinter` for native `QPrintPreviewDialog` and direct vector PDF export.
3. **UI Integration & Tests:** Added "🖨️ Print" action to `PatientListView`. `tests/test_print_service.py` validates branding tokens, all 12 fields, dual signatures, and verified PDF file generation.
