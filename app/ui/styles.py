"""
Professional Hospital Theme QSS Stylesheet for Kalyan Hospital.
Uses Deep Maroon (#6B1736), Slate Dark (#0F172A), and Clinical Teal (#0D9488).
"""

from app.config import COLORS

# Flat color constants — convenient aliases for view code
COLOR_PRIMARY       = COLORS["primary"]
COLOR_PRIMARY_HOVER = COLORS["primary_light"]
COLOR_SECONDARY     = COLORS["secondary"]
COLOR_TEXT_PRIMARY  = COLORS["text_primary"]
COLOR_TEXT_MUTED    = COLORS["text_secondary"]
COLOR_CARD_BG       = COLORS["surface"]
COLOR_BORDER        = COLORS["border"]
COLOR_BG            = COLORS["background"]
COLOR_SUCCESS       = COLORS["success"]
COLOR_WARNING       = COLORS["warning"]
COLOR_DANGER        = COLORS["danger"]

def get_application_stylesheet() -> str:
    """Returns the unified QSS stylesheet for the application."""
    return f"""
    /* Global Application Styles */
    QMainWindow, QWidget#CentralWidget, QStackedWidget#MainContent {{
        background-color: {COLORS['background']};
        color: {COLORS['text_primary']};
    }}

    QWidget {{
        color: {COLORS['text_primary']};
        font-family: "Segoe UI", "Nirmala UI", -apple-system, BlinkMacSystemFont, "Segoe UI Web (West European)", "Helvetica Neue", sans-serif;
        font-size: 13px;
    }}

    /* Sidebar Styling */
    QWidget#SidebarWidget, QFrame#SidebarWidget {{
        background-color: {COLORS['primary_dark']};
        border-right: 1px solid {COLORS['primary_light']};
    }}

    #SidebarWidget QLabel {{
        background-color: transparent;
    }}

    QLabel#SidebarTitle {{
        color: #FFFFFF;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.5px;
    }}

    QLabel#SidebarSubtitle {{
        color: #F87171;
        font-size: 11px;
        font-weight: 600;
    }}

    QLabel#SidebarTrust {{
        color: #CBD5E1;
        font-size: 10px;
        line-height: 1.2;
    }}

    QLabel#SidebarVersion {{
        color: #94A3B8;
        font-size: 10px;
    }}

    /* Navigation Buttons in Sidebar */
    QPushButton#NavButton {{
        background-color: transparent;
        color: #E2E8F0;
        border: none;
        border-left: 4px solid transparent;
        text-align: left;
        padding: 12px 16px;
        font-size: 13px;
        font-weight: 500;
        border-radius: 0px;
    }}

    QPushButton#NavButton:hover {{
        background-color: rgba(255, 255, 255, 0.08);
        color: #FFFFFF;
        border-left: 4px solid {COLORS['accent']};
    }}

    QPushButton#NavButton:checked, QPushButton#NavButton[active="true"] {{
        background-color: rgba(255, 255, 255, 0.14);
        color: #FFFFFF;
        font-weight: 600;
        border-left: 4px solid #F43F5E;
    }}

    /* Main Content Area */
    QStackedWidget#MainContent {{
        background-color: {COLORS['background']};
        border: none;
    }}

    /* Card Panels */
    QFrame#StatCard, QFrame#CardPanel {{
        background-color: {COLORS['surface']};
        border: 1px solid {COLORS['border']};
        border-radius: 8px;
        padding: 16px;
    }}

    QLabel#StatCardTitle {{
        color: {COLORS['text_secondary']};
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }}

    QLabel#StatCardValue {{
        color: {COLORS['text_primary']};
        font-size: 26px;
        font-weight: 700;
    }}

    QLabel#StatCardSubtitle {{
        color: {COLORS['text_secondary']};
        font-size: 11px;
    }}

    /* Section Headings */
    QLabel#PageHeading {{
        font-size: 20px;
        font-weight: 700;
        color: {COLORS['primary']};
    }}

    QLabel#PageSubheading {{
        font-size: 12px;
        color: {COLORS['text_secondary']};
    }}

    /* Buttons */
    QPushButton#PrimaryButton {{
        background-color: {COLORS['primary']};
        color: #FFFFFF;
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        font-weight: 600;
    }}

    QPushButton#PrimaryButton:hover {{
        background-color: {COLORS['primary_light']};
    }}

    QPushButton#PrimaryButton:pressed {{
        background-color: {COLORS['primary_dark']};
    }}

    QPushButton#SecondaryButton {{
        background-color: {COLORS['surface']};
        color: {COLORS['text_primary']};
        border: 1px solid {COLORS['border']};
        border-radius: 6px;
        padding: 8px 16px;
        font-weight: 500;
    }}

    QPushButton#SecondaryButton:hover {{
        background-color: #F1F5F9;
        border-color: #CBD5E1;
    }}

    /* Form Controls */
    QLineEdit, QComboBox, QTextEdit, QSpinBox, QDateEdit {{
        background-color: {COLORS['surface']};
        color: {COLORS['text_primary']};
        border: 1px solid {COLORS['border']};
        border-radius: 6px;
        padding: 6px 10px;
        selection-background-color: {COLORS['accent']};
    }}

    QLineEdit:focus, QComboBox:focus, QTextEdit:focus, QSpinBox:focus, QDateEdit:focus {{
        border: 1px solid {COLORS['accent']};
        outline: none;
    }}

    /* Table & Header Styling */
    QTableWidget {{
        background-color: {COLORS['surface']};
        border: 1px solid {COLORS['border']};
        border-radius: 8px;
        gridline-color: {COLORS['border']};
        selection-background-color: #F1F5F9;
        selection-color: {COLORS['text_primary']};
    }}

    QTableWidget::item {{
        padding: 8px 12px;
        border-bottom: 1px solid {COLORS['border']};
    }}

    QTableWidget::item:hover {{
        background-color: #F8FAFC;
    }}

    QHeaderView::section {{
        background-color: #F8FAFC;
        color: {COLORS['text_secondary']};
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border: none;
        border-bottom: 2px solid {COLORS['border']};
        padding: 8px 12px;
    }}

    /* Scrollbars */
    QScrollBar:vertical {{
        background: transparent;
        width: 8px;
        margin: 0px;
    }}

    QScrollBar::handle:vertical {{
        background: #CBD5E1;
        min-height: 24px;
        border-radius: 4px;
    }}

    QScrollBar::handle:vertical:hover {{
        background: #94A3B8;
    }}

    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
        height: 0px;
    }}
    """
