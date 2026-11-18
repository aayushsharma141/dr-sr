"""Regression tests for Admin EMR Data & Financial Integrity defects (M5, M6, M7).

- M5: Multi-hop patient merge (A -> B -> C) must be rejected so A's clinical/financial history
  is never orphaned by 1-hop consolidation.
- M6: Patient archival dues guard must include unpaid ACTIVE/COMPLETED TreatmentPlan balances
  (net of non-reversed payments minus refunds, including merged aliases) and ignore CANCELLED plans.
- M7: Merge open-visit guard must check Visit.status == 'OPEN' instead of Visit.closed_at IS NULL,
  so historical CANCELLED visits never permanently block merges.
"""

from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.models import (
    Doctor,
    Patient,
    Payment,
    PaymentMethod,
    Refund,
    TreatmentPlan,
    TreatmentPlanStatus,
    User,
    Visit,
    VisitStatus,
)


def _make_patient(
    db_session: Session,
    urn: str,
    name: str,
    mobile: str,
    *,
    years_ago: int = 0,
) -> Patient:
    created = clock.utcnow() - timedelta(days=years_ago * 365) if years_ago else clock.utcnow()
    patient = Patient(
        urn=urn,
        full_name=name,
        guardian_name="Guardian Name",
        gender="M",
        age_years=40,
        mobile=mobile,
        address="Ara, Bhojpur",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
        is_archived=False,
        created_at=created,
    )
    db_session.add(patient)
    db_session.flush()
    return patient


# --------------------------------------------------------------------------------------
# M5: Multi-hop patient merge guard (A -> B -> C)
# --------------------------------------------------------------------------------------


def test_m5_multihop_merge_rejected_to_prevent_orphaning_history(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Merging B into C after A was already merged into B must be refused (409)."""
    client = login_client(admin_user)

    p_a = _make_patient(db_session, "URN-M5-A", "Ramesh Prasad", "9800055501")
    p_b = _make_patient(db_session, "URN-M5-B", "Ramesh Prasad", "9800055501")
    p_c = _make_patient(db_session, "URN-M5-C", "Ramesh Prasad", "9800055501")
    db_session.commit()

    # Step 1: Merge A -> B (valid 1-hop merge)
    r1 = client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p_b.id,
            "secondary_patient_id": p_a.id,
            "reason": "First duplicate merge A into B",
        },
    )
    assert r1.status_code == 200, r1.text

    # Step 2: Attempt to merge B (which already has merged child A) -> C; MUST fail 409
    r2 = client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p_c.id,
            "secondary_patient_id": p_b.id,
            "reason": "Attempted multi-hop merge B into C",
        },
    )
    assert r2.status_code == 409, r2.text
    assert r2.json()["code"] == "secondary_has_merged_children"

    db_session.expire_all()
    p_b_reloaded = db_session.get(Patient, p_b.id)
    assert p_b_reloaded is not None
    assert p_b_reloaded.is_active is True
    assert p_b_reloaded.merged_into_id is None

    # Merging C -> B (keeping B as master) remains valid because C has no merged children.
    r3 = client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p_b.id,
            "secondary_patient_id": p_c.id,
            "reason": "Merge C into existing master B",
        },
    )
    assert r3.status_code == 200, r3.text


# --------------------------------------------------------------------------------------
# M6: Archival dues guard includes TreatmentPlan / physiotherapy package balances
# --------------------------------------------------------------------------------------


def test_m6_unpaid_treatment_plan_blocks_archival_and_respects_payments_and_refunds(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """Unpaid ACTIVE TreatmentPlan blocks candidates & bulk-archive until net paid == agreed."""
    client = login_client(admin_user)

    doctor = Doctor(name_en="Dr. PhysioM6", is_active=True)
    db_session.add(doctor)
    db_session.flush()

    pat = _make_patient(
        db_session, "URN-M6-PKG1", "Suresh Yadav", "9800066601", years_ago=4
    )
    plan = TreatmentPlan(
        patient_id=pat.id,
        doctor_id=doctor.id,
        plan_name="Knee Rehab 10 Sessions",
        condition_diagnosis="Post-op knee stiffness",
        total_sessions=10,
        completed_sessions=2,
        agreed_price_paise=100_000,  # Rs 1,000.00
        status=TreatmentPlanStatus.ACTIVE.value,
    )
    db_session.add(plan)
    db_session.commit()

    # 1. Archival candidates must surface the unpaid package balance and block archival
    cand_resp = client.get("/api/admin/patients/archival-candidates?inactivity_years=3")
    assert cand_resp.status_code == 200, cand_resp.text
    cand = next((c for c in cand_resp.json() if c["patient"]["id"] == pat.id), None)
    assert cand is not None
    assert cand["can_archive"] is False
    assert cand["total_dues_paise"] == 100_000
    assert "outstanding dues" in (cand["blocking_reason"] or "").lower()

    # 2. Bulk archive must fail closed with 400 patient_has_outstanding_dues
    arch_resp = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [pat.id], "reason": "Try archive with unpaid package"},
    )
    assert arch_resp.status_code == 400, arch_resp.text
    assert arch_resp.json()["code"] == "patient_has_outstanding_dues"

    # 3. Partial payment (Rs 600) still leaves Rs 400 due -> still blocked
    pay1 = Payment(
        receipt_number="RCP-M6-0001",
        patient_id=pat.id,
        treatment_plan_id=plan.id,
        amount_paise=60_000,
        payment_method=PaymentMethod.CASH.value,
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pay1)
    db_session.commit()

    arch_partial = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [pat.id], "reason": "Try archive after partial payment"},
    )
    assert arch_partial.status_code == 400, arch_partial.text
    assert arch_partial.json()["code"] == "patient_has_outstanding_dues"

    # 4. Pay remaining Rs 400, then refund Rs 200 -> net paid Rs 800, Rs 200 due -> still blocked
    pay2 = Payment(
        receipt_number="RCP-M6-0002",
        patient_id=pat.id,
        treatment_plan_id=plan.id,
        amount_paise=40_000,
        payment_method=PaymentMethod.UPI.value,
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pay2)
    db_session.flush()
    refund = Refund(
        refund_number="RFN-M6-0001",
        payment_id=pay2.id,
        patient_id=pat.id,
        amount_paise=20_000,
        refund_method=PaymentMethod.CASH.value,
        reason="Partial refund on package",
        refunded_by_user_id=admin_user.id,
    )
    db_session.add(refund)
    db_session.commit()

    arch_refunded = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [pat.id], "reason": "Try archive after partial refund"},
    )
    assert arch_refunded.status_code == 400, arch_refunded.text
    assert arch_refunded.json()["code"] == "patient_has_outstanding_dues"

    # 5. Settle remaining Rs 200 -> archival succeeds
    pay3 = Payment(
        receipt_number="RCP-M6-0003",
        patient_id=pat.id,
        treatment_plan_id=plan.id,
        amount_paise=20_000,
        payment_method=PaymentMethod.CASH.value,
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pay3)
    db_session.commit()

    arch_ok = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [pat.id], "reason": "Package settled in full"},
    )
    assert arch_ok.status_code == 200, arch_ok.text
    db_session.refresh(pat)
    assert pat.is_archived is True


def test_m6_completed_plan_blocks_but_cancelled_plan_allows_archival(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """COMPLETED unpaid plan blocks archival; CANCELLED plan does not block archival."""
    client = login_client(admin_user)

    doctor = Doctor(name_en="Dr. PhysioM6B", is_active=True)
    db_session.add(doctor)
    db_session.flush()

    p_comp = _make_patient(
        db_session, "URN-M6-COMP", "Mohan Lal", "9800066602", years_ago=4
    )
    db_session.add(
        TreatmentPlan(
            patient_id=p_comp.id,
            doctor_id=doctor.id,
            plan_name="Back Therapy",
            condition_diagnosis="Lumbar spondylosis",
            total_sessions=5,
            completed_sessions=5,
            agreed_price_paise=50_000,
            status=TreatmentPlanStatus.COMPLETED.value,
        )
    )

    p_canc = _make_patient(
        db_session, "URN-M6-CANC", "Sohan Lal", "9800066603", years_ago=4
    )
    db_session.add(
        TreatmentPlan(
            patient_id=p_canc.id,
            doctor_id=doctor.id,
            plan_name="Cancelled Therapy",
            condition_diagnosis="Shoulder pain",
            total_sessions=5,
            completed_sessions=0,
            agreed_price_paise=50_000,
            status=TreatmentPlanStatus.CANCELLED.value,
            cancellation_reason="Patient relocated out of city",
        )
    )
    db_session.commit()

    res_comp = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [p_comp.id], "reason": "Try archive completed unpaid plan"},
    )
    assert res_comp.status_code == 400, res_comp.text
    assert res_comp.json()["code"] == "patient_has_outstanding_dues"

    res_canc = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [p_canc.id], "reason": "Archive patient with cancelled plan"},
    )
    assert res_canc.status_code == 200, res_canc.text
    db_session.refresh(p_canc)
    assert p_canc.is_archived is True


def test_m6_merged_secondary_unpaid_package_blocks_master_archival(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Master patient cannot be archived if a merged secondary patient has unpaid package dues."""
    client = login_client(admin_user)

    doctor = Doctor(name_en="Dr. PhysioM6C", is_active=True)
    db_session.add(doctor)
    db_session.flush()

    master = _make_patient(
        db_session, "URN-M6-MAS", "Gita Devi", "9800066604", years_ago=4
    )
    secondary = _make_patient(
        db_session, "URN-M6-SEC", "Gita Devi", "9800066604", years_ago=4
    )
    db_session.add(
        TreatmentPlan(
            patient_id=secondary.id,
            doctor_id=doctor.id,
            plan_name="Cervical Rehab",
            condition_diagnosis="Cervical spondylosis",
            total_sessions=6,
            completed_sessions=1,
            agreed_price_paise=75_000,
            status=TreatmentPlanStatus.ACTIVE.value,
        )
    )
    db_session.commit()

    merge_res = client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": master.id,
            "secondary_patient_id": secondary.id,
            "reason": "Consolidate before archival check",
        },
    )
    assert merge_res.status_code == 200, merge_res.text

    cand_resp = client.get("/api/admin/patients/archival-candidates?inactivity_years=3")
    assert cand_resp.status_code == 200, cand_resp.text
    cand = next((c for c in cand_resp.json() if c["patient"]["id"] == master.id), None)
    assert cand is not None
    assert cand["can_archive"] is False
    assert cand["total_dues_paise"] == 75_000

    arch_resp = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [master.id], "reason": "Try archive master with merged pkg dues"},
    )
    assert arch_resp.status_code == 400, arch_resp.text
    assert arch_resp.json()["code"] == "patient_has_outstanding_dues"


# --------------------------------------------------------------------------------------
# M7: Cancelled visit must not block patient merge
# --------------------------------------------------------------------------------------


def test_m7_cancelled_visit_does_not_block_merge_or_flag_open_visit(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    """A CANCELLED visit (closed_at=NULL) must not trigger open_visit_conflict on merge."""
    client = login_client(admin_user)

    p1 = _make_patient(db_session, "URN-M7-01", "Meera Kumari", "9800077701")
    p2 = _make_patient(db_session, "URN-M7-02", "Meera Kumari", "9800077701")

    cancelled_visit = Visit(
        patient_id=p2.id,
        visit_date=date(2026, 2, 15),
        status=VisitStatus.CANCELLED.value,
        opened_by_user_id=reception_user.id,
        closed_at=None,
        cancelled_at=clock.utcnow(),
        cancelled_by_user_id=reception_user.id,
        cancel_reason="Patient left before consultation",
    )
    db_session.add(cancelled_visit)
    db_session.commit()

    # 1. Duplicate candidates must report has_open_visit=False
    dup_resp = client.get("/api/admin/patients/duplicates")
    assert dup_resp.status_code == 200, dup_resp.text
    pair = next(
        (
            p
            for p in dup_resp.json()
            if p["master"]["id"] == p1.id and p["duplicate"]["id"] == p2.id
        ),
        None,
    )
    assert pair is not None
    assert pair["has_open_visit"] is False
    assert pair["open_visit_details"] is None

    # 2. Merge must succeed (not 400 open_visit_conflict)
    merge_resp = client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p1.id,
            "secondary_patient_id": p2.id,
            "reason": "Cancelled historical visit should not block merge",
        },
    )
    assert merge_resp.status_code == 200, merge_resp.text
    assert merge_resp.json()["secondary"]["merged_into_id"] == p1.id
