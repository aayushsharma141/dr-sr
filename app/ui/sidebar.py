"""
Sidebar navigation for the Kalyan Hospital desktop application.
Trust-led branding, clear text navigation, and explicit offline status.
"""
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QButtonGroup, QFrame, QLabel, QPushButton, QVBoxLayout, QWidget

from app.config import APP_VERSION, HOSPITAL_DEPT, HOSPITAL_NAME, HOSPITAL_NAME_HINDI, TRUST_NAME


ASSET_DIR = Path(__file__).resolve().parents[1] / "assets"


class SidebarWidget(QWidget):
    """Fixed-width branded navigation and offline status."""

    page_changed = Signal(int)

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.setObjectName("SidebarWidget")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setFixedWidth(240)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 14)
        layout.setSpacing(3)

        header_container = QWidget(self)
        header_container.setStyleSheet("background: transparent;")
        header_layout = QVBoxLayout(header_container)
        header_layout.setContentsMargins(18, 20, 18, 18)
        header_layout.setSpacing(5)

        # Use the actual supplied hospital mark rather than a decorative icon.
        logo = QLabel()
        logo.setObjectName("SidebarHospitalLogo")
        logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo.setFixedSize(94, 94)
        logo_path = ASSET_DIR / "kalyan_hospital_logo.png"
        if not logo_path.exists():
            logo_path = ASSET_DIR / "kalyan_hospital_logo.jpg"
        logo_pixmap = QPixmap(str(logo_path))
        if not logo_pixmap.isNull():
            scaled = logo_pixmap.scaled(
                logo.size() * logo.devicePixelRatio(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            scaled.setDevicePixelRatio(logo.devicePixelRatio())
            logo.setPixmap(scaled)
            logo.setStyleSheet("background: transparent;")
        else:
            logo.setText("KH")
            logo.setStyleSheet(
                "background:#FFFFFF;color:#155B43;border-radius:12px;"
                "font-size:21px;font-weight:800;"
            )
        header_layout.addWidget(logo, alignment=Qt.AlignmentFlag.AlignHCenter)

        eyebrow = QLabel("SRI VASHISHTHA KALYAN TRUST")
        eyebrow.setAlignment(Qt.AlignmentFlag.AlignCenter)
        eyebrow.setStyleSheet("color:#D9C27A;font-size:8px;font-weight:800;letter-spacing:.7px;")
        header_layout.addWidget(eyebrow)

        title_hindi = QLabel(HOSPITAL_NAME_HINDI)
        title_hindi.setObjectName("SidebarTitle")
        title_hindi.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title_hindi.setWordWrap(True)
        header_layout.addWidget(title_hindi)

        title_en = QLabel(HOSPITAL_NAME)
        title_en.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title_en.setStyleSheet("color:#FFFFFF;font-size:14px;font-weight:800;")
        header_layout.addWidget(title_en)

        dept_badge = QLabel(HOSPITAL_DEPT)
        dept_badge.setObjectName("SidebarSubtitle")
        dept_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        dept_badge.setWordWrap(True)
        header_layout.addWidget(dept_badge)

        trust_label = QLabel(TRUST_NAME)
        trust_label.setObjectName("SidebarTrust")
        trust_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        trust_label.setWordWrap(True)
        header_layout.addWidget(trust_label)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet("background-color:rgba(255,255,255,0.16);max-height:1px;margin-top:9px;")
        header_layout.addWidget(sep)
        layout.addWidget(header_container)

        self.button_group = QButtonGroup(self)
        self.button_group.setExclusive(True)
        nav_items = [
            (0, "Dashboard"),
            (1, "Patient Registry"),
            (2, "Treatment Sessions"),
            (3, "Billing & Payments"),
            (4, "Backup & Safety"),
        ]
        self.nav_buttons: list[QPushButton] = []
        for index, label in nav_items:
            btn = QPushButton(label)
            btn.setObjectName("NavButton")
            btn.setCheckable(True)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setMinimumHeight(42)
            self.button_group.addButton(btn, index)
            layout.addWidget(btn)
            self.nav_buttons.append(btn)

        self.button_group.idClicked.connect(self._on_button_clicked)
        if self.nav_buttons:
            self.nav_buttons[0].setChecked(True)

        layout.addStretch(1)

        footer = QWidget(self)
        footer.setStyleSheet("background:transparent;")
        footer_layout = QVBoxLayout(footer)
        footer_layout.setContentsMargins(16, 12, 16, 0)
        footer_layout.setSpacing(6)

        status = QLabel("●  OFFLINE MODE · LOCAL PC")
        status.setStyleSheet(
            "color:#A7F3D0;font-size:9px;font-weight:800;"
            "border:1px solid rgba(167,243,208,0.25);border-radius:5px;padding:7px;"
        )
        footer_layout.addWidget(status)

        footer_trust = QLabel("Physiotherapy Management")
        footer_trust.setStyleSheet("color:#CBD5E1;font-size:10px;")
        footer_layout.addWidget(footer_trust)

        shortcut_hint = QLabel("QUICK SEARCH  ·  CTRL+K")
        shortcut_hint.setStyleSheet("color:#D9C27A;font-size:9px;font-weight:800;letter-spacing:.4px;")
        footer_layout.addWidget(shortcut_hint)

        version = QLabel(f"Version {APP_VERSION}")
        version.setObjectName("SidebarVersion")
        footer_layout.addWidget(version)
        layout.addWidget(footer)

    def _on_button_clicked(self, page_id: int):
        self.page_changed.emit(page_id)

    def set_active_page(self, index: int):
        """Select a navigation item and emit its page identifier."""
        btn = self.button_group.button(index)
        if btn:
            btn.setChecked(True)
            self.page_changed.emit(index)
