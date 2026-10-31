"""Secure filesystem photo storage service for patient identification (PAT-05, D-12-03).

Guarantees:
- Validates file payload: max 5 MB, magic-byte checked for JPEG and PNG.
- Generates random UUID filenames, preventing directory traversal and filename collisions.
- Stores files outside public web roots in dedicated directory (backend/var/photos/).
"""

import uuid
from pathlib import Path

from kalyan_api.core.errors import ApiError

MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB
JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def validate_photo_bytes(data: bytes) -> tuple[str, str]:
    """Validate photo file size and magic bytes; returns file extension and media type."""
    if len(data) == 0:
        raise ApiError(status_code=422, code="empty_file", message="Uploaded photo is empty.")

    if len(data) > MAX_PHOTO_BYTES:
        raise ApiError(
            status_code=413,
            code="file_too_large",
            message="Uploaded photo exceeds maximum allowed size of 5 MB.",
        )

    if data.startswith(JPEG_MAGIC):
        return ".jpg", "image/jpeg"
    elif data.startswith(PNG_MAGIC):
        return ".png", "image/png"
    else:
        raise ApiError(
            status_code=422,
            code="invalid_image_format",
            message="Unsupported image format. Only JPEG and PNG images are accepted.",
        )


def save_photo(data: bytes, photos_dir: Path) -> str:
    """Validate and persist photo bytes, returning the generated filename."""
    ext, _ = validate_photo_bytes(data)
    photos_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    target_path = photos_dir / filename
    target_path.write_bytes(data)

    return filename


def get_photo_path(filename: str, photos_dir: Path) -> Path:
    """Resolve sanitized file path for the given photo filename."""
    # Prevent directory traversal
    clean_name = Path(filename).name
    return photos_dir / clean_name


def delete_photo(filename: str, photos_dir: Path) -> None:
    """Silently remove photo file from filesystem if it exists."""
    try:
        path = get_photo_path(filename, photos_dir)
        if path.is_file():
            path.unlink()
    except OSError:
        pass
