"""IST business-date tests for URN years and receipt cycles (PAT-01, BIL-04).

Guarantees:
- URN year is the IST calendar year: 2026-12-31T19:00:00Z (= 00:30 IST, 1 Jan 2027)
  allocates KH-2027-XXXX, not KH-2026-XXXX.
- CALENDAR_YEAR receipt cycle at the same instant is 2027.
- FINANCIAL_YEAR receipt cycle at 2027-03-31T19:00:00Z (= 00:30 IST, 1 Apr 2027) is 2027-2028.
- The UTC date is never used to pick a business period.

The clock seam is frozen the same way as the shared ``clock`` fixture in conftest.py
(monkeypatching ``kalyan_api.clock.utcnow``); ``kalyan_api.clock.ist_now`` is frozen to the
same instant so IST helpers see a consistent time.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.models import Patient, User
from kalyan_api.services.receipt_service import (
    allocate_next_receipt_number,
    current_cycle_key,
)
from kalyan_api.services.urn_service import allocate_next_urn

NEW_YEAR_EVE_UTC = datetime(2026, 12, 31, 19, 0, tzinfo=UTC)  # 00:30 IST, 1 Jan 2027
FY_EVE_UTC = datetime(2027, 3, 31, 19, 0, tzinfo=UTC)  # 00:30 IST, 1 Apr 2027

FreezeClock = Callable[[datetime], None]


@pytest.fixture
def freeze_clock(monkeypatch: pytest.MonkeyPatch) -> FreezeClock:
    """Freeze both the UTC seam and the IST helper to one instant."""

    def _freeze(instant_utc: datetime) -> None:
        monkeypatch.setattr("kalyan_api.clock.utcnow", lambda: instant_utc)
        monkeypatch.setattr("kalyan_api.clock.ist_now", lambda: instant_utc.astimezone(clock.IST))

    return _freeze


def _set_receipt_cycle(session: Session, cycle: str) -> None:
    session.execute(
        text("UPDATE clinic_settings SET receipt_sequence_cycle = :c WHERE id = 1"),
        {"c": cycle},
    )
    session.flush()


def test_frozen_instant_is_next_day_in_ist(freeze_clock: FreezeClock) -> None:
    """Sanity check: the UTC date and IST date differ at the frozen instant."""
    freeze_clock(NEW_YEAR_EVE_UTC)
    assert clock.utcnow().date().isoformat() == "2026-12-31"
    assert clock.ist_today().isoformat() == "2027-01-01"


def test_urn_year_uses_ist_date(freeze_clock: FreezeClock, db_session: Session) -> None:
    """00:30 IST on 1 Jan 2027 allocates a KH-2027 URN."""
    freeze_clock(NEW_YEAR_EVE_UTC)
    urn = allocate_next_urn(db_session)
    assert urn.startswith("KH-2027-")
    assert len(urn.split("-")[2]) == 4


def test_calendar_year_receipt_cycle_uses_ist_date(
    freeze_clock: FreezeClock, db_session: Session
) -> None:
    """00:30 IST on 1 Jan 2027 allocates a receipt in calendar cycle 2027."""
    freeze_clock(NEW_YEAR_EVE_UTC)
    assert current_cycle_key("CALENDAR_YEAR") == "2027"
    receipt = allocate_next_receipt_number(db_session, cycle="CALENDAR_YEAR")
    assert receipt.startswith("RCP-2027-")
    assert receipt.count("-") == 2


def test_financial_year_receipt_cycle_uses_ist_date(
    freeze_clock: FreezeClock, db_session: Session
) -> None:
    """00:30 IST on 1 Apr 2027 allocates a receipt in financial year cycle 2027-2028."""
    freeze_clock(FY_EVE_UTC)
    assert clock.utcnow().date().isoformat() == "2027-03-31"
    assert current_cycle_key("FINANCIAL_YEAR") == "2027-2028"
    receipt = allocate_next_receipt_number(db_session, cycle="FINANCIAL_YEAR")
    assert receipt.startswith("RCP-2027-2028-")


def test_patient_registration_api_uses_ist_year(
    freeze_clock: FreezeClock,
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """POST /api/patients at 00:30 IST on 1 Jan 2027 issues a KH-2027 URN end to end."""
    # Freeze before login so session idle/absolute timeouts are measured on the frozen clock.
    freeze_clock(NEW_YEAR_EVE_UTC)
    rec_c = login_client(reception_user)
    resp = rec_c.post(
        "/api/patients",
        json={
            "full_name": "Nav Varsh Kumar",
            "guardian_name": "Ram Kumar (S/o)",
            "gender": "M",
            "age_years": 30,
            "mobile": "9876500001",
            "address": "Station Road",
            "district": "Bhojpur",
            "state": "Bihar",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["urn"].startswith("KH-2027-")


def test_payment_api_receipt_uses_ist_calendar_year(
    freeze_clock: FreezeClock,
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """POST /api/payments at 00:30 IST on 1 Jan 2027 with CALENDAR_YEAR issues RCP-2027-XXXX."""
    _set_receipt_cycle(db_session, "CALENDAR_YEAR")
    patient = Patient(
        urn="KH-2026-ISTPAY1",
        full_name="IST Boundary Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=50,
        mobile="9876500002",
        address="Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()

    freeze_clock(NEW_YEAR_EVE_UTC)
    rec_c = login_client(reception_user)
    resp = rec_c.post(
        "/api/payments",
        json={"patient_id": patient.id, "amount_paise": 30000, "payment_method": "CASH"},
    )
    assert resp.status_code == 201, resp.text
    receipt_number = resp.json()["receipt_number"]
    assert receipt_number.startswith("RCP-2027-")
    assert receipt_number.count("-") == 2
