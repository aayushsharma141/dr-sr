"""Integration tests for persistent clinical quick phrases (Phase 3 / T3.1)."""

import uuid
from collections.abc import Generator
from typing import Any

import pytest
from sqlalchemy import Engine, delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    ClinicalEncounter,
    ClinicalQuickPhrase,
    Department,
    Patient,
    QuickPhraseScope,
    QuickPhraseSection,
    User,
)
from kalyan_api.routers.quick_phrases import (
    _EXPECTED_DEFAULT_COUNT,
    DEFAULT_GENERAL_PHRASES,
    DEFAULT_OPHTHALMOLOGY_PHRASES,
    DEFAULT_PHYSIO_PHRASES,
    ensure_default_quick_phrases_seeded,
)


@pytest.fixture(autouse=True)
def reset_quick_phrases_seeder_cache() -> Generator[None, None, None]:
    """Ensure in-memory seeder guard does not leak across test cases."""
    import kalyan_api.routers.quick_phrases as qp

    qp._DEFAULTS_SEEDED = False
    yield
    qp._DEFAULTS_SEEDED = False


def _get_or_create_department(session: Session, code: str, name_en: str) -> Department:
    dept = session.scalar(select(Department).where(Department.code == code))
    if dept is None:
        dept = Department(code=code, name_en=name_en, is_active=True)
        session.add(dept)
        session.flush()
    return dept


def _create_patient(session: Session) -> Patient:
    pat = Patient(
        urn=f"KH-2026-QP{uuid.uuid4().hex[:4].upper()}",
        full_name="Quick Phrase Test Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9876543210",
        address="Ara",
        district="Bhojpur",
        state="Bihar",
    )
    session.add(pat)
    session.flush()
    return pat


def test_default_seeding_idempotent_and_specialty_isolated(
    db_session: Session,
    doctor_a_user: User,
    login_client: Any,
) -> None:
    """Physio, Ophth, and General defaults seed idempotently without cross-leaking."""
    physio = _get_or_create_department(db_session, "PHYSIOTHERAPY", "Physiotherapy")
    ophth = _get_or_create_department(db_session, "OPHTHALMOLOGY", "Ophthalmology")
    general = _get_or_create_department(db_session, "GENERAL_MEDICINE", "General Medicine")

    client_a = login_client(doctor_a_user)

    # 1. Physiotherapy returns ONLY Physio defaults (no General leakage)
    res_physio = client_a.get(f"/api/quick-phrases?department_id={physio.id}&section=COMPLAINTS")
    assert res_physio.status_code == 200, res_physio.text
    physio_texts = [p["phrase_text"] for p in res_physio.json()["defaults"]]
    assert physio_texts == list(DEFAULT_PHYSIO_PHRASES)
    for general_phrase in DEFAULT_GENERAL_PHRASES:
        assert general_phrase not in physio_texts

    # 2. Ophthalmology returns ONLY Ophth defaults (no General or Physio leakage)
    res_ophth = client_a.get(f"/api/quick-phrases?department_id={ophth.id}&section=COMPLAINTS")
    assert res_ophth.status_code == 200, res_ophth.text
    ophth_texts = [p["phrase_text"] for p in res_ophth.json()["defaults"]]
    assert ophth_texts == list(DEFAULT_OPHTHALMOLOGY_PHRASES)
    for general_phrase in DEFAULT_GENERAL_PHRASES:
        assert general_phrase not in ophth_texts
    for physio_phrase in DEFAULT_PHYSIO_PHRASES:
        assert physio_phrase not in ophth_texts

    # 3. General department & department_id=None both return General defaults
    res_gen_dept = client_a.get(f"/api/quick-phrases?department_id={general.id}&section=COMPLAINTS")
    assert res_gen_dept.status_code == 200
    assert [p["phrase_text"] for p in res_gen_dept.json()["defaults"]] == list(
        DEFAULT_GENERAL_PHRASES
    )

    res_none = client_a.get("/api/quick-phrases?section=COMPLAINTS")
    assert res_none.status_code == 200
    assert [p["phrase_text"] for p in res_none.json()["defaults"]] == list(DEFAULT_GENERAL_PHRASES)

    # 4. Calling again does not duplicate seeded rows
    count_before = len(
        db_session.scalars(
            select(ClinicalQuickPhrase).where(
                ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value
            )
        ).all()
    )
    res_physio_again = client_a.get(
        f"/api/quick-phrases?department_id={physio.id}&section=COMPLAINTS"
    )
    assert res_physio_again.status_code == 200
    count_after = len(
        db_session.scalars(
            select(ClinicalQuickPhrase).where(
                ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value
            )
        ).all()
    )
    assert count_after == count_before
    assert count_after == (
        len(DEFAULT_PHYSIO_PHRASES)
        + len(DEFAULT_OPHTHALMOLOGY_PHRASES)
        + len(DEFAULT_GENERAL_PHRASES)
    )


def test_personal_phrase_crud_dedup_and_soft_delete(
    db_session: Session,
    doctor_a_user: User,
    login_client: Any,
) -> None:
    """Doctor can create, list, edit, soft-delete, and re-add personal phrases."""
    physio = _get_or_create_department(db_session, "PHYSIOTHERAPY", "Physiotherapy")
    client_a = login_client(doctor_a_user)

    # Create
    create_res = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "  Lumbar paraspinal muscle spasm  ",
            "section": "COMPLAINTS",
            "department_id": physio.id,
            "sort_order": 5,
        },
    )
    assert create_res.status_code == 201, create_res.text
    created = create_res.json()
    assert created["scope"] == "PERSONAL"
    assert created["doctor_id"] == doctor_a_user.doctor_id
    assert created["department_id"] == physio.id
    assert created["department_code"] == "PHYSIOTHERAPY"
    assert created["phrase_text"] == "Lumbar paraspinal muscle spasm"
    assert created["sort_order"] == 5
    assert created["is_active"] is True
    phrase_id = created["id"]

    # Duplicate (case-insensitive) -> 409 duplicate_phrase
    dup_res = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "lumbar paraspinal muscle spasm",
            "section": "COMPLAINTS",
            "department_id": physio.id,
        },
    )
    assert dup_res.status_code == 409
    assert dup_res.json()["code"] == "duplicate_phrase"

    # Too short -> 422
    short_res = client_a.post(
        "/api/quick-phrases",
        json={"phrase_text": "A", "section": "COMPLAINTS", "department_id": physio.id},
    )
    assert short_res.status_code == 422

    # Nonexistent department -> 404
    bad_dept = client_a.post(
        "/api/quick-phrases",
        json={"phrase_text": "Valid phrase", "section": "COMPLAINTS", "department_id": 999999},
    )
    assert bad_dept.status_code == 404

    # Listed in GET under personal
    list_res = client_a.get(f"/api/quick-phrases?department_id={physio.id}&section=COMPLAINTS")
    assert list_res.status_code == 200
    assert [p["id"] for p in list_res.json()["personal"]] == [phrase_id]

    # Edit
    patch_res = client_a.patch(
        f"/api/quick-phrases/{phrase_id}",
        json={"phrase_text": "Lumbar spasm with tenderness", "sort_order": 2},
    )
    assert patch_res.status_code == 200, patch_res.text
    assert patch_res.json()["phrase_text"] == "Lumbar spasm with tenderness"
    assert patch_res.json()["sort_order"] == 2

    # Duplicate rename via PATCH -> 409 duplicate_phrase
    other_res = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "Sacroiliac joint tenderness",
            "section": "COMPLAINTS",
            "department_id": physio.id,
        },
    )
    assert other_res.status_code == 201
    dup_patch = client_a.patch(
        f"/api/quick-phrases/{other_res.json()['id']}",
        json={"phrase_text": "lumbar spasm with tenderness"},
    )
    assert dup_patch.status_code == 409
    assert dup_patch.json()["code"] == "duplicate_phrase"
    assert client_a.delete(f"/api/quick-phrases/{other_res.json()['id']}").status_code == 204

    # Soft-delete
    del_res = client_a.delete(f"/api/quick-phrases/{phrase_id}")
    assert del_res.status_code == 204

    # Gone from GET, row still exists in DB with is_active=False
    list_after = client_a.get(f"/api/quick-phrases?department_id={physio.id}&section=COMPLAINTS")
    assert list_after.status_code == 200
    assert list_after.json()["personal"] == []

    db_row = db_session.get(ClinicalQuickPhrase, phrase_id)
    assert db_row is not None
    assert db_row.is_active is False

    # Second delete -> 404
    assert client_a.delete(f"/api/quick-phrases/{phrase_id}").status_code == 404

    # Re-creating identical text after soft-delete succeeds
    recreate_res = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "Lumbar spasm with tenderness",
            "section": "COMPLAINTS",
            "department_id": physio.id,
        },
    )
    assert recreate_res.status_code == 201


def test_cross_doctor_isolation_and_readonly_hospital_defaults(
    db_session: Session,
    doctor_a_user: User,
    doctor_b_user: User,
    login_client: Any,
) -> None:
    """Doctor B cannot read/edit/delete Doctor A's personal phrases; defaults are read-only."""
    ophth = _get_or_create_department(db_session, "OPHTHALMOLOGY", "Ophthalmology")
    client_a = login_client(doctor_a_user)
    client_b = login_client(doctor_b_user)

    # Doctor A creates a personal phrase
    res_a = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "Dry eye with tear film breakup",
            "section": "COMPLAINTS",
            "department_id": ophth.id,
        },
    )
    assert res_a.status_code == 201
    phrase_a_id = res_a.json()["id"]

    # Doctor B GET does not include Doctor A's phrase
    res_b_get = client_b.get(f"/api/quick-phrases?department_id={ophth.id}&section=COMPLAINTS")
    assert res_b_get.status_code == 200
    assert res_b_get.json()["personal"] == []
    assert len(res_b_get.json()["defaults"]) == len(DEFAULT_OPHTHALMOLOGY_PHRASES)

    # Doctor B can save the same phrase text independently
    res_b_create = client_b.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "Dry eye with tear film breakup",
            "section": "COMPLAINTS",
            "department_id": ophth.id,
        },
    )
    assert res_b_create.status_code == 201

    # Doctor B cannot PATCH or DELETE Doctor A's phrase -> 404
    assert (
        client_b.patch(
            f"/api/quick-phrases/{phrase_a_id}",
            json={"phrase_text": "Hijacked phrase"},
        ).status_code
        == 404
    )
    assert client_b.delete(f"/api/quick-phrases/{phrase_a_id}").status_code == 404

    # Hospital default phrases are read-only to doctors (PATCH & DELETE -> 404)
    default_id = res_b_get.json()["defaults"][0]["id"]
    default_text = res_b_get.json()["defaults"][0]["phrase_text"]
    assert (
        client_a.patch(
            f"/api/quick-phrases/{default_id}",
            json={"phrase_text": "Tampered hospital default"},
        ).status_code
        == 404
    )
    assert client_a.delete(f"/api/quick-phrases/{default_id}").status_code == 404

    db_default = db_session.get(ClinicalQuickPhrase, default_id)
    assert db_default is not None
    assert db_default.is_active is True
    assert db_default.phrase_text == default_text


def test_section_and_department_scoping_preserves_phrases_across_dept_changes(
    db_session: Session,
    doctor_a_user: User,
    login_client: Any,
) -> None:
    """Section and department filters stay isolated; changing doctor departments keeps phrases."""
    physio = _get_or_create_department(db_session, "PHYSIOTHERAPY", "Physiotherapy")
    ophth = _get_or_create_department(db_session, "OPHTHALMOLOGY", "Ophthalmology")
    client_a = login_client(doctor_a_user)

    # Save phrases in different sections and departments
    p1 = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "SLR positive at 45 degrees",
            "section": "EXAMINATION",
            "department_id": physio.id,
        },
    )
    p2 = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "Mild conjunctival congestion",
            "section": "EXAMINATION",
            "department_id": ophth.id,
        },
    )
    p3 = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "Apply warm compress twice daily",
            "section": "ADVICE",
            "department_id": None,
        },
    )
    assert p1.status_code == 201
    assert p2.status_code == 201
    assert p3.status_code == 201

    # Physio EXAMINATION has only p1 (and no General defaults leaked)
    r_physio_exam = client_a.get(
        f"/api/quick-phrases?department_id={physio.id}&section=EXAMINATION"
    )
    assert r_physio_exam.status_code == 200
    assert r_physio_exam.json()["defaults"] == []
    assert [p["phrase_text"] for p in r_physio_exam.json()["personal"]] == [
        "SLR positive at 45 degrees"
    ]

    # Physio COMPLAINTS does not include EXAMINATION phrase p1
    r_physio_comp = client_a.get(f"/api/quick-phrases?department_id={physio.id}&section=COMPLAINTS")
    assert r_physio_comp.status_code == 200
    assert r_physio_comp.json()["personal"] == []

    # Ophth EXAMINATION has only p2
    r_ophth_exam = client_a.get(f"/api/quick-phrases?department_id={ophth.id}&section=EXAMINATION")
    assert r_ophth_exam.status_code == 200
    assert [p["phrase_text"] for p in r_ophth_exam.json()["personal"]] == [
        "Mild conjunctival congestion"
    ]

    # General (department_id=None) ADVICE has only p3
    r_gen_advice = client_a.get("/api/quick-phrases?section=ADVICE")
    assert r_gen_advice.status_code == 200
    assert [p["phrase_text"] for p in r_gen_advice.json()["personal"]] == [
        "Apply warm compress twice daily"
    ]

    # Changing doctor's assigned department does NOT delete saved personal phrases
    doctor = doctor_a_user.doctor
    assert doctor is not None
    doctor.departments = [ophth]
    db_session.flush()

    r_physio_still_there = client_a.get(
        f"/api/quick-phrases?department_id={physio.id}&section=EXAMINATION"
    )
    assert r_physio_still_there.status_code == 200
    assert [p["phrase_text"] for p in r_physio_still_there.json()["personal"]] == [
        "SLR positive at 45 degrees"
    ]


def test_editing_or_deleting_phrase_leaves_historical_encounter_text_unchanged(
    db_session: Session,
    doctor_a_user: User,
    login_client: Any,
) -> None:
    """Editing or deleting a quick phrase never alters previously saved ClinicalEncounter text."""
    physio = _get_or_create_department(db_session, "PHYSIOTHERAPY", "Physiotherapy")
    patient = _create_patient(db_session)
    client_a = login_client(doctor_a_user)

    phrase_res = client_a.post(
        "/api/quick-phrases",
        json={
            "phrase_text": "Chronic cervicalgia radiating to right arm",
            "section": "COMPLAINTS",
            "department_id": physio.id,
        },
    )
    assert phrase_res.status_code == 201
    phrase_id = phrase_res.json()["id"]
    original_phrase = phrase_res.json()["phrase_text"]

    # Save an encounter using the phrase text
    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        symptoms=f"{original_phrase}; worse in morning",
        clinical_notes="Reduced cervical ROM",
        diagnosis="Cervical spondylosis",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    db_session.flush()
    expected_symptoms = enc.symptoms

    # Edit the personal phrase
    patch_res = client_a.patch(
        f"/api/quick-phrases/{phrase_id}",
        json={"phrase_text": "Modified neck pain phrase"},
    )
    assert patch_res.status_code == 200

    # Delete the personal phrase
    del_res = client_a.delete(f"/api/quick-phrases/{phrase_id}")
    assert del_res.status_code == 204

    # Historical encounter text is completely untouched in DB and API
    db_session.refresh(enc)
    assert enc.symptoms == expected_symptoms

    enc_res = client_a.get(f"/api/encounters/{enc.id}")
    assert enc_res.status_code == 200
    assert enc_res.json()["symptoms"] == expected_symptoms


def test_default_quick_phrases_seeder_conflict_safe_and_unique_indexes(
    db_session: Session,
) -> None:
    """Seeder handles repeated/partial-conflict calls; DB blocks duplicate HOSPITAL_DEFAULT rows."""
    import kalyan_api.routers.quick_phrases as qp

    # Clean slate for defaults inside this test transaction
    db_session.execute(
        delete(ClinicalQuickPhrase).where(
            ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value
        )
    )
    db_session.flush()
    qp._DEFAULTS_SEEDED = False

    # Initial seed + repeated fast-path call produce exact expected default count
    ensure_default_quick_phrases_seeded(db_session)
    assert qp._DEFAULTS_SEEDED is True
    ensure_default_quick_phrases_seeded(db_session)
    count_after_seed = db_session.scalar(
        select(func.count(ClinicalQuickPhrase.id)).where(
            ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value
        )
    )
    assert count_after_seed == _EXPECTED_DEFAULT_COUNT

    # Remove one default row so the seeder enters the PostgreSQL ON CONFLICT DO NOTHING path
    # against existing rows (simulating a concurrent cold-start race)
    one_default_id = db_session.scalar(
        select(ClinicalQuickPhrase.id)
        .where(ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value)
        .limit(1)
    )
    assert one_default_id is not None
    db_session.execute(delete(ClinicalQuickPhrase).where(ClinicalQuickPhrase.id == one_default_id))
    db_session.flush()

    qp._DEFAULTS_SEEDED = False
    ensure_default_quick_phrases_seeded(db_session)
    assert qp._DEFAULTS_SEEDED is True
    count_after_race = db_session.scalar(
        select(func.count(ClinicalQuickPhrase.id)).where(
            ClinicalQuickPhrase.scope == QuickPhraseScope.HOSPITAL_DEFAULT.value
        )
    )
    assert count_after_race == _EXPECTED_DEFAULT_COUNT

    # Direct duplicate department-scoped HOSPITAL_DEFAULT insert blocked by partial unique index
    with pytest.raises(IntegrityError) as dept_exc, db_session.begin_nested():
        db_session.add(
            ClinicalQuickPhrase(
                scope=QuickPhraseScope.HOSPITAL_DEFAULT.value,
                doctor_id=None,
                department_id=None,
                department_code="PHYSIOTHERAPY",
                section=QuickPhraseSection.COMPLAINTS.value,
                phrase_text=DEFAULT_PHYSIO_PHRASES[0],
                sort_order=99,
                is_active=True,
            )
        )
        db_session.flush()
    assert "ix_quick_phrases_default_dept" in str(dept_exc.value)

    # Direct duplicate global (department_code=None) HOSPITAL_DEFAULT insert blocked by index
    with pytest.raises(IntegrityError) as global_exc, db_session.begin_nested():
        db_session.add(
            ClinicalQuickPhrase(
                scope=QuickPhraseScope.HOSPITAL_DEFAULT.value,
                doctor_id=None,
                department_id=None,
                department_code=None,
                section=QuickPhraseSection.COMPLAINTS.value,
                phrase_text=DEFAULT_GENERAL_PHRASES[0],
                sort_order=99,
                is_active=True,
            )
        )
        db_session.flush()
    assert "ix_quick_phrases_default_global" in str(global_exc.value)


def test_ensure_default_quick_phrases_seeded_fast_path(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When _DEFAULTS_SEEDED is True, seeder avoids database queries."""
    import kalyan_api.routers.quick_phrases as qp

    qp._DEFAULTS_SEEDED = True

    def fail_on_query(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Database query was executed despite _DEFAULTS_SEEDED=True")

    monkeypatch.setattr(db_session, "scalar", fail_on_query)
    monkeypatch.setattr(db_session, "execute", fail_on_query)

    # Must return cleanly without executing any queries
    ensure_default_quick_phrases_seeded(db_session)


def test_migration_0040_dedup_preexisting_duplicates(
    owner_engine: Engine,
) -> None:
    """Migration 0040 deduplication logic cleans up duplicate defaults keeping lowest ID."""
    with owner_engine.connect() as conn:
        # Temporarily drop index to simulate pre-0040 state
        conn.execute(text("DROP INDEX IF EXISTS ix_quick_phrases_default_dept"))
        conn.execute(text("DROP INDEX IF EXISTS ix_quick_phrases_default_global"))
        conn.commit()

        try:
            # Insert duplicate HOSPITAL_DEFAULT rows
            conn.execute(
                text("""
                INSERT INTO clinical_quick_phrases (
                    scope, department_code, section, phrase_text, sort_order, is_active
                ) VALUES
                    ('HOSPITAL_DEFAULT', 'PHYSIOTHERAPY', 'COMPLAINTS', 'Dup Test Phrase', 1, true),
                    ('HOSPITAL_DEFAULT', 'PHYSIOTHERAPY', 'COMPLAINTS', 'Dup Test Phrase', 2, true),
                    ('HOSPITAL_DEFAULT', NULL, 'COMPLAINTS', 'Dup Global Phrase', 1, true),
                    ('HOSPITAL_DEFAULT', NULL, 'COMPLAINTS', 'Dup Global Phrase', 2, true)
                """)
            )
            conn.commit()

            # Execute the exact deduplication query from migration 0040
            conn.execute(
                text("""
                DELETE FROM clinical_quick_phrases
                WHERE scope = 'HOSPITAL_DEFAULT'
                  AND id NOT IN (
                      SELECT MIN(id)
                      FROM clinical_quick_phrases
                      WHERE scope = 'HOSPITAL_DEFAULT'
                      GROUP BY department_code, section, phrase_text
                  )
                """)
            )
            conn.commit()

            # Verify that duplicates were deleted and lowest ID kept
            physio_rows = conn.execute(
                text("""
                SELECT id FROM clinical_quick_phrases
                WHERE scope = 'HOSPITAL_DEFAULT' AND phrase_text = 'Dup Test Phrase'
                ORDER BY id ASC
                """)
            ).scalars().all()
            assert len(physio_rows) == 1

            global_rows = conn.execute(
                text("""
                SELECT id FROM clinical_quick_phrases
                WHERE scope = 'HOSPITAL_DEFAULT' AND phrase_text = 'Dup Global Phrase'
                ORDER BY id ASC
                """)
            ).scalars().all()
            assert len(global_rows) == 1

            # Clean up test rows
            conn.execute(
                text("""
                DELETE FROM clinical_quick_phrases
                WHERE phrase_text IN ('Dup Test Phrase', 'Dup Global Phrase')
                """)
            )
            conn.commit()
        finally:
            # Recreate unique indexes ensuring schema remains clean
            conn.execute(
                text("""
                CREATE UNIQUE INDEX IF NOT EXISTS ix_quick_phrases_default_dept
                ON clinical_quick_phrases (department_code, section, phrase_text)
                WHERE scope = 'HOSPITAL_DEFAULT' AND department_code IS NOT NULL
                """)
            )
            conn.execute(
                text("""
                CREATE UNIQUE INDEX IF NOT EXISTS ix_quick_phrases_default_global
                ON clinical_quick_phrases (section, phrase_text)
                WHERE scope = 'HOSPITAL_DEFAULT' AND department_code IS NULL
                """)
            )
            conn.commit()
