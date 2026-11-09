#!/usr/bin/env node
'use strict';

/**
 * Seed the database with SYNTHETIC test data.
 *
 *  - Every patient, address, phone number and clinical detail below is invented.
 *  - Nothing in this file was derived from a real person. Names are common
 *    placeholders, phone numbers all start with 98/99 and are not assigned to
 *    any real subscriber in this pattern, and clinical narratives are generic.
 *  - The installation is flagged `synthetic_data = true` so the UI shows a
 *    permanent banner reminding staff this is not live patient data.
 *
 * Usage:
 *   npm run seed            # add synthetic data to an existing database
 *   npm run seed:reset      # wipe the database first (asks for --yes)
 */

require('../src/lib/env').loadEnv();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { loadOrCreateKey, encryptBuffer, sha256hex, hashPassword } = require('../src/lib/crypto');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const assumeYes = args.includes('--yes');
const QUIET = args.includes('--quiet');

// ---------------------------------------------------------------------------
// Deterministic pseudo-random source, so every seed run looks the same.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261109);
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const between = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const daysAgo = (days, hour = 10, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

// ---------------------------------------------------------------------------
// Synthetic people (all invented)
// ---------------------------------------------------------------------------
const FIRST_F = ['Sunita', 'Rinki', 'Priyanka', 'Puja', 'Anita', 'Neha', 'Khushboo', 'Sarita', 'Mamta', 'Rekha',
  'Kiran', 'Nisha', 'Shweta', 'Archana', 'Babita', 'Sangeeta', 'Pinki', 'Manju', 'Ritu', 'Soni'];
const FIRST_M = ['Ramesh', 'Suresh', 'Rajesh', 'Manoj', 'Sanjay', 'Ajay', 'Vikash', 'Rakesh', 'Pankaj', 'Amit',
  'Sunil', 'Dinesh', 'Rahul', 'Abhishek', 'Santosh', 'Mukesh', 'Ravi', 'Ashok', 'Umesh', 'Pramod'];
const LAST = ['Kumar', 'Singh', 'Yadav', 'Prasad', 'Sharma', 'Mishra', 'Pandey', 'Tiwari', 'Gupta', 'Sinha',
  'Verma', 'Ojha', 'Choudhary', 'Rai', 'Mahto', 'Shah', 'Srivastava', 'Upadhyay', 'Ram', 'Pathak'];
// Towns and localities of Bhojpur district, used only as synthetic addresses.
const CITIES = ['Ara', 'Jagdishpur', 'Piro', 'Bihiya', 'Koilwar', 'Sandesh', 'Udwant Nagar', 'Garhani', 'Shahpur', 'Tarari'];
const LOCALITIES = ['Station Road', 'Gandhi Chowk', 'Nawada', 'Mahila College Road', 'Jail Road', 'Katira', 'Chandwa', 'Anaith'];
const OCCUPATIONS = ['Teacher', 'Shopkeeper', 'Farmer', 'Homemaker', 'Student', 'Retired', 'Driver', 'Tailor',
  'Clerk', 'Mason', 'Labourer', 'Engineer'];

// Synthetic clinical content for the hospital's two departments.
const CLINICAL = {
  Physiotherapy: {
    complaints: [
      'Low back pain radiating to left leg', 'Neck pain and stiffness for 2 weeks', 'Right knee pain on climbing stairs',
      'Frozen shoulder, unable to raise arm', 'Heel pain on first steps in the morning', 'Right-sided weakness after stroke (rehabilitation)',
      'Stiffness after plaster removal, left wrist', 'Pain on outer elbow while gripping',
    ],
    exam: [
      'Paraspinal spasm at L4-L5. Straight leg raise positive at 45 degrees on the left.',
      'Restricted cervical rotation both sides. Trapezius tender. No neurological deficit.',
      'Crepitus over right knee. Quadriceps weak (grade 4). Mild effusion.',
      'Shoulder abduction limited to 70 degrees, external rotation markedly reduced.',
      'Tenderness at medial calcaneal tubercle. Windlass test positive.',
      'Right hemiparesis, power 3/5 upper limb, 4/5 lower limb. Walks with support.',
    ],
    plan: [
      'IFT and hot pack for 10 sessions; core strengthening exercises taught.',
      'Cervical isometric exercises and posture correction; review after 6 sessions.',
      'Quadriceps strengthening and ultrasound therapy; home exercise programme given.',
      'Mobilisation and pendulum exercises; package of 12 sessions advised.',
      'Calf stretching, ice massage and footwear advice; review in 2 weeks.',
      'Gait training and task-oriented exercises; continue daily sessions.',
    ],
    diagnoses: [
      ['M54.5', 'Low back pain'], ['M54.2', 'Cervicalgia'], ['M17.9', 'Osteoarthritis of knee'],
      ['M75.0', 'Adhesive capsulitis of shoulder'], ['M72.2', 'Plantar fasciitis'],
      ['I69.3', 'Sequelae of cerebral infarction'], ['M77.1', 'Lateral epicondylitis'], ['M25.63', 'Stiffness of wrist'],
    ],
    drugs: [
      ['Paracetamol', '650 mg', 'tablet', '1 tablet', 'oral', '1-1-1', 3, 'After food'],
      ['Aceclofenac', '100 mg', 'tablet', '1 tablet', 'oral', '1-0-1', 5, 'After food'],
      ['Thiocolchicoside', '4 mg', 'tablet', '1 tablet', 'oral', '1-0-1', 5, 'After food'],
      ['Diclofenac gel', '1%', 'ointment', 'thin layer', 'topical', '2-3 times', 7, 'Apply on affected area'],
      ['Calcium + Vitamin D3', '500 mg / 250 IU', 'tablet', '1 tablet', 'oral', '0-1-0', 30, 'After lunch'],
    ],
  },
  Ophthalmology: {
    complaints: [
      'Blurred vision for distance', 'Redness and watering of both eyes', 'Difficulty reading small print',
      'Gradual dimness of vision, left eye', 'Itching in both eyes', 'Foreign body sensation, right eye',
    ],
    exam: [
      'Visual acuity 6/18 both eyes, improving to 6/6 with pinhole. Anterior segment normal.',
      'Conjunctival congestion with watery discharge. Cornea clear. Pupils reacting.',
      'Lens opacity grade 2, left eye. Fundus view hazy.',
      'Near vision N10 both eyes. Distance vision 6/6.',
      'Papillary reaction in upper tarsal conjunctiva. Cornea clear.',
    ],
    plan: [
      'Refraction done; spectacles prescribed. Review in 6 months.',
      'Topical antibiotic drops; review in 5 days.',
      'Advised evaluation for cataract surgery.',
      'Reading glasses prescribed.',
      'Anti-allergic drops and cold compresses; avoid rubbing eyes.',
    ],
    diagnoses: [
      ['H52.1', 'Myopia'], ['H52.4', 'Presbyopia'], ['H10.3', 'Acute conjunctivitis'],
      ['H25.9', 'Senile cataract'], ['H10.1', 'Allergic conjunctivitis'], ['T15.1', 'Foreign body in conjunctival sac'],
    ],
    drugs: [
      ['Moxifloxacin eye drops', '0.5%', 'eye drops', '1 drop', 'topical (eye)', '4 times a day', 5, 'Both eyes'],
      ['Carboxymethylcellulose eye drops', '0.5%', 'eye drops', '1 drop', 'topical (eye)', '3 times a day', 30, 'Both eyes'],
      ['Olopatadine eye drops', '0.1%', 'eye drops', '1 drop', 'topical (eye)', 'twice a day', 14, 'Both eyes'],
    ],
  },
};

// Demo price list only. A real installation starts with an empty catalogue and
// the administrator enters Kalyan's actual fees.
const DEMO_SERVICES = [
  ['CONS-PT', 'Physiotherapy consultation', 'Consultation', 30000],
  ['CONS-PT-FUP', 'Physiotherapy follow-up consultation', 'Consultation', 20000],
  ['CONS-EYE', 'Eye consultation', 'Consultation', 30000],
  ['CONS-EYE-FUP', 'Eye follow-up consultation', 'Consultation', 20000],
  ['PT-SESSION', 'Physiotherapy session', 'Physiotherapy', 20000],
  ['PT-IFT', 'Interferential therapy (IFT)', 'Physiotherapy', 15000],
  ['PT-HOTPACK', 'Hot pack', 'Physiotherapy', 10000],
  ['EYE-REFRACTION', 'Refraction', 'Eye', 15000],
  ['EYE-IOP', 'Intraocular pressure check', 'Eye', 10000],
  ['ADM-REG', 'Registration card', 'Administrative', 5000],
];
const EXTRA_SERVICES = {
  Physiotherapy: ['PT-SESSION', 'PT-IFT', 'PT-HOTPACK'],
  Ophthalmology: ['EYE-REFRACTION', 'EYE-IOP'],
};
const CONSULT_SERVICE = {
  Physiotherapy: { first: 'CONS-PT', followUp: 'CONS-PT-FUP' },
  Ophthalmology: { first: 'CONS-EYE', followUp: 'CONS-EYE-FUP' },
};

const ALLERGENS = [
  ['Penicillin', 'Rash over trunk', 'severe'],
  ['Sulfa drugs', 'Itching and urticaria', 'moderate'],
  ['Dust mite', 'Sneezing and wheeze', 'mild'],
  ['Iodinated contrast', 'Facial swelling', 'life_threatening'],
  ['Aspirin', 'Gastric upset', 'moderate'],
];

const CONDITIONS = [
  ['Type 2 diabetes', '2018-06-01', 'active'],
  ['Essential hypertension', '2016-11-15', 'active'],
  ['Hypothyroidism', '2020-02-20', 'active'],
  ['Bronchial asthma', '2010-04-05', 'active'],
  ['Old healed fracture, right radius', '2019-08-11', 'resolved'],
];

const DOCUMENTS = [
  ['lab', 'Vitamin D and calcium report', 'vitamin_d_report.pdf'],
  ['imaging', 'MRI lumbar spine report', 'mri_lumbar_spine.pdf'],
  ['imaging', 'X-ray knee (AP and lateral)', 'xray_knee.pdf'],
  ['other', 'Referral letter - orthopaedics', 'referral_orthopaedics.pdf'],
];

// A tiny but structurally valid PDF, generated on the fly (text only).
function makePdf(title, lines) {
  const escaped = (text) => text.replace(/([()\\])/g, '\\$1');
  const content = [
    'BT',
    '/F1 16 Tf',
    '60 760 Td',
    `(${escaped(title)}) Tj`,
    'ET',
    'BT',
    '/F1 10 Tf',
    '60 735 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? `(${escaped(line)}) Tj` : `0 -16 Td (${escaped(line)}) Tj`,
    ]),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// ---------------------------------------------------------------------------
async function main() {
  if (reset) {
    if (!assumeYes) {
      console.error('\nRefusing to wipe the database without --yes.');
      console.error('Run:  npm run seed:reset   (which passes --yes for you)\n');
      process.exit(1);
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${config.paths.db}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    console.log('Database removed. A fresh one will be created.');
  }

  fs.mkdirSync(config.paths.data, { recursive: true });
  const store = openDatabase();
  const db = store.db;
  const audit = store.audit;
  const attachmentsKey = loadOrCreateKey(config.paths.keys, 'attachments.key');
  fs.mkdirSync(config.paths.uploads, { recursive: true });

  const log = (...parts) => { if (!QUIET) console.log(...parts); };

  if (db.prepare('SELECT COUNT(*) AS n FROM patients').get().n > 0) {
    console.error('\nThis database already contains patient records.');
    console.error('Use `npm run seed:reset` to wipe it and load fresh synthetic data.\n');
    store.close();
    process.exit(1);
  }

  log('\nSeeding synthetic data — no real patient information is used.\n');

  // ---- staff -------------------------------------------------------------
  const DEMO_PASSWORD = 'Kalyan#Clinic2026';
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date().toISOString();

  const staff = [
    // Synthetic staff: two physiotherapists and one eye doctor, as at Kalyan Hospital.
    { username: 'admin', fullName: 'Alok Ranjan', role: 'admin', designation: 'Hospital administrator', specialty: null, reg: null, phone: '9822000100' },
    { username: 'dr.verma', fullName: 'Dr Anil Kumar Verma', role: 'doctor', designation: 'Consultant physiotherapist', specialty: 'Physiotherapy', reg: 'DEMO-PT-01', phone: '9822000101' },
    { username: 'dr.sinha', fullName: 'Dr Pooja Sinha', role: 'doctor', designation: 'Physiotherapist', specialty: 'Physiotherapy', reg: 'DEMO-PT-02', phone: '9822000102' },
    { username: 'dr.ojha', fullName: 'Dr Rakesh Ojha', role: 'doctor', designation: 'Consultant ophthalmologist', specialty: 'Ophthalmology', reg: 'DEMO-EYE-01', phone: '9822000103' },
    { username: 'reception', fullName: 'Kiran Kumari', role: 'reception', designation: 'Front desk', specialty: null, reg: null, phone: '9822000104' },
  ];

  const userIds = {};
  const insertUser = db.prepare(
    `INSERT INTO users (username, full_name, role, password_hash, designation, specialty, registration_no, phone,
       is_active, must_change_password, password_changed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,1,0,?,?,?)`,
  );
  for (const person of staff) {
    const info = insertUser.run(person.username, person.fullName, person.role, passwordHash,
      person.designation, person.specialty, person.reg, person.phone, now, now, now);
    userIds[person.username] = Number(info.lastInsertRowid);
  }
  const doctors = [userIds['dr.verma'], userIds['dr.sinha'], userIds['dr.ojha']];
  // Each doctor works in one department; visits and appointments follow the doctor.
  const roster = staff
    .filter((person) => person.role === 'doctor')
    .map((person) => ({ id: userIds[person.username], department: person.specialty }));
  const pickDoctor = () => pick(roster);
  const clinicalFor = (doctor) => CLINICAL[doctor.department];
  store.setMeta('setup_completed', '1');
  store.setMeta('setup_completed_at', now);
  store.setMeta('bootstrap_code_hash', null);
  store.setMeta('setup_completed_by_seed', '1');
  store.setSetting('synthetic_data', 'true');
  store.setSetting('disclaimer', 'Synthetic demonstration record — not a real patient document.');

  // ---- patients ----------------------------------------------------------
  const patients = [];
  const TOTAL_PATIENTS = 42;
  for (let i = 0; i < TOTAL_PATIENTS; i += 1) {
    const sex = chance(0.52) ? 'female' : 'male';
    const firstName = sex === 'female' ? pick(FIRST_F) : pick(FIRST_M);
    const lastName = pick(LAST);
    const age = chance(0.18) ? between(1, 16) : between(18, 84);
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - age);
    dob.setMonth(between(0, 11), between(1, 28));
    const dobStr = dob.toISOString().slice(0, 10);
    const phone = `9${between(100000000, 999999999)}`;
    const mrn = `KH-${String(store.nextSequence('seq:mrn')).padStart(6, '0')}`;
    const createdAt = daysAgo(between(1, 150), between(9, 18), between(0, 59)).toISOString();

    const info = db
      .prepare(
        `INSERT INTO patients (mrn, first_name, last_name, full_name, dob, dob_estimated, age_years, sex, phone,
           alt_phone, email, address_line, city, state, pincode, blood_group, marital_status, occupation,
           guardian_name, guardian_relation, emergency_contact_name, emergency_contact_phone, id_type, id_number,
           allergies_summary, notes, created_by, updated_by, created_at, updated_at)
         VALUES (?,?,?,?,?,0,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        mrn, firstName, lastName, `${firstName} ${lastName}`, dobStr, sex, phone,
        chance(0.3) ? `9${between(100000000, 999999999)}` : null,
        chance(0.25) ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com` : null,
        `${between(1, 120)}, ${pick(LOCALITIES)}, Ward ${between(1, 45)}`,
        pick(CITIES), 'Bihar', `8023${between(0, 1)}${between(0, 9)}`,
        pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'O-', null, null]),
        age >= 21 ? pick(['Married', 'Single', 'Widowed']) : null,
        pick(OCCUPATIONS),
        chance(0.4) ? `${pick(FIRST_M)} ${lastName}` : null,
        chance(0.4) ? pick(['Spouse', 'Father', 'Mother', 'Son', 'Daughter']) : null,
        chance(0.5) ? `${pick(FIRST_F)} ${lastName}` : null,
        chance(0.5) ? `9${between(100000000, 999999999)}` : null,
        chance(0.3) ? pick(['Aadhaar', 'PAN', 'Driving licence']) : null,
        chance(0.2) ? `${between(1000, 9999)} ${between(1000, 9999)} ${between(1000, 9999)}` : null,
        chance(0.15) ? pick(ALLERGENS)[0] + ' (see chart)' : null,
        chance(0.1) ? 'Prefers afternoon appointments.' : null,
        userIds.reception, userIds.reception, createdAt, createdAt,
      );
    patients.push({ id: Number(info.lastInsertRowid), mrn, fullName: `${firstName} ${lastName}`, dob: dobStr, sex, age, createdAt });
  }
  log(`  ${patients.length} synthetic patients`);

  // ---- allergies & conditions --------------------------------------------
  const allergyStmt = db.prepare(
    'INSERT INTO patient_allergies (patient_id, substance, reaction, severity, recorded_by, created_at) VALUES (?,?,?,?,?,?)',
  );
  const conditionStmt = db.prepare(
    'INSERT INTO patient_conditions (patient_id, condition, since_date, status, recorded_by, created_at) VALUES (?,?,?,?,?,?)',
  );
  for (const patient of patients) {
    if (chance(0.22)) {
      const [substance, reaction, severity] = pick(ALLERGENS);
      allergyStmt.run(patient.id, substance, reaction, severity, pick(doctors), patient.createdAt);
    }
    if (patient.age > 30 && chance(0.45)) {
      const [condition, since, status] = pick(CONDITIONS);
      conditionStmt.run(patient.id, condition, since, status, pick(doctors), patient.createdAt);
    }
  }

  // ---- visits, clinical data ---------------------------------------------
  const visitStmt = db.prepare(
    `INSERT INTO visits (visit_no, patient_id, visit_type, department, doctor_id, status, chief_complaint,
       checked_in_at, seen_at, closed_at, follow_up_date, outcome, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const vitalsStmt = db.prepare(
    `INSERT INTO vitals (patient_id, visit_id, recorded_at, recorded_by, temperature_c, pulse_bpm, resp_rate,
       bp_systolic, bp_diastolic, spo2, weight_kg, height_cm, pain_score, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const noteStmt = db.prepare(
    `INSERT INTO clinical_notes (patient_id, visit_id, author_id, note_type, subject, body, signed_at, signed_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const dxStmt = db.prepare(
    'INSERT INTO diagnoses (patient_id, visit_id, code, description, kind, recorded_by, created_at) VALUES (?,?,?,?,?,?,?)',
  );
  const rxStmt = db.prepare(
    `INSERT INTO prescriptions (patient_id, visit_id, drug_name, strength, form, dose, route, frequency,
       duration_days, instructions, prescribed_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const invoiceStmt = db.prepare(
    `INSERT INTO invoices (invoice_no, patient_id, visit_id, status, subtotal_paise, discount_paise, tax_paise,
       total_paise, paid_paise, balance_paise, notes, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
  );
  const invoiceItemStmt = db.prepare(
    `INSERT INTO invoice_items (invoice_id, service_id, description, qty, unit_price_paise, line_total_paise)
     VALUES (?,?,?,?,?,?)`,
  );
  const paymentStmt = db.prepare(
    `INSERT INTO payments (receipt_no, invoice_id, patient_id, amount_paise, method, reference, note,
       received_by, received_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );

  const insertService = db.prepare(
    'INSERT INTO services (code, name, category, price_paise, is_active, created_at) VALUES (?,?,?,?,1,?)',
  );
  for (const row of DEMO_SERVICES) insertService.run(...row, now);
  const serviceRows = db.prepare('SELECT * FROM services WHERE is_active = 1').all();
  const serviceByCode = Object.fromEntries(serviceRows.map((s) => [s.code, s]));

  let visitCount = 0;
  let documentCount = 0;
  let invoiceCount = 0;

  for (const patient of patients) {
    const visitsForPatient = chance(0.75) ? between(1, 3) : 1;
    for (let v = 0; v < visitsForPatient; v += 1) {
      const daysBack = between(0, 120);
      const when = daysAgo(daysBack, between(9, 18), pick([0, 15, 30, 45]));
      const isToday = daysBack === 0;
      const isOpen = isToday && chance(0.5);
      const doctor = pickDoctor();
      const clinical = clinicalFor(doctor);
      const doctorId = doctor.id;
      const department = doctor.department;
      const visitNo = `V-${String(store.nextSequence('seq:visit')).padStart(6, '0')}`;
      const createdAt = when.toISOString();
      const visitType = pick(['opd', 'opd', 'opd', 'follow_up']);

      const visitInfo = visitStmt.run(
        visitNo, patient.id, visitType, department, doctorId,
        isOpen ? 'open' : 'closed', pick(clinical.complaints), createdAt, isOpen ? null : createdAt,
        isOpen ? null : new Date(when.getTime() + 25 * 60000).toISOString(),
        chance(0.4) ? new Date(when.getTime() + 7 * 86400000).toISOString().slice(0, 10) : null,
        isOpen ? null : pick(['Discharged', 'Follow-up advised', 'Referred']),
        userIds.reception, createdAt, createdAt,
      );
      const visitId = Number(visitInfo.lastInsertRowid);
      visitCount += 1;

      // vitals
      const hasFever = chance(0.3);
      const systolic = between(104, 148);
      vitalsStmt.run(
        patient.id, visitId, createdAt, doctorId,
        hasFever ? Number((37.6 + rand() * 1.6).toFixed(1)) : Number((36.4 + rand() * 0.9).toFixed(1)),
        between(62, 104), between(14, 22), systolic, between(66, 94), between(94, 100),
        Number((patient.age < 18 ? 10 + rand() * 30 : 48 + rand() * 40).toFixed(1)),
        Number((patient.age < 18 ? 80 + rand() * 60 : 148 + rand() * 32).toFixed(1)),
        chance(0.3) ? between(2, 7) : null, null, createdAt,
      );

      // note (signed when the visit is closed)
      const noteBody = [
        pick(clinical.exam),
        pick(clinical.plan),
      ].join('\n\n');
      noteStmt.run(
        patient.id, visitId, doctorId, 'consultation', 'Consultation — ' + department,
        noteBody, isOpen ? null : createdAt, isOpen ? null : doctorId, createdAt, createdAt,
      );

      // diagnoses
      const [code, description] = pick(clinical.diagnoses);
      dxStmt.run(patient.id, visitId, code, description, 'primary', doctorId, createdAt);

      // prescription lines
      const rxCount = between(1, 3);
      const used = new Set();
      for (let r = 0; r < rxCount; r += 1) {
        const drug = pick(clinical.drugs);
        if (used.has(drug[0])) continue;
        used.add(drug[0]);
        rxStmt.run(patient.id, visitId, ...drug, doctorId, createdAt);
      }

      // invoice for most visits
      if (chance(0.85)) {
        const consultCodes = CONSULT_SERVICE[department];
        const consult = serviceByCode[visitType === 'follow_up' ? consultCodes.followUp : consultCodes.first];
        const extra = chance(0.6) ? serviceByCode[pick(EXTRA_SERVICES[department])] : null;
        const items = [{ service: consult, qty: 1 }];
        if (extra) items.push({ service: extra, qty: 1 });
        const subtotal = items.reduce((sum, item) => sum + item.service.price_paise * item.qty, 0);
        const discount = chance(0.15) ? 5000 : 0;
        const total = subtotal - discount;

        const payRoll = rand();
        let paid = total;
        if (payRoll < 0.2) paid = 0;
        else if (payRoll < 0.3) paid = Math.round(total / 2 / 100) * 100;
        const status = paid <= 0 ? 'open' : paid >= total ? 'paid' : 'partially_paid';
        const day = createdAt.slice(0, 10).replace(/-/g, '');
        const invoiceNo = `INV-${day}-${String(store.nextSequence(`seq:invoice:${day}`)).padStart(4, '0')}`;

        const invInfo = invoiceStmt.run(
          invoiceNo, patient.id, visitId, status, subtotal, discount, total, paid, total - paid,
          null, userIds.reception, createdAt, createdAt,
        );
        const invoiceId = Number(invInfo.lastInsertRowid);
        for (const item of items) {
          invoiceItemStmt.run(invoiceId, item.service.id, item.service.name, item.qty,
            item.service.price_paise, item.service.price_paise * item.qty);
        }
        invoiceCount += 1;

        if (paid > 0) {
          const method = pick(['cash', 'cash', 'upi', 'card']);
          const receiptNo = `RCPT-${day}-${String(store.nextSequence(`seq:receipt:${day}`)).padStart(4, '0')}`;
          paymentStmt.run(receiptNo, invoiceId, patient.id, paid, method,
            method === 'cash' ? null : `TXN${between(100000, 999999)}`, null,
            userIds.reception, createdAt, createdAt);
        }
      }

      // documents for a few visits
      if (documentCount < 14 && chance(0.22)) {
        const [category, title, filename] = pick(DOCUMENTS);
        const pdf = makePdf(title, [
          'Kalyan Hospital — synthetic test document',
          `Patient: ${patient.fullName}  (${patient.mrn})`,
          `Visit: ${visitNo}`,
          '',
          'This file was generated by scripts/seed.js for demonstration.',
          'It contains no real clinical information.',
        ]);
        const storedName = `${crypto.randomUUID()}.khc`;
        fs.writeFileSync(path.join(config.paths.uploads, storedName), encryptBuffer(pdf, attachmentsKey), { mode: 0o600 });
        db.prepare(
          `INSERT INTO attachments (patient_id, visit_id, category, title, original_name, stored_name, mime_type,
             size_bytes, sha256, uploaded_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(patient.id, visitId, category, title, filename, storedName, 'application/pdf',
          pdf.length, sha256hex(pdf), userIds.reception, createdAt);
        documentCount += 1;
      }
    }
  }
  log(`  ${visitCount} visits, ${invoiceCount} invoices, ${documentCount} documents`);

  // ---- appointments ------------------------------------------------------
  const apptStmt = db.prepare(
    `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, duration_min, reason, status, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const todayAppts = between(7, 11);
  for (let i = 0; i < todayAppts; i += 1) {
    const patient = pick(patients);
    const at = new Date();
    at.setHours(9 + Math.floor(i * 0.9), chance(0.5) ? 0 : 30, 0, 0);
    const status = i < 2 ? 'completed' : i < 4 ? 'arrived' : 'scheduled';
    const doctor = pickDoctor();
    apptStmt.run(patient.id, doctor.id, at.toISOString(), 15, pick(clinicalFor(doctor).complaints).slice(0, 60),
      status, userIds.reception, now, now);
  }
  for (let i = 0; i < 6; i += 1) {
    const patient = pick(patients);
    const at = new Date();
    at.setDate(at.getDate() + between(1, 6));
    at.setHours(between(9, 17), chance(0.5) ? 0 : 30, 0, 0);
    const doctor = pickDoctor();
    apptStmt.run(patient.id, doctor.id, at.toISOString(), 15, pick(clinicalFor(doctor).complaints).slice(0, 60),
      'scheduled', userIds.reception, now, now);
  }
  log(`  ${todayAppts + 6} appointments bookable from today`);

  // ---- today's live activity (queue, registrations, collections) ---------
  // A busy morning at the front desk makes the demo dashboard realistic and
  // exercises the "patients waiting" queue in the UI.
  let liveVisits = 0;
  for (let i = 0; i < 6; i += 1) {
    const patient = pick(patients);
    const alreadyOpen = db.prepare("SELECT id FROM visits WHERE patient_id = ? AND status = 'open'").get(patient.id);
    if (alreadyOpen) continue;
    const when = new Date();
    when.setHours(9 + i, chance(0.5) ? 0 : 30, 0, 0);
    if (when > new Date()) when.setHours(9, 15, 0, 0);
    const createdAt = when.toISOString();
    const visitNo = `V-${String(store.nextSequence('seq:visit')).padStart(6, '0')}`;
    const doctor = pickDoctor();
    const clinical = clinicalFor(doctor);
    const doctorId = doctor.id;
    const seen = i < 2;
    const info = visitStmt.run(
      visitNo, patient.id, i === 5 ? 'follow_up' : 'opd', doctor.department, doctorId, 'open',
      pick(clinical.complaints), createdAt, seen ? createdAt : null, null, null, null,
      userIds.reception, createdAt, createdAt,
    );
    const visitId = Number(info.lastInsertRowid);
    vitalsStmt.run(
      patient.id, visitId, createdAt, doctorId, Number((36.6 + rand() * 1.8).toFixed(1)),
      between(68, 102), between(15, 21), between(108, 142), between(68, 90), between(95, 99),
      Number((52 + rand() * 30).toFixed(1)), Number((152 + rand() * 26).toFixed(1)),
      chance(0.4) ? between(2, 6) : null, null, createdAt,
    );
    if (seen) {
      noteStmt.run(patient.id, visitId, doctorId, 'consultation', 'Consultation — in progress',
        [pick(clinical.exam), pick(clinical.plan)].join('\n\n'), null, null, createdAt, createdAt);
      const [code, description] = pick(clinical.diagnoses);
      dxStmt.run(patient.id, visitId, code, description, 'provisional', doctorId, createdAt);
      const drug = pick(clinical.drugs);
      rxStmt.run(patient.id, visitId, ...drug, doctorId, createdAt);
    }
    liveVisits += 1;
  }
  log(`  ${liveVisits} patients waiting in today's queue`);

  // A few registrations dated today, and today's collections.
  for (const patient of patients.slice(-3)) {
    const stamp = new Date().toISOString();
    db.prepare('UPDATE patients SET created_at = ?, updated_at = ? WHERE id = ?').run(stamp, stamp, patient.id);
  }
  const openInvoices = db
    .prepare("SELECT * FROM invoices WHERE status IN ('open','partially_paid') ORDER BY id DESC LIMIT 5")
    .all();
  let todayCollected = 0;
  for (const invoice of openInvoices) {
    const amount = Math.max(10000, Math.round(invoice.balance_paise / 2 / 100) * 100);
    const nowStamp = new Date().toISOString();
    const day = nowStamp.slice(0, 10).replace(/-/g, '');
    const receiptNo = `RCPT-${day}-${String(store.nextSequence(`seq:receipt:${day}`)).padStart(4, '0')}`;
    const method = pick(['cash', 'upi', 'card']);
    paymentStmt.run(receiptNo, invoice.id, invoice.patient_id, amount, method,
      method === 'cash' ? null : `TXN${between(100000, 999999)}`, null, userIds.reception, nowStamp, nowStamp);
    db.prepare('UPDATE invoices SET paid_paise = paid_paise + ?, balance_paise = balance_paise - ?, status = ?, updated_at = ? WHERE id = ?')
      .run(amount, amount, invoice.paid_paise + amount >= invoice.total_paise ? 'paid' : 'partially_paid', nowStamp, invoice.id);
    todayCollected += amount;
  }
  log(`  ${openInvoices.length} payments today (${(todayCollected / 100).toFixed(0)} INR)`);

  // ---- audit trail -------------------------------------------------------
  const auditSample = [
    ['setup.complete', 'admin', 'user', userIds.admin, null, { note: 'Synthetic dataset seeded' }],
    ['user.create', 'admin', 'user', userIds['dr.verma'], null, { role: 'doctor' }],
    ['user.create', 'admin', 'user', userIds.reception, null, { role: 'reception' }],
    ['settings.update', 'admin', 'settings', null, null, { keys: ['synthetic_data', 'disclaimer'] }],
    ['backup.create', 'admin', 'backup', 1, null, { kind: 'manual' }],
  ];
  for (const [action, actor, entityType, entityId, patientId, detail] of auditSample) {
    audit.record({
      actorId: userIds[actor] || null,
      actorName: staff.find((s) => s.username === actor)?.fullName || 'System',
      actorRole: 'admin',
      action,
      entityType,
      entityId,
      patientId,
      ip: '127.0.0.1',
      detail,
    });
  }
  for (let i = 0; i < 25; i += 1) {
    const patient = pick(patients);
    const actor = pick(staff.filter((s) => s.role !== 'admin'));
    audit.record({
      actorId: userIds[actor.username],
      actorName: actor.fullName,
      actorRole: actor.role,
      action: pick(['patient.view', 'visit.view', 'invoice.view', 'document.view']),
      entityType: 'patient',
      entityId: patient.id,
      patientId: patient.id,
      ip: '192.168.1.' + between(20, 40),
      detail: { mrn: patient.mrn },
    });
  }

  store.setSetting('hospital_name', 'Kalyan Hospital');

  // Take a real backup so the Backups screen has history from day one.
  try {
    const { createBackup } = require('../src/lib/backup');
    createBackup(
      { db, store, config, keys: { backup: loadOrCreateKey(config.paths.keys, 'backup.key') } },
      { kind: 'manual', actorId: userIds.admin, note: 'Initial backup after synthetic data load' },
    );
    log('  initial encrypted backup written');
  } catch (err) {
    log(`  (backup skipped: ${err.message})`);
  }

  store.close();

  if (!QUIET) {
    console.log('\n' + '='.repeat(66));
    console.log('  SYNTHETIC DATA LOADED — no real patient information exists here');
    console.log('='.repeat(66));
    console.log('\n  Demo sign-in details (all accounts share the same password):\n');
    console.log(`    Password: ${DEMO_PASSWORD}\n`);
    for (const person of staff) {
      console.log(`    ${person.username.padEnd(14)} ${person.role.padEnd(10)} ${person.fullName}`);
    }
    console.log('\n  Start the server with:  npm start');
    console.log('  Then open http://localhost:' + config.port + ' on this computer.');
    console.log('\n  Change these passwords before the clinic uses the system for');
    console.log('  anything, and clear the synthetic dataset first (see docs/).\n');
  }
}

main().catch((err) => {
  console.error('\nSeeding failed:', err.stack || err.message);
  process.exit(1);
});
