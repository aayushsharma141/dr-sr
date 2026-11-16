"""Phase 22 Plan 06: Visit-level payment (visit_id), guard, legacy cap and concurrency.

Requirements & Truths:
- Reception can record a payment against a visit (visit_id); it is capped at the visit's due and refused above it with overpayment_rejected (BILL-08, BILL-09, BILL-07, BILL-10, BILL-11, BILL-13).
- A visit payment cannot also name a treatment plan or a consultation; a visit of another patient is not found (404 visit_not_found, 422 payment_target_conflict).
- A visit payment is refused with checkout_not_open until at least one consultation of the visit is COMPLETED (OD-D, locked owner decision).
- Paying the due of a CLOSED visit succeeds and the visit stays CLOSED; a treatment-plan payment for the same patient keeps its own cap and does not change the visit due (LED-08, LED-09).
- A legacy consultation payment (appointment_id) is capped by both the consultation's remaining fee and the visit's due, so it can no longer exceed what the visit owes.
- PATCH or DELETE on /api/payments/{id} is refused (405 or 404) and reception reversing a payment gets 403 (BILL-14, BILL-15).
- Concurrency: two threads each paying 60% of the due on the same visit: exactly one 201, one 422; paid total never exceeds the due.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from decimal import Decimal
import itertools
from typing import Any
import uuid

import pytest
from conftest import TEST_PASSWORD, make_user
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, select, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.db.session import get_session
from kalyan_api.main import create_app
from kalyan_api.models import (
    Appointment,
    AuditLog,
    BillItem,
    BillItemCategory,
    BillItemSource,
    ClinicSettings,
    ConsultationStatus,
    Doctor,
    Patient,
    Payment,
    TreatmentPlan,
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.services import billing_service
from kalyan_api.services.audit_service import AuditAction

TODAY = date(2026, 11, 2)
_TOKENS = itertools.count(100)


def _patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-VP{suffix}",
        full_name=f"Visit Pay Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=35,
        mobile="9876543999",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _visit(db_session: Session, patient: Patient, user: User, status: str = VisitStatus.OPEN.value, **fields: Any) -> Visit:
    visit = Visit(
        patient_id=patient.id,
        visit_date=TODAY,
        status=status,
        opened_by_user_id=user.id,
        **fields,
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
    status: str,
    fee_paise: int = 50000,
) -> Appointment:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=TODAY,
        token_number=next(_TOKENS),
        status="ARRIVED",
        consultation_status=status,
        visit_id=visit.id,
        created_by_user_id=user.id,
    )
    db_session.add(appt)
    db_session.flush()
    line = BillItem(
        visit_id=visit.id,
        patient_id=patient.id,
        appointment_id=appt.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.SYSTEM.value,
        description="Consultation fee",
        quantity=Decimal("1"),
        rate_paise=fee_paise,
        original_amount_paise=fee_paise,
        amount_paise=fee_paise,
        created_by_user_id=user.id,
    )
    db_session.add(line)
    db_session.flush()
    return appt


def test_visit_payment_partial_and_full(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Visit with ₹500 due: pay ₹200 (balance ₹300), pay ₹200 (balance ₹100), pay ₹100 (balance ₹0).

    Three payment rows remain, none overwritten (BILL-08, BILL-09, BILL-07, BILL-10, BILL-11).
    """
    client = login_client(reception_user)
    patient = _patient(db_session, "01")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, ConsultationStatus.COMPLETED.value, fee_paise=50000)

    # 1. Pay ₹200 (20,000 paise) -> 201
    pay1 = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 20000,
            "payment_method": "CASH",
            "notes": "First partial",
        },
    )
    assert pay1.status_code == 201, pay1.text
    p1_data = pay1.json()
    assert p1_data["visit_id"] == visit.id
    assert p1_data["amount_paise"] == 20000
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 30000

    # 2. Pay ₹200 (20,000 paise) -> 201
    pay2 = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 20000,
            "payment_method": "UPI",
            "notes": "Second partial",
        },
    )
    assert pay2.status_code == 201, pay2.text
    p2_data = pay2.json()
    assert p2_data["visit_id"] == visit.id
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 10000

    # 3. Pay ₹100 (10,000 paise) -> 201
    pay3 = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 10000,
            "payment_method": "CARD",
            "notes": "Final settlement",
        },
    )
    assert pay3.status_code == 201, pay3.text
    p3_data = pay3.json()
    assert p3_data["visit_id"] == visit.id
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 0

    # Verify all 3 payment rows exist and none overwritten
    payments = db_session.scalars(
        select(Payment).where(Payment.visit_id == visit.id).order_by(Payment.id)
    ).all()
    assert len(payments) == 3
    assert [p.amount_paise for p in payments] == [20000, 20000, 10000]
    assert [p.payment_method for p in payments] == ["CASH", "UPI", "CARD"]

    # Verify audit trail has visit_id
    audit_rows = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.PAYMENT_RECORDED.value,
            AuditLog.entity_id.in_([str(p.id) for p in payments]),
        )
    ).all()
    assert len(audit_rows) == 3
    for a in audit_rows:
        assert a.after_data is not None
        assert a.after_data["visit_id"] == visit.id


def test_visit_payment_overpayment_rejected(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Paying ₹1 more than the due returns 422 overpayment_rejected (BILL-13)."""
    client = login_client(reception_user)
    patient = _patient(db_session, "02")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, ConsultationStatus.COMPLETED.value, fee_paise=50000)

    # Pay 50,100 paise (exceeds ₹500 by ₹1)
    res = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 50100,
            "payment_method": "CASH",
        },
    )
    assert res.status_code == 422
    assert res.json()["code"] == "overpayment_rejected"


def test_visit_payment_target_conflict(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """visit_id together with appointment_id or treatment_plan_id returns 422 payment_target_conflict."""
    client = login_client(reception_user)
    patient = _patient(db_session, "03")
    visit = _visit(db_session, patient, reception_user)
    appt = _consultation(db_session, visit, patient, doctor_a_user, reception_user, ConsultationStatus.COMPLETED.value, fee_paise=50000)

    # 1. visit_id + appointment_id
    res1 = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "appointment_id": appt.id,
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert res1.status_code == 422
    assert res1.json()["code"] == "payment_target_conflict"

    # 2. visit_id + treatment_plan_id
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Knee Rehab",
        condition_diagnosis="Knee osteoarthritis",
        agreed_price_paise=100000,
        total_sessions=10,
        completed_sessions=0,
        status="ACTIVE",
    )
    db_session.add(plan)
    db_session.flush()

    res2 = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert res2.status_code == 422
    assert res2.json()["code"] == "payment_target_conflict"


def test_visit_payment_other_patient_or_missing_visit(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """visit_id of another patient's visit returns 404 visit_not_found."""
    client = login_client(reception_user)
    pat_a = _patient(db_session, "04A")
    pat_b = _patient(db_session, "04B")

    visit_a = _visit(db_session, pat_a, reception_user)
    _consultation(db_session, visit_a, pat_a, doctor_a_user, reception_user, ConsultationStatus.COMPLETED.value, fee_paise=50000)

    # Paying visit_a under pat_b
    res = client.post(
        "/api/payments",
        json={
            "patient_id": pat_b.id,
            "visit_id": visit_a.id,
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert res.status_code == 404
    assert res.json()["code"] == "visit_not_found"

    # Non-existent visit
    res_missing = client.post(
        "/api/payments",
        json={
            "patient_id": pat_a.id,
            "visit_id": 99999999,
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert res_missing.status_code == 404
    assert res_missing.json()["code"] == "visit_not_found"


def test_visit_payment_checkout_not_open_until_consultation_completed(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """A visit with no COMPLETED consultation returns 422 checkout_not_open; once one consultation is COMPLETED it succeeds (OD-D)."""
    client = login_client(reception_user)
    patient = _patient(db_session, "05")
    visit = _visit(db_session, patient, reception_user)

    # WAITING consultation
    appt1 = _consultation(
        db_session,
        visit,
        patient,
        doctor_a_user,
        reception_user,
        ConsultationStatus.WAITING.value,
        fee_paise=50000,
    )

    # Payment rejected before consultation completes
    res_waiting = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 20000,
            "payment_method": "CASH",
        },
    )
    assert res_waiting.status_code == 422
    assert res_waiting.json()["code"] == "checkout_not_open"

    # IN_CONSULTATION consultation
    appt1.consultation_status = ConsultationStatus.IN_CONSULTATION.value
    db_session.flush()

    res_in_prog = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 20000,
            "payment_method": "CASH",
        },
    )
    assert res_in_prog.status_code == 422
    assert res_in_prog.json()["code"] == "checkout_not_open"

    # Complete appt1
    appt1.consultation_status = ConsultationStatus.COMPLETED.value
    # Add a second consultation for doctor_b that is still WAITING
    _consultation(
        db_session,
        visit,
        patient,
        doctor_b_user,
        reception_user,
        ConsultationStatus.WAITING.value,
        fee_paise=40000,
    )
    db_session.flush()

    # Now payment succeeds even while consultation 2 is WAITING (OD-D)
    res_ok = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert res_ok.status_code == 201, res_ok.text
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 20000


def test_closed_visit_payment_keeps_status_closed(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Paying the due of a CLOSED visit succeeds and the visit stays CLOSED; treatment plan payment keeps own cap (LED-08, LED-09)."""
    client = login_client(reception_user)
    patient = _patient(db_session, "06")
    visit = _visit(
        db_session,
        patient,
        reception_user,
        status=VisitStatus.CLOSED.value,
        closed_at=datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc),
        closed_by_user_id=reception_user.id,
        close_reason="Will pay balance tomorrow",
    )
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, ConsultationStatus.COMPLETED.value, fee_paise=50000)

    # Treatment plan for same patient
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Physio Package",
        condition_diagnosis="Low back pain",
        agreed_price_paise=100000,
        total_sessions=10,
        completed_sessions=0,
        status="ACTIVE",
    )
    db_session.add(plan)
    db_session.flush()

    # Treatment plan payment succeeds, keeps its own cap, does not change visit due
    pay_plan = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 40000,
            "payment_method": "UPI",
        },
    )
    assert pay_plan.status_code == 201
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 50000

    # Pay visit due
    pay_visit = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 50000,
            "payment_method": "CASH",
        },
    )
    assert pay_visit.status_code == 201
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 0

    # Visit remains CLOSED
    db_session.expire_all()
    v_db = db_session.get(Visit, visit.id)
    assert v_db is not None
    assert v_db.status == VisitStatus.CLOSED.value


def test_legacy_appointment_payment_capped_by_visit_due(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """A legacy appointment_id payment above the visit due (even on a waived, zero-fee consultation) returns 422 overpayment_rejected."""
    client = login_client(reception_user)
    patient = _patient(db_session, "07")
    visit = _visit(db_session, patient, reception_user)
    appt = _consultation(db_session, visit, patient, doctor_a_user, reception_user, ConsultationStatus.COMPLETED.value, fee_paise=50000)

    # 1. Part pay ₹300 on visit level
    pay_v = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert pay_v.status_code == 201
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 20000

    # Legacy appointment payment for ₹300 (> visit remaining due ₹200) -> 422 overpayment_rejected
    pay_legacy_over = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert pay_legacy_over.status_code == 422
    assert pay_legacy_over.json()["code"] == "overpayment_rejected"

    # Paying exact remaining ₹200 on appointment succeeds
    pay_legacy_ok = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "amount_paise": 20000,
            "payment_method": "CASH",
        },
    )
    assert pay_legacy_ok.status_code == 201
    assert billing_service.visit_outstanding_paise(db_session, visit.id) == 0

    # 2. Waived (zero-fee) consultation when visit due is 0: paying any amount on appointment returns 422
    patient_zero = _patient(db_session, "07Z")
    visit_zero = _visit(db_session, patient_zero, reception_user)
    appt_zero = _consultation(
        db_session,
        visit_zero,
        patient_zero,
        doctor_a_user,
        reception_user,
        ConsultationStatus.COMPLETED.value,
        fee_paise=0,
    )
    assert billing_service.visit_outstanding_paise(db_session, visit_zero.id) == 0

    pay_zero_over = client.post(
        "/api/payments",
        json={
            "patient_id": patient_zero.id,
            "appointment_id": appt_zero.id,
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert pay_zero_over.status_code == 422
    assert pay_zero_over.json()["code"] == "overpayment_rejected"


def test_payment_cannot_be_patched_or_deleted_and_reception_cannot_reverse(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """PATCH or DELETE on /api/payments/{id} is refused (405 or 404) and reception reversing a payment gets 403 (BILL-14, BILL-15)."""
    client = login_client(reception_user)
    patient = _patient(db_session, "08")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, ConsultationStatus.COMPLETED.value, fee_paise=50000)

    pay = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 20000,
            "payment_method": "CASH",
        },
    )
    assert pay.status_code == 201
    payment_id = pay.json()["id"]

    # PATCH /api/payments/{id} -> 405 (or 404)
    res_patch = client.patch(f"/api/payments/{payment_id}", json={"amount_paise": 10000})
    assert res_patch.status_code in (404, 405)

    # DELETE /api/payments/{id} -> 405 (or 404)
    res_del = client.delete(f"/api/payments/{payment_id}")
    assert res_del.status_code in (404, 405)

    # Reception cannot reverse payment -> 403
    res_rev = client.post(
        f"/api/payments/{payment_id}/reverse",
        json={"reversal_reason": "Mistake by cashier"},
    )
    assert res_rev.status_code == 403


@pytest.mark.concurrency
def test_concurrent_visit_payments_exact_single_winner(
    app_engine: Engine,
    owner_engine: Engine,
    test_settings: Settings,
) -> None:
    """Two concurrent threads each paying 60% of the due on the same visit: exactly one 201, one 422; paid total never exceeds the due."""
    concurrency_app = create_app(test_settings)

    def _get_concurrency_session():
        sess = Session(app_engine)
        try:
            yield sess
            sess.commit()
        except Exception:
            sess.rollback()
            raise
        finally:
            sess.close()

    concurrency_app.dependency_overrides[get_session] = _get_concurrency_session

    uid = uuid.uuid4().hex[:8]
    username_a = f"rec_race_a_{uid}"
    username_b = f"rec_race_b_{uid}"

    # Setup database records in app_engine
    with Session(app_engine) as sess:
        # Reception users A and B
        u_a = make_user(sess, test_settings, "RECEPTION", username_a)
        u_b = make_user(sess, test_settings, "RECEPTION", username_b)

        # Doctor
        doc_u = make_user(sess, test_settings, "DOCTOR", f"doc_race_{uid}")
        doc = sess.get(Doctor, doc_u.doctor_id)
        assert doc is not None
        doc.default_fee_paise = 100000
        sess.flush()

        pat = Patient(
            urn=f"KH-2026-CR{uid}",
            full_name=f"Race Patient {uid}",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543000",
            address="Race Road",
        )
        sess.add(pat)
        sess.flush()

        vis = Visit(
            patient_id=pat.id,
            visit_date=TODAY,
            status=VisitStatus.OPEN.value,
            opened_by_user_id=u_a.id,
        )
        sess.add(vis)
        sess.flush()

        # Consultation with ₹1000 due (100,000 paise)
        appt = Appointment(
            patient_id=pat.id,
            doctor_id=doc.id,
            appointment_date=TODAY,
            token_number=next(_TOKENS),
            status="ARRIVED",
            consultation_status=ConsultationStatus.COMPLETED.value,
            visit_id=vis.id,
            created_by_user_id=u_a.id,
        )
        sess.add(appt)
        sess.flush()

        line = BillItem(
            visit_id=vis.id,
            patient_id=pat.id,
            appointment_id=appt.id,
            category=BillItemCategory.CONSULTATION.value,
            source=BillItemSource.SYSTEM.value,
            description="Consultation fee",
            quantity=Decimal("1"),
            rate_paise=100000,
            original_amount_paise=100000,
            amount_paise=100000,
            created_by_user_id=u_a.id,
        )
        sess.add(line)
        sess.commit()

        patient_id = pat.id
        visit_id = vis.id

    try:
        client_a = TestClient(
            concurrency_app,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
        )
        client_b = TestClient(
            concurrency_app,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
        )

        # Login both clients
        login_a = client_a.post("/api/auth/login", json={"username": username_a, "password": TEST_PASSWORD})
        assert login_a.status_code == 200, login_a.text
        client_a.headers["X-CSRF-Token"] = login_a.json()["csrf_token"]

        login_b = client_b.post("/api/auth/login", json={"username": username_b, "password": TEST_PASSWORD})
        assert login_b.status_code == 200, login_b.text
        client_b.headers["X-CSRF-Token"] = login_b.json()["csrf_token"]

        # Each attempts to pay ₹600 (60,000 paise) against ₹1000 due
        payload = {
            "patient_id": patient_id,
            "visit_id": visit_id,
            "amount_paise": 60000,
            "payment_method": "CASH",
        }

        def _pay_a():
            return client_a.post("/api/payments", json=payload)

        def _pay_b():
            return client_b.post("/api/payments", json=payload)

        with ThreadPoolExecutor(max_workers=2) as executor:
            f_a = executor.submit(_pay_a)
            f_b = executor.submit(_pay_b)
            resp_a = f_a.result()
            resp_b = f_b.result()

        statuses = sorted([resp_a.status_code, resp_b.status_code])
        assert statuses == [201, 422], f"Expected [201, 422] but got {statuses}: A={resp_a.text}, B={resp_b.text}"

        # Verify database state
        with Session(app_engine) as sess:
            tot = billing_service.visit_totals(sess, [visit_id])[visit_id]
            assert tot.paid_paise == 60000
            assert tot.due_paise == 40000
    finally:
        with owner_engine.connect() as conn:
            conn.execute(text("ALTER TABLE payments DISABLE TRIGGER USER"))
            conn.execute(text("DELETE FROM payments WHERE visit_id = :vid"), {"vid": visit_id})
            conn.execute(text("DELETE FROM bill_items WHERE visit_id = :vid"), {"vid": visit_id})
            conn.execute(text("DELETE FROM appointments WHERE visit_id = :vid"), {"vid": visit_id})
            conn.execute(text("DELETE FROM visits WHERE id = :vid"), {"vid": visit_id})
            conn.execute(text("DELETE FROM patients WHERE id = :pid"), {"pid": patient_id})
            conn.execute(text("ALTER TABLE payments ENABLE TRIGGER USER"))
            conn.commit()
