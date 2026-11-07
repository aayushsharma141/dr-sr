"""Patient spreadsheet import staging and execution service (D-20-08 to D-20-14).

Guarantees:
- Encoding sniffing: handles UTF-8, UTF-8-BOM (utf-8-sig), Windows-1252.
- Formats supported: CSV and XLSX (via openpyxl).
- Required field validation without inventing placeholder values (D-20-10).
- Duplicate candidate detection against existing patients (D-20-13).
- Existing hospital patients are NEVER updated or overwritten (D-20-13).
- Pre-commit safety backup gate: aborts commit if backup fails (D-20-12).
- Gap-free URN allocation: urn_service is invoked strictly for committed rows (D-20-09, D-20-11).
- Error records export for invalid or skipped rows.
"""

from __future__ import annotations

import csv
import difflib
import io
import re
import uuid
from datetime import date, datetime
from typing import Any

from openpyxl import load_workbook
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings, get_settings
from kalyan_api.models import Patient, PatientImportBatch, PatientImportRow
from kalyan_api.services import backup_service, urn_service

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB

CANONICAL_FIELDS = [
    "full_name",
    "guardian_name",
    "gender",
    "age_years",
    "dob",
    "mobile",
    "address",
    "district",
    "state",
    "emergency_contact",
    "legacy_urn",
]

HEADER_ALIASES: dict[str, list[str]] = {
    "full_name": [
        "full_name",
        "fullname",
        "patient_name",
        "patient name",
        "name",
        "patient",
        "नाम",
        "मरीज़ का नाम",
        "मरीज का नाम",
        "रोगी का नाम",
    ],
    "guardian_name": [
        "guardian_name",
        "guardian",
        "father_name",
        "father name",
        "husband_name",
        "husband name",
        "parent",
        "father",
        "husband",
        "अभिभावक",
        "पिता का नाम",
        "पति का नाम",
        "पिता/पति",
    ],
    "gender": ["gender", "sex", "लिंग"],
    "age_years": ["age", "age_years", "age (years)", "उम्र", "आयु", "वय"],
    "dob": ["dob", "date_of_birth", "birth_date", "birthdate", "जन्म तिथि", "जन्म तारीख"],
    "mobile": [
        "mobile",
        "mobile_no",
        "mobile number",
        "phone",
        "phone_number",
        "contact",
        "संपर्क",
        "मोबाइल",
        "फोन",
    ],
    "address": [
        "address",
        "residential_address",
        "village",
        "town",
        "city",
        "पता",
        "गाँव",
        "गांव",
        "निवास",
    ],
    "district": ["district", "जिला"],
    "state": ["state", "राज्य"],
    "emergency_contact": [
        "emergency_contact",
        "emergency_phone",
        "alt_phone",
        "alternate_mobile",
        "आपातकालीन संपर्क",
    ],
    "legacy_urn": [
        "legacy_urn",
        "old_urn",
        "old_id",
        "old_number",
        "registration_no",
        "reg_no",
        "old_reg_no",
        "पुराना नंबर",
        "पुराना यूआरएन",
    ],
}


class ImportServiceError(Exception):
    """Base exception for import operations."""


class PreCommitBackupFailedError(ImportServiceError):
    """Raised when pre-commit automated backup fails (D-20-12)."""


class BatchNotFoundError(ImportServiceError):
    """Raised when import batch cannot be found."""


class BatchStateError(ImportServiceError):
    """Raised when batch is in invalid state for requested operation."""


def detect_csv_encoding(file_bytes: bytes) -> str:
    """Detect CSV encoding: check UTF-8 BOM, plain UTF-8, then Windows-1252."""
    if file_bytes.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    try:
        file_bytes.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "windows-1252"


def sniff_csv_delimiter(text_sample: str) -> str:
    """Sniff CSV delimiter (comma, semicolon, tab, pipe), falling back to comma."""
    if not text_sample.strip():
        return ","
    try:
        sniffer = csv.Sniffer()
        dialect = sniffer.sniff(text_sample, delimiters=[",", ";", "\t", "|"])
        return dialect.delimiter
    except Exception:
        first_line = text_sample.splitlines()[0] if text_sample.splitlines() else ""
        for delim in [",", "\t", ";", "|"]:
            if delim in first_line:
                return delim
        return ","


def match_header_to_field(header_name: str) -> str | None:
    """Attempt fuzzy/alias matching of file header string to canonical patient field."""
    norm = header_name.strip().lower().replace("_", " ").replace("-", " ")
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            alias_norm = alias.strip().lower().replace("_", " ").replace("-", " ")
            if norm == alias_norm or norm == alias.lower():
                return field
    return None


def inspect_file(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """Inspect CSV or XLSX spreadsheet: detect encoding, delimiter, headers, and preview rows."""
    if len(file_bytes) > MAX_FILE_BYTES:
        raise ImportServiceError(f"File size exceeds maximum allowed 10 MB limit ({len(file_bytes)} bytes)")

    lower_name = filename.lower()
    is_xlsx = lower_name.endswith(".xlsx") or lower_name.endswith(".xls")
    is_csv = lower_name.endswith(".csv") or lower_name.endswith(".tsv")

    if not is_xlsx and not is_csv:
        raise ImportServiceError("Unsupported file type. Please upload a .csv or .xlsx file.")

    headers: list[str] = []
    sample_rows: list[dict[str, Any]] = []
    total_rows = 0
    encoding: str | None = None
    delimiter: str | None = None

    if is_csv:
        encoding = detect_csv_encoding(file_bytes)
        try:
            text_content = file_bytes.decode(encoding)
        except Exception as e:
            raise ImportServiceError(f"Could not decode CSV with detected encoding {encoding}: {e}") from e

        sample_lines = "\n".join(text_content.splitlines()[:10])
        delimiter = sniff_csv_delimiter(sample_lines)

        reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)
        raw_rows = list(reader)
        if not raw_rows:
            raise ImportServiceError("Spreadsheet file contains no rows.")

        headers = [str(col).strip() for col in raw_rows[0]]
        data_rows = raw_rows[1:]
        # Filter out trailing completely blank rows
        filtered_rows = [row for row in data_rows if any(str(cell).strip() for cell in row)]
        total_rows = len(filtered_rows)

        for row in filtered_rows[:5]:
            row_dict: dict[str, Any] = {}
            for idx, h in enumerate(headers):
                val = row[idx].strip() if idx < len(row) else ""
                row_dict[h] = val
            sample_rows.append(row_dict)

    else:
        # XLSX parsing
        encoding = "utf-8"
        delimiter = "N/A"
        try:
            wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
            ws = wb.active
            if ws is None:
                raise ImportServiceError("Workbook contains no active sheets.")
            row_iter = ws.iter_rows(values_only=True)
            first_row = next(row_iter, None)
            if not first_row:
                raise ImportServiceError("Spreadsheet file contains no rows.")

            headers = [str(c).strip() if c is not None else f"Column_{i+1}" for i, c in enumerate(first_row)]
            all_data: list[list[Any]] = []
            for row_vals in row_iter:
                if any(v is not None and str(v).strip() != "" for v in row_vals):
                    all_data.append(list(row_vals))

            total_rows = len(all_data)
            for row_vals in all_data[:5]:
                row_dict = {}
                for idx, h in enumerate(headers):
                    val = row_vals[idx] if idx < len(row_vals) else ""
                    row_dict[h] = str(val).strip() if val is not None else ""
                sample_rows.append(row_dict)
            wb.close()
        except Exception as e:
            if isinstance(e, ImportServiceError):
                raise
            raise ImportServiceError(f"Could not parse Excel spreadsheet: {e}") from e

    # Generate suggested mapping
    suggested_mapping: dict[str, str] = {}
    for h in headers:
        matched = match_header_to_field(h)
        if matched and matched not in suggested_mapping.values():
            suggested_mapping[h] = matched

    return {
        "filename": filename,
        "file_type": "xlsx" if is_xlsx else "csv",
        "encoding": encoding,
        "delimiter": delimiter,
        "total_rows": total_rows,
        "headers": headers,
        "sample_rows": sample_rows,
        "suggested_mapping": suggested_mapping,
        "canonical_fields": CANONICAL_FIELDS,
    }


def parse_all_rows(file_bytes: bytes, filename: str) -> tuple[list[str], list[dict[str, str]]]:
    """Parse entire spreadsheet file into headers and list of string dictionaries."""
    lower_name = filename.lower()
    is_xlsx = lower_name.endswith(".xlsx") or lower_name.endswith(".xls")

    if not is_xlsx:
        encoding = detect_csv_encoding(file_bytes)
        text_content = file_bytes.decode(encoding)
        sample_lines = "\n".join(text_content.splitlines()[:10])
        delimiter = sniff_csv_delimiter(sample_lines)

        reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)
        raw_rows = list(reader)
        if not raw_rows:
            return [], []

        headers = [str(col).strip() for col in raw_rows[0]]
        parsed_rows: list[dict[str, str]] = []
        for r in raw_rows[1:]:
            if not any(str(cell).strip() for cell in r):
                continue
            row_dict: dict[str, str] = {}
            for idx, h in enumerate(headers):
                val = r[idx].strip() if idx < len(r) else ""
                row_dict[h] = val
            parsed_rows.append(row_dict)
        return headers, parsed_rows

    wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active
    if ws is None:
        return [], []

    row_iter = ws.iter_rows(values_only=True)
    first_row = next(row_iter, None)
    if not first_row:
        return [], []

    headers = [str(c).strip() if c is not None else f"Column_{i+1}" for i, c in enumerate(first_row)]
    parsed_rows = []
    for row_vals in row_iter:
        if not any(v is not None and str(v).strip() != "" for v in row_vals):
            continue
        row_dict = {}
        for idx, h in enumerate(headers):
            val = row_vals[idx] if idx < len(row_vals) else ""
            row_dict[h] = str(val).strip() if val is not None else ""
        parsed_rows.append(row_dict)
    wb.close()
    return headers, parsed_rows


def stage_batch(
    session: Session,
    user_id: int,
    filename: str,
    file_bytes: bytes,
    column_mapping: dict[str, str],
) -> PatientImportBatch:
    """Stage parsed rows into patient_import_batches and patient_import_rows."""
    headers, raw_rows = parse_all_rows(file_bytes, filename)
    batch_uuid = str(uuid.uuid4())

    batch = PatientImportBatch(
        batch_id=batch_uuid,
        filename=filename,
        total_rows=len(raw_rows),
        valid_rows=0,
        duplicate_rows=0,
        invalid_rows=0,
        committed_rows=0,
        status="STAGED",
        column_mapping=column_mapping,
        created_by_user_id=user_id,
    )
    session.add(batch)
    session.flush()

    # Invert mapping to canonical_field -> file_header
    canonical_to_header: dict[str, str] = {}
    for header, canonical in column_mapping.items():
        if canonical and canonical in CANONICAL_FIELDS:
            canonical_to_header[canonical] = header

    for index, row_data in enumerate(raw_rows, start=1):
        mapped_data: dict[str, str] = {}
        for field in CANONICAL_FIELDS:
            source_header = canonical_to_header.get(field)
            if source_header and source_header in row_data:
                mapped_data[field] = row_data[source_header].strip()
            else:
                mapped_data[field] = ""

        staging_row = PatientImportRow(
            batch_id=batch_uuid,
            row_index=index,
            raw_data=row_data,
            mapped_data=mapped_data,
            validation_status="PENDING",
        )
        session.add(staging_row)

    session.flush()
    return batch


def clean_mobile_number(raw_mobile: str) -> str:
    """Normalize mobile number to 10 digits or return raw digits."""
    digits = re.sub(r"\D", "", raw_mobile)
    if len(digits) == 12 and digits.startswith("91"):
        return digits[-10:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[-10:]
    return digits


def normalize_gender(raw_gender: str) -> str | None:
    """Normalize gender to 'M', 'F', or 'O'."""
    g = raw_gender.strip().upper()
    if g in ("M", "MALE", "MAN", "BOY", "PURUSH", "पुरुष", "पु"):
        return "M"
    if g in ("F", "FEMALE", "WOMAN", "GIRL", "MAHILA", "STRI", "महिला", "स्त्री"):
        return "F"
    if g in ("O", "OTHER", "OTHERS", "TRANSGENDER", "ANYA", "अन्य"):
        return "O"
    return None


def parse_age_and_dob(raw_age: str, raw_dob: str) -> tuple[int | None, date | None]:
    """Parse age (0-150) and/or dob; infer age from dob if age missing."""
    parsed_age: int | None = None
    parsed_dob: date | None = None

    if raw_dob:
        dob_str = raw_dob.strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
            try:
                parsed_dob = datetime.strptime(dob_str, fmt).date()
                break
            except ValueError:
                continue

    if raw_age:
        try:
            val = int(float(raw_age.strip()))
            if 0 <= val <= 150:
                parsed_age = val
        except ValueError:
            parsed_age = None

    if parsed_age is None and parsed_dob is not None:
        today = clock.ist_today()
        calculated_age = today.year - parsed_dob.year - (
            (today.month, today.day) < (parsed_dob.month, parsed_dob.day)
        )
        if 0 <= calculated_age <= 150:
            parsed_age = calculated_age

    return parsed_age, parsed_dob


def validate_batch(session: Session, batch_id: str) -> dict[str, Any]:
    """Validate all rows in batch against hospital invariants and flag duplicate candidates."""
    batch = session.scalar(select(PatientImportBatch).where(PatientImportBatch.batch_id == batch_id))
    if not batch:
        raise BatchNotFoundError(f"Import batch {batch_id} not found")

    if batch.status == "COMMITTED":
        raise BatchStateError(f"Import batch {batch_id} has already been committed")

    rows = session.scalars(
        select(PatientImportRow)
        .where(PatientImportRow.batch_id == batch_id)
        .order_by(PatientImportRow.row_index.asc())
    ).all()

    valid_count = 0
    duplicate_count = 0
    invalid_count = 0

    for row in rows:
        mapped = row.mapped_data or {}
        errors: dict[str, str] = {}

        # 1. Full Name (Required, min 2)
        full_name = mapped.get("full_name", "").strip()
        if not full_name or len(full_name) < 2:
            errors["full_name"] = "Full name must be at least 2 characters."

        # 2. Guardian Name (Required, min 2) (D-20-10)
        guardian_name = mapped.get("guardian_name", "").strip()
        if not guardian_name or len(guardian_name) < 2:
            errors["guardian_name"] = "Guardian name must be at least 2 characters."

        # 3. Gender ('M', 'F', 'O')
        raw_gender = mapped.get("gender", "").strip()
        norm_gender = normalize_gender(raw_gender)
        if not norm_gender:
            errors["gender"] = "Gender must be 'M', 'F', or 'O'."
        else:
            mapped["gender"] = norm_gender

        # 4. Age / DOB
        raw_age = mapped.get("age_years", "")
        raw_dob = mapped.get("dob", "")
        parsed_age, parsed_dob = parse_age_and_dob(raw_age, raw_dob)
        if parsed_age is None:
            errors["age_years"] = "Valid age (0-150) or date of birth is required."
        else:
            mapped["age_years"] = parsed_age
            if parsed_dob:
                mapped["dob"] = parsed_dob.isoformat()

        # 5. Mobile (Required, 10 digits)
        raw_mobile = mapped.get("mobile", "")
        clean_mobile = clean_mobile_number(raw_mobile)
        if len(clean_mobile) != 10:
            errors["mobile"] = "Mobile number must be exactly 10 digits."
        else:
            mapped["mobile"] = clean_mobile

        # 6. Address (Required, min 3 chars)
        address = mapped.get("address", "").strip()
        if not address or len(address) < 3:
            errors["address"] = "Address must be at least 3 characters."

        # 7. Defaults
        mapped["district"] = mapped.get("district", "").strip() or "Bhojpur"
        mapped["state"] = mapped.get("state", "").strip() or "Bihar"
        if mapped.get("emergency_contact"):
            mapped["emergency_contact"] = mapped["emergency_contact"].strip()
        if mapped.get("legacy_urn"):
            mapped["legacy_urn"] = mapped["legacy_urn"].strip()

        row.mapped_data = mapped

        if errors:
            row.validation_status = "INVALID"
            row.validation_errors = errors
            row.duplicate_patient_id = None
            row.duplicate_resolution = None
            invalid_count += 1
            continue

        # Check for duplicate candidates in Patient table (D-20-13)
        # Condition A: exact mobile AND address match
        cand_match = session.scalar(
            select(Patient).where(
                Patient.mobile == clean_mobile,
                func.lower(Patient.address) == address.lower(),
            )
        )

        # Condition B: exact legacy_urn match
        legacy_urn = mapped.get("legacy_urn")
        if not cand_match and legacy_urn:
            cand_match = session.scalar(
                select(Patient).where(
                    or_(Patient.legacy_urn == legacy_urn, Patient.urn == legacy_urn)
                )
            )

        # Condition C: exact mobile AND high name similarity
        if not cand_match:
            mobile_patients = session.scalars(
                select(Patient).where(Patient.mobile == clean_mobile)
            ).all()
            for p in mobile_patients:
                ratio = difflib.SequenceMatcher(
                    None, full_name.lower(), p.full_name.lower()
                ).ratio()
                if ratio >= 0.80 or full_name.lower() == p.full_name.lower():
                    cand_match = p
                    break

        if cand_match:
            row.validation_status = "DUPLICATE"
            row.duplicate_patient_id = cand_match.id
            # Default resolution: SKIP per D-20-13 and UI-SPEC
            row.duplicate_resolution = "SKIP"
            row.validation_errors = {
                "duplicate_reason": f"Matches existing patient {cand_match.urn} ({cand_match.full_name})"
            }
            duplicate_count += 1
        else:
            row.validation_status = "VALID"
            row.duplicate_patient_id = None
            row.duplicate_resolution = None
            row.validation_errors = None
            valid_count += 1

    batch.valid_rows = valid_count
    batch.duplicate_rows = duplicate_count
    batch.invalid_rows = invalid_count
    batch.status = "VALIDATED"
    session.flush()

    return {
        "batch_id": batch_id,
        "total_rows": batch.total_rows,
        "valid_rows": valid_count,
        "duplicate_rows": duplicate_count,
        "invalid_rows": invalid_count,
        "status": batch.status,
    }


def resolve_duplicate(
    session: Session,
    batch_id: str,
    row_id: int,
    resolution: str,
) -> PatientImportRow:
    """Set duplicate resolution for a flagged row ('SKIP' or 'IMPORT_AS_NEW')."""
    if resolution not in ("SKIP", "IMPORT_AS_NEW"):
        raise ValueError("Resolution must be 'SKIP' or 'IMPORT_AS_NEW'")

    row = session.scalar(
        select(PatientImportRow).where(
            PatientImportRow.id == row_id,
            PatientImportRow.batch_id == batch_id,
        )
    )
    if not row:
        raise ImportServiceError(f"Import row {row_id} in batch {batch_id} not found")

    if row.validation_status != "DUPLICATE":
        raise ImportServiceError(f"Row {row_id} is not flagged as a duplicate candidate")

    row.duplicate_resolution = resolution
    session.flush()
    return row


def bulk_resolve_duplicates(
    session: Session,
    batch_id: str,
    resolution: str = "SKIP",
) -> int:
    """Bulk update all duplicate rows in a batch to resolution (default 'SKIP')."""
    if resolution not in ("SKIP", "IMPORT_AS_NEW"):
        raise ValueError("Resolution must be 'SKIP' or 'IMPORT_AS_NEW'")

    rows = session.scalars(
        select(PatientImportRow).where(
            PatientImportRow.batch_id == batch_id,
            PatientImportRow.validation_status == "DUPLICATE",
        )
    ).all()
    for r in rows:
        r.duplicate_resolution = resolution
    session.flush()
    return len(rows)


def commit_batch(
    session: Session,
    user_id: int,
    batch_id: str,
    cfg: Settings | None = None,
) -> dict[str, Any]:
    """Execute pre-commit safety backup, mint gap-free URNs, and commit valid rows to Patient."""
    config = cfg or get_settings()
    batch = session.scalar(
        select(PatientImportBatch)
        .where(PatientImportBatch.batch_id == batch_id)
        .with_for_update(of=PatientImportBatch)
    )
    if not batch:
        raise BatchNotFoundError(f"Import batch {batch_id} not found")

    if batch.status == "COMMITTED":
        raise BatchStateError(f"Import batch {batch_id} has already been committed")

    # Step 1: Pre-commit safety backup gate (D-20-12)
    # If backup fails, abort commit immediately without modifying patients!
    try:
        backup_path = backup_service.create_backup(label="preimport", settings=config)
        batch.safety_backup_file = backup_path.name
    except Exception as exc:
        raise PreCommitBackupFailedError(f"Pre-commit safety backup failed: {exc}") from exc

    # Step 2: Query rows to commit: VALID rows, or DUPLICATE rows with resolution IMPORT_AS_NEW
    rows_to_commit = session.scalars(
        select(PatientImportRow)
        .where(
            PatientImportRow.batch_id == batch_id,
            or_(
                PatientImportRow.validation_status == "VALID",
                (
                    (PatientImportRow.validation_status == "DUPLICATE")
                    & (PatientImportRow.duplicate_resolution == "IMPORT_AS_NEW")
                ),
            ),
        )
        .order_by(PatientImportRow.row_index.asc())
    ).all()

    allocated_urns: list[str] = []

    # Step 3 & 4: Insert patients with gap-free URN allocation
    for row in rows_to_commit:
        # Strictly allocate URN here (D-20-09, D-20-11)
        new_urn = urn_service.allocate_next_urn(session)
        row.allocated_urn = new_urn
        allocated_urns.append(new_urn)

        mapped = row.mapped_data or {}
        raw_dob = mapped.get("dob")
        dob_val: date | None = None
        if raw_dob:
            try:
                dob_val = date.fromisoformat(str(raw_dob))
            except ValueError:
                dob_val = None

        new_patient = Patient(
            urn=new_urn,
            full_name=mapped["full_name"],
            guardian_name=mapped["guardian_name"],
            gender=mapped["gender"],
            age_years=int(mapped["age_years"]),
            dob=dob_val,
            mobile=mapped["mobile"],
            address=mapped["address"],
            district=mapped.get("district") or "Bhojpur",
            state=mapped.get("state") or "Bihar",
            emergency_contact=mapped.get("emergency_contact") or None,
            legacy_urn=mapped.get("legacy_urn") or None,
            allergies="None reported",
            notes=f"Imported via batch {batch.batch_id} ({batch.filename})",
        )
        session.add(new_patient)

    committed_count = len(rows_to_commit)
    batch.committed_rows = committed_count
    batch.status = "COMMITTED"
    batch.committed_at = clock.utcnow()
    session.flush()

    urn_range_start = allocated_urns[0] if allocated_urns else None
    urn_range_end = allocated_urns[-1] if allocated_urns else None

    return {
        "batch_id": batch_id,
        "status": "COMMITTED",
        "committed_rows": committed_count,
        "safety_backup_file": batch.safety_backup_file,
        "urn_range_start": urn_range_start,
        "urn_range_end": urn_range_end,
    }


def sanitize_formula(val: Any) -> str:
    """Neutralize spreadsheet formula injection by prepending a single quote."""
    s = str(val) if val is not None else ""
    if s and s[0] in ("=", "+", "-", "@"):
        return "'" + s
    return s


def export_error_records_csv(session: Session, batch_id: str) -> str:
    """Generate CSV string containing invalid and skipped rows with reasons for offline correction."""
    batch = session.scalar(select(PatientImportBatch).where(PatientImportBatch.batch_id == batch_id))
    if not batch:
        raise BatchNotFoundError(f"Import batch {batch_id} not found")

    rows = session.scalars(
        select(PatientImportRow)
        .where(
            PatientImportRow.batch_id == batch_id,
            or_(
                PatientImportRow.validation_status == "INVALID",
                (
                    (PatientImportRow.validation_status == "DUPLICATE")
                    & (
                        (PatientImportRow.duplicate_resolution == "SKIP")
                        | (PatientImportRow.duplicate_resolution.is_(None))
                    )
                ),
            ),
        )
        .order_by(PatientImportRow.row_index.asc())
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(
        [
            "Row Number",
            "Full Name",
            "Guardian Name",
            "Gender",
            "Age",
            "Mobile",
            "Address",
            "Legacy URN",
            "Status",
            "Error Details / Reason",
        ]
    )

    for r in rows:
        mapped = r.mapped_data or {}
        reason = ""
        if r.validation_status == "INVALID":
            err_dict = r.validation_errors or {}
            if isinstance(err_dict, dict):
                reason = "; ".join(f"{k}: {v}" for k, v in err_dict.items())
            else:
                reason = str(err_dict)
        elif r.validation_status == "DUPLICATE":
            reason = "Duplicate record skipped (matches existing patient)"

        writer.writerow(
            [
                r.row_index,
                sanitize_formula(mapped.get("full_name", "")),
                sanitize_formula(mapped.get("guardian_name", "")),
                sanitize_formula(mapped.get("gender", "")),
                sanitize_formula(mapped.get("age_years", "")),
                sanitize_formula(mapped.get("mobile", "")),
                sanitize_formula(mapped.get("address", "")),
                sanitize_formula(mapped.get("legacy_urn", "")),
                r.validation_status,
                sanitize_formula(reason),
            ]
        )

    return output.getvalue()
