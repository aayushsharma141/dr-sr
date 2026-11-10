-- ===========================================================================
-- Schema v3: Kalyan Hospital domain structures (ADR-24 to ADR-26, SW-20 to SW-22)
--
-- Departments, doctor fee columns, consultations under visits, and patient
-- district / photo attributes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Departments table (SW-21, ADR-24)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name_en     TEXT NOT NULL,
  name_hi     TEXT NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO departments (id, code, name_en, name_hi, created_at) VALUES
  (1, 'PHYSIOTHERAPY', 'Physiotherapy', 'फिजियोथेरेपी', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, 'OPHTHALMOLOGY', 'Ophthalmology', 'नेत्र रोग', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (3, 'GENERAL', 'General Medicine', 'सामान्य चिकित्सा', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ---------------------------------------------------------------------------
-- 2. Doctor attributes in users (SW-21, ADR-25)
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN department_code TEXT;
ALTER TABLE users ADD COLUMN consultation_fee_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN revisit_fee_paise INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. Patient district and photo (SW-20)
-- ---------------------------------------------------------------------------
ALTER TABLE patients ADD COLUMN district TEXT DEFAULT 'Bhojpur';
ALTER TABLE patients ADD COLUMN photo_path TEXT;

-- ---------------------------------------------------------------------------
-- 4. Appointments: token and department (SW-23, ADR-26)
-- ---------------------------------------------------------------------------
ALTER TABLE appointments ADD COLUMN token INTEGER;
ALTER TABLE appointments ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN is_walkin INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 5. Consultations table (SW-22, AGENTS.md Invariant 3 & 5)
--    One visit can have multiple doctor consultations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id        INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  doctor_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  appointment_id  INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  token           INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_consultation', 'completed', 'cancelled')),
  chief_complaint TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_consultations_visit ON consultations(visit_id);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON consultations(doctor_id, created_at DESC);

CREATE TRIGGER consultations_bump_version
AFTER UPDATE OF status, chief_complaint, started_at, completed_at
ON consultations
WHEN NEW.version = OLD.version
BEGIN
  UPDATE consultations SET version = OLD.version + 1 WHERE id = OLD.id;
END;

-- ---------------------------------------------------------------------------
-- 6. Physiotherapy treatment plans and sessions (SW-26, AGENTS.md Invariant 11)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS treatment_plans (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id          INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visit_id            INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  plan_name           TEXT NOT NULL,
  condition_diagnosis TEXT NOT NULL DEFAULT '',
  referred_by         TEXT NOT NULL DEFAULT '',
  total_sessions      INTEGER NOT NULL CHECK (total_sessions > 0),
  completed_sessions  INTEGER NOT NULL DEFAULT 0 CHECK (completed_sessions >= 0 AND completed_sessions <= total_sessions),
  agreed_price_paise  INTEGER NOT NULL DEFAULT 0 CHECK (agreed_price_paise >= 0),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  cancellation_reason TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient ON treatment_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_doctor ON treatment_plans(doctor_id);

CREATE TABLE IF NOT EXISTS treatment_sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  treatment_plan_id   INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE RESTRICT,
  patient_id          INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_number      INTEGER NOT NULL CHECK (session_number > 0),
  session_date        TEXT NOT NULL,
  vas_score           INTEGER CHECK (vas_score IS NULL OR (vas_score >= 0 AND vas_score <= 10)),
  modalities          TEXT NOT NULL DEFAULT '[]',
  clinical_notes      TEXT NOT NULL DEFAULT '',
  is_finalised        INTEGER NOT NULL DEFAULT 1,
  created_by          INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_treatment_sessions_plan ON treatment_sessions(treatment_plan_id, session_number);
CREATE INDEX IF NOT EXISTS idx_treatment_sessions_patient ON treatment_sessions(patient_id);

CREATE TABLE IF NOT EXISTS treatment_session_addenda (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  treatment_session_id INTEGER NOT NULL REFERENCES treatment_sessions(id) ON DELETE RESTRICT,
  author_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note                 TEXT NOT NULL,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_addenda_session ON treatment_session_addenda(treatment_session_id);

CREATE TRIGGER treatment_plans_bump_version
AFTER UPDATE OF plan_name, condition_diagnosis, referred_by, total_sessions, agreed_price_paise, status, cancellation_reason
ON treatment_plans
WHEN NEW.version = OLD.version
BEGIN
  UPDATE treatment_plans SET version = OLD.version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;

-- Invariant 11: completed_sessions incremented only on finalised treatment session
CREATE TRIGGER trg_sync_treatment_plan_session_progress
AFTER INSERT ON treatment_sessions
WHEN NEW.is_finalised = 1
BEGIN
  UPDATE treatment_plans
  SET completed_sessions = completed_sessions + 1,
      status = CASE WHEN completed_sessions + 1 >= total_sessions THEN 'completed' ELSE status END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.treatment_plan_id;
END;

-- SW-12: Clinical rows cannot be deleted
CREATE TRIGGER IF NOT EXISTS treatment_plans_no_delete
BEFORE DELETE ON treatment_plans
BEGIN
  SELECT RAISE(ABORT, 'Treatment plans cannot be deleted.');
END;

CREATE TRIGGER IF NOT EXISTS treatment_sessions_no_delete
BEFORE DELETE ON treatment_sessions
BEGIN
  SELECT RAISE(ABORT, 'Treatment sessions cannot be deleted.');
END;

