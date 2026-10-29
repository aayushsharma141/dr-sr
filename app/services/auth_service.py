"""
Authentication Service - Role-Based PBKDF2-HMAC-SHA256 Password Security.
Kalyan Hospital Management System.
"""

import hashlib
import hmac
import secrets
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from app.db.connection import get_db_connection
from app.services.audit_service import AuditService


class AuthService:
    """Manages password hashing, credential verification, and administrative authorization."""

    ITERATIONS = 100000

    def __init__(self, db_path: Optional[str | Path] = None, auto_seed_demo: bool = True):
        self.db_path = str(db_path) if db_path else None
        self._audit = AuditService(self.db_path)
        if auto_seed_demo:
            # Seed demo admin if no admin exists (for development & existing automated test harnesses)
            self.ensure_default_admin()

    def _get_connection(self):
        return get_db_connection(self.db_path)

    @classmethod
    def hash_password(cls, password: str, salt: Optional[str] = None) -> Tuple[str, str]:
        """
        Hashes a plaintext password using PBKDF2-HMAC-SHA256 with 100,000 iterations
        and a cryptographic 16-byte random salt.
        
        Returns:
            Tuple of (password_hash_hex, salt_hex)
        """
        if not salt:
            salt = secrets.token_hex(16)

        key = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            cls.ITERATIONS,
        )
        return key.hex(), salt

    @classmethod
    def verify_password(cls, password: str, stored_hash: str, salt: str) -> bool:
        """
        Verifies plaintext password against stored hash using constant-time comparison
        to mitigate timing attacks.
        """
        calculated_hash, _ = cls.hash_password(password, salt=salt)
        return hmac.compare_digest(calculated_hash, stored_hash)

    def has_admin_user(self) -> bool:
        """Checks if at least one active administrator account exists in the database."""
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT id FROM users WHERE role = 'ADMIN' AND is_active = 1 LIMIT 1")
            return cursor.fetchone() is not None

    def setup_initial_admin(
        self,
        username: str,
        password: str,
    ) -> Dict[str, Any]:
        """
        Initializes the first administrator account during clinic onboarding.
        Enforces a minimum password length of 8 characters.
        """
        if self.has_admin_user():
            raise ValueError("An active administrator already exists in the system.")

        username_clean = username.strip()
        if not username_clean:
            raise ValueError("Administrator username cannot be blank.")
        if len(password) < 8:
            raise ValueError("Administrator password must be at least 8 characters long.")

        pwd_hash, salt = self.hash_password(password)
        with self._get_connection() as conn:
            ins_cursor = conn.execute(
                """
                INSERT INTO users (username, password_hash, salt, role, is_active)
                VALUES (?, ?, ?, 'ADMIN', 1)
                """,
                (username_clean, pwd_hash, salt),
            )
            user_id = int(ins_cursor.lastrowid or 0)
            conn.commit()

        self._audit.log_event(
            action="ADMIN_INITIALIZED",
            entity_type="USER",
            entity_id=user_id,
            actor_name=username_clean,
            details=f"First-run administrator '{username_clean}' configured.",
            user_id=user_id,
        )

        return {
            "id": user_id,
            "username": username_clean,
            "role": "ADMIN",
        }

    def ensure_default_admin(
        self,
        default_username: str = "admin",
        default_password: str = "kalyan@admin",
    ) -> Optional[Dict[str, Any]]:
        """
        Seeds a default administrator account if the users table has no admin user.
        Maintained for local test suites and offline demo execution.
        """
        if self.has_admin_user():
            return None

        pwd_hash, salt = self.hash_password(default_password)
        with self._get_connection() as conn:
            ins_cursor = conn.execute(
                """
                INSERT INTO users (username, password_hash, salt, role, is_active)
                VALUES (?, ?, ?, 'ADMIN', 1)
                """,
                (default_username, pwd_hash, salt),
            )
            user_id = int(ins_cursor.lastrowid or 0)
            conn.commit()

        self._audit.log_event(
            action="ADMIN_SEEDED",
            entity_type="USER",
            entity_id=user_id,
            actor_name="System",
            details="Default demo admin seeded.",
            user_id=user_id,
        )

        return {
            "id": user_id,
            "username": default_username,
            "role": "ADMIN",
        }

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """
        Authenticates a user by username and password. Returns user dict on success, None on failure.
        """
        username_clean = username.strip()
        sql = "SELECT * FROM users WHERE username = ? AND is_active = 1"
        with self._get_connection() as conn:
            cursor = conn.execute(sql, (username_clean,))
            user = cursor.fetchone()
            if not user:
                self._audit.log_event(
                    action="AUTH_FAILED",
                    entity_type="USER",
                    actor_name=username_clean,
                    details=f"Authentication attempt failed: user '{username_clean}' not found.",
                )
                return None

            user_dict = dict(user)
            if self.verify_password(password, user_dict["password_hash"], user_dict["salt"]):
                self._audit.log_event(
                    action="AUTH_SUCCESS",
                    entity_type="USER",
                    entity_id=user_dict["id"],
                    actor_name=username_clean,
                    details=f"User '{username_clean}' logged in successfully.",
                    user_id=user_dict["id"],
                )
                return {
                    "id": user_dict["id"],
                    "username": user_dict["username"],
                    "role": user_dict["role"],
                    "created_at": user_dict["created_at"],
                }

            self._audit.log_event(
                action="AUTH_FAILED",
                entity_type="USER",
                entity_id=user_dict["id"],
                actor_name=username_clean,
                details=f"Authentication attempt failed: incorrect password for '{username_clean}'.",
                user_id=user_dict["id"],
            )
            return None

    def verify_admin_credentials(self, password: str) -> bool:
        """
        Checks if the provided password matches any active user with 'ADMIN' role.
        Used for guarded administrative operations (e.g. database restore).
        """
        sql = "SELECT password_hash, salt FROM users WHERE role = 'ADMIN' AND is_active = 1"
        with self._get_connection() as conn:
            cursor = conn.execute(sql)
            admins = cursor.fetchall()
            for admin in admins:
                if self.verify_password(password, admin["password_hash"], admin["salt"]):
                    return True
        return False

    VALID_ROLES = ("ADMIN", "RECEPTIONIST", "DOCTOR")

    def create_user(
        self,
        username: str,
        password: str,
        role: str = "RECEPTIONIST",
        actor_name: str = "Admin",
    ) -> Dict[str, Any]:
        """
        Creates a new user account with a specified role ('ADMIN', 'RECEPTIONIST', 'DOCTOR').
        """
        username_clean = username.strip()
        role_clean = role.strip().upper()

        if not username_clean:
            raise ValueError("Username cannot be blank.")
        if role_clean not in self.VALID_ROLES:
            raise ValueError(f"Invalid role '{role}'. Must be one of {self.VALID_ROLES}.")
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters long.")

        with self._get_connection() as conn:
            # Check for existing username
            cursor = conn.execute("SELECT id FROM users WHERE username = ?", (username_clean,))
            if cursor.fetchone():
                raise ValueError(f"User '{username_clean}' already exists.")

            pwd_hash, salt = self.hash_password(password)
            ins_cursor = conn.execute(
                """
                INSERT INTO users (username, password_hash, salt, role, is_active)
                VALUES (?, ?, ?, ?, 1)
                """,
                (username_clean, pwd_hash, salt, role_clean),
            )
            user_id = int(ins_cursor.lastrowid or 0)
            conn.commit()

        self._audit.log_event(
            action="USER_CREATED",
            entity_type="USER",
            entity_id=user_id,
            actor_name=actor_name,
            details=f"Created user '{username_clean}' with role '{role_clean}'.",
            user_id=user_id,
        )

        return {
            "id": user_id,
            "username": username_clean,
            "role": role_clean,
        }

    @staticmethod
    def can_manage_backups(role: str) -> bool:
        """Only ADMIN can execute backup and restore operations."""
        return role.upper() == "ADMIN"

    @staticmethod
    def can_manage_users(role: str) -> bool:
        """Only ADMIN can create or modify user accounts."""
        return role.upper() == "ADMIN"

    @staticmethod
    def can_record_clinical_sessions(role: str) -> bool:
        """Doctors and Admins can log clinical physiotherapy treatment notes."""
        return role.upper() in ("DOCTOR", "ADMIN")

    @staticmethod
    def can_register_patients(role: str) -> bool:
        """Receptionists, Doctors, and Admins can register new patients."""
        return role.upper() in ("RECEPTIONIST", "DOCTOR", "ADMIN")

    def change_password(self, user_id: int, old_password: str, new_password: str) -> bool:
        """
        Updates a user's password after verifying the existing password.
        """
        if len(new_password.strip()) < 6:
            raise ValueError("New password must be at least 6 characters long.")

        with self._get_connection() as conn:
            cursor = conn.execute("SELECT id, username, password_hash, salt FROM users WHERE id = ?", (user_id,))
            user = cursor.fetchone()
            if not user:
                return False

            if not self.verify_password(old_password, user["password_hash"], user["salt"]):
                raise ValueError("Current password is incorrect.")

            new_hash, new_salt = self.hash_password(new_password)
            conn.execute(
                "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
                (new_hash, new_salt, user_id),
            )
            conn.commit()

        self._audit.log_event(
            action="PASSWORD_CHANGED",
            entity_type="USER",
            entity_id=user_id,
            actor_name=user["username"],
            details=f"Password updated for user '{user['username']}'.",
            user_id=user_id,
        )
        return True
