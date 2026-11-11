"""Tests for hospital asset management API and security controls (SET-01, D-20-01).

Guarantees:
- Admin can upload valid assets (PNG, JPEG, WebP, SVG, PDF up to 10 MB).
- Non-admin users are denied access with HTTP 403.
- Magic byte validation rejects spoofed files and oversized uploads with HTTP 422.
- Uploading a new LOGO increments version and marks older logos inactive.
- Deactivating an asset preserves physical file on disk.
- GET /api/assets/active-logo is public and streams the active crest or fallback.
- ASSET_UPLOADED audit log entries are synchronously committed in transaction.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, HospitalAsset, User
from kalyan_api.services.asset_service import MAX_ASSET_BYTES

VALID_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
)
VALID_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
VALID_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
VALID_WEBP = b"RIFF\x14\x00\x00\x00WEBPVP8 \x08\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
VALID_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="5"/></svg>'


def test_upload_logo_versions_and_deactivation(
    admin_user: User,
    login_client,
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Test logo upload version incrementing, deactivation, and physical file persistence."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    client: TestClient = login_client(admin_user)

    # 1. Upload first logo
    resp1 = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("crest_v1.png", VALID_PNG, "image/png")},
    )
    assert resp1.status_code == 200, resp1.text
    data1 = resp1.json()
    assert data1["asset_type"] == "LOGO"
    assert data1["version"] == 1
    assert data1["is_active"] is True
    file1_name = data1["filename"]
    assert (assets_dir / file1_name).is_file()

    # 2. Upload second logo -> version increments to 2, logo 1 becomes inactive
    resp2 = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("crest_v2.png", VALID_PNG, "image/png")},
    )
    assert resp2.status_code == 200, resp2.text
    data2 = resp2.json()
    assert data2["asset_type"] == "LOGO"
    assert data2["version"] == 2
    assert data2["is_active"] is True
    file2_name = data2["filename"]
    assert (assets_dir / file2_name).is_file()

    # Verify database state
    assets = (
        db_session.execute(
            select(HospitalAsset)
            .where(HospitalAsset.asset_type == "LOGO")
            .order_by(HospitalAsset.version.asc())
        )
        .scalars()
        .all()
    )
    assert len(assets) == 2
    assert assets[0].version == 1 and assets[0].is_active is False
    assert assets[1].version == 2 and assets[1].is_active is True

    # 3. Deactivate logo 2
    resp_deact = client.post(f"/api/admin/assets/{data2['id']}/deactivate")
    assert resp_deact.status_code == 200
    assert resp_deact.json()["is_active"] is False

    # Historical file MUST NOT be deleted from disk
    assert (assets_dir / file1_name).is_file()
    assert (assets_dir / file2_name).is_file()


def test_upload_different_asset_types(
    admin_user: User,
    login_client,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Admin can upload JPEG photos, PDF certificates, WebP and SVG assets."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    client: TestClient = login_client(admin_user)

    # JPEG Photo
    r_photo = client.post(
        "/api/admin/assets",
        data={"asset_type": "PHOTO"},
        files={"file": ("facility.jpg", VALID_JPEG, "image/jpeg")},
    )
    assert r_photo.status_code == 200
    assert r_photo.json()["asset_type"] == "PHOTO"
    assert r_photo.json()["mime_type"] == "image/jpeg"

    # PDF Document
    r_doc = client.post(
        "/api/admin/assets",
        data={"asset_type": "REGISTRATION_DOC"},
        files={"file": ("trust_cert.pdf", VALID_PDF, "application/pdf")},
    )
    assert r_doc.status_code == 200
    assert r_doc.json()["asset_type"] == "REGISTRATION_DOC"
    assert r_doc.json()["mime_type"] == "application/pdf"

    # WebP
    r_webp = client.post(
        "/api/admin/assets",
        data={"asset_type": "PHOTO"},
        files={"file": ("photo.webp", VALID_WEBP, "image/webp")},
    )
    assert r_webp.status_code == 200
    assert r_webp.json()["mime_type"] == "image/webp"

    # SVG
    r_svg = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("vector_logo.svg", VALID_SVG, "image/svg+xml")},
    )
    assert r_svg.status_code == 200
    assert r_svg.json()["mime_type"] == "image/svg+xml"


def test_validation_rejects_malicious_and_oversized_files(
    admin_user: User,
    login_client,
) -> None:
    """Asset service validates magic bytes and rejects spoofed extensions or oversized files with
    422."""
    client: TestClient = login_client(admin_user)

    # 1. Spoofed extension: named .png but contains text/binary executable
    r_spoof = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("fake.png", b"NOT_A_PNG_HEADER_JUST_TEXT", "image/png")},
    )
    assert r_spoof.status_code == 422
    assert r_spoof.json()["code"] == "invalid_asset_format"

    # 2. Empty file
    r_empty = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert r_empty.status_code == 422
    assert r_empty.json()["code"] == "empty_file"

    # 3. Oversized file (> 10 MB)
    large_payload = b"\x89PNG\r\n\x1a\n" + b"0" * (MAX_ASSET_BYTES + 1)
    r_large = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("too_big.png", large_payload, "image/png")},
    )
    assert r_large.status_code == 422
    assert r_large.json()["code"] == "file_too_large"

    # 4. Invalid asset type
    r_invalid_type = client.post(
        "/api/admin/assets",
        data={"asset_type": "MALICIOUS_TYPE"},
        files={"file": ("valid.png", VALID_PNG, "image/png")},
    )
    assert r_invalid_type.status_code == 422
    assert r_invalid_type.json()["code"] == "invalid_asset_type"


def test_rbac_reception_cannot_manage_assets(
    reception_user: User,
    login_client,
) -> None:
    """Non-admin users (such as Reception) are forbidden from modifying hospital assets."""
    client: TestClient = login_client(reception_user)

    # POST /api/admin/assets -> 403
    r_post = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("test.png", VALID_PNG, "image/png")},
    )
    assert r_post.status_code == 403

    # GET /api/admin/assets -> 403
    r_get = client.get("/api/admin/assets")
    assert r_get.status_code == 403

    # POST deactivate -> 403
    r_deact = client.post("/api/admin/assets/1/deactivate")
    assert r_deact.status_code == 403


def test_public_active_logo_endpoint(
    admin_user: User,
    login_client,
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """GET /api/assets/active-logo streams active logo without requiring authentication."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    # 1. Unauthenticated request when no logo uploaded -> fallback crest returned
    r_public_fallback = client.get("/api/assets/active-logo")
    assert r_public_fallback.status_code == 200
    assert len(r_public_fallback.content) > 0

    # 2. Upload active logo as Admin
    admin_c = login_client(admin_user)
    r_upload = admin_c.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("crest.png", VALID_PNG, "image/png")},
    )
    assert r_upload.status_code == 200

    # 3. Unauthenticated public request now serves the uploaded active logo
    r_public_active = client.get("/api/assets/active-logo")
    assert r_public_active.status_code == 200
    assert r_public_active.headers["content-type"].startswith("image/png")
    assert r_public_active.content == VALID_PNG


def test_audit_event_recorded_on_upload(
    admin_user: User,
    login_client,
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Asset upload triggers an ASSET_UPLOADED audit log entry with metadata."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    client: TestClient = login_client(admin_user)
    resp = client.post(
        "/api/admin/assets",
        data={"asset_type": "PHOTO"},
        files={"file": ("clinic_front.jpg", VALID_JPEG, "image/jpeg")},
    )
    assert resp.status_code == 200
    asset_id = resp.json()["id"]

    audit_entry = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == "ASSET_UPLOADED",
            AuditLog.entity_id == str(asset_id),
        )
    ).scalar_one_or_none()
    assert audit_entry is not None
    assert audit_entry.actor_user_id == admin_user.id
    assert audit_entry.after_data["asset_type"] == "PHOTO"
    assert audit_entry.after_data["original_filename"] == "clinic_front.jpg"
