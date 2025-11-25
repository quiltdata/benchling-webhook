"""Canvas management for Benchling integration.

This module handles the Canvas UI layer for Benchling integration, delegating
package operations to specialized services.
"""

import threading
from typing import Any, List, Optional

import structlog
from benchling_api_client.v2.stable.models.app_canvas_update import AppCanvasUpdate
from benchling_sdk.benchling import Benchling
from benchling_sdk.models import Entry

from . import canvas_blocks as blocks
from . import canvas_formatting as fmt
from .config import Config
from .package_files import PackageFile, PackageFileFetcher
from .package_query import PackageQuery
from .packages import Package
from .pagination import PageState, paginate_items
from .payload import Payload
from .version import __version__

logger = structlog.get_logger(__name__)


class CanvasManager:
    """Manages Canvas UI creation and updates for Benchling integration.

    Responsibilities:
    - Canvas UI block creation (markdown, buttons, sections)
    - Canvas updates via Benchling API
    - Navigation state management
    - Markdown content formatting

    Delegates to:
    - Package: URL generation
    - PackageQuery: Package discovery via Athena database queries
    - PackageFileFetcher: File listing and metadata retrieval
    """

    def __init__(
        self,
        benchling: Benchling,
        config: Config,
        payload: Payload,
        package_query: Optional[PackageQuery] = None,
        package_file_fetcher: Optional[PackageFileFetcher] = None,
    ):
        """Initialize CanvasManager with required dependencies.

        Args:
            benchling: Benchling SDK client
            config: Application configuration
            payload: Webhook payload
            package_query: Optional PackageQuery instance (created if not provided)
            package_file_fetcher: Optional PackageFileFetcher instance (created if not provided)
        """
        self.benchling = benchling
        self.config = config
        self.payload = payload
        self._entry = None
        self._package = None
        self._errors: List[str] = []  # Track errors to display in notification section
        self._linked_packages: List[Package] = []  # Track linked packages for use in blocks

        # Dependency injection with fallback to default instances

        self._package_query = package_query or PackageQuery(
            bucket=config.s3_bucket_name,
            catalog_url=config.quilt_catalog,
            database=config.quilt_database,
            config=config,
        )
        self._package_file_fetcher = package_file_fetcher or PackageFileFetcher(
            catalog_url=config.quilt_catalog,
            bucket=config.s3_bucket_name,
            role_arn=config.quilt_write_role_arn,
            region=config.aws_region,
        )

    @property
    def entry_id(self) -> str:
        """Extract entry_id from payload."""
        return self.payload.entry_id

    @property
    def entry(self) -> Entry:
        """Fetch entry info."""
        if self._entry is None:
            self._entry = self.benchling.entries.get_entry_by_id(self.entry_id)
        return self._entry

    @property
    def canvas_id(self) -> str:
        """Extract canvas_id from payload."""
        canvas_id = self.payload.canvas_id
        if not canvas_id:
            raise ValueError("canvas_id is required in payload")
        return canvas_id

    @property
    def package(self) -> Package:
        """Get Package instance for this entry."""
        if self._package is None:
            # Ensure display_id is set on payload for package naming
            if not self.payload.display_id:
                self.payload.set_display_id(self.entry.display_id)
            self._package = Package(
                catalog_base_url=self.config.quilt_catalog,
                bucket=self.config.s3_bucket_name,
                package_name=self.payload.package_name(self.config.s3_prefix, use_display_id=True),
            )
        return self._package

    @property
    def package_name(self) -> str:
        """Generate package name for the entry."""
        return self.package.package_name

    @property
    def catalog_url(self) -> str:
        """Generate Quilt catalog URL for the package."""
        return self.package.catalog_url

    def raw_sync_uri(self, path: Optional[str] = None, version: Optional[str] = None) -> str:
        """Generate QuiltSync URI for the package (unencoded).

        Args:
            path: Optional file path within the package (e.g., "README.md")
            version: Optional package version hash

        Returns:
            QuiltSync URI with format:
            quilt+s3://bucket#package=name[@version][&path=file][&catalog=host]
            If version is not specified, defaults to :latest

        Example:
            quilt+s3://bucket#package=benchdock/entry@hash&path=README.md&catalog=nightly.quilttest.com
        """
        # Build QuiltSync URI
        uri = f"quilt+s3://{self.config.s3_bucket_name}#package={self.package_name}"

        # Add version if provided, otherwise default to :latest
        if version:
            uri += f"@{version}"
        else:
            uri += ":latest"

        # Add path if provided
        if path:
            uri += f"&path={path}"

        # Always add catalog
        uri += f"&catalog={self.config.quilt_catalog}"

        return uri

    def sync_uri(self, path: Optional[str] = None, version: Optional[str] = None) -> str:
        """Generate URL-encoded redirect URI for the package.

        Args:
            path: Optional file path within the package (e.g., "README.md")
            version: Optional package version hash

        Returns:
            URL-encoded redirect URI for the Quilt catalog

        Example:
            https://nightly.quilttest.com/redir/quilt%2Bs3%3A%2F%2F...
        """
        return self.package.make_sync_url(path=path, version=version)

    def upload_url(self) -> str:
        """Generate upload/revise package URL for adding files to the package.

        Returns:
            Quilt catalog URL with revisePackage action

        Example:
            https://nightly.quilttest.com/b/bucket/packages/name?action=revisePackage
        """
        return self.package.upload_url

    def _make_markdown_content(self) -> str:
        """Generate markdown content for the Canvas.

        Composes the full canvas content in the following order:
        1. Primary package information
        2. Notice and status
        3. Linked packages (if any)
        4. Error notifications (if any)

        Returns:
            Formatted markdown string with package links
        """
        # Primary package header
        content = fmt.format_package_header(
            package_name=self.package_name,
            display_id=self.entry.display_id,
            catalog_url=self.catalog_url,
            sync_url=self.sync_uri(),
        )

        # Linked packages
        try:
            search_result = self._package_query.find_unique_packages(
                key=self.config.package_key, value=self.entry.display_id
            )
            linked_packages = search_result["packages"]

            # Filter out the primary package
            linked_packages = [pkg for pkg in linked_packages if pkg.package_name != self.package_name]

            # Store linked packages as instance variable
            self._linked_packages = linked_packages

            content += fmt.format_linked_packages(linked_packages)

        except Exception as e:
            error_msg = f"Failed to search for linked packages: {str(e)}"
            self._errors.append(error_msg)
            # Infrastructure failures (Athena, permissions) should be logged as errors
            logger.error(
                "Failed to search for linked packages - may indicate infrastructure issue",
                entry_id=self.entry_id,
                display_id=self.entry.display_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            # Continue without linked packages if search fails

        # Error notifications (at the bottom)
        content += fmt.format_error_notification(self._errors)

        return content

    def _make_blocks(self) -> list:
        """Create UI blocks for the Canvas."""
        markdown_content = self._make_markdown_content()
        markdown_block = blocks.create_markdown_block(markdown_content, "md1")

        result = [
            *blocks.create_main_navigation_buttons(self.entry_id),  # Buttons at the top
            markdown_block,
        ]

        # Add linked package browse buttons if any exist
        if self._linked_packages:
            result.extend(blocks.create_linked_package_browse_buttons(self.entry_id, self._linked_packages))

        # Add footer as markdown block
        footer_markdown = fmt.format_canvas_footer(
            version=__version__,
            quilt_host=self.config.quilt_catalog,
            bucket=self.config.s3_bucket_name,
        )
        result.append(blocks.create_markdown_block(footer_markdown, "md-footer"))

        return result

    def get_canvas_response(self) -> dict[str, Any]:
        """Generate canvas response for synchronous webhook reply."""
        logger.debug(
            "Generating canvas response",
            canvas_id=self.canvas_id,
            entry_id=self.entry_id,
            package_name=self.package_name,
        )

        canvas_blocks = self._make_blocks()
        logger.debug("Canvas blocks created", blocks_count=len(canvas_blocks))

        blocks_dict = blocks.blocks_to_dict(canvas_blocks)

        logger.info(
            "Canvas response generated",
            canvas_id=self.canvas_id,
            package_name=self.package_name,
            blocks_count=len(blocks_dict),
            catalog_url=self.catalog_url,
            sync_uri=self.sync_uri(),
        )

        return {"blocks": blocks_dict}

    def update_canvas(self) -> dict[str, Any]:
        """Update existing Canvas using Benchling SDK."""
        try:
            blocks = self._make_blocks()

            canvas_update = AppCanvasUpdate(
                blocks=blocks,  # type: ignore
                enabled=True,  # type: ignore
            )

            logger.info(
                "Updating Canvas",
                canvas_id=self.canvas_id,
                package_name=self.package_name,
                blocks_count=len(blocks),
            )

            result = self.benchling.apps.update_canvas(canvas_id=self.canvas_id, canvas=canvas_update)

            logger.info("Canvas updated successfully", canvas_id=result.id)

            return {"success": True, "canvas_id": result.id}

        except Exception as e:
            logger.error(
                "Canvas update failed",
                canvas_id=self.canvas_id,
                error=str(e),
                error_type=type(e).__name__,
                exc_info=True,
            )
            return {"success": False, "error": str(e)}

    def update_canvas_with_blocks(self, blocks: List) -> dict[str, Any]:
        """Update existing Canvas with provided blocks using Benchling SDK.

        Args:
            blocks: List of block objects to display on the canvas

        Returns:
            Dict with success status and canvas_id or error
        """
        try:
            canvas_update = AppCanvasUpdate(
                blocks=blocks,  # type: ignore
                enabled=True,  # type: ignore
            )

            logger.info(
                "Updating Canvas with provided blocks",
                canvas_id=self.canvas_id,
                blocks_count=len(blocks),
            )

            result = self.benchling.apps.update_canvas(canvas_id=self.canvas_id, canvas=canvas_update)

            logger.info("Canvas updated successfully", canvas_id=result.id)

            return {"success": True, "canvas_id": result.id}

        except Exception as e:
            logger.error(
                "Canvas update failed",
                canvas_id=self.canvas_id,
                error=str(e),
                error_type=type(e).__name__,
                exc_info=True,
            )
            return {"success": False, "error": str(e)}

    def _make_file_table_markdown(
        self,
        files: List[PackageFile],
        page_state: PageState,
        package_name: Optional[str] = None,
    ) -> str:
        """
        Generate markdown list for file list.

        Args:
            files: List of files for current page
            page_state: Current pagination state
            package_name: Optional override for package name (for linked packages)

        Returns:
            Markdown string with file list
        """
        # Use explicit package name if provided
        browsing_package_name = package_name or self.package_name

        # Header
        md = fmt.format_file_list_header(
            package_name=browsing_package_name,
            page_num=page_state.page_number + 1,
            total_pages=page_state.total_pages,
        )

        if not files:
            md += "*No files in this package.*\n\n"
            return md

        # File list
        for i, file in enumerate(files, start=1):
            md += fmt.format_file_list_item(
                index=i,
                name=file.name,
                size_display=file.size_display,
                catalog_url=file.catalog_url,
                sync_url=file.sync_url,
            )

        # Footer
        md += fmt.format_file_list_footer(
            start_idx=page_state.start_index + 1,
            end_idx=page_state.end_index,
            total_items=page_state.total_items,
        )

        return md

    def _make_metadata_markdown(self, metadata: dict, package_name: Optional[str] = None) -> str:
        """
        Generate markdown for metadata view.

        Args:
            metadata: Package metadata dict
            package_name: Optional override for package name (for linked packages)

        Returns:
            Markdown string with bulleted list metadata
        """
        browsing_package_name = package_name or self.package_name
        md = fmt.format_metadata_header(browsing_package_name)
        md += fmt.dict_to_markdown_list(metadata)
        return md

    def _make_navigation_buttons(
        self,
        context: str,
        page_state: Optional[PageState] = None,
        package_name: Optional[str] = None,
    ) -> List:
        """
        Create navigation buttons based on context, grouped in a section for horizontal layout.

        Args:
            context: "main", "browser", or "metadata"
            page_state: Current pagination state (required for "browser" and "metadata")
            package_name: Optional package name for linked package browsing (used with "browser" context)

        Returns:
            List containing a SectionUiBlockUpdate with button children
        """
        if context == "main":
            return blocks.create_main_navigation_buttons(self.entry_id)
        if context == "browser":
            if page_state is None:
                raise ValueError("page_state required for browser context")
            return blocks.create_browser_navigation_buttons(self.entry_id, page_state, package_name)
        if context == "metadata":
            if page_state is None:
                raise ValueError("page_state required for metadata context")
            return blocks.create_metadata_navigation_buttons(self.entry_id, page_state, package_name)
        raise ValueError(f"Unknown context: {context}")

    def get_package_browser_blocks(
        self,
        page_number: int = 0,
        page_size: int = 15,
        package_name: Optional[str] = None,
    ) -> List:
        """Generate Package Entry Browser blocks for SDK use.

        Delegates file fetching to the injected PackageFileFetcher instance.

        Args:
            page_number: Page to display (0-indexed)
            page_size: Files per page
            package_name: Optional package name to browse (if different from the primary package).
                          Used when browsing linked packages.

        Returns:
            List of block objects (MarkdownUiBlockUpdate, ButtonUiBlockUpdate)
        """
        # Use explicit package name if provided, otherwise use the default package name
        browsing_package_name = package_name or self.package_name

        logger.info(
            "Generating Package Entry Browser blocks",
            package_name=browsing_package_name,
            is_linked=package_name is not None,
            page_number=page_number,
            page_size=page_size,
        )

        try:
            # Fetch all files - will raise exception if package doesn't exist
            all_files = self._package_file_fetcher.get_package_files(browsing_package_name)

            if len(all_files) == 0:
                # Package exists but empty
                markdown = fmt.format_empty_package(browsing_package_name)

                return [
                    blocks.create_markdown_block(markdown, "md-empty"),
                    *self._make_navigation_buttons("main"),
                ]

            # Paginate files
            page_files, page_state = paginate_items(all_files, page_number, page_size)

            # Generate markdown with package context
            markdown = self._make_file_table_markdown(page_files, page_state, browsing_package_name)

            # Create blocks with package context for linked packages
            canvas_blocks = [
                blocks.create_markdown_block(markdown, "md-browser"),
                *self._make_navigation_buttons("browser", page_state, package_name),
            ]

            logger.info(
                "Package Entry Browser blocks generated",
                package_name=browsing_package_name,
                is_linked=package_name is not None,
                page=f"{page_state.page_number + 1}/{page_state.total_pages}",
                files_on_page=len(page_files),
            )

            return canvas_blocks

        except Exception as e:
            logger.error("Failed to generate Package Entry Browser", error=str(e), exc_info=True)

            # Determine if it's a package-not-found error or other error
            error_msg = str(e).lower()
            if "does not exist" in error_msg or "not found" in error_msg or "no such package" in error_msg:
                # Package doesn't exist yet
                markdown = fmt.format_package_not_found(browsing_package_name)

                return [
                    blocks.create_markdown_block(markdown, "md-no-package"),
                    blocks.create_button_block(f"update-package-{self.entry_id}", "Update Package"),
                    blocks.create_button_block(f"back-to-package-{self.entry_id}", "Back to Package"),
                ]

            # Other error (API failure, network error, etc.)
            markdown = fmt.format_error_loading_files(browsing_package_name, str(e))

            return [
                blocks.create_markdown_block(markdown, "md-error"),
                blocks.create_button_block(f"browse-files-{self.entry_id}-p{page_number}-s{page_size}", "Retry"),
                blocks.create_button_block(f"back-to-package-{self.entry_id}", "Back to Package"),
            ]

    def get_package_browser_response(
        self,
        page_number: int = 0,
        page_size: int = 15,
    ) -> dict:
        """
        Generate Package Entry Browser canvas response.

        Args:
            page_number: Page to display (0-indexed)
            page_size: Files per page

        Returns:
            Canvas response dict with blocks
        """
        canvas_blocks = self.get_package_browser_blocks(page_number, page_size)
        return {"blocks": blocks.blocks_to_dict(canvas_blocks)}

    def get_metadata_blocks(
        self,
        page_number: int = 0,
        page_size: int = 15,
        package_name: Optional[str] = None,
    ) -> List:
        """Generate metadata view blocks for SDK use.

        Delegates metadata fetching to the injected PackageFileFetcher instance.

        Args:
            page_number: Current page (to preserve state)
            page_size: Page size (to preserve state)
            package_name: Optional package name to view metadata for (if different from the primary package).
                          Used when viewing metadata for linked packages.

        Returns:
            List of block objects (MarkdownUiBlockUpdate, ButtonUiBlockUpdate)
        """
        # Use explicit package name if provided, otherwise use the default package name
        browsing_package_name = package_name or self.package_name

        logger.info(
            "Generating metadata blocks",
            package_name=browsing_package_name,
            is_linked=package_name is not None,
        )

        try:
            metadata = self._package_file_fetcher.get_package_metadata(browsing_package_name)

            # Generate markdown
            markdown = self._make_metadata_markdown(metadata, browsing_package_name)

            # Fake page state for navigation buttons (preserve page context)
            page_state = PageState(page_number=page_number, page_size=page_size, total_items=0)

            # Create blocks with package context for linked packages
            canvas_blocks = [
                blocks.create_markdown_block(markdown, "md-metadata"),
                *self._make_navigation_buttons("metadata", page_state, package_name),
            ]

            logger.info(
                "Metadata blocks generated",
                package_name=browsing_package_name,
                is_linked=package_name is not None,
            )

            return canvas_blocks

        except Exception as e:
            logger.error("Failed to generate metadata view", error=str(e))

            markdown = fmt.format_error_loading_metadata(browsing_package_name, str(e))

            return [
                blocks.create_markdown_block(markdown, "md-error"),
                blocks.create_button_block(f"back-to-package-{self.entry_id}", "Back to Package"),
            ]

    def get_metadata_response(
        self,
        page_number: int = 0,
        page_size: int = 15,
    ) -> dict:
        """
        Generate metadata view canvas response.

        Args:
            page_number: Current page (to preserve state)
            page_size: Page size (to preserve state)

        Returns:
            Canvas response dict with blocks
        """
        canvas_blocks = self.get_metadata_blocks(page_number, page_size)
        return {"blocks": blocks.blocks_to_dict(canvas_blocks)}

    def _handle(self) -> None:
        """Handle Canvas webhook payload."""
        try:
            logger.info("Updating canvas", canvas_id=self.canvas_id, entry_id=self.entry_id)
            self.update_canvas()

        except Exception as e:
            logger.error("Canvas operation failed", error=str(e))
            raise

    def handle_async(self) -> None:
        """Handle Canvas webhook payload asynchronously in background thread."""
        threading.Thread(target=self._handle, daemon=True).start()
