#!/usr/bin/env python3
"""Unified Docker build and deployment script for Benchling Integration.

Combines Docker image tag generation with build and push operations.
Supports architecture-specific builds for both amd64 and arm64.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

# Configuration
# DOCKER_IMAGE_NAME must be set (typically exported from Makefile)
_docker_image_name = os.getenv("DOCKER_IMAGE_NAME")
if not _docker_image_name:
    print("ERROR: DOCKER_IMAGE_NAME environment variable must be set", file=sys.stderr)
    sys.exit(1)
DOCKER_IMAGE_NAME: str = _docker_image_name

DEFAULT_REGION = "us-east-1"
LATEST_TAG = "latest"


@dataclass(frozen=True)
class ImageReference:
    """Represents a fully-qualified Docker image reference."""

    registry: str
    image: str
    tag: str

    @property
    def uri(self) -> str:
        return f"{self.registry}/{self.image}:{self.tag}"


class DockerManager:
    """Manages Docker operations for Benchling Integration."""

    def __init__(
        self,
        registry: Optional[str] = None,
        region: str = DEFAULT_REGION,
        dry_run: bool = False,
        platform: Optional[str] = None,
    ):
        self.image_name = DOCKER_IMAGE_NAME
        self.region = region
        self.dry_run = dry_run
        self.registry = self._get_registry(registry)
        self.project_root = Path(__file__).parent.parent
        # Auto-detect platform if not specified
        self.platform = platform or self._detect_platform()

    def _detect_platform(self) -> str:
        """Detect the current platform architecture."""
        import platform

        machine = platform.machine().lower()
        if machine in ("arm64", "aarch64"):
            return "linux/arm64"
        return "linux/amd64"

    def _get_registry(self, registry: Optional[str]) -> str:
        """Determine ECR registry URL from various sources."""
        # Priority: explicit parameter > ECR_REGISTRY env > detect via STS > construct from AWS_ACCOUNT_ID
        if registry:
            return registry

        if ecr_registry := os.getenv("ECR_REGISTRY"):
            return ecr_registry

        # Try to get account ID from AWS STS if credentials are available
        try:
            result = subprocess.run(
                ["aws", "sts", "get-caller-identity", "--query", "Account", "--output", "text"],
                capture_output=True,
                text=True,
                check=True,
                timeout=5,
            )
            aws_account_id = result.stdout.strip()
            if aws_account_id:
                # Get region from environment or detect from AWS config
                region = os.getenv("AWS_DEFAULT_REGION")
                if not region:
                    # Try to get region from AWS CLI configuration
                    try:
                        region_result = subprocess.run(
                            ["aws", "configure", "get", "region"],
                            capture_output=True,
                            text=True,
                            check=False,
                            timeout=2,
                        )
                        if region_result.returncode == 0 and region_result.stdout.strip():
                            region = region_result.stdout.strip()
                    except (subprocess.TimeoutExpired, FileNotFoundError):
                        pass

                # Final fallback
                if not region:
                    region = self.region

                print(f"INFO: Detected AWS account {aws_account_id} (region: {region}) via STS", file=sys.stderr)
                return f"{aws_account_id}.dkr.ecr.{region}.amazonaws.com"
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
            # STS call failed, try environment variable fallback
            pass

        if aws_account_id := os.getenv("AWS_ACCOUNT_ID"):
            region = os.getenv("AWS_DEFAULT_REGION", self.region)
            return f"{aws_account_id}.dkr.ecr.{region}.amazonaws.com"

        # For local builds, use a default local registry
        print("WARNING: No AWS credentials found, using localhost:5000 for local testing", file=sys.stderr)
        return "localhost:5000"

    def _run_command(self, cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
        """Execute a command with optional dry-run mode."""
        if self.dry_run:
            print(f"DRY RUN: Would execute: {' '.join(cmd)}", file=sys.stderr)
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        print(f"INFO: Executing: {' '.join(cmd)}", file=sys.stderr)
        return subprocess.run(cmd, check=check, capture_output=True, text=True)

    def _check_docker(self) -> bool:
        """Validate Docker is available and running."""
        try:
            result = self._run_command(["docker", "info"], check=False)
            if result.returncode != 0:
                print("ERROR: Docker daemon is not running or not accessible", file=sys.stderr)
                return False
            return True
        except FileNotFoundError:
            print("ERROR: Docker is not installed or not in PATH", file=sys.stderr)
            return False

    def generate_tags(
        self, version: str, include_latest: bool = True, arch_specific: bool = True
    ) -> list[ImageReference]:
        """Generate Docker image tags for a given version.

        Args:
            version: Version string for the image
            include_latest: Whether to include a 'latest' tag
            arch_specific: Whether to include architecture suffix in tags
        """
        if not self.registry:
            raise ValueError("registry is required")
        if not version:
            raise ValueError("version is required")

        # Determine architecture suffix
        arch_suffix = ""
        if arch_specific:
            if "arm64" in self.platform:
                arch_suffix = "-arm64"
            elif "amd64" in self.platform:
                arch_suffix = "-amd64"

        # Generate version tag with architecture suffix
        version_tag = f"{version}{arch_suffix}" if arch_suffix else version
        tags = [ImageReference(registry=self.registry, image=self.image_name, tag=version_tag)]

        if include_latest:
            latest_tag = f"latest{arch_suffix}" if arch_suffix else LATEST_TAG
            tags.append(ImageReference(registry=self.registry, image=self.image_name, tag=latest_tag))

        return tags

    def build(self, tag: str, platform: Optional[str] = None) -> bool:
        """Build Docker image with the specified tag.

        Args:
            tag: Image tag to build
            platform: Target platform (defaults to detected platform)
        """
        # Use detected platform if not specified
        build_platform = platform or self.platform

        # Check architecture - warn on cross-architecture builds
        import platform as platform_module

        machine = platform_module.machine().lower()
        is_arm64 = machine in ("arm64", "aarch64")
        building_amd64 = "amd64" in build_platform

        if is_arm64 and building_amd64:
            print("", file=sys.stderr)
            print("⚠️  WARNING: Building linux/amd64 on arm64 architecture", file=sys.stderr)
            print("⚠️  This will use emulation and be very slow", file=sys.stderr)
            print("", file=sys.stderr)

        print(f"INFO: Building Docker image: {tag}", file=sys.stderr)
        print(f"INFO: Target platform: {build_platform}", file=sys.stderr)

        os.chdir(self.project_root)
        result = self._run_command(
            ["docker", "build", "--platform", build_platform, "--file", "Dockerfile", "--tag", tag, "."], check=False
        )

        if result.returncode == 0:
            print(f"INFO: Successfully built: {tag}", file=sys.stderr)
            return True
        else:
            print(f"ERROR: Failed to build image", file=sys.stderr)
            if result.stderr:
                print(f"ERROR: {result.stderr}", file=sys.stderr)
            if result.stdout:
                print(f"OUTPUT: {result.stdout}", file=sys.stderr)
            return False

    def tag(self, source: str, target: str) -> bool:
        """Tag a Docker image."""
        print(f"INFO: Tagging image: {source} -> {target}", file=sys.stderr)

        result = self._run_command(["docker", "tag", source, target], check=False)

        if result.returncode == 0:
            return True
        else:
            print(f"ERROR: Failed to tag image", file=sys.stderr)
            if result.stderr:
                print(f"ERROR: {result.stderr}", file=sys.stderr)
            if result.stdout:
                print(f"OUTPUT: {result.stdout}", file=sys.stderr)
            return False

    def push(self, tag: str) -> bool:
        """Push Docker image to registry."""
        print(f"INFO: Pushing image: {tag}", file=sys.stderr)

        result = self._run_command(["docker", "push", tag], check=False)

        if result.returncode == 0:
            print(f"INFO: Successfully pushed: {tag}", file=sys.stderr)
            return True
        else:
            print(f"ERROR: Failed to push image", file=sys.stderr)
            if result.stderr:
                print(f"ERROR: {result.stderr}", file=sys.stderr)
            if result.stdout:
                print(f"OUTPUT: {result.stdout}", file=sys.stderr)
            return False

    def build_and_push(self, version: str, include_latest: bool = True, arch_specific: bool = True) -> bool:
        """Build and push Docker image with all generated tags.

        Supports architecture-specific builds. Builds for the current platform by default.
        Use arch_specific=True to include architecture suffix in tags (e.g., v1.0.0-arm64).
        """
        if not self._check_docker():
            return False

        # Show platform information
        import platform

        machine = platform.machine().lower()
        print("", file=sys.stderr)
        print(f"INFO: Building on {machine} architecture", file=sys.stderr)
        print(f"INFO: Target platform: {self.platform}", file=sys.stderr)
        print("", file=sys.stderr)

        # Generate tags
        tags = self.generate_tags(version, include_latest, arch_specific=arch_specific)

        print(f"INFO: Using registry: {self.registry}", file=sys.stderr)
        print(f"INFO: Generated {len(tags)} image tags:", file=sys.stderr)
        for ref in tags:
            print(f"INFO:   - {ref.uri}", file=sys.stderr)

        # Build with first tag
        primary_tag = tags[0].uri
        if not self.build(primary_tag):
            return False

        # Tag with additional tags
        for ref in tags[1:]:
            if not self.tag(primary_tag, ref.uri):
                return False

        # Push all tags
        for ref in tags:
            if not self.push(ref.uri):
                return False

        print(f"INFO: Docker push completed successfully", file=sys.stderr)
        print(f"INFO: Pushed {len(tags)} tags to registry: {self.registry}", file=sys.stderr)

        # Output the primary image URI for capture by CI
        primary_uri = tags[0].uri
        print(f"DOCKER_IMAGE_URI={primary_uri}", file=sys.stdout)

        return True

    def build_local(self, version: str = "dev") -> bool:
        """Build Docker image locally without pushing."""
        if not self._check_docker():
            return False

        # For local builds, use simple tagging
        local_tag = f"{self.registry}/{self.image_name}:{version}"

        print(f"INFO: Building Docker image locally", file=sys.stderr)
        if not self.build(local_tag):
            return False

        print(f"INFO: Local build completed: {local_tag}", file=sys.stderr)
        return True

    def _get_project_version(self) -> str:
        """Get current version from pyproject.toml."""
        import tomllib

        pyproject_path = self.project_root / "pyproject.toml"
        if not pyproject_path.exists():
            return "dev"

        try:
            with open(pyproject_path, "rb") as f:
                data = tomllib.load(f)
                version = data.get("project", {}).get("version", "dev")
                return version
        except Exception as e:
            print(f"WARNING: Failed to read version from pyproject.toml: {e}", file=sys.stderr)
            return "dev"

    def _get_latest_git_tag(self) -> Optional[str]:
        """Get the most recent git tag from the repository.

        Looks for the latest tag pointing to HEAD or recent commits.
        Returns the version without the 'v' prefix.
        Returns None if not found or on error.
        """
        try:
            # Get the latest tag from git log (tags pointing to HEAD or recent commits)
            result = subprocess.run(
                ["git", "describe", "--tags", "--abbrev=0", "HEAD"],
                capture_output=True,
                text=True,
                check=False,
                cwd=self.project_root,
            )

            if result.returncode != 0:
                print(f"INFO: No git tag found on current commit", file=sys.stderr)
                return None

            tag_name = result.stdout.strip()

            # Remove 'v' prefix if present (e.g., v0.6.17-dev-20251011232530 -> 0.6.17-dev-20251011232530)
            if tag_name.startswith("v"):
                version = tag_name[1:]
            else:
                version = tag_name

            print(f"INFO: Found git tag: {tag_name} (version: {version})", file=sys.stderr)
            return version

        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            print(f"INFO: Error getting git tag: {exc}", file=sys.stderr)
            return None

    def _ecr_login(self) -> bool:
        """Login to ECR registry if needed."""
        # Check if registry is ECR
        if ".ecr." not in self.registry or ".amazonaws.com" not in self.registry:
            return True  # Not ECR, no login needed

        print(f"INFO: Logging in to ECR registry...", file=sys.stderr)

        # Use AWS CLI to get ECR login password
        result = subprocess.run(
            ["aws", "ecr", "get-login-password", "--region", self.region],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            print(f"ERROR: Failed to get ECR login password: {result.stderr}", file=sys.stderr)
            return False

        password = result.stdout.strip()

        # Login to Docker registry
        login_result = subprocess.run(
            ["docker", "login", "--username", "AWS", "--password-stdin", self.registry],
            input=password,
            capture_output=True,
            text=True,
            check=False,
        )

        if login_result.returncode != 0:
            print(f"ERROR: Failed to login to ECR: {login_result.stderr}", file=sys.stderr)
            return False

        print(f"INFO: Successfully logged in to ECR", file=sys.stderr)
        return True

    def _get_image_info(self, tag: str) -> dict[str, Any]:
        """Get image metadata from registry using docker manifest inspect."""
        full_uri = f"{self.registry}/{self.image_name}:{tag}"

        # Use docker manifest inspect to get image details
        result = subprocess.run(
            ["docker", "manifest", "inspect", full_uri],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            raise RuntimeError(f"Failed to inspect image {full_uri}: {result.stderr}")

        return json.loads(result.stdout)

    def _get_version_for_validation(self, version: Optional[str]) -> str:
        """Get version to validate (from arg, git tag, or pyproject.toml)."""
        if version:
            return version

        git_version = self._get_latest_git_tag()
        if git_version:
            return git_version

        print(f"INFO: No git tag found, using version from pyproject.toml", file=sys.stderr)
        return self._get_project_version()

    def _format_size(self, size_bytes: int) -> str:
        """Format bytes as human-readable size string."""
        if size_bytes < 1024:
            return f"{size_bytes} B"
        if size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        return f"{size_bytes / (1024 * 1024):.1f} MB"

    def _validate_image_architecture(self, expected_version: str) -> bool:
        """Validate that image is linux/amd64.

        Args:
            expected_version: Version tag to validate

        Returns:
            True if image is linux/amd64, False otherwise
        """
        full_uri = f"{self.registry}/{self.image_name}:{expected_version}"

        # Use docker buildx imagetools to get architecture from image
        result = subprocess.run(
            ["docker", "buildx", "imagetools", "inspect", "--raw", full_uri],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            print(f"❌ Failed to inspect image: {result.stderr}", file=sys.stderr)
            return False

        try:
            manifest_data = json.loads(result.stdout)
            arch = manifest_data.get("architecture", "")
            os_name = manifest_data.get("os", "")

            if not arch or not os_name:
                print(f"❌ Architecture metadata not found in image", file=sys.stderr)
                return False

            arch_info = f"{os_name}/{arch}"
            print(f"   Architecture: {arch_info}", file=sys.stderr)

            # Calculate image size
            layers = manifest_data.get("layers", [])
            if layers:
                size_bytes = sum(layer.get("size", 0) for layer in layers)
                print(f"   Size: {self._format_size(size_bytes)}", file=sys.stderr)

            # Validate it's linux/amd64
            if arch == "amd64" and os_name == "linux":
                print(f"✅ Valid production architecture: {arch_info}", file=sys.stderr)
                return True

            print(f"❌ Invalid architecture: {arch_info}", file=sys.stderr)
            print(f"   Production images MUST be linux/amd64", file=sys.stderr)
            return False

        except (json.JSONDecodeError, KeyError) as e:
            print(f"❌ Failed to parse image manifest: {e}", file=sys.stderr)
            return False

    def validate(self, version: Optional[str] = None, check_latest: bool = True, skip_auth: bool = False) -> bool:
        """Validate pushed Docker images in registry.

        Validates that single-architecture images are linux/amd64 and verifies the latest tag.

        Args:
            version: Specific version to validate (defaults to latest git tag, then pyproject.toml)
            check_latest: Whether to verify latest tag matches expected version
            skip_auth: Skip ECR authentication (for public registries)

        Returns:
            True if validation passes, False otherwise
        """
        try:
            # Login to ECR if needed
            if not skip_auth and not self._ecr_login():
                print(f"ERROR: ECR login failed", file=sys.stderr)
                return False

            if skip_auth:
                print(f"INFO: Skipping ECR authentication (public registry mode)", file=sys.stderr)

            # Get version to validate
            expected_version = self._get_version_for_validation(version)

            print(f"INFO: Validating Docker image for version {expected_version}", file=sys.stderr)
            print(f"INFO: Registry: {self.registry}", file=sys.stderr)
            print(f"INFO: Image: {self.image_name}", file=sys.stderr)
            print("", file=sys.stderr)

            # Validate versioned image exists and has correct architecture
            full_image_uri = f"{self.registry}/{self.image_name}:{expected_version}"
            print(f"INFO: Checking image: {full_image_uri}", file=sys.stderr)

            if not self._validate_image_architecture(expected_version):
                return False

            print("", file=sys.stderr)

            # Validate latest tag if requested
            if check_latest:
                print(f"INFO: Checking latest tag points to {expected_version}", file=sys.stderr)
                version_info = self._get_image_info(expected_version)
                latest_info = self._get_image_info(LATEST_TAG)

                version_digest = version_info.get("config", {}).get("digest", "")
                latest_digest = latest_info.get("config", {}).get("digest", "")

                if version_digest == latest_digest:
                    print(f"✅ Latest tag points to version {expected_version}", file=sys.stderr)
                    print(f"   Digest: {version_digest[:19]}...", file=sys.stderr)
                else:
                    print(f"❌ Latest tag mismatch!", file=sys.stderr)
                    print(f"   Expected (v{expected_version}): {version_digest[:19]}...", file=sys.stderr)
                    print(f"   Actual (latest): {latest_digest[:19]}...", file=sys.stderr)
                    return False

            print("", file=sys.stderr)
            print(f"✅ Docker image validation passed", file=sys.stderr)
            return True

        except subprocess.CalledProcessError as exc:
            print(f"❌ Failed to get project version: {exc}", file=sys.stderr)
            return False
        except RuntimeError as exc:
            print(f"❌ {exc}", file=sys.stderr)
            return False
        except Exception as exc:
            print(f"❌ Validation failed: {exc}", file=sys.stderr)
            return False


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Docker build and deployment for Benchling Integration",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
    # Generate tags for a version
    %(prog)s tags --version 1.2.3

    # Build locally for testing
    %(prog)s build

    # Build and push to ECR (architecture-specific)
    %(prog)s push --version 1.2.3

    # Build and push for specific platform
    %(prog)s push --version 1.2.3 --platform linux/amd64

    # Dry run to see what would happen
    %(prog)s push --version 1.2.3 --dry-run

ENVIRONMENT VARIABLES:
    DOCKER_IMAGE_NAME      Docker image name (required)
    ECR_REGISTRY           ECR registry URL
    AWS_ACCOUNT_ID         AWS account ID (used to construct registry)
    AWS_DEFAULT_REGION     AWS region (default: us-east-1)
    VERSION                Version tag (can override --version)
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Tags command (replaces docker_image.py functionality)
    tags_parser = subparsers.add_parser("tags", help="Generate Docker image tags")
    tags_parser.add_argument("--version", required=True, help="Version tag for the image")
    tags_parser.add_argument("--registry", help="ECR registry URL")
    tags_parser.add_argument("--output", choices=["text", "json"], default="text", help="Output format")
    tags_parser.add_argument("--no-latest", action="store_true", help="Don't include latest tag")

    # Build command
    build_parser = subparsers.add_parser("build", help="Build Docker image locally")
    build_parser.add_argument("--version", default="dev", help="Version tag (default: dev)")
    build_parser.add_argument("--registry", help="Registry URL")

    # Push command
    push_parser = subparsers.add_parser("push", help="Build and push Docker image to registry")
    push_parser.add_argument("--version", help="Version tag for the image (defaults to pyproject.toml version)")
    push_parser.add_argument("--registry", help="ECR registry URL")
    push_parser.add_argument("--region", default=DEFAULT_REGION, help="AWS region")
    push_parser.add_argument("--platform", help="Target platform (e.g., linux/amd64, linux/arm64)")
    push_parser.add_argument("--dry-run", action="store_true", help="Show what would be done")
    push_parser.add_argument("--no-latest", action="store_true", help="Don't tag as latest")
    push_parser.add_argument("--no-arch-suffix", action="store_true", help="Don't add architecture suffix to tags")

    # Info command
    info_parser = subparsers.add_parser("info", help="Get Docker image URI for a version")
    info_parser.add_argument("--version", required=True, help="Version tag for the image")
    info_parser.add_argument("--registry", help="ECR registry URL")
    info_parser.add_argument("--output", choices=["text", "github"], default="text", help="Output format")

    # Validate command
    validate_parser = subparsers.add_parser("validate", help="Validate pushed Docker images in registry")
    validate_parser.add_argument("--version", help="Version to validate (defaults to current pyproject.toml version)")
    validate_parser.add_argument("--registry", help="ECR registry URL")
    validate_parser.add_argument("--region", default=DEFAULT_REGION, help="AWS region")
    validate_parser.add_argument("--no-latest", action="store_true", help="Skip latest tag validation")
    validate_parser.add_argument(
        "--skip-auth", action="store_true", help="Skip ECR authentication (for public registries)"
    )

    return parser.parse_args(list(argv))


def cmd_tags(args: argparse.Namespace) -> int:
    """Generate and display Docker image tags."""
    try:
        manager = DockerManager(registry=args.registry)
        references = manager.generate_tags(args.version, include_latest=not args.no_latest)

        if args.output == "json":
            payload = {
                "registry": manager.registry,
                "image": DOCKER_IMAGE_NAME,
                "tags": [ref.tag for ref in references],
                "uris": [ref.uri for ref in references],
            }
            print(json.dumps(payload))
        else:
            for ref in references:
                print(ref.uri)

        return 0
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


def cmd_build(args: argparse.Namespace) -> int:
    """Build Docker image locally."""
    # Allow VERSION env var to override
    version = os.getenv("VERSION", args.version)

    manager = DockerManager(registry=args.registry)
    success = manager.build_local(version)
    return 0 if success else 1


def cmd_push(args: argparse.Namespace) -> int:
    """Build and push Docker image to registry."""
    manager = DockerManager(
        registry=args.registry,
        region=args.region,
        dry_run=args.dry_run,
        platform=args.platform if hasattr(args, "platform") else None,
    )

    # Determine version: CLI arg > env var > pyproject.toml
    version = args.version or os.getenv("VERSION") or manager._get_project_version()

    success = manager.build_and_push(version, include_latest=not args.no_latest, arch_specific=not args.no_arch_suffix)
    return 0 if success else 1


def cmd_info(args: argparse.Namespace) -> int:
    """Get Docker image info for GitHub Actions."""
    # Allow VERSION env var to override
    version = os.getenv("VERSION", args.version)

    try:
        manager = DockerManager(registry=args.registry)
        ref = ImageReference(manager.registry, DOCKER_IMAGE_NAME, version)

        if args.output == "github":
            # Output for GitHub Actions
            print(f"image-uri={ref.uri}")
        else:
            # Plain text output
            print(ref.uri)

        return 0
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


def cmd_validate(args: argparse.Namespace) -> int:
    """Validate Docker images in registry."""
    # Allow VERSION env var to override
    version = os.getenv("VERSION", args.version) if args.version else None

    manager = DockerManager(
        registry=args.registry,
        region=args.region,
    )
    success = manager.validate(version=version, check_latest=not args.no_latest, skip_auth=args.skip_auth)
    return 0 if success else 1


def main(argv: Iterable[str] | None = None) -> int:
    """Main entry point."""
    args = parse_args(argv or sys.argv[1:])

    if not args.command:
        print("ERROR: Command is required. Use --help for usage information.", file=sys.stderr)
        return 1

    if args.command == "tags":
        return cmd_tags(args)
    elif args.command == "build":
        return cmd_build(args)
    elif args.command == "push":
        return cmd_push(args)
    elif args.command == "info":
        return cmd_info(args)
    elif args.command == "validate":
        return cmd_validate(args)
    else:
        print(f"ERROR: Unknown command: {args.command}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
