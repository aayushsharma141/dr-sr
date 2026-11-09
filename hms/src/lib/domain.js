'use strict';

/** Small domain helpers shared by several route modules. */

/** Today's date as YYYY-MM-DD in the server's local timezone. */
function todayLocal(d = new Date()) {
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}

function ageFromDob(dob, onDate = new Date()) {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  let age = onDate.getUTCFullYear() - d.getUTCFullYear();
  const m = onDate.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && onDate.getUTCDate() < d.getUTCDate())) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

function displayAge(dob, ageYears) {
  const years = dob ? ageFromDob(dob) : ageYears;
  if (years === null || years === undefined) return '—';
  return `${years} y`;
}

function mapPatient(row) {
  if (!row) return null;
  const age = row.dob ? ageFromDob(row.dob) : row.age_years;
  return {
    id: row.id,
    mrn: row.mrn,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    dob: row.dob,
    dobEstimated: !!row.dob_estimated,
    age,
    sex: row.sex,
    phone: row.phone,
    altPhone: row.alt_phone,
    email: row.email,
    addressLine: row.address_line,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    bloodGroup: row.blood_group,
    maritalStatus: row.marital_status,
    occupation: row.occupation,
    guardianName: row.guardian_name,
    guardianRelation: row.guardian_relation,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    idType: row.id_type,
    idNumber: row.id_number,
    allergiesSummary: row.allergies_summary,
    notes: row.notes,
    isActive: !!row.is_active,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserBrief(row) {
  if (!row) return null;
  return { id: row.id, fullName: row.full_name, role: row.role };
}

function money(paise) {
  return Number(paise || 0) / 100;
}

module.exports = { ageFromDob, displayAge, mapPatient, mapUserBrief, money, todayLocal };
