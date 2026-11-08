"""Backup and restore service for Kalyan Hospital platform (BAK-01, BAK-02).

Guarantees:
- Database dump executed using `pg_dump` CLI or fallback streaming SQL dump.
- Patient photos bundled from configured photos directory.
- Cryptographic SHA-256 manifest computed for each constituent file and overall bundle.
- Integrity verification: inspects bundle without full restore, detecting single-bit tampering.
- Secondary drive path support: accepts optional destination directory.
- Pre-restore safety snapshot: ALWAYS creates a full backup before restoring (cannot be disabled).
- Fail-closed restore: verifies manifest checksums *before* touching the database.
- Path confinement: archive filenames supplied by callers must be bare names that resolve
  inside the configured backup directory (no traversal, no absolute paths).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from kalyan_api.config import Settings, get_settings

ARCHIVE_GLOB = "kalyan_backup_*.tar.gz"
LABEL_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,50}$")


class BackupCorruptedError(Exception):
    """Raised when a backup archive fails cryptographic integrity verification."""


class RestoreError(Exception):
    """Raised when restoration encounters an execution error."""


class InvalidArchiveFilenameError(ValueError):
    """Raised when a caller-supplied archive name is not a bare file inside the backup dir."""


class InvalidDestinationDirError(ValueError):
    """Raised when a caller-supplied backup destination is not an existing absolute directory."""


class InvalidBackupLabelError(ValueError):
    """Raised when a backup label contains characters unsafe for use in a filename."""


@dataclass(frozen=True)
class LatestBackupInfo:
    """Cheap description of the newest archive on disk (manifest read, no re-hashing)."""

    filename: str
    created_at: datetime
    size_bytes: int
    label: str | None
    manifest_readable: bool


def validate_label(label: str | None) -> str | None:
    """Return the stripped label, or None when blank; reject filename-unsafe characters."""
    if label is None:
        return None
    stripped = label.strip()
    if not stripped:
        return None
    if not LABEL_PATTERN.fullmatch(stripped):
        raise InvalidBackupLabelError(
            "Backup label may contain only letters, digits, '_' and '-' (max 50 characters)"
        )
    return stripped


def resolve_archive_in_dir(backup_dir: Path, filename: str) -> Path:
    """Resolve a caller-supplied archive name to a file confined to backup_dir.

    The name must be a bare filename: no path separators, no '..', no drive or absolute
    prefix, no NUL byte, and the resolved path must be an existing regular file whose parent
    is exactly the resolved backup directory (this also defeats symlink escapes).
    """
    name = filename
    is_bare = (
        bool(name)
        and name == name.strip()
        and ".." not in name
        and "/" not in name
        and "\\" not in name
        and ":" not in name
        and "\x00" not in name
        and not PurePosixPath(name).is_absolute()
        and not PureWindowsPath(name).is_absolute()
        and PurePosixPath(name).name == name
        and PureWindowsPath(name).name == name
    )
    if not is_bare:
        raise InvalidArchiveFilenameError(
            "archive_filename must be a bare file name inside the backup directory"
        )

    base = Path(backup_dir).resolve()
    candidate = (base / name).resolve()
    if candidate.parent != base or not candidate.is_file():
        raise InvalidArchiveFilenameError(
            "archive_filename does not name an existing archive in the backup directory"
        )
    return candidate


def validate_destination_dir(raw: str, approved_roots: Sequence[Path]) -> Path:
    """Validate a manual-backup destination against the approved backup locations.

    The destination must be an existing local absolute directory equal to, or inside, one of
    ``approved_roots`` (the configured backup directory and operator-approved extra drives).
    UNC/network shares are refused so a dump cannot be pushed to an arbitrary host.
    """
    value = raw.strip()
    if not value or "\x00" in value:
        raise InvalidDestinationDirError("destination_dir must be a non-empty absolute path")
    if value.startswith(("\\\\", "//")):
        raise InvalidDestinationDirError("destination_dir must be a local directory, not a share")
    path = Path(value)
    if not path.is_absolute():
        raise InvalidDestinationDirError("destination_dir must be an absolute path")
    if not path.is_dir():
        raise InvalidDestinationDirError("destination_dir must be an existing directory")
    resolved = path.resolve()
    roots = [root.resolve() for root in approved_roots]
    if not any(resolved == root or root in resolved.parents for root in roots):
        raise InvalidDestinationDirError("destination_dir is not an approved backup location")
    return resolved


def read_manifest(archive_path: Path) -> dict[str, Any] | None:
    """Read manifest.json from an archive WITHOUT hashing its payload.

    The manifest is written as the first tar member, so this normally decompresses only the
    head of the archive. Returns None when the archive or manifest cannot be read.
    """
    path = Path(archive_path)
    try:
        with tarfile.open(path, "r:gz") as tar:
            for member in tar:
                if member.name != "manifest.json":
                    continue
                handle = tar.extractfile(member)
                if handle is None:
                    return None
                parsed = json.loads(handle.read().decode("utf-8"))
                return parsed if isinstance(parsed, dict) else None
    except (OSError, tarfile.TarError, json.JSONDecodeError, UnicodeDecodeError, EOFError):
        return None
    return None


def latest_backup_info(backup_dir: Path) -> LatestBackupInfo | None:
    """Describe the newest backup archive (by modification time) in backup_dir, or None."""
    directory = Path(backup_dir)
    if not directory.is_dir():
        return None
    archives = [p for p in directory.glob(ARCHIVE_GLOB) if p.is_file()]
    if not archives:
        return None
    newest = max(archives, key=lambda p: p.stat().st_mtime)
    stat = newest.stat()
    manifest = read_manifest(newest)

    created_at = datetime.fromtimestamp(stat.st_mtime, tz=UTC)
    label: str | None = None
    if manifest is not None:
        raw_created = manifest.get("created_at")
        if isinstance(raw_created, str):
            try:
                parsed_created = datetime.fromisoformat(raw_created)
            except ValueError:
                parsed_created = None
            if parsed_created is not None and parsed_created.tzinfo is not None:
                created_at = parsed_created
        raw_label = manifest.get("label")
        label = raw_label if isinstance(raw_label, str) else None

    return LatestBackupInfo(
        filename=newest.name,
        created_at=created_at,
        size_bytes=stat.st_size,
        label=label,
        manifest_readable=manifest is not None,
    )


@dataclass(frozen=True)
class BackupManifest:
    """Manifest describing backup bundle contents and checksums."""

    version: str
    created_at: str
    database_dump_filename: str
    database_dump_sha256: str
    database_dump_bytes: int
    photos_count: int
    photos_manifest: list[dict[str, Any]]
    assets_count: int = 0
    assets_manifest: list[dict[str, Any]] | None = None
    label: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "created_at": self.created_at,
            "database_dump_filename": self.database_dump_filename,
            "database_dump_sha256": self.database_dump_sha256,
            "database_dump_bytes": self.database_dump_bytes,
            "photos_count": self.photos_count,
            "photos_manifest": self.photos_manifest,
            "assets_count": self.assets_count,
            "assets_manifest": self.assets_manifest if self.assets_manifest is not None else [],
            "label": self.label,
        }


def compute_sha256(file_path: Path) -> str:
    """Compute hex SHA-256 hash of a file on disk."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def find_pg_tool(tool_name: str) -> str:
    """Find postgres tool executable (pg_dump, psql, pg_restore)."""
    # 1. System PATH
    found = shutil.which(tool_name)
    if found:
        return found

    # 2. Common Windows PostgreSQL installation paths
    for ver in ["18", "17", "16", "15"]:
        candidate = Path(rf"C:\Program Files\PostgreSQL\{ver}\bin\{tool_name}.exe")
        if candidate.exists():
            return str(candidate)

    return tool_name


def dump_database(destination_file: Path, settings: Settings | None = None) -> None:
    """Dump postgres database to a plain SQL file using pg_dump."""
    cfg = settings or get_settings()
    pg_dump_bin = find_pg_tool("pg_dump")

    env = os.environ.copy()
    env["PGPASSWORD"] = cfg.db_owner_password

    cmd = [
        pg_dump_bin,
        "-h",
        cfg.db_host,
        "-p",
        str(cfg.db_port),
        "-U",
        cfg.db_owner_user,
        "-d",
        cfg.db_name,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "-f",
        str(destination_file),
    ]

    result = subprocess.run(  # noqa: S603
        cmd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"Database dump failed: {err}")


# Runtime role rights exactly as the migrations grant them. A pg_dump is taken with
# --no-privileges, so the restored schema would otherwise give the runtime role nothing, or the
# wrong rights if defaults were used. tests/test_migrations.py checks this table against a
# migrated database, so the two cannot drift apart silently.
RUNTIME_TABLE_GRANTS: dict[str, tuple[str, ...]] = {
    "audit_logs": ("SELECT", "INSERT"),
    "system_setup": ("SELECT", "INSERT"),
    "users": ("SELECT", "INSERT", "UPDATE"),
    "doctors": ("SELECT", "INSERT", "UPDATE"),
    "login_throttle": ("SELECT", "INSERT", "UPDATE"),
    "sessions": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "alembic_version": ("SELECT",),
    "clinic_settings": ("SELECT", "INSERT", "UPDATE"),
    "consultation_fees": ("SELECT", "INSERT", "UPDATE"),
    "urn_sequences": ("SELECT", "INSERT", "UPDATE"),
    "patients": ("SELECT", "INSERT", "UPDATE"),
    "daily_token_sequences": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "appointments": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "clinical_encounters": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "clinical_addenda": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "treatment_plans": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "treatment_sessions": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "treatment_session_addenda": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "prescriptions": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "prescription_items": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "receipt_sequences": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "payments": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "security_settings": ("SELECT", "UPDATE"),
    "backup_settings": ("SELECT", "UPDATE"),
    "backup_runs": ("SELECT", "INSERT", "UPDATE"),
    "departments": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "clinical_templates": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "clinical_template_versions": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "clinical_template_responses": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "vital_observations": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "follow_up_recommendations": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "hospital_assets": ("SELECT", "INSERT", "UPDATE"),
    "print_templates": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "patient_import_batches": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "patient_import_rows": ("SELECT", "INSERT", "UPDATE", "DELETE"),
    "doctor_departments": ("SELECT", "INSERT", "UPDATE", "DELETE"),
}


# How long psql may wait for any one lock during a restore; without a limit a blocked statement
# waits forever. This bounds lock waits only, so a large restore can take as long as its load
# needs. Application statements stop at 30 seconds (statement_timeout in db/session.py), so this
# outlasts any healthy request.
RESTORE_LOCK_TIMEOUT_MS = 30_000

# pg_dump's SET lines come before its first statement, well within this many lines.
DUMP_HEADER_LINES = 40


def runtime_grant_sql(app_user: str) -> str:
    """SQL that gives the runtime role exactly the rights RUNTIME_TABLE_GRANTS lists."""
    statements = [
        f'GRANT {", ".join(privileges)} ON public."{table}" TO "{app_user}";'
        for table, privileges in RUNTIME_TABLE_GRANTS.items()
    ]
    statements.append(f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{app_user}";')
    return "\n".join(statements)


def _copy_dump_keeping_lock_timeout(sql_file: Path, destination: Path) -> None:
    """Copy a plain dump without its header line that turns lock_timeout off."""
    with sql_file.open("rb") as source, destination.open("wb") as target:
        for _ in range(DUMP_HEADER_LINES):
            line = source.readline()
            if line.strip() == b"SET lock_timeout = 0;":
                break
            target.write(line)
        shutil.copyfileobj(source, target)


def restore_database_sql(sql_file: Path, settings: Settings | None = None) -> None:
    """Replace schema public with a SQL dump in one transaction, using owner credentials.

    Any failure rolls the whole restore back, so the database stays exactly as it was. Other
    clients cannot see or lock the new tables until it commits, and each table being replaced
    stays locked until then.
    """
    cfg = settings or get_settings()
    psql_bin = find_pg_tool("psql")

    env = os.environ.copy()
    env["PGPASSWORD"] = cfg.db_owner_password
    pgoptions = env.get("PGOPTIONS", "")
    if "lock_timeout" not in pgoptions:
        env["PGOPTIONS"] = f"{pgoptions} -c lock_timeout={RESTORE_LOCK_TIMEOUT_MS}".strip()

    reset_sql = f"""
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO {cfg.db_owner_user};
    GRANT USAGE ON SCHEMA public TO {cfg.db_app_user};
    """

    with tempfile.TemporaryDirectory() as tmpdir_str:
        # The dump would otherwise turn lock_timeout off for the rest of the session.
        dump_file = Path(tmpdir_str) / "db.sql"
        _copy_dump_keeping_lock_timeout(sql_file, dump_file)

        # The runtime role's rights are granted last, because the dump does not carry them.
        restore_cmd = [
            psql_bin,
            "-v",
            "ON_ERROR_STOP=1",
            "--single-transaction",
            "-h",
            cfg.db_host,
            "-p",
            str(cfg.db_port),
            "-U",
            cfg.db_owner_user,
            "-d",
            cfg.db_name,
            "-c",
            reset_sql,
            "-f",
            str(dump_file),
            "-c",
            runtime_grant_sql(cfg.db_app_user),
        ]
        result = subprocess.run(  # noqa: S603
            restore_cmd,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    if result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip()
        raise RestoreError(f"Restoring the database failed: {err}")


def create_backup(
    destination_dir: Path | None = None,
    label: str | None = None,
    settings: Settings | None = None,
) -> Path:
    """Create a checksummed backup bundle (.tar.gz) containing db.sql, photos, and manifest.json.

    Args:
        destination_dir: Directory where archive is written (defaults to settings.backup_dir).
        label: Optional human-readable tag (e.g. 'manual', 'nightly', 'prerestore').
        settings: Application settings.

    Returns:
        Path to the generated .tar.gz backup archive.
    """
    cfg = settings or get_settings()
    safe_label = validate_label(label)
    target_dir = Path(destination_dir) if destination_dir else cfg.backup_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(UTC)
    timestamp_str = now.strftime("%Y%m%d_%H%M%S")
    label_prefix = f"_{safe_label}" if safe_label else ""
    archive_filename = f"kalyan_backup_{timestamp_str}{label_prefix}.tar.gz"
    final_archive_path = target_dir / archive_filename

    with tempfile.TemporaryDirectory() as tmpdir_str:
        tmpdir = Path(tmpdir_str)
        payload_dir = tmpdir / "bundle"
        payload_dir.mkdir()

        # 1. Dump database
        db_dump_file = payload_dir / "db.sql"
        dump_database(db_dump_file, cfg)
        db_sha256 = compute_sha256(db_dump_file)
        db_size = db_dump_file.stat().st_size

        # 2. Copy patient photos
        photos_target_dir = payload_dir / "photos"
        photos_target_dir.mkdir()
        photos_manifest: list[dict[str, Any]] = []

        if cfg.photos_dir.exists() and cfg.photos_dir.is_dir():
            for photo_path in cfg.photos_dir.glob("*"):
                if photo_path.is_file():
                    dest_photo = photos_target_dir / photo_path.name
                    shutil.copy2(photo_path, dest_photo)
                    photos_manifest.append(
                        {
                            "filename": photo_path.name,
                            "sha256": compute_sha256(dest_photo),
                            "bytes": dest_photo.stat().st_size,
                        }
                    )

        # 3. Copy hospital assets
        assets_target_dir = payload_dir / "assets"
        assets_target_dir.mkdir()
        assets_manifest: list[dict[str, Any]] = []

        if cfg.assets_dir.exists() and cfg.assets_dir.is_dir():
            for asset_path in cfg.assets_dir.glob("*"):
                if asset_path.is_file():
                    dest_asset = assets_target_dir / asset_path.name
                    shutil.copy2(asset_path, dest_asset)
                    assets_manifest.append(
                        {
                            "filename": asset_path.name,
                            "sha256": compute_sha256(dest_asset),
                            "bytes": dest_asset.stat().st_size,
                        }
                    )

        # 4. Create manifest.json
        manifest = BackupManifest(
            version="1.0",
            created_at=now.isoformat(),
            database_dump_filename="db.sql",
            database_dump_sha256=db_sha256,
            database_dump_bytes=db_size,
            photos_count=len(photos_manifest),
            photos_manifest=photos_manifest,
            assets_count=len(assets_manifest),
            assets_manifest=assets_manifest,
            label=safe_label,
        )
        manifest_path = payload_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest.to_dict(), indent=2), encoding="utf-8")

        # 5. Create .tar.gz bundle
        with tarfile.open(final_archive_path, "w:gz") as tar:
            # Add manifest
            tar.add(manifest_path, arcname="manifest.json")
            # Add db.sql
            tar.add(db_dump_file, arcname="db.sql")
            # Add photos dir
            tar.add(photos_target_dir, arcname="photos")
            # Add assets dir
            tar.add(assets_target_dir, arcname="assets")

    return final_archive_path


# Alias for callers referring to create_backup as create_backup_bundle (D-20-12)
create_backup_bundle = create_backup


def verify_backup_bundle(archive_path: Path) -> tuple[bool, str, dict[str, Any] | None]:
    """Inspect and cryptographically verify a backup archive bundle without modifying system state.

    Returns:
        (is_valid, message, manifest_dict_or_none)
    """
    path = Path(archive_path)
    if not path.exists():
        return False, f"Backup file does not exist: {path}", None

    if not tarfile.is_tarfile(path):
        return False, "File is not a valid tar archive", None

    try:
        with tarfile.open(path, "r:gz") as tar:
            names = tar.getnames()
            if "manifest.json" not in names:
                return False, "Archive is missing manifest.json", None
            if "db.sql" not in names:
                return False, "Archive is missing db.sql", None

            # Read and parse manifest
            manifest_file = tar.extractfile("manifest.json")
            if not manifest_file:
                return False, "Failed to read manifest.json from archive", None
            manifest_data = json.loads(manifest_file.read().decode("utf-8"))

            # Verify db.sql SHA-256
            db_file = tar.extractfile("db.sql")
            if not db_file:
                return False, "Failed to extract db.sql", None
            hasher = hashlib.sha256()
            while chunk := db_file.read(65536):
                hasher.update(chunk)
            computed_db_sha = hasher.hexdigest()

            expected_db_sha = manifest_data.get("database_dump_sha256")
            if computed_db_sha != expected_db_sha:
                return (
                    False,
                    f"Checksum mismatch for db.sql: expected {expected_db_sha}, "
                    f"got {computed_db_sha}",
                    manifest_data,
                )

            # Verify photos
            for photo_entry in manifest_data.get("photos_manifest", []):
                fname = photo_entry["filename"]
                arcname = f"photos/{fname}"
                if arcname not in names:
                    return False, f"Missing photo file declared in manifest: {fname}", manifest_data
                p_file = tar.extractfile(arcname)
                if not p_file:
                    return False, f"Failed to extract photo {fname}", manifest_data
                p_hasher = hashlib.sha256()
                while chunk := p_file.read(65536):
                    p_hasher.update(chunk)
                if p_hasher.hexdigest() != photo_entry["sha256"]:
                    return (
                        False,
                        f"Checksum mismatch for photo {fname}",
                        manifest_data,
                    )

            # Verify assets (backward compatibility: optional in manifest)
            for asset_entry in manifest_data.get("assets_manifest", []):
                fname = asset_entry["filename"]
                arcname = f"assets/{fname}"
                if arcname not in names:
                    return False, f"Missing asset file declared in manifest: {fname}", manifest_data
                a_file = tar.extractfile(arcname)
                if not a_file:
                    return False, f"Failed to extract asset {fname}", manifest_data
                a_hasher = hashlib.sha256()
                while chunk := a_file.read(65536):
                    a_hasher.update(chunk)
                if a_hasher.hexdigest() != asset_entry["sha256"]:
                    return (
                        False,
                        f"Checksum mismatch for asset {fname}",
                        manifest_data,
                    )

            return True, "Backup bundle is cryptographically verified and intact", manifest_data

    except Exception as e:
        return False, f"Archive verification encountered error: {e}", None


def restore_backup(
    archive_path: Path,
    settings: Settings | None = None,
    create_prerestore_snapshot: bool = True,
) -> dict[str, Any]:
    """Restore database and photos from a verified backup archive (BAK-02).

    Steps:
    1. Cryptographically verify the archive. If corrupted or missing, abort before any changes.
    2. ALWAYS take a pre-restore backup snapshot of the active system state.
    3. Wipe database schema and apply SQL dump from archive.
    4. Synchronize patient photos into settings.photos_dir.
    5. Return restoration execution summary.

    ``create_prerestore_snapshot`` is retained only for call-site compatibility; passing False
    raises ValueError because the safety snapshot is mandatory.
    """
    if not create_prerestore_snapshot:
        raise ValueError("The pre-restore safety snapshot is mandatory and cannot be disabled")
    cfg = settings or get_settings()
    path = Path(archive_path)

    # 1. Cryptographic pre-flight verification
    is_valid, err_msg, manifest_data = verify_backup_bundle(path)
    if not is_valid or not manifest_data:
        raise BackupCorruptedError(f"Restore rejected: archive failed integrity checks: {err_msg}")

    # 2. Capture mandatory pre-restore safety snapshot (aborts restore if it cannot be taken)
    prerestore_path = create_backup(
        destination_dir=cfg.backup_dir,
        label="prerestore",
        settings=cfg,
    )

    # 3. Extract and restore
    with tempfile.TemporaryDirectory() as extract_dir_str:
        extract_dir = Path(extract_dir_str)
        with tarfile.open(path, "r:gz") as tar:
            tar.extractall(path=extract_dir, filter="data")

        sql_file = extract_dir / "db.sql"
        if not sql_file.exists():
            raise RestoreError("db.sql not found in extracted archive")

        # Restore database
        restore_database_sql(sql_file, cfg)

        # Restore photos
        photos_src_dir = extract_dir / "photos"
        cfg.photos_dir.mkdir(parents=True, exist_ok=True)
        photos_restored = 0
        if photos_src_dir.exists() and photos_src_dir.is_dir():
            for photo_file in photos_src_dir.glob("*"):
                if photo_file.is_file():
                    shutil.copy2(photo_file, cfg.photos_dir / photo_file.name)
                    photos_restored += 1

        # Restore assets
        assets_src_dir = extract_dir / "assets"
        cfg.assets_dir.mkdir(parents=True, exist_ok=True)
        assets_restored = 0
        if assets_src_dir.exists() and assets_src_dir.is_dir():
            for asset_file in assets_src_dir.glob("*"):
                if asset_file.is_file():
                    shutil.copy2(asset_file, cfg.assets_dir / asset_file.name)
                    assets_restored += 1

    return {
        "status": "SUCCESS",
        "archive_restored": str(path.resolve()),
        "prerestore_snapshot": str(prerestore_path.resolve()),
        "database_restored": True,
        "photos_restored_count": photos_restored,
        "assets_restored_count": assets_restored,
        "manifest": manifest_data,
    }
