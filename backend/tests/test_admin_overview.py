"""Tests for the extended Administration Dashboard overview (Admin Panel module 01).

GET /api/admin/overview keeps its path and DASHBOARD_ADMIN permission and now reports today's
operational snapshot (IST business day), ledger activity (gross and reversals separately),
outstanding dues via the pending-dues ledger logic, security counters, recent admin actions,
backup / integrity status, storage headroom and factual alerts.

Assertions are written as deltas against a baseline response so residual rows in the shared
test database cannot make them flaky.
"""

import hashlib
import io
import json
import tarfile
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import make_user
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.models import Appointment, Patient, TreatmentPlan, User
from kalyan_api.routers import areas
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext, Outcome

OVERVIEW = "/api/admin/overview"


@pytest.fixture
def overview_settings(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings, tmp_path: Path
) -> Settings:
    settings = test_settings.model_copy(
        update={"backup_dir": tmp_path / "backups", "photos_dir": tmp_path / "photos"}
    )
    settings.backup_dir.mkdir(parents=True)
    settings.photos_dir.mkdir(parents=True)
    monkeypatch.setattr(areas, "get_settings", lambda: settings)
    return settings


def _archive(directory: Path, name: str, created_at: str) -> Path:
    db_bytes = b"SELECT 1;\n"
    manifest = {
        "version": "1.0",
        "created_at": created_at,
        "database_dump_filename": "db.sql",
        "database_dump_sha256": hashlib.sha256(db_bytes).hexdigest(),
        "database_dump_bytes": len(db_bytes),
        "photos_count": 0,
        "photos_manifest": [],
        "label": "nightly",
    }
    path = directory / name
    with tarfile.open(path, "w:gz") as tar:
        for arcname, payload in (
            ("manifest.json", json.dumps(manifest).encode("utf-8")),
            ("db.sql", db_bytes),
        ):
            info = tarfile.TarInfo(name=arcname)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return path


def _patient(session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2096-OV{suffix}",
        full_name=f"Overview Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=33,
        mobile=f"98700000{suffix}",
        address="Ward 4",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(patient)
    session.flush()
    return patient


def _alert_codes(body: dict[str, Any]) -> set[str]:
    return {a["code"] for a in body["alerts"]}


def _doctor_row(body: dict[str, Any], doctor_id: int) -> dict[str, Any]:
    return next(d for d in body["doctors_today"] if d["doctor_id"] == doctor_id)


def test_admin_overview_rbac(
    client: TestClient,
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    admin_user: User,
    overview_settings: Settings,
) -> None:
    assert client.get(OVERVIEW).status_code == 401
    assert login_client(reception_user).get(OVERVIEW).status_code == 403
    assert login_client(doctor_a_user).get(OVERVIEW).status_code == 403
    assert login_client(admin_user).get(OVERVIEW).status_code == 200


def test_admin_overview_shape_and_backward_compatible_fields(
    login_client: Any, admin_user: User, overview_settings: Settings
) -> None:
    body = login_client(admin_user).get(OVERVIEW).json()
    # Pre-existing contract is preserved
    assert body["area"] == "admin"
    assert body["role"] == "ADMIN"
    assert set(body["user_counts"]) >= {"ADMIN", "RECEPTION", "DOCTOR"}
    # New sections
    assert body["business_date"] == clock.ist_today().isoformat()
    assert set(body["appointments_today"]) == {
        "BOOKED",
        "ARRIVED",
        "IN_CONSULTATION",
        "DONE",
        "CANCELLED",
        "NO_SHOW",
    }
    assert set(body["collections_today"]) == {
        "payments_count",
        "gross_paise",
        "reversals_count",
        "reversed_paise",
        "by_method",
    }
    assert set(body["collections_today"]["by_method"]) == {"CASH", "UPI", "CARD"}
    assert isinstance(body["storage"]["data_free_bytes"], int)
    assert isinstance(body["storage"]["backup_free_bytes"], int)
    assert body["last_backup"] is None
    assert "no_backup_yet" in _alert_codes(body)
    for alert in body["alerts"]:
        assert set(alert) == {"code", "severity", "message"}


def test_admin_overview_today_queue_registrations_and_ledger(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
    overview_settings: Settings,
) -> None:
    admin_c = login_client(admin_user)
    before = admin_c.get(OVERVIEW).json()

    today = clock.ist_today()
    patients = [_patient(db_session, f"{i:02d}") for i in range(4)]
    statuses_a = ["BOOKED", "ARRIVED", "IN_CONSULTATION", "DONE", "CANCELLED"]
    for token, status_value in enumerate(statuses_a, start=1):
        db_session.add(
            Appointment(
                patient_id=patients[token % 4].id,
                doctor_id=doctor_a_user.doctor_id,
                appointment_date=today,
                token_number=900 + token,
                status=status_value,
                created_by_user_id=reception_user.id,
            )
        )
    db_session.add(
        Appointment(
            patient_id=patients[0].id,
            doctor_id=doctor_b_user.doctor_id,
            appointment_date=today,
            token_number=901,
            status="DONE",
            created_by_user_id=reception_user.id,
        )
    )
    # Yesterday's appointment must not be counted
    db_session.add(
        Appointment(
            patient_id=patients[1].id,
            doctor_id=doctor_b_user.doctor_id,
            appointment_date=today - timedelta(days=1),
            token_number=902,
            status="BOOKED",
            created_by_user_id=reception_user.id,
        )
    )
    plan = TreatmentPlan(
        patient_id=patients[2].id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Overview Rehab",
        condition_diagnosis="Knee OA",
        total_sessions=5,
        agreed_price_paise=500000,
    )
    db_session.add(plan)
    db_session.flush()

    rec_c = login_client(reception_user)
    pay_ids: list[int] = []
    for amount, method, plan_id in (
        (30000, "CASH", None),
        (45000, "UPI", None),
        (200000, "CARD", plan.id),
    ):
        body: dict[str, Any] = {
            "patient_id": patients[2].id,
            "amount_paise": amount,
            "payment_method": method,
        }
        if plan_id is not None:
            body["treatment_plan_id"] = plan_id
        res = rec_c.post("/api/payments", json=body)
        assert res.status_code == 201, res.text
        pay_ids.append(res.json()["id"])

    rev = admin_c.post(
        f"/api/payments/{pay_ids[1]}/reverse", json={"reversal_reason": "Duplicate UPI entry"}
    )
    assert rev.status_code == 200, rev.text

    after = admin_c.get(OVERVIEW).json()

    assert after["registrations_today"] - before["registrations_today"] == 4

    appt_delta = {
        k: after["appointments_today"][k] - before["appointments_today"][k]
        for k in after["appointments_today"]
    }
    assert appt_delta == {
        "BOOKED": 1,
        "ARRIVED": 1,
        "IN_CONSULTATION": 1,
        "DONE": 2,
        "CANCELLED": 1,
        "NO_SHOW": 0,
    }

    doc_a = _doctor_row(after, doctor_a_user.doctor_id)
    doc_a_before = _doctor_row(before, doctor_a_user.doctor_id)
    assert doc_a["name"] == "Dr. Anil"
    assert doc_a["appointments_today"] - doc_a_before["appointments_today"] == 5
    assert doc_a["waiting"] - doc_a_before["waiting"] == 2  # BOOKED + ARRIVED
    assert doc_a["in_consultation"] - doc_a_before["in_consultation"] == 1
    assert doc_a["done"] - doc_a_before["done"] == 1
    doc_b = _doctor_row(after, doctor_b_user.doctor_id)
    doc_b_before = _doctor_row(before, doctor_b_user.doctor_id)
    assert doc_b["appointments_today"] - doc_b_before["appointments_today"] == 1
    assert doc_b["waiting"] - doc_b_before["waiting"] == 0

    col_b, col_a = before["collections_today"], after["collections_today"]
    # Gross includes the payment reversed later today; reversals are reported separately.
    assert col_a["payments_count"] - col_b["payments_count"] == 3
    assert col_a["gross_paise"] - col_b["gross_paise"] == 275000
    assert col_a["reversals_count"] - col_b["reversals_count"] == 1
    assert col_a["reversed_paise"] - col_b["reversed_paise"] == 45000
    assert col_a["by_method"]["CASH"] - col_b["by_method"]["CASH"] == 30000
    assert col_a["by_method"]["UPI"] - col_b["by_method"]["UPI"] == 45000
    assert col_a["by_method"]["CARD"] - col_b["by_method"]["CARD"] == 200000
    assert isinstance(col_a["gross_paise"], int)

    # Outstanding dues mirror the pending-dues endpoint (BIL-03): 500000 - 200000
    assert after["outstanding_dues_paise"] - before["outstanding_dues_paise"] == 300000
    dues = admin_c.get("/api/billing/pending-dues")
    if dues.status_code == 200:
        assert after["outstanding_dues_paise"] == sum(d["balance_paise"] for d in dues.json())


def test_admin_overview_security_counters_and_recent_admin_actions(
    login_client: Any,
    make_client: Any,
    admin_user: User,
    reception_user: User,
    db_session: Session,
    test_settings: Settings,
    overview_settings: Settings,
) -> None:
    admin_c = login_client(admin_user)
    before = admin_c.get(OVERVIEW).json()

    locked = make_user(db_session, test_settings, "RECEPTION", "overview_locked")
    locked.locked_until = clock.utcnow() + timedelta(minutes=10)
    expired = make_user(db_session, test_settings, "RECEPTION", "overview_unlocked")
    expired.locked_until = clock.utcnow() - timedelta(minutes=10)
    db_session.flush()

    bad = make_client("10.9.8.7").post(
        "/api/auth/login", json={"username": reception_user.username, "password": "wrong-pass-1"}
    )
    assert bad.status_code == 401

    admin_ctx = AuditContext(admin_user.id, admin_user.username, "ADMIN")
    rec_ctx = AuditContext(reception_user.id, reception_user.username, "RECEPTION")
    for i in range(12):
        audit_service.record(db_session, admin_ctx, AuditAction.SETTINGS_UPDATED, "ov_admin", i)
    audit_service.record(
        db_session, rec_ctx, AuditAction.PATIENT_UPDATED, "ov_reception_marker", "x"
    )
    db_session.flush()

    after = admin_c.get(OVERVIEW).json()
    assert after["locked_accounts"] - before["locked_accounts"] == 1
    assert after["locked_accounts"] >= 1
    assert "accounts_locked" in _alert_codes(after)
    assert after["failed_logins_24h"] - before["failed_logins_24h"] >= 1

    recent = after["recent_admin_actions"]
    assert len(recent) == 10
    assert all(r["entity_type"] != "ov_reception_marker" for r in recent)
    assert any(r["entity_type"] == "ov_admin" for r in recent)
    assert set(recent[0]) == {
        "occurred_at",
        "actor_username",
        "action",
        "entity_type",
        "entity_id",
        "outcome",
    }
    stamps = [r["occurred_at"] for r in recent]
    assert stamps == sorted(stamps, reverse=True)


def test_admin_overview_backup_and_integrity_status(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    overview_settings: Settings,
) -> None:
    admin_c = login_client(admin_user)
    backup_dir = overview_settings.backup_dir

    # A successful backup in the past, then a BACKUP_FAILED audit now -> last_backup_failed
    _archive(
        backup_dir, "kalyan_backup_20200101_000000_nightly.tar.gz", "2020-01-01T00:00:00+00:00"
    )
    admin_ctx = AuditContext(admin_user.id, admin_user.username, "ADMIN")
    audit_service.record(
        db_session,
        admin_ctx,
        AuditAction.BACKUP_FAILED,
        "backup",
        None,
        after={"error": "RuntimeError: disk full"},
        outcome=Outcome.FAILURE,
    )
    audit_service.record(
        db_session,
        admin_ctx,
        AuditAction.INTEGRITY_CHECK_RUN,
        "system",
        "integrity_audit",
        after={"is_healthy": False, "total_checks": 6, "failed_checks": 1},
    )
    db_session.flush()

    body = admin_c.get(OVERVIEW).json()
    assert body["last_backup"]["filename"] == "kalyan_backup_20200101_000000_nightly.tar.gz"
    assert body["last_backup"]["created_at"].startswith("2020-01-01T00:00:00")
    assert body["last_backup"]["label"] == "nightly"
    assert body["last_backup"]["manifest_readable"] is True
    assert body["last_backup"]["size_bytes"] > 0
    assert body["last_backup_failure_at"] is not None
    assert body["last_integrity_check"]["outcome"] == "SUCCESS"
    assert body["last_integrity_check"]["is_healthy"] is False
    codes = _alert_codes(body)
    assert "no_backup_yet" not in codes
    assert "last_backup_failed" in codes
    assert "integrity_issues" in codes

    # A newer successful backup supersedes the failure; a healthy check clears integrity alert
    _archive(
        backup_dir, "kalyan_backup_29990101_000000_nightly.tar.gz", "2999-01-01T00:00:00+00:00"
    )
    audit_service.record(
        db_session,
        admin_ctx,
        AuditAction.INTEGRITY_CHECK_RUN,
        "system",
        "integrity_audit",
        after={"is_healthy": True, "total_checks": 6, "failed_checks": 0},
    )
    db_session.flush()
    import os

    os.utime(backup_dir / "kalyan_backup_29990101_000000_nightly.tar.gz", (2_000_000_000,) * 2)

    body2 = admin_c.get(OVERVIEW).json()
    assert body2["last_backup"]["filename"] == "kalyan_backup_29990101_000000_nightly.tar.gz"
    assert body2["last_integrity_check"]["is_healthy"] is True
    codes2 = _alert_codes(body2)
    assert "last_backup_failed" not in codes2
    assert "integrity_issues" not in codes2


def test_admin_management_overview_endpoint(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    overview_settings: Settings,
) -> None:
    path = "/api/admin/management-overview"
    # RBAC check
    assert login_client(reception_user).get(path).status_code == 403
    assert login_client(doctor_a_user).get(path).status_code == 403

    res = login_client(admin_user).get(path)
    assert res.status_code == 200
    data = res.json()

    # Every figure comes from records: nothing invented, no expense or utilisation figures.
    for invented in ("operating_expenses", "net_surplus", "doctor_utilization", "system_health"):
        assert invented not in data
    assert data["current_month_label"] and data["previous_month_label"]
    assert len(data["collection_trend"]) == 6
    assert len(data["patient_trend"]) == 6
    assert data["collection_trend"][-1]["collected_paise"] == data["collections_paise"]["current"]
    assert data["collection_trend"][-2]["collected_paise"] == data["collections_paise"]["previous"]
    assert data["patient_trend"][-1]["new_patients"] == data["new_patients"]["current"]
    if data["collections_paise"]["previous"] == 0:
        assert data["collections_paise"]["change_pct"] is None
    total = sum(d["collected_paise"] for d in data["department_collections"])
    assert total == data["collections_paise"]["current"]


def test_management_overview_counts_real_collections_and_reversals(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    db_session: Session,
    overview_settings: Settings,
) -> None:
    """Collections, reversals and new patients move by exactly what was recorded."""
    path = "/api/admin/management-overview"
    admin_c = login_client(admin_user)
    before = admin_c.get(path).json()

    patient = _patient(db_session, "mo")
    rec_c = login_client(reception_user)
    paid = []
    for amount in (35000, 15000):
        res = rec_c.post(
            "/api/payments",
            json={"patient_id": patient.id, "amount_paise": amount, "payment_method": "CASH"},
        )
        assert res.status_code == 201, res.text
        paid.append(res.json()["id"])
    rev = admin_c.post(
        f"/api/payments/{paid[1]}/reverse", json={"reversal_reason": "Entered twice"}
    )
    assert rev.status_code == 200, rev.text

    after = admin_c.get(path).json()
    assert after["collections_paise"]["current"] - before["collections_paise"]["current"] == 35000
    assert after["reversed_this_month"] - before["reversed_this_month"] == 1
    assert after["reversed_this_month_paise"] - before["reversed_this_month_paise"] == 15000
    assert after["new_patients"]["current"] - before["new_patients"]["current"] == 1
    unlinked = {d["name"]: d["collected_paise"] for d in after["department_collections"]}
    assert unlinked.get("Not linked to a department", 0) >= 35000


def test_admin_overview_warns_when_scheduled_backups_are_disabled(
    login_client: Any,
    admin_user: User,
    overview_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A switched-off backup schedule is surfaced instead of failing silently."""
    monkeypatch.setattr(areas, "schedule_is_enabled", lambda _session: False)
    admin_c = login_client(admin_user)

    res = admin_c.get(OVERVIEW)
    assert res.status_code == 200
    alerts = res.json()["alerts"]
    codes = [a["code"] for a in alerts]
    assert "backup_schedule_disabled" in codes
    alert = next(a for a in alerts if a["code"] == "backup_schedule_disabled")
    assert alert["severity"] == "warning"
    assert "Scheduled backups are turned off" in alert["message"]


def test_admin_overview_has_no_disabled_alert_when_schedule_is_enabled(
    login_client: Any,
    admin_user: User,
    overview_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(areas, "schedule_is_enabled", lambda _session: True)
    admin_c = login_client(admin_user)

    res = admin_c.get(OVERVIEW)
    assert res.status_code == 200
    codes = [a["code"] for a in res.json()["alerts"]]
    assert "backup_schedule_disabled" not in codes
