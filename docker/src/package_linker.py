"""Create metadata-only Quilt revisions that link packages to Benchling entries."""

import copy
import io
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Optional

import structlog
from botocore.exceptions import ClientError
from quilt3 import Package as QuiltPackage
from quilt3.backends import get_package_registry
from quilt3.util import validate_package_name

from .auth.role_manager import RoleManager
from .package_query import ELN_ENTRY_KEY
from .packaging_status import check_workflow

if TYPE_CHECKING:
    from .config import Config

logger = structlog.get_logger(__name__)

MAX_LINK_ATTEMPTS = 3


class RelatedPackageLinkError(RuntimeError):
    """A related package could not safely be linked."""


class RelatedPackageWorkflowError(RelatedPackageLinkError):
    """The bucket workflow rejected the metadata-only revision."""


@dataclass(frozen=True)
class LinkResult:
    """Outcome of a related-package link operation."""

    package_name: str
    bucket: str
    top_hash: str
    changed: bool


class PackageLinker:
    """Patch package metadata while preserving every package entry and hash.

    Quilt's public ``Package.push`` uses its process-global boto session. The
    webhook may instead use an assumed write role, so this class uses Quilt only
    to parse, hash, and serialize the manifest, and performs the three registry
    writes through the role-scoped S3 client.
    """

    def __init__(
        self,
        config: "Config",
        *,
        role_manager: Optional[RoleManager] = None,
        s3_client: Any = None,
    ) -> None:
        self.config = config
        self.role_manager = role_manager or RoleManager(
            role_arn=config.quilt_write_role_arn,
            region=config.aws_region,
        )
        self._s3_client = s3_client

    @property
    def s3_client(self):
        if self._s3_client is None:
            self._s3_client = self.role_manager.get_s3_client()
        return self._s3_client

    @staticmethod
    def _read_body(response: dict) -> bytes:
        body = response["Body"].read()
        return body if isinstance(body, bytes) else body.encode("utf-8")

    @staticmethod
    def _updated_metadata(metadata: dict, package_key: str, display_id: str) -> tuple[dict, bool]:
        """Return non-destructively linked metadata and whether it changed."""
        updated = copy.deepcopy(metadata)
        configured_value = updated.get(package_key)
        eln_entries = updated.get(ELN_ENTRY_KEY)

        if configured_value == display_id:
            return updated, False
        if isinstance(eln_entries, list) and display_id in eln_entries:
            return updated, False
        if isinstance(eln_entries, str) and eln_entries == display_id:
            return updated, False

        if isinstance(eln_entries, list):
            updated[ELN_ENTRY_KEY] = [*eln_entries, display_id]
        elif isinstance(eln_entries, str):
            # Preserve a hand-entered scalar while moving to the profile's list shape.
            updated[ELN_ENTRY_KEY] = [eln_entries, display_id]
        elif eln_entries is not None:
            raise RelatedPackageLinkError(
                f"Package metadata {ELN_ENTRY_KEY!r} must be a string or list, not " f"{type(eln_entries).__name__}."
            )
        elif package_key == ELN_ENTRY_KEY:
            updated[ELN_ENTRY_KEY] = [display_id]
        elif configured_value in (None, ""):
            updated[package_key] = display_id
        else:
            # Do not overwrite a link to another entry. The RO-Crate linkage key
            # supports multiple entries and is already understood by the Canvas.
            updated[ELN_ENTRY_KEY] = [display_id]

        return updated, True

    @staticmethod
    def _workflow_entries(package: QuiltPackage) -> list[dict]:
        return [
            {
                "logical_key": logical_key,
                "size": entry.size,
                "meta": entry.meta,
            }
            for logical_key, entry in package.walk()
        ]

    def _build_revision(
        self,
        manifest: bytes,
        package_name: str,
        display_id: str,
    ) -> tuple[bytes, str, bool]:
        try:
            package = QuiltPackage._load(io.StringIO(manifest.decode("utf-8")))
        except Exception as exc:
            raise RelatedPackageLinkError(f"Could not read the current package manifest: {exc}") from exc

        metadata = package.meta
        if not isinstance(metadata, dict):
            raise RelatedPackageLinkError(f"Package metadata must be an object, not {type(metadata).__name__}.")

        package_key = self.config.package_key
        updated_metadata, changed = self._updated_metadata(metadata, package_key, display_id)
        if not changed:
            # The caller returns the existing top hash without publishing a duplicate revision.
            return manifest, "", False

        message = f"Linked to {display_id} from Benchling"
        package.set_meta(updated_metadata)
        package._set_commit_message(message)

        rejection = check_workflow(
            self.s3_client,
            self.config.s3_bucket_name,
            getattr(self.config, "workflow", "") or "",
            package_name,
            message,
            updated_metadata,
            manifest_entries=self._workflow_entries(package),
            strict=True,
        )
        if rejection:
            raise RelatedPackageWorkflowError(f"Quilt rejected this revision: {rejection}")

        top_hash = package._calculate_top_hash(package._meta, package.walk())
        output = io.BytesIO()
        package._dump(output)
        return output.getvalue(), top_hash, True

    @staticmethod
    def _is_conflict(exc: ClientError) -> bool:
        code = exc.response.get("Error", {}).get("Code")
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return code in {"PreconditionFailed", "ConditionalRequestConflict", "412"} or status == 412

    def link(self, package_name: str, bucket: str, display_id: str) -> LinkResult:
        """Publish a metadata-only revision linking ``package_name`` to ``display_id``."""
        writable_bucket = self.config.s3_bucket_name
        if not writable_bucket or bucket != writable_bucket:
            raise RelatedPackageLinkError(
                f"Package {package_name!r} is in read-only bucket {bucket!r}; "
                f"the webhook may only revise {writable_bucket or '(no configured bucket)'!r}."
            )
        try:
            validate_package_name(package_name)
        except Exception as exc:
            raise RelatedPackageLinkError(f"Invalid related package name {package_name!r}: {exc}") from exc

        registry = get_package_registry(f"s3://{bucket}")
        latest_key = registry.pointer_latest_pk(package_name).path

        for attempt in range(1, MAX_LINK_ATTEMPTS + 1):
            latest_response = self.s3_client.get_object(Bucket=bucket, Key=latest_key)
            current_top_hash = self._read_body(latest_response).decode("utf-8").strip()
            current_etag = latest_response.get("ETag")
            if not current_top_hash or not current_etag:
                raise RelatedPackageLinkError(f"Package {package_name!r} has an invalid latest pointer.")

            manifest_key = registry.manifest_pk(package_name, current_top_hash).path
            manifest_response = self.s3_client.get_object(Bucket=bucket, Key=manifest_key)
            revision, new_top_hash, changed = self._build_revision(
                self._read_body(manifest_response),
                package_name,
                display_id,
            )
            if not changed:
                return LinkResult(package_name, bucket, current_top_hash, False)

            new_manifest_key = registry.manifest_pk(package_name, new_top_hash).path
            self.s3_client.put_object(
                Bucket=bucket,
                Key=new_manifest_key,
                Body=revision,
                ContentType="application/x-jsonlines",
            )

            # Match Quilt's v1 registry history pointer, then atomically advance
            # latest only if the revision we read is still current.
            timestamp_key = registry.pointer_pk(package_name, str(int(time.time()))).path
            self.s3_client.put_object(Bucket=bucket, Key=timestamp_key, Body=new_top_hash.encode("utf-8"))
            try:
                self.s3_client.put_object(
                    Bucket=bucket,
                    Key=latest_key,
                    Body=new_top_hash.encode("utf-8"),
                    IfMatch=current_etag,
                )
            except ClientError as exc:
                if not self._is_conflict(exc) or attempt == MAX_LINK_ATTEMPTS:
                    raise RelatedPackageLinkError(f"Could not advance the package revision: {exc}") from exc
                logger.info(
                    "Related package changed while linking; retrying",
                    package_name=package_name,
                    bucket=bucket,
                    attempt=attempt,
                )
                continue

            logger.info(
                "Linked related package",
                package_name=package_name,
                bucket=bucket,
                display_id=display_id,
                previous_top_hash=current_top_hash,
                top_hash=new_top_hash,
            )
            return LinkResult(package_name, bucket, new_top_hash, True)

        raise RelatedPackageLinkError(f"Package {package_name!r} changed too often to link safely.")
