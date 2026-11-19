"""Integration tests for structured doctor prescriptions REST API (RX-01).

Guarantees:
- Only licensed doctors can issue prescriptions (Role.DOCTOR, PRESCRIPTION_WRITE).
- Receptionist and Admin receive HTTP 403 Forbidden on create or read.
- Doctor silo: Doctor B cannot read Doctor A's prescription (HTTP 404).
- In-transaction audit event PRESCRIPTION_CREATED recorded with item counts and diagnosis.
- Validates medication duration bounds (1-365) and unique item ordering.
"""

from datetime import date

from sqlalchemy import func, select

from kalyan_api.models import (
    Appointment,
    AuditLog,
    ClinicalEncounter,
    ConsultationStatus,
    Patient,
)


def _create_test_patient(db_session, suffix="10") -> Patient:
    patient = Patient(
        urn=f"KH-2026-77{suffix}",
        full_name=f"Prescription Test Patient {suffix}",
        guardian_name="Guardian Name",
        gender="M",
        age_years=48,
        mobile=f"98765477{suffix}",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_doctor_creates_and_retrieves_prescription(login_client, doctor_a_user, db_session):
    """Doctor successfully writes prescription with structured medication items."""
    patient = _create_test_patient(db_session, "01")
    doctor_client = login_client(doctor_a_user)

    rx_payload = {
        "patient_id": patient.id,
        "diagnosis": "Lumbar Radiculopathy L4-L5",
        "dietary_advice": "High fiber diet, adequate hydration",
        "general_advice": "Avoid forward bending, lift with knees",
        "follow_up_date": "2026-11-20",
        "items": [
            {
                "item_order": 1,
                "medicine_name": "Tab Pregabalin",
                "dosage": "75 mg",
                "frequency": "0-0-1",
                "duration_days": 10,
                "instructions": "After dinner at bedtime",
            },
            {
                "item_order": 2,
                "medicine_name": "Tab Paracetamol",
                "dosage": "650 mg",
                "frequency": "1-0-1",
                "duration_days": 5,
                "instructions": "After food if pain occurs",
            },
        ],
    }

    create_resp = doctor_client.post("/api/prescriptions", json=rx_payload)
    assert create_resp.status_code == 201, create_resp.text
    rx_data = create_resp.json()

    assert rx_data["id"] is not None
    assert rx_data["patient_id"] == patient.id
    assert rx_data["patient_urn"] == patient.urn
    assert rx_data["doctor_id"] == doctor_a_user.doctor_id
    assert rx_data["diagnosis"] == "Lumbar Radiculopathy L4-L5"
    assert rx_data["follow_up_date"] == "2026-11-20"
    assert len(rx_data["items"]) == 2
    assert rx_data["items"][0]["medicine_name"] == "Tab Pregabalin"
    assert rx_data["items"][1]["medicine_name"] == "Tab Paracetamol"

    rx_id = rx_data["id"]

    # Verify GET /api/prescriptions/{id}
    get_resp = doctor_client.get(f"/api/prescriptions/{rx_id}")
    assert get_resp.status_code == 200
    fetched_data = get_resp.json()
    assert fetched_data["id"] == rx_id
    assert len(fetched_data["items"]) == 2

    # Verify GET /api/patients/{id}/prescriptions
    list_resp = doctor_client.get(f"/api/patients/{patient.id}/prescriptions")
    assert list_resp.status_code == 200
    summaries = list_resp.json()
    assert len(summaries) >= 1
    assert summaries[0]["id"] == rx_id
    assert summaries[0]["items_count"] == 2

    # Verify AuditLog row created in-transaction
    audit_row = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "PRESCRIPTION_CREATED",
            AuditLog.entity_id == str(rx_id),
        )
    ).scalar_one_or_none()
    assert audit_row is not None
    assert audit_row.actor_user_id == doctor_a_user.id
    assert audit_row.after_data["diagnosis"] == "Lumbar Radiculopathy L4-L5"
    assert audit_row.after_data["items_count"] == 2


def test_prescription_validation_failures(login_client, doctor_a_user, db_session):
    """Validation rejected on invalid input data."""
    patient = _create_test_patient(db_session, "02")
    doctor_client = login_client(doctor_a_user)

    # Empty items list
    resp1 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Valid Diagnosis",
            "items": [],
        },
    )
    assert resp1.status_code == 422

    # Duplicate item_order
    resp2 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Valid Diagnosis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Med A",
                    "dosage": "500mg",
                    "frequency": "OD",
                    "duration_days": 5,
                },
                {
                    "item_order": 1,  # Duplicate
                    "medicine_name": "Med B",
                    "dosage": "250mg",
                    "frequency": "BD",
                    "duration_days": 3,
                },
            ],
        },
    )
    assert resp2.status_code == 422

    # Invalid duration_days (0 or negative)
    resp3 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Valid Diagnosis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Med A",
                    "dosage": "500mg",
                    "frequency": "OD",
                    "duration_days": 0,
                }
            ],
        },
    )
    assert resp3.status_code == 422

    # Non-existent patient
    resp4 = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": 999999,
            "diagnosis": "Valid Diagnosis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Med A",
                    "dosage": "500mg",
                    "frequency": "OD",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert resp4.status_code == 404


def test_reception_and_admin_cannot_create_or_read_prescription(
    login_client, admin_user, reception_user, doctor_a_user, db_session
):
    """Clinical permission enforcement: Reception and Admin receive 403 Forbidden."""
    patient = _create_test_patient(db_session, "03")

    # Doctor creates a prescription first
    doctor_client = login_client(doctor_a_user)
    create_resp = doctor_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Cervical Strain",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Aceclofenac",
                    "dosage": "100mg",
                    "frequency": "1-0-1",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    rx_id = create_resp.json()["id"]

    # Reception cannot create prescription
    rec_client = login_client(reception_user)
    rec_post = rec_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Unauthorized Rx",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Aceclofenac",
                    "dosage": "100mg",
                    "frequency": "1-0-1",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert rec_post.status_code == 403

    # Admin cannot create prescription
    adm_client = login_client(admin_user)
    adm_post = adm_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Unauthorized Rx",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Aceclofenac",
                    "dosage": "100mg",
                    "frequency": "1-0-1",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert adm_post.status_code == 403

    # Reception and Admin cannot read prescription or doctor-scoped follow-up data.
    assert rec_client.get(f"/api/prescriptions/{rx_id}").status_code == 403
    assert adm_client.get(f"/api/prescriptions/{rx_id}").status_code == 403
    assert rec_client.get("/api/prescriptions/follow-ups").status_code == 403
    assert adm_client.get("/api/prescriptions/follow-ups").status_code == 403


def test_doctor_silo_cross_isolation_on_prescriptions(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """Doctor B cannot view Doctor A's prescription (D-03)."""
    patient = _create_test_patient(db_session, "04")

    # Doctor A creates prescription
    doc_a_client = login_client(doctor_a_user)
    create_resp = doc_a_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "Plantar Fasciitis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Gel Diclofenac",
                    "dosage": "1 tube",
                    "frequency": "Local application TDS",
                    "duration_days": 7,
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    rx_id = create_resp.json()["id"]

    # Doctor B views Doctor A's prescription (allowed under DWS-04)
    doc_b_client = login_client(doctor_b_user)
    resp = doc_b_client.get(f"/api/prescriptions/{rx_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == rx_id

    # Doctor B attempts to cancel Doctor A's prescription receives 404 (write silo preserved)
    cancel_resp = doc_b_client.post(
        f"/api/prescriptions/{rx_id}/cancel",
        json={"reason": "Unauthorized cancellation attempt"},
    )
    assert cancel_resp.status_code == 404


def test_prescription_follow_ups_are_date_filtered_and_doctor_scoped(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """Follow-up list contains only dated prescriptions issued by the signed-in doctor."""
    patient_a = _create_test_patient(db_session, "21")
    patient_b = _create_test_patient(db_session, "22")
    doctor_a = login_client(doctor_a_user)
    doctor_b = login_client(doctor_b_user)

    def create_follow_up(client, patient_id: int, follow_up_date: str | None):
        response = client.post(
            "/api/prescriptions",
            json={
                "patient_id": patient_id,
                "diagnosis": "Follow-up test diagnosis",
                "follow_up_date": follow_up_date,
                "items": [
                    {
                        "item_order": 1,
                        "medicine_name": "Test medicine",
                        "dosage": "1 unit",
                        "frequency": "OD",
                        "duration_days": 3,
                    }
                ],
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    old_follow_up = create_follow_up(doctor_a, patient_a.id, "2026-10-30")
    future_follow_up = create_follow_up(doctor_a, patient_a.id, "2026-11-12")
    no_follow_up = create_follow_up(doctor_a, patient_a.id, None)
    other_doctor_follow_up = create_follow_up(doctor_b, patient_b.id, "2026-11-10")

    response = doctor_a.get("/api/prescriptions/follow-ups")
    assert response.status_code == 200
    results = response.json()
    result_ids = [row["id"] for row in results]
    assert future_follow_up["id"] in result_ids
    assert old_follow_up["id"] in result_ids
    assert no_follow_up["id"] not in result_ids
    assert other_doctor_follow_up["id"] not in result_ids
    assert [row["follow_up_date"] for row in results] == ["2026-10-30", "2026-11-12"]

    filtered = doctor_a.get(
        "/api/prescriptions/follow-ups",
        params={"date_from": "2026-11-01", "date_to": "2026-11-30"},
    )
    assert filtered.status_code == 200
    assert [row["id"] for row in filtered.json()] == [future_follow_up["id"]]

    invalid_range = doctor_a.get(
        "/api/prescriptions/follow-ups",
        params={"date_from": "2026-11-30", "date_to": "2026-11-01"},
    )
    assert invalid_range.status_code == 422


def test_get_encounter_prescription_lifecycle_and_rbac(
    login_client, admin_user, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """GET /api/encounters/{id}/prescription returns active Rx with ordered items and RBAC."""
    patient = _create_test_patient(db_session, "31")
    encounter = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        created_by_user_id=doctor_a_user.id,
        symptoms="Right shoulder pain",
        clinical_notes="Limited abduction",
        diagnosis="Frozen Shoulder",
        is_finalised=False,
    )
    db_session.add(encounter)
    db_session.flush()

    doc_a = login_client(doctor_a_user)
    doc_b = login_client(doctor_b_user)
    rec = login_client(reception_user)
    adm = login_client(admin_user)

    # 1. Non-existent encounter -> 404
    assert doc_a.get("/api/encounters/999999/prescription").status_code == 404

    # 2. No prescription yet -> 200 with null/None body
    empty_resp = doc_a.get(f"/api/encounters/{encounter.id}/prescription")
    assert empty_resp.status_code == 200, empty_resp.text
    assert empty_resp.json() is None

    # 3. Active DRAFT prescription returned with items sorted by item_order
    draft_resp = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter.id,
            "status": "DRAFT",
            "diagnosis": "Frozen Shoulder",
            "items": [
                {
                    "item_order": 2,
                    "medicine_name": "Tab Pantoprazole",
                    "dosage": "40 mg",
                    "frequency": "OD",
                    "duration_days": 7,
                },
                {
                    "item_order": 1,
                    "medicine_name": "Tab Etoricoxib",
                    "dosage": "90 mg",
                    "frequency": "OD",
                    "duration_days": 5,
                },
            ],
        },
    )
    assert draft_resp.status_code == 201, draft_resp.text
    draft_id = draft_resp.json()["id"]

    fetched_draft = doc_a.get(f"/api/encounters/{encounter.id}/prescription")
    assert fetched_draft.status_code == 200, fetched_draft.text
    draft_body = fetched_draft.json()
    assert draft_body is not None
    assert draft_body["id"] == draft_id
    assert draft_body["status"] == "DRAFT"
    assert [it["item_order"] for it in draft_body["items"]] == [1, 2]
    assert [it["medicine_name"] for it in draft_body["items"]] == [
        "Tab Etoricoxib",
        "Tab Pantoprazole",
    ]

    # 4. Authorise -> returns AUTHORISED prescription with ordered items
    auth_resp = doc_a.post(f"/api/prescriptions/{draft_id}/authorise")
    assert auth_resp.status_code == 200, auth_resp.text

    fetched_auth = doc_a.get(f"/api/encounters/{encounter.id}/prescription")
    assert fetched_auth.status_code == 200, fetched_auth.text
    assert fetched_auth.json()["id"] == draft_id
    assert fetched_auth.json()["status"] == "AUTHORISED"
    assert [it["item_order"] for it in fetched_auth.json()["items"]] == [1, 2]

    # 5. RBAC: Reception & Admin 403 (PRESCRIPTION_READ); Doctor B 200 (CLINICAL_READ)
    assert rec.get(f"/api/encounters/{encounter.id}/prescription").status_code == 403
    assert adm.get(f"/api/encounters/{encounter.id}/prescription").status_code == 403

    doc_b_resp = doc_b.get(f"/api/encounters/{encounter.id}/prescription")
    assert doc_b_resp.status_code == 200, doc_b_resp.text
    assert doc_b_resp.json()["id"] == draft_id

    # 6. Amend -> original SUPERSEDED is ignored; new revision returned
    amend_resp = doc_a.post(
        f"/api/prescriptions/{draft_id}/amend",
        json={
            "amendment_reason": "Adjust dosage for gastric safety",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Paracetamol",
                    "dosage": "650 mg",
                    "frequency": "1-0-1",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert amend_resp.status_code == 201, amend_resp.text
    amended_id = amend_resp.json()["id"]

    after_amend = doc_a.get(f"/api/encounters/{encounter.id}/prescription")
    assert after_amend.status_code == 200, after_amend.text
    assert after_amend.json()["id"] == amended_id
    assert after_amend.json()["revision_number"] == 2
    assert after_amend.json()["status"] == "AUTHORISED"

    # 7. Cancel active revision -> both SUPERSEDED and CANCELLED are ignored -> None
    cancel_resp = doc_a.post(
        f"/api/prescriptions/{amended_id}/cancel",
        json={"reason": "Patient declined medication"},
    )
    assert cancel_resp.status_code == 200, cancel_resp.text

    after_cancel = doc_a.get(f"/api/encounters/{encounter.id}/prescription")
    assert after_cancel.status_code == 200, after_cancel.text
    assert after_cancel.json() is None


def test_create_prescription_with_appointment_id_links_or_creates_encounter(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """POST /api/prescriptions with appointment_id links or creates an encounter with guards."""
    dept_a = doctor_a_user.doctor.departments[0].id
    dept_b = doctor_b_user.doctor.departments[0].id
    rec = login_client(reception_user)
    doc_a = login_client(doctor_a_user)

    sample_items = [
        {
            "item_order": 1,
            "medicine_name": "Tab Paracetamol",
            "dosage": "650 mg",
            "frequency": "1-0-1",
            "duration_days": 5,
        }
    ]

    # Case A: Appointment already has a ClinicalEncounter -> links it without duplicating
    p1 = _create_test_patient(db_session, "41")
    appt1 = rec.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p1.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "referral_source": "SELF",
        },
    )
    assert appt1.status_code == 201, appt1.text
    appt1_id = appt1.json()["id"]

    enc1 = doc_a.post(
        "/api/encounters",
        json={
            "patient_id": p1.id,
            "appointment_id": appt1_id,
            "symptoms": "Low back pain",
            "clinical_notes": "SLR positive",
            "diagnosis": "Acute Lumbago",
        },
    )
    assert enc1.status_code == 201, enc1.text
    enc1_id = enc1.json()["id"]

    rx1 = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p1.id,
            "appointment_id": appt1_id,
            # diagnosis omitted to verify inheritance from resolved encounter
            "items": sample_items,
        },
    )
    assert rx1.status_code == 201, rx1.text
    assert rx1.json()["encounter_id"] == enc1_id
    assert rx1.json()["diagnosis"] == "Acute Lumbago"
    enc1_count = db_session.scalar(
        select(func.count())
        .select_from(ClinicalEncounter)
        .where(ClinicalEncounter.appointment_id == appt1_id)
    )
    assert enc1_count == 1

    # Duplicate active prescription on same appointment_id -> 409 active_prescription_exists
    dup_rx = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p1.id,
            "appointment_id": appt1_id,
            "diagnosis": "Acute Lumbago",
            "items": sample_items,
        },
    )
    assert dup_rx.status_code == 409
    assert dup_rx.json()["code"] == "active_prescription_exists"

    # Case B: Checked-in WAITING appointment with no encounter -> creates encounter & starts consult
    p2 = _create_test_patient(db_session, "42")
    appt2 = rec.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "referral_source": "SELF",
        },
    )
    assert appt2.status_code == 201, appt2.text
    appt2_data = appt2.json()
    assert appt2_data["consultation_status"] == ConsultationStatus.WAITING.value

    rx2 = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p2.id,
            "appointment_id": appt2_data["id"],
            "diagnosis": "Cervical Spondylosis",
            "items": sample_items,
        },
    )
    assert rx2.status_code == 201, rx2.text
    rx2_enc_id = rx2.json()["encounter_id"]
    assert rx2_enc_id is not None

    created_enc2 = db_session.get(ClinicalEncounter, rx2_enc_id)
    assert created_enc2 is not None
    assert created_enc2.appointment_id == appt2_data["id"]
    assert created_enc2.visit_id == appt2_data["visit_id"]
    assert created_enc2.doctor_id == doctor_a_user.doctor_id
    assert created_enc2.patient_id == p2.id

    refreshed_appt2 = db_session.get(Appointment, appt2_data["id"])
    assert refreshed_appt2 is not None
    assert refreshed_appt2.consultation_status == ConsultationStatus.IN_CONSULTATION.value

    # Encounter prescription lookup hydrates the linked Rx
    hydrate2 = doc_a.get(f"/api/encounters/{rx2_enc_id}/prescription")
    assert hydrate2.status_code == 200
    assert hydrate2.json()["id"] == rx2.json()["id"]

    # Case C: Checked-in IN_CONSULTATION appointment with no encounter -> creates & links encounter
    p3 = _create_test_patient(db_session, "43")
    appt3 = rec.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p3.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "referral_source": "SELF",
        },
    )
    assert appt3.status_code == 201, appt3.text
    appt3_data = appt3.json()
    start3 = doc_a.patch(
        f"/api/appointments/{appt3_data['id']}/status",
        json={"status": "IN_CONSULTATION", "version_id": appt3_data["version_id"]},
    )
    assert start3.status_code == 200, start3.text

    rx3 = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p3.id,
            "appointment_id": appt3_data["id"],
            "diagnosis": "Myofascial Pain",
            "items": sample_items,
        },
    )
    assert rx3.status_code == 201, rx3.text
    assert rx3.json()["encounter_id"] is not None
    created_enc3 = db_session.get(ClinicalEncounter, rx3.json()["encounter_id"])
    assert created_enc3 is not None
    assert created_enc3.appointment_id == appt3_data["id"]

    # Case D: Unchecked-in BOOKED appointment -> 422 not_checked_in
    p4 = _create_test_patient(db_session, "44")
    appt4 = rec.post(
        "/api/appointments",
        json={
            "patient_id": p4.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "appointment_date": date(2026, 11, 2).isoformat(),
        },
    )
    assert appt4.status_code == 201, appt4.text
    assert appt4.json()["consultation_status"] is None

    rx4 = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p4.id,
            "appointment_id": appt4.json()["id"],
            "diagnosis": "Knee Strain",
            "items": sample_items,
        },
    )
    assert rx4.status_code == 422
    assert rx4.json()["code"] == "not_checked_in"

    # Case E: Cross-doctor appointment_id -> 404 appointment_not_found
    p5 = _create_test_patient(db_session, "45")
    appt5_b = rec.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p5.id,
            "doctor_id": doctor_b_user.doctor_id,
            "department_id": dept_b,
            "referral_source": "SELF",
        },
    )
    assert appt5_b.status_code == 201, appt5_b.text

    cross_doc_rx = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p5.id,
            "appointment_id": appt5_b.json()["id"],
            "diagnosis": "Cross Doctor Attempt",
            "items": sample_items,
        },
    )
    assert cross_doc_rx.status_code == 404
    assert cross_doc_rx.json()["code"] == "appointment_not_found"

    # Case F: Cross-patient appointment_id (Doctor A's appt for p2, payload for p5) -> 404
    cross_pat_rx = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p5.id,
            "appointment_id": appt2_data["id"],
            "diagnosis": "Cross Patient Attempt",
            "items": sample_items,
        },
    )
    assert cross_pat_rx.status_code == 404
    assert cross_pat_rx.json()["code"] == "appointment_not_found"

    # Case G: Mismatched encounter_id + appointment_id -> 422 appointment_encounter_mismatch
    mismatch_rx = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": p1.id,
            "encounter_id": enc1_id,
            "appointment_id": appt2_data["id"],
            "diagnosis": "Mismatch Attempt",
            "items": sample_items,
        },
    )
    assert mismatch_rx.status_code == 422
    assert mismatch_rx.json()["code"] == "appointment_encounter_mismatch"


def test_prescription_follow_ups_excludes_draft_cancelled_and_superseded(
    login_client, doctor_a_user, db_session
):
    """GET /api/prescriptions/follow-ups returns ONLY AUTHORISED prescriptions."""
    patient = _create_test_patient(db_session, "51")
    doc_a = login_client(doctor_a_user)

    item = [
        {
            "item_order": 1,
            "medicine_name": "Tab Paracetamol",
            "dosage": "650 mg",
            "frequency": "1-0-1",
            "duration_days": 5,
        }
    ]

    # 1. Active AUTHORISED prescription -> MUST appear
    auth_rx = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "status": "AUTHORISED",
            "diagnosis": "Authorised Follow-up Case",
            "follow_up_date": "2026-12-01",
            "items": item,
        },
    )
    assert auth_rx.status_code == 201, auth_rx.text
    auth_rx_id = auth_rx.json()["id"]

    # 2. DRAFT prescription -> MUST NOT appear
    draft_rx = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "status": "DRAFT",
            "diagnosis": "Draft Follow-up Case",
            "follow_up_date": "2026-12-02",
            "items": item,
        },
    )
    assert draft_rx.status_code == 201, draft_rx.text
    draft_rx_id = draft_rx.json()["id"]

    # 3. CANCELLED prescription -> MUST NOT appear
    to_cancel = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "status": "AUTHORISED",
            "diagnosis": "Cancelled Follow-up Case",
            "follow_up_date": "2026-12-03",
            "items": item,
        },
    )
    assert to_cancel.status_code == 201, to_cancel.text
    cancelled_rx_id = to_cancel.json()["id"]
    cancel_resp = doc_a.post(
        f"/api/prescriptions/{cancelled_rx_id}/cancel",
        json={"reason": "Entered in error"},
    )
    assert cancel_resp.status_code == 200, cancel_resp.text

    # 4. SUPERSEDED prescription (amended immediately to AUTHORISED) -> old excluded, new included
    to_amend = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "status": "AUTHORISED",
            "diagnosis": "Superseded Follow-up Case",
            "follow_up_date": "2026-12-04",
            "items": item,
        },
    )
    assert to_amend.status_code == 201, to_amend.text
    superseded_rx_id = to_amend.json()["id"]
    amended_auth = doc_a.post(
        f"/api/prescriptions/{superseded_rx_id}/amend",
        json={
            "amendment_reason": "Adjusted follow-up date and dosage",
            "follow_up_date": "2026-12-05",
            "authorise_immediately": True,
            "items": item,
        },
    )
    assert amended_auth.status_code == 201, amended_auth.text
    amended_auth_id = amended_auth.json()["id"]

    # 5. SUPERSEDED + un-authorised amended DRAFT -> neither excluded-superseded nor draft appears
    to_amend_draft = doc_a.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "status": "AUTHORISED",
            "diagnosis": "Superseded To Draft Case",
            "follow_up_date": "2026-12-06",
            "items": item,
        },
    )
    assert to_amend_draft.status_code == 201, to_amend_draft.text
    superseded_to_draft_id = to_amend_draft.json()["id"]
    amended_draft = doc_a.post(
        f"/api/prescriptions/{superseded_to_draft_id}/amend",
        json={
            "amendment_reason": "Holding draft revision pending labs",
            "follow_up_date": "2026-12-07",
            "authorise_immediately": False,
            "items": item,
        },
    )
    assert amended_draft.status_code == 201, amended_draft.text
    amended_draft_id = amended_draft.json()["id"]

    resp = doc_a.get("/api/prescriptions/follow-ups")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    returned_ids = {row["id"] for row in rows}

    assert returned_ids == {auth_rx_id, amended_auth_id}
    assert draft_rx_id not in returned_ids
    assert cancelled_rx_id not in returned_ids
    assert superseded_rx_id not in returned_ids
    assert superseded_to_draft_id not in returned_ids
    assert amended_draft_id not in returned_ids
    assert all(row["status"] == "AUTHORISED" for row in rows)
