#!/usr/bin/env python3
"""
Create a self-contained distribution archive for benchling integration.

This script creates a versioned zip file containing all necessary files
for building Docker containers in other repositories.
"""

import argparse
import subprocess
import sys
import tomllib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def get_version() -> str:
    """Extract version from pyproject.toml."""
    pyproject_path = Path("pyproject.toml")
    if not pyproject_path.exists():
        print("Error: pyproject.toml not found", file=sys.stderr)
        sys.exit(1)

    with open(pyproject_path, "rb") as f:
        data = tomllib.load(f)

    version = data.get("project", {}).get("version")
    if not version:
        print("Error: version not found in pyproject.toml", file=sys.stderr)
        sys.exit(1)

    return version


def get_git_sha() -> str:
    """Get short git SHA for current commit."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return "unknown"


def create_distribution(output_dir: Path, dry_run: bool = False) -> None:
    """Create distribution archive.

    Args:
        output_dir: Directory to write distribution archive
        dry_run: If True, print actions without creating archive
    """
    version = get_version()
    git_sha = get_git_sha()

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Distribution filename
    dist_name = f"benchling-quilt-integration-{version}-{git_sha}.zip"
    dist_path = output_dir / dist_name

    # Files to include in distribution
    include_files = [
        "Dockerfile",
        "docker-compose.yml",
        "pyproject.toml",
        "uv.lock",
        "src/",
        "README.md",
        "CHANGELOG.md",
        "env.template",
    ]

    print(f"Creating distribution: {dist_name}")
    print(f"Version: {version}")
    print(f"Git SHA: {git_sha}")
    print(f"Output: {dist_path}")
    print()

    def should_include(file_path: Path) -> bool:
        """Check if file should be included in distribution."""
        # Exclude hidden files/dirs and __pycache__
        return not any(part.startswith(".") or part == "__pycache__" for part in file_path.parts)

    if dry_run:
        print("DRY RUN - Would include files:")
        for item in include_files:
            path = Path(item)
            if path.is_file():
                print(f"  - {item}")
            elif path.is_dir():
                for file_path in path.rglob("*"):
                    if file_path.is_file() and should_include(file_path):
                        print(f"  - {file_path}")
        print(f"\nWould create: {dist_path}")
        return

    # Create zip archive
    with ZipFile(dist_path, "w", ZIP_DEFLATED) as zipf:
        for item in include_files:
            path = Path(item)
            if not path.exists():
                print(f"Warning: {item} not found, skipping", file=sys.stderr)
                continue

            if path.is_file():
                arcname = str(path)
                zipf.write(path, arcname)
                print(f"  + {arcname}")
            elif path.is_dir():
                for file_path in path.rglob("*"):
                    if file_path.is_file() and should_include(file_path):
                        arcname = str(file_path)
                        zipf.write(file_path, arcname)
                        print(f"  + {arcname}")

    file_size = dist_path.stat().st_size
    print(f"\n✅ Created: {dist_path} ({file_size:,} bytes)")
    print(f"\nTo extract and use in another repo:")
    print(f"  unzip {dist_name} -d benchling")
    print(f"  cd benchling && docker build -t benchling:{version} .")


def main():
    parser = argparse.ArgumentParser(description="Create distribution archive for benchling integration")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(".scratch/dist"),
        help="Output directory for distribution archive (default: .scratch/dist)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without creating archive",
    )

    args = parser.parse_args()
    create_distribution(args.output_dir, args.dry_run)


if __name__ == "__main__":
    main()
