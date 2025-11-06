"""
XDG Configuration Management for Python

Provides read-only XDG-compliant configuration file reading for the Benchling Webhook system.
Implements the v0.7.0+ profile-based configuration model:
- Profile configuration: {profile}/config.json - All configuration for a profile
- Deployment tracking: {profile}/deployments.json - Deployment history

This module is read-only and does NOT support environment variable fallback,
ensuring strict configuration management and consistency with the TypeScript implementation.

Usage:
    from xdg_config import XDGConfig

    config = XDGConfig()
    profile_config = config.read_profile()  # Read default profile
    complete_config = config.load_complete_config()  # For backward compat

Module: xdg_config
"""

import json
from pathlib import Path
from typing import Any, Dict, Optional


class XDGConfig:
    """
    XDG Configuration Manager for Python (v0.7.0+)

    Provides read-only access to XDG-compliant profile-based configuration files.
    Supports multiple named profiles (e.g., "default", "dev", "prod").
    """

    def __init__(self, base_dir: Optional[Path] = None, profile: str = "default"):
        """
        Initialize XDG Configuration Manager

        Args:
            base_dir: Base configuration directory (defaults to ~/.config/benchling-webhook)
            profile: Profile name to use (defaults to "default")
        """
        self.base_dir = base_dir or self._get_default_base_dir()
        self.profile = profile

    @staticmethod
    def _get_default_base_dir() -> Path:
        """
        Gets the default XDG base directory

        Returns:
            Path to ~/.config/benchling-webhook
        """
        home = Path.home()
        return home / ".config" / "benchling-webhook"

    def get_profile_dir(self, profile_name: Optional[str] = None) -> Path:
        """
        Gets the profile directory path

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Profile directory path (~/.config/benchling-webhook/{profile}/)
        """
        profile = profile_name or self.profile
        return self.base_dir / profile

    def get_config_path(self, profile_name: Optional[str] = None) -> Path:
        """
        Gets the configuration file path for a profile

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Path to config.json
        """
        profile_dir = self.get_profile_dir(profile_name)
        return profile_dir / "config.json"

    def get_deployments_path(self, profile_name: Optional[str] = None) -> Path:
        """
        Gets the deployments file path for a profile

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Path to deployments.json
        """
        profile_dir = self.get_profile_dir(profile_name)
        return profile_dir / "deployments.json"

    def profile_exists(self, profile_name: Optional[str] = None) -> bool:
        """
        Checks if a profile exists

        Args:
            profile_name: Profile name to check (defaults to instance profile)

        Returns:
            True if profile exists (has a config.json), False otherwise
        """
        config_path = self.get_config_path(profile_name)
        return config_path.exists() and config_path.is_file()

    def list_profiles(self) -> list[str]:
        """
        Lists all available profiles

        Returns:
            List of profile names
        """
        if not self.base_dir.exists():
            return []

        profiles = []
        for profile_dir in self.base_dir.iterdir():
            if profile_dir.is_dir():
                config_path = profile_dir / "config.json"
                if config_path.exists():
                    profiles.append(profile_dir.name)

        return sorted(profiles)

    def read_profile(
        self, profile_name: Optional[str] = None, raise_if_missing: bool = True
    ) -> Optional[Dict[str, Any]]:
        """
        Reads a profile configuration

        Args:
            profile_name: Profile name (defaults to instance profile)
            raise_if_missing: Whether to raise an error if file is missing

        Returns:
            Profile configuration dictionary, or None if file doesn't exist and raise_if_missing is False

        Raises:
            FileNotFoundError: If file not found and raise_if_missing is True
            json.JSONDecodeError: If file contains invalid JSON
        """
        config_path = self.get_config_path(profile_name)

        if not config_path.exists():
            if raise_if_missing:
                raise FileNotFoundError(f"Configuration file not found: {config_path}")
            return None

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except json.JSONDecodeError as e:
            raise json.JSONDecodeError(f"Invalid JSON in configuration file: {config_path}", e.doc, e.pos)
        except Exception as e:
            raise RuntimeError(f"Failed to read configuration file: {config_path}. {str(e)}")

        return config

    def read_deployments(self, profile_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Reads deployment tracking information

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Deployments dictionary, or None if file doesn't exist
        """
        deployments_path = self.get_deployments_path(profile_name)

        if not deployments_path.exists():
            return None

        try:
            with open(deployments_path, "r", encoding="utf-8") as f:
                deployments = json.load(f)
        except json.JSONDecodeError as e:
            raise json.JSONDecodeError(f"Invalid JSON in deployments file: {deployments_path}", e.doc, e.pos)
        except Exception as e:
            raise RuntimeError(f"Failed to read deployments file: {deployments_path}. {str(e)}")

        return deployments

    def load_complete_config(self, profile_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Loads complete configuration for a profile

        This method provides backward compatibility with the old three-file model.
        In v0.7.0+, there is only one config file per profile.

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Profile configuration dictionary

        Raises:
            FileNotFoundError: If no configuration file exists for the profile
        """
        return self.read_profile(profile_name, raise_if_missing=True)

    def get_config_value(self, key: str, default: Any = None, profile_name: Optional[str] = None) -> Any:
        """
        Gets a specific configuration value from the profile configuration

        Supports nested keys using dot notation (e.g., "benchling.tenant")

        Args:
            key: Configuration key to retrieve (supports dot notation)
            default: Default value if key not found
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Configuration value or default
        """
        try:
            config = self.read_profile(profile_name, raise_if_missing=True)

            # Support dot notation for nested keys
            keys = key.split(".")
            value = config
            for k in keys:
                if isinstance(value, dict):
                    value = value.get(k)
                    if value is None:
                        return default
                else:
                    return default

            return value if value is not None else default
        except FileNotFoundError:
            return default

    def validate_config(
        self, config: Dict[str, Any], required_fields: Optional[list[str]] = None
    ) -> tuple[bool, list[str]]:
        """
        Validates configuration against required fields

        Args:
            config: Configuration dictionary to validate
            required_fields: List of required field paths (supports dot notation)

        Returns:
            Tuple of (is_valid, list of missing fields)
        """
        if required_fields is None:
            required_fields = [
                "benchling.tenant",
                "benchling.clientId",
                "quilt.catalog",
                "quilt.bucket",
            ]

        missing_fields = []
        for field in required_fields:
            keys = field.split(".")
            value = config
            for key in keys:
                if isinstance(value, dict):
                    value = value.get(key)
                else:
                    value = None
                    break

            if value is None or (isinstance(value, str) and not value):
                missing_fields.append(field)

        is_valid = len(missing_fields) == 0
        return is_valid, missing_fields


# Convenience functions for backward compatibility
def load_complete_config(profile: str = "default") -> Dict[str, Any]:
    """
    Convenience function to load complete profile configuration

    Args:
        profile: Profile name

    Returns:
        Profile configuration dictionary
    """
    xdg = XDGConfig(profile=profile)
    return xdg.load_complete_config()
