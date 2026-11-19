"""Administrative reports endpoints (Phase 22, Wave 5; T22-11, OD-I, OD-22-21)."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, desc, func, select

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.db.session import SessionDep
from kalyan_api.models import REFERRAL_SOURCES_NEEDING_NAME, Visit, VisitStatus
from kalyan_api.schemas.reports import ReferralReportOut, ReferralReportRow

def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


router = APIRouter(prefix="/reports", tags=["reports"])


@router.get(
    "/referrals",
    response_model=ReferralReportOut,
    dependencies=[Depends(require(Permission.REPORT_REFERRAL))],
)
def get_referral_report(
    session: SessionDep,
    date_from: date = Query(..., description="Start date (inclusive)"),
    date_to: date = Query(..., description="End date (inclusive)"),
    source: str | None = Query(None, description="Optional referral source or NOT_RECORDED"),
    referrer: str | None = Query(None, description="Optional referrer name substring"),
) -> ReferralReportOut:
    """Aggregate OPD visits by referral source and referrer name for a date range."""
    if date_from > date_to:
        raise ApiError(
            status_code=422,
            code="invalid_date_range",
            message="date_from must not be after date_to.",
        )

    # NULL referral_source is bucketed as NOT_RECORDED (OD-I, migration 0026 rule)
    source_expr = func.coalesce(Visit.referral_source, "NOT_RECORDED").label("source")
    # Referrer name is only grouped/displayed for sources that require a name
    referrer_expr = case(
        (Visit.referral_source.in_(REFERRAL_SOURCES_NEEDING_NAME), Visit.referrer_name),
        else_=None,
    ).label("referrer_name")
    count_expr = func.count(Visit.id).label("visit_count")

    stmt = (
        select(
            source_expr,
            referrer_expr,
            count_expr,
        )
        .where(
            Visit.visit_date >= date_from,
            Visit.visit_date <= date_to,
            Visit.status != VisitStatus.CANCELLED.value,
        )
        .group_by(source_expr, referrer_expr)
    )

    if source and source.strip():
        s_clean = source.strip().upper()
        if s_clean == "NOT_RECORDED":
            stmt = stmt.where(Visit.referral_source.is_(None))
        else:
            stmt = stmt.where(func.upper(Visit.referral_source) == s_clean)

    if referrer and referrer.strip():
        r_clean = referrer.strip()
        stmt = stmt.where(
            Visit.referrer_name.is_not(None),
            Visit.referrer_name.ilike(f"%{_escape_like(r_clean)}%"),
        )

    # Order by visit_count desc, then source asc, then referrer_name asc
    stmt = stmt.order_by(
        desc(count_expr),
        source_expr.asc(),
        referrer_expr.asc().nulls_last(),
    )

    results = session.execute(stmt).all()

    rows = [
        ReferralReportRow(
            source=r.source,
            referrer_name=r.referrer_name,
            visit_count=r.visit_count,
        )
        for r in results
    ]

    total_visits = sum(row.visit_count for row in rows)

    return ReferralReportOut(
        date_from=date_from,
        date_to=date_to,
        rows=rows,
        total_visits=total_visits,
    )
