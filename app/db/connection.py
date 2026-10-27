"""
SQLite database connection factory with WAL mode and foreign key enforcement.
"""

from pathlib import Path
import sqlite3

from app.config import DB_PATH

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
        conn.commit()
    finally:
        conn.close()
