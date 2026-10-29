"""
Backup Service - Hot SQLite Online Backups and Verified Restore Pipeline.
Supports unified archives (.kalyan_bak) bundling SQLite database and patient photos.
Kalyan Hospital Management System.
"""

import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from app.config import BACKUP_DIR, DB_PATH, PHOTOS_DIR
from app.db.connection import get_db_connection
from app.services.audit_service import AuditService

REQUIRED_TABLES = (
    "patients",
    "treatment_cases",
    "treatment_sessions",
    "payments",
    "users",
    "id_sequences",
    "doctors",
)


class BackupService:
    """Manages hot SQLite database backups and verified restore operations."""

    def __init__(
        self,
        db_path: Optional[str] = None,
        backup_dir: Optional[str] = None,
        photos_dir: Optional[str] = None,
    ):
        self.db_path = Path(db_path) if db_path else Path(DB_PATH)
        self.backup_dir = Path(backup_dir) if backup_dir else Path(BACKUP_DIR)
        self.photos_dir = Path(photos_dir) if photos_dir else Path(PHOTOS_DIR)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.photos_dir.mkdir(parents=True, exist_ok=True)
        self._audit = AuditService(str(self.db_path))

    def create_backup(self, target_dir: Optional[str] = None, bundle_photos: bool = True) -> Path:
        """
        Creates an atomic, non-blocking hot backup snapshot of the active database
        using SQLite's native Online Backup API (Connection.backup()).
        
        When bundle_photos=True, bundles the database and all local patient photos
        into a unified, verified .kalyan_bak archive.
        
        Returns:
            Absolute Path of the created backup file.
        """
        dest_dir = Path(target_dir) if target_dir else self.backup_dir
        dest_dir.mkdir(parents=True, exist_ok=True)

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = (
            f"kalyan_backup_{timestamp_str}.kalyan_bak"
            if bundle_photos
            else f"kalyan_backup_{timestamp_str}.db"
        )
        dest_path = dest_dir / backup_filename

        self._audit.log_event(
            action="BACKUP_CREATED",
            entity_type="DATABASE",
            entity_id=backup_filename,
            actor_name="System",
            details=f"Local backup archive created: {dest_path.name}",
        )

        # Step 1: Create atomic SQLite database snapshot in temp file
        tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp_db_path = Path(tmp_db.name)
        tmp_db.close()

        try:
            with get_db_connection(str(self.db_path)) as src_conn:
                if str(self.db_path) != ":memory:":
                    try:
                        src_conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                    except sqlite3.OperationalError:
                        pass
                dest_conn = sqlite3.connect(str(tmp_db_path))
                try:
                    src_conn.backup(dest_conn)
                finally:
                    dest_conn.close()

            if bundle_photos:
                photo_files = [f for f in self.photos_dir.glob("*") if f.is_file()]
                manifest = {
                    "version": "2.0",
                    "created_at": datetime.now().isoformat(),
                    "app": "Kalyan Hospital Management System",
                    "photo_count": len(photo_files),
                    "db_size_bytes": tmp_db_path.stat().st_size,
                }

                with zipfile.ZipFile(str(dest_path), "w", compression=zipfile.ZIP_DEFLATED) as zf:
                    zf.write(str(tmp_db_path), arcname="kalyan.db")
                    zf.writestr("manifest.json", json.dumps(manifest, indent=2))
                    for photo in photo_files:
                        zf.write(str(photo), arcname=f"photos/{photo.name}")
            else:
                shutil.copy2(str(tmp_db_path), str(dest_path))

        finally:
            if tmp_db_path.exists():
                tmp_db_path.unlink()

        return dest_path.resolve()

    def verify_backup_integrity(self, backup_path: str) -> Dict[str, Any]:
        """
        Validates the integrity and structural health of a backup archive or database file
        without altering or locking live clinic data.
        """
        path = Path(backup_path)
        if not path.exists():
            return {
                "valid": False,
                "error": f"Backup file does not exist: {backup_path}",
            }

        file_size = path.stat().st_size
        if file_size == 0:
            return {
                "valid": False,
                "error": "Backup file is empty (0 bytes).",
                "file_size_bytes": 0,
            }

        is_bundle = path.suffix in (".kalyan_bak", ".zip")
        photo_count = 0

        # If it's a bundled archive, extract DB to temp file and test zip integrity
        if is_bundle:
            try:
                with zipfile.ZipFile(str(path), "r") as zf:
                    bad_file = zf.testzip()
                    if bad_file:
                        return {"valid": False, "error": f"Corrupt archive: {bad_file}"}

                    namelist = zf.namelist()
                    if "kalyan.db" not in namelist:
                        return {"valid": False, "error": "Archive missing kalyan.db"}

                    photo_count = sum(1 for n in namelist if n.startswith("photos/") and not n.endswith("/"))

                    tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
                    tmp_db.write(zf.read("kalyan.db"))
                    tmp_db.close()
                    db_to_inspect = Path(tmp_db.name)
            except Exception as exc:
                return {"valid": False, "error": f"Failed reading archive: {exc}"}
        else:
            db_to_inspect = path

        try:
            uri = f"file:{db_to_inspect.as_posix()}?mode=ro"
            conn = sqlite3.connect(uri, uri=True, timeout=5.0)
            conn.row_factory = sqlite3.Row
            try:
                cursor = conn.cursor()

                # 1. Run PRAGMA integrity_check
                cursor.execute("PRAGMA integrity_check;")
                integrity_result = cursor.fetchall()
                is_healthy = any(row[0] == "ok" for row in integrity_result)
                if not is_healthy:
                    return {
                        "valid": False,
                        "error": f"SQLite PRAGMA integrity check failed: {integrity_result}",
                        "file_size_bytes": file_size,
                    }

                # 2. Verify all required canonical tables exist
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                existing_tables = {row[0] for row in cursor.fetchall()}
                missing_tables = [t for t in REQUIRED_TABLES if t not in existing_tables]
                if missing_tables:
                    return {
                        "valid": False,
                        "error": f"Backup is structurally incomplete. Missing required table(s): {', '.join(missing_tables)}",
                        "file_size_bytes": file_size,
                    }

                # 3. Inspect table row counts
                def _get_count(table_name: str) -> int:
                    cursor.execute(f"SELECT COUNT(*) AS c FROM {table_name}")
                    r = cursor.fetchone()
                    return r["c"] if r else 0

                patients_cnt = _get_count("patients")
                cases_cnt = _get_count("treatment_cases")
                sessions_cnt = _get_count("treatment_sessions")
                payments_cnt = _get_count("payments")
            finally:
                conn.close()

            mtime = datetime.fromtimestamp(path.stat().st_mtime)

            return {
                "valid": True,
                "filename": path.name,
                "file_size_bytes": file_size,
                "file_size_kb": round(file_size / 1024.0, 1),
                "created_at": mtime.strftime("%Y-%m-%d %H:%M:%S"),
                "is_bundle": is_bundle,
                "photo_count": photo_count,
                "patients_count": patients_cnt,
                "cases_count": cases_cnt,
                "sessions_count": sessions_cnt,
                "payments_count": payments_cnt,
            }
        except Exception as e:
            return {
                "valid": False,
                "error": f"Failed to read backup database: {str(e)}",
                "file_size_bytes": file_size,
            }
        finally:
            if is_bundle and db_to_inspect.exists():
                db_to_inspect.unlink()

    def list_backups(self) -> List[Dict[str, Any]]:
        """
        Scans the backup directory for *.kalyan_bak, *.zip, and *.db files
        ordered by modification time descending (newest first).
        """
        if not self.backup_dir.exists():
            return []

        backups = []
        patterns = ("*.kalyan_bak", "*.zip", "*.db")
        found_files = []
        for p in patterns:
            found_files.extend(self.backup_dir.glob(p))

        for file in found_files:
            info = self.verify_backup_integrity(str(file))
            backups.append({
                "path": str(file.resolve()),
                "filename": file.name,
                "mtime": file.stat().st_mtime,
                **info,
            })

        backups.sort(key=lambda x: x["mtime"], reverse=True)
        return backups

    def restore_from_backup(self, backup_path: str) -> Dict[str, Any]:
        """
        Restores the active clinic database and patient photos from a backup archive
        following a verified, fail-safe 4-step pipeline:
        
        Step 1: Pre-restore verification in an isolated connection.
        Step 2: Create a safety rollback snapshot of current live database and photos.
        Step 3: Copy backup DB to active path and safely extract photos.
        Step 4: Verify restored database health; if unhealthy, automatically rollback.
        
        Returns:
            Dict containing success status and restored record counts.
        """
        target = Path(backup_path)
        verification = self.verify_backup_integrity(backup_path)
        if not verification.get("valid"):
            raise ValueError(f"Cannot restore from corrupt backup: {verification.get('error')}")

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        safety_db_path = self.backup_dir / f"safety_pre_restore_{timestamp_str}.bak"
        safety_photos_path = self.backup_dir / f"safety_photos_{timestamp_str}.zip"

        # Step 2: Create safety snapshot of live database
        if self.db_path.exists():
            try:
                with get_db_connection(str(self.db_path)) as live_conn:
                    if str(self.db_path) != ":memory:":
                        try:
                            live_conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                        except sqlite3.OperationalError:
                            pass
                    with sqlite3.connect(str(safety_db_path)) as safety_conn:
                        live_conn.backup(safety_conn)
            except Exception as e:
                raise RuntimeError(f"Failed to create pre-restore DB safety snapshot: {str(e)}")

        # Safety snapshot of live photos
        current_photos = list(self.photos_dir.glob("*"))
        if current_photos:
            with zipfile.ZipFile(str(safety_photos_path), "w") as zf:
                for p in current_photos:
                    if p.is_file():
                        zf.write(str(p), arcname=p.name)

        is_bundle = target.suffix in (".kalyan_bak", ".zip")

        try:
            # Step 3: Copy backup to active database
            if is_bundle:
                with zipfile.ZipFile(str(target), "r") as zf:
                    tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
                    tmp_db.write(zf.read("kalyan.db"))
                    tmp_db.close()
                    extracted_db = Path(tmp_db.name)

                    try:
                        src_conn = sqlite3.connect(str(extracted_db))
                        dst_conn = sqlite3.connect(str(self.db_path))
                        try:
                            src_conn.backup(dst_conn)
                        finally:
                            dst_conn.close()
                            src_conn.close()
                    finally:
                        if extracted_db.exists():
                            extracted_db.unlink()

                    # Unpack photos with strict path traversal protection
                    for member in zf.namelist():
                        if member.startswith("photos/") and not member.endswith("/"):
                            clean_filename = Path(member).name
                            if clean_filename and ".." not in clean_filename:
                                dest_photo = self.photos_dir / clean_filename
                                with open(dest_photo, "wb") as pf:
                                    pf.write(zf.read(member))
            else:
                src_conn = sqlite3.connect(str(target))
                dst_conn = sqlite3.connect(str(self.db_path))
                try:
                    src_conn.backup(dst_conn)
                finally:
                    dst_conn.close()
                    src_conn.close()

        except Exception as e:
            # Automatic rollback if copy failed
            self._rollback(safety_db_path, safety_photos_path)
            raise RuntimeError(f"Database restoration failed during stream copy: {str(e)}")

        # Step 4: Verify restored active database health
        post_verify = self.verify_backup_integrity(str(self.db_path))
        if not post_verify.get("valid"):
            self._rollback(safety_db_path, safety_photos_path)
            raise RuntimeError(f"Restored database failed verification: {post_verify.get('error')}. Rolled back.")

        self._audit.log_event(
            action="BACKUP_RESTORED",
            entity_type="DATABASE",
            entity_id=target.name,
            actor_name="Administrator",
            details=f"Restored database and assets from {target.name}",
        )

        return {
            "success": True,
            "restored_from": str(target),
            "safety_snapshot": str(safety_db_path),
            "record_counts": {
                "patients": post_verify.get("patients_count", 0),
                "cases": post_verify.get("cases_count", 0),
                "sessions": post_verify.get("sessions_count", 0),
                "payments": post_verify.get("payments_count", 0),
            },
        }

    def _rollback(self, safety_db_path: Path, safety_photos_path: Path) -> None:
        """Rolls back the active database and photos from safety snapshots."""
        if safety_db_path.exists():
            s_conn = sqlite3.connect(str(safety_db_path))
            r_conn = sqlite3.connect(str(self.db_path))
            try:
                s_conn.backup(r_conn)
            finally:
                r_conn.close()
                s_conn.close()

        if safety_photos_path.exists():
            with zipfile.ZipFile(str(safety_photos_path), "r") as zf:
                zf.extractall(str(self.photos_dir))
