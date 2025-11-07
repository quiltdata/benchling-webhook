"""
XDG Configuration Management for Python (v0.7.0+)

This module provides configuration access by delegating to the TypeScript CLI.
This ensures a single source of truth and eliminates config logic duplication.

The TypeScript implementation is authoritative for:
- Profile resolution and inheritance
- Configuration merging
- File path resolution
- Validation

Usage:
    from xdg_config import XDGConfig

    config = XDGConfig()
    complete_config = config.load_complete_config()

Module: xdg_config
"""

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional


class XDGConfig:
    """
    XDGConfig Manager for Python (v0.7.0+)

    Delegates to TypeScript CLI for configuration management.
    This eliminates code duplication and ensures consistency.
    """

    def __init__(self, profile: str = "default"):
        """
        Initialize XDG Configuration Manager

        Args:
            profile: Profile name to use (defaults to "default")
        """
        self.profile = profile
        self._repo_root = self._find_repo_root()

    def _find_repo_root(self) -> Path:
        """
        Find the repository root by looking for package.json

        Returns:
            Path to repository root

        Raises:
            RuntimeError: If repository root cannot be found
        """
        current = Path(__file__).resolve().parent

        # Walk up the directory tree looking for package.json
        for parent in [current, *current.parents]:
            if (parent / "package.json").exists():
                return parent

        raise RuntimeError(
            "Cannot find repository root (package.json not found). "
            "This module must be run from within the benchling-webhook repository."
        )

    def _call_ts_cli(self, args: list[str]) -> dict:
        """
        Call the TypeScript CLI and return parsed JSON output

        Args:
            args: CLI arguments to pass

        Returns:
            Parsed JSON response from CLI

        Raises:
            RuntimeError: If CLI call fails
            FileNotFoundError: If profile doesn't exist
        """
        try:
            # Call the TypeScript CLI
            result = subprocess.run(
                ["npx", "ts-node", "bin/cli.ts"] + args,
                cwd=str(self._repo_root),
                capture_output=True,
                text=True,
                check=True,
            )
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.strip() if e.stderr else str(e)

            # Check for common errors
            if "does not exist" in error_msg:
                raise FileNotFoundError(f"No configuration files found for profile: {self.profile}")

            raise RuntimeError(f"Failed to load configuration: {error_msg}")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Failed to parse configuration JSON: {e}")

    def load_complete_config(self, profile_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Loads the complete configuration for a profile

        This delegates to the TypeScript CLI to ensure consistency.

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Complete configuration dictionary

        Raises:
            FileNotFoundError: If profile doesn't exist
            RuntimeError: If configuration loading fails
        """
        profile = profile_name or self.profile
        return self._call_ts_cli(["config", "--profile", profile])

    def profile_exists(self, profile_name: Optional[str] = None) -> bool:
        """
        Checks if a profile exists

        Args:
            profile_name: Profile name to check (defaults to instance profile)

        Returns:
            True if profile exists, False otherwise
        """
        profile = profile_name or self.profile
        try:
            self._call_ts_cli(["config", "--profile", profile])
            return True
        except (FileNotFoundError, RuntimeError):
            return False


# Convenience function for backward compatibility
def load_complete_config(profile: str = "default") -> Dict[str, Any]:
    """
    Convenience function to load complete merged configuration

    Args:
        profile: Profile name

    Returns:
        Merged configuration dictionary

    Raises:
        FileNotFoundError: If profile doesn't exist
        RuntimeError: If configuration loading fails
    """
    xdg = XDGConfig(profile=profile)
    return xdg.load_complete_config()


if __name__ == "__main__":
    # Example usage
    import sys

    profile = sys.argv[1] if len(sys.argv) > 1 else "default"

    try:
        xdg = XDGConfig(profile=profile)
        config = xdg.load_complete_config()
        print(json.dumps(config, indent=2))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
