"""
Audit Service - Tamper-Evident Local Audit Trail for Clinical and System Events.
Kalyan Hospital Management System.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
from app.config import DB_PATH
from app.db.connection import get_db_connection


class AuditService:
    """Manages recording and querying auditable actions across the application."""

    def __init__(self, db_path: Optional[str | Path] = None):
        self.db_path = str(db_path) if db_path else str(DB_PATH)

    def _get_connection(self):
        return get_db_connection(self.db_path)

    def log_event(
        self,
        action: str,
        entity_type: str,
        entity_id: Optional[str | int] = None,
        actor_name: str = "System",
        details: Optional[str] = "",
        user_id: Optional[int] = None,
    ) -> int:
        """
        Inserts an immutable audit event record into the audit_logs table.

        Returns:
            The row ID of the created audit log entry.
        """
        action_clean = str(action).strip().upper()
        entity_type_clean = str(entity_type).strip().upper()
        entity_id_clean = str(entity_id).strip() if entity_id is not None else None
        actor_clean = str(actor_name).strip() if actor_name else "System"
        details_clean = str(details).strip() if details else ""

        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO audit_logs (user_id, actor_name, action, entity_type, entity_id, details)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, actor_clean, action_clean, entity_type_clean, entity_id_clean, details_clean),
            )
            conn.commit()
            return int(cursor.lastrowid or 0)

    def get_recent_logs(
        self,
        limit: int = 50,
        action: Optional[str] = None,
        entity_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Returns recent audit log records ordered newest first.
        """
        query = "SELECT * FROM audit_logs WHERE 1=1"
        params: List[Any] = []

        if action:
            query += " AND action = ?"
            params.append(action.strip().upper())
        if entity_type:
            query += " AND entity_type = ?"
            params.append(entity_type.strip().upper())

        query += " ORDER BY id DESC LIMIT ?"
        params.append(int(limit))

        with self._get_connection() as conn:
            cursor = conn.execute(query, tuple(params))
            return [dict(row) for row in cursor.fetchall()]

    def get_entity_history(self, entity_type: str, entity_id: str | int) -> List[Dict[str, Any]]:
        """
        Returns all chronological audit logs for a specific entity.
        """
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT * FROM audit_logs
                WHERE entity_type = ? AND entity_id = ?
                ORDER BY id ASC
                """,
                (entity_type.strip().upper(), str(entity_id).strip()),
            )
            return [dict(row) for row in cursor.fetchall()]

