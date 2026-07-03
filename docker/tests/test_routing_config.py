from types import SimpleNamespace

from src.routing_config import (
    EffectiveRouting,
    RoutingConfig,
    RoutingTarget,
    find_app_id,
)


def item(path, value):
    return SimpleNamespace(path=path, value=value, id="/".join(path), type="text")


def test_routing_config_parses_namespaced_items():
    config = RoutingConfig.from_app_configuration_items(
        [
            item(["quilt", "default", "bucket"], "default-bucket"),
            item(["quilt", "routing", "v2.entry.created", "prefix"], "created"),
            item(["quilt", "projects", "Study A", "workflow"], "study-workflow"),
            item(["other", "default", "bucket"], "ignored"),
        ]
    )

    assert config.default.bucket == "default-bucket"
    assert config.event_routes["v2.entry.created"].prefix == "created"
    assert config.project_routes["Study A"].workflow == "study-workflow"


def test_routing_resolution_field_level_merge_precedence():
    config = RoutingConfig(
        event_routes={"v2.entry.created": RoutingTarget(prefix="created-prefix")},
        project_routes={"Study A": RoutingTarget(bucket="project-bucket")},
        default=RoutingTarget(bucket="default-bucket", prefix="default-prefix", package_key="experiment_id"),
        settings=RoutingConfig.empty().settings,
    )

    effective = config.resolve(
        event_type="v2.entry.created",
        project_name="Study A",
        legacy=RoutingTarget(bucket="legacy-bucket", prefix="legacy-prefix", package_key="legacy_key"),
    )

    assert effective.target.bucket == "project-bucket"
    assert effective.target.prefix == "created-prefix"
    assert effective.target.package_key == "experiment_id"
    assert effective.source == "project"


def test_queue_metadata_round_trip():
    routing = EffectiveRouting(
        target=RoutingTarget(bucket="bucket", prefix="prefix", package_key="key", workflow="flow"),
        source="project",
        project_name="Study A",
    )

    assert EffectiveRouting.from_queue_metadata(routing.to_queue_metadata()) == routing


def test_find_app_id_matches_app_definition_id():
    app = SimpleNamespace(id="app_123", app_definition=SimpleNamespace(id="appdef_123"))
    benchling = SimpleNamespace(apps=SimpleNamespace(list_apps=lambda: [[app]]))

    assert find_app_id(benchling, "appdef_123") == "app_123"
