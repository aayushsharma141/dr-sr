"""
Patient Repository providing parameterized SQLite CRUD operations,
atomic sequential ID generation, and multi-field search.
"""

from datetime import datetime
from pathlib import Path
from typing import Any

from app.db.connection import get_db_connection


class PatientRepository:
    """Data Access Object for Patient records and ID sequences."""

    def __init__(self, db_path: Path | str | None = None):
        self.db_path = db_path

    def generate_next_urn(self, year: int | None = None) -> str:
        """
        Atomically increments and returns the next sequential Patient URN
        for the given year (e.g., 'KH-2026-0001').
        """
        current_year = year or datetime.now().year
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("BEGIN IMMEDIATE")

            # Check if sequence row exists for the year
            cursor.execute(
                "SELECT last_seq FROM id_sequences WHERE year = ?",
                (current_year,),
            )
            row = cursor.fetchone()

            if row is None:
                new_seq = 1
                cursor.execute(
                    "INSERT INTO id_sequences (year, last_seq) VALUES (?, ?)",
                    (current_year, new_seq),
                )
            else:
                new_seq = row["last_seq"] + 1
                cursor.execute(
                    "UPDATE id_sequences SET last_seq = ? WHERE year = ?",
                    (new_seq, current_year),
                )

            conn.commit()
            return f"KH-{current_year}-{new_seq:04d}"
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create(self, data: dict[str, Any]) -> int:
        """
        Inserts a new patient record using 100% parameterized SQL.
        Returns the integer primary key id.
        """
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO patients (
                    serial_urn_no, patient_name, age, sex, address,
                    mobile_no, patient_in, patient_out, referred_by,
                    patient_condition, photo_filename, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data["serial_urn_no"],
                    data["patient_name"],
                    data["age"],
                    data["sex"],
                    data.get("address", ""),
                    data["mobile_no"],
                    data.get("patient_in") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    data.get("patient_out"),
                    data.get("referred_by", ""),
                    data["patient_condition"],
                    data.get("photo_filename", ""),
                    data.get("status", "ACTIVE"),
                ),
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_by_id(self, patient_id: int) -> dict[str, Any] | None:
        """Fetches a single patient by primary key id."""
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM patients WHERE id = ?", (patient_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_by_urn(self, serial_urn_no: str) -> dict[str, Any] | None:
        """Fetches a single patient by unique Serial / URN No."""
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM patients WHERE serial_urn_no = ?",
                (serial_urn_no,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def update(self, patient_id: int, data: dict[str, Any]) -> bool:
        """
        Updates editable patient fields and sets updated_at timestamp.
        """
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE patients SET
                    patient_name = ?,
                    age = ?,
                    sex = ?,
                    address = ?,
                    mobile_no = ?,
                    patient_in = ?,
                    patient_out = ?,
                    referred_by = ?,
                    patient_condition = ?,
                    photo_filename = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
                """,
                (
                    data["patient_name"],
                    data["age"],
                    data["sex"],
                    data.get("address", ""),
                    data["mobile_no"],
                    data.get("patient_in") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    data.get("patient_out"),
                    data.get("referred_by", ""),
                    data["patient_condition"],
                    data.get("photo_filename", ""),
                    patient_id,
                ),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def soft_delete(self, patient_id: int) -> bool:
        """
        Soft-deletes a patient record by marking status as 'ARCHIVED'.
        Does not physically delete rows to preserve clinical audit trails.
        """
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE patients SET
                    status = 'ARCHIVED',
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
                """,
                (patient_id,),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def search(
        self,
        query: str = "",
        limit: int = 50,
        filter_key: str = "all",
    ) -> list[dict[str, Any]]:
        """
        Searches active patient records by URN, name, and mobile number with optional
        read-only registry filters. No schema or persistence behavior is changed.
        """
        cleaned_query = query.strip()
        safe_limit = max(1, min(int(limit), 10000))
        clauses = ["p.status != 'ARCHIVED'"]
        params: list[Any] = []

        if cleaned_query:
            wildcard = f"%{cleaned_query}%"
            clauses.append(
                "(p.serial_urn_no LIKE ? OR p.patient_name LIKE ? OR p.mobile_no LIKE ?)"
            )
            params.extend((wildcard, wildcard, wildcard))

        normalized_filter = (filter_key or "all").strip().lower()
        if normalized_filter == "today":
            clauses.append(
                "date(COALESCE(NULLIF(p.patient_in, ''), p.created_at)) = date('now', 'localtime')"
            )
        elif normalized_filter == "active_therapy":
            clauses.append(
                """
                EXISTS (
                    SELECT 1 FROM treatment_cases tc
                    WHERE tc.patient_id = p.id
                      AND tc.status = 'IN_PROGRESS'
                )
                """
            )
        elif normalized_filter == "pending_balance":
            clauses.append(
                """
                EXISTS (
                    SELECT 1
                    FROM treatment_cases tc
                    WHERE tc.patient_id = p.id
                      AND tc.status = 'IN_PROGRESS'
                      AND tc.total_amount_paise > COALESCE(
                          (SELECT SUM(pay.amount_paid_paise)
                           FROM payments pay
                           WHERE pay.case_id = tc.id),
                          0
                      )
                )
                """
            )

        sql = f"""
            SELECT p.*
            FROM patients p
            WHERE {" AND ".join(clauses)}
            ORDER BY p.id DESC
            LIMIT ?
        """
        params.append(safe_limit)

        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()
