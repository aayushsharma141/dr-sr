"""Hospital asset management endpoints (SET-01, D-20-01).

Guarantees:
- POST /api/admin/assets: Accepts multipart upload, validates magic bytes up to 10 MB,
  increments logo version and marks prior logos inactive. Guarded by SETTINGS_WRITE.
- GET /api/admin/assets: Lists all historical and active assets with metadata. Guarded by SETTINGS_WRITE.
- POST /api/admin/assets/{id}/deactivate: Deactivates asset without deleting physical file. Guarded by SETTINGS_WRITE.
- GET /api/admin/assets/{id}/file: Streams raw asset bytes for authenticated admin preview. Guarded by SETTINGS_WRITE.
- GET /api/assets/active-logo: Serves active hospital logo or fallback image without session cookie. Policy: public.
"""

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import public, require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import HospitalAsset
from kalyan_api.services import asset_service, audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["assets"])

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_FALLBACK_LOGO_CANDIDATES = [
    _PROJECT_ROOT / "frontend" / "public" / "assets" / "kalyan_hospital_logo.png",
    _PROJECT_ROOT / "legacy" / "app" / "assets" / "kalyan_hospital_logo.png",
]


class AssetOut(BaseModel):
    """Hospital asset response payload."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_type: str
    filename: str
    original_filename: str
    mime_type: str
    file_size_bytes: int
    is_active: bool
    version: int
    uploaded_by_user_id: int
    uploaded_by_name: str | None = None
    created_at: datetime


def _to_asset_out(asset: HospitalAsset) -> AssetOut:
    uploaded_name = None
    if getattr(asset, "uploaded_by_user", None):
        uploaded_name = asset.uploaded_by_user.full_name
    return AssetOut(
        id=asset.id,
        asset_type=asset.asset_type,
        filename=asset.filename,
        original_filename=asset.original_filename,
        mime_type=asset.mime_type,
        file_size_bytes=asset.file_size_bytes,
        is_active=asset.is_active,
        version=asset.version,
        uploaded_by_user_id=asset.uploaded_by_user_id,
        uploaded_by_name=uploaded_name,
        created_at=asset.created_at,
    )


@router.post(
    "/admin/assets",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
    response_model=AssetOut,
)
async def upload_asset(
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    file: UploadFile = File(...),
    asset_type: str = Form(...),
) -> AssetOut:
    """Upload and validate a new hospital logo, certificate, or photograph."""
    data = await file.read()
    app_settings = getattr(request.app.state, "settings", None)
    assets_dir = getattr(app_settings, "assets_dir", None)
    asset = asset_service.save_asset(
        session=session,
        file_bytes=data,
        original_filename=file.filename or "",
        asset_type=asset_type.strip(),
        user_id=principal.user_id,
        assets_dir=assets_dir,
    )
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.ASSET_UPLOADED,
        "HOSPITAL_ASSET",
        str(asset.id),
        after={
            "asset_type": asset.asset_type,
            "filename": asset.filename,
            "original_filename": asset.original_filename,
            "mime_type": asset.mime_type,
            "file_size_bytes": asset.file_size_bytes,
            "version": asset.version,
        },
    )
    return _to_asset_out(asset)


@router.get(
    "/admin/assets",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
    response_model=list[AssetOut],
)
def list_assets(
    session: SessionDep,
    asset_type: str | None = None,
    is_active: bool | None = None,
) -> list[AssetOut]:
    """List historical and active hospital assets."""
    assets = asset_service.list_assets(session, asset_type=asset_type, is_active=is_active)
    return [_to_asset_out(a) for a in assets]


@router.post(
    "/admin/assets/{asset_id}/deactivate",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
    response_model=AssetOut,
)
def deactivate_asset(
    asset_id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AssetOut:
    """Deactivate an asset without physical file deletion."""
    asset = asset_service.deactivate_asset(session, asset_id, user_id=principal.user_id)
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.ASSET_DEACTIVATED,
        "HOSPITAL_ASSET",
        str(asset.id),
        before={"is_active": True},
        after={"is_active": False},
    )
    return _to_asset_out(asset)


@router.get(
    "/admin/assets/{asset_id}/file",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
)
def get_asset_file(
    asset_id: int,
    request: Request,
    session: SessionDep,
) -> FileResponse:
    """Stream raw asset file for authenticated admin review."""
    asset = session.get(HospitalAsset, asset_id)
    if not asset:
        raise ApiError(status_code=404, code="asset_not_found", message=f"Asset {asset_id} not found.")
    app_settings = getattr(request.app.state, "settings", None)
    assets_dir = getattr(app_settings, "assets_dir", None)
    path = asset_service.get_asset_path(asset.filename, assets_dir=assets_dir)
    if not path.is_file():
        raise ApiError(
            status_code=404, code="asset_file_missing", message="Physical asset file not found on disk."
        )
    return FileResponse(path, media_type=asset.mime_type, filename=asset.original_filename)


@router.get(
    "/assets/active-logo",
    dependencies=[Depends(public)],
)
def get_active_logo_endpoint(
    request: Request,
    session: SessionDep,
) -> Response:
    """Stream current active hospital logo crest or default crest for login and printouts."""
    active_logo = asset_service.get_active_logo(session)
    if active_logo:
        app_settings = getattr(request.app.state, "settings", None)
        assets_dir = getattr(app_settings, "assets_dir", None)
        path = asset_service.get_asset_path(active_logo.filename, assets_dir=assets_dir)
        if path.is_file():
            return FileResponse(path, media_type=active_logo.mime_type, filename=active_logo.original_filename)

    for fallback in _FALLBACK_LOGO_CANDIDATES:
        if fallback.is_file():
            return FileResponse(fallback, media_type="image/png", filename="kalyan_hospital_logo.png")

    svg_fallback = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
        '<rect width="128" height="128" fill="#131b2e"/>'
        '<text x="64" y="68" fill="#C39A35" font-family="sans-serif" font-size="14" text-anchor="middle">KALYAN</text>'
        '</svg>'
    )
    return Response(content=svg_fallback, media_type="image/svg+xml")
