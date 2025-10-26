"""Package utilities for Benchling integration.

This module provides core package functionality:

- Package: Represents a Quilt package with URL generation capabilities

Responsibilities:
- Package URL generation (catalog, sync, upload URLs)
- Package instance creation

Does NOT handle:
- File listing (see package_files.py)
- Canvas UI (see canvas.py)
- Package content creation (see entry_packager.py)
- Package search/query (see package_query.py)
"""

from typing import Optional
from urllib.parse import quote

import structlog

logger = structlog.get_logger(__name__)


class Package:
    """Represents a Quilt package with URL generation capabilities.

    Responsibilities:
    - Store package identity (catalog, bucket, name)
    - Generate catalog URLs for package and files
    - Generate QuiltSync URLs for downloads
    - Generate upload/revise URLs

    This is a lightweight value object that knows how to construct URLs
    but does not fetch data or interact with the Quilt API.
    """

    def __init__(self, catalog_base_url: str, bucket: str, package_name: str):
        """Initialize a Package.

        Args:
            catalog_base_url: Quilt catalog URL (e.g., "nightly.quilttest.com")
            bucket: S3 bucket name
            package_name: Package name (e.g., "benchling/etr_123")
        """
        self.catalog_base_url = catalog_base_url
        self.bucket = bucket
        self.package_name = package_name

    @property
    def catalog_url(self) -> str:
        """Direct link to package in Quilt catalog.

        Returns:
            URL to view package in catalog

        Example:
            'https://nightly.quilttest.com/b/my-bucket/packages/benchling/etr_123'
        """
        return f"https://{self.catalog_base_url}/b/{self.bucket}/packages/{self.package_name}"

    def make_catalog_url(self, logical_key: str) -> str:
        """Generate catalog URL for a specific file in the package.

        Args:
            logical_key: File path within package

        Returns:
            Direct link to file in Quilt catalog

        Example:
            'https://nightly.quilttest.com/b/my-bucket/packages/benchling/etr_123/tree/data%2Ffile.csv'
        """
        encoded_key = quote(logical_key, safe="")
        base_url = f"https://{self.catalog_base_url}/b/{self.bucket}/packages/{self.package_name}"
        return f"{base_url}/tree/{encoded_key}"

    def make_sync_url(self, path: Optional[str] = None, version: Optional[str] = None) -> str:
        """Generate QuiltSync download URL for the package or a file within it.

        Args:
            path: Optional file path within package (e.g., "data/file.csv")
            version: Optional package version hash (defaults to ":latest")

        Returns:
            URL-encoded redirect URI for QuiltSync

        Example:
            >>> pkg.make_sync_url()
            'https://nightly.quilttest.com/redir/quilt%2Bs3%3A%2F%2F...'
        """
        # Build QuiltSync URI
        uri = f"quilt+s3://{self.bucket}#package={self.package_name}"

        # Add version or default to :latest
        if version:
            uri += f"@{version}"
        else:
            uri += ":latest"

        # Add path if provided
        if path:
            uri += f"&path={path}"

        # Always add catalog
        uri += f"&catalog={self.catalog_base_url}"

        # URL-encoded and create redirect URL
        encoded_uri = quote(uri, safe="")
        return f"https://{self.catalog_base_url}/redir/{encoded_uri}"

    @property
    def upload_url(self) -> str:
        """Generate upload/revise package URL for adding files.

        Returns:
            Quilt catalog URL with revisePackage action

        Example:
            'https://nightly.quilttest.com/b/my-bucket/packages/benchling/etr_123?action=revisePackage'
        """
        return f"{self.catalog_url}?action=revisePackage"
