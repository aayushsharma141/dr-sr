"""Unified Patient Timeline endpoint (CLN-03, Phase 15).

Aggregates all clinical, scheduling, therapy, and billing activity for a patient
into a single chronological descending ledger.

Doctor silo (D-03):
- Doctors can only see their own clinical encounters and prescriptions.
- Doctors CAN see patient appointments, treatment plans, therapy sessions, and billing history.
- Receptionists can see appointments, treatment plans, sessions, and billing history.
  Clinical notes and prescriptions are omitted or filtered unless granted.
- Admin can see the complete timeline across all departments.
"""

import re

from fastapi import APIRouter, Depends
from sqlalchemy import false, select, true
from sqlalchemy.orm import selectinload

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, current_principal
from kalyan_api.core.scope import ScopeFamily, other_doctors_record_ids, row_scope
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    Appointment,
    ClinicalEncounter,
    Patient,
    Payment,
    Prescription,
    TreatmentPlan,
    TreatmentSession,
)
from kalyan_api.schemas.timeline import TimelineItemOut
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["timeline"])

_DOCTOR_TITLE = re.compile(r"dr(\.\s*|\s+)", re.IGNORECASE)


def _doctor_title(name: str) -> str:
    """Return the name with one "Dr." title; staff often type it into the stored name."""
    return name if _DOCTOR_TITLE.match(name) else f"Dr. {name}"


@router.get(
    "/patients/{patient_id}/timeline",
    response_model=list[TimelineItemOut],
    dependencies=[Depends(require(Permission.TIMELINE_READ))],
)
def get_patient_timeline(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[TimelineItemOut]:
    """Retrieve unified chronological timeline for a patient (CLN-03)."""
    patient = session.get(Patient, patient_id)
    if not patient or not patient.is_active:
        raise ApiError(
            status_code=404, code="patient_not_found", message="Active patient not found."
        )

    items: list[TimelineItemOut] = []

    # 1. Appointments
    appt_stmt = (
        select(Appointment)
        .where(Appointment.patient_id == patient_id)
        .options(selectinload(Appointment.doctor))
    )
    if principal.role == Role.DOCTOR:
        # Same rule as GET /appointments and GET /appointments/{id}: a doctor sees only their own
        # appointments. Other doctors' clinical rows below follow the audited read-all policy.
        appt_stmt = appt_stmt.where(
            Appointment.doctor_id == principal.doctor_id
            if principal.doctor_id is not None
            else false()
        )
    appointments = session.execute(appt_stmt).scalars().all()
    for appt in appointments:
        doc_name = appt.doctor.name_en if appt.doctor else "Doctor"
        items.append(
            TimelineItemOut(
                id=f"APPOINTMENT-{appt.id}",
                event_type="APPOINTMENT",
                event_date=appt.created_at,
                title=f"Token #{appt.token_number}: Appointment with {_doctor_title(doc_name)}",
                subtitle=f"Status: {appt.status}",
                summary=appt.notes,
                badge=appt.status,
                badge_variant="outline",
                metadata={
                    "appointment_id": appt.id,
                    "token_number": appt.token_number,
                    "status": appt.status,
                    "doctor_name": doc_name,
                },
            )
        )

    # Clinical content is doctor-only (D-04). ADMIN and RECEPTION get no encounters,
    # prescriptions, diagnoses or VAS/modality detail (BR-002). Doctors see rows within
    # their CLINICAL_READ scope (DWS-04).
    can_see_clinical = principal.role == Role.DOCTOR

    # 2. Clinical Encounters
    if can_see_clinical:
        enc_scope = row_scope(principal, ScopeFamily.CLINICAL_READ, ClinicalEncounter.doctor_id)
        enc_stmt = (
            select(ClinicalEncounter)
            .where(ClinicalEncounter.patient_id == patient_id, enc_scope)
            .options(
                selectinload(ClinicalEncounter.doctor),
                selectinload(ClinicalEncounter.addenda),
            )
        )
        encounters = session.execute(enc_stmt).scalars().all()
        for enc in encounters:
            doc_name = enc.doctor.name_en if enc.doctor else "Doctor"
            badge_text = "FINALIZED" if enc.is_finalised else "DRAFT"
            badge_var = "default" if enc.is_finalised else "secondary"
            summary_parts = []
            if enc.diagnosis:
                summary_parts.append(f"Diagnosis: {enc.diagnosis}")
            if enc.symptoms:
                summary_parts.append(f"Symptoms: {enc.symptoms}")
            if len(enc.addenda) > 0:
                summary_parts.append(f"Addenda: {len(enc.addenda)} entry(s)")

            items.append(
                TimelineItemOut(
                    id=f"ENCOUNTER-{enc.id}",
                    event_type="ENCOUNTER",
                    event_date=enc.encounter_date,
                    title=f"Clinical Consultation with {_doctor_title(doc_name)}",
                    subtitle=_doctor_title(doc_name),
                    summary=" | ".join(summary_parts) if summary_parts else None,
                    badge=badge_text,
                    badge_variant=badge_var,
                    metadata={
                        "encounter_id": enc.id,
                        "is_finalised": enc.is_finalised,
                        "diagnosis": enc.diagnosis,
                        "addenda_count": len(enc.addenda),
                    },
                )
            )

    # 3. Prescriptions
    if can_see_clinical:
        rx_scope = row_scope(principal, ScopeFamily.CLINICAL_READ, Prescription.doctor_id)
        rx_stmt = (
            select(Prescription)
            .where(Prescription.patient_id == patient_id, rx_scope)
            .options(
                selectinload(Prescription.doctor),
                selectinload(Prescription.items),
            )
        )
        prescriptions = session.execute(rx_stmt).scalars().all()
        for rx in prescriptions:
            doc_name = rx.doctor.name_en if rx.doctor else "Doctor"
            items_summary = ", ".join(f"{it.medicine_name} ({it.dosage})" for it in rx.items[:3])
            if len(rx.items) > 3:
                items_summary += f", +{len(rx.items) - 3} more"

            items.append(
                TimelineItemOut(
                    id=f"PRESCRIPTION-{rx.id}",
                    event_type="PRESCRIPTION",
                    event_date=rx.created_at,
                    title=f"Prescription by {_doctor_title(doc_name)}",
                    subtitle=f"Rx #{rx.id} · {len(rx.items)} medication(s)",
                    summary=items_summary or rx.diagnosis,
                    badge="ACTIVE",
                    badge_variant="default",
                    metadata={
                        "prescription_id": rx.id,
                        "items_count": len(rx.items),
                        "diagnosis": rx.diagnosis,
                    },
                )
            )

    # 4. Treatment Plans
    can_see_billing = Permission.PAYMENT_READ in principal.permissions
    plan_stmt = (
        select(TreatmentPlan)
        .where(TreatmentPlan.patient_id == patient_id)
        .options(selectinload(TreatmentPlan.doctor))
    )
    plans = session.execute(plan_stmt).scalars().all()
    for plan in plans:
        doc_name = plan.doctor.name_en if plan.doctor else "Doctor"
        price_rupees = plan.agreed_price_paise / 100 if can_see_billing else None
        subtitle_parts = [_doctor_title(doc_name)]
        if price_rupees is not None:
            subtitle_parts.append(f"₹{price_rupees:,.2f}")

        plan_meta = {
            "treatment_plan_id": plan.id,
            "plan_name": plan.plan_name,
            "status": plan.status,
            "total_sessions": plan.total_sessions,
            "completed_sessions": plan.completed_sessions,
        }
        if can_see_billing:
            plan_meta["agreed_price_paise"] = plan.agreed_price_paise

        items.append(
            TimelineItemOut(
                id=f"TREATMENT_PLAN-{plan.id}",
                event_type="TREATMENT_PLAN",
                event_date=plan.created_at,
                title=f"Package: {plan.plan_name}",
                subtitle=" · ".join(subtitle_parts),
                summary=(
                    (
                        f"Diagnosis: {plan.condition_diagnosis or 'N/A'} | "
                        f"Sessions: {plan.completed_sessions}/{plan.total_sessions}"
                    )
                    if can_see_clinical
                    else f"Sessions: {plan.completed_sessions}/{plan.total_sessions}"
                ),
                badge=plan.status,
                badge_variant="default" if plan.status == "ACTIVE" else "outline",
                metadata=plan_meta,
            )
        )

    # 5. Treatment Sessions
    sess_scope = (
        true()
        if principal.role in (Role.ADMIN, Role.RECEPTION)
        else row_scope(principal, ScopeFamily.CLINICAL_READ, TreatmentSession.doctor_id)
    )
    sess_stmt = (
        select(TreatmentSession)
        .where(TreatmentSession.patient_id == patient_id, sess_scope)
        .options(
            selectinload(TreatmentSession.treatment_plan),
            selectinload(TreatmentSession.doctor),
        )
    )
    sessions = session.execute(sess_stmt).scalars().all()
    for sess in sessions:
        doc_name = sess.doctor.name_en if sess.doctor else "Doctor"
        plan_name = sess.treatment_plan.plan_name if sess.treatment_plan else "Physiotherapy"
        doctor_label = _doctor_title(doc_name)
        # Attendance (date, number, doctor) is administrative; VAS and modalities are clinical.
        vas_score = sess.vas_score if can_see_clinical else None
        if can_see_clinical:
            summary_txt = f"Doctor: {doctor_label} | Modalities: {sess.modalities or 'Standard'}"
            if vas_score is not None:
                summary_txt += f" | VAS: {vas_score}/10"
        else:
            summary_txt = f"Doctor: {doctor_label}"

        items.append(
            TimelineItemOut(
                id=f"TREATMENT_SESSION-{sess.id}",
                event_type="TREATMENT_SESSION",
                event_date=sess.created_at,
                title=f"Session #{sess.session_number}: {plan_name}",
                subtitle=_doctor_title(doc_name),
                summary=summary_txt,
                badge="COMPLETED" if sess.is_finalised else "LOGGED",
                badge_variant="default",
                metadata={
                    "session_id": sess.id,
                    "treatment_plan_id": sess.treatment_plan_id,
                    "session_number": sess.session_number,
                    "vas_score": vas_score,
                },
            )
        )

    # BR-010 / DWS-04: a doctor reading other doctors' clinical rows through the timeline
    # must leave an audit trail, as a direct read does (core/scope.get_scoped_or_404).
    # One summary row per timeline read, written after every section is loaded.
    def _audit_cross_doctor_reads() -> None:
        if not can_see_clinical:
            return
        ids = {
            "encounter_ids": other_doctors_record_ids(principal, encounters),
            "prescription_ids": other_doctors_record_ids(principal, prescriptions),
            "treatment_plan_ids": other_doctors_record_ids(principal, plans),
            "session_ids": other_doctors_record_ids(principal, sessions),
        }
        if not any(ids.values()):
            return
        audit_service.record_audit_event(
            session,
            actor_user_id=principal.user_id,
            action=AuditAction.CROSS_DOCTOR_CLINICAL_READ,
            entity_type="Patient",
            entity_id=patient_id,
            details={
                "source": "patient_timeline",
                "actor_doctor_id": principal.doctor_id,
                **ids,
            },
            actor_username=principal.username,
            actor_role=Role.DOCTOR.value,
        )

    _audit_cross_doctor_reads()

    # 6. Payments and Reversals (only roles with PAYMENT_READ; barred from DOCTOR)
    if can_see_billing:
        pay_stmt = (
            select(Payment)
            .where(Payment.patient_id == patient_id)
            .options(
                selectinload(Payment.treatment_plan),
                selectinload(Payment.created_by_user),
                selectinload(Payment.reversed_by_user),
            )
        )
        payments = session.execute(pay_stmt).scalars().all()
        for pay in payments:
            amount_rupees = pay.amount_paise / 100
            cashier = pay.created_by_user.username if pay.created_by_user else "Staff"
            status_badge = "REVERSED" if pay.is_reversed else "PAID"
            badge_var = "destructive" if pay.is_reversed else "default"
            subtitle_txt = f"Receipt: {pay.receipt_number} · Method: {pay.payment_method}"
            if pay.treatment_plan:
                subtitle_txt += f" · Package: {pay.treatment_plan.plan_name}"

            summary_txt = f"Collected by @{cashier}"
            if pay.is_reversed:
                summary_txt += (
                    f" | REVERSED: '{pay.reversal_reason}' by @{pay.reversed_by_user.username}"
                    if pay.reversed_by_user
                    else f" | REVERSED: '{pay.reversal_reason}'"
                )

            items.append(
                TimelineItemOut(
                    id=f"PAYMENT-{pay.id}",
                    event_type="PAYMENT",
                    event_date=pay.created_at,
                    title=f"Payment Received: ₹{amount_rupees:,.2f}",
                    subtitle=subtitle_txt,
                    summary=summary_txt,
                    badge=status_badge,
                    badge_variant=badge_var,
                    metadata={
                        "payment_id": pay.id,
                        "receipt_number": pay.receipt_number,
                        "amount_paise": pay.amount_paise,
                        "payment_method": pay.payment_method,
                        "is_reversed": pay.is_reversed,
                        "reversal_reason": pay.reversal_reason,
                    },
                )
            )

    # Sort chronological descending by event_date
    items.sort(key=lambda it: it.event_date, reverse=True)
    return items
