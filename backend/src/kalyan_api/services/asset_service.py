"""Secure hospital asset management service (SET-01, D-20-01).

Guarantees:
- Validates file payload: max 10 MB, magic-byte checked for PNG, JPEG, WebP, SVG, and PDF.
- Generates random UUID filenames, preventing directory traversal and collisions.
- Stores files outside public web roots in dedicated directory (backend/var/assets/).
- Preserves historical versions immutably (never physically deletes past assets).
- Automatically increments version and retires prior active logo when uploading new logo.
"""

import uuid
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from kalyan_api.config import get_settings
from kalyan_api.core.errors import ApiError
from kalyan_api.models import AssetType, HospitalAsset

MAX_ASSET_BYTES = 10 * 1024 * 1024  # 10 MB

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PDF_MAGIC = b"%PDF-"


def validate_asset_bytes(data: bytes) -> tuple[str, str]:
    """Validate asset file size and magic bytes; returns file extension and media type.

    Accepts PNG, JPEG, WebP, SVG, and PDF documents up to 10 MB.
    """
    if len(data) == 0:
        raise ApiError(status_code=422, code="empty_file", message="Uploaded asset is empty.")

    if len(data) > MAX_ASSET_BYTES:
        raise ApiError(
            status_code=422,
            code="file_too_large",
            message="Uploaded asset exceeds maximum allowed size of 10 MB.",
        )

    # 1. Check JPEG
    if data.startswith(JPEG_MAGIC):
        return ".jpg", "image/jpeg"

    # 2. Check PNG
    if data.startswith(PNG_MAGIC):
        return ".png", "image/png"

    # 3. Check PDF
    if data.startswith(PDF_MAGIC):
        return ".pdf", "application/pdf"

    # 4. Check WebP: starts with 'RIFF' and bytes 8..12 == 'WEBP'
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp", "image/webp"

    # 5. Check SVG
    prefix = data[:1024].lstrip()
    if prefix.startswith(b"<svg") or (prefix.startswith(b"<?xml") and b"<svg" in prefix):
        return ".svg", "image/svg+xml"
    if b"<svg" in prefix and (b"http://www.w3.org/2000/svg" in data[:2048] or b"</svg>" in data[-1024:]):
        return ".svg", "image/svg+xml"

    raise ApiError(
        status_code=422,
        code="invalid_asset_format",
        message="Unsupported asset format. Allowed formats: PNG, JPEG, WebP, SVG, PDF.",
    )


def save_asset(
    session: Session,
    file_bytes: bytes,
    original_filename: str,
    asset_type: str,
    user_id: int,
    assets_dir: Path | None = None,
) -> HospitalAsset:
    """Validate, persist to disk, and record a new hospital asset in the database.

    When asset_type == 'LOGO', older active logos are marked inactive and version increments.
    """
    valid_types = {AssetType.LOGO.value, AssetType.PHOTO.value, AssetType.REGISTRATION_DOC.value}
    if asset_type not in valid_types:
        raise ApiError(
            status_code=422,
            code="invalid_asset_type",
            message=f"Invalid asset type '{asset_type}'. Allowed: {', '.join(sorted(valid_types))}.",
        )

    ext, mime_type = validate_asset_bytes(file_bytes)
    target_dir = assets_dir or get_settings().assets_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    if asset_type == AssetType.LOGO.value:
        max_ver_stmt = select(func.coalesce(func.max(HospitalAsset.version), 0)).where(
            HospitalAsset.asset_type == AssetType.LOGO.value
        )
        current_max = session.scalar(max_ver_stmt) or 0
        new_version = current_max + 1

        # Deactivate previous active logos
        session.execute(
            update(HospitalAsset)
            .where(
                HospitalAsset.asset_type == AssetType.LOGO.value,
                HospitalAsset.is_active.is_(True),
            )
            .values(is_active=False)
        )
    else:
        new_version = 1

    filename = f"{uuid.uuid4().hex}{ext}"
    clean_original = Path(original_filename).name if original_filename else filename

    file_path = target_dir / filename
    file_path.write_bytes(file_bytes)

    asset = HospitalAsset(
        asset_type=asset_type,
        filename=filename,
        original_filename=clean_original,
        mime_type=mime_type,
        file_size_bytes=len(file_bytes),
        is_active=True,
        version=new_version,
        uploaded_by_user_id=user_id,
    )
    session.add(asset)
    session.flush()
    return asset


def deactivate_asset(
    session: Session,
    asset_id: int,
    user_id: int | None = None,
) -> HospitalAsset:
    """Mark an asset inactive without deleting its physical file (STRIDE T-20-06)."""
    asset = session.get(HospitalAsset, asset_id)
    if not asset:
        raise ApiError(
            status_code=404,
            code="asset_not_found",
            message=f"Hospital asset with ID {asset_id} not found.",
        )

    asset.is_active = False
    session.flush()
    return asset


def get_active_logo(session: Session) -> HospitalAsset | None:
    """Return the currently active hospital logo, or None if none uploaded."""
    stmt = (
        select(HospitalAsset)
        .where(
            HospitalAsset.asset_type == AssetType.LOGO.value,
            HospitalAsset.is_active.is_(True),
        )
        .order_by(HospitalAsset.version.desc(), HospitalAsset.id.desc())
        .limit(1)
    )
    return session.scalars(stmt).first()


def get_asset_path(filename: str, assets_dir: Path | None = None) -> Path:
    """Resolve sanitized file path for the given asset filename."""
    target_dir = assets_dir or get_settings().assets_dir
    clean_name = Path(filename).name
    return target_dir / clean_name


def list_assets(
    session: Session,
    asset_type: str | None = None,
    is_active: bool | None = None,
) -> Sequence[HospitalAsset]:
    """List hospital assets ordered chronologically backwards."""
    stmt = select(HospitalAsset)
    if asset_type:
        stmt = stmt.where(HospitalAsset.asset_type == asset_type)
    if is_active is not None:
        stmt = stmt.where(HospitalAsset.is_active.is_(is_active))
    stmt = stmt.order_by(HospitalAsset.created_at.desc(), HospitalAsset.id.desc())
    return session.scalars(stmt).all()
