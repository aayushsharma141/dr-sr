"""
Dashboard Service providing live statistical aggregates calculated from SQLite.
"""

from pathlib import Path
from typing import Any

from app.db.connection import get_db_connection


class DashboardService:
    """Calculates clinic operational and financial statistics from SQLite."""

    def __init__(self, db_path: Path | str | None = None):
        self.db_path = db_path

    def get_statistics(self) -> dict[str, Any]:
        """
        Executes aggregate queries on SQLite to return operational metrics.
        Never uses mocked numbers; returns exact 0 values on a fresh database.
        """
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()

            # 1. Total Registered Patients (active)
            cursor.execute(
                "SELECT COUNT(*) AS count FROM patients WHERE status != 'ARCHIVED'"
            )
            total_patients = cursor.fetchone()["count"]

            # 2. Today's Registrations
            cursor.execute(
                """
                SELECT COUNT(*) AS count FROM patients
                WHERE date(created_at) = date('now', 'localtime')
                  AND status != 'ARCHIVED'
                """
            )
            today_registrations = cursor.fetchone()["count"]

            # 3. Active Treatment Cases
            cursor.execute(
                "SELECT COUNT(*) AS count FROM treatment_cases WHERE status = 'IN_PROGRESS'"
            )
            active_cases = cursor.fetchone()["count"]

            # 4. Total Agreed Fee (Paise) for Active Cases
            cursor.execute(
                """
                SELECT COALESCE(SUM(total_amount_paise), 0) AS total_agreed
                FROM treatment_cases
                WHERE status = 'IN_PROGRESS'
                """
            )
            total_agreed_paise = cursor.fetchone()["total_agreed"]

            # 5. Total Paid (Paise) for Active Cases
            cursor.execute(
                """
                SELECT COALESCE(SUM(p.amount_paid_paise), 0) AS total_paid
                FROM payments p
                INNER JOIN treatment_cases tc ON p.case_id = tc.id
                WHERE tc.status = 'IN_PROGRESS'
                """
            )
            total_paid_paise = cursor.fetchone()["total_paid"]

            pending_balance_paise = max(0, total_agreed_paise - total_paid_paise)
            pending_balance_rupees = pending_balance_paise / 100.0

            return {
                "total_patients": total_patients,
                "today_registrations": today_registrations,
                "active_cases": active_cases,
                "total_agreed_paise": total_agreed_paise,
                "total_paid_paise": total_paid_paise,
                "pending_balance_paise": pending_balance_paise,
                "pending_balance_rupees": pending_balance_rupees,
            }
        finally:
            conn.close()

    def get_recent_registrations(self, limit: int = 5) -> list[dict[str, Any]]:
        """Returns the most recent registered patients for dashboard quick view."""
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, serial_urn_no, patient_name, age, sex, mobile_no,
                       patient_condition, created_at
                FROM patients
                WHERE status != 'ARCHIVED'
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()
