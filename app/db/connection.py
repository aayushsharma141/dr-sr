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
    # WAL mode and NORMAL synchronicity for fast, robust offline operations
    if target_path != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
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
    """Add columns and tables introduced after earlier releases to existing databases."""
    for table in ("patients", "treatment_cases"):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if "doctor_id" not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN doctor_id INTEGER REFERENCES doctors(id)")
    # Backfill legacy records where doctor_id was not set
    conn.execute("UPDATE patients SET doctor_id = ((id - 1) % 2) + 1 WHERE doctor_id IS NULL")
    conn.execute(
        """
        UPDATE treatment_cases
        SET doctor_id = (SELECT doctor_id FROM patients WHERE patients.id = treatment_cases.patient_id)
        WHERE doctor_id IS NULL
        """
    )

    # Ensure audit_logs table exists on legacy databases
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            actor_name TEXT NOT NULL DEFAULT 'System',
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            details TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)")


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
