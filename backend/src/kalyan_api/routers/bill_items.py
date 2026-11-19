"""Bill item endpoints (Phase 22, Wave 5 & 6; OD-22-13..15, OD-22-17, MED-03..06, MED-08, MED-11, MED-12, BILL-06, BILL-18)."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemAdjustment,
    BillItemCategory,
    BillItemSource,
    ClinicalEncounter,
    ConsultationStatus,
    Patient,
    Prescription,
    PrescriptionItem,
    PrescriptionStatus,
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.schemas.bill import (
    BillLineCorrectRequest,
    BillLineCreate,
    BillLineHistoryOut,
    BillLineOut,
    BillLineVoidRequest,
    BillPaymentOut,
    BillSectionOut,
    DoctorChargesOut,
    DoctorLineCreate,
    PrescribedMedicineOut,
    VisitBillOut,
)
from kalyan_api.services import audit_service, bill_service, billing_service, booking_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["billing"])

BILL_SECTION_ORDER = ["CONSULTATION", "PROCEDURE", "PACKAGE", "MEDICINE", "ADDITIONAL"]


def _lock_item_and_visit(session: SessionDep, item_id: int) -> tuple[BillItem, Visit]:
    """Lock visit first, then bill item with_for_update to avoid lock-order deadlocks."""
    item_meta = session.execute(
        select(BillItem.id, BillItem.visit_id).where(BillItem.id == item_id)
    ).first()
    if item_meta is None:
        raise ApiError(status_code=404, code="bill_item_not_found", message="Bill item not found.")

    visit = billing_service.lock_visit(session, item_meta.visit_id)
    if visit is None:
        raise ApiError(status_code=404, code="visit_not_found", message="Visit not found.")

    line = session.scalar(
        select(BillItem).where(BillItem.id == item_id).with_for_update()
    )
    if line is None:
        raise ApiError(status_code=404, code="bill_item_not_found", message="Bill item not found.")
    return line, visit


def _build_line_out(session: SessionDep, line: BillItem, fallback_username: str | None = None) -> BillLineOut:
    """Build BillLineOut with adjustment history and username hydration."""
    history_rows = session.execute(
        select(BillItemAdjustment, User.username)
        .outerjoin(User, User.id == BillItemAdjustment.actor_user_id)
        .where(BillItemAdjustment.bill_item_id == line.id)
        .order_by(BillItemAdjustment.created_at.asc(), BillItemAdjustment.id.asc())
    ).all()
    history = [
        BillLineHistoryOut(
            id=adj.id,
            bill_item_id=adj.bill_item_id,
            kind=adj.kind,
            old_quantity=adj.old_quantity,
            new_quantity=adj.new_quantity,
            old_rate_paise=adj.old_rate_paise,
            new_rate_paise=adj.new_rate_paise,
            old_amount_paise=adj.old_amount_paise,
            new_amount_paise=adj.new_amount_paise,
            reason=adj.reason,
            actor_user_id=adj.actor_user_id,
            actor_username=u_name,
            created_at=adj.created_at,
        )
        for adj, u_name in history_rows
    ]
    created_user = session.get(User, line.created_by_user_id)
    voided_user = session.get(User, line.voided_by_user_id) if line.voided_by_user_id else None

    c_status = None
    if line.appointment_id is not None:
        appt = session.get(Appointment, line.appointment_id)
        c_status = appt.consultation_status if appt else None
    counted = billing_service.counts_toward_total(line, c_status)

    return BillLineOut(
        id=line.id,
        visit_id=line.visit_id,
        appointment_id=line.appointment_id,
        category=line.category,
        source=line.source,
        description=line.description,
        unit=line.unit,
        quantity=line.quantity,
        rate_paise=line.rate_paise,
        amount_paise=line.amount_paise,
        original_amount_paise=line.original_amount_paise,
        status=line.status,
        prescription_item_id=line.prescription_item_id,
        counts_toward_total=counted,
        created_by_user_id=line.created_by_user_id,
        created_by_username=created_user.username if created_user else fallback_username,
        created_at=line.created_at,
        history=history,
        void_reason=line.void_reason,
        voided_by_user_id=line.voided_by_user_id,
        voided_by_username=voided_user.username if voided_user else None,
        voided_at=line.voided_at,
    )


@router.post(
    "/visits/{id}/bill-items",
    response_model=BillLineOut,
    status_code=201,
    dependencies=[Depends(require(Permission.BILL_WRITE))],
)
def add_bill_item(
    id: int,
    payload: BillLineCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BillLineOut:
    """Reception adds a medicine or additional line item to an open visit."""
    visit = billing_service.lock_visit(session, id)
    if visit is None:
        raise ApiError(status_code=404, code="visit_not_found", message="Visit not found.")

    item = bill_service.add_reception_line(session, visit, principal, payload)

    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.BILL_ITEM_ADDED,
        entity_type="bill_item",
        entity_id=item.id,
        before=None,
        after={
            "line_id": item.id,
            "bill_item_id": item.id,
            "visit_id": visit.id,
            "category": item.category,
            "description": item.description,
            "quantity": str(item.quantity),
            "rate_paise": item.rate_paise,
            "rate": item.rate_paise,
            "amount_paise": item.amount_paise,
            "amount": item.amount_paise,
            "prescription_item_id": item.prescription_item_id,
        },
    )

    return BillLineOut(
        id=item.id,
        visit_id=item.visit_id,
        appointment_id=item.appointment_id,
        category=item.category,
        source=item.source,
        description=item.description,
        unit=item.unit,
        quantity=item.quantity,
        rate_paise=item.rate_paise,
        amount_paise=item.amount_paise,
        original_amount_paise=item.original_amount_paise,
        status=item.status,
        prescription_item_id=item.prescription_item_id,
        counts_toward_total=True,
        created_by_user_id=item.created_by_user_id,
        created_by_username=principal.username,
        created_at=item.created_at,
    )


@router.post(
    "/appointments/{id}/bill-items",
    response_model=BillLineOut,
    status_code=201,
    dependencies=[Depends(require(Permission.BILL_CLINICAL))],
)
def add_doctor_bill_item(
    id: int,
    payload: DoctorLineCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BillLineOut:
    """Doctor adds a procedure or package reference charge to own consultation (design §6, OD-22-14, OD-C)."""
    if principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Only doctors can do this.")

    appt_visit_id = session.scalar(
        select(Appointment.visit_id).where(Appointment.id == id)
    )
    if appt_visit_id is not None:
        billing_service.lock_visit(session, appt_visit_id)

    appt = booking_service.lock_appointment(session, id)
    if not appt or appt.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404, code="appointment_not_found", message="Appointment not found."
        )
    if appt_visit_id is not None and appt.visit_id != appt_visit_id:
        if appt.visit_id is not None:
            billing_service.lock_visit(session, appt.visit_id)

    item = bill_service.add_doctor_line(session, appt, principal, payload)

    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.BILL_ITEM_ADDED,
        entity_type="bill_item",
        entity_id=item.id,
        before=None,
        after={
            "line_id": item.id,
            "bill_item_id": item.id,
            "visit_id": item.visit_id,
            "appointment_id": item.appointment_id,
            "category": item.category,
            "description": item.description,
            "quantity": str(item.quantity),
            "rate_paise": item.rate_paise,
            "rate": item.rate_paise,
            "amount_paise": item.amount_paise,
            "amount": item.amount_paise,
            "treatment_plan_id": item.treatment_plan_id,
        },
    )

    return _build_line_out(session, item, fallback_username=principal.username)


@router.get(
    "/appointments/{id}/bill-items",
    response_model=DoctorChargesOut,
    dependencies=[Depends(require(Permission.BILL_CLINICAL))],
)
def get_doctor_bill_items(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorChargesOut:
    """Doctor reads own consultation fee with adjustment history and own charges (Q13, UI-SPEC S6).

    Strictly NO visit total, NO payments, NO reception lines.
    """
    if principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Only doctors can do this.")

    appt = session.get(Appointment, id)
    if not appt or appt.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404, code="appointment_not_found", message="Appointment not found."
        )

    items = session.execute(
        select(BillItem)
        .where(BillItem.appointment_id == appt.id)
        .order_by(BillItem.id.asc())
    ).scalars().all()

    consult_item = next(
        (i for i in items if i.category == BillItemCategory.CONSULTATION.value), None
    )
    consult_line_out = _build_line_out(session, consult_item) if consult_item else None

    doc_items = [i for i in items if i.source == BillItemSource.DOCTOR.value]
    doctor_lines_out = [_build_line_out(session, i) for i in doc_items]

    return DoctorChargesOut(
        consultation_line=consult_line_out,
        doctor_lines=doctor_lines_out,
    )



@router.get(
    "/visits/{id}/bill",
    response_model=VisitBillOut,
    dependencies=[Depends(require(Permission.VISIT_READ))],
)
def get_visit_bill(
    id: int,
    session: SessionDep,
) -> VisitBillOut:
    """Read full visit bill breakdown, grouped by OD-22-14 sections."""
    visit = session.get(Visit, id)
    if visit is None:
        raise ApiError(status_code=404, code="visit_not_found", message="Visit not found.")

    patient = session.get(Patient, visit.patient_id)
    totals = billing_service.visit_totals(session, [id])[id]

    appts = session.execute(
        select(Appointment.id, Appointment.consultation_status).where(Appointment.visit_id == id)
    ).all()
    appt_status_map = {row[0]: row[1] for row in appts}

    items = session.execute(
        select(BillItem).where(BillItem.visit_id == id).order_by(BillItem.id.asc())
    ).scalars().all()

    item_ids = [item.id for item in items]
    adjustments_by_item: dict[int, list[BillLineHistoryOut]] = {i_id: [] for i_id in item_ids}
    if item_ids:
        adj_rows = session.execute(
            select(BillItemAdjustment, User.username)
            .outerjoin(User, User.id == BillItemAdjustment.actor_user_id)
            .where(BillItemAdjustment.bill_item_id.in_(item_ids))
            .order_by(BillItemAdjustment.created_at.asc(), BillItemAdjustment.id.asc())
        ).all()
        for adj, u_name in adj_rows:
            adjustments_by_item[adj.bill_item_id].append(
                BillLineHistoryOut(
                    id=adj.id,
                    bill_item_id=adj.bill_item_id,
                    kind=adj.kind,
                    old_quantity=adj.old_quantity,
                    new_quantity=adj.new_quantity,
                    old_rate_paise=adj.old_rate_paise,
                    new_rate_paise=adj.new_rate_paise,
                    old_amount_paise=adj.old_amount_paise,
                    new_amount_paise=adj.new_amount_paise,
                    reason=adj.reason,
                    actor_user_id=adj.actor_user_id,
                    actor_username=u_name,
                    created_at=adj.created_at,
                )
            )

    user_ids = {item.created_by_user_id for item in items} | {
        item.voided_by_user_id for item in items if item.voided_by_user_id is not None
    }
    usernames_by_id: dict[int, str] = {}
    if user_ids:
        user_rows = session.execute(
            select(User.id, User.username).where(User.id.in_(user_ids))
        ).all()
        usernames_by_id = {row[0]: row[1] for row in user_rows}

    lines_by_category: dict[str, list[BillLineOut]] = {cat: [] for cat in BILL_SECTION_ORDER}
    subtotal_by_category: dict[str, int] = {cat: 0 for cat in BILL_SECTION_ORDER}
    voided_lines: list[BillLineOut] = []

    for item in items:
        history = adjustments_by_item.get(item.id, [])
        created_username = usernames_by_id.get(item.created_by_user_id)
        voided_username = (
            usernames_by_id.get(item.voided_by_user_id) if item.voided_by_user_id else None
        )

        if item.status == "VOIDED":
            voided_lines.append(
                BillLineOut(
                    id=item.id,
                    visit_id=item.visit_id,
                    appointment_id=item.appointment_id,
                    category=item.category,
                    source=item.source,
                    description=item.description,
                    unit=item.unit,
                    quantity=item.quantity,
                    rate_paise=item.rate_paise,
                    amount_paise=item.amount_paise,
                    original_amount_paise=item.original_amount_paise,
                    status=item.status,
                    prescription_item_id=item.prescription_item_id,
                    counts_toward_total=False,
                    created_by_user_id=item.created_by_user_id,
                    created_by_username=created_username,
                    created_at=item.created_at,
                    history=history,
                    void_reason=item.void_reason,
                    voided_by_user_id=item.voided_by_user_id,
                    voided_by_username=voided_username,
                    voided_at=item.voided_at,
                )
            )
        else:
            c_status = (
                appt_status_map.get(item.appointment_id)
                if item.appointment_id is not None
                else None
            )
            if item.appointment_id is not None and c_status == ConsultationStatus.CANCELLED.value:
                # Lines of CANCELLED consultations are not listed as charges (rule ii)
                continue

            counted = billing_service.counts_toward_total(item, c_status)
            line_out = BillLineOut(
                id=item.id,
                visit_id=item.visit_id,
                appointment_id=item.appointment_id,
                category=item.category,
                source=item.source,
                description=item.description,
                unit=item.unit,
                quantity=item.quantity,
                rate_paise=item.rate_paise,
                amount_paise=item.amount_paise,
                original_amount_paise=item.original_amount_paise,
                status=item.status,
                prescription_item_id=item.prescription_item_id,
                counts_toward_total=counted,
                created_by_user_id=item.created_by_user_id,
                created_by_username=created_username,
                created_at=item.created_at,
                history=history,
            )
            if item.category in lines_by_category:
                lines_by_category[item.category].append(line_out)
                if counted:
                    subtotal_by_category[item.category] += item.amount_paise

    sections = [
        BillSectionOut(
            category=cat,
            subtotal_paise=subtotal_by_category[cat],
            lines=lines_by_category[cat],
        )
        for cat in BILL_SECTION_ORDER
    ]

    payments = billing_service.visit_payments(session, id)
    payments_out = [
        BillPaymentOut(
            id=p.id,
            visit_id=p.visit_id,
            appointment_id=p.appointment_id,
            receipt_number=p.receipt_number,
            amount_paise=p.amount_paise,
            payment_method=p.payment_method,
            is_reversed=p.is_reversed,
            created_at=p.created_at,
            created_by_username=p.created_by_user.username if p.created_by_user else None,
        )
        for p in payments
    ]

    prev_dues = billing_service.patient_previous_dues(
        session, visit.patient_id, exclude_visit_id=visit.id
    )
    prev_dues_total = sum(p.balance_paise for p in prev_dues)
    packages = billing_service.patient_package_summaries(session, visit.patient_id)

    return VisitBillOut(
        visit_id=visit.id,
        patient_id=visit.patient_id,
        patient_urn=patient.urn if patient else None,
        patient_name=patient.full_name if patient else None,
        status=visit.status,
        visit_date=visit.visit_date,
        closed_at=visit.closed_at,
        close_reason=visit.close_reason,
        locked=visit.status != VisitStatus.OPEN.value,
        sections=sections,
        bill_total_paise=totals.bill_total_paise,
        paid_paise=totals.paid_paise,
        due_paise=totals.due_paise,
        payments=payments_out,
        voided_lines=voided_lines,
        previous_dues=prev_dues,
        previous_dues_total_paise=prev_dues_total,
        packages=packages,
    )


@router.post(
    "/bill-items/{id}/void",
    response_model=BillLineOut,
    dependencies=[Depends(require(Permission.BILL_WRITE))],
)
def void_bill_item(
    id: int,
    payload: BillLineVoidRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BillLineOut:
    """Reception voids its own same-day bill line (OD-G, BILL-06)."""
    line, visit = _lock_item_and_visit(session, id)
    old_amount = line.amount_paise
    line, history = bill_service.void_line(
        session, line, principal, reason=payload.reason, own_same_day_only=True
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.BILL_ITEM_VOIDED,
        entity_type="bill_item",
        entity_id=line.id,
        before={"amount_paise": old_amount, "status": "ACTIVE"},
        after={
            "line_id": line.id,
            "bill_item_id": line.id,
            "visit_id": line.visit_id,
            "category": line.category,
            "status": line.status,
            "amount_paise": 0,
            "void_reason": line.void_reason,
        },
        reason=line.void_reason,
    )
    return _build_line_out(session, line, fallback_username=principal.username)


@router.post(
    "/bill-items/{id}/admin-void",
    response_model=BillLineOut,
    dependencies=[Depends(require(Permission.BILL_ADJUST))],
)
def admin_void_bill_item(
    id: int,
    payload: BillLineVoidRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BillLineOut:
    """Admin voids any non-consultation line on an open visit (owner decision (v))."""
    line, visit = _lock_item_and_visit(session, id)
    old_amount = line.amount_paise
    line, history = bill_service.void_line(
        session, line, principal, reason=payload.reason, own_same_day_only=False
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.BILL_ITEM_VOIDED,
        entity_type="bill_item",
        entity_id=line.id,
        before={"amount_paise": old_amount, "status": "ACTIVE"},
        after={
            "line_id": line.id,
            "bill_item_id": line.id,
            "visit_id": line.visit_id,
            "category": line.category,
            "status": line.status,
            "amount_paise": 0,
            "void_reason": line.void_reason,
        },
        reason=line.void_reason,
    )
    return _build_line_out(session, line, fallback_username=principal.username)


@router.post(
    "/bill-items/{id}/correct",
    response_model=BillLineOut,
    dependencies=[Depends(require(Permission.BILL_WRITE))],
)
def correct_bill_item(
    id: int,
    payload: BillLineCorrectRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BillLineOut:
    """Reception corrects quantity/rate of own same-day bill line (MED-11)."""
    line, visit = _lock_item_and_visit(session, id)
    old_quantity = str(line.quantity)
    old_rate = line.rate_paise
    old_amount = line.amount_paise

    line, history = bill_service.correct_line(
        session,
        line,
        principal,
        quantity=payload.quantity,
        rate_paise=payload.rate_paise,
        reason=payload.reason,
        own_same_day_only=True,
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.BILL_ITEM_ADJUSTED,
        entity_type="bill_item",
        entity_id=line.id,
        before={
            "quantity": old_quantity,
            "rate_paise": old_rate,
            "amount_paise": old_amount,
        },
        after={
            "line_id": line.id,
            "bill_item_id": line.id,
            "visit_id": line.visit_id,
            "category": line.category,
            "quantity": str(line.quantity),
            "rate_paise": line.rate_paise,
            "amount_paise": line.amount_paise,
            "reason": history.reason,
        },
        reason=history.reason,
    )
    return _build_line_out(session, line, fallback_username=principal.username)


@router.post(
    "/bill-items/{id}/admin-correct",
    response_model=BillLineOut,
    dependencies=[Depends(require(Permission.BILL_ADJUST))],
)
def admin_correct_bill_item(
    id: int,
    payload: BillLineCorrectRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> BillLineOut:
    """Admin corrects quantity/rate of any non-consultation line on open visit (owner decision (v))."""
    line, visit = _lock_item_and_visit(session, id)
    old_quantity = str(line.quantity)
    old_rate = line.rate_paise
    old_amount = line.amount_paise

    line, history = bill_service.correct_line(
        session,
        line,
        principal,
        quantity=payload.quantity,
        rate_paise=payload.rate_paise,
        reason=payload.reason,
        own_same_day_only=False,
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.BILL_ITEM_ADJUSTED,
        entity_type="bill_item",
        entity_id=line.id,
        before={
            "quantity": old_quantity,
            "rate_paise": old_rate,
            "amount_paise": old_amount,
        },
        after={
            "line_id": line.id,
            "bill_item_id": line.id,
            "visit_id": line.visit_id,
            "category": line.category,
            "quantity": str(line.quantity),
            "rate_paise": line.rate_paise,
            "amount_paise": line.amount_paise,
            "reason": history.reason,
        },
        reason=history.reason,
    )
    return _build_line_out(session, line, fallback_username=principal.username)


@router.get(
    "/visits/{id}/prescribed-medicines",
    response_model=list[PrescribedMedicineOut],
    dependencies=[Depends(require(Permission.BILL_WRITE))],
)
def get_prescribed_medicines(
    id: int,
    session: SessionDep,
) -> list[PrescribedMedicineOut]:
    """Reception reads prescribed medicine references for billing (OD-B, B2, D-04).

    Strictly projected to prescription_item_id, medicine_name, and form.
    Only items from AUTHORISED prescriptions on this visit's consultations are returned.
    """
    visit = session.get(Visit, id)
    if visit is None:
        raise ApiError(status_code=404, code="visit_not_found", message="Visit not found.")

    query = (
        select(
            PrescriptionItem.id.label("prescription_item_id"),
            PrescriptionItem.medicine_name,
            PrescriptionItem.form,
        )
        .join(Prescription, Prescription.id == PrescriptionItem.prescription_id)
        .join(ClinicalEncounter, ClinicalEncounter.id == Prescription.encounter_id)
        .join(Appointment, Appointment.id == ClinicalEncounter.appointment_id)
        .where(
            Appointment.visit_id == id,
            Prescription.status == PrescriptionStatus.AUTHORISED.value,
        )
        .order_by(Prescription.id.asc(), PrescriptionItem.item_order.asc(), PrescriptionItem.id.asc())
    )
    rows = session.execute(query).all()
    return [
        PrescribedMedicineOut(
            prescription_item_id=r.prescription_item_id,
            medicine_name=r.medicine_name,
            form=r.form,
        )
        for r in rows
    ]
