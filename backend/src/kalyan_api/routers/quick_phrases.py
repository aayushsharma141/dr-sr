"""Persistent clinical quick phrases endpoints (Phase 3 / T3.1).

Guarantees:
- Strictly DOCTOR-only via ENCOUNTER_READ / ENCOUNTER_WRITE permissions.
- Hospital defaults are idempotently seeded at the application layer and read-only to doctors.
- Specialty departments with their own defaults (PHYSIOTHERAPY, OPHTHALMOLOGY) never mix
  General (`department_code IS NULL`) defaults into their response.
- Personal phrases are owned by `principal.doctor_id`; cross-doctor mutations return 404.
- Editing or deleting a phrase never mutates previously saved clinical encounter text.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    ClinicalQuickPhrase,
    Department,
    QuickPhraseScope,
    QuickPhraseSection,
)
from kalyan_api.schemas.quick_phrases import (
    QuickPhraseCreate,
    QuickPhraseListResponse,
    QuickPhraseOut,
    QuickPhraseUpdate,
)

router = APIRouter(prefix="/quick-phrases", tags=["quick-phrases"])

DEFAULT_PHYSIO_PHRASES: tuple[str, ...] = (
    "Low back pain radiating to leg",
    "Bilateral knee pain with crepitus",
    "Cervical stiffness & neck pain",
    "Shoulder periarthritis / frozen shoulder",
    "Sciatica nerve pain left leg",
    "Post-fracture stiffness & reduced mobility",
    "Heel pain / plantar fasciitis",
)

DEFAULT_OPHTHALMOLOGY_PHRASES: tuple[str, ...] = (
    "Blurry vision for distance & near",
    "Redness, burning sensation & itching",
    "Foreign body sensation in eye",
    "Watering of eyes & photophobia",
    "Eye strain & frontal headache",
    "Gradual decrease in vision both eyes",
)

DEFAULT_GENERAL_PHRASES: tuple[str, ...] = (
    "Fever with generalized body ache",
    "Persistent dry cough with throat pain",
    "Severe headache & vertigo",
    "Acid reflux, nausea & epigastric pain",
)

_DEFAULT_SEED_GROUPS: tuple[tuple[str | None, str, tuple[str, ...]], ...] = (
    ("PHYSIOTHERAPY", QuickPhraseSection.COMPLAINTS.value, DEFAULT_PHYSIO_PHRASES),
    ("OPHTHALMOLOGY", QuickPhraseSection.COMPLAINTS.value, DEFAULT_OPHTHALMOLOGY_PHRASES),
    (None, QuickPhraseSection.COMPLAINTS.value, DEFAULT_GENERAL_PHRASES),
)
_EXPECTED_DEFAULT_COUNT = sum(len(phrases) for _, _, phrases in _DEFAULT_SEED_GROUPS)
_DEFAULTS_SEEDED: bool = False


def _require_doctor(principal: Principal) -> int:
    """Ensure the authenticated principal is a DOCTOR with a linked doctor profile."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")
    return principal.doctor_id


def _normalize_department_code(dept: Department | None) -> str | None:
    """Normalize department code to canonical specialty keys (matching templates/specialty.ts)."""
    if dept is None:
        return None
    raw = (dept.code or "").strip().upper()
    if "PHYSIO" in raw:
        return "PHYSIOTHERAPY"
    if "OPHTHAL" in raw:
        return "OPHTHALMOLOGY"
    return raw[:32] or None


def ensure_default_quick_phrases_seeded(session: Session) -> None:
    """Idempotently seed hospital default quick phrases if not already present."""
    global _DEFAULTS_SEEDED
    if _DEFAULTS_SEEDED:
        return

    existing_count = (
        session.scalar(
            select(func.count(ClinicalQuickPhrase.id)).where(
                ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value
            )
        )
        or 0
    )
    if existing_count >= _EXPECTED_DEFAULT_COUNT:
        _DEFAULTS_SEEDED = True
        return

    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        rows = [
            {
                "scope": QuickPhraseScope.HOSPITAL_DEFAULT.value,
                "doctor_id": None,
                "department_id": None,
                "department_code": dept_code,
                "section": section,
                "phrase_text": phrase_text,
                "sort_order": idx,
                "is_active": True,
            }
            for dept_code, section, phrases in _DEFAULT_SEED_GROUPS
            for idx, phrase_text in enumerate(phrases)
        ]
        # Catch conflicts on both partial unique indexes so concurrent cold starts never fail.
        session.execute(pg_insert(ClinicalQuickPhrase).values(rows).on_conflict_do_nothing())
        _DEFAULTS_SEEDED = True
        return

    existing_rows = session.execute(
        select(
            ClinicalQuickPhrase.department_code,
            ClinicalQuickPhrase.section,
            ClinicalQuickPhrase.phrase_text,
        ).where(ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value)
    ).all()
    existing_keys = {(row[0], row[1], row[2]) for row in existing_rows}

    added = False
    for dept_code, section, phrases in _DEFAULT_SEED_GROUPS:
        for idx, phrase_text in enumerate(phrases):
            key = (dept_code, section, phrase_text)
            if key not in existing_keys:
                session.add(
                    ClinicalQuickPhrase(
                        scope=QuickPhraseScope.HOSPITAL_DEFAULT.value,
                        doctor_id=None,
                        department_id=None,
                        department_code=dept_code,
                        section=section,
                        phrase_text=phrase_text,
                        sort_order=idx,
                        is_active=True,
                    )
                )
                existing_keys.add(key)
                added = True

    if added:
        session.flush()
    _DEFAULTS_SEEDED = True


def _department_filter(department_id: int | None):
    """Build SQLAlchemy equality/IS NULL filter for personal phrase department_id."""
    if department_id is None:
        return ClinicalQuickPhrase.department_id.is_(None)
    return ClinicalQuickPhrase.department_id == department_id


@router.get(
    "",
    response_model=QuickPhraseListResponse,
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def list_quick_phrases(
    session: SessionDep,
    department_id: int | None = Query(default=None, gt=0),
    section: QuickPhraseSection = Query(default=QuickPhraseSection.COMPLAINTS),
    principal: Principal = Depends(current_principal),
) -> QuickPhraseListResponse:
    """Return hospital defaults and own personal quick phrases for a department & section."""
    doctor_id = _require_doctor(principal)
    ensure_default_quick_phrases_seeded(session)

    dept = session.get(Department, department_id) if department_id is not None else None
    dept_code = _normalize_department_code(dept)

    defaults: list[ClinicalQuickPhrase] = []
    if dept_code is not None:
        has_specialty_defaults = (
            session.scalar(
                select(ClinicalQuickPhrase.id)
                .where(
                    ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value,
                    ClinicalQuickPhrase.department_code == dept_code,
                    ClinicalQuickPhrase.is_active.is_(True),
                )
                .limit(1)
            )
            is not None
        )
        if has_specialty_defaults:
            defaults = list(
                session.scalars(
                    select(ClinicalQuickPhrase)
                    .where(
                        ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value,
                        ClinicalQuickPhrase.department_code == dept_code,
                        ClinicalQuickPhrase.section == section.value,
                        ClinicalQuickPhrase.is_active.is_(True),
                    )
                    .order_by(ClinicalQuickPhrase.sort_order.asc(), ClinicalQuickPhrase.id.asc())
                ).all()
            )
        else:
            defaults = list(
                session.scalars(
                    select(ClinicalQuickPhrase)
                    .where(
                        ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value,
                        ClinicalQuickPhrase.department_code.is_(None),
                        ClinicalQuickPhrase.section == section.value,
                        ClinicalQuickPhrase.is_active.is_(True),
                    )
                    .order_by(ClinicalQuickPhrase.sort_order.asc(), ClinicalQuickPhrase.id.asc())
                ).all()
            )
    else:
        defaults = list(
            session.scalars(
                select(ClinicalQuickPhrase)
                .where(
                    ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value,
                    ClinicalQuickPhrase.department_code.is_(None),
                    ClinicalQuickPhrase.section == section.value,
                    ClinicalQuickPhrase.is_active.is_(True),
                )
                .order_by(ClinicalQuickPhrase.sort_order.asc(), ClinicalQuickPhrase.id.asc())
            ).all()
        )

    personal = list(
        session.scalars(
            select(ClinicalQuickPhrase)
            .where(
                ClinicalQuickPhrase.scope == QuickPhraseScope.PERSONAL.value,
                ClinicalQuickPhrase.doctor_id == doctor_id,
                _department_filter(department_id),
                ClinicalQuickPhrase.section == section.value,
                ClinicalQuickPhrase.is_active.is_(True),
            )
            .order_by(ClinicalQuickPhrase.sort_order.asc(), ClinicalQuickPhrase.id.asc())
        ).all()
    )

    return QuickPhraseListResponse(
        defaults=[QuickPhraseOut.model_validate(row) for row in defaults],
        personal=[QuickPhraseOut.model_validate(row) for row in personal],
    )


@router.post(
    "",
    status_code=201,
    response_model=QuickPhraseOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def create_quick_phrase(
    payload: QuickPhraseCreate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> QuickPhraseOut:
    """Create a doctor-owned personal quick phrase."""
    doctor_id = _require_doctor(principal)

    dept_code: str | None = None
    if payload.department_id is not None:
        dept = session.get(Department, payload.department_id)
        if dept is None:
            raise ApiError(
                status_code=404,
                code="department_not_found",
                message=f"Department #{payload.department_id} not found.",
            )
        dept_code = _normalize_department_code(dept)

    existing = session.scalar(
        select(ClinicalQuickPhrase.id).where(
            ClinicalQuickPhrase.scope == QuickPhraseScope.PERSONAL.value,
            ClinicalQuickPhrase.doctor_id == doctor_id,
            _department_filter(payload.department_id),
            ClinicalQuickPhrase.section == payload.section.value,
            ClinicalQuickPhrase.is_active.is_(True),
            func.lower(ClinicalQuickPhrase.phrase_text) == payload.phrase_text.lower(),
        )
    )
    if existing is not None:
        raise ApiError(
            status_code=409,
            code="duplicate_phrase",
            message="This quick phrase already exists in this section.",
        )

    phrase = ClinicalQuickPhrase(
        scope=QuickPhraseScope.PERSONAL.value,
        doctor_id=doctor_id,
        department_id=payload.department_id,
        department_code=dept_code,
        section=payload.section.value,
        phrase_text=payload.phrase_text,
        sort_order=payload.sort_order,
        is_active=True,
    )
    session.add(phrase)
    session.flush()
    return QuickPhraseOut.model_validate(phrase)


@router.patch(
    "/{id}",
    response_model=QuickPhraseOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def update_quick_phrase(
    id: int,
    payload: QuickPhraseUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> QuickPhraseOut:
    """Update an active personal quick phrase owned by the authenticated doctor."""
    doctor_id = _require_doctor(principal)

    phrase = session.scalar(
        select(ClinicalQuickPhrase).where(
            ClinicalQuickPhrase.id == id,
            ClinicalQuickPhrase.scope == QuickPhraseScope.PERSONAL.value,
            ClinicalQuickPhrase.doctor_id == doctor_id,
            ClinicalQuickPhrase.is_active.is_(True),
        )
    )
    if phrase is None:
        raise ApiError(
            status_code=404,
            code="quick_phrase_not_found",
            message=f"Quick phrase #{id} not found.",
        )

    target_text = payload.phrase_text if payload.phrase_text is not None else phrase.phrase_text
    target_section = payload.section.value if payload.section is not None else phrase.section

    duplicate = session.scalar(
        select(ClinicalQuickPhrase.id).where(
            ClinicalQuickPhrase.id != phrase.id,
            ClinicalQuickPhrase.scope == QuickPhraseScope.PERSONAL.value,
            ClinicalQuickPhrase.doctor_id == doctor_id,
            _department_filter(phrase.department_id),
            ClinicalQuickPhrase.section == target_section,
            ClinicalQuickPhrase.is_active.is_(True),
            func.lower(ClinicalQuickPhrase.phrase_text) == target_text.lower(),
        )
    )
    if duplicate is not None:
        raise ApiError(
            status_code=409,
            code="duplicate_phrase",
            message="This quick phrase already exists in this section.",
        )

    if payload.phrase_text is not None:
        phrase.phrase_text = payload.phrase_text
    if payload.section is not None:
        phrase.section = payload.section.value
    if payload.sort_order is not None:
        phrase.sort_order = payload.sort_order
    phrase.updated_at = datetime.now(UTC)

    session.flush()
    return QuickPhraseOut.model_validate(phrase)


@router.delete(
    "/{id}",
    status_code=204,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def delete_quick_phrase(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> Response:
    """Soft-delete an active personal quick phrase owned by the authenticated doctor."""
    doctor_id = _require_doctor(principal)

    phrase = session.scalar(
        select(ClinicalQuickPhrase).where(
            ClinicalQuickPhrase.id == id,
            ClinicalQuickPhrase.scope == QuickPhraseScope.PERSONAL.value,
            ClinicalQuickPhrase.doctor_id == doctor_id,
            ClinicalQuickPhrase.is_active.is_(True),
        )
    )
    if phrase is None:
        raise ApiError(
            status_code=404,
            code="quick_phrase_not_found",
            message=f"Quick phrase #{id} not found.",
        )

    phrase.is_active = False
    phrase.updated_at = datetime.now(UTC)
    session.flush()
    return Response(status_code=204)
