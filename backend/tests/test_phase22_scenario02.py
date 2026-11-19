"""Phase 22 Scenario 02: Free follow-up consultation via doctor waiver (SCENARIO-02).

Owner decisions of 2026-11-15 (.planning/phases/22-integrated-opd-workflow/22-DESIGN.md):
- OD-22-05: Visit type (NEW vs FOLLOW_UP) is recorded only; it never sets or discounts the fee automatically.
- OD-22-12: No automatic free follow-up window exists; a free follow-up is achieved when the doctor
  waives own fee with a mandatory reason.
- OD-22-11: Doctor may reduce, discount or waive the fee of own consultation with a reason.
- OD-22-18: Patient Out closes the visit; when balance is 0, no closing balance reason is required.

Verification path for UAT SCENARIO-02:
1. An existing patient checks in as FOLLOW_UP; consultation line created with normal doctor fee (FEE-02).
2. The doctor waives own fee with a mandatory clinical reason via POST /api/appointments/{id}/fee-adjustment.
3. The doctor consultation view (DoctorChargesOut) reflects 0 fee and waiver history (FEE-04).
4. After consultation completion, visit total outstanding is 0.
5. Reception closes the visit (Patient Out) with NO unpaid balance reason; visit status becomes CLOSED.
6. The visit bill view shows the waiver history; no outstanding dues exist in the ledger.
"""

import uuid
from sqlalchemy import select

from kalyan_api.models import Appointment, BillItem, Patient, Visit, VisitStatus


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-SC02-{suffix}-{uuid.uuid4().hex[:4]}",
        full_name=f"Scenario Followup Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=38,
        mobile="9876500099",
        address="Station Road, Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_scenario_02_free_follow_up_end_to_end(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)

    # Establish doctor's standard consultation fee
    NORMAL_FEE = 50000  # ₹500.00
    doctor_a_user.doctor.default_fee_paise = NORMAL_FEE
    db_session.flush()
    dept = doctor_a_user.doctor.departments[0]

    # Existing patient
    patient = _patient(db_session, "P1")

    # 1. Existing patient checks in as FOLLOW_UP
    checkin_res = reception.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept.id,
            "referral_source": "SELF",
            "visit_kind": "FOLLOW_UP",
        },
    )
    assert checkin_res.status_code == 201, checkin_res.text
    checkin_data = checkin_res.json()
    appointment_id = checkin_data["id"]
    visit_id = checkin_data["visit_id"]

    assert checkin_data["visit_kind"] == "FOLLOW_UP"

    # Consultation line was created at the normal fee (FEE-02, no auto discount)
    bill_res = reception.get(f"/api/visits/{visit_id}/bill")
    assert bill_res.status_code == 200, bill_res.text
    bill_data = bill_res.json()
    consult_sec = next(s for s in bill_data["sections"] if s["category"] == "CONSULTATION")
    assert len(consult_sec["lines"]) == 1
    assert consult_sec["lines"][0]["amount_paise"] == NORMAL_FEE
    assert consult_sec["lines"][0]["original_amount_paise"] == NORMAL_FEE
    assert consult_sec["lines"][0]["counts_toward_total"] is False  # not completed yet

    # 2. Consultation completes (consultation_status = "COMPLETED")
    appt = db_session.get(Appointment, appointment_id)
    appt.consultation_status = "COMPLETED"
    db_session.flush()

    # Now that consultation is COMPLETED, bill total is NORMAL_FEE
    bill_comp = reception.get(f"/api/visits/{visit_id}/bill").json()
    assert bill_comp["bill_total_paise"] == NORMAL_FEE
    assert bill_comp["due_paise"] == NORMAL_FEE

    # 3. Doctor waives own fee with a reason (FEE-04, OD-22-11, B3 available after completion while visit open)
    waiver_reason = "Follow-up consultation within 7 days — routine review"
    waive_res = doctor.post(
        f"/api/appointments/{appointment_id}/fee-adjustment",
        json={
            "kind": "WAIVER",
            "new_amount_paise": 0,
            "reason": waiver_reason,
        },
    )
    assert waive_res.status_code == 201, waive_res.text
    waive_data = waive_res.json()
    assert waive_data["kind"] == "WAIVER"
    assert waive_data["old_amount_paise"] == NORMAL_FEE
    assert waive_data["new_amount_paise"] == 0
    assert waive_data["reason"] == waiver_reason

    # 4. Doctor read view (GET /api/appointments/{id}/bill-items) shows waived fee
    doc_view_res = doctor.get(f"/api/appointments/{appointment_id}/bill-items")
    assert doc_view_res.status_code == 200, doc_view_res.text
    doc_view = doc_view_res.json()
    consult_line = doc_view["consultation_line"]
    assert consult_line is not None
    assert consult_line["amount_paise"] == 0
    assert consult_line["original_amount_paise"] == NORMAL_FEE
    assert len(consult_line["history"]) == 1
    assert consult_line["history"][0]["kind"] == "WAIVER"
    assert consult_line["history"][0]["new_amount_paise"] == 0
    assert consult_line["history"][0]["reason"] == waiver_reason

    # Verify visit outstanding is now 0
    bill_after_waiver = reception.get(f"/api/visits/{visit_id}/bill").json()
    assert bill_after_waiver["bill_total_paise"] == 0
    assert bill_after_waiver["paid_paise"] == 0
    assert bill_after_waiver["due_paise"] == 0

    # 5. Patient Out (close visit) succeeds with NO balance reason
    visit = db_session.get(Visit, visit_id)
    close_res = reception.post(
        f"/api/visits/{visit_id}/close",
        json={"version_id": visit.version_id},
    )
    assert close_res.status_code == 200, close_res.text
    closed_visit_data = close_res.json()
    assert closed_visit_data["status"] == VisitStatus.CLOSED.value

    # 6. Verify visit is CLOSED in database, bill view shows history, and no dues exist
    db_session.expire_all()
    v_db = db_session.get(Visit, visit_id)
    assert v_db.status == VisitStatus.CLOSED.value

    final_bill = reception.get(f"/api/visits/{visit_id}/bill").json()
    assert final_bill["status"] == VisitStatus.CLOSED.value
    assert final_bill["bill_total_paise"] == 0
    consult_sec = next(s for s in final_bill["sections"] if s["category"] == "CONSULTATION")
    assert len(consult_sec["lines"]) == 1
    assert consult_sec["lines"][0]["amount_paise"] == 0
    assert consult_sec["lines"][0]["history"][0]["kind"] == "WAIVER"

    # Ledger shows zero dues
    dues_res = reception.get("/api/billing/visit-dues")
    assert dues_res.status_code == 200
    dues = dues_res.json()
    assert not any(d["visit_id"] == visit_id for d in dues)
