"""
SQLite database connection factory with WAL mode and foreign key enforcement.
"""

from pathlib import Path
import sqlite3

from app.config import DB_PATH, DOCTORS

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def get_db_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """
    Returns an SQLite connection configured with WAL journal mode,
    foreign key constraint enforcement, and row factory mapping.
    """
    target_path = str(db_path) if db_path is not None else str(DB_PATH)

    conn = sqlite3.connect(target_path)
    conn.execute("PRAGMA foreign_keys = ON;")
    # WAL mode is applicable to file-based databases
    if target_path != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path | str | None = None) -> None:
    """
    Initializes the database schema if tables do not already exist.
    """
    conn = get_db_connection(db_path)
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            schema_sql = f.read()
        conn.executescript(schema_sql)
        _migrate(conn)
        _seed_doctors(conn)
        conn.commit()
    finally:
        conn.close()


def _migrate(conn: sqlite3.Connection) -> None:
    """Add columns introduced after the first release to existing databases."""
    for table in ("patients", "treatment_cases"):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if "doctor_id" not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN doctor_id INTEGER REFERENCES doctors(id)")


def _seed_doctors(conn: sqlite3.Connection) -> None:
    """Create the configured doctors on first run; never overwrites edited rows."""
    for doctor in DOCTORS:
        conn.execute(
            """
            INSERT OR IGNORE INTO doctors (name_en, name_hindi, department, designation)
            VALUES (?, ?, ?, ?)
            """,
            (
                doctor["name_en"],
                doctor.get("name_hindi", ""),
                doctor.get("department", ""),
                doctor.get("designation", ""),
            ),
        )
