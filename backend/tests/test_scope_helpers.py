"""Tests for default-deny row-level scoping and doctor isolation helpers (D-03/D-04).

Guarantees:
- CLINICAL: Doctor selects only their own records; other doctors, reception, admin, and NULL
  doctor_id rows yield zero results.
- DEMOGRAPHIC: Reception and Admin see all rows; Doctor sees only their own.
- FINANCIAL: Reception and Admin see all rows; Doctors see zero rows.
- get_scoped_or_404: Accessing another doctor's record raises 404 not_found byte-identical
  to querying a missing ID (zero existence leaks).
"""

from typing import Any

import pytest
from sqlalchemy import insert, select
from sqlalchemy.orm import Session
from support.scoped_table import ScopedSpec, create_temp_scoped_table

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Role
from kalyan_api.core.principal import Principal
from kalyan_api.core.scope import SCOPED_MODELS, ScopeFamily, get_scoped_or_404, row_scope


def _make_test_principal(role: Any, doctor_id: int | None = None, user_id: int = 1) -> Principal:
    """Helper to construct lightweight Principal instances for scope testing."""
    return Principal(
        user_id=user_id,
        username=f"user_{user_id}",
        role=role,
        doctor_id=doctor_id,
        permissions=frozenset(),
        session_id=1,
        must_change_password=False,
    )


@pytest.fixture
def scoped_test_bed(db_session: Session) -> ScopedSpec:
    """Fixture initializing temporary test table populated with doctor A, B, and unassigned rows."""
    table, spec = create_temp_scoped_table(db_session)

    # Clean existing rows if any from savepoint
    db_session.execute(table.delete())

    # Insert 3 test rows
    db_session.execute(
        insert(table),
        [
            {"id": 1, "doctor_id": 101, "payload": "Record Doctor A"},
            {"id": 2, "doctor_id": 102, "payload": "Record Doctor B"},
            {"id": 3, "doctor_id": None, "payload": "Unassigned Record"},
        ],
    )
    db_session.flush()
    return spec


def test_clinical_scope_doctor_isolation(db_session: Session, scoped_test_bed: ScopedSpec) -> None:
    """D-03: Doctor selects only their own clinical records; NULL rows invisible to all."""
    spec = scoped_test_bed
    p_doc_a = _make_test_principal(Role.DOCTOR, doctor_id=101)
    p_doc_b = _make_test_principal(Role.DOCTOR, doctor_id=102)

    # Doctor A query
    filter_a = row_scope(p_doc_a, ScopeFamily.CLINICAL, spec.doctor_id_col)
    rows_a = (
        db_session.execute(select(spec.table.c.id).where(filter_a).order_by(spec.id_col))
        .scalars()
        .all()
    )
    assert rows_a == [1]

    # Doctor B query
    filter_b = row_scope(p_doc_b, ScopeFamily.CLINICAL, spec.doctor_id_col)
    rows_b = (
        db_session.execute(select(spec.table.c.id).where(filter_b).order_by(spec.id_col))
        .scalars()
        .all()
    )
    assert rows_b == [2]


def test_clinical_scope_default_deny_for_non_doctors(
    db_session: Session, scoped_test_bed: ScopedSpec
) -> None:
    """D-04: Admin, Reception, doctors without doctor_id, and unknown roles see 0 clinical rows."""
    spec = scoped_test_bed
    p_admin = _make_test_principal(Role.ADMIN)
    p_reception = _make_test_principal(Role.RECEPTION)
    p_doc_none = _make_test_principal(Role.DOCTOR, doctor_id=None)
    p_unknown = _make_test_principal("GUEST_USER", doctor_id=101)

    for p in (p_admin, p_reception, p_doc_none, p_unknown, None):
        flt = row_scope(p, ScopeFamily.CLINICAL, spec.doctor_id_col)
        result = db_session.execute(select(spec.table.c.id).where(flt)).scalars().all()
        assert result == [], f"Expected 0 clinical rows for principal {p}, got {result}"


def test_demographic_scope_rules(db_session: Session, scoped_test_bed: ScopedSpec) -> None:
    """Demographic: Reception and Admin see all rows; Doctor sees only own."""
    spec = scoped_test_bed
    p_admin = _make_test_principal(Role.ADMIN)
    p_reception = _make_test_principal(Role.RECEPTION)
    p_doc_a = _make_test_principal(Role.DOCTOR, doctor_id=101)
    p_doc_none = _make_test_principal(Role.DOCTOR, doctor_id=None)

    # Admin and Reception see all 3 rows
    for p in (p_admin, p_reception):
        flt = row_scope(p, ScopeFamily.DEMOGRAPHIC, spec.doctor_id_col)
        rows = (
            db_session.execute(select(spec.table.c.id).where(flt).order_by(spec.id_col))
            .scalars()
            .all()
        )
        assert rows == [1, 2, 3]

    # Doctor A sees only own
    flt_a = row_scope(p_doc_a, ScopeFamily.DEMOGRAPHIC, spec.doctor_id_col)
    rows_a = (
        db_session.execute(select(spec.table.c.id).where(flt_a).order_by(spec.id_col))
        .scalars()
        .all()
    )
    assert rows_a == [1]

    # Doctor without doctor_id sees 0
    flt_none = row_scope(p_doc_none, ScopeFamily.DEMOGRAPHIC, spec.doctor_id_col)
    rows_none = db_session.execute(select(spec.table.c.id).where(flt_none)).scalars().all()
    assert rows_none == []


def test_financial_scope_rules(db_session: Session, scoped_test_bed: ScopedSpec) -> None:
    """Financial: Reception and Admin see all rows; Doctors see none."""
    spec = scoped_test_bed
    p_admin = _make_test_principal(Role.ADMIN)
    p_reception = _make_test_principal(Role.RECEPTION)
    p_doc_a = _make_test_principal(Role.DOCTOR, doctor_id=101)

    for p in (p_admin, p_reception):
        flt = row_scope(p, ScopeFamily.FINANCIAL, spec.doctor_id_col)
        rows = (
            db_session.execute(select(spec.table.c.id).where(flt).order_by(spec.id_col))
            .scalars()
            .all()
        )
        assert rows == [1, 2, 3]

    flt_doc = row_scope(p_doc_a, ScopeFamily.FINANCIAL, spec.doctor_id_col)
    rows_doc = db_session.execute(select(spec.table.c.id).where(flt_doc)).scalars().all()
    assert rows_doc == []


def test_get_scoped_or_404_indistinguishable_from_missing(
    db_session: Session, scoped_test_bed: ScopedSpec
) -> None:
    """T-11-39: Attempting to load another doctor's record raises 404 identical to missing ID."""
    spec = scoped_test_bed
    p_doc_a = _make_test_principal(Role.DOCTOR, doctor_id=101)

    # 1. Loading own row succeeds
    own_row = get_scoped_or_404(
        db_session,
        spec.table,
        obj_id=1,
        principal=p_doc_a,
        family=ScopeFamily.CLINICAL,
        doctor_id_col=spec.doctor_id_col,
    )
    assert own_row is not None
    assert own_row.id == 1

    # 2. Loading another doctor's row (ID 2 exists in DB, belongs to Doc B)
    with pytest.raises(ApiError) as exc_cross:
        get_scoped_or_404(
            db_session,
            spec.table,
            obj_id=2,
            principal=p_doc_a,
            family=ScopeFamily.CLINICAL,
            doctor_id_col=spec.doctor_id_col,
        )

    # 3. Loading completely non-existent ID (99999 does not exist in DB)
    with pytest.raises(ApiError) as exc_missing:
        get_scoped_or_404(
            db_session,
            spec.table,
            obj_id=99999,
            principal=p_doc_a,
            family=ScopeFamily.CLINICAL,
            doctor_id_col=spec.doctor_id_col,
        )

    assert exc_cross.value.status_code == 404
    assert exc_missing.value.status_code == 404
    assert exc_cross.value.code == exc_missing.value.code == "not_found"
    assert exc_cross.value.message == exc_missing.value.message


@pytest.mark.parametrize(
    "family,role,has_doc_id,expected_match_ids",
    [
        (ScopeFamily.CLINICAL, Role.DOCTOR, True, [1]),
        (ScopeFamily.CLINICAL, Role.DOCTOR, False, []),
        (ScopeFamily.CLINICAL, Role.ADMIN, False, []),
        (ScopeFamily.CLINICAL, Role.RECEPTION, False, []),
        (ScopeFamily.CLINICAL_WRITE, Role.DOCTOR, True, [1]),
        (ScopeFamily.CLINICAL_WRITE, Role.DOCTOR, False, []),
        (ScopeFamily.CLINICAL_WRITE, Role.ADMIN, False, []),
        (ScopeFamily.CLINICAL_WRITE, Role.RECEPTION, False, []),
        (ScopeFamily.CLINICAL_READ, Role.DOCTOR, True, [1, 2, 3]),
        (ScopeFamily.CLINICAL_READ, Role.DOCTOR, False, []),
        (ScopeFamily.CLINICAL_READ, Role.ADMIN, False, []),
        (ScopeFamily.CLINICAL_READ, Role.RECEPTION, False, []),
        (ScopeFamily.DEMOGRAPHIC, Role.ADMIN, False, [1, 2, 3]),
        (ScopeFamily.DEMOGRAPHIC, Role.RECEPTION, False, [1, 2, 3]),
        (ScopeFamily.DEMOGRAPHIC, Role.DOCTOR, True, [1]),
        (ScopeFamily.DEMOGRAPHIC, Role.DOCTOR, False, []),
        (ScopeFamily.FINANCIAL, Role.ADMIN, False, [1, 2, 3]),
        (ScopeFamily.FINANCIAL, Role.RECEPTION, False, [1, 2, 3]),
        (ScopeFamily.FINANCIAL, Role.DOCTOR, True, []),
        (ScopeFamily.FINANCIAL, Role.DOCTOR, False, []),
    ],
)
def test_all_scope_family_and_role_combinations(
    db_session: Session,
    scoped_test_bed: ScopedSpec,
    family: ScopeFamily,
    role: Role,
    has_doc_id: bool,
    expected_match_ids: list[int],
) -> None:
    """Parametrized matrix validating all scope family and role access combinations."""
    spec = scoped_test_bed
    doc_id = 101 if has_doc_id else None
    principal = _make_test_principal(role, doctor_id=doc_id)

    filter_expr = row_scope(principal, family, spec.doctor_id_col)
    matched_ids = (
        db_session.execute(select(spec.table.c.id).where(filter_expr).order_by(spec.id_col))
        .scalars()
        .all()
    )

    assert matched_ids == expected_match_ids


def test_scoped_models_registry_validation(
    db_session: Session, scoped_test_bed: ScopedSpec
) -> None:
    """Ensure registry of scoped models can be iterated alongside temporary spec."""
    all_specs = [scoped_test_bed] + list(SCOPED_MODELS)
    assert len(all_specs) >= 1
    for spec in all_specs:
        assert hasattr(spec, "name")
        assert hasattr(spec, "table")
        assert hasattr(spec, "doctor_id_col")
        assert hasattr(spec, "id_col")


def test_cross_doctor_clinical_read_auditing(
    db_session: Session, scoped_test_bed: ScopedSpec, doctor_a_user: Any
) -> None:
    """Reading another doctor's clinical record triggers CROSS_DOCTOR_CLINICAL_READ audit entry."""
    from kalyan_api.models import AuditLog
    from kalyan_api.services.audit_service import AuditAction

    spec = scoped_test_bed
    p_doc_a = _make_test_principal(Role.DOCTOR, doctor_id=101, user_id=doctor_a_user.id)

    # 1. Reading Doctor A's own record with CLINICAL_READ does NOT generate cross-doctor audit log
    row_own = get_scoped_or_404(
        db_session,
        spec.table,
        obj_id=1,
        principal=p_doc_a,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=spec.doctor_id_col,
    )
    assert row_own.id == 1

    logs_after_own = db_session.execute(
        select(AuditLog).where(AuditLog.action == AuditAction.CROSS_DOCTOR_CLINICAL_READ)
    ).scalars().all()
    assert len(logs_after_own) == 0

    # 2. Reading Doctor B's record (id=2, doctor_id=102) with CLINICAL_READ generates audit log
    row_cross = get_scoped_or_404(
        db_session,
        spec.table,
        obj_id=2,
        principal=p_doc_a,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=spec.doctor_id_col,
    )
    assert row_cross.id == 2

    logs_after_cross = db_session.execute(
        select(AuditLog).where(AuditLog.action == AuditAction.CROSS_DOCTOR_CLINICAL_READ)
    ).scalars().all()
    assert len(logs_after_cross) == 1
    log = logs_after_cross[0]
    assert log.actor_user_id == p_doc_a.user_id
    assert log.after_data == {
        "actor_doctor_id": 101,
        "record_doctor_id": 102,
        "patient_id": None,
    }

