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
        linked_targets: set[tuple[str, str]] = set()
        direct_target = _canvas_target(display_metadata) or _canvas_target(manifest_metadata)

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
                # Linked entries are refreshed best-effort, failures logged and not retried:
                # one that fails for good would retry the event into the dead-letter queue,
                # and the entry's next redraw repairs a missed refresh.
                try:
                    lookup = package_query.find_unique_packages(key="display_id", value=display_id)
                    lookup_errors = lookup.get("results", {}).get("errors")
                    if lookup_errors:
                        logger.warning(
                            "Linked entry lookup incomplete",
                            package_name=package_name,
                            display_id=display_id,
                            errors=lookup_errors,
                        )
                    for entry_package in lookup["packages"]:
                        target = _canvas_target(entry_package.metadata)
                        if not target:
                            target_fetcher = (
                                package_fetcher
                                if entry_package.bucket == package_bucket
                                else fetcher_for(entry_package.bucket)
                            )
                            target = _canvas_target(target_fetcher.get_package_metadata(entry_package.package_name))
                        if target:
                            linked_targets.add(target)
                except Exception as exc:  # noqa: BLE001 - see above
                    logger.warning(
                        "Linked entry lookup failed",
                        package_name=package_name,
                        display_id=display_id,
                        error=str(exc),
                    )

        if direct_target:
            linked_targets.discard(direct_target)
        elif not linked_targets:
            logger.info(
                "Package event skipped - package metadata missing canvas target",
                package_name=package_name,
                top_hash=top_hash,
            )
            return RefreshResult(RefreshOutcome.SKIPPED_NO_CANVAS)

        updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

        def refresh(target: tuple[str, str]) -> dict:
            entry_id, canvas_id = target
            payload = Payload({"message": {"canvasId": canvas_id, "resourceId": entry_id}})
            return CanvasManager(active_benchling, config, payload).update_canvas(updated_at=updated_at)

        for linked_target in sorted(linked_targets):
            try:
                linked_result = refresh(linked_target)
                linked_error = None if linked_result.get("success") else linked_result.get("error")
            except Exception as exc:  # noqa: BLE001 - best-effort, as above
                linked_error = str(exc)
            if linked_error is not None:
                logger.warning(
                    "Linked entry canvas refresh failed",
                    package_name=package_name,
                    entry_id=linked_target[0],
                    canvas_id=linked_target[1],
                    error=str(linked_error),
                )

        if not direct_target:
            return RefreshResult(RefreshOutcome.SUCCESS)

        entry_id, canvas_id = direct_target
        result = refresh(direct_target)
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
