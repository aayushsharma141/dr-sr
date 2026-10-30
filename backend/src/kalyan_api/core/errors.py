"""Single JSON error envelope, exception handlers, and request-id tracing."""

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

logger = logging.getLogger("kalyan_api.errors")


class ApiError(Exception):
    """Base application exception mapped to standard error envelope."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        **extras: Any,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extras = extras

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            **self.extras,
        }


STATUS_TO_CODE = {
    400: "bad_request",
    401: "not_authenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    429: "too_many_attempts",
    500: "internal_error",
}


def install_error_handlers(app: FastAPI) -> None:
    """Register uniform error handlers conforming to the API error envelope."""

    @app.exception_handler(ApiError)
    def handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.to_dict(),
        )

    @app.exception_handler(HTTPException)
    def handle_http_exception(_request: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict):
            code = exc.detail.get("code", STATUS_TO_CODE.get(exc.status_code, "http_error"))
            message = exc.detail.get("message", str(exc.detail))
            extras = {k: v for k, v in exc.detail.items() if k not in ("code", "message")}
            return JSONResponse(
                status_code=exc.status_code,
                content={"code": code, "message": message, **extras},
                headers=exc.headers,
            )
        code = STATUS_TO_CODE.get(exc.status_code, "http_error")
        message = str(exc.detail) if exc.detail else "An error occurred."
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": code, "message": message},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Build fields array with loc and message ONLY; never echo input/passwords
        fields = []
        for err in exc.errors():
            fields.append({
                "loc": [str(x) for x in err.get("loc", [])],
                "message": err.get("msg", "Invalid value"),
            })
        return JSONResponse(
            status_code=422,
            content={
                "code": "validation_error",
                "message": "The submitted data failed validation.",
                "fields": fields,
            },
        )

    @app.exception_handler(Exception)
    def handle_unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
        req_id = getattr(request.state, "request_id", "unknown")
        logger.exception("Unhandled server exception [req_id=%s]: %s", req_id, exc)
        return JSONResponse(
            status_code=500,
            content={
                "code": "internal_error",
                "message": "An unexpected server error occurred.",
            },
        )


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Middleware attaching a unique X-Request-ID to state and response headers."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = req_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response

