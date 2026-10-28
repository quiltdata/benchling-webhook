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
from .package_files import SEAL_FILE, has_staged_seal
from .package_query import ELN_ENTRY_KEY
from .packages import ENTRY_PACKAGE_NOTE, is_entry_package
from .packaging_status import check_workflow

if TYPE_CHECKING:
    from .config import Config

logger = structlog.get_logger(__name__)

MAX_LINK_ATTEMPTS = 3
MAX_HISTORY_KEY_ATTEMPTS = 100


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
    ) -> Optional[tuple[bytes, str]]:
        """Return the linked manifest and its top hash, or None if already linked."""
        try:
            package = QuiltPackage._load(io.StringIO(manifest.decode("utf-8")))
        except Exception as exc:
            raise RelatedPackageLinkError(f"Could not read the current package manifest: {exc}") from exc

        if SEAL_FILE in package:
            raise RelatedPackageLinkError(
                f"Package {package_name!r} is sealed by an accepted review and cannot be linked."
            )

        metadata = package.meta
        if not isinstance(metadata, dict):
            raise RelatedPackageLinkError(f"Package metadata must be an object, not {type(metadata).__name__}.")
        if is_entry_package(metadata):
            raise RelatedPackageLinkError(f"Package {package_name!r} {ENTRY_PACKAGE_NOTE}")

        package_key = self.config.package_key
        updated_metadata, changed = self._updated_metadata(metadata, package_key, display_id)
        if not changed:
            return None

        message = f"Linked to {display_id} from Benchling"
        package.set_meta(updated_metadata)
        package._set_commit_message(message)

        # The revision keeps the package's workflow stamp, so it must pass that workflow.
        stamp = package._workflow
        workflow = stamp.get("id") if isinstance(stamp, dict) else ""
        rejection = check_workflow(
            self.s3_client,
            self.config.s3_bucket_name,
            workflow,
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
        return output.getvalue(), top_hash

    @staticmethod
    def _is_conflict(exc: ClientError) -> bool:
        code = exc.response.get("Error", {}).get("Code")
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return code in {"PreconditionFailed", "ConditionalRequestConflict", "412"} or status == 412

    def _has_staged_seal(self, package_name: str, bucket: str) -> bool:
        try:
            return has_staged_seal(self.s3_client, bucket, package_name)
        except ClientError as exc:
            raise RelatedPackageLinkError(f"Could not verify whether {package_name!r} is sealed: {exc}") from exc

    def _reconcile_latest(
        self,
        bucket: str,
        latest_key: str,
        top_hash: str,
        previous_etag: str,
    ) -> str:
        """Classify an ambiguous latest write as committed, unchanged, or unknown."""
        try:
            response = self.s3_client.get_object(Bucket=bucket, Key=latest_key)
            current_hash = self._read_body(response).decode("utf-8").strip()
            if current_hash == top_hash:
                return "committed"
            if response.get("ETag") == previous_etag:
                return "unchanged"
            # Another revision won after the request. This write may have been
            # committed and immediately superseded, so its history must remain.
            return "unknown"
        except Exception as exc:  # noqa: BLE001 - caller must retain history when outcome is unknown
            logger.warning("Could not reconcile package latest pointer", bucket=bucket, key=latest_key, error=str(exc))
            return "unknown"

    def _reserve_history_pointer(self, registry, package_name: str, bucket: str, top_hash: str) -> tuple[str, str]:
        """Write a unique Quilt v1 history pointer without replacing another revision."""
        first_timestamp = int(time.time())
        for offset in range(MAX_HISTORY_KEY_ATTEMPTS):
            key = registry.pointer_pk(package_name, str(first_timestamp + offset)).path
            try:
                response = self.s3_client.put_object(
                    Bucket=bucket,
                    Key=key,
                    Body=top_hash.encode("utf-8"),
                    IfNoneMatch="*",
                )
            except ClientError as exc:
                if self._is_conflict(exc):
                    continue
                raise RelatedPackageLinkError(f"Could not write package revision history: {exc}") from exc
            etag = response.get("ETag")
            if not etag:
                raise RelatedPackageLinkError("S3 did not return an ETag for the package history pointer.")
            return key, etag
        raise RelatedPackageLinkError(
            f"Could not allocate a unique package history timestamp after {MAX_HISTORY_KEY_ATTEMPTS} attempts."
        )

    def _discard_history_pointer(self, bucket: str, key: str, etag: str) -> None:
        """Best-effort removal of a pointer reserved for a failed latest update."""
        try:
            self.s3_client.delete_object(Bucket=bucket, Key=key, IfMatch=etag)
        except Exception as exc:  # noqa: BLE001 - preserve the original link conflict
            logger.warning("Could not remove unused package history pointer", bucket=bucket, key=key, error=str(exc))

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

        if self._has_staged_seal(package_name, bucket):
            raise RelatedPackageLinkError(
                f"Package {package_name!r} is sealed by an accepted review and cannot be linked."
            )

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
            built = self._build_revision(self._read_body(manifest_response), package_name, display_id)
            if built is None:
                return LinkResult(package_name, bucket, current_top_hash, False)
            revision, new_top_hash = built

            new_manifest_key = registry.manifest_pk(package_name, new_top_hash).path
            self.s3_client.put_object(
                Bucket=bucket,
                Key=new_manifest_key,
                Body=revision,
                ContentType="application/x-jsonlines",
            )

            # Advance latest only if it still names the revision read above.
            history_key, history_etag = self._reserve_history_pointer(registry, package_name, bucket, new_top_hash)
            try:
                # Acceptance can race the first check.
                if self._has_staged_seal(package_name, bucket):
                    raise RelatedPackageLinkError(
                        f"Package {package_name!r} was sealed while linking and cannot be revised."
                    )
                self.s3_client.put_object(
                    Bucket=bucket,
                    Key=latest_key,
                    Body=new_top_hash.encode("utf-8"),
                    IfMatch=current_etag,
                )
            except RelatedPackageLinkError:
                self._discard_history_pointer(bucket, history_key, history_etag)
                raise
            except Exception as exc:
                # Even a 412 may follow an SDK retry of a write that committed.
                reconciliation = self._reconcile_latest(bucket, latest_key, new_top_hash, current_etag)
                if reconciliation == "committed":
                    return LinkResult(package_name, bucket, new_top_hash, True)
                if reconciliation == "unchanged":
                    self._discard_history_pointer(bucket, history_key, history_etag)
                if isinstance(exc, ClientError) and self._is_conflict(exc) and attempt < MAX_LINK_ATTEMPTS:
                    logger.info(
                        "Related package changed while linking; retrying",
                        package_name=package_name,
                        bucket=bucket,
                        attempt=attempt,
                        reconciliation=reconciliation,
                    )
                    continue
                raise RelatedPackageLinkError(f"Could not advance the package revision: {exc}") from exc

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
