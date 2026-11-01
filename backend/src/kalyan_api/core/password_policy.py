"""NIST-style password policy validation and embedded common password blocklist.

Guarantees:
- Validates password length against runtime Settings (no hardcoded length constants).
- Rejects passwords matching username or full name case-insensitively.
- Rejects passwords found in embedded BLOCKLIST or based on blocklisted stems with trailing digits.
- Never logs, echoes, or leaks cleartext candidate passwords in error messages.
- Does not enforce artificial character composition rules (allowing long passphrases and Unicode).
"""

from kalyan_api.config import Settings


class PasswordPolicyError(Exception):
    """Raised when candidate password violates password policy rules."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# Curated blocklist of common passwords, local patterns, and keyboard sequences (>= 100 entries)
BLOCKLIST: frozenset[str] = frozenset(
    {
        "password",
        "passwords",
        "12345678",
        "123456789",
        "1234567890",
        "qwerty",
        "qwertyuiop",
        "asdfgh",
        "asdfghjkl",
        "zxcvbn",
        "zxcvbnm",
        "welcome",
        "welcome1",
        "welcome123",
        "administrator",
        "admin",
        "admin123",
        "kalyan",
        "kalyan123",
        "kalyan@123",
        "kalyanhospital",
        "hospital",
        "hospital123",
        "vashishtha",
        "vashishthatrust",
        "trust123",
        "bhojpur",
        "bhojpur123",
        "bihar",
        "bihar123",
        "patna",
        "patna123",
        "clinic",
        "clinic123",
        "doctor",
        "doctor123",
        "reception",
        "reception123",
        "medical",
        "medical123",
        "patient",
        "patient123",
        "pharma",
        "pharmacy",
        "ayurveda",
        "homeo",
        "physio",
        "physiotherapy",
        "opd12345",
        "hospitalstaff",
        "staff123",
        "sunshine",
        "princess",
        "football",
        "baseball",
        "basketball",
        "monkey",
        "shadow",
        "master",
        "dragon",
        "superman",
        "batman",
        "trustno1",
        "letmein",
        "letmein123",
        "iloveyou",
        "mustang",
        "michael",
        "charlie",
        "freedom",
        "computer",
        "internet",
        "access123",
        "login123",
        "secret123",
        "system123",
        "default123",
        "kalyanapp",
        "kalyanpass",
        "kalyanadmin",
        "secure123",
        "testing123",
        "changeme",
        "changeme123",
        "newpassword",
        "hospitalcare",
        "healthcare",
        "swastha",
        "aarogya",
        "seva1234",
        "omshanti",
        "ram12345",
        "krishna123",
        "hanuman123",
        "ganesh123",
        "india123",
        "bharat123",
        "hindustan",
        "biharpolice",
        "aracity",
        "ara12345",
        "stationroad",
        "mainroad",
        "market123",
        "center123",
        "central123",
        "service123",
        "management",
        "software123",
        "database123",
        "postgres",
        "postgres123",
        "server123",
        "network123",
        "router123",
        "desktop123",
        "windows123",
        "microsoft",
        "google123",
        "user1234",
        "temp1234",
        "firstrun123",
        "kalyantrust",
        "trustee123",
        "physiocare",
    }
)


def validate_password_policy(
    password: str,
    username: str,
    full_name: str | None,
    settings: Settings,
) -> None:
    """Validate candidate password against security policy.

    Raises:
        PasswordPolicyError: if password fails length, identity, or blocklist checks.
    """
    if len(password) < settings.password_min_length:
        raise PasswordPolicyError(
            f"Password must be at least {settings.password_min_length} characters long"
        )

    if len(password) > settings.password_max_length:
        raise PasswordPolicyError(
            f"Password must not exceed {settings.password_max_length} characters"
        )

    pwd_lower = password.lower()

    # Identity checks: cannot be identical to username or full name
    clean_username = username.strip().lower()
    if clean_username and pwd_lower == clean_username:
        raise PasswordPolicyError("Password cannot be identical to username")

    if full_name:
        clean_name = full_name.strip().lower()
        if clean_name and pwd_lower == clean_name:
            raise PasswordPolicyError("Password cannot be identical to full name")

    # Blocklist checks: full match or base stem with trailing digits/symbols stripped
    if pwd_lower in BLOCKLIST:
        raise PasswordPolicyError("Password is too common or easily guessable")

    pwd_stem = pwd_lower.rstrip("0123456789!@#$%^&*_-+=.")
    if len(pwd_stem) >= 3 and pwd_stem in BLOCKLIST:
        raise PasswordPolicyError("Password is based on a common easily guessable word")
