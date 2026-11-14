"""Unit test for UAT Staging Seeder (Gate 3)."""

from scripts.seed_uat_staging import seed_uat_data
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import Department, Doctor, Patient, User


def test_seed_uat_staging_execution(test_settings: Settings, migrated_db: dict[str, int]) -> None:
    """Verify that seed_uat_staging runs idempotently and populates all UAT entities."""
    db_url = test_settings.owner_url.render_as_string(hide_password=False)

    # First run: seed data
    seed_uat_data(db_url, clean=False)

    engine = create_engine(db_url)

    with Session(engine) as session:
        # 1. Users
        users = session.scalars(select(User).where(User.username.like("uat_%"))).all()
        usernames = {u.username for u in users}
        assert "uat_admin" in usernames
        assert "uat_reception" in usernames
        assert "uat_dr_anil" in usernames
        assert "uat_dr_bharati" in usernames

        # 2. Departments
        depts = session.scalars(select(Department)).all()
        dept_names = {d.name_en for d in depts}
        expected_depts = {
            "General Medicine",
            "Ophthalmology",
            "Physiotherapy & Rehabilitation",
            "Dental Surgery",
            "Orthopedics",
        }
        assert expected_depts.issubset(dept_names)

        # 3. Doctor Assignments
        doctors = session.scalars(select(Doctor)).all()
        assert len(doctors) >= 2

        # 4. Patients
        patients = session.scalars(select(Patient).where(Patient.full_name.like("UAT %"))).all()
        assert len(patients) == 4
        assert any(p.phone == "9876543210" for p in patients)

    # Second run (Idempotency check): should succeed without UniqueConstraint violations
    seed_uat_data(db_url, clean=False)
