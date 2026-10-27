---
name: sqlite-offline-database
description: "Architecture rules, performance tuning, and resilience strategies for offline-first SQLite database systems in clinical and desktop applications. Use when configuring SQLite pragmas (WAL mode, foreign keys), writing atomic transactions, implementing automated backups, handling schema migrations, or setting up SQLCipher at-rest database encryption."
---

# SQLite Offline Database Resilience Guide

This skill provides industry best practices for running mission-critical clinical and financial software on embedded **SQLite 3**.

## 1. Mandatory SQLite PRAGMA Configuration
Every newly opened SQLite connection MUST execute these pragmas immediately:

```python
import sqlite3

def get_db_connection(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(
        db_path,
        timeout=30.0,            # Prevent 'database is locked' errors during brief contention
        check_same_thread=False  # Required if accessed across Qt background worker threads
    )
    conn.row_factory = sqlite3.Row

    # Enforce relational integrity
    conn.execute("PRAGMA foreign_keys = ON;")
    
    # Enable Write-Ahead Logging (enables concurrent readers with one writer)
    conn.execute("PRAGMA journal_mode = WAL;")
    
    # Safe synchronous mode for desktop workstations with power-surge protection
    conn.execute("PRAGMA synchronous = NORMAL;")
    
    # UTF-8 encoding
    conn.execute("PRAGMA encoding = 'UTF-8';")
    
    # Busy timeout in ms
    conn.execute("PRAGMA busy_timeout = 5000;")
    
    return conn
```

## 2. Concurrency & Threading Rules
* **Never share an active `sqlite3.Connection` instance across threads.** Each thread or worker should obtain its own connection via the connection factory and close it or return it upon completion.
* **Keep transactions short:**
  * Prepare calculations in memory *before* opening the write transaction.
  * Use Python's context manager: `with conn: ...` to ensure automatic `COMMIT` on success and `ROLLBACK` on unhandled exception.

## 3. Automated Hot Backups (Zero-Downtime)
* Do NOT copy the SQLite `.db` file using standard OS file copy while the application is actively writing (this can copy corrupted WAL frames).
* Use the official SQLite Online Backup API (`sqlite3_backup`):

```python
import os
import shutil
import sqlite3
from datetime import datetime

def perform_live_backup(source_db_path: str, backup_dir: str) -> str:
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(backup_dir, f"backup_{timestamp}.db")

    src = sqlite3.connect(source_db_path)
    dst = sqlite3.connect(backup_file)
    try:
        with dst:
            src.backup(dst, pages=100)  # Stream backup in chunks without blocking UI
    finally:
        dst.close()
        src.close()
    return backup_file
```

## 4. SQLCipher Database Encryption (Patient Privacy)
For healthcare software requiring HIPAA/DPDP at-rest encryption:
* Use `sqlcipher3` or `pysqlcipher3`:
```sql
PRAGMA key = 'secure-passphrase-or-hardware-key';
PRAGMA cipher_page_size = 4096;
PRAGMA kdf_iter = 256000;
```

## 5. Corruption Prevention & Health Checks
* Run on startup or weekly maintenance:
  * `PRAGMA integrity_check;` (should return `"ok"`).
  * `PRAGMA foreign_key_check;` (should return empty list).
  * `PRAGMA optimize;` (updates query planner statistics).
