"""Receipt reprint audit tests (BIL-04).

Guarantees:
- GET /api/payments/{id}/receipt writes one RECEIPT_REPRINTED audit row per reprint,
  attributed to the caller, carrying the receipt number.
- Plain payment reads (GET /api/payments/{id}) are not recorded as reprints.
- Unknown payment ids return 404 and write no reprint audit row.
- Doctors cannot reprint receipts (403) and no audit row is written for them.
"""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.models import AuditLog, Patient, User


def _record_payment(db_session: Session, rec_c: Any, suffix: str) -> dict[str, Any]:
    patient = Patient(
        urn=f"KH-2026-RPRT{suffix}",
        full_name=f"Reprint Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=45,
        mobile=f"98765422{suffix}",
        address="Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    resp = rec_c.post(
        "/api/payments",
        json={"patient_id": patient.id, "amount_paise": 25000, "payment_method": "CASH"},
    )
    assert resp.status_code == 201, resp.text
    payment: dict[str, Any] = resp.json()
    return payment


def _reprint_count(db_session: Session, payment_id: int) -> int:
    return (
        db_session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.action == "RECEIPT_REPRINTED",
                AuditLog.entity_id == str(payment_id),
            )
        )
        or 0
    )


def test_receipt_reprint_is_audited(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    """Each reprint writes a RECEIPT_REPRINTED row with actor and receipt number."""
    rec_c = login_client(reception_user)
    payment = _record_payment(db_session, rec_c, "01")

    # Viewing payment details is not a reprint
    assert rec_c.get(f"/api/payments/{payment['id']}").status_code == 200
    assert _reprint_count(db_session, payment["id"]) == 0

    resp = rec_c.get(f"/api/payments/{payment['id']}/receipt")
    assert resp.status_code == 200
    assert resp.json()["receipt_number"] == payment["receipt_number"]

    row = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == "RECEIPT_REPRINTED",
            AuditLog.entity_id == str(payment["id"]),
        )
    ).one()
    assert row.entity_type == "payment"
    assert row.actor_user_id == reception_user.id
    assert row.actor_role == "RECEPTION"
    assert row.outcome == "SUCCESS"
    assert row.after_data["receipt_number"] == payment["receipt_number"]
    assert row.after_data["amount_paise"] == 25000
    assert row.after_data["is_reversed"] is False

    # A second reprint (by admin) is a second audit row
    admin_c = login_client(admin_user)
    assert admin_c.get(f"/api/payments/{payment['id']}/receipt").status_code == 200
    assert _reprint_count(db_session, payment["id"]) == 2


def test_receipt_reprint_unknown_payment_not_audited(
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """A 404 reprint does not write an audit row."""
    rec_c = login_client(reception_user)
    resp = rec_c.get("/api/payments/987654321/receipt")
    assert resp.status_code == 404
    assert resp.json()["code"] == "payment_not_found"
    assert _reprint_count(db_session, 987654321) == 0


def test_receipt_reprint_forbidden_for_doctor(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Doctors are refused (403) and nothing is audited as a reprint."""
    rec_c = login_client(reception_user)
    payment = _record_payment(db_session, rec_c, "02")

    doc_c = login_client(doctor_a_user)
    assert doc_c.get(f"/api/payments/{payment['id']}/receipt").status_code == 403
    assert _reprint_count(db_session, payment["id"]) == 0
