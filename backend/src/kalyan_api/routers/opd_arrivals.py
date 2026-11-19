"""Pending new-patient OPD arrivals before permanent registration."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import PendingOpdArrival
from kalyan_api.routers.appointments import _to_read_schema as appointment_read_schema
from kalyan_api.schemas.appointments import AppointmentRead
from kalyan_api.schemas.opd_arrivals import (
    OpdArrivalCancel,
    OpdArrivalCreate,
    OpdArrivalList,
    OpdArrivalPriorityUpdate,
    OpdArrivalRead,
    OpdArrivalRegister,
)
from kalyan_api.services import idempotency_service, opd_arrival_service

router = APIRouter(prefix="/opd-arrivals", tags=["opd-arrivals"])
_CREATE_ARRIVAL_ENDPOINT_KEY = "POST:/opd-arrivals"


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
        cancellation_reason=arrival.cancellation_reason,
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
    doctor_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=500, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(current_principal),
) -> OpdArrivalList:
    if principal.role == Role.DOCTOR:
        if principal.doctor_id is None:
            return OpdArrivalList(total=0, arrivals=[], limit=limit, offset=offset)
        if doctor_id is not None and doctor_id != principal.doctor_id:
            raise ApiError(
                status_code=403,
                code="scope_forbidden",
                message="Doctors can only inspect their own OPD arrivals.",
            )
        doctor_id = principal.doctor_id
    arrivals, total = opd_arrival_service.list_arrivals_page(
        session,
        arrival_date,
        doctor_id=doctor_id,
        limit=limit,
        offset=offset,
    )
    return OpdArrivalList(
        total=total,
        arrivals=[_to_read_schema(item) for item in arrivals],
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{arrival_id}",
    response_model=OpdArrivalRead,
    dependencies=[Depends(require(Permission.APPOINTMENT_READ))],
)
def read_opd_arrival(
    arrival_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> OpdArrivalRead:
    arrival = opd_arrival_service.get_arrival(session, arrival_id)
    if principal.role == Role.DOCTOR and (
        principal.doctor_id is None or arrival.doctor_id != principal.doctor_id
    ):
        raise ApiError(
            status_code=403,
            code="scope_forbidden",
            message="Doctors can only inspect their own OPD arrivals.",
        )
    return _to_read_schema(arrival)


@router.patch(
    "/{arrival_id}/priority",
    response_model=OpdArrivalRead,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
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
    "/{arrival_id}/cancel",
    response_model=OpdArrivalRead,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
)
def cancel_opd_arrival(
    arrival_id: int,
    payload: OpdArrivalCancel,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> OpdArrivalRead:
    arrival = opd_arrival_service.cancel_arrival(
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
) -> OpdArrivalRead | JSONResponse:
    idempotency_key = idempotency_service.extract_idempotency_key(request)
    request_hash: str | None = None
    if idempotency_key is not None:
        request_hash = idempotency_service.hash_payload(payload)
        replay = idempotency_service.begin_idempotent_request(
            session,
            actor_user_id=principal.user_id,
            endpoint_key=_CREATE_ARRIVAL_ENDPOINT_KEY,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if replay is not None:
            return JSONResponse(status_code=replay.status_code, content=replay.body)

    arrival = opd_arrival_service.create_arrival(
        session, principal, payload, build_audit_context(request, principal)
    )
    read_schema = _to_read_schema(arrival)
    if idempotency_key is not None and request_hash is not None:
        idempotency_service.store_idempotent_response(
            session,
            actor_user_id=principal.user_id,
            endpoint_key=_CREATE_ARRIVAL_ENDPOINT_KEY,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response_status=201,
            response_body=read_schema.model_dump(mode="json"),
        )
    return read_schema


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
