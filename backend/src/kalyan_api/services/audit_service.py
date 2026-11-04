"""Synchronous, in-transaction audit logger and redaction guards (AUD-01)."""
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from sqlalchemy.orm import Session
from kalyan_api.models import AuditLog

class AuditAction(StrEnum):
    AUTH_LOGIN_SUCCEEDED="AUTH_LOGIN_SUCCEEDED"
    AUTH_LOGIN_FAILED="AUTH_LOGIN_FAILED"
    AUTH_ACCOUNT_LOCKED="AUTH_ACCOUNT_LOCKED"
    AUTH_LOGIN_THROTTLED="AUTH_LOGIN_THROTTLED"
    AUTH_LOGOUT="AUTH_LOGOUT"
    AUTH_PASSWORD_CHANGED="AUTH_PASSWORD_CHANGED"
    AUTH_PASSWORD_CHANGE_FAILED="AUTH_PASSWORD_CHANGE_FAILED"
    USER_CREATED="USER_CREATED"
    USER_UPDATED="USER_UPDATED"
    USER_ROLE_CHANGED="USER_ROLE_CHANGED"
    USER_DEACTIVATED="USER_DEACTIVATED"
    USER_REACTIVATED="USER_REACTIVATED"
    USER_PASSWORD_RESET="USER_PASSWORD_RESET"
    USER_UNLOCKED="USER_UNLOCKED"
    SETUP_CODE_REJECTED="SETUP_CODE_REJECTED"
    ADMIN_BOOTSTRAPPED="ADMIN_BOOTSTRAPPED"
    ADMIN_PASSWORD_RESET_CLI="ADMIN_PASSWORD_RESET_CLI"
    SETTINGS_UPDATED="SETTINGS_UPDATED"
    DOCTOR_CREATED="DOCTOR_CREATED"
    DOCTOR_UPDATED="DOCTOR_UPDATED"
    FEE_CREATED="FEE_CREATED"
    FEE_UPDATED="FEE_UPDATED"
    DEPARTMENT_CREATED="DEPARTMENT_CREATED"
    DEPARTMENT_UPDATED="DEPARTMENT_UPDATED"
    DOCTOR_DEPARTMENTS_UPDATED="DOCTOR_DEPARTMENTS_UPDATED"
    PATIENT_REGISTERED="PATIENT_REGISTERED"
    PATIENT_UPDATED="PATIENT_UPDATED"
    PHOTO_UPLOADED="PHOTO_UPLOADED"
    APPOINTMENT_CREATED="APPOINTMENT_CREATED"
    APPOINTMENT_STATUS_UPDATED="APPOINTMENT_STATUS_UPDATED"
    ENCOUNTER_CREATED="ENCOUNTER_CREATED"
    ENCOUNTER_FINALISED="ENCOUNTER_FINALISED"
    ENCOUNTER_ADDENDUM_ADDED="ENCOUNTER_ADDENDUM_ADDED"
    PRESCRIPTION_CREATED="PRESCRIPTION_CREATED"
    TREATMENT_PLAN_CREATED="TREATMENT_PLAN_CREATED"
    TREATMENT_PLAN_UPDATED="TREATMENT_PLAN_UPDATED"
    TREATMENT_PLAN_CANCELLED="TREATMENT_PLAN_CANCELLED"
    TREATMENT_SESSION_LOGGED="TREATMENT_SESSION_LOGGED"
    TREATMENT_SESSION_ADDENDUM_ADDED="TREATMENT_SESSION_ADDENDUM_ADDED"
    PAYMENT_RECORDED="PAYMENT_RECORDED"
    PAYMENT_REVERSED="PAYMENT_REVERSED"
    BACKUP_CREATED="BACKUP_CREATED"
    BACKUP_RESTORED="BACKUP_RESTORED"
    INTEGRITY_CHECK_RUN="INTEGRITY_CHECK_RUN"

class Outcome(StrEnum):
    SUCCESS="SUCCESS"
    FAILURE="FAILURE"
    DENIED="DENIED"

class AuditPayloadError(Exception):
    """Raised when an audit payload contains sensitive data."""

REDACTED_KEYS=frozenset({"password","password_hash","new_password","current_password","token","csrf_token"})

def _assert_no_redacted_keys(data: Any, path: str="") -> None:
    if isinstance(data, dict):
        for k,v in data.items():
            key=str(k).lower()
            if key in REDACTED_KEYS:
                raise AuditPayloadError(f"Forbidden sensitive key '{k}' in audit payload")
            _assert_no_redacted_keys(v, f"{path}.{k}" if path else str(k))
    elif isinstance(data,(list,tuple,set)):
        for i,item in enumerate(data):
            _assert_no_redacted_keys(item,f"{path}[{i}]")

@dataclass(frozen=True)
class AuditContext:
    actor_user_id:int|None
    actor_username:str|None
    actor_role:str|None
    ip:str|None=None
    user_agent:str|None=None
    request_id:uuid.UUID|str|None=None
    def __post_init__(self):
        if self.actor_username and len(self.actor_username)>64:
            object.__setattr__(self,"actor_username",self.actor_username[:64])
        if isinstance(self.request_id,str):
            try: object.__setattr__(self,"request_id",uuid.UUID(self.request_id))
            except ValueError: object.__setattr__(self,"request_id",None)
    @classmethod
    def system(cls,label:str,ip:str|None=None,user_agent:str|None=None)->"AuditContext":
        return cls(None,label[:64],"SYSTEM",ip,user_agent,None)

def diff(before:dict[str,Any]|None,after:dict[str,Any]|None):
    if before is None or after is None: return before,after
    old,new={},{}
    for k in set(before)|set(after):
        if before.get(k)!=after.get(k):
            if k in before: old[k]=before[k]
            if k in after: new[k]=after[k]
    return old,new

def snapshot(obj:Any,fields:Sequence[str])->dict[str,Any]:
    result={}
    for f in fields:
        if hasattr(obj,f):
            val=getattr(obj,f)
            result[f]=val.isoformat() if hasattr(val,"isoformat") else val
    return result

def record(session:Session,ctx:AuditContext,action:AuditAction|str,entity_type:str|None,entity_id:int|str|None,*,before:dict[str,Any]|None=None,after:dict[str,Any]|None=None,reason:str|None=None,outcome:Outcome|str=Outcome.SUCCESS)->AuditLog:
    action_str=str(action.value if hasattr(action,"value") else action)
    if len(action_str)>48: raise ValueError("Audit action exceeds maximum column length of 48 characters")
    if before is not None: _assert_no_redacted_keys(before)
    if after is not None: _assert_no_redacted_keys(after)
    req_uuid=ctx.request_id if isinstance(ctx.request_id,uuid.UUID) else None
    entry=AuditLog(actor_user_id=ctx.actor_user_id,actor_username=ctx.actor_username,actor_role=ctx.actor_role,action=action_str,outcome=str(outcome.value if hasattr(outcome,"value") else outcome),entity_type=entity_type,entity_id=str(entity_id) if entity_id is not None else None,before_data=before,after_data=after,reason=reason[:500] if reason else None,request_id=req_uuid,ip=ctx.ip,user_agent=ctx.user_agent[:255] if ctx.user_agent else None)
    session.add(entry); session.flush(); return entry
