"""Multi-bucket routing for Benchling entries.

Resolves the target S3 bucket for an entry from the optional
``pkg_bucket_map`` secret parameter. The map keys are Benchling folder IDs
(``lib_…``/``fld_…``) or project IDs (``src_…``); values are S3 bucket names.
An entry is routed by its folder first, then its project; entries that match
neither fall back to the default ``user_bucket``.

This keeps routing configuration in AWS Secrets Manager (rotatable at runtime,
no redeploy) and mirrors how the rest of the package configuration is
delivered to the container.
"""

from typing import Any, Dict, Optional

import structlog

logger = structlog.get_logger(__name__)


def resolve_bucket_for_entry(
    entry_data: Optional[Dict[str, Any]],
    bucket_map: Dict[str, str],
    default_bucket: str,
) -> str:
    """Return the target S3 bucket for a Benchling entry.

    Args:
        entry_data: Entry data dict from the Benchling API (may be None when
            the entry has not been fetched, e.g. canvas-only flows).
        bucket_map: Mapping of Benchling folder/project IDs to bucket names.
        default_bucket: Bucket used when no mapping matches.

    Returns:
        The mapped bucket name, or ``default_bucket`` when the map is empty,
        the entry is unavailable, or neither the folder nor the project ID is
        in the map.
    """
    if not bucket_map or not entry_data:
        return default_bucket

    # The SDK's to_dict() serializes with API (camelCase) keys, while fields
    # merged from SDK object attributes are snake_case — accept both.
    folder_id = entry_data.get("folder_id") or entry_data.get("folderId")
    if isinstance(folder_id, str) and folder_id in bucket_map:
        bucket = bucket_map[folder_id]
        logger.info(
            "Routing entry to mapped bucket by folder",
            entry_id=entry_data.get("id"),
            folder_id=folder_id,
            bucket=bucket,
        )
        return bucket

    project_id = entry_data.get("project_id") or entry_data.get("projectId")
    if isinstance(project_id, str) and project_id in bucket_map:
        bucket = bucket_map[project_id]
        logger.info(
            "Routing entry to mapped bucket by project",
            entry_id=entry_data.get("id"),
            project_id=project_id,
            bucket=bucket,
        )
        return bucket

    logger.debug(
        "No bucket mapping matched; using default bucket",
        entry_id=entry_data.get("id") if entry_data else None,
        folder_id=folder_id,
        project_id=project_id,
        default_bucket=default_bucket,
    )
    return default_bucket
