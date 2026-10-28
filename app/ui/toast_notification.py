"""
Modern, non-blocking status notifications for Kalyan Hospital desktop workspace.
Powered by QFluentWidgets InfoBar with graceful fallback to native Qt toast.
"""
from __future__ import annotations

from typing import Optional

from PySide6.QtCore import QEasingCurve, QPropertyAnimation, QTimer, Qt, Signal
from PySide6.QtWidgets import (
    QFrame,
    QGraphicsOpacityEffect,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from app.config import COLORS

try:
    from qfluentwidgets import InfoBar, InfoBarPosition
    HAS_FLUENT = True
except ImportError:
    HAS_FLUENT = False


LEVEL_COLORS = {
    "success": COLORS["success"],
    "info": COLORS["secondary"],
    "warning": COLORS["warning"],
    "error": COLORS["danger"],
}


class ToastNotification(QFrame):
    """A temporary, non-modal notification that never blocks the clinical workflow."""

    dismissed = Signal()

    @classmethod
    def show_fluent(
        cls,
        parent: QWidget,
        title: str,
        message: str,
        level: str = "success",
        duration_ms: int = 3200,
    ) -> Optional[object]:
        """Show native Fluent InfoBar if available, with smooth animation and dismissal."""
        if not HAS_FLUENT or parent is None:
            return None

        pos = InfoBarPosition.TOP_RIGHT
        dur = max(1500, duration_ms)

        if level == "success":
            return InfoBar.success(
                title=title,
                content=message,
                orient=Qt.Orientation.Horizontal,
                isClosable=True,
                position=pos,
                duration=dur,
                parent=parent,
            )
        elif level == "warning":
            return InfoBar.warning(
                title=title,
                content=message,
                orient=Qt.Orientation.Horizontal,
                isClosable=True,
                position=pos,
                duration=dur,
                parent=parent,
            )
        elif level == "error":
            return InfoBar.error(
                title=title,
                content=message,
                orient=Qt.Orientation.Horizontal,
                isClosable=True,
                position=pos,
                duration=dur,
                parent=parent,
            )
        else:
            return InfoBar.info(
                title=title,
                content=message,
                orient=Qt.Orientation.Horizontal,
                isClosable=True,
                position=pos,
                duration=dur,
                parent=parent,
            )

    def __init__(
        self,
        parent: QWidget,
        title: str,
        message: str,
        level: str = "success",
        duration_ms: int = 3200,
    ):
        super().__init__(parent)
        self.setObjectName("ToastNotification")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self.setWindowFlags(Qt.WindowType.Widget)
        self.setFixedWidth(360)

        accent = LEVEL_COLORS.get(level, COLORS["secondary"])
        self.setStyleSheet(
            "QFrame#ToastNotification {"
            f"background:#FFFFFF;border:1px solid {COLORS['border']};"
            f"border-left:4px solid {accent};border-radius:9px;"
            "}"
            "QLabel#ToastTitle {font-size:12px;font-weight:800;color:#202B33;background:transparent;}"
            "QLabel#ToastMessage {font-size:11px;color:#64736D;background:transparent;}"
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(13, 11, 13, 11)
        layout.setSpacing(10)

        marker = QLabel("✓" if level == "success" else "!" if level in ("warning", "error") else "i")
        marker.setAlignment(Qt.AlignmentFlag.AlignCenter)
        marker.setFixedSize(25, 25)
        marker.setStyleSheet(
            f"background:{accent};color:#FFFFFF;border-radius:12px;"
            "font-size:13px;font-weight:800;"
        )
        layout.addWidget(marker, alignment=Qt.AlignmentFlag.AlignTop)

        text_layout = QVBoxLayout()
        text_layout.setContentsMargins(0, 0, 0, 0)
        text_layout.setSpacing(3)

        title_label = QLabel(title)
        title_label.setObjectName("ToastTitle")
        title_label.setWordWrap(True)
        text_layout.addWidget(title_label)

        message_label = QLabel(message)
        message_label.setObjectName("ToastMessage")
        message_label.setWordWrap(True)
        text_layout.addWidget(message_label)
        layout.addLayout(text_layout, stretch=1)

        self.adjustSize()
        self.setMinimumHeight(64)

        self._opacity = QGraphicsOpacityEffect(self)
        self._opacity.setOpacity(0.0)
        self.setGraphicsEffect(self._opacity)

        self._fade_in = QPropertyAnimation(self._opacity, b"opacity", self)
        self._fade_in.setDuration(170)
        self._fade_in.setStartValue(0.0)
        self._fade_in.setEndValue(1.0)
        self._fade_in.setEasingCurve(QEasingCurve.Type.OutCubic)

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.dismiss)
        self._duration_ms = max(1200, duration_ms)

    def show_toast(self, x: int, y: int) -> None:
        self.move(x, y)
        self.show()
        self.raise_()
        self._fade_in.start()
        self._timer.start(self._duration_ms)

    def dismiss(self) -> None:
        if not self.isVisible():
            self.dismissed.emit()
            self.close()
            return
        self._timer.stop()
        self._fade_out = QPropertyAnimation(self._opacity, b"opacity", self)
        self._fade_out.setDuration(140)
        self._fade_out.setStartValue(self._opacity.opacity())
        self._fade_out.setEndValue(0.0)
        self._fade_out.setEasingCurve(QEasingCurve.Type.InCubic)
        self._fade_out.finished.connect(self._finish_dismiss)
        self._fade_out.start()

    def _finish_dismiss(self) -> None:
        self.dismissed.emit()
        self.close()
