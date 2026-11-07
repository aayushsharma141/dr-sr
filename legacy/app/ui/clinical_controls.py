"""
Native clinical controls for the physiotherapy workflow.
The widgets are presentation-only; stored values remain the existing 0–10 pain
score and comma-separated modalities string.
"""
from __future__ import annotations

from collections.abc import Iterable

from PySide6.QtCore import Qt, Signal, QPointF
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen, QFont
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSlider,
    QVBoxLayout,
    QWidget,
)

from app.config import COLORS
from qfluentwidgets import Slider, PillPushButton, ElevatedCardWidget, CardWidget


MODALITY_OPTIONS = (
    "TENS",
    "Interferential Therapy (IFT)",
    "Ultrasound Therapy (UST)",
    "Cervical Traction",
    "Lumbar Traction",
    "Moist Heat Therapy",
    "Therapeutic Exercises",
    "Manual Mobilization",
)


def pain_level(value: int) -> tuple[str, str]:
    """Return a restrained severity label and color for a numeric VAS score."""
    score = max(0, min(10, int(value)))
    if score == 0:
        return "No pain", "#16734A"
    if score <= 3:
        return "Mild pain", "#16734A"
    if score <= 6:
        return "Moderate pain", "#A16207"
    return "Severe pain", "#B42318"


class PainScaleWidget(QFrame):
    """Color-graded 0–10 VAS selector with an immediately visible numeric value."""

    valueChanged = Signal(int)

    def __init__(self, initial_value: int = 5, parent: QWidget | None = None):
        super().__init__(parent)
        self.setObjectName("PainScaleWidget")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 8, 10, 6)
        layout.setSpacing(5)

        header = QHBoxLayout()
        header.setContentsMargins(0, 0, 0, 0)
        self.value_label = QLabel()
        self.value_label.setObjectName("VASScoreValue")
        header.addWidget(self.value_label)

        self.level_label = QLabel()
        self.level_label.setObjectName("VASLevelBadge")
        header.addStretch(1)
        header.addWidget(self.level_label)
        layout.addLayout(header)

        self.slider = Slider(Qt.Orientation.Horizontal)
        self.slider.setObjectName("VASPainSlider")
        self.slider.setRange(0, 10)
        self.slider.setSingleStep(1)
        self.slider.setPageStep(1)
        self.slider.setTickInterval(1)
        self.slider.setTickPosition(QSlider.TickPosition.TicksBelow)
        self.slider.setMinimumHeight(28)
        self.slider.valueChanged.connect(self._sync_value)
        layout.addWidget(self.slider)

        range_row = QHBoxLayout()
        range_row.setContentsMargins(0, 0, 0, 0)
        for text, alignment in (
            ("0 · No pain", Qt.AlignmentFlag.AlignLeft),
            ("1–3 Mild", Qt.AlignmentFlag.AlignHCenter),
            ("4–6 Moderate", Qt.AlignmentFlag.AlignHCenter),
            ("7–10 Severe", Qt.AlignmentFlag.AlignRight),
        ):
            label = QLabel(text)
            label.setAlignment(alignment)
            label.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:9px;")
            range_row.addWidget(label, stretch=1)
        layout.addLayout(range_row)

        self.slider.setValue(max(0, min(10, int(initial_value))))
        self._sync_value(self.slider.value())

    def value(self) -> int:
        return self.slider.value()

    def setValue(self, value: int) -> None:
        self.slider.setValue(max(0, min(10, int(value))))

    def _sync_value(self, value: int) -> None:
        label, accent = pain_level(value)
        self.value_label.setText(f"{value} / 10")
        self.value_label.setStyleSheet(f"color:{accent};font-size:17px;font-weight:800;")
        self.level_label.setText(label.upper())
        self.level_label.setStyleSheet(
            f"background:{accent};color:#FFFFFF;border-radius:10px;padding:4px 9px;"
            "font-size:9px;font-weight:800;"
        )
        self.slider.setStyleSheet(
            "QSlider::groove:horizontal {"
            "height:8px;border-radius:4px;"
            "background:qlineargradient(x1:0,y1:0,x2:1,y2:0,"
            "stop:0 #22C55E,stop:0.30 #22C55E,stop:0.40 #F59E0B,"
            "stop:0.60 #F59E0B,stop:0.70 #EF4444,stop:1 #DC2626);"
            "}"
            "QSlider::sub-page:horizontal {background:transparent;}"
            "QSlider::add-page:horizontal {background:transparent;}"
            f"QSlider::handle:horizontal {{width:18px;height:18px;margin:-6px 0;"
            f"background:{accent};border:2px solid #FFFFFF;border-radius:10px;}}"
            f"QSlider::handle:horizontal:hover {{border:2px solid {accent};}}"
        )
        self.valueChanged.emit(value)


class ModalityChipGroup(QFrame):
    """Checkable modality pills for fast, structured clinical session entry."""

    def __init__(
        self,
        options: Iterable[str] = MODALITY_OPTIONS,
        selected: Iterable[str] = (),
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setObjectName("ModalityChipGroup")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.buttons: dict[str, QPushButton] = {}

        chosen = set(selected)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        title = QLabel("TREATMENT MODALITIES APPLIED")
        title.setObjectName("FormSectionHeading")
        layout.addWidget(title)

        hint = QLabel("Select every modality used in this session.")
        hint.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:10px;")
        layout.addWidget(hint)

        grid = QGridLayout()
        grid.setContentsMargins(0, 0, 0, 0)
        grid.setHorizontalSpacing(7)
        grid.setVerticalSpacing(7)

        for index, option in enumerate(options):
            button = PillPushButton(option)
            button.setObjectName("ModalityChip")
            button.setCheckable(True)
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.setMinimumHeight(32)
            button.setMinimumWidth(120)
            button.setChecked(option in chosen)
            self.buttons[option] = button
            grid.addWidget(button, index // 4, index % 4)

        layout.addLayout(grid)

    def selected_values(self) -> list[str]:
        return [label for label, button in self.buttons.items() if button.isChecked()]

    def set_selected_values(self, values: Iterable[str]) -> None:
        selected = set(values)
        for label, button in self.buttons.items():
            button.setChecked(label in selected)


class _PainTrendPlot(QWidget):
    """Small custom-painted sparkline for session-by-session self-reported pain scores."""

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._scores: list[tuple[int, int]] = []
        self.setMinimumHeight(58)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

    def set_scores(self, scores: Iterable[tuple[int, int]]) -> None:
        self._scores = sorted(
            ((int(session), max(0, min(10, int(score)))) for session, score in scores),
            key=lambda point: point[0],
        )
        self.update()

    def paintEvent(self, event):
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.fillRect(self.rect(), QColor("#FFFFFF"))

        left, right, top, bottom = 28.0, float(self.width() - 12), 7.0, float(self.height() - 19)
        plot_height = max(1.0, bottom - top)
        plot_width = max(1.0, right - left)

        grid_pen = QPen(QColor("#E8EEE9"), 1)
        painter.setPen(grid_pen)
        for value in (10, 5, 0):
            y = top + (10 - value) / 10 * plot_height
            painter.drawLine(int(left), int(y), int(right), int(y))
            painter.setPen(QColor("#7A8981"))
            painter.setFont(QFont("Segoe UI", 8))
            painter.drawText(1, int(y + 3), str(value))
            painter.setPen(grid_pen)

        if not self._scores:
            painter.setPen(QColor(COLORS["text_secondary"]))
            painter.setFont(QFont("Segoe UI", 9))
            painter.drawText(
                int(left + 4),
                int(top + plot_height / 2 + 4),
                "Log sessions with a pain score to track progress.",
            )
            painter.end()
            return

        count = len(self._scores)
        points: list[QPointF] = []
        for index, (session_number, score) in enumerate(self._scores):
            x = left + plot_width / 2 if count == 1 else left + (index / (count - 1)) * plot_width
            y = top + (10 - score) / 10 * plot_height
            points.append(QPointF(x, y))

        path = QPainterPath(points[0])
        for point in points[1:]:
            path.lineTo(point)
        painter.setPen(QPen(QColor(COLORS["primary"]), 2))
        painter.drawPath(path)

        for index, ((session_number, score), point) in enumerate(zip(self._scores, points)):
            _, color = pain_level(score)
            painter.setPen(QPen(QColor("#FFFFFF"), 1.5))
            painter.setBrush(QColor(color))
            painter.drawEllipse(point, 4.2, 4.2)

            if count <= 8 or index in (0, count - 1):
                painter.setPen(QColor(COLORS["text_secondary"]))
                painter.setFont(QFont("Segoe UI", 8))
                painter.drawText(int(point.x() - 8), self.height() - 3, f"S{session_number}")

        painter.end()


class PainTrendWidget(ElevatedCardWidget):
    """Pain trend panel with a simple change summary and a local sparkline."""

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.setObjectName("PainTrendWidget")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 7)
        layout.setSpacing(3)

        header = QHBoxLayout()
        title = QLabel("PAIN TREND BY SESSION")
        title.setObjectName("FormSectionHeading")
        title.setStyleSheet("border-bottom:none;margin-top:0;padding:0;font-size:9px;")
        header.addWidget(title)
        header.addStretch(1)

        self.summary_label = QLabel("No scored sessions yet")
        self.summary_label.setStyleSheet(f"color:{COLORS['text_secondary']};font-size:10px;font-weight:700;")
        header.addWidget(self.summary_label)
        layout.addLayout(header)

        self.plot = _PainTrendPlot(self)
        layout.addWidget(self.plot)

    def set_scores(self, scores: Iterable[tuple[int, int]]) -> None:
        points = sorted(
            ((int(session), max(0, min(10, int(score)))) for session, score in scores),
            key=lambda point: point[0],
        )
        self.plot.set_scores(points)
        if not points:
            self.summary_label.setText("No scored sessions yet")
            return

        first = points[0][1]
        latest = points[-1][1]
        delta = latest - first
        if delta < 0:
            change = f"Change: −{abs(delta)}"
        elif delta > 0:
            change = f"Change: +{delta}"
        else:
            change = "Change: 0"
        self.summary_label.setText(f"Latest {latest}/10  ·  {change}")
