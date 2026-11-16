"""Tests for Phase 23 LAN Workstation Heartbeat & Live Monitoring."""

from datetime import timedelta
import pytest
from sqlalchemy import select

from kalyan_api import clock
from kalyan_api.models import Workstation


def test_workstation_heartbeat_and_upsert(login_client, reception_user, db_session):
    client = login_client(reception_user)

    payload = {
        "hostname": "DESK-RECEPTION-01",
        "terminal_name": "Main Reception Desk",
        "app_version": "1.0.0",
    }

    resp = client.post("/api/system/heartbeat", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["hostname"] == "DESK-RECEPTION-01"
    assert data["terminal_name"] == "Main Reception Desk"
    assert data["last_username"] == reception_user.username
    assert data["status"] == "ONLINE"

    # Second heartbeat updates the existing row rather than duplicating
    payload_update = {
        "hostname": "DESK-RECEPTION-01",
        "terminal_name": "Main Reception Desk - Renamed",
        "app_version": "1.0.1",
    }
    resp2 = client.post("/api/system/heartbeat", json=payload_update)
    assert resp2.status_code == 200, resp2.text

    ws_count = db_session.scalar(
        select(Workstation).where(Workstation.hostname == "DESK-RECEPTION-01")
    )
    assert ws_count is not None
    assert ws_count.terminal_name == "Main Reception Desk - Renamed"
    assert ws_count.app_version == "1.0.1"


def test_workstation_status_calculation(login_client, admin_user, db_session):
    client = login_client(admin_user)
    now = clock.utcnow()

    # 1. Online: seen 10s ago
    ws_online = Workstation(
        hostname="WS-ONLINE",
        ip_address="192.168.1.101",
        terminal_name="Doctor Cabin 1",
        last_seen_at=now - timedelta(seconds=10),
    )
    # 2. Idle: seen 120s ago
    ws_idle = Workstation(
        hostname="WS-IDLE",
        ip_address="192.168.1.102",
        terminal_name="Billing Desk 2",
        last_seen_at=now - timedelta(seconds=120),
    )
    # 3. Offline: seen 600s ago
    ws_offline = Workstation(
        hostname="WS-OFFLINE",
        ip_address="192.168.1.103",
        terminal_name="Back Office Terminal",
        last_seen_at=now - timedelta(seconds=600),
    )
    db_session.add_all([ws_online, ws_idle, ws_offline])
    db_session.commit()

    resp = client.get("/api/admin/workstations")
    assert resp.status_code == 200, resp.text
    items = resp.json()

    item_map = {item["hostname"]: item["status"] for item in items}
    assert item_map.get("WS-ONLINE") == "ONLINE"
    assert item_map.get("WS-IDLE") == "IDLE"
    assert item_map.get("WS-OFFLINE") == "OFFLINE"


def test_workstations_rbac(login_client, reception_user, admin_user):
    reception_client = login_client(reception_user)
    admin_client = login_client(admin_user)

    # Reception cannot read workstation monitor
    assert reception_client.get("/api/admin/workstations").status_code == 403

    # Admin can read workstation monitor
    assert admin_client.get("/api/admin/workstations").status_code == 200
