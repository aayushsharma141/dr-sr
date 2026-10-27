"""
Treatment Repository - Data Access Layer for Treatment Cases & Sessions.
Kalyan Hospital Management System.
"""

from typing import Any, Dict, List, Optional
from app.db.connection import get_db_connection


class TreatmentRepository:
    """Handles parameterized SQL queries for treatment cases and clinical sessions."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path

    def _get_connection(self):
        return get_db_connection(self.db_path)

    def create_case(self, case_data: Dict[str, Any]) -> int:
        """
        Creates a new treatment case for a patient.
        
        Args:
            case_data: Dict containing patient_id, title, no_of_sessions,
                       total_amount_paise, start_date (optional), notes (optional).
        
        Returns:
            The primary key id of the newly inserted case.
        """
        sql = """
            INSERT INTO treatment_cases (
                patient_id, title, no_of_sessions, total_amount_paise,
                start_date, notes, status
            ) VALUES (?, ?, ?, ?, COALESCE(?, date('now', 'localtime')), ?, 'IN_PROGRESS')
        """
        params = (
            case_data["patient_id"],
            case_data.get("title", "Physiotherapy Treatment").strip(),
            int(case_data.get("no_of_sessions", 1)),
            int(case_data.get("total_amount_paise", 0)),
            case_data.get("start_date"),
            case_data.get("notes", "").strip() if case_data.get("notes") else "",
        )
        with self._get_connection() as conn:
            cursor = conn.execute(sql, params)
            case_id = cursor.lastrowid
            conn.commit()
            return case_id

    def get_case(self, case_id: int) -> Optional[Dict[str, Any]]:
        """
        Retrieves a single treatment case by its primary key with joined patient info.
        """
        sql = """
            SELECT 
                tc.*,
                p.serial_urn_no,
                p.patient_name,
                p.mobile_no,
                p.age,
                p.sex,
                p.patient_condition
            FROM treatment_cases tc
            JOIN patients p ON tc.patient_id = p.id
            WHERE tc.id = ?
        """
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (case_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_cases_for_patient(self, patient_id: int) -> List[Dict[str, Any]]:
        """
        Retrieves all treatment cases belonging to a specific patient.
        """
        sql = """
            SELECT * FROM treatment_cases
            WHERE patient_id = ?
            ORDER BY created_at DESC
        """
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (patient_id,))
            return [dict(row) for row in cursor.fetchall()]

    def update_case(self, case_id: int, update_data: Dict[str, Any]) -> bool:
        """
        Updates editable fields on a treatment case (status, notes, title, etc.).
        """
        allowed_fields = [
            "title", "no_of_sessions", "total_amount_paise", "start_date",
            "end_date", "status", "notes"
        ]
        updates = []
        params = []
        for field in allowed_fields:
            if field in update_data:
                updates.append(f"{field} = ?")
                params.append(update_data[field])

        if not updates:
            return False

        params.append(case_id)
        sql = f"UPDATE treatment_cases SET {', '.join(updates)} WHERE id = ?"
        with self._get_connection() as conn:
            cursor = conn.execute(sql, params)
            conn.commit()
            return cursor.rowcount > 0

    def add_session(self, session_data: Dict[str, Any]) -> int:
        """
        Inserts a new clinical treatment session for a case.
        """
        sql = """
            INSERT INTO treatment_sessions (
                case_id, session_timestamp, therapist_name,
                session_number, treatment_notes, modalities_used, pain_score
            ) VALUES (?, COALESCE(?, datetime('now', 'localtime')), ?, ?, ?, ?, ?)
        """
        params = (
            session_data["case_id"],
            session_data.get("session_timestamp"),
            session_data.get("therapist_name", "Physiotherapist").strip(),
            int(session_data["session_number"]),
            session_data["treatment_notes"].strip(),
            session_data.get("modalities_used", "").strip(),
            session_data.get("pain_score"),
        )
        with self._get_connection() as conn:
            cursor = conn.execute(sql, params)
            session_id = cursor.lastrowid
            conn.commit()
            return session_id

    def get_sessions_for_case(self, case_id: int) -> List[Dict[str, Any]]:
        """
        Retrieves all past clinical sessions in strict chronological order.
        """
        sql = """
            SELECT * FROM treatment_sessions
            WHERE case_id = ?
            ORDER BY session_number ASC, session_timestamp ASC
        """
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (case_id,))
            return [dict(row) for row in cursor.fetchall()]

    def get_next_session_number(self, case_id: int) -> int:
        """
        Calculates the next sequential session number for a given case.
        """
        sql = """
            SELECT COALESCE(MAX(session_number), 0) + 1 AS next_seq
            FROM treatment_sessions
            WHERE case_id = ?
        """
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (case_id,))
            row = cursor.fetchone()
            return row["next_seq"] if row else 1

    def get_total_sessions_count(self, case_id: int) -> int:
        """
        Counts the total number of logged sessions for a given case.
        """
        sql = "SELECT COUNT(*) AS total_count FROM treatment_sessions WHERE case_id = ?"
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (case_id,))
            row = cursor.fetchone()
            return row["total_count"] if row else 0
