"""
Application configuration, constants, directory paths, and clinic metadata.
"""

from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PHOTOS_DIR = DATA_DIR / "photos"
BACKUPS_DIR = DATA_DIR / "backups"
BACKUP_DIR = BACKUPS_DIR  # alias used by backup_service
DB_PATH = DATA_DIR / "kalyan.db"

# Ensure runtime directories exist
for path in (DATA_DIR, PHOTOS_DIR, BACKUPS_DIR):
    path.mkdir(parents=True, exist_ok=True)

# Application Identity
APP_NAME = "Kalyan Hospital Management System"
APP_VERSION = "1.0.0-offline"

# Hospital & Trust Identity
HOSPITAL_NAME = "KALYAN HOSPITAL"
HOSPITAL_NAME_HINDI = "कल्याण हॉस्पीटल"
HOSPITAL_DEPT = "PHYSIOTHERAPY DEPARTMENT"
TRUST_NAME = "श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित"

# Clinic Branch Addresses
CLINIC_1_ADDR = "नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर (बिहार) - 802301"
CLINIC_2_ADDR = "श्रीरामपुर रोड, गड़हनी, प्रखण्ड- उदवन्तनगर, जिला- भोजपुर (बिहार) - 802206"

# Consulting Clinicians
DOCTORS = [
    {
        "name_hindi": "डॉ० मदन मोहन द्विवेदी",
        "name_en": "Dr. Madan Mohan Dwivedi",
        "qualifications": [
            "D.P.T (Pat.), O.C.T.M. (Delhi)",
            "O.C.S.P. (Gwaliar), M.B.S.A.P.O. (Bihar)",
            "Sr. Diploma Music (Allahabad)",
        ],
        "designation": "SENIOR PHYSIOTHERAPIST, SPORTS PHYSIOTHERAPIST",
        "department": "Senior & Sports Physiotherapy",
        "experience": "Ex Sadar Hospital, Arrah (Bhojpur)",
        "honors": "फिजियोरत्न से सम्मानित",
    },
    {
        "name_hindi": "डॉ० चंदन कुमार द्विवेदी",
        "name_en": "Dr. Chandan Kr. Dwivedi",
        "qualifications": [
            "B.P.T. (RGUHS) Bangalore, M.I.A.P.",
            "CDNT - Bangalore, CCT - Bangalore",
            "Ex. INT. NIMHANS - Bangalore",
            "Ex. INT. APOLLO - Bangalore",
            "Ex. INT. RMH - Bangalore",
            "FMATS - Varanasi, UP",
        ],
        "designation": "PHYSIOTHERAPIST",
        "department": "Physiotherapy",
        "experience": "",
        "honors": "फिजियोथेरेपिस्ट",
    },
]

# Theme & Palette Tokens
# Application palette is trust-led: forest green, clinical blue, and restrained gold.
# The A4 prescription design intentionally retains its own maroon palette in document_builder.py.
COLORS = {
    "primary": "#155B43",         # Trust / forest green for application actions
    "primary_dark": "#104735",    # Sidebar and dark brand surfaces
    "primary_light": "#24785B",   # Hover and selected states
    "secondary": "#234B86",       # Clinical blue for secondary actions and information
    "accent": "#0D9488",          # Clinical teal for focus and interaction
    "gold": "#C39A35",             # Restrained heritage accent
    "background": "#F5F7F5",      # Neutral, low-glare work area
    "surface": "#FFFFFF",         # Form and table surfaces
    "border": "#DDE5DF",          # Soft neutral dividers
    "text_primary": "#202B33",    # High-contrast slate text
    "text_secondary": "#64736D",  # Quiet supporting text
    "success": "#16734A",
    "warning": "#A16207",
    "danger": "#B42318",
}
