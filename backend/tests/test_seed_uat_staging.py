"""Unit test for UAT Staging Seeder (Gate 3)."""

from scripts.seed_uat_staging import seed_uat_data
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import Department, Doctor, Patient, User


def test_seed_uat_staging_execution(test_settings: Settings, migrated_db: dict[str, int]) -> None:
    """Verify that seed_uat_staging runs idempotently and populates all UAT entities."""
    db_url = test_settings.owner_url.render_as_string(hide_password=False)

    # First run: seed data
    seed_uat_data(db_url, clean=False)

    from sqlalchemy import create_engine

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
        assert "General Medicine" in dept_names
        assert "Ophthalmology" in dept_names
        assert "Physiotherapy" in dept_names

        # 3. Doctors and associations
        dr_anil = session.scalar(select(Doctor).where(Doctor.name_en == "Dr. Anil Sharma"))
        assert dr_anil is not None
        assert any(d.name_en == "General Medicine" for d in dr_anil.departments)

        dr_bharati = session.scalar(select(Doctor).where(Doctor.name_en == "Dr. Bharati Sharma"))
        assert dr_bharati is not None
        assert len(dr_bharati.departments) >= 2

        # 4. Patients
        test_patients = session.scalars(select(Patient).where(Patient.urn.like("TEST-%"))).all()
        assert len(test_patients) == 4

    # Second run: clean and reseed (verify idempotency)
    seed_uat_data(db_url, clean=True)

    with Session(engine) as session:
        test_patients = session.scalars(select(Patient).where(Patient.urn.like("TEST-%"))).all()
        assert len(test_patients) == 4
