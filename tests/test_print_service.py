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
    """Verifies that generated HTML includes official clinic branding and clinicians."""
    html = DocumentBuilder.build_patient_registration_html(sample_patient_dict)

    # Trust & Hospital Name
    assert "श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित" in html
    assert "KALYAN HOSPITAL" in html
    assert "#6B1736" in html  # Deep Maroon Header

    # Clinicians
    assert "Dr. Madan Mohan Dwivedi" in html
    assert "Senior Physiotherapist (Ex Sadar Hospital, Arrah)" in html
    assert "Dr. Chandan Kr. Dwivedi" in html
    assert "Physiotherapist (NIMHANS, Apollo Bangalore)" in html

    # Branches
    assert "स्टेशन रोड, नवादा थाना के सामने वाली गली, आरा" in html
    assert "श्रीरामपुर रोड, गड़हनी, भोजपुर" in html


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
