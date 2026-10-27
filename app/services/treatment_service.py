"""
Treatment Service - Business Logic for Physiotherapy Cases & Clinical Sessions.
Kalyan Hospital Management System.
"""

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional
from app.repositories.treatment_repository import TreatmentRepository
from app.repositories.patient_repository import PatientRepository


class TreatmentService:
    """Coordinates case management, session recording, and clinical progress tracking."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path
        self.treatment_repo = TreatmentRepository(db_path)
        self.patient_repo = PatientRepository(db_path)

    @staticmethod
    def rupees_to_paise(rupees: Any) -> int:
        """Converts rupees to integer paise without binary floating point inaccuracy."""
        if rupees is None or str(rupees).strip() == "":
            return 0
        try:
            d = Decimal(str(rupees).strip()).quantize(Decimal("0.01"))
            return int(d * 100)
        except (InvalidOperation, ValueError) as exc:
            raise ValueError(f"Invalid monetary value: '{rupees}'") from exc

    def open_treatment_case(
        self,
        patient_id: int,
        title: str,
        no_of_sessions: int = 1,
        total_amount_rupees: Any = 0,
        notes: str = "",
        start_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Opens a new physiotherapy treatment case for an existing patient.
        """
        # Validate patient exists
        patient = self.patient_repo.get_by_id(patient_id)
        if not patient:
            raise ValueError(f"Patient with ID {patient_id} does not exist.")

        title = title.strip() if title else "Physiotherapy Treatment"
        if not title:
            raise ValueError("Treatment case title cannot be blank.")

        try:
            sessions = int(no_of_sessions)
            if sessions < 1:
                raise ValueError("Target number of sessions must be at least 1.")
        except (TypeError, ValueError) as exc:
            raise ValueError("Invalid number of sessions: must be a positive integer.") from exc

        total_amount_paise = self.rupees_to_paise(total_amount_rupees)
        if total_amount_paise < 0:
            raise ValueError("Total agreed fee cannot be negative.")

        case_data = {
            "patient_id": patient_id,
            "title": title,
            "no_of_sessions": sessions,
            "total_amount_paise": total_amount_paise,
            "notes": notes.strip() if notes else "",
            "start_date": start_date,
        }

        case_id = self.treatment_repo.create_case(case_data)
        saved = self.treatment_repo.get_case(case_id)
        if not saved:
            raise RuntimeError("Failed to retrieve treatment case after creation.")
        return saved

    def log_session(
        self,
        case_id: int,
        treatment_notes: str,
        therapist_name: str = "Dr. Chandan Kr. Dwivedi",
        modalities_used: str = "",
        pain_score: Optional[int] = None,
        session_timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Logs a dated treatment session with clinical notes, therapist name, and pain score.
        """
        case = self.treatment_repo.get_case(case_id)
        if not case:
            raise ValueError(f"Treatment case with ID {case_id} does not exist.")

        notes = treatment_notes.strip() if treatment_notes else ""
        if not notes:
            raise ValueError("Clinical treatment notes cannot be empty.")

        if pain_score is not None:
            try:
                ps = int(pain_score)
                if ps < 0 or ps > 10:
                    raise ValueError(f"Pain score must be between 0 and 10 (got {ps}).")
                pain_score = ps
            except (TypeError, ValueError) as exc:
                raise ValueError("Pain score must be an integer between 0 and 10.") from exc

        next_session_num = self.treatment_repo.get_next_session_number(case_id)

        session_data = {
            "case_id": case_id,
            "session_timestamp": session_timestamp,
            "therapist_name": therapist_name.strip() if therapist_name else "Physiotherapist",
            "session_number": next_session_num,
            "treatment_notes": notes,
            "modalities_used": modalities_used.strip() if modalities_used else "",
            "pain_score": pain_score,
        }

        session_id = self.treatment_repo.add_session(session_data)
        return {
            "id": session_id,
            **session_data,
        }

    def get_case_with_history(self, case_id: int) -> Dict[str, Any]:
        """
        Retrieves complete case information with chronological session history.
        """
        case = self.treatment_repo.get_case(case_id)
        if not case:
            raise ValueError(f"Treatment case with ID {case_id} does not exist.")

        sessions = self.treatment_repo.get_sessions_for_case(case_id)
        completed_sessions = len(sessions)
        target_sessions = case.get("no_of_sessions", 1)
        progress_pct = min(100, int((completed_sessions / target_sessions) * 100)) if target_sessions > 0 else 0

        return {
            **case,
            "completed_sessions": completed_sessions,
            "target_sessions": target_sessions,
            "progress_pct": progress_pct,
            "sessions": sessions,
        }

    def get_patient_cases(self, patient_id: int) -> List[Dict[str, Any]]:
        """
        Returns all treatment cases for a given patient.
        """
        return self.treatment_repo.get_cases_for_patient(patient_id)

    def update_case_status(self, case_id: int, new_status: str) -> bool:
        """
        Updates the case status ('IN_PROGRESS', 'COMPLETED', 'SUSPENDED').
        """
        if new_status not in ("IN_PROGRESS", "COMPLETED", "SUSPENDED"):
            raise ValueError(f"Invalid case status: {new_status}")
        return self.treatment_repo.update_case(case_id, {"status": new_status})
