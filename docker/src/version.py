"""Version utility to read from pyproject.toml"""
import tomllib
from pathlib import Path


def get_version() -> str:
    """
    Read version from pyproject.toml.

    Returns:
        str: Version string (e.g., "0.7.4")
    """
    try:
        pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
            return data.get("project", {}).get("version", "unknown")
    except Exception:
        # Fallback if pyproject.toml is not found or cannot be read
        return "unknown"


__version__ = get_version()
