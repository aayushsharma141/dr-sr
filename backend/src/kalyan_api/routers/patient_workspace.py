"""Role-redacted Patient Workspace endpoints (T1.4).

Routes (mounted under /api in main.py):
- GET /api/patients/{patient_id}/summary
- GET /api/patients/{patient_id}/visits

Both endpoints are gated by Permission.PATIENT_READ and delegate strict role redaction
(D-04 clinical privacy, AGENTS.md #7 doctor financial boundary, DWS-04 cross-doctor audit)
to services/patient_summary_service.py.
"""

from fastapi import APIRouter, Depends, Query, Request

from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.schemas.patient_workspace import (
    PatientSummaryOut,
    PatientVisitHistoryResponse,
    VisitWorkspaceOut,
)
from kalyan_api.services import patient_summary_service

router = APIRouter(prefix="/patients", tags=["patient-workspace"])


@router.get(
    "/{patient_id}/summary",
    response_model=PatientSummaryOut,
    dependencies=[Depends(require(Permission.PATIENT_READ))],
)
def get_patient_summary(
    patient_id: int,
    session: SessionDep,
    request: Request,
    principal: Principal = Depends(current_principal),
) -> PatientSummaryOut:
    """Return role-redacted KPI summary, allergy projection, and latest visit/encounter."""
    return patient_summary_service.build_patient_summary(
        session=session,
        patient_id=patient_id,
        principal=principal,
        request=request,
    )


@router.get(
    "/{patient_id}/visits",
    response_model=PatientVisitHistoryResponse,
    dependencies=[Depends(require(Permission.PATIENT_READ))],
)
def get_patient_visits(
    patient_id: int,
    session: SessionDep,
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    principal: Principal = Depends(current_principal),
) -> PatientVisitHistoryResponse:
    """Return paginated, role-redacted visit history for a patient."""
    return patient_summary_service.list_patient_visit_history(
        session=session,
        patient_id=patient_id,
        principal=principal,
        limit=limit,
        offset=offset,
        request=request,
    )


@router.get(
    "/{patient_id}/visits/{visit_id}/workspace",
    response_model=VisitWorkspaceOut,
    dependencies=[Depends(require(Permission.PATIENT_READ))],
)
def get_patient_visit_workspace(
    patient_id: int,
    visit_id: int,
    session: SessionDep,
    request: Request,
    principal: Principal = Depends(current_principal),
) -> VisitWorkspaceOut:
    """Return unified role-redacted Encounter / Visit Workspace payload."""
    return patient_summary_service.build_visit_workspace(
        session=session,
        patient_id=patient_id,
        visit_id=visit_id,
        principal=principal,
        request=request,
    )
