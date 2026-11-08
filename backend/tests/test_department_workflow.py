"""Regression coverage for the all-specialties department workflow."""

import threading
from datetime import date
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy import Engine, delete, text
from sqlalchemy.orm import Session

from kalyan_api.core.permissions import ROLE_PERMISSIONS, Permission, Role
from kalyan_api.main import create_app
from kalyan_api.models import Appointment, Department, Doctor, User
from kalyan_api.routers.appointments import lock_department_for_booking
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


def test_booking_waits_for_an_in_flight_department_deactivation(app_engine: Engine) -> None:
    """A booking must not read a department as active while its deactivation is uncommitted."""
    with Session(app_engine) as setup:
        department = Department(name_en=f"Race Dept {threading.get_ident()}")
        setup.add(department)
        setup.commit()
        department_id = department.id

    deactivating = app_engine.connect()
    deactivation = deactivating.begin()
    try:
        deactivating.execute(
            text("UPDATE departments SET is_active = false WHERE id = :id"),
            {"id": department_id},
        )
        seen: dict[str, bool] = {}

        def book() -> None:
            with Session(app_engine) as booking:
                row = lock_department_for_booking(booking, department_id)
                assert row is not None
                seen["active"] = row.is_active
                booking.commit()

        worker = threading.Thread(target=book)
        worker.start()
        worker.join(timeout=1.0)
        assert worker.is_alive(), "booking read the department without waiting for the deactivation"

        deactivation.commit()
        worker.join(timeout=10)
        assert not worker.is_alive()
        assert seen["active"] is False
    finally:
        if deactivation.is_active:
            deactivation.rollback()
        deactivating.close()
        with Session(app_engine) as cleanup:
            cleanup.execute(delete(Department).where(Department.id == department_id))
            cleanup.commit()


def test_doctor_must_keep_at_least_one_department(
    login_client: Any, admin_user: User, db_session: Session
) -> None:
    """Clearing every specialty would leave the doctor unbookable, so the save is refused."""
    doctor, first, _second = _membership_fixture(db_session)
    doctor.departments = [first]
    db_session.flush()
    admin = login_client(admin_user)

    cleared = admin.put(
        f"/api/doctors/{doctor.id}/departments",
        json={"department_ids": [], "version_id": doctor.version_id},
    )
    assert cleared.status_code == 422, cleared.text

    db_session.refresh(doctor)
    assert [d.id for d in doctor.departments] == [first.id]
