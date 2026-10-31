"""Doctor profile management and consultation fee schedule endpoints (SET-02, SET-03)."""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select

from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import ConsultationFee, Doctor
from kalyan_api.schemas.doctors import (
    DoctorCreate,
    DoctorOut,
    DoctorUpdate,
    FeeCreate,
    FeeOut,
    FeeUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["doctors", "fees"])


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
) -> list[DoctorOut]:
    """List doctor profiles. Non-admin roles see only active doctors."""
    query = select(Doctor).order_by(Doctor.name_en)
    if not include_inactive:
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
    doc = Doctor(
        name_en=payload.name_en,
        name_hi=payload.name_hi,
        qualification=payload.qualification,
        registration_number=payload.registration_number,
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
            "default_fee_paise": doc.default_fee_paise,
        },
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

    before_state = {
        "name_en": doc.name_en,
        "name_hi": doc.name_hi,
        "qualification": doc.qualification,
        "registration_number": doc.registration_number,
        "default_fee_paise": doc.default_fee_paise,
        "is_active": doc.is_active,
        "version_id": doc.version_id,
    }

    doc.name_en = payload.name_en
    doc.name_hi = payload.name_hi
    doc.qualification = payload.qualification
    doc.registration_number = payload.registration_number
    doc.default_fee_paise = payload.default_fee_paise
    doc.is_active = payload.is_active

    session.flush()

    after_state = {
        "name_en": doc.name_en,
        "name_hi": doc.name_hi,
        "qualification": doc.qualification,
        "registration_number": doc.registration_number,
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
def list_fees(session: SessionDep) -> list[FeeOut]:
    """List available consultation fee schedules."""
    fees = session.scalars(
        select(ConsultationFee)
        .where(ConsultationFee.is_active.is_(True))
        .order_by(ConsultationFee.id)
    ).all()
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
        after={"name": fee.name, "fee_paise": fee.fee_paise},
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
    """Modify a consultation fee rate."""
    fee = session.scalar(select(ConsultationFee).where(ConsultationFee.id == id))
    if not fee:
        raise ApiError(status_code=404, code="not_found", message=f"Fee rate #{id} not found")

    before_state = {"name": fee.name, "fee_paise": fee.fee_paise, "is_active": fee.is_active}
    fee.name = payload.name
    fee.fee_paise = payload.fee_paise
    fee.is_active = payload.is_active

    session.flush()

    after_state = {"name": fee.name, "fee_paise": fee.fee_paise, "is_active": fee.is_active}
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
