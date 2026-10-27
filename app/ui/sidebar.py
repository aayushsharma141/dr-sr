"""
Sidebar navigation for the Kalyan Hospital desktop application.
Uses text labels and standard Qt styling; no emoji-dependent navigation.
"""
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QButtonGroup, QFrame, QLabel, QPushButton, QVBoxLayout, QWidget
from app.config import APP_VERSION, HOSPITAL_DEPT, HOSPITAL_NAME, HOSPITAL_NAME_HINDI, TRUST_NAME


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
        header_layout.setContentsMargins(20, 24, 16, 20)
        header_layout.setSpacing(5)

        eyebrow = QLabel("SRI VASHISHTHA KALYAN TRUST")
        eyebrow.setStyleSheet("color:#FDA4AF;font-size:9px;font-weight:700;letter-spacing:1px;")
        header_layout.addWidget(eyebrow)

        title_hindi = QLabel(HOSPITAL_NAME_HINDI)
        title_hindi.setObjectName("SidebarTitle")
        title_hindi.setWordWrap(True)
        header_layout.addWidget(title_hindi)

        title_en = QLabel(HOSPITAL_NAME)
        title_en.setStyleSheet("color:#FFFFFF;font-size:14px;font-weight:800;")
        header_layout.addWidget(title_en)

        dept_badge = QLabel(HOSPITAL_DEPT)
        dept_badge.setObjectName("SidebarSubtitle")
        dept_badge.setWordWrap(True)
        header_layout.addWidget(dept_badge)

        trust_label = QLabel(TRUST_NAME)
        trust_label.setObjectName("SidebarTrust")
        trust_label.setWordWrap(True)
        header_layout.addWidget(trust_label)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet("background-color:rgba(255,255,255,0.16);max-height:1px;margin-top:10px;")
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
        footer_layout.setContentsMargins(18, 12, 18, 0)
        footer_layout.setSpacing(6)

        status = QLabel("●  OFFLINE MODE · LOCAL PC")
        status.setStyleSheet(
            "color:#86EFAC;font-size:10px;font-weight:700;"
            "border:1px solid rgba(134,239,172,0.25);border-radius:5px;padding:7px;"
        )
        footer_layout.addWidget(status)

        footer_trust = QLabel("Physiotherapy Management")
        footer_trust.setStyleSheet("color:#CBD5E1;font-size:10px;")
        footer_layout.addWidget(footer_trust)

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
