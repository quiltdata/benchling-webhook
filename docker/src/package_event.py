import asyncio
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable

import requests
import structlog
from benchling_sdk.benchling import Benchling
from botocore.exceptions import ClientError

from .canvas import CanvasManager
from .config import Config
from .package_files import PackageFileFetcher
from .package_query import ELN_ENTRY_KEY, PackageQuery
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


def _canvas_target(metadata: Any) -> tuple[str, str] | None:
    """Extract an internal entry ID and Canvas ID from package metadata."""
    if not isinstance(metadata, dict):
        return None
    canvas_id = metadata.get("canvas_id")
    entry_id = metadata.get("entry_id")
    if isinstance(canvas_id, str) and canvas_id and isinstance(entry_id, str) and entry_id:
        return entry_id, canvas_id
    return None


def _linked_display_ids(metadata: Any, package_key: str) -> list[str]:
    """Return display IDs named by the configured key or ``eln_entry``."""
    if not isinstance(metadata, dict):
        return []
    values = []
    for key in dict.fromkeys((package_key, ELN_ENTRY_KEY)):
        value = metadata.get(key)
        candidates = value if isinstance(value, list) else [value]
        for candidate in candidates:
            if isinstance(candidate, str) and candidate and candidate not in values:
                values.append(candidate)
    return values


def refresh_canvas_for_package_event(
    package_name: str,
    top_hash: str | None,
    *,
    config: Config,
    benchling_factory: Callable[[], Benchling],
    bucket: str | None = None,
) -> RefreshResult:
    """Refresh every Canvas affected by a newly published package revision.

    Besides the package's own Canvas, each entry it links to is resolved by its
    entry package's ``display_id``, not by the linked package's name or prefix.
    """
    try:
        active_benchling = benchling_factory()
        if active_benchling is None:
            raise RuntimeError("Benchling client unavailable")

        def fetcher_for(fetch_bucket: str) -> PackageFileFetcher:
            return PackageFileFetcher(
                catalog_url=config.quilt_catalog,
                bucket=fetch_bucket,
                role_arn=config.quilt_write_role_arn or None,
                region=config.aws_region,
            )

        package_bucket = bucket or config.s3_bucket_name
        package_fetcher = fetcher_for(package_bucket)

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

        display_metadata = package_fetcher.get_package_metadata(package_name)
        manifest_metadata = package_fetcher.get_package_user_metadata(package_name)
        targets: set[tuple[str, str]] = set()
        lookup_failures: list[str] = []
        direct_target = _canvas_target(display_metadata) or _canvas_target(manifest_metadata)
        if direct_target:
            targets.add(direct_target)

        package_key = getattr(config, "package_key", None)
        if not isinstance(package_key, str) or not package_key:
            package_key = "experiment_id"
        linked_display_ids = _linked_display_ids(manifest_metadata, package_key)
        if linked_display_ids:
            package_query = PackageQuery(
                # Not the event's bucket: bucketless mode must search every bucket.
                bucket=config.s3_bucket_name or "",
                catalog_url=config.quilt_catalog,
                database=config.quilt_database,
                config=config,
            )
            for display_id in linked_display_ids:
                lookup = package_query.find_unique_packages(
                    key="display_id",
                    value=display_id,
                )
                lookup_errors = lookup.get("results", {}).get("errors", {})
                if lookup_errors:
                    summary = "; ".join(
                        f"{failed_bucket}: {message}" for failed_bucket, message in sorted(lookup_errors.items())
                    )
                    lookup_failures.append(f"{display_id}: incomplete target lookup ({summary})")
                    continue
                linked_entry_packages = lookup["packages"]
                if not linked_entry_packages:
                    logger.warning(
                        "Linked entry package not found for Canvas refresh",
                        package_name=package_name,
                        display_id=display_id,
                    )
                    lookup_failures.append(f"{display_id}: linked entry package is not indexed yet")
                    continue
                for entry_package in linked_entry_packages:
                    target = _canvas_target(entry_package.metadata)
                    if not target:
                        target_fetcher = (
                            package_fetcher
                            if entry_package.bucket == package_bucket
                            else fetcher_for(entry_package.bucket)
                        )
                        target_metadata = target_fetcher.get_package_metadata(entry_package.package_name)
                        target = _canvas_target(target_metadata)
                    if target:
                        targets.add(target)

        if not targets:
            if lookup_failures:
                error_message = _truncate_error_message("; ".join(lookup_failures))
                logger.warning(
                    "Package event Canvas targets are not ready",
                    package_name=package_name,
                    top_hash=top_hash,
                    error=error_message,
                )
                return RefreshResult(
                    RefreshOutcome.TRANSIENT_ERROR,
                    error_type="CanvasTargetLookupIncomplete",
                    error_message=error_message,
                )
            logger.info(
                "Package event skipped - package metadata missing canvas target",
                package_name=package_name,
                top_hash=top_hash,
            )
            return RefreshResult(RefreshOutcome.SKIPPED_NO_CANVAS)

        failures = list(lookup_failures)
        updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        for entry_id, canvas_id in sorted(targets):
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
            else:
                failures.append(str(result.get("error") or "Canvas update failed"))

        if failures:
            error_message = _truncate_error_message("; ".join(failures))
            logger.error(
                "Package event canvas refresh returned unsuccessful result",
                package_name=package_name,
                top_hash=top_hash,
                target_count=len(targets),
                error=error_message,
            )
            return RefreshResult(
                RefreshOutcome.TRANSIENT_ERROR,
                error_type="CanvasRefreshIncomplete" if lookup_failures else "CanvasUpdateFailed",
                error_message=error_message,
            )
        return RefreshResult(RefreshOutcome.SUCCESS)
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
