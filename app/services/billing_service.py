"""
Billing Service - Currency-Safe Financial Calculations in Integer Paise.
Kalyan Hospital Management System.
"""

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional
from app.repositories.payment_repository import PaymentRepository
from app.repositories.treatment_repository import TreatmentRepository


class BillingService:
    """
    Manages medical billing, payment installments, and balance calculations.
    
    All calculations strictly use integer paise (1 INR = 100 paise) to eliminate
    IEEE 754 floating-point rounding errors.
    """

    VALID_MODES = ("CASH", "UPI", "CARD", "OTHER")

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path
        self.payment_repo = PaymentRepository(db_path)
        self.treatment_repo = TreatmentRepository(db_path)

    @staticmethod
    def rupees_to_paise(rupees: Any) -> int:
        """
        Converts decimal rupees to integer paise safely using Decimal.
        
        Examples:
            150.50 -> 15050
            "1200" -> 120000
            0.10   -> 10
        """
        if rupees is None or str(rupees).strip() == "":
            return 0
        try:
            d = Decimal(str(rupees).strip()).quantize(Decimal("0.01"))
            return int(d * 100)
        except (InvalidOperation, ValueError) as exc:
            raise ValueError(f"Invalid monetary value: '{rupees}'") from exc

    @staticmethod
    def paise_to_rupees(paise: int) -> float:
        """Converts integer paise back to floating-point rupees for UI display."""
        return round(float(paise) / 100.0, 2)

    @staticmethod
    def format_inr(paise: int) -> str:
        """
        Formats integer paise as an Indian Rupee string.
        
        Example: 150000 paise -> "₹ 1,500.00"
        """
        negative = paise < 0
        abs_paise = abs(paise)
        rupees_int = abs_paise // 100
        paise_rem = abs_paise % 100

        # Indian Number Formatting (lakhs, crores)
        s = str(rupees_int)
        if len(s) > 3:
            last3 = s[-3:]
            remaining = s[:-3]
            groups = []
            while len(remaining) > 2:
                groups.insert(0, remaining[-2:])
                remaining = remaining[:-2]
            if remaining:
                groups.insert(0, remaining)
            formatted_int = ",".join(groups) + "," + last3
        else:
            formatted_int = s

        sign = "-" if negative else ""
        return f"{sign}₹ {formatted_int}.{paise_rem:02d}"

    def record_installment(
        self,
        case_id: int,
        amount_rupees: Any,
        payment_mode: str = "CASH",
        reference_note: str = "",
        recorded_by: str = "Staff",
        payment_timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Records a partial payment installment against a treatment case.
        
        Validates:
            - Case exists in database.
            - Payment amount is strictly greater than zero.
            - Payment mode is in ('CASH', 'UPI', 'CARD', 'OTHER').
            
        Returns:
            Dict containing receipt details, amount paid, updated total paid,
            and remaining balance in integer paise and formatted rupees.
        """
        case = self.treatment_repo.get_case(case_id)
        if not case:
            raise ValueError(f"Treatment case with ID {case_id} does not exist.")

        amount_paise = self.rupees_to_paise(amount_rupees)
        if amount_paise <= 0:
            raise ValueError("Payment amount must be greater than zero.")

        mode_clean = payment_mode.strip().upper() if payment_mode else "CASH"
        if mode_clean not in self.VALID_MODES:
            raise ValueError(f"Invalid payment mode: '{payment_mode}'. Must be one of {self.VALID_MODES}.")

        total_fee_paise = case.get("total_amount_paise", 0)
        current_paid_paise = self.payment_repo.get_total_paid_paise(case_id)
        new_total_paid_paise = current_paid_paise + amount_paise

        # Overpayment detection
        is_overpayment = new_total_paid_paise > total_fee_paise
        overpayment_amount_paise = max(0, new_total_paid_paise - total_fee_paise)

        payment_data = {
            "case_id": case_id,
            "amount_paid_paise": amount_paise,
            "payment_timestamp": payment_timestamp,
            "payment_mode": mode_clean,
            "reference_note": reference_note.strip() if reference_note else "",
            "recorded_by": recorded_by.strip() if recorded_by else "Staff",
        }

        payment_id = self.payment_repo.record_payment(payment_data)
        balance_paise = max(0, total_fee_paise - new_total_paid_paise)
        is_cleared = (new_total_paid_paise >= total_fee_paise)

        return {
            "payment_id": payment_id,
            "case_id": case_id,
            "amount_paid_paise": amount_paise,
            "amount_paid_rupees": self.paise_to_rupees(amount_paise),
            "amount_paid_formatted": self.format_inr(amount_paise),
            "total_fee_paise": total_fee_paise,
            "total_fee_formatted": self.format_inr(total_fee_paise),
            "new_total_paid_paise": new_total_paid_paise,
            "new_total_paid_formatted": self.format_inr(new_total_paid_paise),
            "balance_paise": balance_paise,
            "balance_formatted": self.format_inr(balance_paise),
            "is_cleared": is_cleared,
            "is_overpayment": is_overpayment,
            "overpayment_paise": overpayment_amount_paise,
            "overpayment_formatted": self.format_inr(overpayment_amount_paise),
            "payment_mode": mode_clean,
            "reference_note": payment_data["reference_note"],
        }

    def get_financial_summary(self, case_id: int) -> Dict[str, Any]:
        """
        Calculates complete financial summary for a treatment case:
        Total Fee, Total Paid, Balance Outstanding, and list of payments.
        """
        case = self.treatment_repo.get_case(case_id)
        if not case:
            raise ValueError(f"Treatment case with ID {case_id} does not exist.")

        total_fee_paise = case.get("total_amount_paise", 0)
        payments = self.payment_repo.get_payments_for_case(case_id)
        total_paid_paise = sum(p["amount_paid_paise"] for p in payments)
        balance_paise = max(0, total_fee_paise - total_paid_paise)
        is_cleared = (total_paid_paise >= total_fee_paise)
        is_overpayment = (total_paid_paise > total_fee_paise)
        overpayment_amount_paise = max(0, total_paid_paise - total_fee_paise)

        # Enrich payments with formatted amounts
        enriched_payments = []
        for p in payments:
            amt = p["amount_paid_paise"]
            enriched_payments.append({
                **p,
                "amount_rupees": self.paise_to_rupees(amt),
                "amount_formatted": self.format_inr(amt),
            })

        return {
            "case_id": case_id,
            "case_title": case.get("title", "Physiotherapy"),
            "patient_name": case.get("patient_name", ""),
            "serial_urn_no": case.get("serial_urn_no", ""),
            "total_fee_paise": total_fee_paise,
            "total_fee_rupees": self.paise_to_rupees(total_fee_paise),
            "total_fee_formatted": self.format_inr(total_fee_paise),
            "total_paid_paise": total_paid_paise,
            "total_paid_rupees": self.paise_to_rupees(total_paid_paise),
            "total_paid_formatted": self.format_inr(total_paid_paise),
            "balance_paise": balance_paise,
            "balance_rupees": self.paise_to_rupees(balance_paise),
            "balance_formatted": self.format_inr(balance_paise),
            "is_cleared": is_cleared,
            "is_overpayment": is_overpayment,
            "overpayment_paise": overpayment_amount_paise,
            "overpayment_formatted": self.format_inr(overpayment_amount_paise),
            "payment_count": len(payments),
            "payments": enriched_payments,
        }

    def get_recent_transactions(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves recent global transactions formatted for ledger display.
        """
        raw_payments = self.payment_repo.get_all_payments(limit)
        enriched = []
        for p in raw_payments:
            amt = p["amount_paid_paise"]
            enriched.append({
                **p,
                "amount_rupees": self.paise_to_rupees(amt),
                "amount_formatted": self.format_inr(amt),
            })
        return enriched
