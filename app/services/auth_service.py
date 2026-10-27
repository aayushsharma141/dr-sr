"""
Authentication Service - Role-Based PBKDF2-HMAC-SHA256 Password Security.
Kalyan Hospital Management System.
"""

import hashlib
import hmac
import secrets
from typing import Any, Dict, Optional, Tuple
from app.db.connection import get_db_connection


class AuthService:
    """Manages password hashing, credential verification, and administrative authorization."""

    ITERATIONS = 100000

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path
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

    def ensure_default_admin(
        self,
        default_username: str = "admin",
        default_password: str = "kalyan@admin",
    ) -> Optional[Dict[str, Any]]:
        """
        Seeds a default administrator account if the users table has no admin user.
        """
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT id FROM users WHERE role = 'ADMIN' AND is_active = 1 LIMIT 1")
            row = cursor.fetchone()
            if row:
                return None  # Admin already exists

            # Create default admin
            pwd_hash, salt = self.hash_password(default_password)
            ins_cursor = conn.execute(
                """
                INSERT INTO users (username, password_hash, salt, role, is_active)
                VALUES (?, ?, ?, 'ADMIN', 1)
                """,
                (default_username, pwd_hash, salt),
            )
            user_id = ins_cursor.lastrowid
            conn.commit()

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
                return None

            user_dict = dict(user)
            if self.verify_password(password, user_dict["password_hash"], user_dict["salt"]):
                return {
                    "id": user_dict["id"],
                    "username": user_dict["username"],
                    "role": user_dict["role"],
                    "created_at": user_dict["created_at"],
                }
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

    def change_password(self, user_id: int, old_password: str, new_password: str) -> bool:
        """
        Updates a user's password after verifying the existing password.
        """
        if len(new_password.strip()) < 6:
            raise ValueError("New password must be at least 6 characters long.")

        with self._get_connection() as conn:
            cursor = conn.execute("SELECT password_hash, salt FROM users WHERE id = ?", (user_id,))
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
            return True
