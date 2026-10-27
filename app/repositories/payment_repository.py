"""
Payment Repository - Data Access Layer for Financial Transactions.
Kalyan Hospital Management System.
"""

from typing import Any, Dict, List, Optional
from app.db.connection import get_db_connection


class PaymentRepository:
    """Handles parameterized SQL queries for payments and financial transactions."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path

    def _get_connection(self):
        return get_db_connection(self.db_path)

    def record_payment(self, payment_data: Dict[str, Any]) -> int:
        """
        Inserts a payment transaction record.
        
        Args:
            payment_data: Dict containing case_id, amount_paid_paise,
                          payment_timestamp (optional), payment_mode ('CASH', 'UPI', 'CARD', 'OTHER'),
                          reference_note (optional), recorded_by (optional).
        
        Returns:
            The primary key id of the newly inserted payment.
        """
        sql = """
            INSERT INTO payments (
                case_id, amount_paid_paise, payment_timestamp,
                payment_mode, reference_note, recorded_by
            ) VALUES (?, ?, COALESCE(?, datetime('now', 'localtime')), ?, ?, ?)
        """
        params = (
            payment_data["case_id"],
            int(payment_data["amount_paid_paise"]),
            payment_data.get("payment_timestamp"),
            payment_data.get("payment_mode", "CASH").upper(),
            payment_data.get("reference_note", "").strip() if payment_data.get("reference_note") else "",
            payment_data.get("recorded_by", "Staff").strip() if payment_data.get("recorded_by") else "Staff",
        )
        with self._get_connection() as conn:
            cursor = conn.execute(sql, params)
            payment_id = cursor.lastrowid
            conn.commit()
            return payment_id

    def get_payments_for_case(self, case_id: int) -> List[Dict[str, Any]]:
        """
        Fetches all payment installment records for a specific treatment case in chronological order.
        """
        sql = """
            SELECT * FROM payments
            WHERE case_id = ?
            ORDER BY payment_timestamp ASC, id ASC
        """
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (case_id,))
            return [dict(row) for row in cursor.fetchall()]

    def get_total_paid_paise(self, case_id: int) -> int:
        """
        Computes the sum of all payments made towards a treatment case in integer paise.
        """
        sql = "SELECT COALESCE(SUM(amount_paid_paise), 0) AS total_paid FROM payments WHERE case_id = ?"
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (case_id,))
            row = cursor.fetchone()
            return row["total_paid"] if row else 0

    def get_all_payments(self, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Retrieves the global payment ledger joined with case and patient details.
        """
        sql = """
            SELECT 
                p.*,
                tc.title AS case_title,
                tc.total_amount_paise,
                pat.id AS patient_id,
                pat.serial_urn_no,
                pat.patient_name,
                pat.mobile_no
            FROM payments p
            JOIN treatment_cases tc ON p.case_id = tc.id
            JOIN patients pat ON tc.patient_id = pat.id
            ORDER BY p.payment_timestamp DESC, p.id DESC
            LIMIT ?
        """
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (limit,))
            return [dict(row) for row in cursor.fetchall()]
