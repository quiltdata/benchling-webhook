"""Version utility to read from environment or pyproject.toml"""

import os
import tomllib
from pathlib import Path


def get_version() -> str:
    """
    Read version from BUILD_VERSION environment variable or pyproject.toml.

    Priority:
    1. BUILD_VERSION environment variable (set by Docker build from git tag in CI)
    2. pyproject.toml project.version
    3. "unknown" as fallback

    Returns:
        str: Version string (e.g., "0.7.4" or "0.7.5-dev.1")
    """
    # Check for BUILD_VERSION environment variable first (set during Docker build)
    if build_version := os.getenv("BUILD_VERSION"):
        return build_version

    # Fall back to pyproject.toml
    try:
        pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
            return data.get("project", {}).get("version", "unknown")
    except Exception:
        # Fallback if pyproject.toml is not found or cannot be read
        return "unknown"


__version__ = get_version()
