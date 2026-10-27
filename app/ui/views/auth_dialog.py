"""
Admin Auth Dialog - Modal Security Guard for Critical Administrative Operations.
Kalyan Hospital Management System.
"""

from typing import Optional
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QMessageBox
)
from app.services.auth_service import AuthService
from app.ui.styles import (
    COLOR_PRIMARY, COLOR_PRIMARY_HOVER, COLOR_CARD_BG,
    COLOR_TEXT_PRIMARY, COLOR_TEXT_MUTED, COLOR_BORDER, COLOR_BG, COLOR_DANGER
)


class AdminAuthDialog(QDialog):
    """
    Password prompt modal that verifies administrator credentials
    before permitting sensitive clinic operations (restore, wipe, etc.).
    """

    def __init__(self, auth_service: AuthService, reason: str = "This administrative action", parent=None):
        super().__init__(parent)
        self.auth_service = auth_service
        self.authorized = False

        self.setWindowTitle("Administrator Authorization Required")
        self.setFixedWidth(420)
        self.setStyleSheet(f"""
            QDialog {{ background-color: {COLOR_CARD_BG}; }}
            QLabel {{ color: {COLOR_TEXT_PRIMARY}; font-size: 13px; }}
            QLineEdit {{
                background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 10px;
                font-size: 14px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(16)

        header_lbl = QLabel("🔒 Administrator Password Required")
        header_lbl.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {COLOR_PRIMARY};")
        layout.addWidget(header_lbl)

        desc_lbl = QLabel(
            f"{reason} requires administrator privileges to prevent accidental data loss. "
            "Please enter your administrator password to proceed."
        )
        desc_lbl.setWordWrap(True)
        desc_lbl.setStyleSheet(f"color: {COLOR_TEXT_MUTED}; font-size: 12px; line-height: 1.4;")
        layout.addWidget(desc_lbl)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Enter Admin Password (default: kalyan@admin)")
        self.password_input.returnPressed.connect(self._on_authorize)
        layout.addWidget(self.password_input)

        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                color: {COLOR_TEXT_MUTED};
                border: 1px solid {COLOR_BORDER};
                border-radius: 6px;
                padding: 8px 16px;
                font-weight: 600;
            }}
            QPushButton:hover {{ background-color: {COLOR_BORDER}; }}
        """)
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        auth_btn = QPushButton("Authorize Action")
        auth_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {COLOR_PRIMARY};
                color: white;
                border: none;
                border-radius: 6px;
                padding: 8px 20px;
                font-weight: 700;
            }}
            QPushButton:hover {{ background-color: {COLOR_PRIMARY_HOVER}; }}
        """)
        auth_btn.clicked.connect(self._on_authorize)
        btn_layout.addWidget(auth_btn)

        layout.addLayout(btn_layout)

    def _on_authorize(self):
        password = self.password_input.text()
        if not password:
            QMessageBox.warning(self, "Password Required", "Please enter the administrator password.")
            return

        if self.auth_service.verify_admin_credentials(password):
            self.authorized = True
            self.accept()
        else:
            QMessageBox.critical(self, "Authorization Failed", "Incorrect administrator password.")
            self.password_input.clear()
            self.password_input.setFocus()

    @classmethod
    def verify_admin(cls, auth_service: AuthService, parent=None, reason: str = "This administrative action") -> bool:
        """Convenience method to show dialog and return authorization status."""
        dlg = cls(auth_service=auth_service, reason=reason, parent=parent)
        result = dlg.exec()
        return (result == QDialog.DialogCode.Accepted) and dlg.authorized
