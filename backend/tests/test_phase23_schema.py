"""Schema tests for Phase 23 (Advanced Data Operations, migration 0030)."""

import pytest
from sqlalchemy import inspect
from kalyan_api.models import Patient, Workstation


def test_migration_0030_patient_columns_exist(db_session):
    """Verify patients table has merge and archive columns from migration 0030."""
    mapper = inspect(Patient)
    columns = {c.key for c in mapper.column_attrs}
    
    assert "merged_into_id" in columns
    assert "merged_at" in columns
    assert "merged_by_user_id" in columns
    assert "merge_reason" in columns
    assert "is_archived" in columns
    assert "archived_at" in columns
    assert "archived_by_user_id" in columns
    assert "archive_reason" in columns


def test_migration_0030_workstations_table_exists(db_session):
    """Verify workstations table exists with required columns."""
    mapper = inspect(Workstation)
    columns = {c.key for c in mapper.column_attrs}
    
    assert "id" in columns
    assert "hostname" in columns
    assert "ip_address" in columns
    assert "terminal_name" in columns
    assert "app_version" in columns
    assert "last_seen_at" in columns
    assert "last_user_id" in columns
    assert "last_username" in columns
    assert "created_at" in columns
    assert "updated_at" in columns
