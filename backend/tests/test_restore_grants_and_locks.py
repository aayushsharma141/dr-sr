"""Regression checks for the PR #17 review: restore grants and membership lock queries."""

from typing import Any

from sqlalchemy.dialects import postgresql

from kalyan_api.routers.appointments import lock_doctor_for_booking
from kalyan_api.routers.departments import lock_departments_for_assignment
from kalyan_api.services.backup_service import RUNTIME_TABLE_GRANTS, runtime_grant_sql


def test_every_runtime_grant_is_guarded_by_its_table_existing() -> None:
    """An archive from before a table was added must still restore, so no grant may be unguarded."""
    sql = runtime_grant_sql("kalyan_app")
    for table in RUNTIME_TABLE_GRANTS:
        assert f"to_regclass('public.{table}') IS NOT NULL THEN GRANT" in sql
    unguarded = [
        line
        for line in sql.splitlines()
        if line.startswith("GRANT ") and "ALL SEQUENCES" not in line
    ]
    assert unguarded == []


class _CapturingSession:
    """Records the statement a helper sends, without touching a database."""

    def __init__(self) -> None:
        self.statements: list[Any] = []

    def scalar(self, statement: Any) -> None:
        self.statements.append(statement)
        return None

    def scalars(self, statement: Any) -> Any:
        self.statements.append(statement)

        class _Result:
            def all(self) -> list[Any]:
                return []

        return _Result()


def _sql(statement: Any) -> str:
    return str(
        statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )


def test_booking_locks_the_doctor_row() -> None:
    session = _CapturingSession()
    lock_doctor_for_booking(session, 7)  # type: ignore[arg-type]
    assert "FOR UPDATE" in _sql(session.statements[0])


def test_assignment_locks_department_rows_in_id_order() -> None:
    session = _CapturingSession()
    lock_departments_for_assignment(session, [9, 3])  # type: ignore[arg-type]
    sql = _sql(session.statements[0])
    assert "FOR UPDATE" in sql
    assert "ORDER BY departments.id" in sql
