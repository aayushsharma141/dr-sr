"""Pending new-patient OPD arrivals before permanent registration."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request

from kalyan_api import clock
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import PendingOpdArrival
from kalyan_api.routers.appointments import _to_read_schema as appointment_read_schema
from kalyan_api.schemas.appointments import AppointmentRead
from kalyan_api.schemas.opd_arrivals import (
    OpdArrivalCreate,
    OpdArrivalList,
    OpdArrivalPriorityUpdate,
    OpdArrivalRead,
    OpdArrivalRegister,
)
from kalyan_api.services import opd_arrival_service

router = APIRouter(prefix="/opd-arrivals", tags=["opd-arrivals"])


def _to_read_schema(arrival: PendingOpdArrival) -> OpdArrivalRead:
    return OpdArrivalRead(
        id=arrival.id,
        full_name=arrival.full_name,
        age_years=arrival.age_years,
        mobile=arrival.mobile,
        doctor_id=arrival.doctor_id,
        doctor_name_en=arrival.doctor.name_en,
        department_id=arrival.department_id,
        department_name=arrival.department.name_en,
        appointment_date=arrival.appointment_date,
        token_number=arrival.token_number,
        priority_level=arrival.priority_level,
        priority_reason=arrival.priority_reason,
        status=arrival.status,
        version_id=arrival.version_id,
        created_at=arrival.created_at,
        patient_id=arrival.patient_id,
        appointment_id=arrival.appointment_id,
    )


@router.get(
    "", response_model=OpdArrivalList, dependencies=[Depends(require(Permission.APPOINTMENT_READ))]
)
def list_opd_arrivals(
    session: SessionDep,
    arrival_date: date = Query(default_factory=clock.ist_today),
) -> OpdArrivalList:
    arrivals = opd_arrival_service.list_arrivals(session, arrival_date)
    return OpdArrivalList(
        total=len(arrivals), arrivals=[_to_read_schema(item) for item in arrivals]
    )


@router.get(
    "/{arrival_id}",
    response_model=OpdArrivalRead,
    dependencies=[Depends(require(Permission.APPOINTMENT_READ))],
)
def read_opd_arrival(arrival_id: int, session: SessionDep) -> OpdArrivalRead:
    return _to_read_schema(opd_arrival_service.get_arrival(session, arrival_id))


@router.patch(
    "/{arrival_id}/priority",
    response_model=OpdArrivalRead,
    dependencies=[Depends(require(Permission.APPOINTMENT_WRITE))],
)
def update_opd_arrival_priority(
    arrival_id: int,
    payload: OpdArrivalPriorityUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> OpdArrivalRead:
    arrival = opd_arrival_service.update_arrival_priority(
        session,
        principal,
        arrival_id,
        payload,
        build_audit_context(request, principal),
    )
    return _to_read_schema(arrival)


@router.post(
    "",
    response_model=OpdArrivalRead,
    status_code=201,
    dependencies=[Depends(require(Permission.PATIENT_CREATE, Permission.APPOINTMENT_WRITE))],
)
def create_opd_arrival(
    payload: OpdArrivalCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> OpdArrivalRead:
    arrival = opd_arrival_service.create_arrival(
        session, principal, payload, build_audit_context(request, principal)
    )
    return _to_read_schema(arrival)


@router.post(
    "/{arrival_id}/register",
    response_model=AppointmentRead,
    status_code=201,
    dependencies=[Depends(require(Permission.PATIENT_CREATE, Permission.APPOINTMENT_WRITE))],
)
def register_opd_arrival(
    arrival_id: int,
    payload: OpdArrivalRegister,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    appointment = opd_arrival_service.register_arrival(
        session,
        principal,
        arrival_id,
        payload,
        build_audit_context(request, principal),
    )
    return appointment_read_schema(appointment)
