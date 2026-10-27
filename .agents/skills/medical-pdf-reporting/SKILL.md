---
name: medical-pdf-reporting
description: "Guidelines and best practices for generating pixel-perfect medical reports, prescription slips, thermal receipts, and discharge certificates in Python. Use when working with ReportLab, WeasyPrint, dual-language typography (Hindi Devanagari + English), embedded photos, barcodes/QR codes, or automated PDF print queues."
---

# Medical PDF & Document Reporting Guide

This skill provides production standards for generating crisp, legally authentic medical documents, bilingual clinic prescription pads, and thermal cash receipts in Python.

## 1. Choosing the Reporting Engine
* **ReportLab:** Gold standard for headless, deterministic Python PDF generation. Operates without requiring an active Windows print spooler or web browser. Best for standalone desktop systems.
* **WeasyPrint / Headless Chrome (Puppeteer):** Best when styling documents with HTML5 and CSS paged media (`@page`, `@media print`).

## 2. Bilingual Typography (Devanagari Hindi & English)
Hospital documents in India often require official Hindi trust headers alongside English clinical data:
* Default PDF fonts (Helvetica, Times) do not include Devanagari glyphs and render as blank boxes or question marks.
* Register TrueType fonts (`TTFont`) that support Unicode Devanagari:
  * **Mangal**, **Nirmala UI**, or **Noto Sans Devanagari**.

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register Unicode Font for Hindi & English support
pdfmetrics.registerFont(TTFont('Nirmala', 'C:/Windows/Fonts/Nirmala.ttf'))
pdfmetrics.registerFont(TTFont('Nirmala-Bold', 'C:/Windows/Fonts/NirmalaB.ttf'))
```

## 3. Official Prescription Pad & Registration Card Structure
Every official hospital document must strictly follow clinical record standards:
1. **Header Zone:**
   * Trust / Organization Name (Hindi + English).
   * Hospital Name in bold branding (`#6B1736` Deep Maroon).
   * Clinician Credentials & Registration Council numbers.
   * Clinic Branch Addresses and emergency contact numbers.
2. **Patient Demographic Grid:**
   * `1. Serial / URN No.` (Unique Health ID).
   * `2. Patient Name`, `3. Age`, `4. Sex`, `5. Address`, `6. Mobile No.`.
   * `7. Patient In`, `8. Patient Out`.
   * `9. Reference / Referred By`, `10. Patient Condition`.
   * Embedded Patient Photo (right aligned, passport size).
3. **Clinical / Case Details:**
   * `11. No. of Sessions` & Modalities Prescribed.
   * `12. Payment Details` (Fee, Paid, Balance in INR).
4. **Footer Zone:**
   * Left: "Patient / Attendant Signature".
   * Right: "Authorized Signature & Date".
   * Disclaimer: "Not valid for medico-legal purposes" or institutional statutory notice.

## 4. Thermal Printer Slip Layout (58mm / 80mm Roll)
For thermal receipt printers, do not use standard A4 dimensions. Configure continuous roll dimensions:
* 80mm width: `width = 80 * mm`, `height = variable * mm`.
* Margins: `leftMargin = 2 * mm`, `rightMargin = 2 * mm`.
* Keep font sizes readable (8pt - 10pt bold for totals and receipt tokens).
* Append cut command at the end of ESC/POS output.
