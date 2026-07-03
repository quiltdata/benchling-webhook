#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPTS_DIR.parent
sys.path.insert(0, str(_PROJECT_ROOT / "src"))

import boto3
from benchling_sdk.auth.client_credentials_oauth2 import ClientCredentialsOAuth2
from benchling_sdk.benchling import Benchling
from botocore.config import Config as BotocoreConfig

from src.routing_config import (
    ROUTING_NAMESPACE,
    RoutingConfig,
    find_app_id,
    legacy_target_from_secret,
)
from src.secrets_manager import BenchlingSecretData, fetch_benchling_secret
from src.xdg_config import XDGConfig


def load_profile(profile: str) -> dict[str, Any]:
    return XDGConfig(profile=profile).load_complete_config()


def fetch_secret(region: str, secret_name_or_arn: str) -> BenchlingSecretData:
    session = boto3.Session(region_name=region)
    client = session.client(
        "secretsmanager",
        config=BotocoreConfig(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=5, read_timeout=10),
    )
    return fetch_benchling_secret(client, region, secret_name_or_arn)


def create_benchling_client(secrets: BenchlingSecretData) -> Benchling:
    auth_method = ClientCredentialsOAuth2(client_id=secrets.client_id, client_secret=secrets.client_secret)
    return Benchling(url=f"https://{secrets.tenant}.benchling.com", auth_method=auth_method)


def flatten_pages(iterator: Any) -> list[Any]:
    return [item for page in iterator for item in (page if isinstance(page, list) else [page])]


def item_path(item: Any) -> list[str]:
    path = getattr(item, "path", None)
    if path is None and hasattr(item, "additional_properties"):
        path = item.additional_properties.get("path")
    return [str(part) for part in path] if isinstance(path, list) else []


def item_value(item: Any) -> Any:
    if hasattr(item, "value"):
        return item.value
    if hasattr(item, "additional_properties"):
        return item.additional_properties.get("value")
    return None


def item_to_dict(item: Any) -> dict[str, Any]:
    return {
        "id": getattr(item, "id", None),
        "path": item_path(item),
        "type": str(getattr(item, "type", "")),
        "value": item_value(item),
    }


def load_context(profile: str) -> tuple[dict[str, Any], BenchlingSecretData, Benchling, str | None, list[Any]]:
    config = load_profile(profile)
    region = config.get("deployment", {}).get("region") or config.get("quilt", {}).get("region")
    secret_name = config.get("benchling", {}).get("secretArn")
    if not region:
        raise RuntimeError("Profile is missing deployment.region/quilt.region")
    if not secret_name:
        raise RuntimeError("Profile is missing benchling.secretArn")
    secrets = fetch_secret(region, secret_name)
    benchling = create_benchling_client(secrets)
    app_id = find_app_id(benchling, secrets.app_definition_id)
    items = flatten_pages(benchling.apps.list_app_configuration_items(app_id=app_id)) if app_id else []
    return config, secrets, benchling, app_id, items


def seed_items(
    config: dict[str, Any],
    secrets: BenchlingSecretData,
    benchling: Benchling,
    app_id: str,
    existing_items: list[Any],
) -> dict[str, list[str]]:
    from benchling_api_client.v2.stable.models.app_config_item_generic_create import AppConfigItemGenericCreate
    from benchling_api_client.v2.stable.models.app_config_item_generic_create_type import (
        AppConfigItemGenericCreateType,
    )
    from benchling_api_client.v2.stable.models.app_config_item_generic_update import AppConfigItemGenericUpdate
    from benchling_api_client.v2.stable.models.app_config_item_generic_update_type import (
        AppConfigItemGenericUpdateType,
    )

    packages = config.get("packages", {})
    logging_config = config.get("logging", {})
    seed_defs = [
        (["quilt", "default", "bucket"], packages.get("bucket") or secrets.user_bucket),
        (["quilt", "default", "prefix"], packages.get("prefix") or secrets.pkg_prefix or "benchling"),
        (["quilt", "default", "package_key"], packages.get("metadataKey") or secrets.pkg_key or "experiment_id"),
        (["quilt", "default", "workflow"], packages.get("workflow") or secrets.workflow or ""),
        (["quilt", "settings", "log_level"], logging_config.get("level") or secrets.log_level or "INFO"),
        (["quilt", "settings", "package_event_concurrency"], "5"),
        (["quilt", "settings", "packaging_request_concurrency"], "5"),
        (["quilt", "settings", "auto_packaging"], "true"),
    ]

    existing_by_path = {tuple(item_path(item)): getattr(item, "id", None) for item in existing_items}
    created: list[str] = []
    updated: list[str] = []
    for path, value in seed_defs:
        existing_id = existing_by_path.get(tuple(path))
        if existing_id:
            update = AppConfigItemGenericUpdate(AppConfigItemGenericUpdateType("text"), str(value))
            benchling.apps.update_app_configuration_item(str(existing_id), update)
            updated.append(str(existing_id))
        else:
            create = AppConfigItemGenericCreate(AppConfigItemGenericCreateType("text"), app_id, path, str(value))
            result = benchling.apps.create_app_configuration_item(create)
            created.append(str(getattr(result, "id", "")))
    return {"created_ids": created, "updated_ids": updated}


def command_inspect(args: argparse.Namespace) -> int:
    _config, secrets, _benchling, app_id, items = load_context(args.profile)
    quilt_items = [item for item in items if item_path(item)[:1] == [ROUTING_NAMESPACE]]
    routing_config = RoutingConfig.from_app_configuration_items(quilt_items)
    legacy = legacy_target_from_secret(secrets)
    effective = routing_config.resolve(event_type=args.event_type or "", legacy=legacy)
    output = {
        "profile": args.profile,
        "app_id": app_id,
        "items": [item_to_dict(item) for item in quilt_items],
        "effective_default": effective.target.to_dict(),
        "routing": {
            "event_routes": {key: value.to_dict() for key, value in routing_config.event_routes.items()},
            "project_routes": {key: value.to_dict() for key, value in routing_config.project_routes.items()},
            "default": routing_config.default.to_dict(),
            "settings": routing_config.settings.__dict__,
        },
    }
    print(json.dumps(output, indent=2, default=str))
    return 0


def command_seed(args: argparse.Namespace) -> int:
    config, secrets, benchling, app_id, items = load_context(args.profile)
    if not app_id:
        raise RuntimeError("Could not resolve Benchling app id")
    try:
        result = seed_items(config, secrets, benchling, app_id, items)
    except Exception as exc:
        raise RuntimeError(
            "Failed to seed App Configuration Items. Confirm docker/app-manifest.yaml "
            "defines the exact config schema paths before running config:seed."
        ) from exc
    print(json.dumps({"profile": args.profile, "app_id": app_id, **result}, indent=2))
    return 0


def command_clear(args: argparse.Namespace) -> int:
    _config, _secrets, _benchling, app_id, items = load_context(args.profile)
    quilt_items = [item for item in items if item_path(item)[:1] == [ROUTING_NAMESPACE]]
    print(
        json.dumps(
            {"profile": args.profile, "app_id": app_id, "items": [item_to_dict(item) for item in quilt_items]},
            indent=2,
            default=str,
        )
    )
    print(
        "Automatic clear is unavailable: Benchling SDK 1.23.1 exposes no usable delete/archive endpoint "
        "for App Configuration Items. Remove these items in the Benchling UI.",
        file=sys.stderr,
    )
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["inspect", "seed", "clear"])
    parser.add_argument("--profile", default="default")
    parser.add_argument("--event-type")
    args = parser.parse_args(argv)

    if args.command == "inspect":
        return command_inspect(args)
    if args.command == "seed":
        return command_seed(args)
    return command_clear(args)


if __name__ == "__main__":
    raise SystemExit(main())
