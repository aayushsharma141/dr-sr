"""Test support fixture providing isolated TEMPORARY tables for row-scope validation."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Column, Integer, MetaData, String, Table
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class ScopedSpec:
    """Specification mapping a table or model to its scope filter columns."""

    name: str
    table: Any
    doctor_id_col: Any
    id_col: Any


def create_temp_scoped_table(session: Session) -> tuple[Table, ScopedSpec]:
    """Create a temporary table in the current database connection for scope testing."""
    meta = MetaData()
    table = Table(
        "temp_scoped_test_records",
        meta,
        Column("id", Integer, primary_key=True),
        Column("doctor_id", Integer, nullable=True),
        Column("payload", String(120), nullable=False),
        prefixes=["TEMPORARY"],
    )
    table.create(bind=session.connection(), checkfirst=True)

    spec = ScopedSpec(
        name="temp_scoped_test_records",
        table=table,
        doctor_id_col=table.c.doctor_id,
        id_col=table.c.id,
    )
    return table, spec
