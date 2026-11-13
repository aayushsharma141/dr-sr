"""
Global test fixtures for PySide6 application testing.
"""

import os
import sys
import pytest

# Ensure Qt runs offscreen in headless test environments
os.environ["QT_QPA_PLATFORM"] = "offscreen"

from PySide6.QtWidgets import QApplication


@pytest.fixture(scope="session")
def qapp():
    """Provides a singleton QApplication instance for test execution."""
    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)
    yield app
