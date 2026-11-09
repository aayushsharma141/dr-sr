-- ===========================================================================
-- Schema v2: Phase 1 foundations (ADR-27, tasks SW-10 to SW-13)
--
-- Runs inside one transaction (see applyMigrations in src/db.js). SQLite
-- cannot change a CHECK constraint in place, so the rules below are enforced
-- with triggers, except the backups table, which is rebuilt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Backups: allow the automatic "pre_upgrade" backup kind (SW-10).
--    No other table references backups, so a rebuild is safe.
-- ---------------------------------------------------------------------------
CREATE TABLE backups_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL DEFAULT 'manual'
                CHECK (kind IN ('manual','scheduled','pre_restore','pre_upgrade')),
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  encrypted   INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed','missing')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  note        TEXT
);
INSERT INTO backups_v2 (id, filename, kind, size_bytes, sha256, encrypted, status, created_by, created_at, note)
  SELECT id, filename, kind, size_bytes, sha256, encrypted, status, created_by, created_at, note FROM backups;
DROP TABLE backups;
ALTER TABLE backups_v2 RENAME TO backups;
CREATE INDEX IF NOT EXISTS idx_backups_at ON backups(created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Roles: Kalyan Hospital uses Admin, Reception and Doctor only (ADR-17).
--    Any nurse account from a demo database is switched off, not deleted,
--    so its audit history stays intact.
-- ---------------------------------------------------------------------------
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'nurse');
UPDATE users SET is_active = 0 WHERE role = 'nurse';

CREATE TRIGGER users_no_nurse_insert BEFORE INSERT ON users
WHEN NEW.role = 'nurse'
BEGIN
  SELECT RAISE(ABORT, 'The nurse role is not used at Kalyan Hospital.');
END;

CREATE TRIGGER users_no_nurse_update BEFORE UPDATE OF role ON users
WHEN NEW.role = 'nurse' AND OLD.role <> 'nurse'
BEGIN
  SELECT RAISE(ABORT, 'The nurse role is not used at Kalyan Hospital.');
END;

-- ---------------------------------------------------------------------------
-- 3. Clinical records are never deleted (SW-12, AGENTS.md invariant 12).
--    A wrong entry is cancelled with a reason and stays on the record.
-- ---------------------------------------------------------------------------
ALTER TABLE clinical_notes ADD COLUMN cancelled_at TEXT;
ALTER TABLE clinical_notes ADD COLUMN cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE clinical_notes ADD COLUMN cancel_reason TEXT;

ALTER TABLE diagnoses ADD COLUMN cancelled_at TEXT;
ALTER TABLE diagnoses ADD COLUMN cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE diagnoses ADD COLUMN cancel_reason TEXT;

ALTER TABLE prescriptions ADD COLUMN cancelled_at TEXT;
ALTER TABLE prescriptions ADD COLUMN cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE prescriptions ADD COLUMN cancel_reason TEXT;

CREATE TRIGGER clinical_notes_no_delete BEFORE DELETE ON clinical_notes
BEGIN
  SELECT RAISE(ABORT, 'Clinical notes cannot be deleted. Cancel them with a reason instead.');
END;
CREATE TRIGGER diagnoses_no_delete BEFORE DELETE ON diagnoses
BEGIN
  SELECT RAISE(ABORT, 'Diagnoses cannot be deleted. Cancel them with a reason instead.');
END;
CREATE TRIGGER prescriptions_no_delete BEFORE DELETE ON prescriptions
BEGIN
  SELECT RAISE(ABORT, 'Prescriptions cannot be deleted. Cancel them with a reason instead.');
END;
CREATE TRIGGER vitals_no_delete BEFORE DELETE ON vitals
BEGIN
  SELECT RAISE(ABORT, 'Vital signs cannot be deleted. Record a corrected set instead.');
END;

-- A signed note is the medico-legal record: its content can never change.
CREATE TRIGGER clinical_notes_signed_locked
BEFORE UPDATE OF patient_id, visit_id, author_id, note_type, subject, body, signed_at, signed_by ON clinical_notes
WHEN OLD.signed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Signed notes are read-only.');
END;

-- Financial history is never deleted either (invariant 10); it is voided.
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices
BEGIN
  SELECT RAISE(ABORT, 'Invoices cannot be deleted. Void them with a reason instead.');
END;
CREATE TRIGGER invoice_items_no_delete BEFORE DELETE ON invoice_items
BEGIN
  SELECT RAISE(ABORT, 'Invoice lines cannot be deleted.');
END;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'Payments cannot be deleted. Void them with a reason instead.');
END;

-- ---------------------------------------------------------------------------
-- 4. Edit conflicts (SW-13, D-08). Every editable record carries a version.
--    The triggers bump it whenever a user-editable column changes; the API
--    only applies an edit when the client sends the version it last saw.
-- ---------------------------------------------------------------------------
ALTER TABLE patients ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE visits ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE appointments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clinical_notes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE services ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER patients_bump_version
AFTER UPDATE OF first_name, last_name, full_name, dob, dob_estimated, age_years, sex, phone, alt_phone, email,
  address_line, city, state, pincode, blood_group, marital_status, occupation, guardian_name, guardian_relation,
  emergency_contact_name, emergency_contact_phone, id_type, id_number, allergies_summary, notes, is_active
ON patients
WHEN NEW.version = OLD.version
BEGIN
  UPDATE patients SET version = OLD.version + 1 WHERE id = OLD.id;
END;

CREATE TRIGGER visits_bump_version
AFTER UPDATE OF visit_type, department, doctor_id, status, chief_complaint, closed_at, follow_up_date,
  outcome, discharge_summary
ON visits
WHEN NEW.version = OLD.version
BEGIN
  UPDATE visits SET version = OLD.version + 1 WHERE id = OLD.id;
END;

CREATE TRIGGER appointments_bump_version
AFTER UPDATE OF doctor_id, scheduled_at, duration_min, reason, status, visit_id, notes
ON appointments
WHEN NEW.version = OLD.version
BEGIN
  UPDATE appointments SET version = OLD.version + 1 WHERE id = OLD.id;
END;

CREATE TRIGGER clinical_notes_bump_version
AFTER UPDATE OF note_type, subject, body, signed_at, cancelled_at
ON clinical_notes
WHEN NEW.version = OLD.version
BEGIN
  UPDATE clinical_notes SET version = OLD.version + 1 WHERE id = OLD.id;
END;

-- Logins update last_login_at / failed_login_count; those must not count as
-- an edit of the account, so only the profile columns are watched.
CREATE TRIGGER users_bump_version
AFTER UPDATE OF full_name, role, designation, specialty, registration_no, phone, is_active
ON users
WHEN NEW.version = OLD.version
BEGIN
  UPDATE users SET version = OLD.version + 1 WHERE id = OLD.id;
END;

CREATE TRIGGER services_bump_version
AFTER UPDATE OF code, name, category, price_paise, is_active
ON services
WHEN NEW.version = OLD.version
BEGIN
  UPDATE services SET version = OLD.version + 1 WHERE id = OLD.id;
END;

-- D-07: the idle timeout is 30 minutes. Older demo databases stored the
-- previous default of 20; an administrator's own choice is left alone.
UPDATE settings SET value = '30' WHERE key = 'session_idle_minutes' AND value = '20';

-- Hospital settings are key/value rows, so they share one version counter.
INSERT INTO app_meta (key, value, updated_at)
VALUES ('settings_version', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO NOTHING;
