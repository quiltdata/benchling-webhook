#!/usr/bin/env python3
"""
XDG Configuration CLI

Centralized command-line interface for XDG configuration management.
Provides a single source of truth for all configuration operations,
ensuring consistency between TypeScript and Python code.

Commands:
    read        Read configuration from XDG
    write       Write configuration to XDG
    merge       Merge JSON into configuration
    validate    Validate configuration schema
    list        List all profiles
    export      Export configuration as JSON
    get         Get a specific field value
    set         Set a specific field value

Usage:
    python -m src.xdg_cli read [OPTIONS]
    python -m src.xdg_cli write [OPTIONS] KEY VALUE
    python -m src.xdg_cli merge [OPTIONS] JSON_DATA
    python -m src.xdg_cli validate [OPTIONS]
    python -m src.xdg_cli list
    python -m src.xdg_cli export [OPTIONS]
    python -m src.xdg_cli get [OPTIONS] KEY
    python -m src.xdg_cli set [OPTIONS] KEY VALUE

Module: xdg_cli
"""

import json
import sys
from pathlib import Path
from typing import Any, Optional

import click
from pydantic import ValidationError

from .config_schema import ConfigType, get_config_model
from .xdg_config import XDGConfig


def format_json(data: Any, pretty: bool = True) -> str:
    """Format data as JSON string"""
    if pretty:
        return json.dumps(data, indent=2, ensure_ascii=False)
    return json.dumps(data, ensure_ascii=False)


def handle_error(error: Exception, verbose: bool = False) -> None:
    """Handle and format errors"""
    if verbose:
        click.echo(f"Error: {type(error).__name__}: {error}", err=True)
        import traceback

        traceback.print_exc()
    else:
        click.echo(f"Error: {error}", err=True)
    sys.exit(1)


@click.group()
@click.version_option(version="0.6.0", prog_name="benchling-webhook-config")
def cli():
    """
    Benchling Webhook XDG Configuration Manager

    Centralized tool for managing XDG-compliant configuration files.
    Ensures consistency between TypeScript and Python implementations.
    """
    pass


@cli.command()
@click.option(
    "--profile", "-p", default="default", help="Configuration profile to read (default: default)", show_default=True
)
@click.option(
    "--type",
    "-t",
    "config_type",
    type=click.Choice(["user", "derived", "deploy"], case_sensitive=False),
    default="user",
    help="Configuration type to read",
    show_default=True,
)
@click.option("--pretty/--compact", default=True, help="Pretty print JSON output", show_default=True)
@click.option("--validate/--no-validate", default=False, help="Validate against schema", show_default=True)
@click.option("--verbose", "-v", is_flag=True, help="Verbose error output")
def read(profile: str, config_type: str, pretty: bool, validate: bool, verbose: bool):
    """
    Read configuration from XDG storage

    Examples:
        benchling-webhook-config read
        benchling-webhook-config read --type derived
        benchling-webhook-config read --profile dev --type deploy
    """
    try:
        xdg = XDGConfig(profile=profile)
        config_data = xdg.read_config(config_type, raise_if_missing=True)  # type: ignore[arg-type]

        if config_data is None:
            click.echo(f"Configuration not found: {config_type}/{profile}", err=True)
            sys.exit(1)

        # Validate if requested
        if validate:
            config_model = get_config_model(ConfigType(config_type))
            try:
                config_model(**config_data)
                click.echo(f"✓ Configuration is valid\n", err=True)
            except ValidationError as e:
                click.echo(f"✗ Validation failed:\n{e}", err=True)
                sys.exit(1)

        click.echo(format_json(config_data, pretty=pretty))

    except Exception as e:
        handle_error(e, verbose)


@cli.command()
@click.argument("json_data", type=str)
@click.option(
    "--profile", "-p", default="default", help="Configuration profile to write (default: default)", show_default=True
)
@click.option(
    "--type",
    "-t",
    "config_type",
    type=click.Choice(["user", "derived", "deploy"], case_sensitive=False),
    default="user",
    help="Configuration type to write",
    show_default=True,
)
@click.option(
    "--validate/--no-validate", default=True, help="Validate against schema before writing", show_default=True
)
@click.option("--backup/--no-backup", default=True, help="Create backup before writing", show_default=True)
@click.option("--verbose", "-v", is_flag=True, help="Verbose error output")
def write(json_data: str, profile: str, config_type: str, validate: bool, backup: bool, verbose: bool):
    """
    Write configuration to XDG storage

    JSON_DATA can be:
    - JSON string: '{"key": "value"}'
    - File path: @/path/to/config.json
    - Stdin: - (read from stdin)

    Examples:
        benchling-webhook-config write '{"benchlingTenant": "my-tenant"}'
        benchling-webhook-config write @config.json --type derived
        cat config.json | benchling-webhook-config write - --profile dev
    """
    try:
        # Parse JSON input
        if json_data == "-":
            # Read from stdin
            json_data = sys.stdin.read()
        elif json_data.startswith("@"):
            # Read from file
            file_path = Path(json_data[1:])
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")
            json_data = file_path.read_text()

        config_data = json.loads(json_data)

        # Validate if requested
        if validate:
            config_model = get_config_model(ConfigType(config_type))
            try:
                validated = config_model(**config_data)
                config_data = validated.model_dump(by_alias=True, exclude_none=True)
                click.echo("✓ Configuration validated successfully", err=True)
            except ValidationError as e:
                click.echo(f"✗ Validation failed:\n{e}", err=True)
                sys.exit(1)

        # Create backup if requested
        xdg = XDGConfig(profile=profile)
        config_path = xdg.get_config_path(config_type, profile)  # type: ignore[arg-type]

        if backup and config_path.exists():
            backup_path = config_path.with_suffix(f".json.backup")
            import shutil

            shutil.copy2(config_path, backup_path)
            click.echo(f"✓ Backup created: {backup_path}", err=True)

        # Write configuration
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)

        click.echo(f"✓ Configuration written to {config_path}", err=True)

    except Exception as e:
        handle_error(e, verbose)


@cli.command()
@click.argument("json_data", type=str)
@click.option("--profile", "-p", default="default", help="Configuration profile to merge into", show_default=True)
@click.option(
    "--type",
    "-t",
    "config_type",
    type=click.Choice(["user", "derived", "deploy"], case_sensitive=False),
    default="user",
    help="Configuration type to merge",
    show_default=True,
)
@click.option("--validate/--no-validate", default=True, help="Validate after merging", show_default=True)
@click.option("--backup/--no-backup", default=True, help="Create backup before merging", show_default=True)
@click.option("--verbose", "-v", is_flag=True, help="Verbose error output")
def merge(json_data: str, profile: str, config_type: str, validate: bool, backup: bool, verbose: bool):
    """
    Merge JSON data into existing configuration

    Performs a deep merge, preserving existing fields not present in the input.

    JSON_DATA format is the same as 'write' command.

    Examples:
        benchling-webhook-config merge '{"cdkRegion": "us-west-2"}'
        benchling-webhook-config merge @updates.json --type derived
    """
    try:
        # Parse JSON input (same logic as write)
        if json_data == "-":
            json_data = sys.stdin.read()
        elif json_data.startswith("@"):
            file_path = Path(json_data[1:])
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")
            json_data = file_path.read_text()

        merge_data = json.loads(json_data)

        xdg = XDGConfig(profile=profile)
        existing_data = xdg.read_config(config_type, raise_if_missing=False) or {}  # type: ignore[arg-type]

        # Deep merge
        merged_data = xdg._deep_merge(existing_data, merge_data)

        # Validate if requested
        if validate:
            config_model = get_config_model(ConfigType(config_type))
            try:
                validated = config_model(**merged_data)
                merged_data = validated.model_dump(by_alias=True, exclude_none=True)
                click.echo("✓ Merged configuration validated successfully", err=True)
            except ValidationError as e:
                click.echo(f"✗ Validation failed:\n{e}", err=True)
                sys.exit(1)

        # Create backup if requested
        config_path = xdg.get_config_path(config_type, profile)  # type: ignore[arg-type]
        if backup and config_path.exists():
            backup_path = config_path.with_suffix(f".json.backup")
            import shutil

            shutil.copy2(config_path, backup_path)
            click.echo(f"✓ Backup created: {backup_path}", err=True)

        # Write merged configuration
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(merged_data, f, indent=2, ensure_ascii=False)

        click.echo(f"✓ Configuration merged and written to {config_path}", err=True)

    except Exception as e:
        handle_error(e, verbose)


@cli.command()
@click.option("--profile", "-p", default="default", help="Configuration profile to validate", show_default=True)
@click.option(
    "--type",
    "-t",
    "config_type",
    type=click.Choice(["user", "derived", "deploy", "all"], case_sensitive=False),
    default="all",
    help="Configuration type to validate",
    show_default=True,
)
@click.option("--verbose", "-v", is_flag=True, help="Verbose error output")
def validate(profile: str, config_type: str, verbose: bool):
    """
    Validate configuration against schema

    Examples:
        benchling-webhook-config validate
        benchling-webhook-config validate --type user
        benchling-webhook-config validate --profile dev --type all
    """
    try:
        xdg = XDGConfig(profile=profile)
        types_to_validate = ["user", "derived", "deploy"] if config_type == "all" else [config_type]

        all_valid = True
        for ct in types_to_validate:
            try:
                config_data = xdg.read_config(ct, raise_if_missing=False)  # type: ignore[arg-type]
                if config_data is None:
                    click.echo(f"⊘ {ct:8s} - Not found (skipping)", err=True)
                    continue

                config_model = get_config_model(ConfigType(ct))
                config_model(**config_data)
                click.echo(f"✓ {ct:8s} - Valid", err=True)

            except ValidationError as e:
                all_valid = False
                click.echo(f"✗ {ct:8s} - Invalid", err=True)
                if verbose:
                    click.echo(f"  {e}", err=True)
                else:
                    click.echo(f"  {e.error_count()} validation error(s)", err=True)

        sys.exit(0 if all_valid else 1)

    except Exception as e:
        handle_error(e, verbose)


@cli.command(name="list")
@click.option("--verbose", "-v", is_flag=True, help="Show additional profile details")
def list_profiles(verbose: bool):
    """
    List all available configuration profiles

    Examples:
        benchling-webhook-config list
        benchling-webhook-config list --verbose
    """
    try:
        xdg = XDGConfig()
        profiles = xdg.list_profiles()

        click.echo("Available profiles:", err=True)
        for profile in profiles:
            if verbose:
                # Show which config files exist
                xdg_profile = XDGConfig(profile=profile)
                files = []
                for ct in ["user", "derived", "deploy"]:
                    path = xdg_profile.get_config_path(ct)  # type: ignore[arg-type]
                    if path.exists():
                        files.append(ct[0].upper())  # U, D, P
                    else:
                        files.append("-")
                status = "".join(files)
                click.echo(f"  {profile:20s} [{status}]")
            else:
                click.echo(f"  {profile}")

    except Exception as e:
        handle_error(e, verbose=True)


@cli.command()
@click.option("--profile", "-p", default="default", help="Configuration profile to export", show_default=True)
@click.option(
    "--type",
    "-t",
    "config_type",
    type=click.Choice(["user", "derived", "deploy", "complete"], case_sensitive=False),
    default="complete",
    help="Configuration type to export",
    show_default=True,
)
@click.option("--pretty/--compact", default=True, help="Pretty print JSON output", show_default=True)
@click.option("--verbose", "-v", is_flag=True, help="Verbose error output")
def export(profile: str, config_type: str, pretty: bool, verbose: bool):
    """
    Export configuration as JSON

    Use 'complete' to export merged configuration from all sources.

    Examples:
        benchling-webhook-config export
        benchling-webhook-config export --type user --profile dev
        benchling-webhook-config export --compact > config.json
    """
    try:
        xdg = XDGConfig(profile=profile)

        if config_type == "complete":
            config_data = xdg.load_complete_config()
        else:
            config_data = xdg.read_config(config_type, raise_if_missing=True)  # type: ignore[arg-type]

        if config_data is None:
            click.echo(f"Configuration not found: {config_type}/{profile}", err=True)
            sys.exit(1)

        click.echo(format_json(config_data, pretty=pretty))

    except Exception as e:
        handle_error(e, verbose)


@cli.command()
@click.argument("key", type=str)
@click.option("--profile", "-p", default="default", help="Configuration profile to read from", show_default=True)
@click.option(
    "--type",
    "-t",
    "config_type",
    type=click.Choice(["user", "derived", "deploy", "complete"], case_sensitive=False),
    default="complete",
    help="Configuration type to read from",
    show_default=True,
)
@click.option("--default", "-d", type=str, help="Default value if key not found")
@click.option("--verbose", "-v", is_flag=True, help="Verbose error output")
def get(key: str, profile: str, config_type: str, default: Optional[str], verbose: bool):
    """
    Get a specific configuration field value

    Supports nested keys with dot notation (e.g., "_metadata.version")

    Examples:
        benchling-webhook-config get benchlingTenant
        benchling-webhook-config get cdkRegion --type user
        benchling-webhook-config get _metadata.version --default "unknown"
    """
    try:
        xdg = XDGConfig(profile=profile)

        if config_type == "complete":
            config_data = xdg.load_complete_config()
        else:
            config_data = xdg.read_config(config_type, raise_if_missing=True)  # type: ignore[arg-type]

        if config_data is None:
            if default is not None:
                click.echo(default)
                sys.exit(0)
            click.echo(f"Configuration not found: {config_type}/{profile}", err=True)
            sys.exit(1)

        # Support nested keys (e.g., "_metadata.version")
        value = config_data
        for key_part in key.split("."):
            if isinstance(value, dict) and key_part in value:
                value = value[key_part]
            else:
                if default is not None:
                    click.echo(default)
                    sys.exit(0)
                click.echo(f"Key not found: {key}", err=True)
                sys.exit(1)

        # Output value
        if isinstance(value, (dict, list)):
            click.echo(format_json(value, pretty=True))
        else:
            click.echo(str(value))

    except Exception as e:
        handle_error(e, verbose)


@cli.command()
@click.argument("key", type=str)
@click.argument("value", type=str)
@click.option("--profile", "-p", default="default", help="Configuration profile to write to", show_default=True)
@click.option(
    "--type",
    "-t",
    "config_type",
    type=click.Choice(["user", "derived", "deploy"], case_sensitive=False),
    default="user",
    help="Configuration type to write to",
    show_default=True,
)
@click.option("--json", "-j", is_flag=True, help="Parse value as JSON")
@click.option("--backup/--no-backup", default=True, help="Create backup before writing", show_default=True)
@click.option("--verbose", "-v", is_flag=True, help="Verbose error output")
def set(key: str, value: str, profile: str, config_type: str, json: bool, backup: bool, verbose: bool):
    """
    Set a specific configuration field value

    Supports nested keys with dot notation (e.g., "_metadata.version")

    Examples:
        benchling-webhook-config set benchlingTenant my-tenant
        benchling-webhook-config set cdkRegion us-west-2 --type user
        benchling-webhook-config set _metadata.source manual --no-backup
        benchling-webhook-config set pkgPrefix test --json '{"key": "value"}'
    """
    try:
        xdg = XDGConfig(profile=profile)
        config_data = xdg.read_config(config_type, raise_if_missing=False) or {}  # type: ignore[arg-type]

        # Parse value if JSON flag is set
        parsed_value = json.loads(value) if json else value  # type: ignore[attr-defined]

        # Support nested keys
        key_parts = key.split(".")
        current = config_data
        for key_part in key_parts[:-1]:
            if key_part not in current:
                current[key_part] = {}
            current = current[key_part]

        current[key_parts[-1]] = parsed_value

        # Create backup if requested
        config_path = xdg.get_config_path(config_type, profile)  # type: ignore[arg-type]
        if backup and config_path.exists():
            backup_path = config_path.with_suffix(f".json.backup")
            import shutil

            shutil.copy2(config_path, backup_path)

        # Write updated configuration
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)  # type: ignore[attr-defined]

        click.echo(f"✓ {key} = {parsed_value}", err=True)
        click.echo(f"✓ Configuration updated: {config_path}", err=True)

    except Exception as e:
        handle_error(e, verbose)


if __name__ == "__main__":
    cli()
