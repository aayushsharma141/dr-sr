"""
Print output regression tests: HTML escaping, single-page A4 records, receipt length.
"""

import os
import subprocess
import sys
import textwrap

import pytest

from app.services.document_builder import DocumentBuilder
from app.services.print_service import PrintService, safe_filename

HOSTILE = '<script>alert(1)</script> & "quoted" <b>bold</b>'


def _patient(**overrides):
    data = {
        "serial_urn_no": "KH-2026-0001", "patient_name": "Ramesh Kumar Sharma", "age": 45, "sex": "Male",
        "address": "Station Road, Nawada, Ara, Bhojpur", "mobile_no": "9876543210",
        "patient_in": "2026-10-28 09:30:00", "patient_out": None, "referred_by": "Dr. S. K. Singh",
        "patient_condition": "Chronic Lumbar Spondylosis", "doctor_name": "Dr. Madan Mohan Dwivedi",
    }
    data.update(overrides)
    return data


def test_registration_and_prescription_escape_user_text():
    patient = _patient(
        patient_name=HOSTILE, address=HOSTILE, referred_by=HOSTILE,
        patient_condition=HOSTILE, doctor_name=HOSTILE,
    )
    case = {"title": HOSTILE, "no_of_sessions": 5, "notes": HOSTILE, "total_amount_paise": 100000}
    for html in (
        DocumentBuilder.build_patient_registration_html(patient, case_data=case),
        DocumentBuilder.build_prescription_slip_html(patient, case_data=case),
    ):
        assert "<script>" not in html
        assert "<b>bold</b>" not in html
        assert "&lt;script&gt;" in html


def test_receipt_shows_assigned_doctor_escaped():
    html = DocumentBuilder.build_thermal_receipt_html(
        _patient(doctor_name=HOSTILE),
        {"title": "Rehab", "no_of_sessions": 5},
        {"id": 7, "amount_paid_paise": 50000, "payment_mode": "CASH"},
    )
    assert "Doctor:" in html and "<script>" not in html


def test_safe_filename_strips_path_and_punctuation():
    assert safe_filename("Receipt #0007 — Asha/Devi") == "Receipt_0007_AshaDevi"
    assert safe_filename("///") == "Document"


@pytest.mark.skipif(
    os.environ.get("QT_QPA_PLATFORM") == "offscreen",
    reason="QPrinter requires Windows GDI platform and crashes under offscreen QPA (0x80040155)",
)
def test_thermal_page_height_grows_with_content():
    short = DocumentBuilder.build_thermal_receipt_html(
        _patient(), {"title": "Rehab", "no_of_sessions": 5},
        {"id": 1, "amount_paid_paise": 50000, "payment_mode": "CASH"},
    )
    long = DocumentBuilder.build_thermal_receipt_html(
        _patient(patient_condition="Very long condition text " * 20), {"title": "Rehab " * 20, "no_of_sessions": 5},
        {"id": 1, "amount_paid_paise": 50000, "payment_mode": "CASH", "reference_note": "ref " * 40},
    )
    assert PrintService.thermal_height_for(long) > PrintService.thermal_height_for(short)
    assert PrintService.page_count(long, thermal=True) == 1


@pytest.mark.skipif(sys.platform != "win32", reason="needs the Windows font set the clinic PC uses")
def test_a4_documents_fit_one_page_with_photo(tmp_path):
    """Run with real fonts (the offscreen test platform has none, so text measures far too wide)."""
    script = textwrap.dedent(f'''
        import sys
        sys.path.insert(0, {os.getcwd()!r})
        from PySide6.QtGui import QColor, QImage
        from PySide6.QtWidgets import QApplication
        app = QApplication([])
        from app.services.document_builder import DocumentBuilder
        from app.services.print_service import PrintService
        photo = {str(tmp_path / "photo.jpg")!r}
        image = QImage(350, 450, QImage.Format.Format_RGB32)
        image.fill(QColor("#8899aa"))
        image.save(photo, "JPG")
        patient = {_patient()!r}
        patient["photo_full_path"] = photo
        case = {{"title": "Lumbar Rehab", "no_of_sessions": 10, "total_amount_paise": 350000, "notes": "Traction and IFT"}}
        fin = {{"total_fee_formatted": "Rs 3,500", "total_paid_formatted": "Rs 1,000", "balance_formatted": "Rs 2,500"}}
        pages = {{
            "registration": PrintService.page_count(DocumentBuilder.build_patient_registration_html(patient, case, fin)),
            "blank_registration": PrintService.page_count(DocumentBuilder.build_patient_registration_html({{}})),
            "prescription": PrintService.page_count(DocumentBuilder.build_prescription_slip_html(patient, case)),
        }}
        print(pages)
        sys.exit(0 if all(count == 1 for count in pages.values()) else 1)
    ''')
    env = dict(os.environ, QT_QPA_PLATFORM="windows")
    result = subprocess.run([sys.executable, "-I", "-c", script], env=env, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr


def test_registration_pad_contains_canonical_12_fields_and_dual_signatures():
    """Verify that registration HTML contains all 12 numbered fields and authentic dual signatures."""
    patient = _patient()
    case = {"title": "Cervical Traction", "no_of_sessions": 7, "total_amount_paise": 210000}
    fin = {"total_fee_formatted": "₹ 2,100", "total_paid_formatted": "₹ 1,000", "balance_formatted": "₹ 1,100"}
    html = DocumentBuilder.build_patient_registration_html(patient, case_data=case, financial_summary=fin)

    # 1. Official branding & Doctors
    assert "KALYAN HOSPITAL" in html
    assert "PHYSIOTHERAPY DEPARTMENT" in html
    assert "Madan Mohan Dwivedi" in html
    assert "Chandan Kr. Dwivedi" in html

    # 2. Canonical numbered fields
    assert "1. Serial / URN No." in html or "Serial" in html
    assert "2. Patient Name" in html
    assert "3. Age" in html
    assert "4. Sex" in html
    assert "5. Address" in html
    assert "6. Mobile No." in html
    assert "7. Patient In" in html
    assert "8. Patient Out" in html
    assert "9. Reference / Referred By" in html
    assert "10. Patient Condition" in html
    assert "11. No. of Sessions" in html
    assert "12. Payment Details" in html

    # 3. Dual signatures
    assert "Patient / Attendant Signature" in html
    assert "Authorized Signature" in html
    assert "Kalyan Hospital, Ara (Bihar)" in html

