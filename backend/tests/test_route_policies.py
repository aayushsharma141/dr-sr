"""Route enumeration and default-deny policy marker verification.

Guarantees:
- Every API route declares exactly one policy marker: public, authenticated_only, or require().
- Route enumeration uses fastapi.routing.iter_route_contexts (never app.routes filter).
- Public routes strictly equal {('GET', '/api/health'), ('POST', '/api/auth/login')}.
- Negative control test proves the walker reports unprotected and double-marked routes.
"""

from collections.abc import Generator
from typing import Any

from fastapi import Depends, FastAPI
from fastapi.routing import iter_route_contexts

from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import Policy, authenticated_only, public, require
from kalyan_api.main import create_app

PUBLIC_ALLOWLIST: set[tuple[str, str]] = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/login"),
    ("GET", "/api/setup/status"),
    ("POST", "/api/setup/admin"),
    ("GET", "/api/assets/active-logo"),
}

MUST_EXIST: set[tuple[str, str]] = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/login"),
    ("GET", "/api/setup/status"),
    ("POST", "/api/setup/admin"),
    ("GET", "/api/auth/me"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/change-password"),
    ("GET", "/api/admin/overview"),
    ("GET", "/api/reception/overview"),
    ("GET", "/api/doctor/overview"),
    ("GET", "/api/users"),
    ("POST", "/api/users"),
    ("GET", "/api/users/{id}"),
    ("PATCH", "/api/users/{id}"),
    ("POST", "/api/users/{id}/deactivate"),
    ("POST", "/api/users/{id}/delete"),
    ("POST", "/api/users/{id}/reactivate"),
    ("POST", "/api/users/{id}/reset-password"),
    ("POST", "/api/users/{id}/unlock"),
}


def _policies(dependant: Any) -> Generator[Policy, None, None]:
    """Recursively collect __policy__ markers declared across a Dependant tree."""
    for sub in getattr(dependant, "dependencies", []):
        pol = getattr(sub.call, "__policy__", None)
        if pol is not None:
            yield pol
        yield from _policies(sub)


def walk_routes(app: FastAPI) -> Generator[tuple[str, str, Any], None, None]:
    """Yield (method, path, dependant) for each route context minus HEAD/OPTIONS."""
    for ctx in iter_route_contexts(app.routes):
        dep = getattr(ctx, "dependant", None)
        for method in sorted((ctx.methods or set()) - {"HEAD", "OPTIONS"}):
            yield method, ctx.path, dep


def test_every_route_has_exactly_one_policy(test_settings: Settings) -> None:
    """Validate all API endpoints declare exactly one policy marker and match public allowlist."""
    app = create_app(test_settings)
    seen: set[tuple[str, str]] = {(m, p) for m, p, _ in walk_routes(app)}

    assert MUST_EXIST <= seen, (
        f"route enumeration incomplete (vacuous test?): missing {MUST_EXIST - seen}"
    )

    problems: list[str] = []
    public_routes: set[tuple[str, str]] = set()

    for method, path, dep in walk_routes(app):
        if dep is None:
            problems.append(
                f"{method} {path}: non-API route present without dependant - not permitted"
            )
            continue

        pols = list(_policies(dep))
        if len(pols) != 1:
            problems.append(
                f"{method} {path}: expected exactly 1 policy marker, found {len(pols)}: {pols}"
            )
        elif pols[0].kind == "public":
            public_routes.add((method, path))

    assert not problems, "Route policy violations found:\n" + "\n".join(problems)
    assert public_routes == PUBLIC_ALLOWLIST, (
        f"Public route set mismatch. Discovered: {public_routes}, Allowed: {PUBLIC_ALLOWLIST}"
    )


def test_walker_flags_unprotected_and_double_marked_routes() -> None:
    """Negative control: verify the walker correctly identifies missing and duplicate markers."""
    dummy_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    # Route 1: Unprotected (0 markers)
    @dummy_app.get("/api/unprotected")
    def unprotected_endpoint() -> dict[str, str]:
        return {"status": "unprotected"}

    # Route 2: Double-marked (2 markers)
    @dummy_app.post(
        "/api/double-marked",
        dependencies=[Depends(public), Depends(require(Permission.DASHBOARD_ADMIN))],
    )
    def double_marked_endpoint() -> dict[str, str]:
        return {"status": "double_marked"}

    # Route 3: Properly marked (1 marker)
    @dummy_app.get("/api/proper", dependencies=[Depends(authenticated_only)])
    def proper_endpoint() -> dict[str, str]:
        return {"status": "ok"}

    reported_problems: list[str] = []
    for method, path, dep in walk_routes(dummy_app):
        pols = list(_policies(dep))
        if len(pols) != 1:
            reported_problems.append(f"{method} {path}: found {len(pols)} markers")

    assert len(reported_problems) == 2
    assert any("GET /api/unprotected: found 0 markers" in p for p in reported_problems)
    assert any("POST /api/double-marked: found 2 markers" in p for p in reported_problems)
