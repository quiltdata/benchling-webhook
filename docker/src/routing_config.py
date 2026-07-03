from __future__ import annotations

import copy
import threading
import time
from dataclasses import dataclass
from typing import Any

import structlog

from .secrets_manager import BenchlingSecretData

logger = structlog.get_logger(__name__)

ROUTING_NAMESPACE = "quilt"
ROUTING_CACHE_TTL_SECONDS = 60


@dataclass(frozen=True)
class RoutingTarget:
    bucket: str | None = None
    prefix: str | None = None
    package_key: str | None = None
    workflow: str | None = None

    @classmethod
    def from_mapping(cls, values: dict[str, Any]) -> "RoutingTarget":
        return cls(
            bucket=_string_value(values, "bucket", "s3_bucket_name", "user_bucket"),
            prefix=_string_value(values, "prefix", "s3_prefix", "pkg_prefix"),
            package_key=_string_value(values, "package_key", "metadata_key", "pkg_key", "metadataKey"),
            workflow=_string_value(values, "workflow"),
        )

    def merge(self, lower: "RoutingTarget") -> "RoutingTarget":
        return RoutingTarget(
            bucket=self.bucket or lower.bucket,
            prefix=self.prefix or lower.prefix,
            package_key=self.package_key or lower.package_key,
            workflow=self.workflow if self.workflow is not None else lower.workflow,
        )

    def to_dict(self) -> dict[str, str]:
        result: dict[str, str] = {}
        if isinstance(self.bucket, str):
            result["bucket"] = self.bucket
        if isinstance(self.prefix, str):
            result["prefix"] = self.prefix
        if isinstance(self.package_key, str):
            result["package_key"] = self.package_key
        if isinstance(self.workflow, str):
            result["workflow"] = self.workflow
        return result


@dataclass(frozen=True)
class RuntimeSettings:
    log_level: str | None = None
    package_event_concurrency: int | None = None
    packaging_request_concurrency: int | None = None


@dataclass(frozen=True)
class EffectiveRouting:
    target: RoutingTarget
    source: str
    project_name: str | None = None

    def to_queue_metadata(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "project_name": self.project_name,
            "target": self.target.to_dict(),
        }

    @classmethod
    def from_queue_metadata(cls, metadata: Any) -> "EffectiveRouting | None":
        if not isinstance(metadata, dict):
            return None
        target = metadata.get("target")
        if not isinstance(target, dict):
            return None
        return cls(
            target=RoutingTarget.from_mapping(target),
            source=str(metadata.get("source") or "queue"),
            project_name=metadata.get("project_name") if isinstance(metadata.get("project_name"), str) else None,
        )


@dataclass(frozen=True)
class RoutingConfig:
    event_routes: dict[str, RoutingTarget]
    project_routes: dict[str, RoutingTarget]
    default: RoutingTarget
    settings: RuntimeSettings

    @classmethod
    def empty(cls) -> "RoutingConfig":
        return cls(event_routes={}, project_routes={}, default=RoutingTarget(), settings=RuntimeSettings())

    @classmethod
    def from_app_configuration_items(cls, items: list[Any]) -> "RoutingConfig":
        nested: dict[str, Any] = {}
        for item in items:
            path = _item_path(item)
            if len(path) < 3 or path[0] != ROUTING_NAMESPACE:
                continue
            _assign_path(nested, path[1:], _item_value(item))

        return cls(
            event_routes={
                event_type: RoutingTarget.from_mapping(values)
                for event_type, values in nested.get("routing", {}).items()
                if isinstance(values, dict)
            },
            project_routes={
                project_name: RoutingTarget.from_mapping(values)
                for project_name, values in nested.get("projects", {}).items()
                if isinstance(values, dict)
            },
            default=RoutingTarget.from_mapping(nested.get("default", {})),
            settings=_settings_from_mapping(nested.get("settings", {})),
        )

    def is_empty(self) -> bool:
        return (
            not self.event_routes
            and not self.project_routes
            and not self.default.to_dict()
            and self.settings == RuntimeSettings()
        )

    def resolve(
        self,
        *,
        event_type: str,
        legacy: RoutingTarget,
        project_name: str | None = None,
    ) -> EffectiveRouting:
        target = self.default.merge(legacy)
        source = "global_default" if self.default.to_dict() else "legacy"

        event_route = self.event_routes.get(event_type)
        if event_route:
            target = event_route.merge(target)
            source = "event"

        project_route = self.project_routes.get(project_name or "")
        if project_route:
            target = project_route.merge(target)
            source = "project"

        return EffectiveRouting(target=target, source=source, project_name=project_name)


class RoutingConfigCache:
    def __init__(self, ttl: float = ROUTING_CACHE_TTL_SECONDS):
        self.ttl = ttl
        self.app_id: str | None = None
        self.value: RoutingConfig | None = None
        self.timestamp = 0.0
        self.lock = threading.Lock()
        self.refresh_in_progress = False

    def invalidate(self) -> None:
        with self.lock:
            self.value = None
            self.timestamp = 0.0
            self.refresh_in_progress = False

    def get(self, benchling: Any, app_definition_id: str) -> RoutingConfig:
        now = time.monotonic()
        if self.value is not None and now - self.timestamp < self.ttl:
            return self.value

        if self.value is not None:
            with self.lock:
                if not self.refresh_in_progress:
                    self.refresh_in_progress = True
                    thread = threading.Thread(
                        target=self._refresh_background,
                        args=(benchling, app_definition_id),
                        daemon=True,
                    )
                    thread.start()
            return self.value

        return self._fetch(benchling, app_definition_id)

    def _refresh_background(self, benchling: Any, app_definition_id: str) -> None:
        try:
            self._fetch(benchling, app_definition_id)
        except Exception as exc:
            logger.warning("Tier 1 config refresh failed; serving stale config", error=str(exc))
        finally:
            self.refresh_in_progress = False

    def _fetch(self, benchling: Any, app_definition_id: str) -> RoutingConfig:
        app_id = self.app_id or find_app_id(benchling, app_definition_id)
        if not app_id:
            logger.warning("Could not resolve Benchling app id for Tier 1 config", app_definition_id=app_definition_id)
            config = RoutingConfig.empty()
        else:
            items = _flatten_pages(benchling.apps.list_app_configuration_items(app_id=app_id))
            config = RoutingConfig.from_app_configuration_items(items)
            self.app_id = app_id

        self.value = config
        self.timestamp = time.monotonic()
        logger.info(
            "Tier 1 routing config cached",
            app_id=self.app_id,
            event_routes=len(config.event_routes),
            project_routes=len(config.project_routes),
            has_default=bool(config.default.to_dict()),
        )
        return config


def find_app_id(benchling: Any, app_definition_id: str) -> str | None:
    for app in _flatten_pages(benchling.apps.list_apps()):
        app_definition = getattr(app, "app_definition", None)
        candidate = getattr(app_definition, "id", None)
        if candidate == app_definition_id:
            return getattr(app, "id", None)
    return None


def legacy_target_from_secret(secret_data: BenchlingSecretData) -> RoutingTarget:
    return RoutingTarget(
        bucket=_optional_string(getattr(secret_data, "user_bucket", None)),
        prefix=_optional_string(getattr(secret_data, "pkg_prefix", None)) or "benchling",
        package_key=_optional_string(getattr(secret_data, "pkg_key", None)) or "experiment_id",
        workflow=_optional_string(getattr(secret_data, "workflow", None)) or "",
    )


def apply_routing_to_config(config: Any, routing: EffectiveRouting) -> None:
    target = routing.target
    if target.bucket:
        config.s3_bucket_name = target.bucket
    if target.prefix:
        config.s3_prefix = target.prefix
        config.pkg_prefix = target.prefix
    if target.package_key:
        config.package_key = target.package_key
    if target.workflow is not None:
        config.workflow = target.workflow


def routed_config_copy(config: Any, routing: EffectiveRouting) -> Any:
    clone = copy.copy(config)
    apply_routing_to_config(clone, routing)
    return clone


def _flatten_pages(iterator: Any) -> list[Any]:
    result: list[Any] = []
    for page in iterator:
        if isinstance(page, list):
            result.extend(page)
        else:
            result.append(page)
    return result


def _item_path(item: Any) -> list[str]:
    path = getattr(item, "path", None)
    if path is None and hasattr(item, "additional_properties"):
        path = item.additional_properties.get("path")
    if isinstance(path, list):
        return [str(part) for part in path]
    return []


def _item_value(item: Any) -> Any:
    if hasattr(item, "value"):
        return item.value
    if hasattr(item, "additional_properties") and "value" in item.additional_properties:
        return item.additional_properties["value"]
    return None


def _assign_path(target: dict[str, Any], path: list[str], value: Any) -> None:
    node = target
    for part in path[:-1]:
        child = node.setdefault(part, {})
        if not isinstance(child, dict):
            return
        node = child
    node[path[-1]] = value


def _string_value(values: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = values.get(key)
        cleaned = _optional_string(value)
        if cleaned is not None:
            return cleaned
    return None


def _optional_string(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    return None


def _settings_from_mapping(values: Any) -> RuntimeSettings:
    if not isinstance(values, dict):
        return RuntimeSettings()
    return RuntimeSettings(
        log_level=_string_value(values, "log_level", "logLevel"),
        package_event_concurrency=_int_value(values.get("package_event_concurrency")),
        packaging_request_concurrency=_int_value(values.get("packaging_request_concurrency")),
    )


def _int_value(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None
