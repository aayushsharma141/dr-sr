"""
Sidebar Navigation Widget displaying Kalyan Hospital branding and routing signals.
"""

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QButtonGroup,
    QFrame,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from app.config import (
    APP_VERSION,
    HOSPITAL_DEPT,
    HOSPITAL_NAME,
    HOSPITAL_NAME_HINDI,
    TRUST_NAME,
)


class SidebarWidget(QWidget):
    """
    Fixed-width left sidebar containing official hospital branding,
    navigation buttons, and system status indicators.
    """

    page_changed = Signal(int)

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.setObjectName("SidebarWidget")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setFixedWidth(240)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 16)
        layout.setSpacing(0)

        # 1. Header Branding Container
        header_container = QWidget(self)
        header_container.setStyleSheet("background: transparent;")
        header_layout = QVBoxLayout(header_container)
        header_layout.setContentsMargins(20, 24, 20, 20)
        header_layout.setSpacing(4)

        title_hindi = QLabel(HOSPITAL_NAME_HINDI)
        title_hindi.setObjectName("SidebarTitle")
        header_layout.addWidget(title_hindi)

        title_en = QLabel(HOSPITAL_NAME)
        title_en.setStyleSheet("color: #FFFFFF; font-size: 13px; font-weight: 700;")
        header_layout.addWidget(title_en)

        dept_badge = QLabel(HOSPITAL_DEPT)
        dept_badge.setObjectName("SidebarSubtitle")
        header_layout.addWidget(dept_badge)

        trust_label = QLabel(TRUST_NAME)
        trust_label.setObjectName("SidebarTrust")
        trust_label.setWordWrap(True)
        header_layout.addWidget(trust_label)

        # Subtle separator
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet("background-color: rgba(255, 255, 255, 0.1); max-height: 1px; margin-top: 12px;")
        header_layout.addWidget(sep)

        layout.addWidget(header_container)

        # 2. Navigation Buttons Group
        self.button_group = QButtonGroup(self)
        self.button_group.setExclusive(True)

        nav_items = [
            (0, "📊  Dashboard"),
            (1, "👤  Patient Registry"),
            (2, "🩺  Treatment Sessions"),
            (3, "💳  Billing & Payments"),
            (4, "💾  Backup & Safety"),
        ]

        self.nav_buttons: list[QPushButton] = []
        for index, label in nav_items:
            btn = QPushButton(label)
            btn.setObjectName("NavButton")
            btn.setCheckable(True)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            self.button_group.addButton(btn, index)
            layout.addWidget(btn)
            self.nav_buttons.append(btn)

        self.button_group.idClicked.connect(self._on_button_clicked)

        # Default to Dashboard active
        if self.nav_buttons:
            self.nav_buttons[0].setChecked(True)

        # 3. Flexible Spacer
        layout.addStretch()

        # 4. Footer Status Area
        footer_container = QWidget(self)
        footer_container.setStyleSheet("background: transparent;")
        footer_layout = QVBoxLayout(footer_container)
        footer_layout.setContentsMargins(20, 12, 20, 0)
        footer_layout.setSpacing(4)

        status_indicator = QLabel("●  Offline Mode (Local PC)")
        status_indicator.setStyleSheet("color: #4ADE80; font-size: 11px; font-weight: 600;")
        footer_layout.addWidget(status_indicator)

        version_label = QLabel(f"Version {APP_VERSION}")
        version_label.setObjectName("SidebarVersion")
        footer_layout.addWidget(version_label)

        layout.addWidget(footer_container)

    def _on_button_clicked(self, page_id: int):
        self.page_changed.emit(page_id)

    def set_active_page(self, index: int):
        """Sets the active checked button and emits page_changed to trigger navigation."""
        btn = self.button_group.button(index)
        if btn:
            btn.setChecked(True)
            self.page_changed.emit(index)
