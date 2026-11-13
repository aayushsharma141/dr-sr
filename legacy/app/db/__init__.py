"""
Database Package for Kalyan Hospital Management System.
"""

from app.db.connection import get_db_connection, init_db

__all__ = ["get_db_connection", "init_db"]
