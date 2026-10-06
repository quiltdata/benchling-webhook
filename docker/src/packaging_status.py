"""Pre-check an entry package against the bucket's Quilt workflow, and record the outcome.

The packager validates against the bucket's workflow and has no channel back, so a rejected
package would otherwise leave the canvas saying "not created" forever (#406).
"""

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jsonschema
import structlog
import yaml
from botocore.exceptions import ClientError
from quilt3.backends import get_package_registry
from quilt3.util import PhysicalKey, QuiltException
from quilt3.workflows import ConfigurationError, WorkflowConfig, WorkflowValidationError

logger = structlog.get_logger(__name__)

STALL_AFTER = timedelta(minutes=10)


def status_key(package_name: str) -> str:
    # Beside the source prefix, never inside it: pkgpush packages everything under `<name>/`.
    return f"{package_name}.packaging_status.json"


def _read(s3_client: Any, pk: PhysicalKey) -> bytes:
    params = {"Bucket": pk.bucket, "Key": pk.path}
    if pk.version_id:
        params["VersionId"] = pk.version_id
    return s3_client.get_object(**params)["Body"].read()


class _S3WorkflowConfig(WorkflowConfig):
    """quilt3's workflow config, reading schemas through the webhook's assumed role."""

    def __init__(self, config: dict, physical_key: PhysicalKey, s3_client: Any):
        super().__init__(config, physical_key)
        self._s3_client = s3_client

    def load_schema(self, schema_pk: PhysicalKey) -> tuple[bytes, PhysicalKey]:
        if schema_pk.is_local():
            raise ConfigurationError(f"Local schema {schema_pk} can't be used on the remote registry.")
        try:
            return _read(self._s3_client, schema_pk), schema_pk
        except ClientError as e:
            raise ConfigurationError(f"Couldn't load schema at {schema_pk}.") from e


def check_workflow(
    s3_client: Any,
    bucket: str,
    workflow: str,
    package_name: str,
    message: str,
    metadata: dict,
    entries: Optional[list[dict]],
) -> Optional[str]:
    """Return why the packager would reject this package, or None if it would accept it or we can't tell.

    `workflow` follows the packager message: "" means the bucket default.
    `entries` come from `list_entries`; None skips the entries schema.
    """
    workflow_arg: Any = workflow or ...
    conf_pk = get_package_registry(f"s3://{bucket}").workflow_conf_pk
    try:
        data = yaml.safe_load(_read(s3_client, conf_pk))
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") not in {"NoSuchKey", "404"}:
            logger.warning("Workflow pre-check skipped: config unreadable", bucket=bucket, error=str(e))
            return None
        if workflow_arg is ...:
            return None
        return f"{workflow!r} workflow is specified, but no workflows config exist."
    except Exception as e:  # noqa: BLE001 - not YAML, or a transient read error: let the packager decide
        logger.warning("Workflow pre-check skipped: config unreadable", bucket=bucket, error=str(e))
        return None

    try:
        validator = _S3WorkflowConfig(data, conf_pk, s3_client).get_workflow_validator(workflow_arg)
        validator.validate_message(message)
        validator.validate_name(package_name)
        validator.validate_metadata(metadata)
        if validator.entries_validator is not None and entries is not None:
            try:
                validator.entries_validator.validate(entries)
            except jsonschema.ValidationError as e:
                raise WorkflowValidationError.from_schema_validation_error(
                    "Package entries failed validation", e
                ) from e
    except ConfigurationError as e:
        # A config or schema we can't load: let the packager decide; the stall backstop covers it.
        logger.warning("Workflow pre-check skipped", bucket=bucket, error=str(e))
        return None
    except QuiltException as e:
        return e.message
    except Exception as e:  # noqa: BLE001 - a broken config must never block packaging
        logger.warning("Workflow pre-check skipped", bucket=bucket, error=str(e))
        return None
    return None


def list_entries(s3_client: Any, bucket: str, package_name: str) -> Optional[list[dict]]:
    """The entries pkgpush packages from `<package_name>/`, earlier runs' leftovers included; None if unlistable."""
    prefix = f"{package_name}/"
    entries: list[dict] = []
    kwargs = {"Bucket": bucket, "Prefix": prefix}
    try:
        while True:
            page = s3_client.list_objects_v2(**kwargs)
            entries += [
                {"logical_key": obj["Key"][len(prefix) :], "size": obj["Size"], "meta": {}}
                for obj in page.get("Contents", [])
                if not obj["Key"].endswith("/")
            ]
            if not page.get("IsTruncated"):
                # quilt3 walks segment by segment: `a/b` before `a.txt`, unlike S3's key order.
                return sorted(entries, key=lambda e: e["logical_key"].split("/"))
            kwargs["ContinuationToken"] = page["NextContinuationToken"]
    except Exception as e:  # noqa: BLE001 - unlistable: skip the entries schema rather than guess
        logger.warning("Workflow pre-check: prefix unlistable", bucket=bucket, error=str(e))
        return None


def write_status(s3_client: Any, bucket: str, package_name: str, state: str, **fields: Any) -> None:
    body = {"state": state, "at": datetime.now(timezone.utc).isoformat(), **fields}
    try:
        s3_client.put_object(Bucket=bucket, Key=status_key(package_name), Body=json.dumps(body).encode("utf-8"))
    except Exception as e:  # noqa: BLE001 - the status is advisory and must never block packaging
        logger.warning("Packaging status not written", bucket=bucket, package=package_name, error=str(e))


def read_status(s3_client: Any, bucket: str, package_name: str) -> Optional[dict]:
    try:
        status = json.loads(s3_client.get_object(Bucket=bucket, Key=status_key(package_name))["Body"].read())
    except Exception:  # noqa: BLE001 - no status (or unreadable) renders as today's canvas
        return None
    return status if isinstance(status, dict) else None


def unresolved(status: dict, latest_modified: Optional[datetime], now: Optional[datetime] = None) -> Optional[str]:
    """ "rejected", or "stalled" STALL_AFTER after a request, while no revision has landed since; else None."""
    try:
        # S3 LastModified has whole seconds.
        at = datetime.fromisoformat(status["at"]).replace(microsecond=0)
    except (KeyError, TypeError, ValueError):
        return None
    if latest_modified is not None and latest_modified >= at:
        return None
    if status.get("state") == "rejected":
        return "rejected"
    if status.get("state") == "requested" and (now or datetime.now(timezone.utc)) - at > STALL_AFTER:
        return "stalled"
    return None
