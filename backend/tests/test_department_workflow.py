"""Regression coverage for the all-specialties department workflow."""

from datetime import date

import pytest
from pydantic import ValidationError

from kalyan_api.core.permissions import Permission, ROLE_PERMISSIONS, Role
from kalyan_api.main import create_app
from kalyan_api.models import Appointment, Department, Doctor
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

    routes = {
        (method, path)
        for method, path, _ in walk_routes(create_app())
    }
    assert ("GET", "/api/departments") in routes
    assert ("GET", "/api/departments/{department_id}/doctors") in routes
    assert ("POST", "/api/departments") in routes
    assert ("PUT", "/api/doctors/{doctor_id}/departments") in routes

    assert Permission.DOCTOR_READ in ROLE_PERMISSIONS[Role.RECEPTION]
    assert Permission.DOCTOR_MANAGE in ROLE_PERMISSIONS[Role.ADMIN]
    assert Permission.DOCTOR_MANAGE not in ROLE_PERMISSIONS[Role.RECEPTION]
    assert Permission.DOCTOR_MANAGE not in ROLE_PERMISSIONS[Role.DOCTOR]
