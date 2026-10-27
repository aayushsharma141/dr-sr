"""
Demo Seeder - Populates High-Fidelity Synthetic Patients and Resets Demo Dataset.
Kalyan Hospital Management System.
"""

import time
from typing import Any, Dict, List, Optional
from app.db.connection import get_db_connection
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService
from app.services.billing_service import BillingService


class DemoSeeder:
    """Manages synthetic demo patient data population and sub-second database resets."""

    DEMO_PATIENTS = [
        {
            "patient": {
                "patient_name": "Ramesh Kumar Sharma",
                "age": 45,
                "sex": "Male",
                "mobile_no": "9876543210",
                "address": "स्टेशन रोड, नवादा, आरा, भोजपुर",
                "patient_in": "2026-10-25 09:30",
                "patient_out": "2026-10-25 11:00",
                "referred_by": "Dr. S. K. Singh",
                "patient_condition": "Chronic Lumbar Spondylosis with L4-L5 Radiculopathy",
            },
            "case": {
                "title": "Lumbar Spondylosis Rehabilitation",
                "no_of_sessions": 10,
                "total_amount_rupees": 3500.0,
                "notes": "Patient reports severe lower back stiffness and radiating leg pain. Prescribed traction and IFT.",
            },
            "sessions": [
                {
                    "notes": "Day 1: Initial assessment. Lumbar traction 12kg and IFT applied for 15 minutes.",
                    "therapist": "Dr. Madan Mohan Dwivedi",
                    "modalities": "Lumbar Traction, IFT",
                    "pain_score": 8,
                },
                {
                    "notes": "Day 2: Patient reports slight relief in leg radiation. Increased traction to 14kg.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Lumbar Traction, Hot Pack, IFT",
                    "pain_score": 6,
                },
                {
                    "notes": "Day 3: Lumbar flexion exercises initiated. Patient feels significant improvement.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Lumbar Traction, Therapeutic Exercise",
                    "pain_score": 4,
                },
            ],
            "payments": [
                {
                    "amount": 1500.0,
                    "mode": "CASH",
                    "note": "1st Advance installment at intake",
                }
            ],
        },
        {
            "patient": {
                "patient_name": "Sunita Devi",
                "age": 38,
                "sex": "Female",
                "mobile_no": "9123456789",
                "address": "नवादा थाना के सामने वाली गली, आरा",
                "patient_in": "2026-10-26 10:15",
                "patient_out": "2026-10-26 11:30",
                "referred_by": "Self",
                "patient_condition": "Cervical Spondylosis with Trapezius Muscle Spasm",
            },
            "case": {
                "title": "Cervical Spine Mobilization & Traction",
                "no_of_sessions": 8,
                "total_amount_rupees": 2800.0,
                "notes": "Severe neck stiffness and headaches radiating from occipital region.",
            },
            "sessions": [
                {
                    "notes": "Day 1: Gentle cervical traction 4kg, Ultrasound therapy over bilateral trapezius.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Cervical Traction, Ultrasound Therapy (UST)",
                    "pain_score": 7,
                },
                {
                    "notes": "Day 2: Range of motion improved by 25%. Moist heat pack applied for 20 mins.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Moist Heat Pack, Manual Mobilization",
                    "pain_score": 5,
                },
            ],
            "payments": [
                {
                    "amount": 2800.0,
                    "mode": "UPI",
                    "note": "Full payment via Google Pay (Ref #987654)",
                }
            ],
        },
        {
            "patient": {
                "patient_name": "Rajesh Verma",
                "age": 62,
                "sex": "Male",
                "mobile_no": "9431023456",
                "address": "श्रीरामपुर रोड, गड़हनी, भोजपुर, बिहार",
                "patient_in": "2026-10-24 11:00",
                "patient_out": "2026-10-24 12:15",
                "referred_by": "Dr. R. P. Sinha",
                "patient_condition": "Bilateral Knee Osteoarthritis (Grade 2-3)",
            },
            "case": {
                "title": "Knee Joint Rehabilitation & Strengthening",
                "no_of_sessions": 12,
                "total_amount_rupees": 4200.0,
                "notes": "Difficulty walking and climbing stairs. Crepitus present bilaterally.",
            },
            "sessions": [
                {
                    "notes": "Day 1: Shortwave diathermy (SWD) and gentle isometric quadriceps exercises.",
                    "therapist": "Dr. Madan Mohan Dwivedi",
                    "modalities": "Shortwave Diathermy (SWD), Isometric Exercise",
                    "pain_score": 8,
                },
                {
                    "notes": "Day 2: Ultrasound therapy over medial joint line. Moist heat pack.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Ultrasound Therapy (UST), Moist Heat Pack",
                    "pain_score": 6,
                },
                {
                    "notes": "Day 3: Straight leg raises (SLR) with 1kg ankle cuff.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Therapeutic Exercise, SWD",
                    "pain_score": 5,
                },
                {
                    "notes": "Day 4: Walking tolerance increased to 20 minutes without acute pain.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Therapeutic Exercise",
                    "pain_score": 4,
                },
            ],
            "payments": [
                {
                    "amount": 1500.0,
                    "mode": "CASH",
                    "note": "1st Installment",
                },
                {
                    "amount": 1000.0,
                    "mode": "UPI",
                    "note": "2nd Installment via PhonePe",
                },
            ],
        },
        {
            "patient": {
                "patient_name": "Anita Singh",
                "age": 29,
                "sex": "Female",
                "mobile_no": "9988776655",
                "address": "बाबू बाजार, आरा, भोजपुर",
                "patient_in": "2026-10-27 14:00",
                "patient_out": "2026-10-27 15:00",
                "referred_by": "Dr. Anupama Kumari",
                "patient_condition": "Post-Traumatic Adhesive Capsulitis (Right Frozen Shoulder)",
            },
            "case": {
                "title": "Shoulder Range of Motion & Mobilization",
                "no_of_sessions": 6,
                "total_amount_rupees": 2400.0,
                "notes": "Right shoulder abduction restricted to 70 degrees. Prescribed manual mobilization.",
            },
            "sessions": [
                {
                    "notes": "Day 1: Moist heat pack followed by Maitland Grade II shoulder mobilization.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Moist Heat Pack, Manual Mobilization",
                    "pain_score": 7,
                },
            ],
            "payments": [
                {
                    "amount": 1000.0,
                    "mode": "CASH",
                    "note": "Advance payment",
                }
            ],
        },
        {
            "patient": {
                "patient_name": "Manoj Tiwary",
                "age": 50,
                "sex": "Male",
                "mobile_no": "9334512345",
                "address": "शाहपुर, भोजपुर, बिहार",
                "patient_in": "2026-10-25 15:30",
                "patient_out": "2026-10-25 16:45",
                "referred_by": "Dr. M. M. Dwivedi",
                "patient_condition": "Acute Piriformis Syndrome with Sciatic Nerve Entrapment",
            },
            "case": {
                "title": "Sciatic Nerve Decompression & Exercise Therapy",
                "no_of_sessions": 10,
                "total_amount_rupees": 3500.0,
                "notes": "Shooting pain down right buttock into calf. Positive Piriformis stretch test.",
            },
            "sessions": [
                {
                    "notes": "Day 1: TENS stimulation over piriformis motor point, deep tissue friction.",
                    "therapist": "Dr. Madan Mohan Dwivedi",
                    "modalities": "TENS Stimulation, Moist Heat Pack",
                    "pain_score": 9,
                },
                {
                    "notes": "Day 2: Piriformis stretching and neural flossing exercises taught.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Manual Therapy, Exercise",
                    "pain_score": 7,
                },
                {
                    "notes": "Day 3: Patient able to sit for 45 minutes without severe shooting pain.",
                    "therapist": "Dr. Chandan Kr. Dwivedi",
                    "modalities": "Therapeutic Exercise, TENS",
                    "pain_score": 5,
                },
            ],
            "payments": [
                {
                    "amount": 2000.0,
                    "mode": "UPI",
                    "note": "Advance via UPI Ref #543210",
                }
            ],
        },
    ]

    @classmethod
    def seed_demo_patients(cls, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
        """Populates the 5 standard demo patient records with cases, sessions, and payments."""
        p_service = PatientService(db_path)
        t_service = TreatmentService(db_path)
        b_service = BillingService(db_path)

        seeded = []
        for item in cls.DEMO_PATIENTS:
            # 1. Register Patient
            pat = p_service.register_patient(item["patient"])

            # 2. Open Treatment Case
            c_info = item["case"]
            case = t_service.open_treatment_case(
                patient_id=pat["id"],
                title=c_info["title"],
                no_of_sessions=c_info["no_of_sessions"],
                total_amount_rupees=c_info["total_amount_rupees"],
                notes=c_info.get("notes", ""),
            )

            # 3. Log Sessions
            for s in item.get("sessions", []):
                t_service.log_session(
                    case_id=case["id"],
                    treatment_notes=s["notes"],
                    therapist_name=s.get("therapist", "Dr. Chandan Kr. Dwivedi"),
                    modalities_used=s.get("modalities", ""),
                    pain_score=s.get("pain_score"),
                )

            # 4. Record Payments
            for p in item.get("payments", []):
                b_service.record_installment(
                    case_id=case["id"],
                    amount_rupees=p["amount"],
                    payment_mode=p.get("mode", "CASH"),
                    reference_note=p.get("note", ""),
                )

            seeded.append({
                "patient": pat,
                "case": case,
            })

        return seeded

    @classmethod
    def reset_to_demo_dataset(cls, db_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Clears all transactional data and populates clean synthetic demo records in < 1 second.
        """
        start_time = time.time()

        # Atomic database truncate
        with get_db_connection(db_path) as conn:
            conn.execute("PRAGMA foreign_keys = OFF;")
            conn.execute("DELETE FROM payments;")
            conn.execute("DELETE FROM treatment_sessions;")
            conn.execute("DELETE FROM treatment_cases;")
            conn.execute("DELETE FROM patients;")
            conn.execute("DELETE FROM id_sequences;")
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.commit()

        # Re-seed demo dataset
        seeded_records = cls.seed_demo_patients(db_path)
        elapsed_seconds = round(time.time() - start_time, 3)

        return {
            "success": True,
            "patients_count": len(seeded_records),
            "elapsed_seconds": elapsed_seconds,
            "benchmark_passed": elapsed_seconds < 1.0,
        }
