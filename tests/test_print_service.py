"""
Automated tests for DocumentBuilder and PrintService.
Kalyan Hospital Management System.
"""

import os
import pytest
from app.services.document_builder import DocumentBuilder
from app.services.print_service import PrintService


@pytest.fixture
def sample_patient_dict():
    return {
        "serial_urn_no": "KH-2026-0001",
        "patient_name": "Ramesh Kumar Sharma",
        "age": 48,
        "sex": "Male",
        "address": "Station Road, Nawada, Ara, Bhojpur",
        "mobile_no": "9876543210",
        "patient_in": "2026-10-28 09:30",
        "patient_out": "2026-10-28 11:00",
        "referred_by": "Dr. S. K. Singh",
        "patient_condition": "Severe Lumbar Spondylosis with Radiculopathy",
    }


@pytest.fixture
def sample_case_dict():
    return {
        "title": "Lumbar Spondylosis Physiotherapy",
        "no_of_sessions": 10,
        "total_amount_paise": 350000,
    }


@pytest.fixture
def sample_financial_summary():
    return {
        "total_fee_formatted": "₹ 3,500.00",
        "total_paid_formatted": "₹ 1,500.00",
        "balance_formatted": "₹ 2,000.00",
    }


def test_document_builder_contains_official_branding(sample_patient_dict):
    """Verifies that generated HTML includes official clinic branding and clinicians matching the physical pad."""
    html = DocumentBuilder.build_patient_registration_html(sample_patient_dict)

    # Hospital Name & Department
    assert "कल्याण हॉस्पीटल" in html
    assert "PHYSIOTHERAPY DEPARTMENT" in html
    assert "#6B1736" in html  # Deep Maroon Header

    # Clinicians
    assert "Dr. Madan Mohan Dwivedi" in html
    assert "Ex Sadar Hospital, Arrah (Bhojpur)" in html
    assert "Dr. Chandan Kr. Dwivedi" in html
    assert "Ex. INT. NIMHANS - Bangalore" in html
    assert "Ex. INT. APOLLO - Bangalore" in html
    assert "फिजियोरत्न से सम्मानित" in html
    assert "फिजियोथेरेपिस्ट" in html

    # Branches
    assert "नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर" in html
    assert "श्रीरामपुर रोड, गड़हनी, प्रखण्ड- उदवन्तनगर" in html


def test_document_builder_all_12_fields(sample_patient_dict, sample_case_dict, sample_financial_summary):
    """Verifies that all 12 numbered fields are rendered with patient/case data."""
    html = DocumentBuilder.build_patient_registration_html(
        patient_data=sample_patient_dict,
        case_data=sample_case_dict,
        financial_summary=sample_financial_summary,
    )

    # 1. Serial / URN No.
    assert "1. Serial / URN No.:" in html
    assert "KH-2026-0001" in html

    # 2. Patient Name
    assert "2. Patient Name:" in html
    assert "Ramesh Kumar Sharma" in html

    # 3. Age & 4. Sex
    assert "3. Age:" in html
    assert "48 Yrs" in html
    assert "4. Sex:" in html
    assert "Male" in html

    # 5. Address
    assert "5. Address:" in html
    assert "Station Road, Nawada, Ara" in html

    # 6. Mobile No.
    assert "6. Mobile No.:" in html
    assert "9876543210" in html

    # 7. Patient In & 8. Patient Out
    assert "7. Patient In" in html
    assert "8. Patient Out" in html

    # 9. Reference / Referred By
    assert "9. Reference / Referred By:" in html
    assert "Dr. S. K. Singh" in html

    # 10. Patient Condition
    assert "10. Patient Condition:" in html
    assert "Severe Lumbar Spondylosis" in html

    # 11. No. of Sessions
    assert "11. No. of Sessions:" in html
    assert "10 Sessions" in html

    # 12. Payment Details
    assert "12. Payment Details:" in html
    assert "₹ 3,500.00" in html
    assert "₹ 1,500.00" in html
    assert "₹ 2,000.00" in html


def test_document_builder_dual_signatures(sample_patient_dict):
    """Verifies dual bottom signature lines and date per authentic prescription pad."""
    html = DocumentBuilder.build_patient_registration_html(sample_patient_dict)

    assert "Patient / Attendant Signature" in html
    assert "Authorized Signature" in html
    assert "Date:" in html


def test_photo_embedding_in_html(sample_patient_dict, tmp_path):
    """Verifies that an image file is converted to base64 data URI in HTML."""
    # Create dummy image file
    img_file = tmp_path / "test_photo.jpg"
    img_file.write_bytes(b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xFF\xDB")

    html = DocumentBuilder.build_patient_registration_html(
        patient_data=sample_patient_dict,
        photo_path=str(img_file),
    )
    assert "data:image/jpeg;base64," in html


def test_prescription_slip_generation(sample_patient_dict, sample_case_dict):
    """Verifies that prescription slip HTML reproduces authentic pad letterhead and Rx symbol."""
    html = DocumentBuilder.build_prescription_slip_html(
        patient_data=sample_patient_dict,
        case_data=sample_case_dict,
    )

    # The local emblem is embedded in HTML so print preview does not need a remote URL.
    assert 'alt="Caduceus"' in html
    assert "data:image/png;base64," in html

    # Letterhead branding
    assert "कल्याण हॉस्पीटल" in html
    assert "PHYSIOTHERAPY DEPARTMENT" in html
    assert "Sl No." in html
    assert "KH-2026-0001" in html
    assert "Dr. Madan Mohan Dwivedi" in html
    assert "Dr. Chandan Kr. Dwivedi" in html
    assert "फिजियोरत्न से सम्मानित" in html
    assert "फिजियोथेरेपिस्ट" in html

    # Patient info strip
    assert "Name" in html
    assert "Ramesh Kumar Sharma" in html
    assert "Age / Sex" in html
    assert "Add." in html

    # Rx & protocol
    assert "℞" in html
    assert "Severe Lumbar Spondylosis" in html
    assert "10 Sessions" in html
    assert "Authorized Physiotherapist Signature" in html


@pytest.mark.skip(
    reason=(
        "QPrinter on Windows requires COM/Print Spooler which crashes in headless "
        "environments (0x80040155). PDF export is verified manually via the UI."
    )
)
def test_pdf_export_generation(qapp, sample_patient_dict, sample_case_dict, tmp_path):
    """Verifies that PrintService exports a valid non-empty PDF file."""
    html = DocumentBuilder.build_patient_registration_html(
        patient_data=sample_patient_dict,
        case_data=sample_case_dict,
    )
    pdf_out = tmp_path / "test_registration.pdf"

    generated_path = PrintService.export_to_pdf(html, str(pdf_out))

    assert os.path.exists(generated_path)
    assert os.path.getsize(generated_path) > 1000  # PDF is non-empty and well-formed


def test_thermal_receipt_builder_includes_installment_and_current_balance(
    sample_patient_dict, sample_case_dict, sample_financial_summary
):
    """80mm receipt output includes the saved installment and transparently labels current balance."""
    payment = {
        "id": 7,
        "amount_paid_paise": 150000,
        "payment_mode": "UPI",
        "payment_timestamp": "2026-10-28 10:15:00",
        "reference_note": "GPay <REF>&",
        "recorded_by": "Staff",
    }
    html = DocumentBuilder.build_thermal_receipt_html(
        patient_data=sample_patient_dict,
        case_data=sample_case_dict,
        payment_data=payment,
        financial_summary=sample_financial_summary,
    )

    assert "size: 80mm 240mm" in html
    assert "RCPT-0007" in html
    assert "Ramesh Kumar Sharma" in html
    assert "KH-2026-0001" in html
    assert "₹ 1,500.00" in html
    assert "₹ 3,500.00" in html
    assert "₹ 2,000.00" in html
    assert "Current balance as of this receipt's print time" in html
    assert "GPay &lt;REF&gt;&amp;" in html
    assert "GPay <REF>&" not in html


def test_thermal_printer_uses_custom_80mm_page(qapp, tmp_path):
    """Thermal print setup uses a custom 80mm page rather than the A4 preset."""
    from PySide6.QtGui import QPageSize

    pdf_spec = str(tmp_path / "spec_test_thermal.pdf")

    printer = PrintService.create_thermal_printer(pdf_path=pdf_spec)
    page_size = printer.pageLayout().pageSize()
    size_mm = page_size.size(QPageSize.Unit.Millimeter)

    assert abs(size_mm.width() - 80.0) < 0.5
    assert abs(size_mm.height() - 240.0) < 0.5
    assert "Thermal Receipt" in page_size.name()


def test_export_to_pdf_with_dialog_cancelled(monkeypatch):
    """When user cancels QFileDialog, export_to_pdf_with_dialog returns None."""
    from PySide6.QtWidgets import QFileDialog

    monkeypatch.setattr(QFileDialog, "getSaveFileName", lambda *args, **kwargs: ("", ""))
    result = PrintService.export_to_pdf_with_dialog("<html>test</html>")
    assert result is None


def test_export_to_pdf_with_dialog_selected_path(monkeypatch, tmp_path):
    """When user confirms a path in QFileDialog, export_to_pdf is called with .pdf suffix."""
    from PySide6.QtWidgets import QFileDialog

    target = str(tmp_path / "custom_doc")
    monkeypatch.setattr(QFileDialog, "getSaveFileName", lambda *args, **kwargs: (target, "PDF Files (*.pdf)"))
    monkeypatch.setattr(PrintService, "export_to_pdf", lambda html, out_path: out_path)

    result = PrintService.export_to_pdf_with_dialog("<html>test</html>")
    assert result == target + ".pdf"


def test_print_document_cancelled(monkeypatch):
    """When QPrintDialog is cancelled/rejected, print_document returns False."""
    from PySide6.QtPrintSupport import QPrintDialog

    monkeypatch.setattr(QPrintDialog, "exec", lambda self: QPrintDialog.DialogCode.Rejected)
    result = PrintService.print_document("<html>test</html>")
    assert result is False


def test_registration_document_fits_one_a4_page(qapp, sample_patient_dict, sample_case_dict, sample_financial_summary):
    """The complete registration record, including both signatures and footer, must fit one A4 page."""
    from PySide6.QtCore import QSizeF
    from PySide6.QtGui import QTextDocument

    html = DocumentBuilder.build_patient_registration_html(
        patient_data=sample_patient_dict,
        case_data=sample_case_dict,
        financial_summary=sample_financial_summary,
    )

    # Match PrintService's ScreenResolution paint area with 8 mm margins at 96 DPI.
    printable_width = (210.0 - 16.0) * 96.0 / 25.4
    printable_height = (297.0 - 16.0) * 96.0 / 25.4
    document = QTextDocument()
    document.setPageSize(QSizeF(printable_width, printable_height))
    document.setHtml(html)

    assert document.pageCount() == 1, (
        f"Registration output paginated to {document.pageCount()} pages; "
        "reduce vertical layout before splitting signatures or footer."
    )


def test_a4_print_templates_escape_patient_and_case_text(sample_patient_dict, sample_case_dict):
    """User-entered values must remain text rather than becoming printable HTML markup."""
    from copy import deepcopy

    patient = deepcopy(sample_patient_dict)
    patient["patient_name"] = 'Anita <b>Singh</b> & Co "Clinic"'
    patient["address"] = '<img src=x onerror="bad"> Babu Bazar & Ara'
    patient["patient_condition"] = "<script>unsafe()</script> Shoulder pain"

    case = deepcopy(sample_case_dict)
    case["title"] = "<script>case()</script> & rehabilitation"
    case["notes"] = "<b>therapeutic plan</b> & review"

    registration_html = DocumentBuilder.build_patient_registration_html(
        patient_data=patient,
        case_data=case,
    )
    prescription_html = DocumentBuilder.build_prescription_slip_html(
        patient_data=patient,
        case_data=case,
    )

    for html in (registration_html, prescription_html):
        assert "<script>" not in html
        assert "<img src=x" not in html
        assert "&lt;script&gt;" in html
        assert "&amp;" in html

    assert "&lt;b&gt;Singh&lt;/b&gt;" in registration_html
    assert "&lt;b&gt;therapeutic plan&lt;/b&gt;" in prescription_html
