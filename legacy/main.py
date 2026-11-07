"""
Application Entrypoint for Kalyan Hospital Management System.
"""

import sys
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QIcon

from app.config import APP_NAME, BASE_DIR
from app.db.connection import init_db
from app.ui.main_window import MainWindow


def main():
    """Initializes the database, configures Qt application, and starts the event loop."""
    # Ensure local database schema is initialized on first launch
    init_db()

    # Enable high-DPI scaling attributes if applicable
    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)

    app.setApplicationName(APP_NAME)
    icon_path = BASE_DIR / "app" / "assets" / "kalyan_hospital_logo.png"
    if icon_path.exists():
        app.setWindowIcon(QIcon(str(icon_path)))

    # Launch Main Window
    window = MainWindow()
    window.show()

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
