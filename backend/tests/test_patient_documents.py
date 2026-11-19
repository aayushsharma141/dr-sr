"""Comprehensive tests for Milestone 4 Patient Documents API & storage integrity (T4.2 / T4.4).

Covers:
- Magic-byte enforcement (valid PDF/JPEG/PNG pass; spoofed HTML/EXE/text/empty rejected 422)
- File size cap (> 10 MB rejected 413) with zero leftover temp files on disk
- SHA-256 digest accuracy and random UUID storage outside public web roots
- Path traversal defense (resolve_document_path and tampered DB stored_filename)
- Content-Disposition CRLF/header-injection sanitization + Cache-Control / nosniff headers
- Strict D-04 clinical privacy (Reception 403 on clinical upload/download/archive; Admin 403 on
  clinical download and write routes; clinical docs hidden from Admin/Reception listings)
- DWS-04 cross-doctor clinical read audit on listing and download (no self-read audit)
- CLINICAL_WRITE own-author-only archival (doctor_b gets 404 on doctor_a's clinical document)
- Soft-archive immutability on disk + include_archived filter + merged/archived patient handling
- Audit logs (DOCUMENT_UPLOADED, DOCUMENT_DOWNLOADED, DOCUMENT_ARCHIVED, CROSS_DOCTOR_CLINICAL_READ)
- Integrity Check #8 (document_storage): healthy, orphan CLEANUP, and missing file ERROR
"""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError
from kalyan_api.models import (
    AuditLog,
    ClinicalEncounter,
    Patient,
    PatientDocument,
    User,
    Visit,
)
from kalyan_api.services import document_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.integrity_service import (
    check_document_storage_integrity,
    run_integrity_audit,
)

PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"
JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc`\x00\x00\x00\x02\x00\x01"
    b"\xe5\x27\xde\xfc\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _make_patient(
    db_session: Session,
    *,
    name: str = "Doc Test Patient",
    urn: str | None = None,
    is_archived: bool = False,
) -> Patient:
    pat = Patient(
        urn=urn or f"KH-26-P-11-{uuid.uuid4().hex[:5].upper()}",
        full_name=name,
        guardian_name="Guardian",
        gender="M",
        age_years=35,
        mobile="9876543210",
        address="Hospital Road, Ara",
        district="Bhojpur",
        state="Bihar",
        is_archived=is_archived,
        archived_at=datetime.now(UTC) if is_archived else None,
        archive_reason="Archived for test" if is_archived else None,
    )
    db_session.add(pat)
    db_session.flush()
    return pat


def _audit_actions(
    db_session: Session,
    action: AuditAction,
    entity_id: str | None = None,
) -> list[AuditLog]:
    stmt = select(AuditLog).where(AuditLog.action == action.value)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    return list(db_session.scalars(stmt).all())


def test_upload_magic_bytes_sha256_uuid_storage_and_rejections(
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    doctor_a_user: User,
) -> None:
    """Valid PDF/JPEG/PNG pass with exact SHA-256 & UUID storage; invalid/empty/>10MB rejected."""
    patient = _make_patient(db_session)
    doc_client = login_client(doctor_a_user)

    cases = [
        ("report.pdf", PDF_BYTES, "application/octet-stream", "application/pdf", ".pdf"),
        ("scan.jpg", JPEG_BYTES, "application/octet-stream", "image/jpeg", ".jpg"),
        ("xray.png", PNG_BYTES, "text/plain", "image/png", ".png"),
    ]
    for orig_name, payload, sent_mime, expected_mime, expected_ext in cases:
        resp = doc_client.post(
            f"/api/patients/{patient.id}/documents",
            files={"file": (orig_name, payload, sent_mime)},
            data={"title": f"Valid {expected_ext}", "category": "LAB_REPORT"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["mime_type"] == expected_mime
        assert body["file_size_bytes"] == len(payload)
        assert body["sha256_hex"] == hashlib.sha256(payload).hexdigest()
        assert body["is_clinical"] is True
        assert body["doctor_id"] == doctor_a_user.doctor_id
        assert body["uploaded_by_user_id"] == doctor_a_user.id
        assert body["uploaded_by_username"] == doctor_a_user.username

        row = db_session.get(PatientDocument, body["id"])
        assert row is not None
        assert re.fullmatch(rf"[0-9a-f]{{32}}{re.escape(expected_ext)}", row.stored_filename)
        assert row.stored_filename != orig_name

        stored_path = test_settings.documents_dir / row.stored_filename
        assert stored_path.is_file()
        assert stored_path.read_bytes() == payload
        # Stored outside public frontend dist / web roots
        assert "frontend" not in stored_path.parts
        assert "dist" not in stored_path.parts

        upload_audits = _audit_actions(db_session, AuditAction.DOCUMENT_UPLOADED, str(row.id))
        assert len(upload_audits) == 1
        assert upload_audits[0].after_data["sha256_hex"] == body["sha256_hex"]

    files_before_rejections = set(test_settings.documents_dir.iterdir())

    # Spoofed/invalid payloads and empty file -> 422
    invalid_cases = [
        (
            "spoof.pdf",
            b"<html><body><script>alert(1)</script></body></html>",
            "unsupported_file_type",
        ),
        ("malware.pdf", b"MZ\x90\x00\x03\x00\x00\x00PE\x00\x00", "unsupported_file_type"),
        ("notes.jpg", b"plain text disguised as jpeg image", "unsupported_file_type"),
        ("empty.pdf", b"", "empty_file"),
    ]
    for fname, bad_bytes, expected_code in invalid_cases:
        resp = doc_client.post(
            f"/api/patients/{patient.id}/documents",
            files={"file": (fname, bad_bytes, "application/pdf")},
            data={"title": "Bad Upload", "category": "OTHER"},
        )
        assert resp.status_code == 422, f"{fname}: {resp.status_code} {resp.text}"
        assert resp.json()["code"] == expected_code

    # Oversized > 10 MB -> 413
    oversized = PDF_BYTES + (b"0" * (document_service.MAX_DOCUMENT_BYTES - len(PDF_BYTES) + 1))
    big_resp = doc_client.post(
        f"/api/patients/{patient.id}/documents",
        files={"file": ("huge.pdf", oversized, "application/pdf")},
        data={"title": "Too Big", "category": "OTHER"},
    )
    assert big_resp.status_code == 413, big_resp.text
    assert big_resp.json()["code"] == "file_too_large"

    # Zero leftover files or .tmp-* files created by failed uploads
    assert set(test_settings.documents_dir.iterdir()) == files_before_rejections


def test_path_traversal_blocked_and_crlf_sanitized_on_download(
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    reception_user: User,
) -> None:
    """Path traversal is blocked in service & download route; Content-Disposition strips CRLF."""
    # Direct service-level traversal guards
    for bad_name in (
        "",
        ".",
        "..",
        "../secret.pdf",
        "..\\secret.pdf",
        "subdir/doc.pdf",
        "/etc/passwd",
        "doc\x00.pdf",
    ):
        with pytest.raises(ApiError) as exc_info:
            document_service.resolve_document_path(bad_name, test_settings.documents_dir)
        assert exc_info.value.status_code == 400
        assert exc_info.value.code == "invalid_document_path"

    patient = _make_patient(db_session)
    rec_client = login_client(reception_user)

    # Upload with malicious CRLF + traversal + quotes in filename
    malicious_name = '../../evil\r\nX-Injected: pwned\r\n"quoted";a=1.pdf'
    up_resp = rec_client.post(
        f"/api/patients/{patient.id}/documents",
        files={"file": (malicious_name, PDF_BYTES, "application/pdf")},
        data={"title": "ID Proof", "category": "ID_PROOF", "is_clinical": "false"},
    )
    assert up_resp.status_code == 201, up_resp.text
    doc_id = up_resp.json()["id"]

    # Download must sanitize header and enforce no-store + nosniff
    dl_resp = rec_client.get(f"/api/documents/{doc_id}/download")
    assert dl_resp.status_code == 200, dl_resp.text
    assert dl_resp.content == PDF_BYTES
    assert dl_resp.headers["cache-control"] == "no-store"
    assert dl_resp.headers["x-content-type-options"] == "nosniff"
    assert "x-injected" not in {k.lower() for k in dl_resp.headers}
    cd = dl_resp.headers["content-disposition"]
    assert "\r" not in cd and "\n" not in cd
    assert ".." not in cd and "/" not in cd and "\\" not in cd
    assert cd.startswith('attachment; filename="') and cd.endswith('"')

    # Download audit log recorded
    dl_audits = _audit_actions(db_session, AuditAction.DOCUMENT_DOWNLOADED, str(doc_id))
    assert len(dl_audits) == 1

    # Tampered DB stored_filename with path traversal is blocked at download time -> 400
    tampered = PatientDocument(
        patient_id=patient.id,
        title="Tampered Path",
        category="ID_PROOF",
        is_clinical=False,
        original_filename="safe.pdf",
        stored_filename="../outside.pdf",
        mime_type="application/pdf",
        file_size_bytes=len(PDF_BYTES),
        sha256_hex=hashlib.sha256(PDF_BYTES).hexdigest(),
        uploaded_by_user_id=reception_user.id,
        is_archived=False,
    )
    db_session.add(tampered)
    db_session.flush()

    bad_dl = rec_client.get(f"/api/documents/{tampered.id}/download")
    assert bad_dl.status_code == 400
    assert bad_dl.json()["code"] == "invalid_document_path"


def test_d04_clinical_privacy_dws04_audit_and_clinical_archive_ownership(
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
) -> None:
    """Enforce D-04 role boundaries, DWS-04 cross-doctor audit, and own-author clinical archive."""
    patient = _make_patient(db_session)
    visit = Visit(
        patient_id=patient.id,
        visit_date=clock.ist_today(),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()

    enc_a = ClinicalEncounter(
        patient_id=patient.id,
        visit_id=visit.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms="Knee pain",
        clinical_notes="Assessment notes",
        diagnosis="Osteoarthritis",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc_a)
    db_session.flush()

    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    # 1. Reception blocked (403) from uploading clinical category, is_clinical=True, or encounter_id
    for cat, is_clin, enc_id in [
        ("LAB_REPORT", "false", None),
        ("IMAGING", "false", None),
        ("PRESCRIPTION_SCAN", "false", None),
        ("DISCHARGE_SUMMARY", "false", None),
        ("OTHER", "true", None),
        ("ID_PROOF", "false", str(enc_a.id)),
    ]:
        data: dict[str, Any] = {"title": "Forbidden", "category": cat, "is_clinical": is_clin}
        if enc_id is not None:
            data["encounter_id"] = enc_id
        r = rec_c.post(
            f"/api/patients/{patient.id}/documents",
            files={"file": ("doc.pdf", PDF_BYTES, "application/pdf")},
            data=data,
        )
        assert r.status_code == 403, f"Reception upload ({cat}, {is_clin}, {enc_id}): {r.text}"

    # 2. Reception uploads non-clinical ID_PROOF -> 201
    non_clin_resp = rec_c.post(
        f"/api/patients/{patient.id}/documents",
        files={"file": ("aadhaar.jpg", JPEG_BYTES, "image/jpeg")},
        data={
            "title": "Aadhaar Card",
            "category": "ID_PROOF",
            "is_clinical": "false",
            "visit_id": str(visit.id),
        },
    )
    assert non_clin_resp.status_code == 201, non_clin_resp.text
    non_clin = non_clin_resp.json()
    assert non_clin["is_clinical"] is False
    assert non_clin["doctor_id"] is None
    assert non_clin["visit_id"] == visit.id
    assert non_clin["visit_code"] == visit.visit_code

    # 3. Doctor A uploads clinical LAB_REPORT linked to visit & encounter -> 201
    clin_resp = doc_a_c.post(
        f"/api/patients/{patient.id}/documents",
        files={"file": ("cbc.pdf", PDF_BYTES, "application/pdf")},
        data={
            "title": "CBC Report",
            "category": "LAB_REPORT",
            "is_clinical": "false",  # auto-coerced True for clinical category
            "visit_id": str(visit.id),
            "encounter_id": str(enc_a.id),
        },
    )
    assert clin_resp.status_code == 201, clin_resp.text
    clin = clin_resp.json()
    assert clin["is_clinical"] is True
    assert clin["doctor_id"] == doctor_a_user.doctor_id
    assert clin["encounter_id"] == enc_a.id
    assert clin["encounter_code"] == enc_a.encounter_code

    # 4. Admin & Reception listings hide clinical docs; download/archive of clinical doc -> 403
    for role_c in (admin_c, rec_c):
        lst = role_c.get(f"/api/patients/{patient.id}/documents")
        assert lst.status_code == 200
        ids = [d["id"] for d in lst.json()]
        assert ids == [non_clin["id"]]

        assert role_c.get(f"/api/documents/{clin['id']}/download").status_code == 403
        assert role_c.get(f"/api/documents/{non_clin['id']}/download").status_code == 200

    assert rec_c.post(f"/api/documents/{clin['id']}/archive").status_code == 403
    assert admin_c.post(f"/api/documents/{clin['id']}/archive").status_code == 403
    assert admin_c.post(f"/api/documents/{non_clin['id']}/archive").status_code == 403

    # 5. Doctor A self-read produces ZERO CROSS_DOCTOR_CLINICAL_READ rows
    cross_before = len(_audit_actions(db_session, AuditAction.CROSS_DOCTOR_CLINICAL_READ))
    a_list = doc_a_c.get(f"/api/patients/{patient.id}/documents")
    assert a_list.status_code == 200
    assert {d["id"] for d in a_list.json()} == {non_clin["id"], clin["id"]}
    assert doc_a_c.get(f"/api/documents/{clin['id']}/download").status_code == 200
    assert len(_audit_actions(db_session, AuditAction.CROSS_DOCTOR_CLINICAL_READ)) == cross_before

    # 6. Doctor B cross-doctor clinical list & download BOTH record CROSS_DOCTOR_CLINICAL_READ
    b_list = doc_b_c.get(f"/api/patients/{patient.id}/documents")
    assert b_list.status_code == 200
    assert {d["id"] for d in b_list.json()} == {non_clin["id"], clin["id"]}
    cross_after_list = _audit_actions(db_session, AuditAction.CROSS_DOCTOR_CLINICAL_READ)
    assert len(cross_after_list) == cross_before + 1
    assert cross_after_list[-1].after_data["source"] == "patient_documents_list"

    b_dl = doc_b_c.get(f"/api/documents/{clin['id']}/download")
    assert b_dl.status_code == 200
    assert b_dl.content == PDF_BYTES
    cross_after_dl = _audit_actions(db_session, AuditAction.CROSS_DOCTOR_CLINICAL_READ)
    assert len(cross_after_dl) == cross_before + 2
    assert cross_after_dl[-1].after_data["source"] == "document_download"
    assert cross_after_dl[-1].after_data["actor_doctor_id"] == doctor_b_user.doctor_id
    assert cross_after_dl[-1].after_data["record_doctor_id"] == doctor_a_user.doctor_id

    # 7. Doctor B receives 404 when trying to archive Doctor A's clinical document
    b_arch = doc_b_c.post(f"/api/documents/{clin['id']}/archive")
    assert b_arch.status_code == 404
    db_clin = db_session.get(PatientDocument, clin["id"])
    assert db_clin is not None and db_clin.is_archived is False

    # 8. Doctor A archives own clinical doc -> soft-archive only (file stays on disk!)
    clin_disk_path = test_settings.documents_dir / db_clin.stored_filename
    assert clin_disk_path.is_file()
    a_arch = doc_a_c.post(f"/api/documents/{clin['id']}/archive")
    assert a_arch.status_code == 200, a_arch.text
    assert a_arch.json()["is_archived"] is True
    assert a_arch.json()["archived_by_user_id"] == doctor_a_user.id
    assert clin_disk_path.is_file()

    arch_audits = _audit_actions(db_session, AuditAction.DOCUMENT_ARCHIVED, str(clin["id"]))
    assert len(arch_audits) == 1

    # Archived doc hidden by default, shown with include_archived=true
    default_ids = [d["id"] for d in doc_a_c.get(f"/api/patients/{patient.id}/documents").json()]
    assert clin["id"] not in default_ids
    assert non_clin["id"] in default_ids

    with_arch_ids = [
        d["id"]
        for d in doc_a_c.get(f"/api/patients/{patient.id}/documents?include_archived=true").json()
    ]
    assert {clin["id"], non_clin["id"]} <= set(with_arch_ids)


def test_archived_and_merged_patient_document_rules(
    db_session: Session,
    login_client: Any,
    admin_user: User,
    reception_user: User,
) -> None:
    """Uploads blocked (409) on archived/merged patients; reads stay allowed and consolidate."""
    master = _make_patient(db_session, name="Master Patient")
    secondary = _make_patient(db_session, name="Secondary Patient")
    archived = _make_patient(db_session, name="Archived Patient", is_archived=True)

    rec_c = login_client(reception_user)
    admin_c = login_client(admin_user)

    # Upload to secondary before merge
    r = rec_c.post(
        f"/api/patients/{secondary.id}/documents",
        files={"file": ("sec.pdf", PDF_BYTES, "application/pdf")},
        data={"title": "Secondary Insurance", "category": "INSURANCE", "is_clinical": "false"},
    )
    assert r.status_code == 201
    sec_doc_id = r.json()["id"]

    # Merge secondary into master
    m_resp = admin_c.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": master.id,
            "secondary_patient_id": secondary.id,
            "reason": "Consolidate duplicate patient",
        },
    )
    assert m_resp.status_code == 200, m_resp.text

    # Uploads to merged secondary or archived patient blocked with 409
    for blocked_id in (secondary.id, archived.id):
        blocked = rec_c.post(
            f"/api/patients/{blocked_id}/documents",
            files={"file": ("blocked.pdf", PDF_BYTES, "application/pdf")},
            data={"title": "Blocked", "category": "ID_PROOF", "is_clinical": "false"},
        )
        assert blocked.status_code == 409

    # Master listing consolidates secondary's document; archived listing succeeds
    master_docs = rec_c.get(f"/api/patients/{master.id}/documents")
    assert master_docs.status_code == 200
    assert [d["id"] for d in master_docs.json()] == [sec_doc_id]
    assert rec_c.get(f"/api/patients/{archived.id}/documents").status_code == 200


def test_document_storage_integrity_check_8(
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    doctor_a_user: User,
    tmp_path: Path,
) -> None:
    """Integrity Check #8 passes when synced, flags orphan CLEANUP, and flags missing ERROR."""
    patient = _make_patient(db_session)
    doc_c = login_client(doctor_a_user)

    up = doc_c.post(
        f"/api/patients/{patient.id}/documents",
        files={"file": ("healthy.pdf", PDF_BYTES, "application/pdf")},
        data={"title": "Healthy Doc", "category": "LAB_REPORT"},
    )
    assert up.status_code == 201
    doc_row = db_session.get(PatientDocument, up.json()["id"])
    assert doc_row is not None

    # Isolate photos/assets too so run_integrity_audit only evaluates this test's files
    clean_photos = tmp_path / "photos_clean"
    clean_assets = tmp_path / "assets_clean"
    clean_photos.mkdir()
    clean_assets.mkdir()
    cfg = test_settings.model_copy(
        update={"photos_dir": clean_photos, "assets_dir": clean_assets}
    )

    # 1. Healthy state
    check_ok = check_document_storage_integrity(db_session, cfg)
    assert check_ok.code == "document_storage"
    assert check_ok.passed is True
    assert check_ok.discrepancies == []

    report_ok = run_integrity_audit(db_session, cfg)
    assert report_ok.total_checks == 9
    assert report_ok.is_healthy is True
    assert report_ok.failed_checks == 0

    # 2. Orphan file on disk -> CLEANUP (report remains healthy)
    orphan_path = cfg.documents_dir / "untracked_orphan.pdf"
    orphan_path.write_bytes(PDF_BYTES)
    check_orphan = check_document_storage_integrity(db_session, cfg)
    assert check_orphan.passed is False
    assert check_orphan.severity == "CLEANUP"
    assert [d["issue"] for d in check_orphan.discrepancies] == ["orphan_document_file"]

    report_orphan = run_integrity_audit(db_session, cfg)
    assert report_orphan.is_healthy is True
    assert report_orphan.cleanup_checks == 1
    assert report_orphan.failed_checks == 0

    # 3. Missing tracked file on disk -> ERROR (report becomes unhealthy)
    tracked_path = cfg.documents_dir / doc_row.stored_filename
    tracked_path.unlink()
    check_missing = check_document_storage_integrity(db_session, cfg)
    assert check_missing.passed is False
    assert check_missing.severity == "ERROR"
    by_issue = {d["issue"]: d["severity"] for d in check_missing.discrepancies}
    assert by_issue == {
        "missing_document_file": "ERROR",
        "orphan_document_file": "CLEANUP",
    }

    report_missing = run_integrity_audit(db_session, cfg)
    assert report_missing.is_healthy is False
    assert report_missing.failed_checks == 1
