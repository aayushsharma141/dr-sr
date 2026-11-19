"""Secure local document storage service for patient attachments (Milestone 4, T4.2).

Guarantees:
- Validates file payload via magic bytes (PDF, JPEG, PNG); rejects empty (422), unsupported (422),
  and oversized > 10 MB (413) uploads.
- Reads UploadFile incrementally in fixed chunks (never buffers unbounded uploads in RAM),
  computing SHA-256 while streaming to a temporary file and atomically renaming on success.
- Persists files outside public web roots under random UUID filenames + validated extension.
- Defends against path traversal via resolve().is_relative_to() and filename sanitization for
  safe Content-Disposition response headers.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

from kalyan_api.core.errors import ApiError
from kalyan_api.models import DocumentCategory

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024  # 10 MB
STREAM_CHUNK_SIZE = 64 * 1024  # 64 KiB

PDF_MAGIC = b"%PDF-"
JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_MIN_HEADER_BYTES = len(PNG_MAGIC)

CLINICAL_DOCUMENT_CATEGORIES: frozenset[str] = frozenset(
    {
        DocumentCategory.LAB_REPORT.value,
        DocumentCategory.IMAGING.value,
        DocumentCategory.PRESCRIPTION_SCAN.value,
        DocumentCategory.DISCHARGE_SUMMARY.value,
    }
)

VALID_DOCUMENT_CATEGORIES: frozenset[str] = frozenset(cat.value for cat in DocumentCategory)


@dataclass(frozen=True)
class StoredDocumentFile:
    """Metadata produced after validating and persisting an uploaded document."""

    stored_filename: str
    mime_type: str
    file_size_bytes: int
    sha256_hex: str


def validate_magic_bytes(header: bytes) -> tuple[str, str]:
    """Validate document magic bytes and return (extension, mime_type).

    Accepts PDF (%PDF-), JPEG (FF D8 FF), and PNG (89 50 4E 47 0D 0A 1A 0A).
    """
    if len(header) == 0:
        raise ApiError(
            status_code=422,
            code="empty_file",
            message="Uploaded document is empty.",
        )

    if header.startswith(PDF_MAGIC):
        return ".pdf", "application/pdf"
    if header.startswith(JPEG_MAGIC):
        return ".jpg", "image/jpeg"
    if header.startswith(PNG_MAGIC):
        return ".png", "image/png"

    raise ApiError(
        status_code=422,
        code="unsupported_file_type",
        message="Unsupported document format. Allowed formats: PDF, JPEG, PNG.",
    )


async def save_uploaded_document(
    upload: UploadFile,
    documents_dir: Path,
) -> StoredDocumentFile:
    """Stream-validate, hash, and persist an uploaded document under a random UUID filename."""
    documents_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = documents_dir / f".tmp-{uuid.uuid4().hex}"

    header = bytearray()
    hasher = hashlib.sha256()
    total_bytes = 0
    ext = ""
    mime_type = ""
    magic_validated = False

    try:
        with tmp_path.open("wb") as fh:
            while True:
                chunk = await upload.read(STREAM_CHUNK_SIZE)
                if not chunk:
                    break

                total_bytes += len(chunk)
                if total_bytes > MAX_DOCUMENT_BYTES:
                    raise ApiError(
                        status_code=413,
                        code="file_too_large",
                        message="Uploaded document exceeds maximum allowed size of 10 MB.",
                    )

                if len(header) < _MIN_HEADER_BYTES:
                    needed = _MIN_HEADER_BYTES - len(header)
                    header.extend(chunk[:needed])

                if not magic_validated and len(header) >= _MIN_HEADER_BYTES:
                    ext, mime_type = validate_magic_bytes(bytes(header))
                    magic_validated = True

                hasher.update(chunk)
                fh.write(chunk)

        if total_bytes == 0:
            raise ApiError(
                status_code=422,
                code="empty_file",
                message="Uploaded document is empty.",
            )

        if not magic_validated:
            ext, mime_type = validate_magic_bytes(bytes(header))

        stored_filename = f"{uuid.uuid4().hex}{ext}"
        final_path = resolve_document_path(stored_filename, documents_dir)
        tmp_path.replace(final_path)
    except Exception:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        raise

    return StoredDocumentFile(
        stored_filename=stored_filename,
        mime_type=mime_type,
        file_size_bytes=total_bytes,
        sha256_hex=hasher.hexdigest(),
    )


def resolve_document_path(stored_filename: str, documents_dir: Path) -> Path:
    """Resolve stored_filename inside documents_dir, blocking any path traversal attempt."""
    if (
        not stored_filename
        or "\x00" in stored_filename
        or "/" in stored_filename
        or "\\" in stored_filename
        or stored_filename in {".", ".."}
        or Path(stored_filename).name != stored_filename
    ):
        raise ApiError(
            status_code=400,
            code="invalid_document_path",
            message="Invalid document path.",
        )

    base_dir = documents_dir.resolve()
    candidate = (base_dir / stored_filename).resolve()
    if not candidate.is_relative_to(base_dir) or candidate == base_dir:
        raise ApiError(
            status_code=400,
            code="invalid_document_path",
            message="Invalid document path.",
        )
    return candidate


def sanitize_download_filename(filename: str | None, fallback: str = "document") -> str:
    """Strip path separators, control chars (CR/LF/tab), quotes, and unsafe chars for headers."""
    raw = (filename or "").replace("\x00", "")
    # Remove CR, LF, tabs, and all other ASCII control characters before parsing.
    raw = re.sub(r"[\x00-\x1f\x7f]+", "", raw)
    # Strip any POSIX or Windows directory components.
    raw = re.split(r"[/\\]", raw)[-1]
    # Replace quotes, semicolons, and unsafe header characters.
    cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")

    if not cleaned or cleaned in {".", ".."}:
        return fallback

    if len(cleaned) > 200:
        suffix = Path(cleaned).suffix
        if suffix and len(suffix) <= 16:
            stem = cleaned[: 200 - len(suffix)].rstrip(" .")
            cleaned = f"{stem}{suffix}" if stem else fallback
        else:
            cleaned = cleaned[:200].rstrip(" .") or fallback

    return cleaned


def delete_document_file(stored_filename: str, documents_dir: Path) -> None:
    """Best-effort cleanup for a newly written file when DB persistence fails."""
    try:
        path = resolve_document_path(stored_filename, documents_dir)
        if path.is_file():
            path.unlink()
    except (ApiError, OSError):
        pass
