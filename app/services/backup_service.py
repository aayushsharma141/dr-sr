"""
Backup Service - Hot SQLite Online Backups and Verified Restore Pipeline.
Kalyan Hospital Management System.
"""

import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from app.config import BACKUP_DIR, DB_PATH
from app.db.connection import get_db_connection


class BackupService:
    """Manages hot SQLite database backups and verified restore operations."""

    def __init__(self, db_path: Optional[str] = None, backup_dir: Optional[str] = None):
        self.db_path = Path(db_path) if db_path else Path(DB_PATH)
        self.backup_dir = Path(backup_dir) if backup_dir else Path(BACKUP_DIR)
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    def create_backup(self, target_dir: Optional[str] = None) -> Path:
        """
        Creates an atomic, non-blocking hot backup snapshot of the active database
        using SQLite's native Online Backup API (Connection.backup()).
        
        Filename format: kalyan_backup_YYYYMMDD_HHMMSS.db
        
        Returns:
            Absolute Path of the created backup file.
        """
        dest_dir = Path(target_dir) if target_dir else self.backup_dir
        dest_dir.mkdir(parents=True, exist_ok=True)

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"kalyan_backup_{timestamp_str}.db"
        dest_path = dest_dir / backup_filename

        # Execute atomic SQLite hot backup
        with get_db_connection(str(self.db_path)) as src_conn:
            dest_conn = sqlite3.connect(str(dest_path))
            try:
                src_conn.backup(dest_conn)
            finally:
                dest_conn.close()

        return dest_path.resolve()

    def verify_backup_integrity(self, backup_path: str) -> Dict[str, Any]:
        """
        Validates the integrity and structural health of a backup database file
        without altering or locking live clinic data.
        
        Returns:
            Dict containing validation boolean, file size, table row counts,
            and any error descriptions.
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

        # Connect to target database file in read-only mode
        uri = f"file:{path.as_posix()}?mode=ro"
        try:
            conn = sqlite3.connect(uri, uri=True, timeout=5.0)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # 1. Run PRAGMA integrity_check
            cursor.execute("PRAGMA integrity_check;")
            integrity_result = cursor.fetchall()
            is_healthy = any(row[0] == "ok" for row in integrity_result)
            if not is_healthy:
                conn.close()
                return {
                    "valid": False,
                    "error": f"SQLite PRAGMA integrity check failed: {integrity_result}",
                    "file_size_bytes": file_size,
                }

            # 2. Inspect table row counts
            def _get_count(table_name: str) -> int:
                try:
                    cursor.execute(f"SELECT COUNT(*) AS c FROM {table_name}")
                    r = cursor.fetchone()
                    return r["c"] if r else 0
                except sqlite3.OperationalError:
                    return 0

            patients_cnt = _get_count("patients")
            cases_cnt = _get_count("treatment_cases")
            sessions_cnt = _get_count("treatment_sessions")
            payments_cnt = _get_count("payments")

            conn.close()

            mtime = datetime.fromtimestamp(path.stat().st_mtime)

            return {
                "valid": True,
                "filename": path.name,
                "file_size_bytes": file_size,
                "file_size_kb": round(file_size / 1024.0, 1),
                "created_at": mtime.strftime("%Y-%m-%d %H:%M:%S"),
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

    def list_backups(self) -> List[Dict[str, Any]]:
        """
        Scans the backup directory for *.db files and returns summary metrics
        ordered by modification time descending (newest first).
        """
        if not self.backup_dir.exists():
            return []

        backups = []
        for file in self.backup_dir.glob("*.db"):
            info = self.verify_backup_integrity(str(file))
            backups.append({
                "path": str(file.resolve()),
                "filename": file.name,
                "mtime": file.stat().st_mtime,
                **info,
            })

        # Sort newest first
        backups.sort(key=lambda x: x["mtime"], reverse=True)
        return backups

    def restore_from_backup(self, backup_path: str) -> Dict[str, Any]:
        """
        Restores the active clinic database from a backup snapshot following
        a verified, fail-safe 4-step pipeline:
        
        Step 1: Pre-restore verification in an isolated connection.
        Step 2: Create a safety rollback snapshot of current live database.
        Step 3: Copy backup into active database path using SQLite backup API.
        Step 4: Verify restored database health; if unhealthy, automatically rollback.
        
        Returns:
            Dict containing success status and restored record counts.
        """
        # Step 1: Pre-restore verification
        verification = self.verify_backup_integrity(backup_path)
        if not verification.get("valid"):
            raise ValueError(f"Cannot restore from corrupt backup: {verification.get('error')}")

        # Step 2: Create safety snapshot of live database
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        safety_snapshot_path = self.backup_dir / f"safety_pre_restore_{timestamp_str}.bak"
        if self.db_path.exists():
            try:
                shutil.copy2(str(self.db_path), str(safety_snapshot_path))
            except Exception as e:
                raise RuntimeError(f"Failed to create pre-restore safety snapshot: {str(e)}")

        # Step 3: Copy backup to active database
        backup_src = sqlite3.connect(backup_path)
        active_dest = sqlite3.connect(str(self.db_path))
        try:
            backup_src.backup(active_dest)
        except Exception as e:
            # Rollback if copy failed
            active_dest.close()
            backup_src.close()
            if safety_snapshot_path.exists():
                shutil.copy2(str(safety_snapshot_path), str(self.db_path))
            raise RuntimeError(f"Database restoration failed during stream copy: {str(e)}")
        finally:
            active_dest.close()
            backup_src.close()

        # Step 4: Verify restored active database health
        post_verify = self.verify_backup_integrity(str(self.db_path))
        if not post_verify.get("valid"):
            # Automatic rollback
            if safety_snapshot_path.exists():
                shutil.copy2(str(safety_snapshot_path), str(self.db_path))
            raise RuntimeError(f"Restored database failed post-restore verification: {post_verify.get('error')}. Rolled back.")

        return {
            "success": True,
            "restored_from": backup_path,
            "safety_snapshot": str(safety_snapshot_path),
            "record_counts": {
                "patients": post_verify.get("patients_count", 0),
                "cases": post_verify.get("cases_count", 0),
                "sessions": post_verify.get("sessions_count", 0),
                "payments": post_verify.get("payments_count", 0),
            },
        }
