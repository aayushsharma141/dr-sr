"""Scheduled backups: slot logic, one run per slot, retention safety, API and audit."""

from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, BackupRun, BackupSettings, User
from kalyan_api.routers import operations
from kalyan_api.services import backup_schedule_service as schedule
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.backup_service import BackupCorruptedError

SETTINGS_URL = "/api/operations/backup-settings"
REASON = "Client approved the nightly schedule"
# 2026-11-04 is a Wednesday. 21:00 UTC is 02:30 IST on Thursday 5 November.
NOW = datetime(2026, 11, 4, 21, 0, tzinfo=UTC)
LONG_AGO = NOW - timedelta(days=30)


def _config(**values: Any) -> BackupSettings:
    defaults: dict[str, Any] = {
        "schedule_enabled": True,
        "frequency": "DAILY",
        "run_at": time(2, 0),
        "weekly_day": None,
        "updated_at": LONG_AGO,
    }
    return BackupSettings(**{**defaults, **values})


def test_daily_slot_is_todays_time_once_it_has_passed() -> None:
    slot = schedule.latest_slot(_config(), NOW)
    assert slot == datetime(2026, 11, 5, 2, 0, tzinfo=clock.IST)
    assert schedule.next_slot(_config(), NOW) == datetime(2026, 11, 6, 2, 0, tzinfo=clock.IST)


def test_daily_slot_is_yesterday_before_the_time_arrives() -> None:
    slot = schedule.latest_slot(_config(run_at=time(3, 0)), NOW)
    assert slot == datetime(2026, 11, 4, 3, 0, tzinfo=clock.IST)


def test_weekly_slot_lands_on_the_chosen_weekday() -> None:
    monday = schedule.latest_slot(_config(frequency="WEEKLY", weekly_day=0), NOW)
    assert monday == datetime(2026, 11, 2, 2, 0, tzinfo=clock.IST)
    thursday = schedule.latest_slot(_config(frequency="WEEKLY", weekly_day=3), NOW)
    assert thursday == datetime(2026, 11, 5, 2, 0, tzinfo=clock.IST)
    later_today = schedule.latest_slot(
        _config(frequency="WEEKLY", weekly_day=3, run_at=time(3, 0)), NOW
    )
    assert later_today == datetime(2026, 10, 29, 3, 0, tzinfo=clock.IST)


def test_disabled_schedule_is_never_due() -> None:
    assert schedule.is_due(_config(schedule_enabled=False), None, NOW) is False


def test_slot_before_saving_settings_does_not_fire() -> None:
    assert schedule.is_due(_config(updated_at=NOW - timedelta(minutes=5)), None, NOW) is False


def test_slot_runs_once() -> None:
    config = _config()
    assert schedule.is_due(config, None, NOW) is True
    assert schedule.is_due(config, NOW - timedelta(days=1), NOW) is True
    assert schedule.is_due(config, NOW - timedelta(minutes=20), NOW) is False


def test_prune_only_touches_scheduled_archives(tmp_path: Path) -> None:
    names = [
        "kalyan_backup_20261101_000000_scheduled.tar.gz",
        "kalyan_backup_20261102_000000_scheduled.tar.gz",
        "kalyan_backup_20261103_000000_scheduled.tar.gz",
        "kalyan_backup_20261001_000000_manual.tar.gz",
        "kalyan_backup_20261001_000000_prerestore.tar.gz",
        "kalyan_backup_20261001_000000.tar.gz",
    ]
    for name in names:
        (tmp_path / name).write_bytes(b"x")

    removed = schedule.prune_scheduled(tmp_path, 2)

    assert removed == ["kalyan_backup_20261101_000000_scheduled.tar.gz"]
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(names[1:])


def test_copy_verified_refuses_a_mismatched_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "kalyan_backup_x.tar.gz"
    source.write_bytes(b"archive")
    target = tmp_path / "second"
    target.mkdir()

    digests = iter(["copy-digest", "source-digest"])
    monkeypatch.setattr(schedule, "compute_sha256", lambda _path: next(digests))
    with pytest.raises(BackupCorruptedError):
        schedule.copy_verified(source, target)
    assert list(target.iterdir()) == []


def test_copy_verified_writes_identical_file(tmp_path: Path) -> None:
    source = tmp_path / "kalyan_backup_x.tar.gz"
    source.write_bytes(b"archive")
    target = tmp_path / "second"
    target.mkdir()

    copied = schedule.copy_verified(source, target)

    assert copied.read_bytes() == b"archive"
    assert list(target.iterdir()) == [copied]


@pytest.fixture
def scheduler_settings(test_settings: Settings, tmp_path: Path) -> Settings:
    backup_dir = tmp_path / "backups"
    second = tmp_path / "second"
    backup_dir.mkdir()
    second.mkdir()
    return test_settings.model_copy(
        update={"backup_dir": backup_dir, "backup_destinations": [second]}
    )


@pytest.fixture
def scope(db_session: Session) -> Callable[[Settings], Any]:
    """Run the scheduler's short transactions inside the test's rolled-back transaction."""

    @contextmanager
    def _scope(_settings: Settings) -> Iterator[Session]:
        with db_session.begin_nested():
            yield db_session

    return _scope


@pytest.fixture
def enabled(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> BackupSettings:
    monkeypatch.setattr("kalyan_api.clock.utcnow", lambda: NOW)
    config = db_session.get(BackupSettings, 1)
    assert config is not None
    config.schedule_enabled = True
    config.run_at = time(2, 0)
    db_session.flush()
    db_session.execute(
        text("UPDATE backup_settings SET updated_at = :at WHERE id = 1"), {"at": LONG_AGO}
    )
    db_session.refresh(config)
    return config


@pytest.fixture
def fake_archive(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    counter = iter(range(1, 100))

    def _create(label: str, settings: Settings) -> Path:
        path = settings.backup_dir / f"kalyan_backup_2026110{next(counter)}_000000_{label}.tar.gz"
        path.write_bytes(b"archive")
        return path

    monkeypatch.setattr(schedule, "create_backup", _create)
    monkeypatch.setattr(schedule, "verify_backup_bundle", lambda _p: (True, "ok", {}))
    yield


def _actions(db_session: Session, action: AuditAction) -> list[AuditLog]:
    return list(db_session.scalars(select(AuditLog).where(AuditLog.action == action.value)))


def test_disabled_schedule_creates_nothing(
    db_session: Session,
    scheduler_settings: Settings,
    scope: Any,
    fake_archive: None,
) -> None:
    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "skipped"
    assert db_session.scalars(select(BackupRun)).first() is None
    assert list(scheduler_settings.backup_dir.iterdir()) == []


def test_due_run_records_success_once(
    db_session: Session,
    scheduler_settings: Settings,
    scope: Any,
    enabled: BackupSettings,
    fake_archive: None,
) -> None:
    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "success"
    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "skipped"

    run = db_session.scalars(select(BackupRun)).one()
    assert (run.trigger, run.outcome) == ("SCHEDULED", "SUCCESS")
    assert run.filename is not None and run.filename.endswith("_scheduled.tar.gz")
    assert len(_actions(db_session, AuditAction.BACKUP_CREATED)) == 1


def test_second_copy_and_retention_are_applied(
    db_session: Session,
    scheduler_settings: Settings,
    scope: Any,
    enabled: BackupSettings,
    fake_archive: None,
) -> None:
    second = scheduler_settings.backup_destinations[0]
    enabled.destination_dir = str(second)
    enabled.retention_count = 1
    db_session.flush()
    db_session.execute(
        text("UPDATE backup_settings SET updated_at = :at WHERE id = 1"), {"at": LONG_AGO}
    )
    db_session.refresh(enabled)
    old = "kalyan_backup_20200101_000000_scheduled.tar.gz"
    (scheduler_settings.backup_dir / old).write_bytes(b"old")
    (second / old).write_bytes(b"old")

    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "success"

    assert not (scheduler_settings.backup_dir / old).exists()
    assert not (second / old).exists()
    assert len(list(second.iterdir())) == 1
    run = db_session.scalars(select(BackupRun)).one()
    assert run.pruned_count == 2
    assert len(_actions(db_session, AuditAction.BACKUP_PRUNED)) == 1


def test_failure_keeps_old_archives_and_leaks_no_error_text(
    db_session: Session,
    scheduler_settings: Settings,
    scope: Any,
    enabled: BackupSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enabled.retention_count = 1
    db_session.flush()
    db_session.execute(
        text("UPDATE backup_settings SET updated_at = :at WHERE id = 1"), {"at": LONG_AGO}
    )
    db_session.refresh(enabled)
    old = scheduler_settings.backup_dir / "kalyan_backup_20200101_000000_scheduled.tar.gz"
    old.write_bytes(b"old")

    def _boom(**_kwargs: Any) -> Path:
        raise RuntimeError('COPY patients, line 7: "Sita Devi 9876543210"')

    monkeypatch.setattr(schedule, "create_backup", _boom)

    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "failure"
    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "skipped"

    assert old.exists()
    run = db_session.scalars(select(BackupRun)).one()
    assert (run.outcome, run.error_type) == ("FAILURE", "RuntimeError")
    row = _actions(db_session, AuditAction.BACKUP_FAILED)[0]
    assert row.after_data == {"trigger": "SCHEDULED", "error": "RuntimeError"}


def test_running_row_blocks_a_second_start_until_stale(
    db_session: Session,
    scheduler_settings: Settings,
    scope: Any,
    enabled: BackupSettings,
    fake_archive: None,
) -> None:
    running = BackupRun(
        trigger="SCHEDULED", outcome="RUNNING", started_at=NOW - timedelta(minutes=30)
    )
    db_session.add(running)
    db_session.flush()
    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "skipped"

    running.started_at = NOW - timedelta(days=1, hours=1)
    db_session.flush()
    assert schedule.run_scheduled_backup(scheduler_settings, scope) == "success"
    db_session.refresh(running)
    assert (running.outcome, running.error_type) == ("FAILURE", "Interrupted")


def test_missed_slot_is_reported_overdue(
    db_session: Session, enabled: BackupSettings
) -> None:
    assert schedule.is_overdue(db_session, schedule.latest_slot(enabled, NOW) + timedelta(hours=2))
    assert not schedule.is_overdue(
        db_session, schedule.latest_slot(enabled, NOW) + timedelta(minutes=30)
    )


def _update(client: TestClient, **changes: Any) -> dict[str, Any]:
    current = client.get(SETTINGS_URL).json()
    body = {
        "version_id": current["version_id"],
        "schedule_enabled": True,
        "frequency": "DAILY",
        "run_at": "02:00:00",
        "weekly_day": None,
        "destination_dir": None,
        "retention_count": None,
        "reason": REASON,
    }
    body.update(changes)
    return body


@pytest.fixture
def api_settings(
    monkeypatch: pytest.MonkeyPatch, scheduler_settings: Settings
) -> Settings:
    monkeypatch.setattr(operations, "get_settings", lambda: scheduler_settings)
    return scheduler_settings


def test_defaults_are_off_with_no_retention(
    login_client: Callable[..., TestClient], admin_user: User, api_settings: Settings
) -> None:
    body = login_client(admin_user).get(SETTINGS_URL).json()
    assert body["schedule_enabled"] is False
    assert body["retention_count"] is None
    assert body["next_run_at"] is None
    assert body["overdue"] is False
    assert body["approved_destinations"] == [str(api_settings.backup_destinations[0])]


def test_update_persists_and_audits(
    login_client: Callable[..., TestClient],
    admin_user: User,
    api_settings: Settings,
    db_session: Session,
) -> None:
    client = login_client(admin_user)
    second = api_settings.backup_destinations[0]
    res = client.patch(
        SETTINGS_URL,
        json=_update(client, destination_dir=str(second), retention_count=14, run_at="03:30"),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["schedule_enabled"] is True
    assert body["run_at"] == "03:30:00"
    assert body["retention_count"] == 14
    assert body["next_run_at"] is not None

    row = _actions(db_session, AuditAction.BACKUP_SETTINGS_UPDATED)[0]
    assert row.reason == REASON
    assert row.before_data["schedule_enabled"] is False
    assert row.after_data["retention_count"] == 14
    assert row.after_data["run_at"] == "03:30:00"


def test_destination_must_be_an_approved_folder(
    login_client: Callable[..., TestClient],
    admin_user: User,
    api_settings: Settings,
    tmp_path: Path,
) -> None:
    client = login_client(admin_user)
    other = tmp_path / "unapproved"
    other.mkdir()
    for bad in (str(other), str(api_settings.backup_dir), "\\\\server\\share"):
        res = client.patch(SETTINGS_URL, json=_update(client, destination_dir=bad))
        assert res.status_code == 422
        assert res.json()["code"] == "invalid_destination_dir"


def test_update_validation_and_stale_version(
    login_client: Callable[..., TestClient], admin_user: User, api_settings: Settings
) -> None:
    client = login_client(admin_user)
    assert client.patch(SETTINGS_URL, json=_update(client, frequency="WEEKLY")).status_code == 422
    assert client.patch(SETTINGS_URL, json=_update(client, retention_count=0)).status_code == 422
    assert client.patch(SETTINGS_URL, json=_update(client, reason="short")).status_code == 422

    stale = _update(client)
    assert client.patch(SETTINGS_URL, json=stale).status_code == 200
    res = client.patch(SETTINGS_URL, json=stale)
    assert res.status_code == 409
    assert res.json()["code"] == "version_conflict"


def test_only_admin_can_configure(
    login_client: Callable[..., TestClient],
    reception_user: User,
    doctor_a_user: User,
    api_settings: Settings,
) -> None:
    body = {
        "version_id": 1,
        "schedule_enabled": True,
        "frequency": "DAILY",
        "run_at": "02:00:00",
        "reason": REASON,
    }
    for user in (reception_user, doctor_a_user):
        assert login_client(user).patch(SETTINGS_URL, json=body).status_code == 403
        assert login_client(user).get(SETTINGS_URL).status_code == 403


def test_manual_backup_appears_in_run_history(
    login_client: Callable[..., TestClient],
    admin_user: User,
    api_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _create(destination_dir: Path, label: str | None, settings: Settings) -> Path:
        path = destination_dir / "kalyan_backup_20261104_000000.tar.gz"
        path.write_bytes(b"archive")
        return path

    monkeypatch.setattr(operations, "create_backup", _create)
    monkeypatch.setattr(operations, "verify_backup_bundle", lambda _p: (True, "ok", {}))
    client = login_client(admin_user)
    assert client.post("/api/operations/backups", json={}).status_code == 201

    runs = client.get("/api/operations/backup-runs").json()
    assert [(r["trigger"], r["outcome"]) for r in runs] == [("MANUAL", "SUCCESS")]
    assert runs[0]["filename"] == "kalyan_backup_20261104_000000.tar.gz"
