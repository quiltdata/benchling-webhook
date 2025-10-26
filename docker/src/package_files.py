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

from typing import List, Optional

import quilt3
import structlog

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
    - Browse package contents via quilt3.Package.browse()
    - List all files in a package with metadata
    - Fetch package-level metadata
    - Create PackageFile instances from browse results

    Designed to be reusable and cacheable to avoid repeated API calls.
    Does not modify packages, only reads their contents.
    """

    def __init__(self, catalog_url: str, bucket: str):
        """Initialize fetcher.

        Args:
            catalog_url: Quilt catalog URL (e.g., "nightly.quilttest.com")
            bucket: S3 bucket name
        """
        self.catalog_url = catalog_url
        self.bucket = bucket
        self.logger = structlog.get_logger(__name__)

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
            # Browse package
            pkg = quilt3.Package.browse(package_name, registry=f"s3://{self.bucket}")

            # Collect all files (not directories)
            files = []
            for logical_key, entry in pkg.walk():
                # Skip metadata files (internal to Quilt)
                if logical_key.startswith(".quilt/"):
                    continue

                # Get file size
                size = entry.size if hasattr(entry, "size") else 0

                files.append(
                    PackageFile(
                        logical_key=logical_key,
                        size=size,
                        catalog_base_url=self.catalog_url,
                        bucket=self.bucket,
                        package_name=package_name,
                    )
                )

                # Respect max_files limit
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
            pkg = quilt3.Package.browse(package_name, registry=f"s3://{self.bucket}")

            # Try to read entry.json if it exists
            if "entry.json" in pkg:
                metadata = pkg["entry.json"]()  # Fetch and deserialize
                self.logger.info("Fetched entry.json metadata", package_name=package_name)
                return metadata

            # Otherwise return package-level metadata
            metadata = pkg.meta or {}
            self.logger.info("Fetched package metadata", package_name=package_name)
            return metadata

        except Exception as e:
            self.logger.error(
                "Failed to fetch package metadata",
                package_name=package_name,
                error=str(e),
            )
            raise
