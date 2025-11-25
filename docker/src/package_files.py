"""Package file operations for Benchling integration.

This module handles file-level operations on Quilt packages:

- PackageFile: Represents a file within a package (extends Package)
- PackageFileFetcher: Fetches file lists and metadata from packages

Responsibilities:
- List files in a package
- Fetch package metadata
- Provide file-specific URLs (catalog view, sync download)

Does NOT handle:
- Package search (see packages.py)
- Canvas UI (see canvas.py)
- Package creation (see entry_packager.py)
"""

import io
import json
import os
from typing import Dict, List, Optional, Tuple

import jsonlines
import structlog
from quilt3.backends import get_package_registry
from quilt3.packages import ManifestJSONDecoder
from quilt3.util import PhysicalKey

from .auth.role_manager import RoleManager
from .packages import Package

logger = structlog.get_logger(__name__)


class PackageFile(Package):
    """Represents a file in a Quilt package.

    Extends Package to add file-specific properties and URL generation.
    Inherits all Package URL generation methods and adds file-specific context.

    Responsibilities:
    - Store file metadata (path, size)
    - Provide human-readable file properties (name, size display)
    - Generate file-specific URLs (catalog view, sync download)
    """

    def __init__(self, logical_key: str, size: int, catalog_base_url: str, bucket: str, package_name: str):
        """Initialize a PackageFile.

        Args:
            logical_key: Full path in package (e.g., "data/file.csv")
            size: File size in bytes
            catalog_base_url: Quilt catalog URL (e.g., "nightly.quilttest.com")
            bucket: S3 bucket name
            package_name: Package name (e.g., "benchling/etr_123")
        """
        super().__init__(catalog_base_url, bucket, package_name)
        self.logical_key = logical_key
        self.size = size

    @property
    def name(self) -> str:
        """Get display name (last component of path)."""
        return self.logical_key.rsplit("/", maxsplit=1)[-1] if "/" in self.logical_key else self.logical_key

    @property
    def size_display(self) -> str:
        """Human-readable file size."""
        size = float(self.size)
        for unit in ["B", "KB", "MB", "GB"]:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"

    @property
    def catalog_url(self) -> str:
        """Direct link to file in Quilt catalog."""
        return self.make_catalog_url(self.logical_key)

    @property
    def sync_url(self) -> str:
        """QuiltSync download URL for this file."""
        return self.make_sync_url(path=self.logical_key)


class PackageFileFetcher:
    """Fetches file lists and metadata from Quilt packages.

    Responsibilities:
    - Browse package manifests directly from S3 (no local writes)
    - List all files in a package with metadata
    - Fetch package-level metadata
    - Create PackageFile instances from manifest entries

    Designed to be reusable and cacheable to avoid repeated API calls.
    Does not modify packages, only reads their contents.
    """

    def __init__(
        self,
        catalog_url: str,
        bucket: str,
        role_arn: Optional[str] = None,
        region: Optional[str] = None,
        role_manager: Optional[RoleManager] = None,
    ):
        """Initialize fetcher.

        Args:
            catalog_url: Quilt catalog URL (e.g., "nightly.quilttest.com")
            bucket: S3 bucket name
            role_arn: Optional IAM role ARN for cross-account access
            region: Optional AWS region (defaults to AWS_REGION env or us-east-1)
            role_manager: Optional RoleManager instance (used in tests)
        """
        self.catalog_url = catalog_url
        self.bucket = bucket
        self.logger = structlog.get_logger(__name__)
        self.role_manager = role_manager or RoleManager(
            role_arn=role_arn,
            region=region or os.getenv("AWS_REGION", "us-east-1"),
        )

    def _get_registry(self):
        """Create an S3-backed package registry."""
        return get_package_registry(f"s3://{self.bucket}")

    def _fetch_physical_key_bytes(self, physical_key: PhysicalKey) -> bytes:
        """Read bytes from a PhysicalKey without touching the local filesystem."""
        if physical_key.is_local():
            with open(physical_key.path, "rb") as file:
                return file.read()

        s3_client = self.role_manager.get_s3_client()
        params = {"Bucket": physical_key.bucket, "Key": physical_key.path}
        if physical_key.version_id:
            params["VersionId"] = physical_key.version_id
        response = s3_client.get_object(**params)
        return response["Body"].read()

    def _load_manifest_data(self, package_name: str) -> Tuple[Dict, List[Dict]]:
        """Load manifest metadata and entries for the latest package version."""
        registry = self._get_registry()

        top_hash = (
            self._fetch_physical_key_bytes(registry.pointer_latest_pk(package_name))
            .decode("utf-8")
            .strip()
        )
        manifest_bytes = self._fetch_physical_key_bytes(registry.manifest_pk(package_name, top_hash))

        manifest_stream = io.StringIO(manifest_bytes.decode("utf-8"))
        reader = jsonlines.Reader(manifest_stream, loads=ManifestJSONDecoder().decode)

        manifest_meta = reader.read()
        entries = list(reader)

        return manifest_meta, entries

    @staticmethod
    def _is_valid_file_entry(entry: Dict) -> bool:
        """Return True if manifest entry represents a real file."""
        logical_key = entry.get("logical_key")
        physical_keys = entry.get("physical_keys") or []

        if not logical_key or logical_key.startswith(".quilt/"):
            return False

        return bool(physical_keys)

    def _parse_entry_json(self, entries: List[Dict]) -> Optional[dict]:
        """Load entry.json contents if present."""
        entry_json = next((entry for entry in entries if entry.get("logical_key") == "entry.json"), None)
        if not entry_json:
            return None

        physical_keys = entry_json.get("physical_keys") or []
        if not physical_keys:
            return None

        try:
            physical_key = PhysicalKey.from_url(physical_keys[0])
            data = self._fetch_physical_key_bytes(physical_key)
            return json.loads(data.decode("utf-8"))
        except Exception as exc:  # pragma: no cover - defensive logging
            self.logger.warning("Failed to load entry.json", error=str(exc))
            return None

    def get_package_files(
        self,
        package_name: str,
        max_files: Optional[int] = None,
    ) -> List[PackageFile]:
        """
        Fetch file list from Quilt package.

        Args:
            package_name: Package name (e.g., "benchling/etr_123")
            max_files: Optional limit on number of files to return

        Returns:
            List of PackageFile objects

        Raises:
            ValueError: If package doesn't exist
            Exception: If fetching fails
        """
        self.logger.info("Fetching package files", package_name=package_name)

        try:
            _, entries = self._load_manifest_data(package_name)

            files: List[PackageFile] = []
            for entry in entries:
                if not self._is_valid_file_entry(entry):
                    continue

                logical_key = entry["logical_key"]
                try:
                    size = int(entry.get("size", 0) or 0)
                except (TypeError, ValueError):
                    size = 0

                files.append(
                    PackageFile(
                        logical_key=logical_key,
                        size=size,
                        catalog_base_url=self.catalog_url,
                        bucket=self.bucket,
                        package_name=package_name,
                    )
                )

                if max_files and len(files) >= max_files:
                    break

            self.logger.info(
                "Package files fetched",
                package_name=package_name,
                file_count=len(files),
            )

            return sorted(files, key=lambda f: f.logical_key)

        except Exception as e:
            self.logger.error(
                "Failed to fetch package files",
                package_name=package_name,
                error=str(e),
            )
            raise

    def get_package_metadata(self, package_name: str) -> dict:
        """
        Fetch package-level user metadata.

        Args:
            package_name: Package name

        Returns:
            User metadata dict (from entry.json or package metadata)

        Raises:
            ValueError: If package doesn't exist
        """
        self.logger.info("Fetching package metadata", package_name=package_name)

        try:
            manifest_meta, entries = self._load_manifest_data(package_name)

            entry_metadata = self._parse_entry_json(entries)
            if entry_metadata is not None:
                self.logger.info("Fetched entry.json metadata", package_name=package_name)
                return entry_metadata

            metadata = manifest_meta.get("user_meta") or {}
            self.logger.info("Fetched package metadata", package_name=package_name)
            return metadata

        except Exception as e:
            self.logger.error(
                "Failed to fetch package metadata",
                package_name=package_name,
                error=str(e),
            )
            raise
