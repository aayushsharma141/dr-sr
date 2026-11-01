"""OpenAPI snapshot drift test (Plan 11-16 Task 2).

Guarantees that any change to API endpoints, methods, operation IDs, or schema
models triggers an explicit test failure unless the developer intentionally updates
the committed snapshot via:
    python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json
"""

import json
from pathlib import Path

from kalyan_api.main import create_app

SNAPSHOT_PATH = Path(__file__).parent / "openapi.snapshot.json"


def test_openapi_snapshot_exists() -> None:
    """The OpenAPI snapshot file must exist and be valid JSON."""
    assert SNAPSHOT_PATH.is_file(), (
        f"Snapshot file missing at {SNAPSHOT_PATH}. Generate it with:\n"
        "python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json"
    )


def test_openapi_snapshot_matches() -> None:
    """Current app.openapi() must match the committed snapshot.

    Checks paths, HTTP methods, operation IDs, and component schema names.
    """
    assert SNAPSHOT_PATH.is_file(), f"Snapshot missing at {SNAPSHOT_PATH}"
    snapshot_raw = SNAPSHOT_PATH.read_text(encoding="utf-8")
    snapshot_data = json.loads(snapshot_raw)

    app = create_app()
    current_data = app.openapi()

    # 1. Compare paths
    current_paths = set(current_data.get("paths", {}).keys())
    snapshot_paths = set(snapshot_data.get("paths", {}).keys())

    paths_added = current_paths - snapshot_paths
    paths_removed = snapshot_paths - current_paths
    assert not paths_added and not paths_removed, (
        f"OpenAPI paths changed! Added: {paths_added}, Removed: {paths_removed}. "
        "Run 'python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json' "
        "if this change is intentional."
    )

    # 2. Compare methods and operation IDs
    current_ops = {}
    for path, path_item in current_data.get("paths", {}).items():
        for method, op_info in path_item.items():
            if method.lower() in {"get", "post", "put", "delete", "patch", "options", "head"}:
                op_id = op_info.get("operationId") or op_info.get("operation_id")
                current_ops[(path, method.lower())] = op_id

    snapshot_ops = {}
    for path, path_item in snapshot_data.get("paths", {}).items():
        for method, op_info in path_item.items():
            if method.lower() in {"get", "post", "put", "delete", "patch", "options", "head"}:
                op_id = op_info.get("operationId") or op_info.get("operation_id")
                snapshot_ops[(path, method.lower())] = op_id

    assert current_ops == snapshot_ops, (
        f"OpenAPI operations/methods drifted!\n"
        f"Current: {current_ops}\n"
        f"Snapshot: {snapshot_ops}\n"
        "Run 'python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json'."
    )

    # 3. Compare component schemas
    current_schemas = set(current_data.get("components", {}).get("schemas", {}).keys())
    snapshot_schemas = set(snapshot_data.get("components", {}).get("schemas", {}).keys())

    schemas_added = current_schemas - snapshot_schemas
    schemas_removed = snapshot_schemas - current_schemas
    assert not schemas_added and not schemas_removed, (
        f"OpenAPI schemas changed! Added: {schemas_added}, Removed: {schemas_removed}. "
        "Run 'python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json'."
    )

    # 4. Strict structural comparison (normalized dumps)
    current_norm = json.loads(json.dumps(current_data, sort_keys=True))
    assert current_norm == snapshot_data, (
        "OpenAPI specification structural details differ from snapshot. "
        "Run 'python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json'."
    )
