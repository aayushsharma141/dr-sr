"""Route policy markers for default-deny permission enforcement."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Policy:
    """Policy metadata attached to endpoint route dependencies."""

    kind: str  # "public" | "authenticated" | "permission"
    permissions: frozenset[str] = frozenset()


def _mark(fn: Callable[..., Any], policy: Policy) -> Callable[..., Any]:
    """Attach policy metadata to dependency callable for route-walk introspection."""
    fn.__policy__ = policy  # type: ignore[attr-defined]
    return fn


def public() -> None:
    """Marker: intentionally reachable without session authentication (e.g. /api/health)."""
    return None


_mark(public, Policy("public"))

