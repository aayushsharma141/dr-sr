"""Only admins may list inactive doctors (SET-02)."""

from typing import Any

from sqlalchemy.orm import Session

from kalyan_api.models import Doctor, User

RETIRED_NAME = "Dr Retired Listing"


def test_only_admin_sees_inactive_doctors(
    login_client: Any, admin_user: User, reception_user: User, db_session: Session
) -> None:
    """Reception asking for include_inactive=true still gets active doctors only."""
    db_session.add(Doctor(name_en=RETIRED_NAME, is_active=False))
    db_session.flush()

    reception = login_client(reception_user).get("/api/doctors?include_inactive=true")
    assert reception.status_code == 200, reception.text
    assert RETIRED_NAME not in [d["name_en"] for d in reception.json()]

    admin = login_client(admin_user).get("/api/doctors?include_inactive=true")
    assert admin.status_code == 200, admin.text
    assert RETIRED_NAME in [d["name_en"] for d in admin.json()]
