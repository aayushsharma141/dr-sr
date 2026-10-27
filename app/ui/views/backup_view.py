"""
Backup View - Local Database Snapshots, Integrity Auditing & Verified Restore UI.
Kalyan Hospital Management System.
"""

from pathlib import Path
from typing import Optional
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTableWidget, QTableWidgetItem, QHeaderView, QMessageBox,
    QFrame
)
from app.services.backup_service import BackupService
from app.services.auth_service import AuthService
from app.services.demo_seeder import DemoSeeder
from app.ui.views.auth_dialog import AdminAuthDialog
from app.config import DB_PATH
from app.ui.styles import (
    COLOR_PRIMARY, COLOR_PRIMARY_HOVER, COLOR_SECONDARY,
    COLOR_TEXT_PRIMARY, COLOR_TEXT_MUTED, COLOR_CARD_BG,
    COLOR_BORDER, COLOR_BG, COLOR_SUCCESS, COLOR_WARNING, COLOR_DANGER
)


class BackupView(QWidget):
    """Interactive management dashboard for hot SQLite snapshots and verified restoration."""

    database_restored = Signal()  # Emitted when a restore completes successfully

    def __init__(self, db_path: Optional[str] = None, backup_dir: Optional[str] = None, parent=None):
        super().__init__(parent)
        self.db_path = db_path or DB_PATH
        self.backup_service = BackupService(db_path=self.db_path, backup_dir=backup_dir)
        self.auth_service = AuthService(db_path=self.db_path)

        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 28)
        layout.setSpacing(20)

        # 1. Header Bar
        header_layout = QHBoxLayout()
        title_box = QVBoxLayout()
        title_lbl = QLabel("Local Backup & Data Safety")
        title_lbl.setStyleSheet(f"font-size: 24px; font-weight: 700; color: {COLOR_PRIMARY};")
        title_box.addWidget(title_lbl)

        subtitle_lbl = QLabel("Hot SQLite Snapshots • Integrity Auditing • Verified Offline Restore")
        subtitle_lbl.setStyleSheet(f"font-size: 13px; color: {COLOR_TEXT_MUTED};")
        title_box.addWidget(subtitle_lbl)
        header_layout.addLayout(title_box)

        header_layout.addStretch()

        self.reset_demo_btn = QPushButton("Reset Demo Data")
        self.reset_demo_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                color: {COLOR_PRIMARY};
                border: 2px solid {COLOR_PRIMARY};
                border-radius: 8px;
                padding: 10px 18px;
                font-weight: 700;
                font-size: 13px;
            }}
            QPushButton:hover {{ background-color: {COLOR_PRIMARY}; color: white; }}
        """)
        self.reset_demo_btn.clicked.connect(self._on_reset_demo_clicked)
        header_layout.addWidget(self.reset_demo_btn)

        self.create_backup_btn = QPushButton("Create Backup Now")
        self.create_backup_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {COLOR_PRIMARY};
                color: white;
                border: none;
                border-radius: 8px;
                padding: 10px 20px;
                font-weight: 700;
                font-size: 13px;
            }}
            QPushButton:hover {{ background-color: {COLOR_PRIMARY_HOVER}; }}
        """)
        self.create_backup_btn.clicked.connect(self._on_create_backup)
        header_layout.addWidget(self.create_backup_btn)

        layout.addLayout(header_layout)

        # 2. Metric Stat Cards
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(16)

        self.db_size_card = self._create_metric_card("Active Database Size", "0.0 KB", COLOR_SECONDARY)
        cards_layout.addWidget(self.db_size_card)

        self.total_backups_card = self._create_metric_card("Total Backups Stored", "0 Snapshots", COLOR_PRIMARY)
        cards_layout.addWidget(self.total_backups_card)

        self.last_backup_card = self._create_metric_card("Last Backup Created", "Never", COLOR_SUCCESS)
        cards_layout.addWidget(self.last_backup_card)

        layout.addLayout(cards_layout)

        # 3. Table Title
        table_title = QLabel("Available Local Snapshots (data/backups/)")
        table_title.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {COLOR_PRIMARY}; margin-top: 8px;")
        layout.addWidget(table_title)

        # 4. Backup History Table
        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Backup Filename", "Created Date & Time", "File Size",
            "Patients", "Cases", "Payments", "Actions"
        ])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(6, QHeaderView.ResizeToContents)
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setStyleSheet(f"""
            QTableWidget {{
                background-color: {COLOR_CARD_BG};
                alternate-background-color: {COLOR_BG};
                color: {COLOR_TEXT_PRIMARY};
                gridline-color: {COLOR_BORDER};
                border: 1px solid {COLOR_BORDER};
                border-radius: 8px;
                font-size: 13px;
            }}
            QHeaderView::section {{
                background-color: {COLOR_PRIMARY};
                color: white;
                font-weight: 600;
                padding: 8px;
                border: none;
            }}
        """)
        layout.addWidget(self.table)

        self.refresh_backups()

    def _create_metric_card(self, title: str, initial_value: str, accent_color: str) -> QFrame:
        card = QFrame()
        card.setStyleSheet(f"""
            QFrame {{
                background-color: {COLOR_CARD_BG};
                border: 1px solid {COLOR_BORDER};
                border-left: 5px solid {accent_color};
                border-radius: 10px;
                padding: 16px;
            }}
        """)
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(4)

        title_lbl = QLabel(title)
        title_lbl.setStyleSheet(f"font-size: 12px; font-weight: 600; color: {COLOR_TEXT_MUTED}; text-transform: uppercase;")
        card_layout.addWidget(title_lbl)

        val_lbl = QLabel(initial_value)
        val_lbl.setObjectName("val_label")
        val_lbl.setStyleSheet(f"font-size: 20px; font-weight: 700; color: {COLOR_TEXT_PRIMARY};")
        card_layout.addWidget(val_lbl)

        return card

    def _update_card_value(self, card: QFrame, value_text: str):
        val_lbl = card.findChild(QLabel, "val_label")
        if val_lbl:
            val_lbl.setText(value_text)

    def refresh_backups(self):
        """Scans backups and updates metric cards and table rows."""
        # Active DB file size
        p = Path(self.db_path)
        if p.exists():
            kb = round(p.stat().st_size / 1024.0, 1)
            self._update_card_value(self.db_size_card, f"{kb} KB")
        else:
            self._update_card_value(self.db_size_card, "0.0 KB")

        backups = self.backup_service.list_backups()
        self._update_card_value(self.total_backups_card, f"{len(backups)} Snapshots")

        if backups:
            self._update_card_value(self.last_backup_card, backups[0].get("created_at", "Unknown"))
        else:
            self._update_card_value(self.last_backup_card, "Never")

        self.table.setRowCount(len(backups))
        for row, b in enumerate(backups):
            # 0. Filename
            self.table.setItem(row, 0, QTableWidgetItem(b.get("filename", "")))

            # 1. Date
            self.table.setItem(row, 1, QTableWidgetItem(b.get("created_at", "")))

            # 2. File size
            size_kb = b.get("file_size_kb", 0.0)
            self.table.setItem(row, 2, QTableWidgetItem(f"{size_kb} KB"))

            # 3. Patients
            p_item = QTableWidgetItem(str(b.get("patients_count", 0)))
            p_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row, 3, p_item)

            # 4. Cases
            c_item = QTableWidgetItem(str(b.get("cases_count", 0)))
            c_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row, 4, c_item)

            # 5. Payments
            pay_item = QTableWidgetItem(str(b.get("payments_count", 0)))
            pay_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row, 5, pay_item)

            # 6. Action buttons
            actions_widget = QWidget()
            actions_layout = QHBoxLayout(actions_widget)
            actions_layout.setContentsMargins(4, 2, 4, 2)
            actions_layout.setSpacing(6)

            verify_btn = QPushButton("Verify")
            verify_btn.setStyleSheet("padding: 4px 8px; font-size: 11px;")
            b_path = b["path"]
            verify_btn.clicked.connect(lambda _, path=b_path: self._on_verify_backup(path))
            actions_layout.addWidget(verify_btn)

            restore_btn = QPushButton("Restore")
            restore_btn.setStyleSheet(f"""
                QPushButton {{
                    background-color: {COLOR_DANGER};
                    color: white;
                    border: none;
                    border-radius: 4px;
                    padding: 4px 10px;
                    font-size: 11px;
                    font-weight: 600;
                }}
                QPushButton:hover {{ background-color: #B91C1C; }}
            """)
            restore_btn.clicked.connect(lambda _, path=b_path, name=b["filename"]: self._on_restore_backup(path, name))
            actions_layout.addWidget(restore_btn)

            self.table.setCellWidget(row, 6, actions_widget)

    def _on_create_backup(self):
        try:
            backup_path = self.backup_service.create_backup()
            info = self.backup_service.verify_backup_integrity(str(backup_path))
            self.refresh_backups()
            QMessageBox.information(
                self,
                "Backup Created",
                f"Hot backup snapshot created successfully:\n\n"
                f"File: {backup_path.name}\n"
                f"Patients: {info.get('patients_count', 0)}\n"
                f"Cases: {info.get('cases_count', 0)}\n"
                f"Payments: {info.get('payments_count', 0)}\n\n"
                f"Location: {backup_path}"
            )
        except Exception as e:
            QMessageBox.critical(self, "Backup Error", f"Failed to create backup: {str(e)}")

    def _on_verify_backup(self, backup_path: str):
        info = self.backup_service.verify_backup_integrity(backup_path)
        if info.get("valid"):
            QMessageBox.information(
                self,
                "Integrity Check: PASSED ✓",
                f"Backup file is healthy and uncorrupted:\n\n"
                f"File: {info.get('filename')}\n"
                f"Size: {info.get('file_size_kb')} KB\n"
                f"PRAGMA integrity_check: ok\n"
                f"Patients: {info.get('patients_count')}\n"
                f"Cases: {info.get('cases_count')}\n"
                f"Payments: {info.get('payments_count')}"
            )
        else:
            QMessageBox.warning(
                self,
                "Integrity Check: FAILED",
                f"Backup file integrity validation failed:\n\n{info.get('error')}"
            )

    def _on_restore_backup(self, backup_path: str, filename: str):
        # 1. Admin Password Guard
        if not AdminAuthDialog.verify_admin(self.auth_service, self, reason="Restoring the database"):
            return

        # 2. Confirmation guard
        reply = QMessageBox.question(
            self,
            "Confirm Database Restoration",
            f"Are you sure you want to restore database from:\n\n'{filename}'?\n\n"
            f"WARNING: This will replace the active database with the data in this snapshot.\n"
            f"A safety rollback snapshot of the current state will be created automatically.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )

        if reply != QMessageBox.StandardButton.Yes:
            return

        try:
            result = self.backup_service.restore_from_backup(backup_path)
            counts = result.get("record_counts", {})
            self.refresh_backups()
            self.database_restored.emit()
            QMessageBox.information(
                self,
                "Restore Complete ✓",
                f"Database successfully restored from:\n{filename}\n\n"
                f"Restored Data Summary:\n"
                f"• Patients: {counts.get('patients', 0)}\n"
                f"• Treatment Cases: {counts.get('cases', 0)}\n"
                f"• Clinical Sessions: {counts.get('sessions', 0)}\n"
                f"• Payments: {counts.get('payments', 0)}\n\n"
                f"Safety snapshot saved at: {result.get('safety_snapshot')}"
            )
        except Exception as e:
            QMessageBox.critical(self, "Restore Error", f"Restoration failed: {str(e)}")

    def _on_reset_demo_clicked(self):
        # 1. Admin Password Guard
        if not AdminAuthDialog.verify_admin(self.auth_service, self, reason="Resetting to synthetic demo data"):
            return

        # 2. Confirmation guard
        reply = QMessageBox.question(
            self,
            "Confirm Demo Reset",
            "Are you sure you want to reset the database to clean demo data?\n\n"
            "This will clear current transactional records and re-seed the 5 realistic "
            "fictional demo patients with treatment cases and payment histories.\n\n"
            "This action executes in < 1 second.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )

        if reply != QMessageBox.StandardButton.Yes:
            return

        try:
            result = DemoSeeder.reset_to_demo_dataset(self.db_path)
            self.refresh_backups()
            self.database_restored.emit()
            QMessageBox.information(
                self,
                "Demo Reset Complete ✓",
                f"Synthetic demo dataset initialized successfully in {result['elapsed_seconds']}s.\n\n"
                f"Populated 5 realistic fictional patient records with active physiotherapy "
                f"cases, chronological sessions, and installment ledgers."
            )
        except Exception as e:
            QMessageBox.critical(self, "Reset Error", f"Failed to reset demo dataset: {str(e)}")
