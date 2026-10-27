"""
Modern clinical QSS theme for Kalyan Hospital.
Presentation-only update: preserves existing widget object names and business logic.
"""
from app.config import COLORS

COLOR_PRIMARY = COLORS["primary"]
COLOR_PRIMARY_HOVER = COLORS["primary_light"]
COLOR_SECONDARY = COLORS["secondary"]
COLOR_TEXT_PRIMARY = COLORS["text_primary"]
COLOR_TEXT_MUTED = COLORS["text_secondary"]
COLOR_CARD_BG = COLORS["surface"]
COLOR_BORDER = COLORS["border"]
COLOR_BG = COLORS["background"]
COLOR_SUCCESS = COLORS["success"]
COLOR_WARNING = COLORS["warning"]
COLOR_DANGER = COLORS["danger"]


def get_application_stylesheet() -> str:
    """Return the application-wide clinical stylesheet."""
    c = COLORS
    return f"""
    QMainWindow, QWidget#CentralWidget, QStackedWidget#MainContent {{
        background: {c['background']}; color: {c['text_primary']};
    }}
    QWidget {{
        color: {c['text_primary']};
        font-family: "Segoe UI", "Nirmala UI", Arial, sans-serif;
        font-size: 13px;
    }}
    QLabel {{ background: transparent; }}
    QLabel#PageHeading {{ color: {c['text_primary']}; font-size: 22px; font-weight: 700; }}
    QLabel#PageSubheading {{ color: {c['text_secondary']}; font-size: 12px; }}

    QWidget#SidebarWidget {{
        background-color: {c['primary_dark']}; border-right: 1px solid {c['primary_light']};
    }}
    #SidebarWidget QLabel {{ background: transparent; }}
    QLabel#SidebarTitle {{
        color: #FFFFFF; font-family: "Nirmala UI", "Segoe UI", sans-serif;
        font-size: 16px; font-weight: 700;
    }}
    QLabel#SidebarSubtitle {{ color: #FDA4AF; font-size: 10px; font-weight: 700; letter-spacing: .7px; }}
    QLabel#SidebarTrust {{ color: #E2E8F0; font-size: 10px; }}
    QLabel#SidebarVersion {{ color: #CBD5E1; font-size: 10px; }}
    QPushButton#NavButton {{
        background: transparent; color: #E2E8F0; border: 0;
        border-left: 3px solid transparent; border-radius: 7px;
        text-align: left; padding: 12px 14px; margin: 2px 10px;
        font-size: 13px; font-weight: 500;
    }}
    QPushButton#NavButton:hover {{ background: rgba(255,255,255,0.09); color: #FFFFFF; }}
    QPushButton#NavButton:checked {{
        background: rgba(255,255,255,0.13); color: #FFFFFF;
        border-left: 3px solid #5EEAD4; font-weight: 700;
    }}

    QFrame#StatCard, QFrame#CardPanel {{
        background: #FFFFFF; border: 1px solid {c['border']}; border-radius: 10px;
    }}
    QLabel#StatCardTitle {{ color: {c['text_secondary']}; font-size: 11px; font-weight: 700; letter-spacing: .5px; }}
    QLabel#StatCardValue {{ color: {c['text_primary']}; font-size: 27px; font-weight: 750; }}
    QLabel#StatCardSubtitle {{ color: {c['text_secondary']}; font-size: 11px; }}

    QPushButton {{
        font-family: "Segoe UI", "Nirmala UI", sans-serif;
        border-radius: 6px; padding: 8px 13px; min-height: 18px; font-weight: 600;
    }}
    QPushButton#PrimaryButton {{
        background: {c['primary']}; color: #FFFFFF; border: 1px solid {c['primary']};
    }}
    QPushButton#PrimaryButton:hover {{ background: {c['primary_light']}; }}
    QPushButton#PrimaryButton:pressed {{ background: {c['primary_dark']}; }}
    QPushButton#SecondaryButton {{
        background: #FFFFFF; color: {c['text_primary']}; border: 1px solid {c['border']};
    }}
    QPushButton#SecondaryButton:hover {{ background: #F1F5F9; border-color: #94A3B8; }}
    QPushButton:disabled {{ color: #94A3B8; background: #F1F5F9; }}

    QLineEdit, QComboBox, QTextEdit, QSpinBox, QDateEdit, QDateTimeEdit {{
        background: #FFFFFF; color: {c['text_primary']}; border: 1px solid {c['border']};
        border-radius: 6px; padding: 7px 9px; selection-background-color: {c['accent']};
        selection-color: #FFFFFF; min-height: 20px;
    }}
    QLineEdit:hover, QComboBox:hover, QTextEdit:hover, QSpinBox:hover,
    QDateEdit:hover, QDateTimeEdit:hover {{ border-color: #CBD5E1; }}
    QLineEdit:focus, QComboBox:focus, QTextEdit:focus, QSpinBox:focus,
    QDateEdit:focus, QDateTimeEdit:focus {{ border: 1px solid {c['accent']}; }}
    QComboBox QAbstractItemView {{
        background: #FFFFFF; color: {c['text_primary']}; border: 1px solid {c['border']};
        selection-background-color: #CCFBF1; selection-color: {c['text_primary']};
    }}

    QTableWidget, QTableView {{
        background: #FFFFFF; alternate-background-color: #F8FAFC; color: {c['text_primary']};
        border: 1px solid {c['border']}; border-radius: 8px; gridline-color: #EEF2F7;
        selection-background-color: #CCFBF1; selection-color: {c['text_primary']}; outline: 0;
    }}
    QTableWidget::item, QTableView::item {{ padding: 8px 10px; border-bottom: 1px solid #F1F5F9; }}
    QTableWidget::item:hover, QTableView::item:hover {{ background: #F0FDFA; }}
    QHeaderView::section {{
        background: #F1F5F9; color: {c['text_secondary']}; font-weight: 700; font-size: 10px;
        border: none; border-bottom: 1px solid {c['border']}; padding: 10px 12px;
    }}
    QTableCornerButton::section {{ background: #F1F5F9; border: none; }}

    QDialog {{ background: {c['background']}; }}
    QGroupBox {{
        background: #FFFFFF; border: 1px solid {c['border']}; border-radius: 8px;
        margin-top: 12px; padding: 12px; font-weight: 700;
    }}
    QGroupBox::title {{ subcontrol-origin: margin; left: 12px; padding: 0 4px; color: {c['primary']}; }}
    QScrollArea {{ border: none; background: transparent; }}
    QScrollBar:vertical {{ background: transparent; width: 9px; margin: 0; }}
    QScrollBar::handle:vertical {{ background: #CBD5E1; min-height: 25px; border-radius: 4px; }}
    QScrollBar::handle:vertical:hover {{ background: #94A3B8; }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
    QToolTip {{ color: #FFFFFF; background: {c['primary_dark']}; border: 1px solid {c['primary_light']}; padding: 5px 7px; }}
    """
