"""
Application Entrypoint for Kalyan Hospital Management System.
"""

import sys
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from app.config import APP_NAME
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

    # Launch Main Window
    window = MainWindow()
    window.show()

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
