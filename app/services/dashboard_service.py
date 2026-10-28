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

    def get_doctor_overview(self) -> list[dict[str, Any]]:
        """Per-doctor counts: patients registered today, patients on file, and active cases."""
        conn = get_db_connection(self.db_path)
        try:
            rows = conn.execute(
                """
                SELECT d.id AS doctor_id, d.name_en, d.department,
                    (SELECT COUNT(*) FROM patients p
                      WHERE p.doctor_id = d.id AND p.status != 'ARCHIVED'
                        AND date(p.created_at) = date('now', 'localtime')) AS today_registrations,
                    (SELECT COUNT(*) FROM patients p
                      WHERE p.doctor_id = d.id AND p.status != 'ARCHIVED') AS total_patients,
                    (SELECT COUNT(*) FROM treatment_cases tc
                      WHERE tc.doctor_id = d.id AND tc.status = 'IN_PROGRESS') AS active_cases
                FROM doctors d
                WHERE d.is_active = 1
                ORDER BY d.id
                """
            ).fetchall()
            return [dict(row) for row in rows]
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


    def get_today_activity(self, limit: int = 8) -> list[dict[str, Any]]:
        """
        Returns real registration and treatment-session activity for today's clinic view.

        The current schema does not model scheduled appointments or waiting-room status.
        This query intentionally reports only activity that is actually stored in SQLite.
        """
        safe_limit = max(1, min(int(limit), 100))
        conn = get_db_connection(self.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT a.*, d.name_en AS doctor_name
                FROM (
                    SELECT
                        p.id AS patient_id,
                        p.serial_urn_no,
                        p.patient_name,
                        p.age,
                        p.sex,
                        p.patient_condition,
                        p.doctor_id,
                        p.created_at AS activity_at,
                        'Registration' AS activity_type
                    FROM patients p
                    WHERE date(p.created_at) = date('now', 'localtime')
                      AND p.status != 'ARCHIVED'

                    UNION ALL

                    SELECT
                        p.id AS patient_id,
                        p.serial_urn_no,
                        p.patient_name,
                        p.age,
                        p.sex,
                        p.patient_condition,
                        p.doctor_id,
                        ts.session_timestamp AS activity_at,
                        'Treatment session logged' AS activity_type
                    FROM treatment_sessions ts
                    INNER JOIN treatment_cases tc ON tc.id = ts.case_id
                    INNER JOIN patients p ON p.id = tc.patient_id
                    WHERE date(ts.session_timestamp) = date('now', 'localtime')
                      AND p.status != 'ARCHIVED'
                ) a
                LEFT JOIN doctors d ON d.id = a.doctor_id
                ORDER BY activity_at DESC, patient_name COLLATE NOCASE ASC
                LIMIT ?
                """,
                (safe_limit,),
            )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()
