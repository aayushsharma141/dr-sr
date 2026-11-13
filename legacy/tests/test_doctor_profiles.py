"""
Doctor/department assignment, doctor-filtered patient lists, and registration form guards.
"""

from PySide6.QtGui import QColor, QImage

from app.db.connection import get_db_connection, init_db
from app.services.doctor_service import DoctorService
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService
from app.ui.views.patient_form_view import PatientFormView
from app.ui.webcam_dialog import PHOTO_RATIO, crop_to_passport


def _patient(name, doctor_id):
    return {
        "patient_name": name, "age": 40, "sex": "Male", "mobile_no": "9876543210",
        "address": "Arrah", "patient_condition": "Back pain", "doctor_id": doctor_id,
    }


def test_two_doctors_are_seeded_and_listed(tmp_path):
    db = tmp_path / "doctors.db"
    init_db(db)
    init_db(db)  # idempotent: no duplicate doctors
    doctors = DoctorService(db).list_doctors()
    assert len(doctors) == 2
    assert all(d["department"] for d in doctors)


def test_patient_search_filters_by_doctor_and_reports_doctor_name(tmp_path):
    db = tmp_path / "filter.db"
    init_db(db)
    service = PatientService(db)
    first, second = DoctorService(db).list_doctors()
    service.register_patient(_patient("Asha Devi", first["id"]))
    service.register_patient(_patient("Bimal Roy", second["id"]))

    mine = service.search_patients("", doctor_id=first["id"])
    assert [p["patient_name"] for p in mine] == ["Asha Devi"]
    assert mine[0]["doctor_name"] == first["name_en"]
    assert len(service.search_patients("")) == 2


def test_treatment_case_inherits_patient_doctor(tmp_path):
    db = tmp_path / "case.db"
    init_db(db)
    first, _ = DoctorService(db).list_doctors()
    patient = PatientService(db).register_patient(_patient("Asha Devi", first["id"]))
    case = TreatmentService(str(db)).open_treatment_case(patient["id"], "Rehab", 5, 1000)
    conn = get_db_connection(db)
    try:
        row = conn.execute("SELECT doctor_id FROM treatment_cases WHERE id = ?", (case["id"],)).fetchone()
    finally:
        conn.close()
    assert row["doctor_id"] == first["id"]


def test_legacy_database_is_migrated(tmp_path):
    db = tmp_path / "legacy.db"
    conn = get_db_connection(db)
    conn.executescript("""
        CREATE TABLE patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT, serial_urn_no TEXT NOT NULL UNIQUE,
            patient_name TEXT NOT NULL, age INTEGER NOT NULL, sex TEXT NOT NULL,
            address TEXT NOT NULL, mobile_no TEXT NOT NULL, patient_in TEXT, patient_out TEXT,
            referred_by TEXT, patient_condition TEXT NOT NULL, photo_filename TEXT,
            status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT, updated_at TEXT);
        CREATE TABLE treatment_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL, title TEXT NOT NULL,
            no_of_sessions INTEGER NOT NULL DEFAULT 1, total_amount_paise INTEGER NOT NULL DEFAULT 0,
            start_date TEXT, end_date TEXT, status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
            notes TEXT, created_at TEXT);
    """)
    conn.commit()
    conn.close()
    init_db(db)
    conn = get_db_connection(db)
    try:
        for table in ("patients", "treatment_cases"):
            cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            assert "doctor_id" in cols
    finally:
        conn.close()


def test_form_does_not_guess_age_sex_or_doctor(qapp, tmp_path):
    db = tmp_path / "form.db"
    init_db(db)
    form = PatientFormView(patient_service=PatientService(db))
    form.input_name.setText("Asha Devi")
    form.input_mobile.setText("9876543210")
    form.input_condition.setText("Back pain")

    form.save_record()  # age untouched
    assert "age" in form.error_banner.text().lower()

    form.input_age.setValue(0)  # age 0 is a valid, deliberate choice
    form.save_record()
    assert "sex" in form.error_banner.text().lower()

    form.input_sex.setCurrentIndex(1)
    form.save_record()  # no doctor chosen
    assert "doctor" in form.error_banner.text().lower()

    saved = []
    form.patient_saved.connect(saved.append)
    form.input_doctor.setCurrentIndex(1)
    form.save_record()
    assert saved and saved[0]["age"] == 0
    assert saved[0]["patient_out"] is None
    assert saved[0]["doctor_name"]


def test_crop_to_passport_ratio_without_stretching():
    for width, height in ((1280, 720), (500, 500), (400, 900)):
        image = QImage(width, height, QImage.Format.Format_RGB32)
        image.fill(QColor("#336699"))
        cropped = crop_to_passport(image)
        assert abs(cropped.width() / cropped.height() - PHOTO_RATIO) < 0.01
        assert cropped.height() <= 720
