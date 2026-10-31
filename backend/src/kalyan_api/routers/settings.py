"""Clinic settings endpoints (SET-01).

Guarantees:
- GET /api/settings is readable by all authenticated users (ADMIN, RECEPTION, DOCTOR).
- PATCH /api/settings is restricted exclusively to ADMIN.
- Updates require version_id match and return 409 version_conflict on stale writes.
- Mutations are audited with before/after state in the same transaction.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import ClinicSettings
from kalyan_api.schemas.settings import ClinicSettingsOut, ClinicSettingsUpdate
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get(
    "",
    dependencies=[Depends(require(Permission.SETTINGS_READ))],
    response_model=ClinicSettingsOut,
)
def get_clinic_settings(session: SessionDep) -> ClinicSettingsOut:
    """Retrieve current clinic configuration."""
    settings = session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))
    if not settings:
        raise ApiError(status_code=404, code="not_found", message="Clinic settings not found")
    return ClinicSettingsOut.model_validate(settings)


@router.patch(
    "",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
    response_model=ClinicSettingsOut,
)
def update_clinic_settings(
    request: Request,
    payload: ClinicSettingsUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> ClinicSettingsOut:
    """Update clinic configuration with optimistic concurrency protection."""
    settings = session.scalar(
        select(ClinicSettings).where(ClinicSettings.id == 1).with_for_update()
    )
    if not settings:
        raise ApiError(status_code=404, code="not_found", message="Clinic settings not found")

    require_version(settings, payload.version_id, "clinic_settings")

    before_state = {
        "name_en": settings.name_en,
        "name_hi": settings.name_hi,
        "receipt_sequence_cycle": settings.receipt_sequence_cycle,
        "phone": settings.phone,
        "consultation_validity_days": settings.consultation_validity_days,
        "version_id": settings.version_id,
    }

    settings.name_en = payload.name_en
    settings.name_hi = payload.name_hi
    settings.address_1 = payload.address_1
    settings.address_2 = payload.address_2
    settings.phone = payload.phone
    settings.email = payload.email
    settings.receipt_sequence_cycle = payload.receipt_sequence_cycle
    settings.print_header_en = payload.print_header_en
    settings.print_header_hi = payload.print_header_hi
    settings.print_footer_en = payload.print_footer_en
    settings.print_footer_hi = payload.print_footer_hi
    settings.consultation_validity_days = payload.consultation_validity_days

    session.flush()

    after_state = {
        "name_en": settings.name_en,
        "name_hi": settings.name_hi,
        "receipt_sequence_cycle": settings.receipt_sequence_cycle,
        "phone": settings.phone,
        "consultation_validity_days": settings.consultation_validity_days,
        "version_id": settings.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.SETTINGS_UPDATED,
        "CLINIC_SETTINGS",
        "1",
        before=before_state,
        after=after_state,
    )

    return ClinicSettingsOut.model_validate(settings)
