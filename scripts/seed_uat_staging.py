#!/usr/bin/env python3
"""UAT Staging Environment Seeder for Kalyan Hospital LAN Platform (Gate 3).

Populates a designated PostgreSQL database with synthetic, non-PHI test data
calibrated for on-site hardware and operational walkthroughs:
- 4 Role-based user accounts (Admin, Reception, Dr. Anil, Dr. Bharati)
- 5 Clinical departments with doctor memberships
- Authoritative clinic settings (Bilingual Hindi/English + Ara, Bihar address)
- Fee catalogue for General Medicine, Ophthalmology, and Physiotherapy
- 4 Synthetic non-PHI test patients (including typography stress-test)
- 1 Pre-booked test appointment with monotonic token sequence

Usage:
    python scripts/seed_uat_staging.py [--database-url <url>] [--clean]
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, date, datetime
from pathlib import Path

# Add backend/src to path
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_SRC = REPO_ROOT / "backend" / "src"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

from kalyan_api.config import get_settings
from kalyan_api.core.permissions import Role
from kalyan_api.core.security import build_hasher, hash_password
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicSettings,
    ConsultationFee,
    DailyTokenSequence,
    Department,
    Doctor,
    Patient,
    SystemSetup,
    User,
)
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session


def seed_uat_data(database_url: str, clean: bool = False) -> None:
    """Seed the target database with complete UAT synthetic dataset."""
    print(f"Connecting to database: {database_url}...")
    engine = create_engine(database_url)
    app_settings = get_settings()
    hasher = build_hasher(app_settings)
    now_utc = datetime.now(UTC)
    today = date.today()

    with Session(engine) as session:
        if clean:
            print("Cleaning existing UAT appointments and test data...")
            session.execute(
                text(
                    "DELETE FROM appointments WHERE notes LIKE '%(TEST)%' OR notes = 'Pre-booked UAT checkup'"
                )
            )
            session.execute(
                text("DELETE FROM daily_token_sequences WHERE appointment_date = :dt"),
                {"dt": today},
            )
            session.commit()

        # 1. Clinic Settings (Bilingual Hindi + English letterhead)
        settings = session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))
        if not settings:
            settings = ClinicSettings(
                id=1,
                name_en="Kalyan Hospital",
                name_hi="कल्याण हॉस्पिटल",
                trust_name_en="Sri Vashishtha Kalyan Trust",
                trust_name_hi="श्री वशिष्ठ कल्याण ट्रस्ट",
                location_line="Ara, Bhojpur, Bihar",
                address_1="Hospital Road, Opposite Nawada Thana",
                address_2="Ara, Bhojpur, Bihar - 802301",
                phone="06182-248100",
                email="contact@kalyanhospital.local",
                receipt_sequence_cycle="FINANCIAL_YEAR",
                print_header_en="SRI VASHISHTHA KALYAN TRUST — KALYAN HOSPITAL",
                print_header_hi="श्री वशिष्ठ कल्याण ट्रस्ट — कल्याण हॉस्पिटल",
                print_footer_en="Get Well Soon • Hospital Road, Ara, Bhojpur, Bihar",
                print_footer_hi="शीघ्र स्वास्थ्य लाभ की कामना • स्टेशन रोड, नवादा, आरा",
                consultation_validity_days=7,
            )
            session.add(settings)
            print("✓ Created authoritative Clinic Settings (Bilingual)")
        else:
            settings.name_en = "Kalyan Hospital"
            settings.name_hi = "कल्याण हॉस्पिटल"
            settings.trust_name_en = "Sri Vashishtha Kalyan Trust"
            settings.trust_name_hi = "श्री वशिष्ठ कल्याण ट्रस्ट"
            settings.receipt_sequence_cycle = "FINANCIAL_YEAR"
            print("✓ Updated Clinic Settings")

        # 2. Departments
        dept_defs = [
            (
                "General Medicine",
                "सामान्य चिकित्सा",
                "Primary adult and adolescent medical consultation",
            ),
            (
                "Ophthalmology",
                "नेत्र रोग",
                "Vision diagnostics, slit-lamp, cataracts and eye care",
            ),
            (
                "Physiotherapy",
                "भौतिक चिकित्सा (फिजियोथेरेपी)",
                "Rehabilitation, musculoskeletal and post-op therapy",
            ),
            ("Orthopedics", "हड्डी रोग", "Bone, joint, spine and trauma management"),
            (
                "Dental",
                "दंत चिकित्सा",
                "Oral health, extraction and restorative procedures",
            ),
        ]
        dept_map: dict[str, Department] = {}
        for name_en, name_hi, desc in dept_defs:
            dept = session.scalar(
                select(Department).where(Department.name_en == name_en)
            )
            if not dept:
                dept = Department(
                    name_en=name_en,
                    name_hi=name_hi,
                    description=desc,
                    is_active=True,
                )
                session.add(dept)
                session.flush()
            dept_map[name_en] = dept
        print(f"✓ Seeded {len(dept_map)} active clinical departments")

        # 3. Doctors
        doc_defs = [
            (
                "Dr. Anil Sharma",
                "डॉ. अनिल शर्मा",
                "MBBS, MD (General Medicine)",
                "BR-MED-1042",
                30000,
                ["General Medicine"],
            ),
            (
                "Dr. Bharati Sharma",
                "डॉ. भारती शर्मा",
                "MBBS, MS (Ophthalmology)",
                "BR-OPH-2089",
                40000,
                ["Ophthalmology", "Physiotherapy"],
            ),
        ]
        doc_map: dict[str, Doctor] = {}
        for name_en, name_hi, qual, reg, fee, depts in doc_defs:
            doc = session.scalar(
                select(Doctor).where(Doctor.registration_number == reg)
            )
            if not doc:
                doc = Doctor(
                    name_en=name_en,
                    name_hi=name_hi,
                    qualification=qual,
                    registration_number=reg,
                    default_fee_paise=fee,
                    is_active=True,
                )
                session.add(doc)
                session.flush()
            # Associate with departments
            for d_name in depts:
                target_dept = dept_map[d_name]
                if target_dept not in doc.departments:
                    doc.departments.append(target_dept)
            session.flush()
            doc_map[name_en] = doc
        print(f"✓ Seeded {len(doc_map)} doctors with department assignments")

        # 4. Consultation Fees
        fee_defs = [
            ("General Medicine Consultation", 30000),
            ("Ophthalmology OPD Consultation", 40000),
            ("Physiotherapy Rehabilitation", 25000),
            ("Emergency Consultation", 50000),
        ]
        for f_name, f_paise in fee_defs:
            fee_obj = session.scalar(
                select(ConsultationFee).where(ConsultationFee.name == f_name)
            )
            if not fee_obj:
                fee_obj = ConsultationFee(
                    name=f_name, fee_paise=f_paise, is_active=True
                )
                session.add(fee_obj)
        print("✓ Seeded standard fee catalogue")

        # 5. Role-based User Accounts
        users_def = [
            (
                "uat_admin",
                "Hospital Administrator (UAT)",
                Role.ADMIN,
                None,
                "KalyanAdmin2026!",
            ),
            (
                "uat_reception",
                "Front Desk Receptionist (UAT)",
                Role.RECEPTION,
                None,
                "KalyanRecep2026!",
            ),
            (
                "uat_dr_anil",
                "Dr. Anil Sharma (UAT)",
                Role.DOCTOR,
                doc_map["Dr. Anil Sharma"].id,
                "KalyanDoctor2026!",
            ),
            (
                "uat_dr_bharati",
                "Dr. Bharati Sharma (UAT)",
                Role.DOCTOR,
                doc_map["Dr. Bharati Sharma"].id,
                "KalyanDoctor2026!",
            ),
        ]
        for uname, fname, role, doc_id, plain_pwd in users_def:
            usr = session.scalar(select(User).where(User.username == uname))
            pwd_hash = hash_password(hasher, plain_pwd)
            if not usr:
                usr = User(
                    username=uname,
                    full_name=fname,
                    role=role.value,
                    doctor_id=doc_id,
                    password_hash=pwd_hash,
                    must_change_password=False,
                    is_active=True,
                )
                session.add(usr)
                session.flush()
            else:
                usr.password_hash = pwd_hash
                usr.must_change_password = False
                usr.is_active = True
                usr.doctor_id = doc_id
        print(f"✓ Seeded {len(users_def)} role accounts (Admin, Reception, Doctors)")

        # 6. Mark System Setup as Completed (Append-only table)
        admin_user = session.scalar(select(User).where(User.username == "uat_admin"))
        setup_record = session.scalar(select(SystemSetup).where(SystemSetup.id == 1))
        if not setup_record:
            setup_record = SystemSetup(
                id=1, completed_at=now_utc, admin_user_id=admin_user.id
            )
            session.add(setup_record)
            print(
                "✓ Marked SystemSetup as completed (Bypasses first-run wizard for UAT)"
            )
        else:
            print("✓ SystemSetup already completed")

        # 7. Synthetic Test Patients (Strictly Non-PHI)
        patients_def = [
            (
                "TEST-2026-0001",
                "Ram Kumar (TEST)",
                "Shri Mohan Kumar",
                "M",
                42,
                "9800000001",
                "Station Road, Ara, Bhojpur, Bihar",
                "Bhojpur",
                "Bihar",
            ),
            (
                "TEST-2026-0002",
                "Smt. Priyadarshini Ananthapadmanabhan (TEST)",
                "Shri K. Ananthapadmanabhan",
                "F",
                38,
                "9800000002",
                "Quarter No. 42-B, New Railway Officers Colony, Near Jagdeo Nagar, Ara, Bhojpur, Bihar - 802301",
                "Bhojpur",
                "Bihar",
            ),
            (
                "TEST-2026-0003",
                "Suresh Prasad (TEST)",
                "Shri Ramashish Prasad",
                "M",
                55,
                "9800000003",
                "Bihia Road, Jagdishpur, Bhojpur, Bihar",
                "Bhojpur",
                "Bihar",
            ),
            (
                "TEST-2026-0004",
                "Anita Devi (TEST)",
                "Shri Rakesh Singh",
                "F",
                29,
                "9800000004",
                "Civil Lines, Behind Collectorate, Ara, Bhojpur, Bihar",
                "Bhojpur",
                "Bihar",
            ),
        ]
        patient_map: dict[str, Patient] = {}
        for urn, name, guardian, gender, age, mobile, addr, dist, state in patients_def:
            p = session.scalar(select(Patient).where(Patient.urn == urn))
            if not p:
                p = Patient(
                    urn=urn,
                    full_name=name,
                    guardian_name=guardian,
                    gender=gender,
                    age_years=age,
                    mobile=mobile,
                    address=addr,
                    district=dist,
                    state=state,
                    is_active=True,
                )
                session.add(p)
                session.flush()
            patient_map[urn] = p
        print(f"✓ Seeded {len(patient_map)} synthetic test patients (Non-PHI)")

        # 8. Seed Pre-booked Appointment for Patient 1
        p1 = patient_map["TEST-2026-0001"]
        dr_anil = doc_map["Dr. Anil Sharma"]
        dept_gen = dept_map["General Medicine"]

        existing_appt = session.scalar(
            select(Appointment).where(
                Appointment.patient_id == p1.id,
                Appointment.doctor_id == dr_anil.id,
                Appointment.appointment_date == today,
            )
        )
        if not existing_appt:
            # Ensure sequence row exists
            seq = session.scalar(
                select(DailyTokenSequence).where(
                    DailyTokenSequence.doctor_id == dr_anil.id,
                    DailyTokenSequence.appointment_date == today,
                )
            )
            if not seq:
                seq = DailyTokenSequence(
                    doctor_id=dr_anil.id, appointment_date=today, last_token=1
                )
                session.add(seq)
                token_num = 1
            else:
                seq.last_token += 1
                token_num = seq.last_token

            appt = Appointment(
                patient_id=p1.id,
                doctor_id=dr_anil.id,
                department_id=dept_gen.id,
                appointment_date=today,
                token_number=token_num,
                status=AppointmentStatus.BOOKED.value,
                notes="Pre-booked UAT checkup (TEST)",
                created_by_user_id=admin_user.id,
            )
            session.add(appt)
            print(
                f"✓ Seeded pre-booked appointment for {p1.full_name}: Token #{token_num} with {dr_anil.name_en}"
            )

        session.commit()

    print("\n" + "=" * 70)
    print(" KALYAN HOSPITAL — GATE 3 UAT STAGING ENVIRONMENT SEED COMPLETE")
    print("=" * 70)
    print("\n[UAT USER ACCOUNTS]")
    print(f"  {'ROLE':<12} {'USERNAME':<16} {'PASSWORD':<20} {'DETAILS'}")
    print(f"  {'-' * 12} {'-' * 16} {'-' * 20} {'-' * 20}")
    print(
        f"  {'ADMIN':<12} {'uat_admin':<16} {'KalyanAdmin2026!':<20} Hospital Administrator"
    )
    print(
        f"  {'RECEPTION':<12} {'uat_reception':<16} {'KalyanRecep2026!':<20} Front Desk Receptionist"
    )
    print(
        f"  {'DOCTOR':<12} {'uat_dr_anil':<16} {'KalyanDoctor2026!':<20} Dr. Anil Sharma (Gen Med)"
    )
    print(
        f"  {'DOCTOR':<12} {'uat_dr_bharati':<16} {'KalyanDoctor2026!':<20} Dr. Bharati Sharma (Ophth/Physio)"
    )

    print("\n[SYNTHETIC TEST PATIENTS (NON-PHI)]")
    print(f"  {'URN':<16} {'NAME':<36} {'MOBILE':<12} {'PURPOSE'}")
    print(f"  {'-' * 16} {'-' * 36} {'-' * 12} {'-' * 18}")
    print(
        f"  {'TEST-2026-0001':<16} {'Ram Kumar (TEST)':<36} {'9800000001':<12} Pre-booked intake check"
    )
    print(
        f"  {'TEST-2026-0002':<16} {'Smt. Priyadarshini Ananthapadmanabhan':<36} {'9800000002':<12} Epson A4 margin stress test"
    )
    print(
        f"  {'TEST-2026-0003':<16} {'Suresh Prasad (TEST)':<36} {'9800000003':<12} Payment & Reversal drill"
    )
    print(
        f"  {'TEST-2026-0004':<16} {'Anita Devi (TEST)':<36} {'9800000004':<12} Walk-in quick check-in test"
    )

    print("\n[PRINTER SPECIFICATION (OD-06)]")
    print("  • Hardware: Standard Epson A4 desktop printer on plain A4 sheet paper")
    print("  • Margins: 12 mm portrait • Scale: 100% (Actual Size, no Fit-to-Page)")
    print("  • Duplicate stamp: Solid bordered DUPLICATE stamp on re-prints")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    app_settings = get_settings()
    default_db_url = app_settings.owner_url.render_as_string(hide_password=False)

    parser = argparse.ArgumentParser(
        description="Seed UAT Staging Environment for Kalyan Hospital"
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("KALYAN_DATABASE_URL", default_db_url),
        help="PostgreSQL connection string (defaults to KALYAN_DATABASE_URL or backend/.env owner_url)",
    )
    parser.add_argument(
        "--clean", action="store_true", help="Clean prior UAT test appointments first"
    )
    args = parser.parse_args()

    seed_uat_data(args.database_url, clean=args.clean)
