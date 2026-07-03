#!/usr/bin/env python3
"""
Probe: list_app_configuration_items

Determines the correct app_id parameter for
benchling.apps.list_app_configuration_items() so Phase 1
configurability implementation is unblocked.

Usage:
    cd docker
    uv run python -m scripts.probe_config_items [--profile PROFILE] [--seed]

With --seed: creates test config items on the named app (default: quilt-docker),
lists them back to verify structure, then cleans up.

Exit code: 0 if at least one candidate succeeded, 1 if all failed.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Path setup — same pattern as scripts/benchling-webhook-config and
# scripts/test_benchling.py
# ---------------------------------------------------------------------------
_SCRIPTS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPTS_DIR.parent
sys.path.insert(0, str(_PROJECT_ROOT / "src"))

import boto3
from benchling_sdk.auth.client_credentials_oauth2 import ClientCredentialsOAuth2
from benchling_sdk.benchling import Benchling
from botocore.config import Config as BotocoreConfig

from src.secrets_manager import BenchlingSecretData, fetch_benchling_secret
from src.xdg_config import XDGConfig

# ---------------------------------------------------------------------------
# SDK model imports (used by --seed)
# ---------------------------------------------------------------------------
_SEED_TYPE = None  # lazy-imported in _seed_items

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

logger: Any = None  # placeholder if we ever add logging


def load_profile_config(profile: str) -> dict[str, Any]:
    """Load and return the complete merged XDG config for *profile*."""
    xdg = XDGConfig(profile=profile)
    return xdg.load_complete_config()


def fetch_secret(region: str, secret_arn: str) -> BenchlingSecretData:
    """Fetch Benchling secret data from AWS Secrets Manager."""
    session = boto3.Session(region_name=region)
    sm_client = session.client(
        "secretsmanager",
        config=BotocoreConfig(
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=10,
        ),
    )
    return fetch_benchling_secret(sm_client, region, secret_arn)


def create_benchling_client(secrets: BenchlingSecretData) -> Benchling:
    """Create a Benchling SDK client matching the running app's pattern."""
    auth_method = ClientCredentialsOAuth2(
        client_id=secrets.client_id,
        client_secret=secrets.client_secret,
    )
    return Benchling(
        url=f"https://{secrets.tenant}.benchling.com",
        auth_method=auth_method,
    )


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------

Result = dict[str, Any]


def _flatten_items(iterator) -> list:
    """PageIterator yields pages (List[Model]), not individual items. Flatten."""
    return [item for page in iterator for item in page]


def _get_config_items(
    benchling: Benchling,
    app_id: Optional[str] = None,
    config_item_id: Optional[str] = None,
) -> list:
    """Fetch config items, flattening PageIterator pages into a single list."""
    if config_item_id:
        raw = benchling.apps.get_app_configuration_item_by_id(config_item_id)
        return [raw] if raw else []
    kwargs = {}
    if app_id is not None:
        kwargs["app_id"] = app_id
    return _flatten_items(benchling.apps.list_app_configuration_items(**kwargs))


def _item_to_dict(item: Any) -> dict[str, Any]:
    """Convert a config item to a plain dict for JSON output."""
    d: dict[str, Any] = {
        "id": getattr(item, "id", None),
        "path": getattr(item, "path", None),
        "type": getattr(item, "type", None),
    }
    app_attr = getattr(item, "app", None)
    if app_attr is not None:
        d["app"] = {
            "id": getattr(app_attr, "id", None),
            # name may be in additional_properties for some SDK versions
            "name": getattr(app_attr, "name", app_attr.get("name", None)),
        }
    raw_value = getattr(item, "value", item.get("value", None))
    if raw_value is not None:
        d["value"] = "<masked>" if _looks_sensitive(raw_value) else raw_value
    return d


def try_candidate(
    label: str,
    benchling: Benchling,
    app_id: Optional[str] = None,
    config_item_id: Optional[str] = None,
) -> Result:
    """Run one candidate and return a structured result dict.

    The dict follows the schema in
    spec/392-configurability/05a-list_app_configuration_items.md so it can be
    pasted directly into the spec table.
    """
    result: Result = {
        "candidate": label,
        "http_status": None,
        "error_message": None,
        "items_returned": None,
        "first_item": None,
    }

    try:
        items = _get_config_items(benchling, app_id=app_id, config_item_id=config_item_id)

        result["http_status"] = 200
        result["items_returned"] = len(items)

        if items:
            result["first_item"] = _item_to_dict(items[0])

    except Exception as exc:
        result["http_status"] = _extract_http_status(exc)
        result["error_message"] = str(exc)

    return result


def _extract_http_status(exc: Exception) -> int:
    """Try to pull HTTP status code from a Benchling/requests exception."""
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if status:
        return int(status)

    msg = str(exc).lower()
    if "403" in msg or "forbidden" in msg:
        return 403
    if "404" in msg or "not found" in msg:
        return 404
    if "401" in msg or "unauthorized" in msg:
        return 401
    if "429" in msg or "too many" in msg:
        return 429
    return 0


def _looks_sensitive(value: Any) -> bool:
    """Heuristic: mask values that look like secrets / long tokens."""
    if not isinstance(value, str):
        return False
    if len(value) > 40:
        return True
    sensitive_keywords = ("secret", "token", "key", "password", "credential")
    return any(kw in value.lower() for kw in sensitive_keywords)


# ---------------------------------------------------------------------------
# Seed / cleanup helpers
# ---------------------------------------------------------------------------


def _find_app_by_name(benchling: Benchling, name: str) -> Any:
    """Find a BenchlingApp by name. Returns None if not found."""
    for page in benchling.apps.list_apps():
        for app in page:
            if app.name == name:
                return app
    return None


def _seed_app_config_items(
    benchling: Benchling,
    app_id: str,
    items: list[dict[str, Any]],
    verbose: bool = False,
) -> list[str]:
    """Create config items and return their IDs.

    Each item dict must have:
        - path: list[str]
        - value: str
    """
    from benchling_api_client.v2.stable.models.app_config_item_generic_create import (
        AppConfigItemGenericCreate,
    )
    from benchling_api_client.v2.stable.models.app_config_item_generic_create_type import (
        AppConfigItemGenericCreateType,
    )

    created_ids: list[str] = []
    for item_def in items:
        try:
            create = AppConfigItemGenericCreate(
                type=AppConfigItemGenericCreateType("text"),
                app_id=app_id,
                path=item_def["path"],
                value=item_def["value"],
            )
            result = benchling.apps.create_app_configuration_item(create)
            created_ids.append(result.id)
            if verbose:
                print(
                    f"  ✅ Created config item: {result.id}  path={item_def['path']}",
                    file=sys.stderr,
                )
        except Exception as exc:
            print(
                f"  ❌ Failed to create config item path={item_def['path']}: {exc}",
                file=sys.stderr,
            )
    return created_ids


def _cleanup_config_items(
    benchling: Benchling,
    item_ids: list[str],
    verbose: bool = False,
) -> None:
    """Note: No SDK delete/archive endpoint for config items yet.

    The Benchling SDK AppService has archive_app_configuration_items
    commented out (TODO BNCH-52599). Items must be cleaned up via
    the Benchling UI or API directly.

    Logs the item IDs for manual cleanup.
    """
    if not item_ids:
        return
    print(
        f"  ⚠️  Created {len(item_ids)} config items — SDK has no delete endpoint yet.",
        file=sys.stderr,
    )
    print(
        f"  ⚠️  Clean up manually via Benchling UI or API: {item_ids}",
        file=sys.stderr,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Probe benchling.apps.list_app_configuration_items to determine the correct app_id.",
    )
    parser.add_argument(
        "--profile",
        default="dev",
        help="XDG configuration profile to load (default: dev)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print progress messages to stderr",
    )
    parser.add_argument(
        "--seed",
        action="store_true",
        help="Create test config items on --seed-app-name (default: quilt-docker) to verify round-trip",
    )
    parser.add_argument(
        "--seed-app-name",
        default="quilt-docker",
        help="App name to seed config items on (default: quilt-docker)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="When --seed, leave items in place after probe (don't archive)",
    )
    args = parser.parse_args()

    # --- 1. Load XDG config ------------------------------------------------
    cfg: dict[str, Any] = {}
    try:
        cfg = load_profile_config(args.profile)
    except Exception as exc:
        _fail(f"Cannot load profile '{args.profile}': {exc}")

    if args.verbose:
        print(f"ℹ️  Loaded config for profile '{args.profile}'", file=sys.stderr)

    # --- 2. Extract needed values from config ------------------------------
    benchling_cfg = cfg.get("benchling", {})
    deployment_cfg = cfg.get("deployment", {})

    secret_arn: str = benchling_cfg.get("secretArn", "") or benchling_cfg.get("secret_arn", "")
    tenant: str = benchling_cfg.get("tenant", "")
    app_definition_id: str = benchling_cfg.get("appDefinitionId", "") or benchling_cfg.get(
        "app_definition_id", ""
    )
    region: str = deployment_cfg.get("region", "") or cfg.get("quilt", {}).get("region", "us-east-1")

    if not secret_arn:
        _fail("No benchling.secretArn found in config. Is the profile set up?")
    if not tenant:
        _fail("No benchling.tenant found in config.")

    # --- 3. Fetch the AWS secret --------------------------------------------
    try:
        secrets = fetch_secret(region, secret_arn)
    except Exception as exc:
        _fail(f"Cannot fetch Benchling secret '{secret_arn}': {exc}")

    if args.verbose:
        print(
            f"ℹ️  Fetched secret: tenant={secrets.tenant}  app_definition_id={secrets.app_definition_id}",
            file=sys.stderr,
        )

    # --- 4. Create Benchling client -----------------------------------------
    try:
        benchling = create_benchling_client(secrets)
    except Exception as exc:
        _fail(f"Cannot create Benchling client: {exc}")

    if args.verbose:
        print("ℹ️  Benchling client created successfully", file=sys.stderr)

    # List installed apps (always do this for diagnostics)
    installed_apps: list[dict[str, Any]] = []
    try:
        for page in benchling.apps.list_apps():
            for app in page:
                installed_apps.append(
                    {
                        "id": app.id,
                        "name": app.name,
                        "app_definition_id": getattr(app, "app_definition", None).id
                        if getattr(app, "app_definition", None)
                        else None,
                    }
                )
    except Exception as exc:
        if args.verbose:
            print(f"⚠️  Could not list apps: {exc}", file=sys.stderr)

    # --- 5. Try candidates ---------------------------------------------------
    all_results: list[Result] = []

    # Candidate 1 — appDefinitionId (from the secret)
    all_results.append(
        try_candidate("appDefinitionId", benchling, app_id=secrets.app_definition_id)
    )

    # Candidate 2 — enumerate installed apps and try each app.id
    if installed_apps:
        for app_info in installed_apps:
            label = f"app.id (name={app_info['name']})"
            all_results.append(
                try_candidate(label, benchling, app_id=app_info["id"])
            )
    else:
        # Fallback: try iterating the PageIterator directly
        try:
            for page in benchling.apps.list_apps():
                for app in page:
                    label = f"app.id (name={app.name})"
                    all_results.append(
                        try_candidate(label, benchling, app_id=app.id)
                    )
        except Exception as exc:
            all_results.append(
                {
                    "candidate": "list_apps() enumeration",
                    "http_status": _extract_http_status(exc),
                    "error_message": f"Cannot enumerate apps: {exc}",
                    "items_returned": None,
                    "first_item": None,
                }
            )

    # Candidate 3 — no app_id filter (may fail)
    all_results.append(try_candidate("no_app_id", benchling, app_id=None))

    # --- 5b. Seed round-trip test -------------------------------------------
    seeded_item_ids: list[str] = []
    if args.seed:
        seed_app = _find_app_by_name(benchling, args.seed_app_name)
        if seed_app is None:
            print(
                f"⚠️  App '{args.seed_app_name}' not found. Skipping seed round-trip.",
                file=sys.stderr,
            )
        else:
            if args.verbose:
                print(
                    f"ℹ️  Seeding config items on app '{seed_app.name}' (id={seed_app.id})",
                    file=sys.stderr,
                )

            seed_items = [
                {"path": ["probe-test", "bucket"], "value": "probe-test-bucket"},
                {"path": ["probe-test", "prefix"], "value": "probe-test-prefix"},
            ]

            seeded_item_ids = _seed_app_config_items(
                benchling, seed_app.id, seed_items, verbose=args.verbose
            )

            if seeded_item_ids:
                # List back by app_id to verify retrieval
                result = try_candidate(
                    f"after_seed (name={seed_app.name})", benchling, app_id=seed_app.id
                )
                all_results.append(result)

                # Also try get-by-id for each seeded item
                for item_id in seeded_item_ids:
                    all_results.append(
                        try_candidate(f"get_by_id ({item_id})", benchling, config_item_id=item_id)
                    )

                # Clean up unless --no-cleanup
                if not args.no_cleanup:
                    if args.verbose:
                        print("ℹ️  Cleaning up seeded items...", file=sys.stderr)
                    _cleanup_config_items(benchling, seeded_item_ids, verbose=args.verbose)

    # --- 6. Print structured JSON -------------------------------------------
    payload = {
        "metadata": {
            "profile": args.profile,
            "tenant": tenant,
            "secret_arn": secret_arn,
            "app_definition_id": app_definition_id,
            "installed_apps": installed_apps,
            "seeded_item_ids": seeded_item_ids if args.seed else None,
        },
        "results": all_results,
    }

    json.dump(payload, sys.stdout, indent=2, default=str)
    print()  # trailing newline

    # --- 7. Exit code -------------------------------------------------------
    any_ok = any(r.get("http_status") == 200 for r in all_results)
    sys.exit(0 if any_ok else 1)


def _fail(msg: str) -> None:
    print(json.dumps({"status": "error", "message": msg}, indent=2))
    sys.exit(1)


if __name__ == "__main__":
    main()
