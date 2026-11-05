"""Regression coverage for the all-specialties department workflow."""

from datetime import date
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from kalyan_api.core.permissions import ROLE_PERMISSIONS, Permission, Role
from kalyan_api.main import create_app
from kalyan_api.models import Appointment, Department, Doctor, User
from kalyan_api.schemas.appointments import AppointmentCreate


def test_appointment_create_requires_department_id() -> None:
    """Every new appointment must explicitly identify its department."""
    with pytest.raises(ValidationError):
        AppointmentCreate(
            patient_id=1,
            doctor_id=2,
            appointment_date=date(2026, 11, 4),
        )

    payload = AppointmentCreate(
        patient_id=1,
        doctor_id=2,
        department_id=3,
        appointment_date=date(2026, 11, 4),
    )
    assert payload.department_id == 3


def test_department_relationships_are_mapped() -> None:
    """Department and Doctor share the explicit many-to-many membership."""
    assert "departments" in Doctor.__mapper__.relationships
    assert "doctors" in Department.__mapper__.relationships
    assert "department" in Appointment.__mapper__.relationships
    assert Appointment.__table__.c.department_id.foreign_keys


def test_department_routes_are_registered_with_role_permissions() -> None:
    """Reception can read/filter departments; only Admin can manage assignments."""
    from test_route_policies import walk_routes

    routes = {(method, path) for method, path, _ in walk_routes(create_app())}
    assert ("GET", "/api/departments") in routes
    assert ("GET", "/api/departments/{department_id}/doctors") in routes
    assert ("POST", "/api/departments") in routes
    assert ("PUT", "/api/doctors/{doctor_id}/departments") in routes

    assert Permission.DOCTOR_READ in ROLE_PERMISSIONS[Role.RECEPTION]
    assert Permission.DOCTOR_MANAGE in ROLE_PERMISSIONS[Role.ADMIN]
    assert Permission.DOCTOR_MANAGE not in ROLE_PERMISSIONS[Role.RECEPTION]
    assert Permission.DOCTOR_MANAGE not in ROLE_PERMISSIONS[Role.DOCTOR]


def _membership_fixture(db_session: Session) -> tuple[Doctor, Department, Department]:
    doctor = Doctor(name_en="Dr. Membership", is_active=True)
    first = Department(name_en="Membership First")
    second = Department(name_en="Membership Second")
    db_session.add_all([doctor, first, second])
    db_session.flush()
    return doctor, first, second


def test_membership_change_rejects_a_stale_doctor_version(
    login_client: Any, admin_user: User, db_session: Session
) -> None:
    """Two admins on the same version must not silently overwrite each other."""
    doctor, first, second = _membership_fixture(db_session)
    version = doctor.version_id
    url = f"/api/doctors/{doctor.id}/departments"
    admin = login_client(admin_user)

    saved = admin.put(url, json={"department_ids": [first.id], "version_id": version})
    assert saved.status_code == 200, saved.text

    stale = admin.put(url, json={"department_ids": [second.id], "version_id": version})
    assert stale.status_code == 409, stale.text

    db_session.refresh(doctor)
    assert doctor.version_id == version + 1
    assert [d.id for d in doctor.departments] == [first.id]


def test_inactive_membership_can_be_kept_or_removed_but_not_added(
    login_client: Any, admin_user: User, db_session: Session
) -> None:
    """A later-deactivated department must not block saving the doctor's other changes."""
    doctor, first, second = _membership_fixture(db_session)
    closed = Department(name_en="Membership Closed", is_active=False)
    doctor.departments = [first]
    db_session.add(closed)
    db_session.flush()
    url = f"/api/doctors/{doctor.id}/departments"
    admin = login_client(admin_user)

    added = admin.put(
        url, json={"department_ids": [first.id, closed.id], "version_id": doctor.version_id}
    )
    assert added.status_code == 422, added.text

    first.is_active = False
    db_session.flush()

    kept = admin.put(
        url, json={"department_ids": [first.id, second.id], "version_id": doctor.version_id}
    )
    assert kept.status_code == 200, kept.text
    db_session.refresh(doctor)
    assert {d.id for d in doctor.departments} == {first.id, second.id}

    removed = admin.put(url, json={"department_ids": [second.id], "version_id": doctor.version_id})
    assert removed.status_code == 200, removed.text
    db_session.refresh(doctor)
    assert [d.id for d in doctor.departments] == [second.id]
