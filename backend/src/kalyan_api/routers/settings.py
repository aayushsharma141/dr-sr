"""Clinic settings endpoints (SET-01).

Guarantees:
- GET /api/settings is readable by all authenticated users (ADMIN, RECEPTION, DOCTOR).
- PATCH /api/settings is restricted exclusively to ADMIN.
- Updates require version_id match and return 409 version_conflict on stale writes.
- Changing receipt_sequence_cycle after receipts were issued in the current cycle is refused
  with 409 receipt_cycle_change_requires_confirmation unless explicitly confirmed with a reason.
- Mutations are audited with complete before/after state (every mutable field) in the same
  transaction.
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
from kalyan_api.services.receipt_service import (
    current_cycle_key,
    receipts_issued_in_current_cycle,
)

router = APIRouter(prefix="/settings", tags=["settings"])

# Every mutable clinic settings column plus the optimistic-lock version (audit before/after).
_SETTINGS_AUDIT_FIELDS: tuple[str, ...] = (
    "name_en",
    "name_hi",
    "trust_name_en",
    "trust_name_hi",
    "location_line",
    "address_1",
    "address_2",
    "phone",
    "email",
    "receipt_sequence_cycle",
    "print_header_en",
    "print_header_hi",
    "print_footer_en",
    "print_footer_hi",
    "consultation_validity_days",
    "version_id",
)


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

    cycle_changed = payload.receipt_sequence_cycle != settings.receipt_sequence_cycle
    if cycle_changed:
        issued = receipts_issued_in_current_cycle(session, settings.receipt_sequence_cycle)
        if issued > 0 and not payload.confirm_receipt_cycle_change:
            raise ApiError(
                status_code=409,
                code="receipt_cycle_change_requires_confirmation",
                message=(
                    f"{issued} receipt(s) have already been issued in the current "
                    f"{settings.receipt_sequence_cycle} cycle. Changing the receipt numbering "
                    "cycle now requires explicit confirmation and a reason."
                ),
                current_cycle=settings.receipt_sequence_cycle,
                current_cycle_key=current_cycle_key(settings.receipt_sequence_cycle),
                requested_cycle=payload.receipt_sequence_cycle,
                receipts_issued=issued,
            )

    before_state = audit_service.snapshot(settings, _SETTINGS_AUDIT_FIELDS)

    settings.name_en = payload.name_en
    settings.name_hi = payload.name_hi
    if payload.trust_name_en is not None:
        settings.trust_name_en = payload.trust_name_en
    if payload.trust_name_hi is not None:
        settings.trust_name_hi = payload.trust_name_hi.strip() or None
    if payload.location_line is not None:
        settings.location_line = payload.location_line
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

    after_state = audit_service.snapshot(settings, _SETTINGS_AUDIT_FIELDS)

    reason = payload.change_reason.strip() if payload.change_reason else None

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.SETTINGS_UPDATED,
        "CLINIC_SETTINGS",
        "1",
        before=before_state,
        after=after_state,
        reason=reason or None,
    )

    return ClinicSettingsOut.model_validate(settings)
