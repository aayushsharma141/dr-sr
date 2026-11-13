"""Tests for new URN format KH-YY-P-MM-NNNNN and yearly reset (K-65)."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.services.urn_service import allocate_next_urn


def test_urn_format_first_allocation(db_session: Session, owner_engine: Engine, monkeypatch):
    """allocate_next_urn returns KH-26-P-11-00001 for first allocation on 10 Nov 2026."""
    test_year = 2026
    with owner_engine.connect() as conn:
        conn.execute(text("DELETE FROM urn_sequences WHERE year = :y"), {"y": test_year})
        conn.commit()

    monkeypatch.setattr(clock, "ist_today", lambda: date(2026, 11, 10))

    urn1 = allocate_next_urn(db_session, year=test_year)
    assert urn1 == "KH-26-P-11-00001"

    urn2 = allocate_next_urn(db_session, year=test_year)
    assert urn2 == "KH-26-P-11-00002"


def test_urn_format_yearly_restart(db_session: Session, owner_engine: Engine, monkeypatch):
    """Allocation on 31 Dec 2026 IST followed by 1 Jan 2027 IST restarts sequence at 00001."""
    with owner_engine.connect() as conn:
        conn.execute(text("DELETE FROM urn_sequences WHERE year IN (2026, 2027)"))
        conn.commit()

    monkeypatch.setattr(clock, "ist_today", lambda: date(2026, 12, 31))
    urn_2026 = allocate_next_urn(db_session, year=2026)
    assert urn_2026.startswith("KH-26-P-12-")
    assert urn_2026.endswith("-00001")

    monkeypatch.setattr(clock, "ist_today", lambda: date(2027, 1, 1))
    urn_2027 = allocate_next_urn(db_session, year=2027)
    assert urn_2027 == "KH-27-P-01-00001"


def test_urn_format_ist_boundary(db_session: Session, owner_engine: Engine, monkeypatch):
    """Allocation at 00:30 IST on 1 Jan uses new year even when UTC is still 31 Dec."""
    with owner_engine.connect() as conn:
        conn.execute(text("DELETE FROM urn_sequences WHERE year = 2027"))
        conn.commit()

    fixed_ist_time = datetime(2027, 1, 1, 0, 30, tzinfo=ZoneInfo("Asia/Kolkata"))
    monkeypatch.setattr(clock, "ist_now", lambda: fixed_ist_time)

    urn = allocate_next_urn(db_session)
    assert urn == "KH-27-P-01-00001"
