"""
XDG Configuration Management for Python

Provides read-only XDG-compliant configuration file reading for the Benchling Webhook system.
Implements the same three-file configuration model as the TypeScript library:
- User configuration: User-provided default settings
- Derived configuration: CLI-inferred configuration
- Deployment configuration: Deployment-specific artifacts

This module is read-only and does NOT support environment variable fallback,
ensuring strict configuration management and consistency with the TypeScript implementation.

Usage:
    from xdg_config import XDGConfig

    config = XDGConfig()
    user_config = config.read_config("user")
    complete_config = config.load_complete_config()

Module: xdg_config
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Literal, Optional

ConfigType = Literal["user", "derived", "deploy"]


@dataclass
class XDGConfigPaths:
    """Configuration file paths for XDG-compliant storage"""

    user_config: Path
    derived_config: Path
    deploy_config: Path


class XDGConfig:
    """
    XDG Configuration Manager for Python

    Provides read-only access to XDG-compliant configuration files.
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
            Profile directory path
        """
        profile = profile_name or self.profile

        # v0.7.0+ uses direct subdirectories: ~/.config/benchling-webhook/dev/
        # Try direct profile directory first
        direct_profile_dir = self.base_dir / profile
        if direct_profile_dir.exists():
            return direct_profile_dir

        # Fall back to old v0.6.x structure: ~/.config/benchling-webhook/profiles/dev/
        if profile == "default":
            return self.base_dir
        return self.base_dir / "profiles" / profile

    def get_profile_paths(self, profile_name: Optional[str] = None) -> XDGConfigPaths:
        """
        Gets configuration file paths for a specific profile

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Configuration file paths for the profile
        """
        profile_dir = self.get_profile_dir(profile_name)

        # v0.7.0+ uses config.json instead of default.json
        # Try v0.7.0 structure first
        if (profile_dir / "config.json").exists():
            return XDGConfigPaths(
                user_config=profile_dir / "config.json",
                derived_config=profile_dir / "config" / "default.json",  # May not exist
                deploy_config=profile_dir / "deployments.json",  # v0.7.0 uses deployments.json
            )

        # Fall back to old v0.6.x structure
        return XDGConfigPaths(
            user_config=profile_dir / "default.json",
            derived_config=profile_dir / "config" / "default.json",
            deploy_config=profile_dir / "deploy" / "default.json",
        )

    def get_config_path(self, config_type: ConfigType, profile_name: Optional[str] = None) -> Path:
        """
        Gets the file path for a specific configuration type

        Args:
            config_type: Type of configuration ("user", "derived", or "deploy")
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Absolute path to the configuration file

        Raises:
            ValueError: If config_type is invalid
        """
        paths = self.get_profile_paths(profile_name)

        if config_type == "user":
            return paths.user_config
        elif config_type == "derived":
            return paths.derived_config
        elif config_type == "deploy":
            return paths.deploy_config
        else:
            raise ValueError(f"Unknown configuration type: {config_type}")

    def profile_exists(self, profile_name: Optional[str] = None) -> bool:
        """
        Checks if a profile exists

        Args:
            profile_name: Profile name to check (defaults to instance profile)

        Returns:
            True if profile exists, False otherwise
        """
        profile_dir = self.get_profile_dir(profile_name)
        return profile_dir.exists() and profile_dir.is_dir()

    def list_profiles(self) -> list[str]:
        """
        Lists all available profiles

        Returns:
            List of profile names
        """
        profiles = ["default"]

        profiles_dir = self.base_dir / "profiles"
        if profiles_dir.exists():
            profile_dirs = [d.name for d in profiles_dir.iterdir() if d.is_dir()]
            profiles.extend(profile_dirs)

        return profiles

    def read_config(
        self, config_type: ConfigType, profile_name: Optional[str] = None, raise_if_missing: bool = True
    ) -> Optional[Dict[str, Any]]:
        """
        Reads and parses a configuration file

        Args:
            config_type: Type of configuration to read ("user", "derived", or "deploy")
            profile_name: Profile name (defaults to instance profile)
            raise_if_missing: Whether to raise an error if file is missing

        Returns:
            Parsed configuration dictionary, or None if file doesn't exist and raise_if_missing is False

        Raises:
            FileNotFoundError: If file not found and raise_if_missing is True
            json.JSONDecodeError: If file contains invalid JSON
            ValueError: If config_type is invalid
        """
        config_path = self.get_config_path(config_type, profile_name)

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

    def load_complete_config(self, profile_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Loads and merges all configuration files for a profile

        Merges configurations in priority order (user → derived → deploy),
        where later configurations override earlier ones.

        Args:
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Merged configuration dictionary

        Raises:
            FileNotFoundError: If no configuration files exist for the profile
        """
        configs = []

        # Load user config (optional)
        user_config = self.read_config("user", profile_name, raise_if_missing=False)
        if user_config:
            configs.append(user_config)

        # Load derived config (optional)
        derived_config = self.read_config("derived", profile_name, raise_if_missing=False)
        if derived_config:
            configs.append(derived_config)

        # Load deploy config (optional)
        deploy_config = self.read_config("deploy", profile_name, raise_if_missing=False)
        if deploy_config:
            configs.append(deploy_config)

        if not configs:
            raise FileNotFoundError(f"No configuration files found for profile: {profile_name or self.profile}")

        # Merge configurations (deep merge)
        merged = {}
        for config in configs:
            merged = self._deep_merge(merged, config)

        return merged

    @staticmethod
    def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
        """
        Deep merge two dictionaries

        Args:
            base: Base dictionary
            override: Override dictionary

        Returns:
            Merged dictionary
        """
        result = base.copy()

        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = XDGConfig._deep_merge(result[key], value)
            else:
                result[key] = value

        return result

    def get_config_value(self, key: str, default: Any = None, profile_name: Optional[str] = None) -> Any:
        """
        Gets a specific configuration value from the merged configuration

        Args:
            key: Configuration key to retrieve
            default: Default value if key not found
            profile_name: Profile name (defaults to instance profile)

        Returns:
            Configuration value or default
        """
        try:
            config = self.load_complete_config(profile_name)
            return config.get(key, default)
        except FileNotFoundError:
            return default

    def validate_config(
        self, config: Dict[str, Any], required_fields: Optional[list[str]] = None
    ) -> tuple[bool, list[str]]:
        """
        Validates configuration against required fields

        Args:
            config: Configuration dictionary to validate
            required_fields: List of required field names

        Returns:
            Tuple of (is_valid, list of missing fields)
        """
        if required_fields is None:
            required_fields = [
                "benchlingTenant",
                "benchlingClientId",
                "quiltCatalog",
                "quiltUserBucket",
            ]

        missing_fields = []
        for field in required_fields:
            if field not in config or not config[field]:
                missing_fields.append(field)

        is_valid = len(missing_fields) == 0
        return is_valid, missing_fields


# Convenience functions for backward compatibility
def load_config(config_type: ConfigType = "user", profile: str = "default") -> Optional[Dict[str, Any]]:
    """
    Convenience function to load a specific configuration type

    Args:
        config_type: Type of configuration to load
        profile: Profile name

    Returns:
        Configuration dictionary or None
    """
    xdg = XDGConfig(profile=profile)
    return xdg.read_config(config_type, raise_if_missing=False)


def load_complete_config(profile: str = "default") -> Dict[str, Any]:
    """
    Convenience function to load complete merged configuration

    Args:
        profile: Profile name

    Returns:
        Merged configuration dictionary
    """
    xdg = XDGConfig(profile=profile)
    return xdg.load_complete_config()
