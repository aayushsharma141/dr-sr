"""Billing configuration and ledger, hospital identity, and system service checks."""

from collections.abc import Callable
from datetime import UTC, datetime, time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, BackupRun, BackupSettings, Patient, User
from kalyan_api.services.audit_service import AuditAction

CONFIG = "/api/billing/configuration"
LEDGER = "/api/billing/ledger"
STATUS = "/api/system/status"


def _patient(session: Session, suffix: str, name: str = "Ledger Patient") -> Patient:
    patient = Patient(
        urn=f"KH-2026-LED{suffix}",
        full_name=name,
        guardian_name="Guardian",
        gender="F",
        age_years=40,
        mobile=f"98765422{suffix}",
        address="Bhojpur",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(patient)
    session.flush()
    return patient


def _pay(client: TestClient, patient: Patient) -> dict[str, Any]:
    res = client.post(
        "/api/payments",
        json={"patient_id": patient.id, "amount_paise": 50000, "payment_method": "CASH"},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_configuration_reports_what_is_in_force(
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    admin = login_client(admin_user)
    before = admin.get(CONFIG).json()
    assert before["payment_methods"] == ["CASH", "UPI", "CARD"]
    assert before["reversal_roles"] == ["ADMIN"]

    preview = before["next_receipt_number"]
    payment = _pay(login_client(reception_user), _patient(db_session, "01"))
    assert payment["receipt_number"] == preview

    after = admin.get(CONFIG).json()
    assert after["receipts_issued_in_cycle"] == before["receipts_issued_in_cycle"] + 1
    assert after["next_receipt_number"] != preview


def test_previewing_does_not_consume_a_receipt_number(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    admin = login_client(admin_user)
    first = admin.get(CONFIG).json()["next_receipt_number"]
    assert admin.get(CONFIG).json()["next_receipt_number"] == first


def test_ledger_finds_payments_and_reversal_register(
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    desk = login_client(reception_user)
    admin = login_client(admin_user)
    kept = _pay(desk, _patient(db_session, "02", "Asha Kumari"))
    undone = _pay(desk, _patient(db_session, "03", "Ramesh Singh"))
    res = admin.post(
        f"/api/payments/{undone['id']}/reverse", json={"reversal_reason": "Duplicate entry"}
    )
    assert res.status_code == 200, res.text

    by_name = admin.get(LEDGER, params={"q": "asha"}).json()
    assert [p["id"] for p in by_name] == [kept["id"]]
    by_urn = admin.get(LEDGER, params={"q": "KH-2026-LED03"}).json()
    assert [p["id"] for p in by_urn] == [undone["id"]]
    by_receipt = admin.get(LEDGER, params={"q": kept["receipt_number"]}).json()
    assert [p["id"] for p in by_receipt] == [kept["id"]]

    reversed_only = admin.get(LEDGER, params={"status": "reversed"}).json()
    assert [p["id"] for p in reversed_only] == [undone["id"]]
    assert reversed_only[0]["reversal_reason"] == "Duplicate entry"
    assert reversed_only[0]["reversed_by_username"] == admin_user.username
    active = admin.get(LEDGER, params={"status": "active"}).json()
    assert [p["id"] for p in active] == [kept["id"]]


def test_ledger_search_treats_wildcards_as_text(
    login_client: Callable[..., TestClient],
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    _pay(login_client(reception_user), _patient(db_session, "04"))
    admin = login_client(admin_user)
    assert admin.get(LEDGER, params={"q": "%"}).json() == []
    assert admin.get(LEDGER, params={"q": "_"}).json() == []


def test_billing_admin_views_are_admin_only(
    client: TestClient,
    login_client: Callable[..., TestClient],
    reception_user: User,
    doctor_a_user: User,
) -> None:
    for url in (CONFIG, LEDGER):
        assert client.get(url).status_code == 401
        assert login_client(reception_user).get(url).status_code == 403
        assert login_client(doctor_a_user).get(url).status_code == 403


def test_hospital_identity_persists_and_is_audited(
    login_client: Callable[..., TestClient], admin_user: User, db_session: Session
) -> None:
    client = login_client(admin_user)
    current = client.get("/api/settings").json()
    assert current["trust_name_en"] == "Sri Vashishtha Kalyan Trust"
    assert current["location_line"] == "Ara, Bhojpur, Bihar"
    assert current["trust_name_hi"] == "श्री वशिष्ठ कल्याण ट्रस्ट"

    body = {
        key: current[key]
        for key in (
            "name_en",
            "name_hi",
            "address_1",
            "address_2",
            "phone",
            "email",
            "receipt_sequence_cycle",
            "print_header_en",
            "print_header_hi",
            "print_footer_en",
            "print_footer_hi",
            "consultation_validity_days",
            "version_id",
        )
    }
    res = client.patch(
        "/api/settings", json={**body, "trust_name_en": "New Trust", "location_line": "Garhani"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["trust_name_en"] == "New Trust"

    row = db_session.scalars(
        select(AuditLog).where(AuditLog.action == AuditAction.SETTINGS_UPDATED.value)
    ).one()
    assert row.before_data["trust_name_en"] == "Sri Vashishtha Kalyan Trust"
    assert row.after_data["location_line"] == "Garhani"


def test_older_clients_leave_hospital_identity_unchanged(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    client = login_client(admin_user)
    current = client.get("/api/settings").json()
    body = {
        key: value
        for key, value in current.items()
        if key not in ("id", "created_at", "updated_at", "trust_name_en", "trust_name_hi", "location_line")
    }
    res = client.patch("/api/settings", json=body)
    assert res.status_code == 200, res.text
    assert res.json()["trust_name_en"] == current["trust_name_en"]


def _checks(client: TestClient) -> dict[str, dict[str, str]]:
    return {c["key"]: c for c in client.get(STATUS).json()["checks"]}


def test_service_checks_report_real_state(
    login_client: Callable[..., TestClient],
    admin_user: User,
    test_settings: Settings,
    tmp_path: Path,
    app: Any,
    db_session: Session,
) -> None:
    photos = tmp_path / "photos"
    photos.mkdir()
    app.state.settings = test_settings.model_copy(
        update={"photos_dir": photos, "backup_dir": tmp_path / "missing"}
    )
    client = login_client(admin_user)

    checks = _checks(client)
    assert checks["database"]["status"] == "ok"
    assert checks["photos"]["status"] == "ok"
    assert checks["backups"]["status"] == "error"
    assert checks["last_backup_run"]["status"] == "warning"
    assert checks["backup_schedule"]["status"] == "not_configured"
    assert list(photos.iterdir()) == []

    db_session.add(
        BackupRun(
            trigger="SCHEDULED",
            outcome="FAILURE",
            started_at=datetime(2026, 11, 4, 0, 0, tzinfo=UTC),
            error_type="RuntimeError",
        )
    )
    db_session.flush()
    assert _checks(client)["last_backup_run"]["status"] == "error"


def test_missed_schedule_raises_check_and_dashboard_alert(
    login_client: Callable[..., TestClient],
    admin_user: User,
    db_session: Session,
    clock: dict[str, Any],
) -> None:
    client = login_client(admin_user)
    config = db_session.get(BackupSettings, 1)
    assert config is not None
    config.schedule_enabled = True
    config.run_at = time(2, 0)
    db_session.flush()
    db_session.execute(
        text("UPDATE backup_settings SET updated_at = :at WHERE id = 1"),
        {"at": datetime(2026, 1, 1, tzinfo=UTC)},
    )
    db_session.refresh(config)

    assert _checks(client)["backup_schedule"]["status"] == "error"
    alerts = client.get("/api/admin/overview").json()["alerts"]
    assert "scheduled_backup_overdue" in [a["code"] for a in alerts]
