"""The destructive-script guard must accept test databases and refuse everything else."""

import pytest

from kalyan_api.config import Settings
from kalyan_api.db.guards import UnsafeDatabaseError, is_test_database_name, require_test_database


def test_accepts_test_database_names() -> None:
    for name in ("kalyan_test", "test_kalyan", "kalyan_test_db", "test"):
        assert is_test_database_name(name), name


def test_refuses_authoritative_and_unclear_names() -> None:
    for name in (
        "kalyan_dev",
        "kalyan",
        "kalyan_prod",
        "kalyan_production",
        "postgres",
        "template0",
        "kalyan_dues_check",
        "kalyan_test_backup",
        "",
    ):
        assert not is_test_database_name(name), name


def test_require_test_database_refuses_development_database() -> None:
    settings = Settings(db_name="kalyan_dev")
    with pytest.raises(UnsafeDatabaseError, match="kalyan_dev"):
        require_test_database(settings, "reset the schema")


def test_require_test_database_allows_test_database() -> None:
    settings = Settings(db_name="kalyan_test")
    assert require_test_database(settings, "reset the schema") == "kalyan_test"
