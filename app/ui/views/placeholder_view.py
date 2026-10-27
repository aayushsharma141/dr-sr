"""
Placeholder view for staging modules before clinical workflows are linked.
"""

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFrame, QLabel, QVBoxLayout, QWidget


class PlaceholderView(QWidget):
    """Clean placeholder card with module title, description, and icon badge."""

    def __init__(
        self,
        title: str,
        description: str,
        icon: str = "INFO",
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        card = QFrame()
        card.setObjectName("CardPanel")
        card.setFixedSize(480, 240)

        card_layout = QVBoxLayout(card)
        card_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.setSpacing(12)

        icon_label = QLabel(icon)
        icon_label.setStyleSheet("font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #6B1736;")
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addWidget(icon_label)

        title_label = QLabel(title)
        title_label.setObjectName("PageHeading")
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addWidget(title_label)

        desc_label = QLabel(description)
        desc_label.setObjectName("PageSubheading")
        desc_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        desc_label.setWordWrap(True)
        card_layout.addWidget(desc_label)

        layout.addWidget(card)
