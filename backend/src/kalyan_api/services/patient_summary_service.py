"""Role-redacted Patient Workspace summary and visit history queries (T1.4).

Guarantees:
- Reads succeed on archived and merged patients (404 only when patient_id does not exist).
- Consolidates downward merged aliases via effective_patient_ids(session, patient_id).
- Strict D-04 enforcement: never queries clinical_encounters or prescriptions when
  principal.role != DOCTOR; never queries patient_allergies for ADMIN; RECEPTION receives
  only safety-alert allergy labels (never reaction or clinical_notes).
- Strict AGENTS.md #7 enforcement: DOCTOR never queries or receives financial totals.
- Cross-doctor clinical reads are audited via audit_cross_doctor_list_read (DWS-04).
- All aggregates use batched SQL queries (zero N+1 waterfalls) and reuse Phase 22
  billing_service.visit_totals rules so financial KPIs match checkout screens.
"""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Role
from kalyan_api.core.principal import Principal
from kalyan_api.core.scope import ScopeFamily, audit_cross_doctor_list_read, row_scope
from kalyan_api.models import (
    AllergySeverity,
    AllergyStatus,
    Appointment,
    BillItem,
    BillItemCategory,
    BillItemSource,
    ClinicalAddendum,
    ClinicalEncounter,
    ClinicalTemplateResponse,
    ClinicalTemplateVersion,
    ConditionStatus,
    ConsultationStatus,
    Department,
    Doctor,
    EncounterDiagnosis,
    FollowUpRecommendation,
    InvestigationOrder,
    InvestigationResult,
    Patient,
    PatientAllergy,
    PatientCondition,
    Prescription,
    PrescriptionStatus,
    Refund,
    TreatmentPlan,
    TreatmentPlanStatus,
    Visit,
)
from kalyan_api.schemas.bill import BillPaymentOut
from kalyan_api.schemas.clinical_diagnoses import EncounterDiagnosisOut
from kalyan_api.schemas.encounters import AddendumRead
from kalyan_api.schemas.follow_up import DoctorFollowUpResponse
from kalyan_api.schemas.investigations import InvestigationOrderOut, InvestigationResultOut
from kalyan_api.schemas.ledger import RefundOut
from kalyan_api.schemas.patient_workspace import (
    AllergySafetyAlertOut,
    EncounterLinkBrief,
    LatestEncounterBrief,
    LatestVisitBrief,
    PatientSummaryOut,
    PatientVisitHistoryItem,
    PatientVisitHistoryResponse,
    VisitWorkspaceConsultationOut,
    VisitWorkspaceFinancialSummaryOut,
    VisitWorkspaceOut,
    VisitWorkspacePatientStrip,
    VisitWorkspaceVisitMeta,
    WorkspaceAllergyOut,
    WorkspaceClinicalChargeOut,
    WorkspaceTemplateSummaryOut,
)
from kalyan_api.schemas.patients import compute_age_years
from kalyan_api.schemas.prescriptions import PrescriptionItemOut, PrescriptionOut
from kalyan_api.schemas.treatment_plans import TreatmentPlanOut
from kalyan_api.schemas.vitals import VitalObservationResponse
from kalyan_api.services import billing_service, ledger_service
from kalyan_api.services.code_sequence_service import effective_patient_ids

_ALLERGY_SEVERITY_RANK: dict[str, int] = {
    AllergySeverity.MILD.value: 1,
    AllergySeverity.MODERATE.value: 2,
    AllergySeverity.SEVERE.value: 3,
    AllergySeverity.LIFE_THREATENING.value: 4,
}


@dataclass
class _VisitApptMeta:
    """Aggregated appointment metadata for one visit."""

    token_numbers: list[int] = field(default_factory=list)
    doctors: list[str] = field(default_factory=list)
    departments: list[str] = field(default_factory=list)
    consultation_count: int = 0
    completed_consultations: int = 0


def _role_value(principal: Principal) -> str:
    return principal.role.value if hasattr(principal.role, "value") else str(principal.role)


def _get_patient_or_404(session: Session, patient_id: int) -> Patient:
    """Load patient by ID (including archived/merged records); 404 only if ID is absent."""
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found.",
        )
    return patient


def _batch_visit_appointment_meta(
    session: Session, visit_ids: Sequence[int]
) -> dict[int, _VisitApptMeta]:
    """Load token numbers, doctors, departments, and consultation counts in one SQL query."""
    meta_by_visit: dict[int, _VisitApptMeta] = {v_id: _VisitApptMeta() for v_id in visit_ids}
    if not visit_ids:
        return meta_by_visit

    rows = session.execute(
        select(
            Appointment.visit_id,
            Appointment.token_number,
            Appointment.consultation_status,
            Doctor.name_en,
            Department.name_en,
        )
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .outerjoin(Department, Department.id == Appointment.department_id)
        .where(Appointment.visit_id.in_(visit_ids))
        .order_by(Appointment.id.asc())
    ).all()

    for visit_id, token_number, c_status, doctor_name, dept_name in rows:
        if visit_id is None or visit_id not in meta_by_visit:
            continue
        meta = meta_by_visit[visit_id]
        meta.consultation_count += 1
        if c_status == ConsultationStatus.COMPLETED.value:
            meta.completed_consultations += 1
        if c_status != ConsultationStatus.CANCELLED.value and token_number is not None:
            meta.token_numbers.append(token_number)
        if doctor_name and doctor_name not in meta.doctors:
            meta.doctors.append(doctor_name)
        if dept_name and dept_name not in meta.departments:
            meta.departments.append(dept_name)

    return meta_by_visit


def _payment_status(bill_total_paise: int, paid_paise: int, due_paise: int) -> str:
    """Classify a visit's payment state for ADMIN/RECEPTION history rows."""
    if bill_total_paise <= 0:
        return "NO_CHARGES"
    if due_paise <= 0:
        return "PAID"
    if paid_paise > 0:
        return "PARTIAL"
    return "UNPAID"


def _build_allergy_alert_from_pairs(pairs: list[tuple[str, str]]) -> AllergySafetyAlertOut:
    """Build safety-only alert from already-sorted (substance, severity) pairs."""
    if not pairs:
        return AllergySafetyAlertOut(
            has_allergies=False,
            count=0,
            highest_severity=None,
            alert_labels=[],
        )
    return AllergySafetyAlertOut(
        has_allergies=True,
        count=len(pairs),
        highest_severity=pairs[0][1],
        alert_labels=[substance for substance, _ in pairs],
    )


def _load_patient_financial_kpis(
    session: Session, patient_ids: list[int], all_visit_ids: list[int]
) -> tuple[int, int, int, int]:
    """Compute (total_billed, total_paid, total_refunded, outstanding) in paise.

    Matches Phase 22 billing_service.visit_totals (counts_toward_total + net refund-adjusted
    payments) plus ACTIVE/COMPLETED treatment package agreed prices and net package dues.
    """
    kpis = ledger_service.compute_patient_financial_kpis(session, patient_ids, all_visit_ids)
    return (
        kpis.total_billed_paise,
        kpis.total_paid_paise,
        kpis.total_refunded_paise,
        kpis.outstanding_paise,
    )


def build_patient_summary(
    session: Session,
    patient_id: int,
    principal: Principal,
    request: Request | None = None,
) -> PatientSummaryOut:
    """Build role-redacted Patient Workspace KPI summary for a patient."""
    _ = request
    patient = _get_patient_or_404(session, patient_id)
    patient_ids = effective_patient_ids(session, patient_id)

    role_str = _role_value(principal)
    is_doctor = role_str == Role.DOCTOR.value
    is_reception = role_str == Role.RECEPTION.value
    can_see_financial = role_str in (Role.ADMIN.value, Role.RECEPTION.value)

    # Common non-clinical aggregates
    visit_rows = session.execute(
        select(Visit.id, Visit.visit_code, Visit.visit_date, Visit.status)
        .where(Visit.patient_id.in_(patient_ids))
        .order_by(Visit.visit_date.desc(), Visit.id.desc())
    ).all()
    total_visits = len(visit_rows)

    active_treatment_plans = int(
        session.scalar(
            select(func.count(TreatmentPlan.id)).where(
                TreatmentPlan.patient_id.in_(patient_ids),
                TreatmentPlan.status == TreatmentPlanStatus.ACTIVE.value,
            )
        )
        or 0
    )

    latest_visit: LatestVisitBrief | None = None
    if visit_rows:
        v_id, v_code, v_date, v_status = visit_rows[0]
        meta = _batch_visit_appointment_meta(session, [v_id])[v_id]
        latest_visit = LatestVisitBrief(
            visit_id=v_id,
            visit_code=v_code,
            visit_date=v_date,
            status=v_status,
            token_numbers=meta.token_numbers,
            doctors=meta.doctors,
            departments=meta.departments,
            consultation_count=meta.consultation_count,
            completed_consultations=meta.completed_consultations,
        )

    # Allergy projections (ADMIN never queries patient_allergies)
    allergy_alert: AllergySafetyAlertOut | None = None
    active_allergies: list[WorkspaceAllergyOut] | None = None

    if is_doctor:
        allergy_rows = list(
            session.scalars(
                select(PatientAllergy)
                .where(
                    PatientAllergy.patient_id.in_(patient_ids),
                    PatientAllergy.status == AllergyStatus.ACTIVE.value,
                )
                .options(selectinload(PatientAllergy.recorded_by_user))
            ).all()
        )
        allergy_rows.sort(
            key=lambda a: (
                -_ALLERGY_SEVERITY_RANK.get(a.severity, 0),
                a.substance.lower(),
                a.id,
            )
        )
        audit_cross_doctor_list_read(
            session, principal, patient_id, "patient_summary_allergies", allergy_rows
        )
        allergy_alert = _build_allergy_alert_from_pairs(
            [(a.substance, a.severity) for a in allergy_rows]
        )
        active_allergies = [
            WorkspaceAllergyOut(
                id=a.id,
                patient_id=a.patient_id,
                substance=a.substance,
                category=a.category,
                severity=a.severity,
                reaction=a.reaction,
                clinical_notes=a.clinical_notes,
                status=a.status,
                doctor_id=a.doctor_id,
                recorded_by_user_id=a.recorded_by_user_id,
                recorded_by_username=(
                    a.recorded_by_user.username if a.recorded_by_user else None
                ),
                created_at=a.created_at,
                updated_at=a.updated_at,
                version_id=a.version_id,
            )
            for a in allergy_rows
        ]
    elif is_reception:
        # Project ONLY substance and severity for Reception safety alert (D-04).
        safety_rows = session.execute(
            select(PatientAllergy.id, PatientAllergy.substance, PatientAllergy.severity).where(
                PatientAllergy.patient_id.in_(patient_ids),
                PatientAllergy.status == AllergyStatus.ACTIVE.value,
            )
        ).all()
        sorted_safety = sorted(
            safety_rows,
            key=lambda r: (-_ALLERGY_SEVERITY_RANK.get(r[2], 0), r[1].lower(), r[0]),
        )
        allergy_alert = _build_allergy_alert_from_pairs(
            [(substance, severity) for _, substance, severity in sorted_safety]
        )

    # Clinical KPIs (DOCTOR only — never query clinical tables for ADMIN/RECEPTION under D-04)
    prescriptions_count: int | None = None
    active_conditions_count: int | None = None
    latest_encounter: LatestEncounterBrief | None = None

    if is_doctor:
        rx_scope = row_scope(principal, ScopeFamily.CLINICAL_READ, Prescription.doctor_id)
        prescriptions_count = int(
            session.scalar(
                select(func.count(Prescription.id)).where(
                    Prescription.patient_id.in_(patient_ids),
                    rx_scope,
                )
            )
            or 0
        )
        cond_scope = row_scope(principal, ScopeFamily.CLINICAL_READ, PatientCondition.doctor_id)
        active_conditions_count = int(
            session.scalar(
                select(func.count(PatientCondition.id)).where(
                    PatientCondition.patient_id.in_(patient_ids),
                    PatientCondition.status == ConditionStatus.ACTIVE.value,
                    cond_scope,
                )
            )
            or 0
        )

        enc_scope = row_scope(principal, ScopeFamily.CLINICAL_READ, ClinicalEncounter.doctor_id)
        latest_enc_row = session.execute(
            select(
                ClinicalEncounter.id,
                ClinicalEncounter.encounter_code,
                ClinicalEncounter.encounter_date,
                ClinicalEncounter.doctor_id,
                ClinicalEncounter.is_finalised,
                ClinicalEncounter.diagnosis,
                Doctor.name_en.label("doctor_name"),
                Department.name_en.label("department_name"),
            )
            .join(Doctor, Doctor.id == ClinicalEncounter.doctor_id)
            .outerjoin(Department, Department.id == ClinicalEncounter.department_id)
            .where(ClinicalEncounter.patient_id.in_(patient_ids), enc_scope)
            .order_by(ClinicalEncounter.encounter_date.desc(), ClinicalEncounter.id.desc())
            .limit(1)
        ).first()

        if latest_enc_row is not None:
            audit_cross_doctor_list_read(
                session,
                principal,
                patient_id,
                "patient_summary_latest_encounter",
                [latest_enc_row],
            )
            diag_text = (latest_enc_row.diagnosis or "").strip() or None
            latest_encounter = LatestEncounterBrief(
                encounter_id=latest_enc_row.id,
                encounter_code=latest_enc_row.encounter_code,
                encounter_date=latest_enc_row.encounter_date,
                doctor_name=latest_enc_row.doctor_name,
                department_name=latest_enc_row.department_name,
                is_finalised=latest_enc_row.is_finalised,
                diagnosis_summary=diag_text,
            )

    # Financial KPIs (ADMIN & RECEPTION only — strictly None for DOCTOR per AGENTS.md #7)
    total_billed_paise: int | None = None
    total_paid_paise: int | None = None
    total_refunded_paise: int | None = None
    outstanding_paise: int | None = None

    if can_see_financial:
        all_visit_ids = [row[0] for row in visit_rows]
        (
            total_billed_paise,
            total_paid_paise,
            total_refunded_paise,
            outstanding_paise,
        ) = _load_patient_financial_kpis(session, patient_ids, all_visit_ids)

    return PatientSummaryOut(
        patient_id=patient.id,
        urn=patient.urn,
        total_visits=total_visits,
        active_treatment_plans=active_treatment_plans,
        latest_visit=latest_visit,
        allergy_alert=allergy_alert,
        active_allergies=active_allergies,
        prescriptions_count=prescriptions_count,
        active_conditions_count=active_conditions_count,
        latest_encounter=latest_encounter,
        total_billed_paise=total_billed_paise,
        total_paid_paise=total_paid_paise,
        total_refunded_paise=total_refunded_paise,
        outstanding_paise=outstanding_paise,
    )


def list_patient_visit_history(
    session: Session,
    patient_id: int,
    principal: Principal,
    limit: int = 20,
    offset: int = 0,
    request: Request | None = None,
) -> PatientVisitHistoryResponse:
    """List paginated, role-redacted visit history for a patient (including merged aliases)."""
    _ = request
    _get_patient_or_404(session, patient_id)
    patient_ids = effective_patient_ids(session, patient_id)

    role_str = _role_value(principal)
    is_doctor = role_str == Role.DOCTOR.value
    can_see_financial = role_str in (Role.ADMIN.value, Role.RECEPTION.value)

    total = int(
        session.scalar(
            select(func.count(Visit.id)).where(Visit.patient_id.in_(patient_ids))
        )
        or 0
    )

    page_visits = session.execute(
        select(Visit.id, Visit.visit_code, Visit.visit_date, Visit.status)
        .where(Visit.patient_id.in_(patient_ids))
        .order_by(Visit.visit_date.desc(), Visit.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    if not page_visits:
        return PatientVisitHistoryResponse(items=[], total=total, limit=limit, offset=offset)

    page_visit_ids = [row[0] for row in page_visits]
    meta_by_visit = _batch_visit_appointment_meta(session, page_visit_ids)

    # Encounter links: DOCTOR only (never query clinical_encounters for ADMIN/RECEPTION under D-04)
    encounters_by_visit: dict[int, list[EncounterLinkBrief]] | None = None
    if is_doctor:
        encounters_by_visit = {v_id: [] for v_id in page_visit_ids}
        enc_scope = row_scope(principal, ScopeFamily.CLINICAL_READ, ClinicalEncounter.doctor_id)
        effective_visit_col = func.coalesce(ClinicalEncounter.visit_id, Appointment.visit_id)
        enc_rows = session.execute(
            select(
                ClinicalEncounter.id,
                ClinicalEncounter.encounter_code,
                ClinicalEncounter.is_finalised,
                ClinicalEncounter.doctor_id,
                Doctor.name_en.label("doctor_name"),
                effective_visit_col.label("linked_visit_id"),
            )
            .join(Doctor, Doctor.id == ClinicalEncounter.doctor_id)
            .outerjoin(Appointment, Appointment.id == ClinicalEncounter.appointment_id)
            .where(
                ClinicalEncounter.patient_id.in_(patient_ids),
                effective_visit_col.in_(page_visit_ids),
                enc_scope,
            )
            .order_by(ClinicalEncounter.encounter_date.asc(), ClinicalEncounter.id.asc())
        ).all()

        audit_cross_doctor_list_read(
            session, principal, patient_id, "patient_visit_history_encounters", enc_rows
        )
        for row in enc_rows:
            if row.linked_visit_id in encounters_by_visit:
                encounters_by_visit[row.linked_visit_id].append(
                    EncounterLinkBrief(
                        encounter_id=row.id,
                        encounter_code=row.encounter_code,
                        is_finalised=row.is_finalised,
                        doctor_name=row.doctor_name,
                    )
                )

    # Financial totals: ADMIN & RECEPTION only (strictly None for DOCTOR per AGENTS.md #7)
    totals_by_visit = (
        billing_service.visit_totals(session, page_visit_ids) if can_see_financial else None
    )

    items: list[PatientVisitHistoryItem] = []
    for v_id, v_code, v_date, v_status in page_visits:
        meta = meta_by_visit[v_id]
        bill_total: int | None = None
        paid: int | None = None
        due: int | None = None
        pay_status: str | None = None

        if totals_by_visit is not None:
            vt = totals_by_visit[v_id]
            bill_total = vt.bill_total_paise
            paid = vt.paid_paise
            due = vt.due_paise
            pay_status = _payment_status(vt.bill_total_paise, vt.paid_paise, vt.due_paise)

        items.append(
            PatientVisitHistoryItem(
                visit_id=v_id,
                visit_code=v_code,
                visit_date=v_date,
                status=v_status,
                token_numbers=meta.token_numbers,
                doctors=meta.doctors,
                departments=meta.departments,
                consultation_count=meta.consultation_count,
                completed_consultations=meta.completed_consultations,
                encounter_links=(
                    encounters_by_visit[v_id] if encounters_by_visit is not None else None
                ),
                bill_total_paise=bill_total,
                paid_paise=paid,
                due_paise=due,
                payment_status=pay_status,
            )
        )

    return PatientVisitHistoryResponse(items=items, total=total, limit=limit, offset=offset)


def _serialize_workspace_template(
    enc: ClinicalEncounter,
) -> WorkspaceTemplateSummaryOut | None:
    """Build specialty template summary for an encounter if a response exists."""
    resp = enc.template_response
    if resp is None or resp.template_version is None or resp.template_version.template is None:
        return None
    tv = resp.template_version
    tpl = tv.template
    return WorkspaceTemplateSummaryOut(
        template_code=tpl.code,
        template_name_en=tpl.name_en,
        template_version_id=resp.template_version_id,
        version_number=tv.version_number,
        response_data=resp.response_data or {},
        updated_at=resp.updated_at,
    )


def _serialize_workspace_follow_up(
    enc: ClinicalEncounter,
    patient: Patient,
) -> DoctorFollowUpResponse | None:
    """Build DoctorFollowUpResponse from an encounter's follow-up recommendation."""
    fu = enc.follow_up_recommendation
    if fu is None:
        return None
    return DoctorFollowUpResponse(
        id=fu.id,
        encounter_id=fu.encounter_id,
        patient_id=fu.patient_id,
        patient_name=enc.patient_name or patient.full_name,
        patient_urn=enc.patient_urn or patient.urn,
        doctor_id=fu.doctor_id,
        doctor_name=fu.doctor.name_en if fu.doctor else "",
        recommended_doctor_id=fu.recommended_doctor_id,
        recommended_doctor_name=fu.recommended_doctor.name_en if fu.recommended_doctor else "",
        recommended_date=fu.recommended_date,
        clinical_reason=fu.clinical_reason,
        status=fu.status,
        booked_appointment_id=fu.booked_appointment_id,
        closed_reason=fu.closed_reason,
        closed_by_user_id=fu.closed_by_user_id,
        closed_at=fu.closed_at,
        version_id=fu.version_id,
        created_at=fu.created_at,
        updated_at=fu.updated_at,
    )


def _serialize_workspace_prescription(
    rx: Prescription,
    doctor_name: str,
    patient: Patient,
) -> PrescriptionOut:
    """Serialize a Prescription row with ordered items for the Visit Workspace."""
    sorted_items = sorted(rx.items, key=lambda it: it.item_order)
    return PrescriptionOut(
        id=rx.id,
        patient_id=rx.patient_id,
        patient_urn=rx.patient_urn or patient.urn,
        patient_name=rx.patient_name or patient.full_name,
        patient_mobile=rx.patient_mobile or patient.mobile,
        patient_address=rx.patient_address or patient.address,
        doctor_id=rx.doctor_id,
        doctor_name=doctor_name,
        encounter_id=rx.encounter_id,
        status=rx.status,
        revision_number=rx.revision_number,
        supersedes_prescription_id=rx.supersedes_prescription_id,
        amendment_reason=rx.amendment_reason,
        authorised_at=rx.authorised_at,
        cancelled_at=rx.cancelled_at,
        cancellation_reason=rx.cancellation_reason,
        cancelled_by_user_id=rx.cancelled_by_user_id,
        is_printable=(rx.status == PrescriptionStatus.AUTHORISED.value),
        diagnosis=rx.diagnosis,
        dietary_advice=rx.dietary_advice,
        general_advice=rx.general_advice,
        follow_up_date=rx.follow_up_date,
        version_id=rx.version_id,
        created_at=rx.created_at,
        updated_at=rx.updated_at,
        items=[PrescriptionItemOut.model_validate(it) for it in sorted_items],
    )


def _serialize_workspace_investigation(
    order: InvestigationOrder,
    encounter_code: str,
    doctor_name: str,
) -> InvestigationOrderOut:
    """Serialize an InvestigationOrder with results and linked document metadata."""
    sorted_results = sorted(order.results, key=lambda r: (r.reported_at, r.id), reverse=True)
    return InvestigationOrderOut(
        id=order.id,
        encounter_id=order.encounter_id,
        encounter_code=encounter_code,
        patient_id=order.patient_id,
        doctor_id=order.doctor_id,
        doctor_name=doctor_name,
        category=order.category,
        test_name=order.test_name,
        instructions=order.instructions,
        priority=order.priority,
        status=order.status,
        cancelled_reason=order.cancelled_reason,
        ordered_at=order.ordered_at,
        updated_at=order.updated_at,
        version_id=order.version_id,
        results=[
            InvestigationResultOut(
                id=r.id,
                order_id=r.order_id,
                patient_id=r.patient_id,
                document_id=r.document_id,
                document_title=r.document.title if r.document is not None else None,
                summary_text=r.summary_text,
                result_value=r.result_value,
                unit=r.unit,
                reference_range=r.reference_range,
                is_abnormal=r.is_abnormal,
                reported_at=r.reported_at,
                recorded_by_user_id=r.recorded_by_user_id,
                recorded_by_username=(
                    r.recorded_by_user.username if r.recorded_by_user is not None else None
                ),
                created_at=r.created_at,
            )
            for r in sorted_results
        ],
    )


def build_visit_workspace(
    session: Session,
    patient_id: int,
    visit_id: int,
    principal: Principal,
    request: Request | None = None,
) -> VisitWorkspaceOut:
    """Build unified, role-redacted Encounter / Visit Workspace payload (T4.3).

    Guarantees:
    - Validates visit belongs to effective_patient_ids(session, patient_id) (404 otherwise),
      allowing reads on archived and merged patients.
    - DOCTOR: returns per-consultation clinical bundles (vitals, notes, template summary,
      structured diagnoses, investigations + document links, versioned prescriptions, treatment
      plans, follow-up, addenda, and own clinical charges per Q13), audits cross-doctor reads
      (DWS-04), and sets financial_summary = None (AGENTS.md #7).
    - RECEPTION / ADMIN: never queries clinical tables, sets all clinical bundle fields to None
      (D-04), and returns financial_summary (bill totals, payments, refunds).
    - Allergy safety alert: populated for DOCTOR and RECEPTION; strictly None for ADMIN.
    """
    _ = request
    patient = _get_patient_or_404(session, patient_id)
    patient_ids = effective_patient_ids(session, patient_id)

    visit = session.scalar(
        select(Visit).where(Visit.id == visit_id, Visit.patient_id.in_(patient_ids))
    )
    if visit is None:
        raise ApiError(
            status_code=404,
            code="visit_not_found",
            message=f"Visit #{visit_id} not found for patient #{patient_id}.",
        )

    merged_into_urn: str | None = None
    if patient.merged_into_id is not None:
        merged_into_urn = session.scalar(
            select(Patient.urn).where(Patient.id == patient.merged_into_id)
        )

    role_str = _role_value(principal)
    is_doctor = role_str == Role.DOCTOR.value
    is_reception = role_str == Role.RECEPTION.value
    can_see_financial = role_str in (Role.ADMIN.value, Role.RECEPTION.value)

    # Allergy safety alert: DOCTOR & RECEPTION only; ADMIN never queries patient_allergies (D-04).
    allergy_alert: AllergySafetyAlertOut | None = None
    if is_doctor:
        allergy_rows = session.execute(
            select(
                PatientAllergy.id,
                PatientAllergy.substance,
                PatientAllergy.severity,
                PatientAllergy.doctor_id,
            ).where(
                PatientAllergy.patient_id.in_(patient_ids),
                PatientAllergy.status == AllergyStatus.ACTIVE.value,
            )
        ).all()
        audit_cross_doctor_list_read(
            session, principal, patient_id, "visit_workspace_allergies", allergy_rows
        )
        sorted_allergies = sorted(
            allergy_rows,
            key=lambda r: (-_ALLERGY_SEVERITY_RANK.get(r.severity, 0), r.substance.lower(), r.id),
        )
        allergy_alert = _build_allergy_alert_from_pairs(
            [(r.substance, r.severity) for r in sorted_allergies]
        )
    elif is_reception:
        safety_rows = session.execute(
            select(PatientAllergy.id, PatientAllergy.substance, PatientAllergy.severity).where(
                PatientAllergy.patient_id.in_(patient_ids),
                PatientAllergy.status == AllergyStatus.ACTIVE.value,
            )
        ).all()
        sorted_safety = sorted(
            safety_rows,
            key=lambda r: (-_ALLERGY_SEVERITY_RANK.get(r[2], 0), r[1].lower(), r[0]),
        )
        allergy_alert = _build_allergy_alert_from_pairs(
            [(substance, severity) for _, substance, severity in sorted_safety]
        )

    patient_strip = VisitWorkspacePatientStrip(
        patient_id=patient.id,
        urn=patient.urn,
        full_name=patient.full_name,
        computed_age_years=compute_age_years(patient.dob, patient.age_years),
        gender=patient.gender,
        mobile=patient.mobile,
        is_active=patient.is_active,
        is_archived=patient.is_archived,
        merged_into_id=patient.merged_into_id,
        merged_into_urn=merged_into_urn,
        allergy_alert=allergy_alert,
    )

    # Load visit consultations (non-clinical metadata safe for all roles)
    appt_rows = session.execute(
        select(
            Appointment.id,
            Appointment.token_number,
            Appointment.doctor_id,
            Doctor.name_en.label("doctor_name"),
            Department.name_en.label("department_name"),
            Appointment.consultation_status,
            Appointment.visit_kind,
            Appointment.priority_level,
        )
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .outerjoin(Department, Department.id == Appointment.department_id)
        .where(Appointment.visit_id == visit.id)
        .order_by(Appointment.id.asc())
    ).all()

    token_numbers = [
        row.token_number
        for row in appt_rows
        if row.consultation_status != ConsultationStatus.CANCELLED.value
        and row.token_number is not None
    ]
    visit_meta = VisitWorkspaceVisitMeta(
        visit_id=visit.id,
        visit_code=visit.visit_code,
        visit_date=visit.visit_date,
        status=visit.status,
        referral_source=visit.referral_source,
        referrer_name=visit.referrer_name,
        token_numbers=token_numbers,
    )

    consultations: list[VisitWorkspaceConsultationOut] = []
    financial_summary: VisitWorkspaceFinancialSummaryOut | None = None

    if is_doctor:
        appt_ids = [row.id for row in appt_rows]
        enc_scope = row_scope(principal, ScopeFamily.CLINICAL_READ, ClinicalEncounter.doctor_id)
        visit_link_cond = (
            or_(
                ClinicalEncounter.visit_id == visit.id,
                ClinicalEncounter.appointment_id.in_(appt_ids),
            )
            if appt_ids
            else (ClinicalEncounter.visit_id == visit.id)
        )
        encounters = list(
            session.scalars(
                select(ClinicalEncounter)
                .options(
                    joinedload(ClinicalEncounter.doctor),
                    joinedload(ClinicalEncounter.department),
                    selectinload(ClinicalEncounter.vitals),
                    selectinload(ClinicalEncounter.addenda).joinedload(ClinicalAddendum.doctor),
                    selectinload(ClinicalEncounter.template_response)
                    .joinedload(ClinicalTemplateResponse.template_version)
                    .joinedload(ClinicalTemplateVersion.template),
                    selectinload(ClinicalEncounter.follow_up_recommendation).joinedload(
                        FollowUpRecommendation.doctor
                    ),
                    selectinload(ClinicalEncounter.follow_up_recommendation).joinedload(
                        FollowUpRecommendation.recommended_doctor
                    ),
                )
                .where(
                    ClinicalEncounter.patient_id.in_(patient_ids),
                    visit_link_cond,
                    enc_scope,
                )
                .order_by(ClinicalEncounter.encounter_date.asc(), ClinicalEncounter.id.asc())
            )
            .unique()
            .all()
        )
        audit_cross_doctor_list_read(
            session, principal, patient_id, "visit_workspace_encounters", encounters
        )

        encounter_ids = [enc.id for enc in encounters]
        enc_code_by_id = {enc.id: enc.encounter_code for enc in encounters}

        diagnoses_by_enc: dict[int, list[EncounterDiagnosisOut]] = defaultdict(list)
        investigations_by_enc: dict[int, list[InvestigationOrderOut]] = defaultdict(list)
        prescriptions_by_enc: dict[int, list[PrescriptionOut]] = defaultdict(list)
        plans_by_enc: dict[int, list[TreatmentPlanOut]] = defaultdict(list)

        if encounter_ids:
            diag_rows = session.execute(
                select(EncounterDiagnosis, Doctor.name_en)
                .outerjoin(Doctor, Doctor.id == EncounterDiagnosis.doctor_id)
                .where(EncounterDiagnosis.encounter_id.in_(encounter_ids))
                .order_by(EncounterDiagnosis.id.asc())
            ).all()
            for diag, doc_name in diag_rows:
                diagnoses_by_enc[diag.encounter_id].append(
                    EncounterDiagnosisOut(
                        id=diag.id,
                        encounter_id=diag.encounter_id,
                        encounter_code=enc_code_by_id.get(diag.encounter_id),
                        patient_id=diag.patient_id,
                        doctor_id=diag.doctor_id,
                        doctor_name=doc_name,
                        diagnosis_name=diag.diagnosis_name,
                        icd10_code=diag.icd10_code,
                        diagnosis_type=diag.diagnosis_type,
                        status=diag.status,
                        onset_date=diag.onset_date,
                        notes=diag.notes,
                        patient_condition_id=diag.patient_condition_id,
                        created_at=diag.created_at,
                        updated_at=diag.updated_at,
                    )
                )

            inv_rows = session.execute(
                select(InvestigationOrder, Doctor.name_en)
                .outerjoin(Doctor, Doctor.id == InvestigationOrder.doctor_id)
                .options(
                    selectinload(InvestigationOrder.results).joinedload(
                        InvestigationResult.recorded_by_user
                    ),
                    selectinload(InvestigationOrder.results).joinedload(
                        InvestigationResult.document
                    ),
                )
                .where(InvestigationOrder.encounter_id.in_(encounter_ids))
                .order_by(InvestigationOrder.ordered_at.desc(), InvestigationOrder.id.desc())
            ).all()
            for order, doc_name in inv_rows:
                investigations_by_enc[order.encounter_id].append(
                    _serialize_workspace_investigation(
                        order,
                        encounter_code=enc_code_by_id.get(order.encounter_id, ""),
                        doctor_name=doc_name or "",
                    )
                )

            rx_rows = session.execute(
                select(Prescription, Doctor.name_en)
                .outerjoin(Doctor, Doctor.id == Prescription.doctor_id)
                .options(selectinload(Prescription.items))
                .where(Prescription.encounter_id.in_(encounter_ids))
                .order_by(Prescription.revision_number.desc(), Prescription.id.desc())
            ).all()
            for rx, doc_name in rx_rows:
                if rx.encounter_id is not None:
                    prescriptions_by_enc[rx.encounter_id].append(
                        _serialize_workspace_prescription(rx, doc_name or "", patient)
                    )

            plan_rows = session.execute(
                select(TreatmentPlan, Doctor.name_en)
                .outerjoin(Doctor, Doctor.id == TreatmentPlan.doctor_id)
                .where(TreatmentPlan.encounter_id.in_(encounter_ids))
                .order_by(TreatmentPlan.created_at.desc(), TreatmentPlan.id.desc())
            ).all()
            for plan, doc_name in plan_rows:
                if plan.encounter_id is not None:
                    plans_by_enc[plan.encounter_id].append(
                        TreatmentPlanOut(
                            id=plan.id,
                            patient_id=plan.patient_id,
                            patient_urn=patient.urn,
                            patient_name=patient.full_name,
                            doctor_id=plan.doctor_id,
                            doctor_name=doc_name or "",
                            encounter_id=plan.encounter_id,
                            plan_name=plan.plan_name,
                            condition_diagnosis=plan.condition_diagnosis,
                            referred_by=plan.referred_by,
                            total_sessions=plan.total_sessions,
                            completed_sessions=plan.completed_sessions,
                            agreed_price_paise=plan.agreed_price_paise,
                            status=plan.status,
                            cancellation_reason=plan.cancellation_reason,
                            version_id=plan.version_id,
                            created_at=plan.created_at,
                            updated_at=plan.updated_at,
                        )
                    )

        # Q13: Doctor sees ONLY own consultation fee & own doctor-authored charges (no payments).
        charges_by_appt: dict[int, list[WorkspaceClinicalChargeOut]] = defaultdict(list)
        own_appt_ids = [
            row.id
            for row in appt_rows
            if principal.doctor_id is not None and row.doctor_id == principal.doctor_id
        ]
        if own_appt_ids:
            charge_rows = session.scalars(
                select(BillItem)
                .where(
                    BillItem.appointment_id.in_(own_appt_ids),
                    or_(
                        BillItem.category == BillItemCategory.CONSULTATION.value,
                        BillItem.source == BillItemSource.DOCTOR.value,
                    ),
                )
                .order_by(BillItem.id.asc())
            ).all()
            for item in charge_rows:
                if item.appointment_id is not None:
                    charges_by_appt[item.appointment_id].append(
                        WorkspaceClinicalChargeOut(
                            id=item.id,
                            category=item.category,
                            source=item.source,
                            status=item.status,
                            description=item.description,
                            unit=item.unit,
                            quantity=item.quantity,
                            rate_paise=item.rate_paise,
                            amount_paise=item.amount_paise,
                            treatment_plan_id=item.treatment_plan_id,
                        )
                    )

        def _bundle_kwargs(
            enc: ClinicalEncounter | None,
            charges: list[WorkspaceClinicalChargeOut],
        ) -> dict:
            if enc is None:
                return {
                    "encounter_id": None,
                    "encounter_code": None,
                    "is_finalised": None,
                    "vitals": None,
                    "symptoms": None,
                    "clinical_notes": None,
                    "diagnosis": None,
                    "template_response_summary": None,
                    "diagnoses": [],
                    "investigations": [],
                    "prescriptions": [],
                    "treatment_plans": [],
                    "follow_up": None,
                    "addenda": [],
                    "clinical_charges": charges,
                }
            addenda_out = [
                AddendumRead(
                    id=a.id,
                    encounter_id=a.encounter_id,
                    doctor_id=a.doctor_id,
                    doctor_name=a.doctor.name_en if a.doctor else "",
                    addendum_text=a.addendum_text,
                    created_at=a.created_at,
                )
                for a in enc.addenda
            ]
            return {
                "encounter_id": enc.id,
                "encounter_code": enc.encounter_code,
                "is_finalised": enc.is_finalised,
                "vitals": (
                    VitalObservationResponse.model_validate(enc.vitals)
                    if enc.vitals is not None
                    else None
                ),
                "symptoms": enc.symptoms,
                "clinical_notes": enc.clinical_notes,
                "diagnosis": enc.diagnosis,
                "template_response_summary": _serialize_workspace_template(enc),
                "diagnoses": diagnoses_by_enc.get(enc.id, []),
                "investigations": investigations_by_enc.get(enc.id, []),
                "prescriptions": prescriptions_by_enc.get(enc.id, []),
                "treatment_plans": plans_by_enc.get(enc.id, []),
                "follow_up": _serialize_workspace_follow_up(enc, patient),
                "addenda": addenda_out,
                "clinical_charges": charges,
            }

        enc_by_appt: dict[int, ClinicalEncounter] = {}
        unlinked_encounters: list[ClinicalEncounter] = []
        appt_id_set = set(appt_ids)
        for enc in encounters:
            if enc.appointment_id is not None and enc.appointment_id in appt_id_set:
                enc_by_appt[enc.appointment_id] = enc
            else:
                unlinked_encounters.append(enc)

        for row in appt_rows:
            enc = enc_by_appt.get(row.id)
            consultations.append(
                VisitWorkspaceConsultationOut(
                    appointment_id=row.id,
                    token_number=row.token_number,
                    doctor_id=row.doctor_id,
                    doctor_name=row.doctor_name,
                    department_name=row.department_name,
                    consultation_status=row.consultation_status,
                    visit_kind=row.visit_kind,
                    priority_level=row.priority_level,
                    **_bundle_kwargs(enc, charges_by_appt.get(row.id, [])),
                )
            )

        for enc in unlinked_encounters:
            consultations.append(
                VisitWorkspaceConsultationOut(
                    appointment_id=None,
                    token_number=None,
                    doctor_id=enc.doctor_id,
                    doctor_name=enc.doctor.name_en if enc.doctor else "",
                    department_name=enc.department.name_en if enc.department else None,
                    consultation_status=None,
                    visit_kind=None,
                    priority_level=None,
                    **_bundle_kwargs(enc, []),
                )
            )
    else:
        # D-04: RECEPTION & ADMIN never query clinical tables; all clinical fields strictly None.
        for row in appt_rows:
            consultations.append(
                VisitWorkspaceConsultationOut(
                    appointment_id=row.id,
                    token_number=row.token_number,
                    doctor_id=row.doctor_id,
                    doctor_name=row.doctor_name,
                    department_name=row.department_name,
                    consultation_status=row.consultation_status,
                    visit_kind=row.visit_kind,
                    priority_level=row.priority_level,
                )
            )

    if can_see_financial:
        totals = billing_service.visit_totals(session, [visit.id])[visit.id]
        payments = billing_service.visit_payments(session, visit.id)
        payment_ids = [p.id for p in payments]

        refund_cond = (
            or_(Refund.visit_id == visit.id, Refund.payment_id.in_(payment_ids))
            if payment_ids
            else (Refund.visit_id == visit.id)
        )
        refunds = list(
            session.scalars(
                select(Refund)
                .where(refund_cond)
                .options(
                    selectinload(Refund.refunded_by_user),
                    selectinload(Refund.payment),
                )
                .order_by(Refund.created_at.desc(), Refund.id.desc())
            ).all()
        )

        financial_summary = VisitWorkspaceFinancialSummaryOut(
            bill_total_paise=totals.bill_total_paise,
            paid_paise=totals.paid_paise,
            refunded_paise=totals.total_refunded_paise,
            due_paise=totals.due_paise,
            payment_status=_payment_status(
                totals.bill_total_paise, totals.paid_paise, totals.due_paise
            ),
            payments=[
                BillPaymentOut(
                    id=p.id,
                    visit_id=p.visit_id,
                    appointment_id=p.appointment_id,
                    receipt_number=p.receipt_number,
                    amount_paise=p.amount_paise,
                    payment_method=p.payment_method,
                    is_reversed=p.is_reversed,
                    created_at=p.created_at,
                    created_by_username=(
                        p.created_by_user.username if p.created_by_user else None
                    ),
                )
                for p in payments
            ],
            refunds=[
                RefundOut(
                    id=r.id,
                    refund_number=r.refund_number,
                    payment_id=r.payment_id,
                    payment_receipt_number=(
                        r.payment.receipt_number if r.payment is not None else None
                    ),
                    patient_id=r.patient_id,
                    visit_id=r.visit_id,
                    amount_paise=r.amount_paise,
                    refund_method=r.refund_method,
                    reason=r.reason,
                    refunded_by_user_id=r.refunded_by_user_id,
                    refunded_by_username=(
                        r.refunded_by_user.username if r.refunded_by_user else ""
                    ),
                    created_at=r.created_at,
                )
                for r in refunds
            ],
        )

    return VisitWorkspaceOut(
        patient=patient_strip,
        visit=visit_meta,
        consultations=consultations,
        financial_summary=financial_summary,
    )
