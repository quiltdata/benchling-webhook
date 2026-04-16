import asyncio
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Callable

import requests
import structlog
from benchling_sdk.benchling import Benchling
from botocore.exceptions import ClientError

from .canvas import CanvasManager
from .config import Config
from .package_files import PackageFileFetcher
from .payload import Payload

logger = structlog.get_logger(__name__)

RETRYABLE_CLIENT_ERROR_CODES = {
    "InternalError",
    "RequestTimeout",
    "RequestTimeoutException",
    "ServiceUnavailable",
    "ThrottledException",
    "Throttling",
    "ThrottlingException",
    "TooManyRequestsException",
}


class RefreshOutcome(str, Enum):
    SUCCESS = "success"
    SKIPPED_STALE = "skipped_stale"
    SKIPPED_NO_CANVAS = "skipped_no_canvas"
    TRANSIENT_ERROR = "transient_error"
    PERMANENT_ERROR = "permanent_error"


@dataclass(frozen=True)
class RefreshResult:
    outcome: RefreshOutcome
    error_type: str | None = None
    error_message: str | None = None


def _truncate_error_message(message: str | None, limit: int = 500) -> str | None:
    if not message:
        return None
    if len(message) <= limit:
        return message
    return f"{message[: limit - 3]}..."


def _classify_exception(exc: Exception) -> RefreshOutcome:
    if isinstance(exc, requests.exceptions.HTTPError):
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 429 or (status_code is not None and status_code >= 500):
            return RefreshOutcome.TRANSIENT_ERROR
        return RefreshOutcome.PERMANENT_ERROR

    if isinstance(exc, (requests.exceptions.ConnectionError, requests.exceptions.Timeout, socket.timeout)):
        return RefreshOutcome.TRANSIENT_ERROR

    if isinstance(exc, ClientError):
        error_code = exc.response.get("Error", {}).get("Code")
        if error_code in RETRYABLE_CLIENT_ERROR_CODES:
            return RefreshOutcome.TRANSIENT_ERROR
        return RefreshOutcome.PERMANENT_ERROR

    if isinstance(exc, (ValueError, KeyError)):
        return RefreshOutcome.PERMANENT_ERROR

    return RefreshOutcome.TRANSIENT_ERROR


def refresh_canvas_for_package_event(
    package_name: str,
    top_hash: str | None,
    *,
    config: Config,
    benchling_factory: Callable[[], Benchling],
) -> RefreshResult:
    """Refresh a canvas after Quilt publishes a package revision event."""
    try:
        active_benchling = benchling_factory()
        if active_benchling is None:
            raise RuntimeError("Benchling client unavailable")

        package_fetcher = PackageFileFetcher(
            catalog_url=config.quilt_catalog,
            bucket=config.s3_bucket_name,
            role_arn=config.quilt_write_role_arn or None,
            region=config.aws_region,
        )

        if top_hash:
            latest_top_hash = package_fetcher.get_package_top_hash(package_name)
            if latest_top_hash != top_hash:
                logger.info(
                    "Package event skipped - stale package revision",
                    package_name=package_name,
                    event_top_hash=top_hash,
                    latest_top_hash=latest_top_hash,
                )
                return RefreshResult(RefreshOutcome.SKIPPED_STALE)

        metadata = package_fetcher.get_package_metadata(package_name)
        canvas_id = metadata.get("canvas_id")
        entry_id = metadata.get("entry_id")

        if not canvas_id or not entry_id:
            logger.info(
                "Package event skipped - package metadata missing canvas target",
                package_name=package_name,
                has_canvas_id=bool(canvas_id),
                has_entry_id=bool(entry_id),
                top_hash=top_hash,
            )
            return RefreshResult(RefreshOutcome.SKIPPED_NO_CANVAS)

        updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        payload = Payload({"message": {"canvasId": canvas_id, "resourceId": entry_id}})
        result = CanvasManager(active_benchling, config, payload).update_canvas(updated_at=updated_at)

        if result.get("success"):
            logger.info(
                "Package event canvas refresh completed",
                package_name=package_name,
                canvas_id=canvas_id,
                entry_id=entry_id,
                top_hash=top_hash,
                success=True,
            )
            return RefreshResult(RefreshOutcome.SUCCESS)

        error_message = _truncate_error_message(str(result.get("error") or "Canvas update failed"))
        logger.error(
            "Package event canvas refresh returned unsuccessful result",
            package_name=package_name,
            canvas_id=canvas_id,
            entry_id=entry_id,
            top_hash=top_hash,
            error=error_message,
        )
        return RefreshResult(
            RefreshOutcome.TRANSIENT_ERROR,
            error_type="CanvasUpdateFailed",
            error_message=error_message,
        )
    except asyncio.CancelledError:
        raise
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as exc:
        outcome = _classify_exception(exc)
        error_message = _truncate_error_message(str(exc))
        logger.error(
            "Package event canvas refresh failed",
            package_name=package_name,
            top_hash=top_hash,
            outcome=outcome.value,
            error=error_message,
            error_type=type(exc).__name__,
            exc_info=True,
        )
        return RefreshResult(
            outcome=outcome,
            error_type=type(exc).__name__,
            error_message=error_message,
        )
