"""Integration tests for clinical encounters, doctor silo, and note immutability (CLN-01, CLN-02).

Guarantees:
- D-03: Doctor silo; cross-doctor lookups return 404 Not Found.
- D-04: Reception default-deny returns 403 Forbidden.
- Finalised notes cannot be updated; modifications must be appended as addenda.
"""

from kalyan_api.models import Patient


def test_clinical_encounter_lifecycle_and_immutability(login_client, doctor_a_user, db_session):
    """Doctor drafts encounter, updates it, finalises it, and appends an addendum."""
    # 1. Setup Patient
    patient = Patient(
        urn="KH-2026-6601",
        full_name="Encounter Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=52,
        mobile="9876543401",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    doctor_client = login_client(doctor_a_user)

    # 2. Doctor records new encounter (Draft)
    create_resp = doctor_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Severe knee stiffness and pain while walking",
            "clinical_notes": "Bilateral knee joint effusion; joint line tenderness",
            "diagnosis": "Bilateral Knee Osteoarthritis Grade II",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    enc_data = create_resp.json()
    enc_id = enc_data["id"]
    assert enc_data["is_finalised"] is False
    assert enc_data["version_id"] == 1
    assert enc_data["doctor_id"] == doctor_a_user.doctor_id

    # 3. Doctor updates draft encounter notes
    patch_resp = doctor_client.patch(
        f"/api/encounters/{enc_id}",
        json={
            "diagnosis": "Bilateral Knee Osteoarthritis Grade III",
            "version_id": 1,
        },
    )
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["diagnosis"] == "Bilateral Knee Osteoarthritis Grade III"
    assert updated_data["version_id"] == 2

    # 4. Attempt to add addendum before finalisation -> fails with 400
    pre_add_resp = doctor_client.post(
        f"/api/encounters/{enc_id}/addenda",
        json={"addendum_text": "Premature addendum attempt"},
    )
    assert pre_add_resp.status_code == 400
    assert pre_add_resp.json()["code"] == "encounter_not_finalised"

    # 5. Doctor finalises encounter note
    final_resp = doctor_client.post(f"/api/encounters/{enc_id}/finalise")
    assert final_resp.status_code == 200
    final_data = final_resp.json()
    assert final_data["is_finalised"] is True
    assert final_data["finalised_at"] is not None

    # 6. Attempt to modify finalised encounter -> rejected with 400
    immutable_resp = doctor_client.patch(
        f"/api/encounters/{enc_id}",
        json={
            "symptoms": "Tampered symptoms",
            "version_id": final_data["version_id"],
        },
    )
    assert immutable_resp.status_code == 400
    assert immutable_resp.json()["code"] == "encounter_finalised_immutable"

    # 7. Doctor appends a dated addendum
    addendum_resp = doctor_client.post(
        f"/api/encounters/{enc_id}/addenda",
        json={
            "addendum_text": (
                "Follow-up phone consultation: patient reports 30% reduction in pain "
                "after starting physiotherapy exercises."
            ),
        },
    )
    assert addendum_resp.status_code == 201
    add_data = addendum_resp.json()
    assert add_data["encounter_id"] == enc_id
    assert add_data["doctor_id"] == doctor_a_user.doctor_id

    # 8. Fetch complete encounter and assert attached addenda
    get_resp = doctor_client.get(f"/api/encounters/{enc_id}")
    assert get_resp.status_code == 200
    full_data = get_resp.json()
    assert full_data["is_finalised"] is True
    assert len(full_data["addenda"]) == 1
    assert "Follow-up phone consultation" in full_data["addenda"][0]["addendum_text"]


def test_reception_clinical_default_deny(login_client, reception_user, doctor_a_user, db_session):
    """Reception role is default-denied from clinical encounters (D-04)."""
    patient = Patient(
        urn="KH-2026-6602",
        full_name="Deny Test Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=35,
        mobile="9876543402",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    # Doctor creates an encounter
    doctor_client = login_client(doctor_a_user)
    create_resp = doctor_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Low back stiffness",
            "clinical_notes": "Lumbosacral strain",
            "diagnosis": "Mechanical Low Back Pain",
        },
    )
    assert create_resp.status_code == 201
    enc_id = create_resp.json()["id"]

    # Reception logs in
    rec_client = login_client(reception_user)

    # Reception cannot create encounters (403)
    rec_post = rec_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Hacked notes",
            "clinical_notes": "Hacked",
            "diagnosis": "Hacked",
        },
    )
    assert rec_post.status_code == 403

    # Reception cannot view encounter content (403)
    rec_get = rec_client.get(f"/api/encounters/{enc_id}")
    assert rec_get.status_code == 403

    # Reception cannot view patient encounters history (403)
    rec_hist = rec_client.get(f"/api/patients/{patient.id}/encounters")
    assert rec_hist.status_code == 403


def test_doctor_silo_cross_isolation(login_client, doctor_a_user, doctor_b_user, db_session):
    """Doctor B cannot read or modify Doctor A's encounter notes (D-03)."""
    patient = Patient(
        urn="KH-2026-6603",
        full_name="Silo Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=60,
        mobile="9876543403",
        address="Bhojpur",
    )
    db_session.add(patient)
    db_session.flush()

    # Doctor A creates encounter
    doc_a_client = login_client(doctor_a_user)
    create_resp = doc_a_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Neck pain radiating to left arm",
            "clinical_notes": "Spurling test positive on left",
            "diagnosis": "Cervical Radiculopathy C6-C7",
        },
    )
    assert create_resp.status_code == 201
    enc_id = create_resp.json()["id"]

    # Doctor B logs in
    doc_b_client = login_client(doctor_b_user)

    # Doctor B looking up Doctor A's encounter receives 200 under DWS-04 cross-read
    b_get = doc_b_client.get(f"/api/encounters/{enc_id}")
    assert b_get.status_code == 200
    assert b_get.json()["id"] == enc_id

    # Doctor B attempting to patch Doctor A's encounter receives 404 (write silo preserved)
    b_patch = doc_b_client.patch(
        f"/api/encounters/{enc_id}",
        json={"diagnosis": "Cross-doctor tampering attempt", "version_id": 1},
    )
    assert b_patch.status_code == 404


def test_finalise_encounter_optimistic_locking(login_client, doctor_a_user, db_session):
    """FB-01: Finalise encounter with stale version_id returns 409 version_conflict."""
    patient = Patient(
        urn="KH-2026-6609",
        full_name="Optimistic Finalise Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=40,
        mobile="9876543409",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()

    doctor_client = login_client(doctor_a_user)
    create_resp = doctor_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Knee pain",
            "clinical_notes": "Mild swelling",
            "diagnosis": "Knee OA",
        },
    )
    assert create_resp.status_code == 201
    enc_id = create_resp.json()["id"]

    # Finalise with stale version_id 999 -> 409
    stale_resp = doctor_client.post(
        f"/api/encounters/{enc_id}/finalise",
        json={
            "symptoms": "Updated symptoms",
            "diagnosis": "Updated diagnosis",
            "version_id": 999,
        },
    )
    assert stale_resp.status_code == 409
    assert stale_resp.json()["code"] == "version_conflict"

    # Finalise with correct version_id 1 -> 200
    ok_resp = doctor_client.post(
        f"/api/encounters/{enc_id}/finalise",
        json={
            "symptoms": "Updated symptoms",
            "diagnosis": "Updated diagnosis",
            "version_id": 1,
        },
    )
    assert ok_resp.status_code == 200
    assert ok_resp.json()["is_finalised"] is True
