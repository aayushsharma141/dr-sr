"""Tests for prescription lifecycle, authorisation, printing gate, cancellation and reissuance
(DWS-07, D-19-14, D-19-15)."""

from kalyan_api.models import ClinicalEncounter, Patient


def _create_test_patient(db_session, suffix="30") -> Patient:
    patient = Patient(
        urn=f"KH-2026-88{suffix}",
        full_name=f"Prescription Lifecycle Patient {suffix}",
        guardian_name="Guardian Name",
        gender="F",
        age_years=35,
        mobile=f"98765488{suffix}",
        address="Patna, Bihar",
        district="Patna",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _create_test_encounter(
    db_session, patient_id: int, doctor_id: int, user_id: int, diagnosis="Dry Eye Syndrome"
) -> ClinicalEncounter:
    encounter = ClinicalEncounter(
        patient_id=patient_id,
        doctor_id=doctor_id,
        created_by_user_id=user_id,
        symptoms="Irritation and redness in both eyes",
        clinical_notes="Bilateral conjunctival hyperemia, tear breakup time reduced",
        diagnosis=diagnosis,
        is_finalised=False,
    )
    db_session.add(encounter)
    db_session.flush()
    return encounter


def test_prescription_draft_authorise_lifecycle(login_client, doctor_a_user, db_session):
    """Doctor creates a DRAFT prescription, updates it, authorises it, and verifies print gate."""
    patient = _create_test_patient(db_session, "01")
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_a_user.doctor_id, doctor_a_user.id
    )
    doc_client = login_client(doctor_a_user)

    # 1. Create prescription in DRAFT status
    draft_payload = {
        "patient_id": patient.id,
        "encounter_id": encounter.id,
        "status": "DRAFT",
        # diagnosis omitted to test inheritance from encounter
        "items": [
            {
                "item_order": 1,
                "medicine_name": "Carboxymethylcellulose Eye Drops",
                "dosage": "1 drop",
                "frequency": "QID (Four times daily)",
                "duration_days": 14,
                "instructions": "In both eyes",
                "strength": "0.5%",
                "form": "Eye Drops",
                "route": "Both Eyes (OU)",
            }
        ],
    }

    create_resp = doc_client.post("/api/prescriptions", json=draft_payload)
    assert create_resp.status_code == 201, create_resp.text
    rx_data = create_resp.json()
    assert rx_data["status"] == "DRAFT"
    assert rx_data["diagnosis"] == "Dry Eye Syndrome"  # Inherited from encounter
    assert rx_data["authorised_at"] is None
    assert rx_data["is_printable"] is False
    assert rx_data["items"][0]["strength"] == "0.5%"
    assert rx_data["items"][0]["form"] == "Eye Drops"
    assert rx_data["items"][0]["route"] == "Both Eyes (OU)"

    rx_id = rx_data["id"]

    # 2. Modify prescription in DRAFT status
    update_payload = {
        "diagnosis": "Severe Dry Eye Syndrome",
        "dietary_advice": "Omega-3 rich diet",
        "items": [
            {
                "item_order": 1,
                "medicine_name": "Carboxymethylcellulose Eye Drops",
                "dosage": "1 drop",
                "frequency": "6 times daily",
                "duration_days": 21,
                "instructions": "In both eyes",
                "strength": "1.0%",
                "form": "Eye Drops",
                "route": "Both Eyes (OU)",
            },
            {
                "item_order": 2,
                "medicine_name": "Hydroxypropyl Methylcellulose Ointment",
                "dosage": "1 ribbon",
                "frequency": "HS (Bedtime)",
                "duration_days": 14,
                "instructions": "Apply inside lower eyelid before sleep",
                "strength": "0.3%",
                "form": "Eye Ointment",
                "route": "Both Eyes (OU)",
            },
        ],
    }
    update_resp = doc_client.put(f"/api/prescriptions/{rx_id}", json=update_payload)
    assert update_resp.status_code == 200, update_resp.text
    updated_data = update_resp.json()
    assert updated_data["diagnosis"] == "Severe Dry Eye Syndrome"
    assert updated_data["dietary_advice"] == "Omega-3 rich diet"
    assert len(updated_data["items"]) == 2
    assert updated_data["status"] == "DRAFT"
    assert updated_data["is_printable"] is False

    # 3. Authorise prescription
    auth_resp = doc_client.post(f"/api/prescriptions/{rx_id}/authorise")
    assert auth_resp.status_code == 200, auth_resp.text
    auth_data = auth_resp.json()
    assert auth_data["status"] == "AUTHORISED"
    assert auth_data["authorised_at"] is not None
    assert auth_data["is_printable"] is True

    # 4. Attempt to modify authorised prescription -> Must fail with HTTP 409
    tamper_resp = doc_client.put(
        f"/api/prescriptions/{rx_id}", json={"diagnosis": "Attempted Tampering"}
    )
    assert tamper_resp.status_code == 409
    assert tamper_resp.json()["code"] == "prescription_locked"


def test_cannot_authorise_empty_prescription(login_client, doctor_a_user, db_session):
    """Authorisation fails if prescription has 0 items or no diagnosis."""
    patient = _create_test_patient(db_session, "02")
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_a_user.doctor_id, doctor_a_user.id, diagnosis="Blepharitis"
    )
    doc_client = login_client(doctor_a_user)

    # Create empty draft
    draft_resp = doc_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter.id,
            "status": "DRAFT",
            "items": [],
        },
    )
    assert draft_resp.status_code == 201
    rx_id = draft_resp.json()["id"]

    # Try to authorise without items -> 422
    auth_resp = doc_client.post(f"/api/prescriptions/{rx_id}/authorise")
    assert auth_resp.status_code == 422
    assert auth_resp.json()["code"] == "items_required"


def test_prescription_cancellation_and_reissuance(login_client, doctor_a_user, db_session):
    """Authorised prescription can be cancelled with reason, unlocking re-issuance for the encounter
    (D-19-15)."""
    patient = _create_test_patient(db_session, "03")
    encounter = _create_test_encounter(
        db_session,
        patient.id,
        doctor_a_user.doctor_id,
        doctor_a_user.id,
        diagnosis="Cataract Early",
    )
    doc_client = login_client(doctor_a_user)

    # 1. Create and authorise prescription
    create_resp = doc_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter.id,
            "status": "AUTHORISED",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Potassium Iodide Eye Drops",
                    "dosage": "1 drop",
                    "frequency": "TDS",
                    "duration_days": 30,
                    "form": "Eye Drops",
                    "route": "Right Eye (OD)",
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    rx1_id = create_resp.json()["id"]

    # 2. Attempt to create second active prescription for the same encounter -> 409 conflict
    dup_resp = doc_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter.id,
            "status": "DRAFT",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Alternative Drops",
                    "dosage": "1 drop",
                    "frequency": "BD",
                    "duration_days": 10,
                }
            ],
        },
    )
    assert dup_resp.status_code == 409
    assert dup_resp.json()["code"] == "active_prescription_exists"

    # 3. Attempt cancellation with invalid short reason (<3 chars) -> 422
    short_cancel = doc_client.post(
        f"/api/prescriptions/{rx1_id}/cancel",
        json={"reason": "no"},
    )
    assert short_cancel.status_code == 422

    # 4. Cancel with valid reason
    cancel_resp = doc_client.post(
        f"/api/prescriptions/{rx1_id}/cancel",
        json={
            "reason": (
                "Patient reported allergic stinging sensation; switched to preservative-free drop."
            )
        },
    )
    assert cancel_resp.status_code == 200, cancel_resp.text
    cancelled_data = cancel_resp.json()
    assert cancelled_data["status"] == "CANCELLED"
    assert (
        cancelled_data["cancellation_reason"]
        == "Patient reported allergic stinging sensation; switched to preservative-free drop."
    )
    assert cancelled_data["cancelled_at"] is not None
    assert cancelled_data["cancelled_by_user_id"] == doctor_a_user.id
    assert cancelled_data["is_printable"] is False

    # 5. Cancelled prescription cannot be cancelled again
    second_cancel = doc_client.post(
        f"/api/prescriptions/{rx1_id}/cancel",
        json={"reason": "Repeat cancellation attempt"},
    )
    assert second_cancel.status_code == 409
    assert second_cancel.json()["code"] == "already_cancelled"

    # 6. Re-issuance: creating a new prescription for the encounter now succeeds!
    reissue_resp = doc_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": encounter.id,
            "status": "AUTHORISED",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Preservative-Free Lubricant Drops",
                    "dosage": "1 drop",
                    "frequency": "QID",
                    "duration_days": 30,
                    "form": "Eye Drops",
                    "route": "Right Eye (OD)",
                }
            ],
        },
    )
    assert reissue_resp.status_code == 201
    rx2_id = reissue_resp.json()["id"]
    assert rx2_id != rx1_id
    assert reissue_resp.json()["status"] == "AUTHORISED"
    assert reissue_resp.json()["is_printable"] is True
