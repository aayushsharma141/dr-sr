-- ===========================================================================
-- Kalyan Hospital - SQLite schema (v1)
-- All timestamps are ISO-8601 UTC strings ("2026-11-09T08:15:00.000Z").
-- Money is stored as INTEGER paise (1 INR = 100 paise) to avoid float drift.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Internal key/value state (never exposed to the API as-is)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Hospital settings (admin editable, non-secret)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Users, roles, sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT NOT NULL UNIQUE,          -- stored lowercase
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin','doctor','nurse','reception')),
  password_hash        TEXT NOT NULL,                 -- scrypt$N$r$p$salt$hash
  designation          TEXT,
  specialty            TEXT,
  registration_no      TEXT,
  phone                TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count   INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  password_changed_at  TEXT,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Sessions are stored by SHA-256 of the bearer token, so a stolen database
-- copy cannot be replayed as a live session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  mrn                     TEXT NOT NULL UNIQUE,        -- e.g. KH-000123
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL DEFAULT '',
  full_name               TEXT NOT NULL,               -- denormalised for search
  dob                     TEXT,                        -- YYYY-MM-DD
  dob_estimated           INTEGER NOT NULL DEFAULT 0,
  age_years               INTEGER,                     -- used when DOB unknown
  sex                     TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (sex IN ('male','female','other','unknown')),
  phone                   TEXT,
  alt_phone               TEXT,
  email                   TEXT,
  address_line            TEXT,
  city                    TEXT,
  state                   TEXT,
  pincode                 TEXT,
  blood_group             TEXT,
  marital_status          TEXT,
  occupation              TEXT,
  guardian_name           TEXT,
  guardian_relation       TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  id_type                 TEXT,
  id_number               TEXT,
  allergies_summary       TEXT,
  notes                   TEXT,
  is_active               INTEGER NOT NULL DEFAULT 1,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_active ON patients(is_active);

CREATE TABLE IF NOT EXISTS patient_allergies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  substance   TEXT NOT NULL,
  reaction    TEXT,
  severity    TEXT NOT NULL DEFAULT 'moderate'
                CHECK (severity IN ('mild','moderate','severe','life_threatening')),
  is_active   INTEGER NOT NULL DEFAULT 1,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_allergies_patient ON patient_allergies(patient_id);

CREATE TABLE IF NOT EXISTS patient_conditions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  condition   TEXT NOT NULL,
  since_date  TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','resolved','in_remission')),
  notes       TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conditions_patient ON patient_conditions(patient_id);

-- ---------------------------------------------------------------------------
-- Visits / encounters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visits (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_no         TEXT NOT NULL UNIQUE,
  patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_type       TEXT NOT NULL DEFAULT 'opd'
                     CHECK (visit_type IN ('opd','ipd','emergency','follow_up','teleconsult')),
  department       TEXT,
  doctor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','closed','cancelled')),
  chief_complaint  TEXT,
  scheduled_at     TEXT,
  checked_in_at    TEXT,
  seen_at          TEXT,
  closed_at        TEXT,
  follow_up_date   TEXT,
  outcome          TEXT,
  discharge_summary TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_doctor  ON visits(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status  ON visits(status);

CREATE TABLE IF NOT EXISTS vitals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id    INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  temperature_c   REAL,
  pulse_bpm       INTEGER,
  resp_rate       INTEGER,
  bp_systolic     INTEGER,
  bp_diastolic    INTEGER,
  spo2            INTEGER,
  weight_kg       REAL,
  height_cm       REAL,
  pain_score      INTEGER,
  notes           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vitals_patient ON vitals(patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_visit   ON vitals(visit_id);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id    INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note_type   TEXT NOT NULL DEFAULT 'progress'
                CHECK (note_type IN ('consultation','progress','nursing','procedure','discharge','other')),
  subject     TEXT,
  body        TEXT NOT NULL,
  signed_at   TEXT,                    -- once signed the note becomes read-only
  signed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_patient ON clinical_notes(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_visit   ON clinical_notes(visit_id);

CREATE TABLE IF NOT EXISTS diagnoses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id    INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  code        TEXT,                    -- ICD-10 code (free text)
  description TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'primary'
                CHECK (kind IN ('primary','secondary','provisional')),
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnoses_patient ON diagnoses(patient_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_visit   ON diagnoses(visit_id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id      INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  drug_name     TEXT NOT NULL,
  strength      TEXT,
  form          TEXT,                  -- tablet / syrup / injection ...
  dose          TEXT,                  -- e.g. "1 tab"
  route         TEXT,                  -- oral / IV / IM ...
  frequency     TEXT,                  -- e.g. "1-0-1", "BD"
  duration_days INTEGER,
  instructions  TEXT,
  prescribed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rx_visit   ON prescriptions(visit_id);

-- ---------------------------------------------------------------------------
-- Attachments (scans, lab reports, consent forms). Ciphertext on disk.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id      INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  category      TEXT NOT NULL DEFAULT 'other'
                  CHECK (category IN ('lab','imaging','consent','referral','insurance','other')),
  title         TEXT,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL UNIQUE,  -- random name inside data/uploads
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,         -- hash of the *plaintext* for integrity
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  deleted_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_patient ON attachments(patient_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 15,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','arrived','completed','cancelled','no_show')),
  visit_id     INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appts_when ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appts_patient ON appointments(patient_id);

-- ---------------------------------------------------------------------------
-- Billing (service catalogue, invoices, payments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT,
  price_paise INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no    TEXT NOT NULL UNIQUE,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id      INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','partially_paid','paid','void')),
  subtotal_paise   INTEGER NOT NULL DEFAULT 0,
  discount_paise   INTEGER NOT NULL DEFAULT 0,
  tax_paise        INTEGER NOT NULL DEFAULT 0,
  total_paise      INTEGER NOT NULL DEFAULT 0,
  paid_paise       INTEGER NOT NULL DEFAULT 0,
  balance_paise    INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  voided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at     TEXT,
  void_reason   TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);

CREATE TABLE IF NOT EXISTS invoice_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_id       INTEGER REFERENCES services(id) ON DELETE SET NULL,
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no    TEXT NOT NULL UNIQUE,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  amount_paise  INTEGER NOT NULL,
  method        TEXT NOT NULL DEFAULT 'cash'
                  CHECK (method IN ('cash','card','upi','netbanking','cheque','insurance','waived')),
  reference     TEXT,
  note          TEXT,
  received_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  is_void       INTEGER NOT NULL DEFAULT 0,
  voided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at     TEXT,
  void_reason   TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_when ON payments(received_at);

-- ---------------------------------------------------------------------------
-- Tamper-evident audit log.
-- hash = sha256 over the row's canonical fields plus the previous row's hash,
-- forming a chain. Any edit/delete of an earlier row breaks verification.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  actor_id      INTEGER,
  actor_name    TEXT,
  actor_role    TEXT,
  action        TEXT NOT NULL,          -- e.g. patient.view, invoice.create
  entity_type   TEXT,
  entity_id     TEXT,
  patient_id    INTEGER,
  ip            TEXT,
  user_agent    TEXT,
  detail_json   TEXT,
  prev_hash     TEXT NOT NULL,
  hash          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at      ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_log(patient_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action, at DESC);

-- ---------------------------------------------------------------------------
-- Backups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL DEFAULT 'manual'
                CHECK (kind IN ('manual','scheduled','pre_restore')),
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  encrypted   INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed','missing')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_at ON backups(created_at DESC);
