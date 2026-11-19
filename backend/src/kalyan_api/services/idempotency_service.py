"""Atomic, PostgreSQL-backed idempotency service for reception mutation endpoints.

Guarantees:
- Scope isolation per `(actor_user_id, endpoint_key, idempotency_key)`.
- Same key + identical canonical SHA-256 payload hash replays exact `(status_code, body)`.
- Same key + different payload hash fails with HTTP 422 (`idempotency_key_payload_mismatch`).
- Concurrent identical retries serialize on a transaction-scoped PostgreSQL advisory lock
  (`pg_advisory_xact_lock`), released automatically on commit or rollback.
- Stored responses are flushed into the caller's active transaction (`SessionDep` commits
  atomically); failed transactions roll back leaving zero incomplete idempotency rows.
- Expired-key cleanup uses `FOR UPDATE SKIP LOCKED` to avoid lock contention across requests.
"""

import hashlib
import hmac
import json
from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Any, NamedTuple

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.models import IdempotencyKey

IDEMPOTENCY_HEADER = "Idempotency-Key"
MIN_KEY_LENGTH = 8
MAX_KEY_LENGTH = 128
DEFAULT_TTL_HOURS = 24
_CLEANUP_BATCH_LIMIT = 50


class IdempotentReplay(NamedTuple):
    """Exact stored 2xx response returned when an identical idempotent request is replayed."""

    status_code: int
    body: dict[str, Any]


def normalize_idempotency_key(raw_key: str | None) -> str | None:
    """Validate and trim a raw `Idempotency-Key` header value.

    Returns `None` when the header is absent (`raw_key is None`).
    Raises HTTP 422 (`invalid_idempotency_key`) if present but malformed (control/non-ASCII
    characters, empty, shorter than 8 chars, or longer than 128 chars).
    """
    if raw_key is None:
        return None

    # Reject control characters (including CR/LF/TAB) and non-ASCII before stripping so
    # leading/trailing control characters are never silently accepted.
    if any(ord(ch) < 0x20 or ord(ch) > 0x7E for ch in raw_key):
        raise ApiError(
            status_code=422,
            code="invalid_idempotency_key",
            message="Idempotency-Key must contain only printable ASCII characters.",
        )

    key = raw_key.strip(" ")
    if not (MIN_KEY_LENGTH <= len(key) <= MAX_KEY_LENGTH):
        raise ApiError(
            status_code=422,
            code="invalid_idempotency_key",
            message=(
                f"Idempotency-Key must be between {MIN_KEY_LENGTH} and {MAX_KEY_LENGTH} characters."
            ),
        )
    return key


def extract_idempotency_key(request: Request) -> str | None:
    """Extract and validate the optional `Idempotency-Key` header from a FastAPI request."""
    headers = request.headers
    if hasattr(headers, "getlist"):
        values = headers.getlist(IDEMPOTENCY_HEADER)
        if not values:
            return None
        if len(values) > 1:
            raise ApiError(
                status_code=422,
                code="invalid_idempotency_key",
                message="Multiple Idempotency-Key headers are not allowed.",
            )
        return normalize_idempotency_key(values[0])
    return normalize_idempotency_key(headers.get(IDEMPOTENCY_HEADER))


def hash_payload(payload: BaseModel | Mapping[str, Any]) -> str:
    """Compute a deterministic SHA-256 hex digest over a canonical JSON payload."""
    if isinstance(payload, BaseModel):
        data: Any = payload.model_dump(mode="json")
    else:
        data = jsonable_encoder(dict(payload))
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _acquire_scope_lock(
    session: Session,
    *,
    actor_user_id: int,
    endpoint_key: str,
    idempotency_key: str,
) -> None:
    """Serialize concurrent retries for the same `(actor_user_id, endpoint_key, key)` scope."""
    if session.get_bind().dialect.name != "postgresql":
        return
    # Length-prefix endpoint_key so colons in route keys (e.g. "POST:/appointments") cannot collide.
    lock_key = f"idempotency:{actor_user_id}:{len(endpoint_key)}:{endpoint_key}:{idempotency_key}"
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": lock_key},
    )


def _cleanup_expired_keys(session: Session, *, now: datetime) -> None:
    """Opportunistically purge up to 50 expired rows without blocking concurrent transactions."""
    if session.get_bind().dialect.name == "postgresql":
        session.execute(
            text(
                "DELETE FROM idempotency_keys "
                "WHERE id IN ("
                "  SELECT id FROM idempotency_keys "
                "  WHERE expires_at <= :now "
                "  LIMIT :batch_limit "
                "  FOR UPDATE SKIP LOCKED"
                ")"
            ),
            {"now": now, "batch_limit": _CLEANUP_BATCH_LIMIT},
        )
        return
    session.execute(delete(IdempotencyKey).where(IdempotencyKey.expires_at <= now))


def begin_idempotent_request(
    session: Session,
    *,
    actor_user_id: int,
    endpoint_key: str,
    idempotency_key: str,
    request_hash: str,
) -> IdempotentReplay | None:
    """Lock the idempotency scope, clean expired entries, and check for replay or mismatch.

    Returns:
    - `IdempotentReplay(status_code, body)` (unpackable as `(status_code, body)`) when an
      unexpired entry exists with an identical `request_hash`.
    - `None` when the caller should proceed to execute the mutation and then call
      `store_idempotent_response(...)` in the same transaction.

    Raises:
    - `ApiError(422, code="idempotency_key_payload_mismatch")` if an unexpired entry exists
      under the same scope with a different `request_hash`.
    """
    _acquire_scope_lock(
        session,
        actor_user_id=actor_user_id,
        endpoint_key=endpoint_key,
        idempotency_key=idempotency_key,
    )

    now = clock.utcnow()
    _cleanup_expired_keys(session, now=now)

    existing = session.scalar(
        select(IdempotencyKey).where(
            IdempotencyKey.actor_user_id == actor_user_id,
            IdempotencyKey.endpoint_key == endpoint_key,
            IdempotencyKey.idempotency_key == idempotency_key,
        )
    )
    if existing is None:
        return None

    if existing.expires_at <= now:
        # Delete expired row for this locked scope even if it fell outside the 50-row batch.
        session.delete(existing)
        session.flush()
        return None

    if not hmac.compare_digest(existing.request_hash, request_hash):
        raise ApiError(
            status_code=422,
            code="idempotency_key_payload_mismatch",
            message="Idempotency-Key was already used with a different request payload.",
        )

    return IdempotentReplay(
        status_code=existing.response_status,
        body=existing.response_body,
    )


def store_idempotent_response(
    session: Session,
    *,
    actor_user_id: int,
    endpoint_key: str,
    idempotency_key: str,
    request_hash: str,
    response_status: int,
    response_body: BaseModel | dict[str, Any],
    ttl_hours: int = DEFAULT_TTL_HOURS,
) -> IdempotencyKey:
    """Persist a 2xx idempotent response into the active DB transaction via `session.flush()`.

    Never calls `session.commit()` so `SessionDep` commits or rolls back the business mutation
    and idempotency record atomically.
    """
    if not (200 <= response_status < 300):
        raise ValueError(
            f"Only 2xx responses may be cached for idempotency replay; got {response_status}."
        )
    if ttl_hours <= 0:
        raise ValueError(f"ttl_hours must be positive; got {ttl_hours}.")

    body = (
        response_body.model_dump(mode="json")
        if isinstance(response_body, BaseModel)
        else response_body
    )
    now = clock.utcnow()
    record = IdempotencyKey(
        actor_user_id=actor_user_id,
        endpoint_key=endpoint_key,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        response_status=response_status,
        response_body=body,
        created_at=now,
        expires_at=now + timedelta(hours=ttl_hours),
    )
    session.add(record)
    session.flush()
    return record
