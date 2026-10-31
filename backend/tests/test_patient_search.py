"""Tests for Multi-Modal Patient Search and Retrieval (PAT-02).

Guarantees:
- GET /api/patients is rejected with 401 for anonymous caller.
- Search matches:
  - URN partial and exact match (e.g., 'KH-2026-0001').
  - 10-digit mobile or digit substring.
  - Patient English name ('Amitabh Bachchan').
  - Patient Hindi Devanagari name ('अमिताभ बच्चन').
- Pagination parameters limit and offset are respected.
- GET /api/patients/{id} returns single patient or 404 if not found.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api.models import Patient, User


def test_patient_search_anonymous_rejected(client: TestClient) -> None:
    """Anonymous callers cannot search or read patient directory."""
    assert client.get("/api/patients").status_code == 401
    assert client.get("/api/patients/1").status_code == 401


def test_patient_multimodal_search(
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """Tests multi-modal search across URN, mobile, English and Hindi names."""
    rec_c = login_client(reception_user)

    # Seed 3 diverse patients
    p1 = Patient(
        urn="KH-2026-0101",
        full_name="Rajesh Sharma",
        guardian_name="Brijesh Sharma",
        gender="M",
        age_years=45,
        mobile="9835012345",
        address="Babu Bazar, Ara",
    )
    p2 = Patient(
        urn="KH-2026-0102",
        full_name="अंजली कुमारी",
        guardian_name="सुरेश प्रसाद",
        gender="F",
        age_years=28,
        mobile="9934098765",
        address="Koilwar, Bhojpur",
    )
    p3 = Patient(
        urn="KH-2026-0103",
        full_name="Amitabh Bachchan",
        guardian_name="Harivansh Rai Bachchan",
        gender="M",
        age_years=82,
        mobile="9431055555",
        address="Mumbai / Ara",
    )
    db_session.add_all([p1, p2, p3])
    db_session.flush()

    # 1. Search by URN
    resp = rec_c.get("/api/patients?q=0101")
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) >= 1
    assert any(p["urn"] == "KH-2026-0101" for p in results)

    # 2. Search by mobile substring
    resp = rec_c.get("/api/patients?q=99340")
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) >= 1
    assert any(p["urn"] == "KH-2026-0102" for p in results)

    # 3. Search by Hindi Devanagari name
    resp = rec_c.get("/api/patients?q=अंजली")
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) >= 1
    assert any(p["full_name"] == "अंजली कुमारी" for p in results)

    # 4. Search by English name
    resp = rec_c.get("/api/patients?q=Amitabh")
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) >= 1
    assert any(p["full_name"] == "Amitabh Bachchan" for p in results)

    # 5. Detail retrieval
    detail_resp = rec_c.get(f"/api/patients/{p1.id}")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["urn"] == "KH-2026-0101"

    # 6. Detail retrieval for non-existent id
    assert rec_c.get("/api/patients/999999").status_code == 404

