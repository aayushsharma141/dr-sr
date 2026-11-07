"""Patient dataset querying, formula sanitization, and streaming CSV/XLSX generator (D-20-15 to D-20-20).

Invariants:
- STRIDE T-20-16: Formula injection is neutralized by prepending ' to cell values starting with =, +, -, or @.
- STRIDE T-20-18 / D-20-20: Streams generated directly in memory; zero server disk writing.
- D-20-17: Audited dataset extract with actor, reason, scope, fields, and row count.
- D-20-19: Department filtering targets patients with appointments/encounters in that department.
"""

import csv
import io
import json
from collections.abc import Iterator
from typing import Any

import openpyxl
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from kalyan_api.models import (
    Appointment,
    ClinicalEncounter,
    Patient,
    Prescription,
    TreatmentPlan,
)
from kalyan_api.schemas.exports import ExportScope

# Friendly column headers
COLUMN_HEADERS: dict[str, str] = {
    "full_name": "Full Name",
    "urn": "URN",
    "guardian_name": "Guardian Name",
    "gender": "Gender",
    "age_years": "Age",
    "mobile": "Mobile Number",
    "address": "Address",
    "district": "District",
    "state": "State",
    "emergency_contact": "Emergency Contact",
    "legacy_urn": "Legacy Hospital Number",
    "allergies": "Allergies",
    "notes": "Patient Profile Notes",
    "encounters": "Encounters Summary",
    "clinical_notes": "Clinical Notes",
    "addenda": "Clinical Addenda",
    "assessments": "Specialty Assessments",
    "vitals": "Vitals & Biometrics",
    "diagnoses": "Diagnoses",
    "prescriptions": "Prescriptions & Medications",
    "treatment_plans": "Treatment Plans",
    "sessions": "Physiotherapy Sessions",
}

CLINICAL_FIELD_KEYS = frozenset(
    {
        "encounters",
        "clinical_notes",
        "addenda",
        "assessments",
        "vitals",
        "diagnoses",
        "prescriptions",
        "treatment_plans",
        "sessions",
    }
)


def sanitize_cell(val: Any) -> Any:
    """Neutralize spreadsheet formula injection (T-20-16).

    If the string begins with '=', '+', '-', or '@', prepend a single quote (').
    """
    if isinstance(val, str) and len(val) > 0 and val[0] in ("=", "+", "-", "@"):
        return "'" + val
    return val


def query_export_rows(
    session: Session, scope: ExportScope, selected_fields: list[str]
) -> tuple[list[dict[str, Any]], int]:
    """Execute dynamic scoped patient query and format field values."""
    query = select(Patient)

    # Department scoping per D-20-19
    if scope.department_id is not None:
        dept_conds = [
            Patient.id.in_(
                select(ClinicalEncounter.patient_id).where(
                    ClinicalEncounter.department_id == scope.department_id,
                    *[
                        func.date(ClinicalEncounter.encounter_date) >= scope.start_date
                        if scope.start_date
                        else True,
                        func.date(ClinicalEncounter.encounter_date) <= scope.end_date
                        if scope.end_date
                        else True,
                    ],
                )
            ),
            Patient.id.in_(
                select(Appointment.patient_id)
                .join(ClinicalEncounter, ClinicalEncounter.appointment_id == Appointment.id)
                .where(
                    ClinicalEncounter.department_id == scope.department_id,
                    *[
                        Appointment.appointment_date >= scope.start_date
                        if scope.start_date
                        else True,
                        Appointment.appointment_date <= scope.end_date if scope.end_date else True,
                    ],
                )
            ),
            Patient.id.in_(
                select(Appointment.patient_id).where(
                    Appointment.doctor_id == scope.department_id,
                    *[
                        Appointment.appointment_date >= scope.start_date
                        if scope.start_date
                        else True,
                        Appointment.appointment_date <= scope.end_date if scope.end_date else True,
                    ],
                )
            ),
        ]
        query = query.where(or_(*dept_conds))

    # Date range scoping if department_id is not specified
    elif scope.start_date is not None or scope.end_date is not None:
        date_conds = []
        reg_conds = []
        if scope.start_date is not None:
            reg_conds.append(func.date(Patient.created_at) >= scope.start_date)
        if scope.end_date is not None:
            reg_conds.append(func.date(Patient.created_at) <= scope.end_date)
        if reg_conds:
            date_conds.append(and_(*reg_conds))

        appt_conds = []
        if scope.start_date is not None:
            appt_conds.append(Appointment.appointment_date >= scope.start_date)
        if scope.end_date is not None:
            appt_conds.append(Appointment.appointment_date <= scope.end_date)
        if appt_conds:
            date_conds.append(Patient.id.in_(select(Appointment.patient_id).where(*appt_conds)))

        enc_conds = []
        if scope.start_date is not None:
            enc_conds.append(func.date(ClinicalEncounter.encounter_date) >= scope.start_date)
        if scope.end_date is not None:
            enc_conds.append(func.date(ClinicalEncounter.encounter_date) <= scope.end_date)
        if enc_conds:
            date_conds.append(
                Patient.id.in_(select(ClinicalEncounter.patient_id).where(*enc_conds))
            )

        if date_conds:
            query = query.where(or_(*date_conds))

    # Search query filtering
    if scope.search_query and scope.search_query.strip():
        sq = scope.search_query.strip()
        search_conds = [
            Patient.full_name.ilike(f"%{sq}%"),
            Patient.urn.ilike(f"%{sq}%"),
            Patient.address.ilike(f"%{sq}%"),
        ]
        if hasattr(Patient, "legacy_urn"):
            search_conds.append(Patient.legacy_urn.ilike(f"%{sq}%"))
        digits = "".join(c for c in sq if c.isdigit())
        if digits and len(digits) >= 3:
            search_conds.append(Patient.mobile.like(f"%{digits}%"))
        query = query.where(or_(*search_conds))

    query = query.order_by(Patient.id.asc())
    patients = session.scalars(query).all()

    if not patients:
        return [], 0

    patient_ids = [p.id for p in patients]

    # Preload clinical content if requested per D-20-16
    needs_encounters = any(
        f in selected_fields
        for f in (
            "encounters",
            "clinical_notes",
            "addenda",
            "assessments",
            "vitals",
            "diagnoses",
        )
    )
    needs_prescriptions = any(f in selected_fields for f in ("prescriptions", "diagnoses"))
    needs_plans = any(f in selected_fields for f in ("treatment_plans", "sessions"))

    encounters_by_patient: dict[int, list[ClinicalEncounter]] = {pid: [] for pid in patient_ids}
    if needs_encounters:
        enc_query = (
            select(ClinicalEncounter)
            .where(ClinicalEncounter.patient_id.in_(patient_ids))
            .options(
                selectinload(ClinicalEncounter.addenda),
                selectinload(ClinicalEncounter.template_response),
                selectinload(ClinicalEncounter.vitals),
            )
            .order_by(ClinicalEncounter.encounter_date.asc())
        )
        for enc in session.scalars(enc_query).all():
            encounters_by_patient[enc.patient_id].append(enc)

    prescriptions_by_patient: dict[int, list[Prescription]] = {pid: [] for pid in patient_ids}
    if needs_prescriptions:
        rx_query = (
            select(Prescription)
            .where(Prescription.patient_id.in_(patient_ids))
            .options(selectinload(Prescription.items))
            .order_by(Prescription.created_at.asc())
        )
        for rx in session.scalars(rx_query).all():
            prescriptions_by_patient[rx.patient_id].append(rx)

    plans_by_patient: dict[int, list[TreatmentPlan]] = {pid: [] for pid in patient_ids}
    if needs_plans:
        plan_query = (
            select(TreatmentPlan)
            .where(TreatmentPlan.patient_id.in_(patient_ids))
            .options(selectinload(TreatmentPlan.sessions))
            .order_by(TreatmentPlan.created_at.asc())
        )
        for plan in session.scalars(plan_query).all():
            plans_by_patient[plan.patient_id].append(plan)

    rows: list[dict[str, Any]] = []
    for pat in patients:
        row: dict[str, Any] = {}
        encs = encounters_by_patient.get(pat.id, [])
        rxs = prescriptions_by_patient.get(pat.id, [])
        plans = plans_by_patient.get(pat.id, [])

        for field in selected_fields:
            if field == "full_name":
                row[field] = pat.full_name
            elif field == "urn":
                row[field] = pat.urn
            elif field == "guardian_name":
                row[field] = pat.guardian_name
            elif field == "gender":
                row[field] = pat.gender
            elif field == "age_years":
                row[field] = pat.age_years
            elif field == "mobile":
                row[field] = pat.mobile
            elif field == "address":
                row[field] = pat.address
            elif field == "district":
                row[field] = pat.district
            elif field == "state":
                row[field] = pat.state
            elif field == "emergency_contact":
                row[field] = pat.emergency_contact or ""
            elif field == "legacy_urn":
                row[field] = pat.legacy_urn or ""
            elif field == "allergies":
                row[field] = pat.allergies or ""
            elif field == "notes":
                row[field] = pat.notes or ""
            elif field == "encounters":
                row[field] = (
                    "; ".join(
                        f"[{e.encounter_date.strftime('%Y-%m-%d')}] {e.symptoms or 'Encounter'}"
                        for e in encs
                    )
                    if encs
                    else ""
                )
            elif field == "clinical_notes":
                row[field] = "; ".join(filter(None, [e.clinical_notes for e in encs]))
            elif field == "addenda":
                row[field] = "; ".join(
                    filter(None, [a.addendum_text for e in encs for a in e.addenda])
                )
            elif field == "assessments":
                row[field] = "; ".join(
                    filter(
                        None,
                        [
                            json.dumps(e.template_response.response_data)
                            if (e.template_response and e.template_response.response_data)
                            else ""
                            for e in encs
                        ],
                    )
                )
            elif field == "vitals":
                row[field] = "; ".join(
                    filter(
                        None,
                        [
                            f"BP:{v.systolic_bp}/{v.diastolic_bp} Pulse:{v.pulse_bpm} BMI:{v.bmi}"
                            for e in encs
                            if (v := e.vitals)
                        ],
                    )
                )
            elif field == "diagnoses":
                all_diags = list(
                    filter(
                        None,
                        [e.diagnosis for e in encs if e.diagnosis]
                        + [rx.diagnosis for rx in rxs if rx.diagnosis],
                    )
                )
                row[field] = "; ".join(dict.fromkeys(all_diags))
            elif field == "prescriptions":
                rx_strs = []
                for rx in rxs:
                    meds = ", ".join(
                        f"{it.medicine_name} ({it.dosage}, {it.duration_days}d)" for it in rx.items
                    )
                    rx_strs.append(f"{rx.diagnosis}: {meds}" if meds else rx.diagnosis)
                row[field] = "; ".join(rx_strs)
            elif field == "treatment_plans":
                row[field] = "; ".join(
                    f"{p.plan_name} ({p.status}, {p.completed_sessions}/{p.total_sessions} sessions)"
                    for p in plans
                )
            elif field == "sessions":
                sess_strs = []
                for p in plans:
                    for s in p.sessions:
                        sess_strs.append(
                            f"S#{s.session_number} ({s.session_date}): VAS {s.vas_score} - {s.clinical_notes}"
                        )
                row[field] = "; ".join(sess_strs)
            else:
                row[field] = ""

        rows.append(row)

    return rows, len(rows)


def generate_csv_stream(rows: list[dict[str, Any]], field_names: list[str]) -> Iterator[str]:
    """Yield CSV chunks directly to response stream with formula neutralization."""
    buf = io.StringIO()
    writer = csv.writer(buf)

    # Header line with friendly labels
    headers = [COLUMN_HEADERS.get(f, f) for f in field_names]
    writer.writerow(headers)
    yield buf.getvalue()
    buf.seek(0)
    buf.truncate(0)

    for row in rows:
        cells = [sanitize_cell(row.get(f, "")) for f in field_names]
        writer.writerow(cells)
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)


def generate_xlsx_stream(
    rows: list[dict[str, Any]], field_names: list[str], chunk_size: int = 65536
) -> Iterator[bytes]:
    """Generate in-memory XLSX spreadsheet without server disk caching (D-20-20)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Patients Export"

    # Header row
    headers = [COLUMN_HEADERS.get(f, f) for f in field_names]
    ws.append(headers)

    # Data rows
    for row in rows:
        cells = [sanitize_cell(row.get(f, "")) for f in field_names]
        ws.append(cells)

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)

    while chunk := bio.read(chunk_size):
        yield chunk
