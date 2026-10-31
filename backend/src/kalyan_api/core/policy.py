"""Route policy markers for default-deny permission enforcement.

Guarantees:
- Every route declares exactly one policy marker: public, authenticated_only, or require().
- Markers are stamped with Policy objects (__policy__) for test route-walk validation.
- require() enforces that the user possesses all specified permissions, returning 403 on lack.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import Depends

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.principal import Principal, current_principal, current_principal_allow_pending


@dataclass(frozen=True)
class Policy:
    """Policy metadata attached to endpoint route dependencies."""

    kind: str  # "public" | "authenticated_only" | "require"
    permissions: frozenset[str] = frozenset()


def _mark(fn: Callable[..., Any], policy: Policy) -> Callable[..., Any]:
    """Attach policy metadata to dependency callable for route-walk introspection."""
    fn.__policy__ = policy  # type: ignore[attr-defined]
    return fn


def public() -> None:
    """Marker: intentionally reachable without session authentication (e.g. /api/health)."""
    return None


_mark(public, Policy("public"))


def _authenticated_only(
    principal: Principal = Depends(current_principal_allow_pending),
) -> Principal:
    """Marker: requires valid session; allows users with pending forced password change."""
    return principal


authenticated_only = _mark(_authenticated_only, Policy("authenticated_only"))


def require(*permissions: Permission) -> Callable[..., Principal]:
    """Marker: requires active principal possessing all listed permissions."""
    if not permissions:
        raise ValueError("require() takes at least one Permission")

    required_set = frozenset(permissions)
    policy = Policy(kind="require", permissions=frozenset(p.value for p in permissions))

    def _require_dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if not required_set.issubset(principal.permissions):
            missing = sorted(p.value for p in required_set - principal.permissions)
            raise ApiError(
                status_code=403,
                code="forbidden",
                message=f"Forbidden: insufficient permissions (missing: {', '.join(missing)})",
            )
        return principal

    return _mark(_require_dependency, policy)
