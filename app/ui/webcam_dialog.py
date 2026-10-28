"""
Webcam photo capture for patient registration.

The camera is opened only when this dialog is shown, and released when it closes.
Everything is local; nothing is uploaded. If no camera is available the dialog says
so and the registration form keeps its "Upload photo" fallback.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from PySide6.QtCore import QRect, Qt
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtMultimedia import QCamera, QImageCapture, QMediaCaptureSession, QMediaDevices
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QStackedLayout,
    QVBoxLayout,
    QWidget,
)

# Passport-style photo ratio used on the printed registration card (35 mm x 45 mm).
PHOTO_RATIO = 35 / 45
PHOTO_MAX_HEIGHT = 720  # keeps stored photos small (~60-120 KB JPEG)


def crop_to_passport(image: QImage, max_height: int = PHOTO_MAX_HEIGHT) -> QImage:
    """Centre-crop to the 35:45 passport ratio and cap the size, without stretching."""
    if image.isNull():
        return image
    width, height = image.width(), image.height()
    if width / height > PHOTO_RATIO:
        new_width = round(height * PHOTO_RATIO)
        rect = QRect((width - new_width) // 2, 0, new_width, height)
    else:
        new_height = round(width / PHOTO_RATIO)
        rect = QRect(0, (height - new_height) // 2, width, new_height)
    cropped = image.copy(rect)
    if cropped.height() > max_height:
        cropped = cropped.scaledToHeight(max_height, Qt.TransformationMode.SmoothTransformation)
    return cropped


def save_photo_jpeg(image: QImage, directory: str | None = None) -> str | None:
    """Write the processed photo to a temporary JPEG and return its path."""
    processed = crop_to_passport(image)
    if processed.isNull():
        return None
    target_dir = Path(directory or tempfile.gettempdir())
    handle = tempfile.NamedTemporaryFile(
        prefix="kalyan_photo_", suffix=".jpg", dir=target_dir, delete=False
    )
    handle.close()
    if not processed.save(handle.name, "JPG", 88):
        return None
    return handle.name


class WebcamCaptureDialog(QDialog):
    """Live preview, capture, retake, and confirm."""

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.setWindowTitle("Take Patient Photo")
        self.setModal(True)
        self.setMinimumSize(520, 520)
        self.captured_path: str | None = None
        self._captured_image: QImage | None = None
        self._camera: QCamera | None = None
        self._session: QMediaCaptureSession | None = None
        self._capture: QImageCapture | None = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(12)

        hint = QLabel("Ask the patient to face the camera. The photo is saved on this computer only.")
        hint.setObjectName("PageSubheading")
        hint.setWordWrap(True)
        layout.addWidget(hint)

        self.camera_combo = QComboBox()
        self.camera_combo.setObjectName("CameraChooser")
        self.camera_combo.currentIndexChanged.connect(self._on_camera_selected)
        layout.addWidget(self.camera_combo)

        # Stack: live preview page, captured-still page, message page.
        stage = QWidget()
        stage.setMinimumHeight(340)
        self.stack = QStackedLayout(stage)
        self.video = QVideoWidget()
        self.stack.addWidget(self.video)
        self.still = QLabel()
        self.still.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.still.setStyleSheet("background:#111;border-radius:8px;")
        self.stack.addWidget(self.still)
        self.message = QLabel()
        self.message.setObjectName("EmptyStateLabel")
        self.message.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.message.setWordWrap(True)
        self.message.setStyleSheet("background:#F5F7F5;border:1px dashed #DDE5DF;border-radius:8px;padding:24px;")
        self.stack.addWidget(self.message)
        layout.addWidget(stage, stretch=1)

        buttons = QHBoxLayout()
        buttons.setSpacing(8)
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.setObjectName("SecondaryButton")
        self.cancel_btn.clicked.connect(self.reject)
        buttons.addWidget(self.cancel_btn)
        buttons.addStretch()
        self.retake_btn = QPushButton("Retake")
        self.retake_btn.setObjectName("SecondaryButton")
        self.retake_btn.clicked.connect(self._retake)
        buttons.addWidget(self.retake_btn)
        self.capture_btn = QPushButton("Capture")
        self.capture_btn.setObjectName("PrimaryButton")
        self.capture_btn.clicked.connect(self._take_picture)
        buttons.addWidget(self.capture_btn)
        self.use_btn = QPushButton("Use This Photo")
        self.use_btn.setObjectName("PrimaryButton")
        self.use_btn.clicked.connect(self._accept_photo)
        buttons.addWidget(self.use_btn)
        layout.addLayout(buttons)

        self._devices = QMediaDevices(self)
        self._set_state("preview")
        self._populate_cameras()

    # -- camera setup -------------------------------------------------------
    def _populate_cameras(self) -> None:
        inputs = QMediaDevices.videoInputs()
        self.camera_combo.blockSignals(True)
        self.camera_combo.clear()
        for device in inputs:
            self.camera_combo.addItem(device.description(), device)
        self.camera_combo.blockSignals(False)
        self.camera_combo.setVisible(len(inputs) > 1)
        if not inputs:
            self._show_message(
                "No camera found.\nConnect a webcam and reopen this window, "
                "or close it and use Upload Photo."
            )
            return
        self._start_camera(inputs[0])

    def _on_camera_selected(self, index: int) -> None:
        device = self.camera_combo.itemData(index)
        if device is not None:
            self._start_camera(device)

    def _start_camera(self, device) -> None:
        self._stop_camera()
        self._camera = QCamera(device, self)
        self._capture = QImageCapture(self)
        self._session = QMediaCaptureSession(self)
        self._session.setCamera(self._camera)
        self._session.setImageCapture(self._capture)
        self._session.setVideoOutput(self.video)
        self._camera.errorOccurred.connect(self._on_camera_error)
        self._capture.imageCaptured.connect(self._on_image_captured)
        self._capture.errorOccurred.connect(self._on_capture_error)
        self._set_state("preview")
        self._camera.start()

    def _stop_camera(self) -> None:
        if self._camera is not None:
            self._camera.stop()
            self._camera.deleteLater()
            self._camera = None
        if self._capture is not None:
            self._capture.deleteLater()
            self._capture = None
        if self._session is not None:
            self._session.deleteLater()
            self._session = None

    # -- state / actions ----------------------------------------------------
    def _set_state(self, state: str) -> None:
        previewing = state == "preview"
        captured = state == "captured"
        if previewing:
            self.stack.setCurrentWidget(self.video)
        elif captured:
            self.stack.setCurrentWidget(self.still)
        self.capture_btn.setVisible(previewing)
        self.capture_btn.setEnabled(previewing and self._camera is not None)
        self.retake_btn.setVisible(captured)
        self.use_btn.setVisible(captured)

    def _show_message(self, text: str) -> None:
        self.message.setText(text)
        self.stack.setCurrentWidget(self.message)
        self.capture_btn.setEnabled(False)
        self.retake_btn.setVisible(False)
        self.use_btn.setVisible(False)

    def _on_camera_error(self, _error, message: str) -> None:
        self._show_message(
            "The camera could not be used. It may be busy in another program or blocked "
            f"in Windows privacy settings.\n\n{message}"
        )

    def _on_capture_error(self, _id, _error, message: str) -> None:
        self._show_message(f"Could not capture a photo.\n\n{message}")

    def _take_picture(self) -> None:
        if self._capture is not None:
            self.capture_btn.setEnabled(False)
            self._capture.capture()

    def _on_image_captured(self, _id: int, image: QImage) -> None:
        processed = crop_to_passport(image)
        if processed.isNull():
            return
        self._captured_image = processed
        self.still.setPixmap(QPixmap.fromImage(processed).scaled(
            self.still.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        ))
        self._set_state("captured")

    def _retake(self) -> None:
        self._captured_image = None
        self._set_state("preview")

    def _accept_photo(self) -> None:
        if self._captured_image is None:
            return
        path = save_photo_jpeg(self._captured_image)
        if path is None:
            self._show_message("The photo could not be saved. Please try again or upload a file.")
            return
        self.captured_path = path
        self.accept()

    def done(self, result: int) -> None:  # always release the camera
        self._stop_camera()
        super().done(result)
