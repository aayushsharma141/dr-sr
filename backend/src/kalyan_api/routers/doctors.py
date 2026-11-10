"""Doctor profile management and consultation fee schedule endpoints (SET-02, SET-03)."""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select

from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import ConsultationFee, Doctor
from kalyan_api.schemas.doctors import (
    DoctorCreate,
    DoctorMeSettingsUpdate,
    DoctorOut,
    DoctorUpdate,
    FeeCreate,
    FeeOut,
    FeeUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["doctors", "fees"])

# Every mutable consultation fee column plus the optimistic-lock version (audit before/after).
_FEE_AUDIT_FIELDS: tuple[str, ...] = ("name", "fee_paise", "is_active", "version_id")


# ==============================================================================
# DOCTORS (SET-02)
# ==============================================================================


@router.get(
    "/doctors",
    dependencies=[Depends(require(Permission.DOCTOR_READ))],
    response_model=list[DoctorOut],
)
def list_doctors(
    session: SessionDep,
    include_inactive: bool = Query(default=False),
    principal: Principal = Depends(current_principal),
) -> list[DoctorOut]:
    """List doctor profiles. Non-admin roles see only active doctors."""
    query = select(Doctor).order_by(Doctor.name_en)
    # Only Admin may see retired doctors; otherwise any DOCTOR_READ user could list them.
    if not include_inactive or principal.role != Role.ADMIN:
        query = query.where(Doctor.is_active.is_(True))
    docs = session.scalars(query).all()
    return [DoctorOut.model_validate(d) for d in docs]


@router.post(
    "/doctors",
    status_code=201,
    dependencies=[Depends(require(Permission.DOCTOR_MANAGE))],
    response_model=DoctorOut,
)
def create_doctor(
    request: Request,
    payload: DoctorCreate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorOut:
    """Create a new doctor profile (ADMIN only)."""
    if payload.cabin_code:
        clash = session.scalar(
            select(Doctor).where(Doctor.cabin_code == payload.cabin_code, Doctor.is_active.is_(True))
        )
        if clash:
            raise ApiError(
                status_code=409,
                code="cabin_code_taken",
                message=f"Cabin code '{payload.cabin_code}' is already assigned to active doctor Dr. {clash.name_en}",
            )

    doc = Doctor(
        name_en=payload.name_en,
        name_hi=payload.name_hi,
        qualification=payload.qualification,
        registration_number=payload.registration_number,
        cabin_code=payload.cabin_code,
        default_fee_paise=payload.default_fee_paise,
    )
    session.add(doc)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.DOCTOR_CREATED,
        "DOCTOR",
        str(doc.id),
        after={
            "name_en": doc.name_en,
            "registration_number": doc.registration_number,
            "cabin_code": doc.cabin_code,
            "default_fee_paise": doc.default_fee_paise,
        },
    )

    return DoctorOut.model_validate(doc)


@router.patch(
    "/doctors/me/settings",
    dependencies=[Depends(require(Permission.DOCTOR_SETTINGS_WRITE))],
    response_model=DoctorOut,
)
def update_doctor_me_settings(
    request: Request,
    payload: DoctorMeSettingsUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorOut:
    """Update consultation fee for the authenticated doctor."""
    if not principal.doctor_id:
        raise ApiError(
            status_code=403,
            code="doctor_required",
            message="Authenticated user is not linked to a doctor profile",
        )

    doc = session.scalar(select(Doctor).where(Doctor.id == principal.doctor_id).with_for_update())
    if not doc:
        raise ApiError(
            status_code=404,
            code="not_found",
            message=f"Doctor #{principal.doctor_id} not found",
        )

    require_version(doc, payload.version_id, "doctor")

    before_state = {
        "default_fee_paise": doc.default_fee_paise,
        "version_id": doc.version_id,
    }

    doc.default_fee_paise = payload.default_fee_paise
    session.flush()

    after_state = {
        "default_fee_paise": doc.default_fee_paise,
        "version_id": doc.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.DOCTOR_SETTINGS_UPDATED,
        "DOCTOR",
        str(doc.id),
        before=before_state,
        after=after_state,
    )

    return DoctorOut.model_validate(doc)


@router.patch(
    "/doctors/{id}",
    dependencies=[Depends(require(Permission.DOCTOR_MANAGE))],
    response_model=DoctorOut,
)
def update_doctor(
    id: int,
    request: Request,
    payload: DoctorUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorOut:
    """Update doctor profile with optimistic concurrency control."""
    doc = session.scalar(select(Doctor).where(Doctor.id == id).with_for_update())
    if not doc:
        raise ApiError(status_code=404, code="not_found", message=f"Doctor #{id} not found")

    require_version(doc, payload.version_id, "doctor")

    if payload.cabin_code and payload.is_active:
        clash = session.scalar(
            select(Doctor).where(
                Doctor.cabin_code == payload.cabin_code,
                Doctor.is_active.is_(True),
                Doctor.id != id,
            )
        )
        if clash:
            raise ApiError(
                status_code=409,
                code="cabin_code_taken",
                message=f"Cabin code '{payload.cabin_code}' is already assigned to active doctor Dr. {clash.name_en}",
            )

    before_state = {
        "name_en": doc.name_en,
        "name_hi": doc.name_hi,
        "qualification": doc.qualification,
        "registration_number": doc.registration_number,
        "cabin_code": doc.cabin_code,
        "default_fee_paise": doc.default_fee_paise,
        "is_active": doc.is_active,
        "version_id": doc.version_id,
    }

    doc.name_en = payload.name_en
    doc.name_hi = payload.name_hi
    doc.qualification = payload.qualification
    doc.registration_number = payload.registration_number
    doc.cabin_code = payload.cabin_code
    doc.default_fee_paise = payload.default_fee_paise
    doc.is_active = payload.is_active

    session.flush()

    after_state = {
        "name_en": doc.name_en,
        "name_hi": doc.name_hi,
        "qualification": doc.qualification,
        "registration_number": doc.registration_number,
        "cabin_code": doc.cabin_code,
        "default_fee_paise": doc.default_fee_paise,
        "is_active": doc.is_active,
        "version_id": doc.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.DOCTOR_UPDATED,
        "DOCTOR",
        str(doc.id),
        before=before_state,
        after=after_state,
    )

    return DoctorOut.model_validate(doc)


# ==============================================================================
# CONSULTATION FEES (SET-03)
# ==============================================================================


@router.get(
    "/fees",
    dependencies=[Depends(require(Permission.FEE_READ))],
    response_model=list[FeeOut],
)
def list_fees(
    session: SessionDep,
    include_inactive: bool = Query(default=False),
) -> list[FeeOut]:
    """List consultation fee schedules; deactivated ones only when include_inactive is set."""
    query = select(ConsultationFee).order_by(ConsultationFee.id)
    if not include_inactive:
        query = query.where(ConsultationFee.is_active.is_(True))
    fees = session.scalars(query).all()
    return [FeeOut.model_validate(f) for f in fees]


@router.post(
    "/fees",
    status_code=201,
    dependencies=[Depends(require(Permission.FEE_MANAGE))],
    response_model=FeeOut,
)
def create_fee(
    request: Request,
    payload: FeeCreate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> FeeOut:
    """Create a new fee rate in paise (ADMIN only)."""
    fee = ConsultationFee(
        name=payload.name,
        fee_paise=payload.fee_paise,
    )
    session.add(fee)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.FEE_CREATED,
        "FEE",
        str(fee.id),
        after=audit_service.snapshot(fee, _FEE_AUDIT_FIELDS),
    )

    return FeeOut.model_validate(fee)


@router.patch(
    "/fees/{id}",
    dependencies=[Depends(require(Permission.FEE_MANAGE))],
    response_model=FeeOut,
)
def update_fee(
    id: int,
    request: Request,
    payload: FeeUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> FeeOut:
    """Modify a consultation fee rate with optimistic concurrency control (SEC-06)."""
    fee = session.scalar(select(ConsultationFee).where(ConsultationFee.id == id).with_for_update())
    if not fee:
        raise ApiError(status_code=404, code="not_found", message=f"Fee rate #{id} not found")

    require_version(fee, payload.version_id, "consultation_fee")

    before_state = audit_service.snapshot(fee, _FEE_AUDIT_FIELDS)
    fee.name = payload.name
    fee.fee_paise = payload.fee_paise
    fee.is_active = payload.is_active

    session.flush()

    after_state = audit_service.snapshot(fee, _FEE_AUDIT_FIELDS)
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.FEE_UPDATED,
        "FEE",
        str(fee.id),
        before=before_state,
        after=after_state,
    )

    return FeeOut.model_validate(fee)
