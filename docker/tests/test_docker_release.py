"""Focused tests for monotonic ECR release promotion."""

import os

import pytest

os.environ.setdefault("DOCKER_IMAGE_NAME", "quiltdata/benchling")

from scripts.docker import (  # noqa: E402
    CENTRAL_ECR_REGISTRY_ID,
    EcrImage,
    compare_release_versions,
    parse_args,
    promote_ecr_latest,
)


class FakeEcrRegistry:
    def __init__(self, candidate: str):
        self.candidate = candidate
        self.images: dict[str, EcrImage] = {
            candidate: EcrImage(digest=f"sha256:{candidate}", tags=(candidate,)),
        }
        self.put_calls: list[str] = []
        self.fail_lookup = False
        self.fail_manifest = False
        self.fail_put = False
        self.selected_candidate: str | None = None

    def describe_image(self, tag: str) -> EcrImage | None:
        if self.fail_lookup:
            raise RuntimeError("AWS lookup failed")
        return self.images.get(tag)

    def get_manifest(self, tag: str) -> tuple[str, str | None]:
        if self.fail_manifest:
            raise RuntimeError("manifest lookup failed")
        self.selected_candidate = tag
        return f'{{"candidate":"{tag}"}}', "application/vnd.oci.image.manifest.v1+json"

    def put_manifest(self, tag: str, manifest: str, media_type: str | None) -> None:
        _ = manifest, media_type
        self.put_calls.append(tag)
        if self.fail_put:
            raise RuntimeError("put failed")
        assert self.selected_candidate is not None
        candidate_image = self.images[self.selected_candidate]
        self.images[tag] = EcrImage(
            digest=candidate_image.digest,
            tags=(self.selected_candidate, tag),
        )


def with_latest(candidate: str, current: str) -> FakeEcrRegistry:
    registry = FakeEcrRegistry(candidate)
    registry.images["latest"] = EcrImage(
        digest=f"sha256:{current}",
        tags=(current, "latest"),
    )
    return registry


def test_promote_command_defaults_to_the_central_ecr_registry():
    args = parse_args(["promote", "--version", "1.2.3"])

    assert args.repository == "quiltdata/benchling"
    assert args.registry_id == CENTRAL_ECR_REGISTRY_ID == "712023778557"


def test_missing_latest_is_initialized_by_manifest_retag():
    registry = FakeEcrRegistry("1.2.3")

    assert promote_ecr_latest(registry, "1.2.3") == "initialized"
    assert registry.put_calls == ["latest"]
    assert registry.images["latest"].digest == registry.images["1.2.3"].digest


@pytest.mark.parametrize(
    ("current", "expected", "promoted"),
    [
        ("1.2.2", "promoted", True),
        ("1.2.3", "current", False),
        ("1.2.4", "stale", False),
    ],
)
def test_semantic_release_order_is_monotonic(current: str, expected: str, promoted: bool):
    registry = with_latest("1.2.3", current)

    assert promote_ecr_latest(registry, "1.2.3") == expected
    assert bool(registry.put_calls) is promoted


def test_timestamp_prereleases_are_ordered_and_stable_wins_same_base():
    older = "1.2.3-20261012T202246Z"
    newer = "1.2.3-20261012T212246Z"

    assert compare_release_versions(newer, older) > 0
    assert compare_release_versions("1.2.3", newer) > 0
    assert compare_release_versions("1.2.4-20261012T202246Z", "1.2.3") > 0
    assert promote_ecr_latest(with_latest(newer, older), newer) == "promoted"
    assert promote_ecr_latest(with_latest(newer, "1.2.3"), newer) == "stale"


@pytest.mark.parametrize(
    "tags",
    [
        ("latest", "not-a-version"),
        ("latest", "1.2.2", "1.2.1"),
    ],
)
def test_unversioned_or_ambiguous_latest_fails_closed(tags: tuple[str, ...]):
    registry = FakeEcrRegistry("1.2.3")
    registry.images["latest"] = EcrImage(digest="sha256:latest", tags=tags)

    with pytest.raises(RuntimeError):
        promote_ecr_latest(registry, "1.2.3")
    assert registry.put_calls == []


def test_aws_lookup_failure_fails_closed():
    registry = FakeEcrRegistry("1.2.3")
    registry.fail_lookup = True

    with pytest.raises(RuntimeError, match="AWS lookup failed"):
        promote_ecr_latest(registry, "1.2.3")


def test_manifest_lookup_and_put_failures_fail_closed():
    manifest_failure = FakeEcrRegistry("1.2.3")
    manifest_failure.fail_manifest = True
    with pytest.raises(RuntimeError, match="manifest lookup failed"):
        promote_ecr_latest(manifest_failure, "1.2.3")

    put_failure = FakeEcrRegistry("1.2.3")
    put_failure.fail_put = True
    with pytest.raises(RuntimeError, match="put failed"):
        promote_ecr_latest(put_failure, "1.2.3")


def test_newer_first_older_second_keeps_both_immutable_images_and_newer_latest():
    registry = FakeEcrRegistry("2.0.0")
    assert promote_ecr_latest(registry, "2.0.0") == "initialized"

    registry.candidate = "1.9.0"
    registry.images["1.9.0"] = EcrImage(digest="sha256:1.9.0", tags=("1.9.0",))
    assert promote_ecr_latest(registry, "1.9.0") == "stale"

    assert set(registry.images) >= {"2.0.0", "1.9.0", "latest"}
    assert registry.images["latest"].digest == registry.images["2.0.0"].digest


def test_retry_after_failed_promotion_completes_without_republishing_immutable_image():
    registry = FakeEcrRegistry("1.2.3")
    registry.fail_put = True
    with pytest.raises(RuntimeError, match="put failed"):
        promote_ecr_latest(registry, "1.2.3")

    registry.fail_put = False
    assert promote_ecr_latest(registry, "1.2.3") == "initialized"
    assert registry.images["latest"].digest == registry.images["1.2.3"].digest
