"""Seed development database with doctors, users, patients, and sample appointments for browser
verification."""

from datetime import UTC, datetime

from kalyan_api.clock import ist_now, ist_today
from kalyan_api.config import get_settings
from kalyan_api.core.security import build_hasher, hash_password
from kalyan_api.db.session import SessionLocal, build_engine
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    ClinicalTemplate,
    ClinicalTemplateResponse,
    Department,
    Doctor,
    Patient,
    User,
    VitalObservation,
)
from kalyan_api.routers.templates import ensure_specialty_templates_seeded


def seed_all():
    settings = get_settings()
    engine = build_engine(settings, owner=False)
    SessionLocal.configure(bind=engine)
    session = SessionLocal()
    hasher = build_hasher(settings)
    default_pw_hash = hash_password(hasher, "Password123!")

    print("Checking / seeding departments and templates...")
    ensure_specialty_templates_seeded(session)
    session.commit()

    physio_dept = session.query(Department).filter_by(code="PHYSIOTHERAPY").first()

    # 1. Doctors
    print("Checking / seeding doctors...")
    doc_anil = session.query(Doctor).filter_by(name_en="Dr. Anil Kumar").first()
    if not doc_anil:
        doc_anil = Doctor(
            name_en="Dr. Anil Kumar",
            name_hi="डॉ. अनिल कुमार",
            qualification="BPT, MPT (Musculoskeletal)",
            registration_number="PT-84729",
            default_fee_paise=50000,
            is_active=True,
        )
        session.add(doc_anil)
        session.flush()

    doc_bharati = session.query(Doctor).filter_by(name_en="Dr. Bharati Sharma").first()
    if not doc_bharati:
        doc_bharati = Doctor(
            name_en="Dr. Bharati Sharma",
            name_hi="डॉ. भारती शर्मा",
            qualification="MBBS, MS (Ophthalmology)",
            registration_number="OP-19283",
            default_fee_paise=60000,
            is_active=True,
        )
        session.add(doc_bharati)
        session.flush()

    # 2. Users
    print("Checking / seeding users...")
    admin_user = session.query(User).filter_by(username="admin").first()
    if not admin_user:
        admin_user = User(
            username="admin",
            full_name="System Administrator",
            role="ADMIN",
            password_hash=default_pw_hash,
            must_change_password=False,
            is_active=True,
        )
        session.add(admin_user)
        session.flush()

    from kalyan_api.models import SystemSetup

    system_setup = session.query(SystemSetup).filter_by(id=1).first()
    if not system_setup:
        system_setup = SystemSetup(
            id=1,
            completed_at=datetime.now(UTC),
            admin_user_id=admin_user.id,
        )
        session.add(system_setup)
        session.flush()

    dr_anil_user = session.query(User).filter_by(username="dr.anil").first()
    if not dr_anil_user:
        dr_anil_user = User(
            username="dr.anil",
            full_name="Dr. Anil Kumar",
            role="DOCTOR",
            doctor_id=doc_anil.id,
            password_hash=default_pw_hash,
            must_change_password=False,
            is_active=True,
        )
        session.add(dr_anil_user)
        session.flush()

    dr_bharati_user = session.query(User).filter_by(username="dr.bharati").first()
    if not dr_bharati_user:
        dr_bharati_user = User(
            username="dr.bharati",
            full_name="Dr. Bharati Sharma",
            role="DOCTOR",
            doctor_id=doc_bharati.id,
            password_hash=default_pw_hash,
            must_change_password=False,
            is_active=True,
        )
        session.add(dr_bharati_user)
        session.flush()

    reception_user = session.query(User).filter_by(username="reception").first()
    if not reception_user:
        reception_user = User(
            username="reception",
            full_name="Front Desk Reception",
            role="RECEPTION",
            password_hash=default_pw_hash,
            must_change_password=False,
            is_active=True,
        )
        session.add(reception_user)
        session.flush()

    session.commit()

    # 3. Patients
    print("Checking / seeding patients...")
    p1 = session.query(Patient).filter_by(urn="KH-2026-0001").first()
    if not p1:
        p1 = Patient(
            urn="KH-2026-0001",
            full_name="Ramesh Kumar",
            guardian_name="Suresh Kumar",
            gender="M",
            age_years=45,
            mobile="9876543210",
            address="Buxar, Bihar",
        )
        session.add(p1)
        session.flush()

    p2 = session.query(Patient).filter_by(urn="KH-2026-0002").first()
    if not p2:
        p2 = Patient(
            urn="KH-2026-0002",
            full_name="Sunita Devi",
            guardian_name="Rajesh Singh",
            gender="F",
            age_years=52,
            mobile="9876543211",
            address="Ara, Bihar",
        )
        session.add(p2)
        session.flush()

    p3 = session.query(Patient).filter_by(urn="KH-2026-0003").first()
    if not p3:
        p3 = Patient(
            urn="KH-2026-0003",
            full_name="Manoj Verma",
            guardian_name="Ashok Verma",
            gender="M",
            age_years=28,
            mobile="9876543212",
            address="Patna, Bihar",
        )
        session.add(p3)
        session.flush()

    session.commit()

    today = ist_today()
    now_ts = ist_now()

    # 4. Appointments
    print("Checking / seeding appointments for today:", today)
    # Appt 1: Ramesh Kumar with Dr. Anil (ARRIVED, waiting in queue)
    a1 = (
        session.query(Appointment)
        .filter_by(doctor_id=doc_anil.id, appointment_date=today, token_number=1)
        .first()
    )
    if not a1:
        a1 = Appointment(
            patient_id=p1.id,
            doctor_id=doc_anil.id,
            appointment_date=today,
            token_number=1,
            status=AppointmentStatus.ARRIVED.value,
            check_in_at=now_ts,
            created_by_user_id=reception_user.id,
        )
        session.add(a1)
        session.flush()

    # Appt 2: Sunita Devi with Dr. Anil (IN_CONSULTATION, active draft)
    a2 = (
        session.query(Appointment)
        .filter_by(doctor_id=doc_anil.id, appointment_date=today, token_number=2)
        .first()
    )
    if not a2:
        a2 = Appointment(
            patient_id=p2.id,
            doctor_id=doc_anil.id,
            appointment_date=today,
            token_number=2,
            status=AppointmentStatus.IN_CONSULTATION.value,
            check_in_at=now_ts,
            created_by_user_id=reception_user.id,
        )
        session.add(a2)
        session.flush()

        # Add active draft encounter for Sunita Devi
        enc = ClinicalEncounter(
            patient_id=p2.id,
            doctor_id=doc_anil.id,
            appointment_id=a2.id,
            department_id=physio_dept.id if physio_dept else None,
            symptoms=(
                "Persistent lower back pain radiating to left calf for 2 weeks. Aggravated by "
                "prolonged sitting."
            ),
            clinical_notes=(
                "SLR positive at 45 degrees left leg. Tenderness over L4-L5 interspinous "
                "ligament.\nAdvised cold pack application and lumbar traction."
            ),
            diagnosis="L4-L5 Lumbar Disc Bulge with Radiculopathy",
            is_finalised=False,
            created_by_user_id=dr_anil_user.id,
        )
        session.add(enc)
        session.flush()

        # Add vitals
        vitals = VitalObservation(
            encounter_id=enc.id,
            patient_id=p2.id,
            height_cm=162.0,
            weight_kg=68.0,
            bmi=25.9,
            systolic_bp=130,
            diastolic_bp=84,
            pulse_bpm=76,
            temperature_f=98.4,
            respiratory_rate=16,
            spo2_percent=98,
        )
        session.add(vitals)
        session.flush()

        # Add physio template response
        physio_tmpl = session.query(ClinicalTemplate).filter_by(code="PHYSIOTHERAPY").first()
        if physio_tmpl and physio_tmpl.versions:
            v_id = physio_tmpl.versions[0].id
            tmpl_resp = ClinicalTemplateResponse(
                encounter_id=enc.id,
                template_version_id=v_id,
                response_data={
                    "pain_score": 7,
                    "affected_body_part": "Lumbar spine and left lower limb",
                    "rom_assessment": "Flexion limited to 40 deg, Extension normal",
                    "functional_limitations": "Difficulty walking > 10 minutes",
                },
            )
            session.add(tmpl_resp)
            session.flush()

    # Appt 3: Manoj Verma with Dr. Bharati (ARRIVED, waiting in eye queue)
    a3 = (
        session.query(Appointment)
        .filter_by(doctor_id=doc_bharati.id, appointment_date=today, token_number=1)
        .first()
    )
    if not a3:
        a3 = Appointment(
            patient_id=p3.id,
            doctor_id=doc_bharati.id,
            appointment_date=today,
            token_number=1,
            status=AppointmentStatus.ARRIVED.value,
            check_in_at=now_ts,
            created_by_user_id=reception_user.id,
        )
        session.add(a3)
        session.flush()

    session.commit()
    print("Seed complete successfully!")
    print("Doctor accounts: dr.anil / Password123!, dr.bharati / Password123!")
    print("Reception account: reception / Password123!")
    print("Admin account: admin / Password123!")


if __name__ == "__main__":
    seed_all()
