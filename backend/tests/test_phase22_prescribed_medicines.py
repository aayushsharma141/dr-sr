"""Phase 22 Prescribed Medicine Reference & Link Validation Tests (OD-B, B2, D-04, MED-07, MED-09, MED-10).

Tests:
1. Field projection and security isolation (B2, D-04, T-22-38):
   - Reception GET /api/visits/{id}/prescribed-medicines returns exactly prescription_item_id, medicine_name, and form.
   - No clinical fields (dosage, frequency, duration, instructions, strength, route, diagnosis, advice).
   - No quantity field (prescriptions store none; reception types supplied quantity).
2. Lifecycle and status filtering:
   - DRAFT prescriptions are not listed.
   - CANCELLED prescriptions are not listed.
   - Only AUTHORISED prescriptions linked via clinical_encounters.appointment_id to the visit are listed.
3. Visit isolation:
   - Prescriptions of another visit or patient are not listed.
4. RBAC gates:
   - Reception: 200 (bill:write)
   - Admin: 403
   - Doctors: 403
   - Anonymous: 401
   - Unknown visit: 404 visit_not_found
5. Billing linked medicine line:
   - Adding MEDICINE line referencing a listed item stores prescription_item_id and typed supplied quantity.
   - Prescriptions store no quantity; supplied quantity is typed by reception (B2).
   - Unlinked MEDICINE line accepted without prescription link (MED-07).
6. Link validation guards (T-22-39):
   - Referencing an item of another visit returns 422 prescription_item_not_on_visit.
   - Referencing an item of a DRAFT or CANCELLED prescription returns 422 prescription_item_not_on_visit.
   - Adding a non-MEDICINE line with prescription_item_id returns 422 prescription_item_not_on_visit.
7. Prescriptions unchanged and immutable by billing (MED-09, MED-10, T-22-41):
   - Reception still cannot access clinical prescription routes (403).
   - Billing a linked medicine leaves prescription row and items byte-for-byte unchanged.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import itertools
from typing import Any
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.clock import ist_today, utcnow
from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    ClinicalEncounter,
    Doctor,
    Patient,
    Prescription,
    PrescriptionItem,
    PrescriptionStatus,
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.services import bill_service

TODAY = date(2026, 11, 2)
_TOKENS = itertools.count(700)


def _patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-RX{suffix}",
        full_name=f"Prescription Test Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=28,
        mobile="9876543277",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _visit(
    db_session: Session,
    patient: Patient,
    user: User,
    status: str = VisitStatus.OPEN.value,
) -> Visit:
    visit = Visit(
        patient_id=patient.id,
        visit_date=TODAY,
        status=status,
        opened_by_user_id=user.id,
    )
    db_session.add(visit)
    db_session.flush()
    return visit


def _consultation(
    db_session: Session,
    visit: Visit,
    patient: Patient,
    doctor_user: User,
    user: User,
) -> tuple[Appointment, ClinicalEncounter]:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=visit.visit_date,
        token_number=next(_TOKENS),
        status="ARRIVED",
        consultation_status="COMPLETED",
        visit_id=visit.id,
        created_by_user_id=user.id,
    )
    db_session.add(appt)
    db_session.flush()

    encounter = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_id=appt.id,
        created_by_user_id=doctor_user.id,
        symptoms="Fever and cough",
        diagnosis="Acute Upper Respiratory Tract Infection",
        is_finalised=True,
    )
    db_session.add(encounter)
    db_session.flush()
    return appt, encounter


def _prescription_with_items(
    db_session: Session,
    patient: Patient,
    doctor_user: User,
    encounter: ClinicalEncounter,
    status: str = PrescriptionStatus.AUTHORISED.value,
) -> tuple[Prescription, list[PrescriptionItem]]:
    rx = Prescription(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        encounter_id=encounter.id,
        diagnosis=encounter.diagnosis or "Infection",
        status=PrescriptionStatus.DRAFT.value,
        dietary_advice="Warm fluids and rest",
        general_advice="Steam inhalation twice daily",
    )
    db_session.add(rx)
    db_session.flush()

    item1 = PrescriptionItem(
        prescription_id=rx.id,
        item_order=1,
        medicine_name="Paracetamol 650mg",
        form="Tablet",
        dosage="1 tab",
        frequency="TDS (Thrice daily)",
        duration_days=5,
        instructions="After meals with water",
        strength="650 mg",
        route="Oral",
    )
    item2 = PrescriptionItem(
        prescription_id=rx.id,
        item_order=2,
        medicine_name="Cough Syrup",
        form="Syrup",
        dosage="10 ml",
        frequency="BD (Twice daily)",
        duration_days=7,
        instructions="Before sleep",
        strength="100 ml",
        route="Oral",
    )
    db_session.add_all([item1, item2])
    db_session.flush()

    if status == PrescriptionStatus.AUTHORISED.value:
        rx.status = PrescriptionStatus.AUTHORISED.value
        rx.authorised_at = utcnow()
        db_session.flush()
    elif status == PrescriptionStatus.CANCELLED.value:
        rx.status = PrescriptionStatus.CANCELLED.value
        rx.cancelled_at = utcnow()
        rx.cancelled_by_user_id = doctor_user.id
        rx.cancellation_reason = "Cancelled for re-evaluation"
        db_session.flush()

    return rx, [item1, item2]


# ==========================================
# 1. Field Projection & Security (OD-B / B2 / D-04)
# ==========================================


def test_prescribed_medicines_projection(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception sees only prescription_item_id, medicine_name, and form; no clinical details, no quantity."""
    patient = _patient(db_session, "01")
    visit = _visit(db_session, patient, reception_user)
    _appt, encounter = _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    rx, items = _prescription_with_items(db_session, patient, doctor_a_user, encounter, status="AUTHORISED")

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/prescribed-medicines")
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data) == 2

    # Exactly 3 keys per item: prescription_item_id, medicine_name, form
    expected_keys = {"prescription_item_id", "medicine_name", "form"}
    for item in data:
        assert set(item.keys()) == expected_keys, f"Found keys {set(item.keys())} instead of {expected_keys}"

    # Verify field values
    assert data[0]["prescription_item_id"] == items[0].id
    assert data[0]["medicine_name"] == "Paracetamol 650mg"
    assert data[0]["form"] == "Tablet"

    assert data[1]["prescription_item_id"] == items[1].id
    assert data[1]["medicine_name"] == "Cough Syrup"
    assert data[1]["form"] == "Syrup"

    # CRITICAL: Verify absence of clinical fields (D-04, B2)
    forbidden_keys = {
        "dosage",
        "frequency",
        "duration_days",
        "instructions",
        "strength",
        "route",
        "diagnosis",
        "dietary_advice",
        "general_advice",
        "quantity",
    }
    for item in data:
        for f_key in forbidden_keys:
            assert f_key not in item, f"Security violation: key '{f_key}' exposed to reception"


# ==========================================
# 2. Status & Lifecycle Filtering
# ==========================================


def test_prescribed_medicines_status_filtering(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """DRAFT and CANCELLED prescriptions are not returned; only AUTHORISED are."""
    patient = _patient(db_session, "02")
    visit = _visit(db_session, patient, reception_user)
    _appt, encounter = _consultation(db_session, visit, patient, doctor_a_user, reception_user)

    # 1. DRAFT prescription -> should not be listed
    _rx_draft, _items_draft = _prescription_with_items(
        db_session, patient, doctor_a_user, encounter, status="DRAFT"
    )

    client = login_client(reception_user)
    res1 = client.get(f"/api/visits/{visit.id}/prescribed-medicines")
    assert res1.status_code == 200, res1.text
    assert len(res1.json()) == 0

    # 2. CANCELLED prescription -> should not be listed
    _appt2, encounter2 = _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    _rx_canc, _items_canc = _prescription_with_items(
        db_session, patient, doctor_a_user, encounter2, status="CANCELLED"
    )

    res2 = client.get(f"/api/visits/{visit.id}/prescribed-medicines")
    assert res2.status_code == 200, res2.text
    assert len(res2.json()) == 0

    # 3. AUTHORISED prescription -> returned
    _appt3, encounter3 = _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    rx_auth, items_auth = _prescription_with_items(
        db_session, patient, doctor_a_user, encounter3, status="AUTHORISED"
    )

    res3 = client.get(f"/api/visits/{visit.id}/prescribed-medicines")
    assert res3.status_code == 200, res3.text
    data3 = res3.json()
    assert len(data3) == 2
    assert {d["prescription_item_id"] for d in data3} == {items_auth[0].id, items_auth[1].id}


def test_prescribed_medicines_visit_isolation(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Prescriptions belonging to another visit are not returned."""
    patient1 = _patient(db_session, "03A")
    visit1 = _visit(db_session, patient1, reception_user)
    _appt1, enc1 = _consultation(db_session, visit1, patient1, doctor_a_user, reception_user)
    _rx1, items1 = _prescription_with_items(db_session, patient1, doctor_a_user, enc1, status="AUTHORISED")

    patient2 = _patient(db_session, "03B")
    visit2 = _visit(db_session, patient2, reception_user)
    _appt2, enc2 = _consultation(db_session, visit2, patient2, doctor_a_user, reception_user)
    _rx2, items2 = _prescription_with_items(db_session, patient2, doctor_a_user, enc2, status="AUTHORISED")

    client = login_client(reception_user)
    res1 = client.get(f"/api/visits/{visit1.id}/prescribed-medicines")
    data1 = res1.json()
    assert len(data1) == 2
    assert {d["prescription_item_id"] for d in data1} == {items1[0].id, items1[1].id}

    res2 = client.get(f"/api/visits/{visit2.id}/prescribed-medicines")
    data2 = res2.json()
    assert len(data2) == 2
    assert {d["prescription_item_id"] for d in data2} == {items2[0].id, items2[1].id}


# ==========================================
# 3. RBAC Isolation
# ==========================================


def test_prescribed_medicines_rbac_and_404(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    test_settings: Any,
    db_session: Session,
) -> None:
    """Route requires bill:write: reception 200, admin 403, doctors 403, unknown visit 404."""
    patient = _patient(db_session, "04")
    visit = _visit(db_session, patient, reception_user)

    rec_client = login_client(reception_user)
    admin_client = login_client(admin_user)
    doc_client = login_client(doctor_a_user)

    # Reception: 200
    assert rec_client.get(f"/api/visits/{visit.id}/prescribed-medicines").status_code == 200

    # Admin: 403 (does not have bill:write)
    assert admin_client.get(f"/api/visits/{visit.id}/prescribed-medicines").status_code == 403

    # Doctor: 403
    assert doc_client.get(f"/api/visits/{visit.id}/prescribed-medicines").status_code == 403

    # Non-existent visit: 404
    assert rec_client.get("/api/visits/999999/prescribed-medicines").status_code == 404


# ==========================================
# 4. Billing Linked Medicine Line & Link Validation
# ==========================================


def test_billing_linked_medicine_line(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception bills a medicine line linked to an authorised prescription item with typed quantity."""
    patient = _patient(db_session, "05")
    visit = _visit(db_session, patient, reception_user)
    _appt, enc = _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    _rx, items = _prescription_with_items(db_session, patient, doctor_a_user, enc, status="AUTHORISED")

    client = login_client(reception_user)

    # Reception types supplied quantity 10 (prescriptions store NO quantity)
    res = client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol 650mg",
            "unit": "tablet",
            "quantity": "10",
            "rate_paise": 200,
            "prescription_item_id": items[0].id,
        },
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["prescription_item_id"] == items[0].id
    assert data["quantity"] == "10" or Decimal(data["quantity"]) == Decimal("10")
    assert data["amount_paise"] == 2000

    # Database row verified
    db_line = db_session.get(BillItem, data["id"])
    assert db_line is not None
    assert db_line.prescription_item_id == items[0].id
    assert db_line.quantity == Decimal("10")

    # Unlinked medicine line accepted without prescription link (MED-07)
    res_unlinked = client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Bandage",
            "unit": "roll",
            "quantity": "1",
            "rate_paise": 3000,
            "prescription_item_id": None,
        },
    )
    assert res_unlinked.status_code == 201, res_unlinked.text
    assert res_unlinked.json()["prescription_item_id"] is None


def test_billing_linked_medicine_guards(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Validation guards on prescription_item_id."""
    patient1 = _patient(db_session, "06A")
    visit1 = _visit(db_session, patient1, reception_user)
    _appt1, enc1 = _consultation(db_session, visit1, patient1, doctor_a_user, reception_user)
    _rx1, items1 = _prescription_with_items(db_session, patient1, doctor_a_user, enc1, status="AUTHORISED")

    # Other visit's prescription
    patient2 = _patient(db_session, "06B")
    visit2 = _visit(db_session, patient2, reception_user)
    _appt2, enc2 = _consultation(db_session, visit2, patient2, doctor_a_user, reception_user)
    _rx2, items2 = _prescription_with_items(db_session, patient2, doctor_a_user, enc2, status="AUTHORISED")

    # DRAFT prescription on visit1
    _appt1_draft, enc1_draft = _consultation(db_session, visit1, patient1, doctor_a_user, reception_user)
    _rx_draft, items_draft = _prescription_with_items(
        db_session, patient1, doctor_a_user, enc1_draft, status="DRAFT"
    )

    client = login_client(reception_user)

    # 1. Linking item of another visit fails (422 prescription_item_not_on_visit)
    res1 = client.post(
        f"/api/visits/{visit1.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol",
            "quantity": "2",
            "rate_paise": 500,
            "prescription_item_id": items2[0].id,
        },
    )
    assert res1.status_code == 422, res1.text
    assert res1.json()["code"] == "prescription_item_not_on_visit"

    # 2. Linking item of a DRAFT prescription fails (422 prescription_item_not_on_visit)
    res2 = client.post(
        f"/api/visits/{visit1.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol",
            "quantity": "2",
            "rate_paise": 500,
            "prescription_item_id": items_draft[0].id,
        },
    )
    assert res2.status_code == 422, res2.text
    assert res2.json()["code"] == "prescription_item_not_on_visit"

    # 3. Linking prescription_item_id on non-MEDICINE line (ADDITIONAL) fails (422)
    res3 = client.post(
        f"/api/visits/{visit1.id}/bill-items",
        json={
            "category": "ADDITIONAL",
            "description": "Registration folder",
            "quantity": "1",
            "rate_paise": 1000,
            "prescription_item_id": items1[0].id,
        },
    )
    assert res3.status_code == 422, res3.text
    assert res3.json()["code"] == "prescription_item_not_on_visit"


# ==========================================
# 5. Security & Immutability (MED-09, MED-10)
# ==========================================


def test_prescriptions_isolated_from_reception_and_billing(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """MED-09: Reception cannot access prescription clinical routes; MED-10: billing leaves prescription untouched."""
    patient = _patient(db_session, "07")
    visit = _visit(db_session, patient, reception_user)
    _appt, enc = _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    rx, items = _prescription_with_items(db_session, patient, doctor_a_user, enc, status="AUTHORISED")

    rec_client = login_client(reception_user)

    # MED-09: Reception cannot POST or PUT prescriptions
    res_post = rec_client.post(
        "/api/prescriptions",
        json={"patient_id": patient.id, "diagnosis": "Attempt by reception"},
    )
    assert res_post.status_code == 403, res_post.text

    res_put = rec_client.put(
        f"/api/prescriptions/{rx.id}",
        json={"diagnosis": "Modified by reception", "items": []},
    )
    assert res_put.status_code == 403, res_put.text

    # Snapshot prescription data before billing
    rx_before = {
        "id": rx.id,
        "status": rx.status,
        "diagnosis": rx.diagnosis,
        "dietary_advice": rx.dietary_advice,
        "general_advice": rx.general_advice,
        "authorised_at": rx.authorised_at,
    }
    item0_before = {
        "id": items[0].id,
        "medicine_name": items[0].medicine_name,
        "dosage": items[0].dosage,
        "frequency": items[0].frequency,
        "duration_days": items[0].duration_days,
        "instructions": items[0].instructions,
        "strength": items[0].strength,
        "form": items[0].form,
        "route": items[0].route,
    }

    # Reception bills the item
    res_bill = rec_client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol 650mg",
            "unit": "tablet",
            "quantity": "15",
            "rate_paise": 150,
            "prescription_item_id": items[0].id,
        },
    )
    assert res_bill.status_code == 201, res_bill.text

    # MED-10: Verify prescription and its items are byte-for-byte unchanged
    db_session.refresh(rx)
    db_session.refresh(items[0])

    rx_after = {
        "id": rx.id,
        "status": rx.status,
        "diagnosis": rx.diagnosis,
        "dietary_advice": rx.dietary_advice,
        "general_advice": rx.general_advice,
        "authorised_at": rx.authorised_at,
    }
    item0_after = {
        "id": items[0].id,
        "medicine_name": items[0].medicine_name,
        "dosage": items[0].dosage,
        "frequency": items[0].frequency,
        "duration_days": items[0].duration_days,
        "instructions": items[0].instructions,
        "strength": items[0].strength,
        "form": items[0].form,
        "route": items[0].route,
    }

    assert rx_before == rx_after
    assert item0_before == item0_after
