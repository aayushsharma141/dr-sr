"""Database engine creation, session factory, and FastAPI request-scoped dependency."""

from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from kalyan_api.config import Settings


def build_engine(settings: Settings, owner: bool = False) -> Engine:
    """Build and configure a sync SQLAlchemy engine for PostgreSQL."""
    url = settings.owner_url if owner else settings.app_url
    return create_engine(
        url,
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args={
            "options": (
                "-c timezone=Asia/Kolkata "
                "-c statement_timeout=30000 "
                "-c lock_timeout=10000 "
                "-c idle_in_transaction_session_timeout=60000"
            )
        },
    )


# Global session factory initialized during lifespan
SessionLocal: sessionmaker[Session] = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


def get_session() -> Generator[Session, None, None]:
    """Request-scoped database session yielding a transaction that commits before response."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# In FastAPI, dependencies with scope="function" commit and clean up before response sending
SessionDep = Annotated[Session, Depends(get_session, scope="function")]

