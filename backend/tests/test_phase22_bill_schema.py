"""Database schema guard tests for bill lines and visit payments (Phase 22, migration 0029).

Tests database-level constraints for:
- bill_items.status ('ACTIVE', 'VOIDED') and default ACTIVE
- bill_items.void_integrity (reason >= 3 chars, actor, time for VOIDED; all NULL for ACTIVE)
- payments.visit_id composite FK (visit_id, patient_id) -> visits(id, patient_id)
- payments.single_target CHECK (visit_id NULL or both appointment_id & treatment_plan_id NULL)
- bill_items.package_reference CHECK (PACKAGE must have treatment_plan_id and rate=amount=0)
- bill_items.prescription_link_medicine_only CHECK (only MEDICINE can link prescription_item_id)
- bill_items composite FK (treatment_plan_id, patient_id) -> treatment_plans(id, patient_id)
- bill_items positive quantity and non-negative rate/amount constraints
- Migration 0029 downgrade refusal when new data exists
- Python enums (BillItemStatus, BillItemCategory, BillItemAdjustmentKind)
"""

import importlib.util
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import kalyan_api
from kalyan_api.config import Settings
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    Base,
    BillItem,
    BillItemAdjustmentKind,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    Patient,
    Payment,
    Prescription,
    PrescriptionItem,
    TreatmentPlan,
    TreatmentPlanStatus,
    User,
    Visit,
    VisitStatus,
)

VISIT_DATE = date(2026, 11, 20)
MIGRATION_0029 = (
    Path(kalyan_api.__file__).parent / "migrations" / "versions" / "0029_bill_lines_and_visit_payments.py"
)


def _load_migration_0029() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_0029_bill_lines_and_visit_payments", MIGRATION_0029)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _patient(session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-B9{suffix}",
        full_name=f"Bill Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=35,
        mobile="9876540001",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    session.add(patient)
    session.flush()
    return patient


def _visit(session: Session, patient: Patient, user: User) -> Visit:
    visit = Visit(
        patient_id=patient.id,
        visit_date=VISIT_DATE,
        status=VisitStatus.OPEN.value,
        opened_by_user_id=user.id,
    )
    session.add(visit)
    session.flush()
    return visit


def _appointment(session: Session, patient: Patient, doctor_id: int, user: User, visit: Visit) -> Appointment:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_id,
        appointment_date=VISIT_DATE,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=user.id,
        visit_id=visit.id,
    )
    session.add(appt)
    session.flush()
    return appt


def _treatment_plan(session: Session, patient: Patient, doctor_id: int) -> TreatmentPlan:
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_id,
        plan_name="Physio Package 10",
        condition_diagnosis="Low back pain",
        total_sessions=10,
        agreed_price_paise=500000,
        status=TreatmentPlanStatus.ACTIVE.value,
    )
    session.add(plan)
    session.flush()
    return plan


def _prescription(session: Session, patient: Patient, doctor_id: int) -> Prescription:
    rx = Prescription(
        patient_id=patient.id,
        doctor_id=doctor_id,
        diagnosis="Hypertension",
    )
    session.add(rx)
    session.flush()
    return rx


def _prescription_item(session: Session, prescription: Prescription) -> PrescriptionItem:
    item = PrescriptionItem(
        prescription_id=prescription.id,
        item_order=1,
        medicine_name="Amlodipine 5mg",
        dosage="1 tab",
        frequency="Once daily",
        duration_days=30,
    )
    session.add(item)
    session.flush()
    return item


# --- Task 1: BillItem status, void integrity, payment visit_id, single_target ---


def test_insert_bill_item_without_status_defaults_to_active(db_session, reception_user):
    patient = _patient(db_session, "T1A")
    visit = _visit(db_session, patient, reception_user)

    line = BillItem(
        visit_id=visit.id,
        patient_id=patient.id,
        category=BillItemCategory.ADDITIONAL.value,
        source=BillItemSource.RECEPTION.value,
        description="Registration file",
        quantity=Decimal("1"),
        rate_paise=5000,
        original_amount_paise=5000,
        amount_paise=5000,
        created_by_user_id=reception_user.id,
    )
    db_session.add(line)
    db_session.flush()
    db_session.refresh(line)

    assert line.status == BillItemStatus.ACTIVE.value
    assert line.void_reason is None
    assert line.voided_by_user_id is None
    assert line.voided_at is None


def test_bill_item_rejects_unknown_status(db_session, reception_user):
    patient = _patient(db_session, "T1B")
    visit = _visit(db_session, patient, reception_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line = BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            category=BillItemCategory.ADDITIONAL.value,
            source=BillItemSource.RECEPTION.value,
            status="UNKNOWN",
            description="Bad status item",
            quantity=Decimal("1"),
            rate_paise=1000,
            original_amount_paise=1000,
            amount_paise=1000,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line)
        db_session.flush()
    assert "status_valid" in str(exc_info.value)


def test_bill_item_void_integrity_voided_requires_reason_actor_time(db_session, reception_user):
    patient = _patient(db_session, "T1C")
    visit = _visit(db_session, patient, reception_user)

    # Missing reason, actor and time
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line = BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            category=BillItemCategory.ADDITIONAL.value,
            source=BillItemSource.RECEPTION.value,
            status=BillItemStatus.VOIDED.value,
            description="Voided without details",
            quantity=Decimal("1"),
            rate_paise=1000,
            original_amount_paise=1000,
            amount_paise=1000,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line)
        db_session.flush()
    assert "void_integrity" in str(exc_info.value)

    # Reason too short (< 3 chars)
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line = BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            category=BillItemCategory.ADDITIONAL.value,
            source=BillItemSource.RECEPTION.value,
            status=BillItemStatus.VOIDED.value,
            description="Voided with short reason",
            quantity=Decimal("1"),
            rate_paise=1000,
            original_amount_paise=1000,
            amount_paise=1000,
            created_by_user_id=reception_user.id,
            void_reason="no",
            voided_by_user_id=reception_user.id,
            voided_at=datetime.now(UTC),
        )
        db_session.add(line)
        db_session.flush()
    assert "void_integrity" in str(exc_info.value)

    # Valid VOIDED line with reason >= 3 chars, actor, and time succeeds
    line_ok = BillItem(
        visit_id=visit.id,
        patient_id=patient.id,
        category=BillItemCategory.ADDITIONAL.value,
        source=BillItemSource.RECEPTION.value,
        status=BillItemStatus.VOIDED.value,
        description="Voided correctly",
        quantity=Decimal("1"),
        rate_paise=1000,
        original_amount_paise=1000,
        amount_paise=1000,
        created_by_user_id=reception_user.id,
        void_reason="Added in error by reception",
        voided_by_user_id=reception_user.id,
        voided_at=datetime.now(UTC),
    )
    db_session.add(line_ok)
    db_session.flush()
    assert line_ok.id is not None


def test_bill_item_void_integrity_active_forbids_void_fields(db_session, reception_user):
    patient = _patient(db_session, "T1D")
    visit = _visit(db_session, patient, reception_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line = BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            category=BillItemCategory.ADDITIONAL.value,
            source=BillItemSource.RECEPTION.value,
            status=BillItemStatus.ACTIVE.value,
            description="Active with void reason",
            quantity=Decimal("1"),
            rate_paise=1000,
            original_amount_paise=1000,
            amount_paise=1000,
            created_by_user_id=reception_user.id,
            void_reason="Should not have reason",
        )
        db_session.add(line)
        db_session.flush()
    assert "void_integrity" in str(exc_info.value)


def test_payment_rejects_visit_id_of_another_patient(db_session, reception_user):
    patient_a = _patient(db_session, "T1E1")
    patient_b = _patient(db_session, "T1E2")
    visit_a = _visit(db_session, patient_a, reception_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        payment = Payment(
            receipt_number="RCP-TEST-0029-A",
            patient_id=patient_b.id,
            visit_id=visit_a.id,
            amount_paise=50000,
            payment_method="CASH",
            created_by_user_id=reception_user.id,
        )
        db_session.add(payment)
        db_session.flush()
    assert "fk_payments_visit_patient" in str(exc_info.value)


def test_payment_single_target_constraint(db_session, reception_user, doctor_a_user):
    patient = _patient(db_session, "T1F")
    visit = _visit(db_session, patient, reception_user)
    appt = _appointment(db_session, patient, doctor_a_user.doctor_id, reception_user, visit)
    plan = _treatment_plan(db_session, patient, doctor_a_user.doctor_id)

    # visit_id AND appointment_id both set raises IntegrityError
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        p1 = Payment(
            receipt_number="RCP-TEST-0029-B1",
            patient_id=patient.id,
            visit_id=visit.id,
            appointment_id=appt.id,
            amount_paise=30000,
            payment_method="CASH",
            created_by_user_id=reception_user.id,
        )
        db_session.add(p1)
        db_session.flush()
    assert "single_target" in str(exc_info.value)

    # visit_id AND treatment_plan_id both set raises IntegrityError
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        p2 = Payment(
            receipt_number="RCP-TEST-0029-B2",
            patient_id=patient.id,
            visit_id=visit.id,
            treatment_plan_id=plan.id,
            amount_paise=30000,
            payment_method="CASH",
            created_by_user_id=reception_user.id,
        )
        db_session.add(p2)
        db_session.flush()
    assert "single_target" in str(exc_info.value)

    # visit_id alone (appointment_id and treatment_plan_id NULL) succeeds
    p_ok = Payment(
        receipt_number="RCP-TEST-0029-B3",
        patient_id=patient.id,
        visit_id=visit.id,
        amount_paise=30000,
        payment_method="CASH",
        created_by_user_id=reception_user.id,
    )
    db_session.add(p_ok)
    db_session.flush()
    assert p_ok.id is not None


# --- Task 2: Package & prescription constraints, enums, downgrade ---


def test_package_bill_line_constraints(db_session, reception_user, doctor_a_user):
    patient_a = _patient(db_session, "T2A1")
    patient_b = _patient(db_session, "T2A2")
    visit_a = _visit(db_session, patient_a, reception_user)
    plan_a = _treatment_plan(db_session, patient_a, doctor_a_user.doctor_id)
    plan_b = _treatment_plan(db_session, patient_b, doctor_a_user.doctor_id)

    # PACKAGE without treatment_plan_id raises IntegrityError
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line_no_plan = BillItem(
            visit_id=visit_a.id,
            patient_id=patient_a.id,
            category=BillItemCategory.PACKAGE.value,
            source=BillItemSource.DOCTOR.value,
            description="Package line without plan",
            quantity=Decimal("1"),
            rate_paise=0,
            original_amount_paise=0,
            amount_paise=0,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line_no_plan)
        db_session.flush()
    assert "package_reference" in str(exc_info.value)

    # PACKAGE with non-zero rate or amount raises IntegrityError (OD-C)
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line_nonzero = BillItem(
            visit_id=visit_a.id,
            patient_id=patient_a.id,
            treatment_plan_id=plan_a.id,
            category=BillItemCategory.PACKAGE.value,
            source=BillItemSource.DOCTOR.value,
            description="Package line with price",
            quantity=Decimal("1"),
            rate_paise=50000,
            original_amount_paise=50000,
            amount_paise=50000,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line_nonzero)
        db_session.flush()
    assert "package_reference" in str(exc_info.value)

    # PACKAGE with plan belonging to another patient raises composite FK error
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line_wrong_pt = BillItem(
            visit_id=visit_a.id,
            patient_id=patient_a.id,
            treatment_plan_id=plan_b.id,
            category=BillItemCategory.PACKAGE.value,
            source=BillItemSource.DOCTOR.value,
            description="Package line with other patient's plan",
            quantity=Decimal("1"),
            rate_paise=0,
            original_amount_paise=0,
            amount_paise=0,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line_wrong_pt)
        db_session.flush()
    assert "fk_bill_items_treatment_plan_patient" in str(exc_info.value)

    # PACKAGE with own plan and zero rate/amount succeeds
    line_ok = BillItem(
        visit_id=visit_a.id,
        patient_id=patient_a.id,
        treatment_plan_id=plan_a.id,
        category=BillItemCategory.PACKAGE.value,
        source=BillItemSource.DOCTOR.value,
        description="Package: Physio 10 sessions",
        quantity=Decimal("1"),
        rate_paise=0,
        original_amount_paise=0,
        amount_paise=0,
        created_by_user_id=reception_user.id,
    )
    db_session.add(line_ok)
    db_session.flush()
    assert line_ok.id is not None


def test_prescription_link_medicine_only_constraint(db_session, reception_user, doctor_a_user):
    patient = _patient(db_session, "T2B")
    visit = _visit(db_session, patient, reception_user)
    rx = _prescription(db_session, patient, doctor_a_user.doctor_id)
    rx_item = _prescription_item(db_session, rx)

    # Non-MEDICINE (e.g. PROCEDURE) with prescription_item_id set raises IntegrityError
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line_proc = BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            prescription_item_id=rx_item.id,
            category=BillItemCategory.PROCEDURE.value,
            source=BillItemSource.DOCTOR.value,
            description="Procedure linking prescription",
            quantity=Decimal("1"),
            rate_paise=10000,
            original_amount_paise=10000,
            amount_paise=10000,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line_proc)
        db_session.flush()
    assert "prescription_link_medicine_only" in str(exc_info.value)

    # MEDICINE line with prescription_item_id set succeeds
    line_med = BillItem(
        visit_id=visit.id,
        patient_id=patient.id,
        prescription_item_id=rx_item.id,
        category=BillItemCategory.MEDICINE.value,
        source=BillItemSource.RECEPTION.value,
        description="Amlodipine 5mg",
        unit="strip",
        quantity=Decimal("2"),
        rate_paise=6000,
        original_amount_paise=12000,
        amount_paise=12000,
        created_by_user_id=reception_user.id,
    )
    db_session.add(line_med)
    db_session.flush()
    assert line_med.id is not None
    assert line_med.unit == "strip"


def test_existing_checks_quantity_positive_and_amounts_nonnegative(db_session, reception_user):
    patient = _patient(db_session, "T2C")
    visit = _visit(db_session, patient, reception_user)

    # quantity <= 0
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line_qty = BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            category=BillItemCategory.ADDITIONAL.value,
            source=BillItemSource.RECEPTION.value,
            description="Bad quantity",
            quantity=Decimal("0"),
            rate_paise=1000,
            original_amount_paise=0,
            amount_paise=0,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line_qty)
        db_session.flush()
    assert "quantity_positive" in str(exc_info.value)

    # rate_paise < 0
    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        line_rate = BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            category=BillItemCategory.ADDITIONAL.value,
            source=BillItemSource.RECEPTION.value,
            description="Negative rate",
            quantity=Decimal("1"),
            rate_paise=-100,
            original_amount_paise=-100,
            amount_paise=-100,
            created_by_user_id=reception_user.id,
        )
        db_session.add(line_rate)
        db_session.flush()
    assert "amounts_nonnegative" in str(exc_info.value)


def test_enums_match_database_checks():
    """Verify Python enums match database constraints."""
    expected_categories = {"CONSULTATION", "PROCEDURE", "PACKAGE", "MEDICINE", "ADDITIONAL"}
    actual_categories = {c.value for c in BillItemCategory}
    assert actual_categories == expected_categories

    expected_adjustment_kinds = {"DISCOUNT", "WAIVER", "CORRECTION", "VOID"}
    actual_adjustment_kinds = {k.value for k in BillItemAdjustmentKind}
    assert actual_adjustment_kinds == expected_adjustment_kinds

    expected_statuses = {"ACTIVE", "VOIDED"}
    actual_statuses = {s.value for s in BillItemStatus}
    assert actual_statuses == expected_statuses


def test_downgrade_0029_refuses_when_opd_data_exists(owner_engine: Engine, test_settings: Settings):
    """The downgrade must refuse before deleting any OPD financial data when rows exist."""
    migration = _load_migration_0029()
    connection = owner_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        from conftest import make_user

        user = make_user(
            session, test_settings, role="RECEPTION", username="rec_dg_0029"
        )
        patient = _patient(session, "T2D")
        visit = _visit(session, patient, user)

        # Create a payment with visit_id
        payment = Payment(
            receipt_number="RCP-TEST-0029-DG",
            patient_id=patient.id,
            visit_id=visit.id,
            amount_paise=10000,
            payment_method="CASH",
            created_by_user_id=user.id,
        )
        session.add(payment)
        session.flush()

        version_before = connection.scalar(text("SELECT version_num FROM alembic_version"))

        context = MigrationContext.configure(connection, opts={"target_metadata": Base.metadata})
        with Operations.context(context), pytest.raises(RuntimeError, match="downgrade stopped"):
            migration.downgrade()

        # Database version stays untouched
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == version_before
    finally:
        session.close()
        transaction.rollback()
        connection.close()
