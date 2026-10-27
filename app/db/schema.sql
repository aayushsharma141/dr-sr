-- Kalyan Hospital Management System - Canonical SQLite Schema
PRAGMA foreign_keys = ON;

-- 1. Patients Master Table (Fields 1-10 + Picture)
CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_urn_no TEXT NOT NULL UNIQUE,          -- 1. Serial / URN No. (e.g. KH-2026-0001)
    patient_name TEXT NOT NULL,                  -- 2. Patient Name
    age INTEGER NOT NULL CHECK (age >= 0 AND age <= 125), -- 3. Age
    sex TEXT NOT NULL CHECK (sex IN ('Male', 'Female', 'Other')), -- 4. Sex
    address TEXT NOT NULL,                       -- 5. Address
    mobile_no TEXT NOT NULL,                     -- 6. Mobile No.
    patient_in TEXT NOT NULL DEFAULT (datetime('now', 'localtime')), -- 7. Patient In (Date & Time)
    patient_out TEXT,                            -- 8. Patient Out (Date & Time)
    referred_by TEXT DEFAULT '',                 -- 9. Reference / Referred By
    patient_condition TEXT NOT NULL,             -- 10. Patient Condition
    photo_filename TEXT DEFAULT '',              -- Patient Picture filename
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISCHARGED', 'ARCHIVED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_patients_serial_urn ON patients(serial_urn_no);
CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients(mobile_no);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(patient_name);

-- 2. Treatment Cases Table (Field 11 & Field 12 Total Amount)
CREATE TABLE IF NOT EXISTS treatment_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    no_of_sessions INTEGER NOT NULL DEFAULT 1 CHECK (no_of_sessions >= 1), -- 11. No. of Sessions
    total_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (total_amount_paise >= 0), -- 12. Total Amount (Paise)
    start_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'SUSPENDED')),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_treatment_cases_patient ON treatment_cases(patient_id);

-- 3. Treatment Sessions Table (Clinical Progress Tracking)
CREATE TABLE IF NOT EXISTS treatment_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    session_timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    therapist_name TEXT NOT NULL DEFAULT 'Physiotherapist',
    session_number INTEGER NOT NULL,
    treatment_notes TEXT NOT NULL,
    modalities_used TEXT DEFAULT '',
    pain_score INTEGER CHECK (pain_score IS NULL OR (pain_score >= 0 AND pain_score <= 10)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (case_id) REFERENCES treatment_cases(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_treatment_sessions_case ON treatment_sessions(case_id);

-- 4. Payments Ledger Table (Field 12 Amount Paid & Balance Tracking)
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    amount_paid_paise INTEGER NOT NULL CHECK (amount_paid_paise > 0), -- 12. Amount Paid (Paise)
    payment_timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    payment_mode TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_mode IN ('CASH', 'UPI', 'CARD', 'OTHER')),
    reference_note TEXT DEFAULT '',
    recorded_by TEXT DEFAULT 'Staff',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (case_id) REFERENCES treatment_cases(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payments_case ON payments(case_id);

-- 5. System Users Table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'RECEPTIONIST' CHECK (role IN ('ADMIN', 'RECEPTIONIST')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 6. Sequence Tracker for Atomic Patient ID Generation
CREATE TABLE IF NOT EXISTS id_sequences (
    year INTEGER PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
);
