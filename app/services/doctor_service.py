"""
Doctor Service: lists the clinicians who share the hospital's patient and payment records.
"""

from pathlib import Path
from typing import Any

from app.db.connection import get_db_connection


class DoctorService:
    """Read access to doctors and their departments."""

    def __init__(self, db_path: Path | str | None = None):
        self.db_path = db_path

    def list_doctors(self, active_only: bool = True) -> list[dict[str, Any]]:
        sql = "SELECT * FROM doctors"
        if active_only:
            sql += " WHERE is_active = 1"
        sql += " ORDER BY id"
        conn = get_db_connection(self.db_path)
        try:
            return [dict(row) for row in conn.execute(sql)]
        finally:
            conn.close()

    def get_doctor(self, doctor_id: int) -> dict[str, Any] | None:
        conn = get_db_connection(self.db_path)
        try:
            row = conn.execute("SELECT * FROM doctors WHERE id = ?", (doctor_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
