"""RBAC role-by-endpoint matrix definition, runner, and completeness checker.

Guarantees:
- Every non-public route is defined in MATRIX with expected HTTP status for each role.
- Completeness checker ensures no newly registered route ships without an RBAC matrix row.
- Runner isolates each cell by provisioning dedicated users to avoid test pollution.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from conftest import TEST_PASSWORD
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from test_route_policies import _policies, walk_routes

from kalyan_api.config import Settings
from kalyan_api.models import User

IDENTITIES = ("anonymous", "admin", "reception", "doctor_a", "doctor_b")


@dataclass(frozen=True)
class MatrixRow:
    """RBAC matrix specification row."""

    method: str
    path: str
    body_factory: Callable[[], dict[str, Any] | None] | None
    expected: dict[str, int]


def _patch_demographics_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "reason": "Administrative correction matrix test",
        "version_id": ver,
        "full_name": "Updated Matrix Patient",
        "guardian_name": "Updated Guardian",
        "gender": "M",
        "age_years": 31,
        "mobile": "9876543210",
        "address": "Hospital Road, Ara",
        "district": "Bhojpur",
        "state": "Bihar",
    }


def _export_patients_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "reason": "Annual statutory data audit",
        "format": "csv",
        "scope": {},
        "fields": ["full_name"],
    }


def _patch_print_template_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version if target and hasattr(target, "version") else 1
    return {
        "header_en": "Kalyan Hospital Matrix",
        "version": ver,
    }


def _change_password_payload(_target: User | None = None) -> dict[str, Any]:
    return {
        "current_password": "ValidTestPassword123!",
        "new_password": "NewSecretPassword123!",
    }


def _create_user_payload(_target: User | None = None) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:6]
    return {
        "username": f"new_usr_{uid}",
        "full_name": f"New User {uid}",
        "role": "RECEPTION",
    }


def _patch_user_payload(target: User | None = None) -> dict[str, Any]:
    ver = target.version_id if target else 1
    return {
        "full_name": "Updated Staff Name",
        "version_id": ver,
    }


def _action_user_payload(target: User | None = None) -> dict[str, Any]:
    ver = target.version_id if target else 1
    return {
        "version_id": ver,
    }


def _delete_user_payload(target: User | None = None) -> dict[str, Any]:
    """Delete request; the runner provisions a super admin whose password is TEST_PASSWORD."""
    ver = target.version_id if target else 1
    return {"version_id": ver, "super_admin_password": TEST_PASSWORD}


def _bulk_delete_users_payload(target: User | None = None) -> dict[str, Any]:
    """Bulk delete request; the runner provisions a super admin (password TEST_PASSWORD)."""
    ver = target.version_id if target else 1
    return {
        "items": [{"id": target.id if target else 1, "version_id": ver}],
        "super_admin_password": TEST_PASSWORD,
    }


def _setup_admin_payload(_target: User | None = None) -> dict[str, Any]:
    return {
        "setup_code": "ANYCODE123",
        "username": "matrix_admin",
        "full_name": "Matrix Admin",
        "password": "ValidAdminPassword123!",
    }


def _patch_settings_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "name_en": "Kalyan Hospital Matrix",
        "name_hi": "कल्याण हॉस्पिटल",
        "address_1": "Hospital Road, Ara",
        "phone": "+91 6182 000000",
        "receipt_sequence_cycle": "FINANCIAL_YEAR",
        "consultation_validity_days": 7,
        "version_id": ver,
    }


def _create_doctor_payload(_target: Any = None) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:6]
    return {
        "name_en": f"Dr. Matrix {uid}",
        "qualification": "MBBS",
        "default_fee_paise": 30000,
    }


def _patch_doctor_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "name_en": "Dr. Matrix Updated",
        "default_fee_paise": 35000,
        "is_active": True,
        "version_id": ver,
    }


def _patch_doctor_me_settings_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "default_fee_paise": 40000,
        "version_id": ver,
    }


def _create_fee_payload(_target: Any = None) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:6]
    return {
        "name": f"Fee Matrix {uid}",
        "fee_paise": 25000,
    }


def _patch_fee_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "name": "Fee Matrix Updated",
        "fee_paise": 30000,
        "is_active": True,
        "version_id": ver,
    }


def _create_patient_payload(_target: Any = None) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:6]
    return {
        "full_name": f"Patient Matrix {uid}",
        "guardian_name": "Guardian S/o",
        "gender": "M",
        "age_years": 32,
        "mobile": "9876543210",
        "address": "Hospital Road, Ara",
        "district": "Bhojpur",
        "state": "Bihar",
    }


def _patch_patient_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "full_name": "Updated Matrix Patient",
        "version_id": ver,
    }


def _create_department_payload(target: Any = None) -> dict[str, Any]:
    return {
        "name_en": f"New Dept {uuid.uuid4().hex[:6]}",
        "name_hi": "विभाग",
        "description": "Matrix created department",
    }


def _patch_department_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "name_en": f"Updated Dept {uuid.uuid4().hex[:6]}",
        "is_active": True,
        "version_id": ver,
    }


def _assign_doctor_departments_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    dept_id = (
        target.departments[0].id
        if (target and hasattr(target, "departments") and target.departments)
        else 1
    )
    return {
        "department_ids": [dept_id],
        "version_id": ver,
    }


def _revoke_session_payload(target: Any = None) -> dict[str, Any]:
    return {"reason": "Administrative security test revocation"}


def _create_appointment_payload(target: Any = None) -> dict[str, Any]:
    return {
        "patient_id": getattr(target, "patient_id", 1),
        "doctor_id": getattr(target, "doctor_id", 1),
        "department_id": getattr(target, "department_id", 1),
        "appointment_date": "2026-11-01",
        "notes": "Matrix appointment notes",
    }


def _patch_appointment_status_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "status": "ARRIVED",
        "version_id": ver,
    }


def _create_encounter_payload(target: Any = None) -> dict[str, Any]:
    return {
        "patient_id": getattr(target, "patient_id", 1),
        "appointment_id": getattr(target, "appointment_id", None),
        "symptoms": "Matrix test symptoms",
        "clinical_notes": "Matrix test clinical examination notes",
        "diagnosis": "Matrix test diagnosis",
    }


def _patch_encounter_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "symptoms": "Updated matrix symptoms",
        "clinical_notes": "Updated matrix examination notes",
        "diagnosis": "Updated matrix diagnosis",
        "version_id": ver,
    }


def _create_addendum_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "addendum_text": "Follow-up remark recorded during consultation.",
    }


def _create_prescription_payload(target: Any = None) -> dict[str, Any]:
    return {
        "patient_id": getattr(target, "patient_id", 1),
        "diagnosis": "Matrix prescription diagnosis",
        "items": [
            {
                "item_order": 1,
                "medicine_name": "Tab Paracetamol",
                "dosage": "500 mg",
                "frequency": "1-0-1",
                "duration_days": 5,
            }
        ],
    }


def _create_treatment_plan_payload(target: Any = None) -> dict[str, Any]:
    return {
        "patient_id": getattr(target, "patient_id", 1),
        "plan_name": "Matrix Treatment Package",
        "condition_diagnosis": "Lumbar Spondylosis",
        "total_sessions": 5,
        "agreed_price_paise": 250000,
    }


def _patch_treatment_plan_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "plan_name": "Updated Matrix Plan",
        "version_id": ver,
    }


def _create_treatment_session_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "session_date": "2026-11-02",
        "vas_score": 6,
        "modalities": ["IFT", "Hot Pack"],
        "clinical_notes": "Matrix session logged.",
    }


def _patch_treatment_session_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "vas_score": 4,
    }


def _create_session_addendum_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "note": "Matrix session addendum note.",
    }


def _create_payment_payload(target: Any = None) -> dict[str, Any]:
    pat_id = getattr(target, "patient_id", 1) if target else 1
    return {
        "patient_id": pat_id,
        "treatment_plan_id": None,
        "appointment_id": None,
        "amount_paise": 50000,
        "payment_method": "CASH",
        "notes": "Matrix fee",
    }


def _reverse_payment_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "reversal_reason": "Matrix payment refund requested",
    }


def _create_backup_payload(_target: Any = None) -> dict[str, Any]:
    return {"label": "matrix_test"}


def _restore_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "archive_filename": "non_existent.tar.gz",
        "create_prerestore_snapshot": True,
        "confirmation_phrase": "RESTORE",
        "reason": "Authorization matrix restore request",
    }


def _patch_backup_settings_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "version_id": ver,
        "schedule_enabled": False,
        "frequency": "DAILY",
        "run_at": "02:00:00",
        "weekly_day": None,
        "destination_dir": None,
        "retention_count": 30,
        "reason": "Matrix testing backup settings update",
    }


def _patch_security_policy_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "version_id": ver,
        "session_idle_minutes": 30,
        "session_absolute_hours": 12,
        "lockout_threshold": 5,
        "lockout_minutes": 15,
        "password_min_length": 12,
        "reason": "Matrix testing security policy update",
    }


def _put_template_response_payload(target: Any = None) -> dict[str, Any]:
    ver_id = getattr(target, "template_version_id", 1) if target else 1
    return {
        "template_version_id": ver_id,
        "response_data": {"findings": "Assessment completed"},
    }


def _put_vitals_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "height_cm": 170.0,
        "weight_kg": 70.0,
        "blood_pressure_systolic": 120,
        "blood_pressure_diastolic": 80,
    }


def _create_follow_up_recommendation_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "recommended_date": "2026-11-20",
        "clinical_reason": "Follow-up evaluation",
    }


def _book_follow_up_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "appointment_date": "2026-11-20",
    }


def _close_follow_up_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "reason": "Patient decided to follow up elsewhere",
    }


def _put_prescription_payload(target: Any = None) -> dict[str, Any]:
    ver = getattr(target, "version_id", 1) if target else 1
    return {
        "diagnosis": "Updated Diagnosis",
        "version_id": ver,
        "items": [
            {
                "item_order": 1,
                "medicine_name": "Paracetamol 500mg",
                "dosage": "1 tablet",
                "frequency": "TDS",
                "duration_days": 5,
            }
        ],
    }


def _cancel_prescription_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "reason": "Adverse drug reaction reported",
    }


MATRIX: list[MatrixRow] = [
    # Admin Panel (Module 02, 06, 09, 10, 12)
    # Departments (All Specialties)
    MatrixRow(
        method="GET",
        path="/api/departments",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/departments",
        body_factory=_create_department_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/departments/{department_id}",
        body_factory=_patch_department_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/departments/{department_id}/doctors",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/doctors/{doctor_id}/departments",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PUT",
        path="/api/doctors/{doctor_id}/departments",
        body_factory=_assign_doctor_departments_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    # Billing and Timeline (Phase 15)
    MatrixRow(
        method="POST",
        path="/api/payments",
        body_factory=_create_payment_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 201,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/payments/{id}/receipt",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/payments/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/{patient_id}/payments",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/billing/pending-dues",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/payments/{id}/reverse",
        body_factory=_reverse_payment_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/{patient_id}/timeline",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/auth/me",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/auth/logout",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 204,
            "reception": 204,
            "doctor_a": 204,
            "doctor_b": 204,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/auth/change-password",
        body_factory=_change_password_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/overview",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/reception/overview",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/doctor/overview",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/users",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users",
        body_factory=_create_user_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/users/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/users/{id}",
        body_factory=_patch_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/deactivate",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/reactivate",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/reset-password",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/bulk-delete",
        body_factory=_bulk_delete_users_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/delete",
        body_factory=_delete_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/unlock",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/setup/status",
        body_factory=None,
        expected={
            "anonymous": 410,
            "admin": 410,
            "reception": 410,
            "doctor_a": 410,
            "doctor_b": 410,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/setup/admin",
        body_factory=_setup_admin_payload,
        expected={
            "anonymous": 410,
            "admin": 410,
            "reception": 410,
            "doctor_a": 410,
            "doctor_b": 410,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/settings",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/settings",
        body_factory=_patch_settings_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/doctors",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/doctors",
        body_factory=_create_doctor_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/doctors/{id}",
        body_factory=_patch_doctor_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/doctors/me/settings",
        body_factory=_patch_doctor_me_settings_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/fees",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/fees",
        body_factory=_create_fee_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/fees/{id}",
        body_factory=_patch_fee_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/patients",
        body_factory=_create_patient_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 201,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/check-duplicate",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/count",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/patients/{id}",
        body_factory=_patch_patient_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/patients/{id}/photo",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/{id}/photo",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/appointments",
        body_factory=_create_appointment_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 201,
            "doctor_a": 201,
            "doctor_b": 201,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/appointments",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/appointments/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/appointments/{id}/status",
        body_factory=_patch_appointment_status_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/appointments/queue/today",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/doctor/queue",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/encounters",
        body_factory=_create_encounter_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 201,
            "doctor_b": 201,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/encounters/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/{patient_id}/encounters",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/encounters/unfinished",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/encounters/{id}",
        body_factory=_patch_encounter_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/encounters/{id}/finalise",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/encounters/{id}/addenda",
        body_factory=_create_addendum_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 201,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/encounters/{id}/template-response",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PUT",
        path="/api/encounters/{id}/template-response",
        body_factory=_put_template_response_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/encounters/{encounter_id}/vitals",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PUT",
        path="/api/encounters/{encounter_id}/vitals",
        body_factory=_put_vitals_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/encounters/{id}/follow-up",
        body_factory=_create_follow_up_recommendation_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 201,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/encounters/{id}/follow-up",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/templates/active",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/templates/by-department/{department_id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/templates/versions/{version_id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/reception/follow-ups",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/follow-ups/{id}/book",
        body_factory=_book_follow_up_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/follow-ups/{id}/close",
        body_factory=_close_follow_up_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/prescriptions",
        body_factory=_create_prescription_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 201,
            "doctor_b": 201,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/prescriptions/follow-ups",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/prescriptions/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PUT",
        path="/api/prescriptions/{id}",
        body_factory=_put_prescription_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/prescriptions/{id}/authorise",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/prescriptions/{id}/cancel",
        body_factory=_cancel_prescription_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/{patient_id}/prescriptions",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/treatment-plans",
        body_factory=_create_treatment_plan_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 201,
            "doctor_b": 201,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/treatment-plans/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/patients/{patient_id}/treatment-plans",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/treatment-plans/{id}",
        body_factory=_patch_treatment_plan_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/treatment-plans/{plan_id}/sessions",
        body_factory=_create_treatment_session_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 201,
            "doctor_b": 404,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/treatment-plans/{plan_id}/sessions",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/treatment-sessions/{id}",
        body_factory=_patch_treatment_session_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 400,
            "doctor_b": 400,
        },
    ),
    MatrixRow(
        method="DELETE",
        path="/api/treatment-sessions/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 400,
            "doctor_b": 400,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/treatment-sessions/{id}/addenda",
        body_factory=_create_session_addendum_payload,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 201,
            "doctor_b": 404,
        },
    ),
    # Phase 16: Audit Viewer & Operations
    MatrixRow(
        method="GET",
        path="/api/audit-logs",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/audit-logs/actions",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/operations/backups",
        body_factory=_create_backup_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/operations/backups",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/operations/restore",
        body_factory=_restore_payload,
        expected={
            "anonymous": 401,
            "admin": 422,  # non-existent file returns 422
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/operations/integrity",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/operations/integrity/history",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/operations/integrity/run",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/revoke-sessions",
        body_factory=lambda _=None: {"reason": "Revoking user sessions matrix test"},
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/users/{id}/login-history",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/billing/configuration",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/billing/ledger",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/operations/backup-settings",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/operations/backup-settings",
        body_factory=_patch_backup_settings_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/operations/backup-runs",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/operations/backups/{filename}/verify",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/roles/permissions",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/sessions",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/sessions/{session_id}/revoke",
        body_factory=lambda _=None: {"reason": "Revoking session matrix test"},
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/security/policy",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/security/policy",
        body_factory=_patch_security_policy_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/security/password-policy",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/system/status",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    # Phase 20: Data Governance & Asset Management
    MatrixRow(
        method="GET",
        path="/api/admin/management-overview",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/assets",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/assets",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/assets/{asset_id}/deactivate",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/assets/{asset_id}/file",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/patients/search",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/admin/patients/{id}/demographics",
        body_factory=_patch_demographics_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/imports/inspect",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/imports",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/imports/{batch_id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/imports/{batch_id}/validate",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/imports/{batch_id}/duplicates",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/imports/{batch_id}/resolve",
        body_factory=lambda _: {"resolutions": []},
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/imports/{batch_id}/commit",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/imports/{batch_id}/errors",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/admin/exports",
        body_factory=_export_patients_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/templates",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/templates/{doc_type}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/admin/templates/{doc_type}",
        body_factory=_patch_print_template_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
]


def check_matrix_completeness(app: FastAPI, matrix: list[MatrixRow]) -> list[str]:
    """Return all non-public (method, path) endpoints lacking an entry in matrix."""
    matrix_pairs = {(r.method, r.path) for r in matrix}
    uncovered: list[str] = []

    for method, path, dep in walk_routes(app):
        if dep is None:
            continue
        pols = list(_policies(dep))
        if pols and pols[0].kind != "public":
            if (method, path) not in matrix_pairs:
                uncovered.append(f"{method} {path}")

    return uncovered


def build_isolated_client(
    app: FastAPI,
    db_session: Session,
    settings: Settings,
    login_client: Callable[[User], TestClient],
    identity: str,
    make_user_fn: Callable[..., User],
) -> tuple[TestClient, User | None]:
    """Provision a fresh user and client for the target role to prevent state leakage."""
    if identity == "anonymous":
        anon_client = TestClient(
            app,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
        )
        return anon_client, None

    uid = uuid.uuid4().hex[:8]
    if identity == "admin":
        user = make_user_fn(
            db_session,
            settings,
            role="ADMIN",
            username=f"mat_admin_{uid}",
        )
    elif identity == "reception":
        user = make_user_fn(
            db_session,
            settings,
            role="RECEPTION",
            username=f"mat_rec_{uid}",
        )
    elif identity == "doctor_a":
        user = make_user_fn(
            db_session,
            settings,
            role="DOCTOR",
            username=f"mat_doc_a_{uid}",
            doctor_name=f"Dr. Anil {uid}",
        )
    elif identity == "doctor_b":
        user = make_user_fn(
            db_session,
            settings,
            role="DOCTOR",
            username=f"mat_doc_b_{uid}",
            doctor_name=f"Dr. Bharati {uid}",
        )
    else:
        raise ValueError(f"Unknown test identity: {identity}")

    auth_client = login_client(user)
    return auth_client, user
