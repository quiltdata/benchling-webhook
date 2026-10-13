"""Focused tests for retry-safe, monotonic ECR release publication."""

import hashlib
import os
import subprocess
from pathlib import Path

import pytest

os.environ.setdefault("DOCKER_IMAGE_NAME", "quiltdata/benchling")

from scripts.docker import (  # noqa: E402
    CENTRAL_ECR_REGISTRY_ID,
    EcrImage,
    compare_release_versions,
    ensure_ecr_image,
    parse_args,
    promote_ecr_latest,
)


def image_digest(label: str) -> str:
    return f"sha256:{hashlib.sha256(label.encode()).hexdigest()}"


class FakeEcrRegistry:
    def __init__(self, candidate: str, candidate_exists: bool = True):
        self.candidate = candidate
        self.images: dict[str, EcrImage] = {}
        if candidate_exists:
            self.images[candidate] = EcrImage(digest=image_digest(candidate), tags=(candidate,))
        self.put_calls: list[str] = []
        self.publish_calls = 0
        self.publish_succeeds = True
        self.publish_adds_image = True
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
        updated = EcrImage(
            digest=candidate_image.digest,
            tags=tuple(dict.fromkeys((*candidate_image.tags, tag))),
        )
        for image_tag, image in list(self.images.items()):
            if image.digest == candidate_image.digest:
                self.images[image_tag] = updated
        self.images[tag] = updated

    def publish_candidate(self) -> bool:
        self.publish_calls += 1
        if not self.publish_succeeds:
            return False
        if self.publish_adds_image:
            self.images[self.candidate] = EcrImage(
                digest=image_digest(f"{self.candidate}-build-{self.publish_calls}"),
                tags=(self.candidate,),
            )
        return True


def with_latest(candidate: str, current: str) -> FakeEcrRegistry:
    registry = FakeEcrRegistry(candidate)
    registry.images["latest"] = EcrImage(
        digest=image_digest(current),
        tags=(current, "latest"),
    )
    return registry


@pytest.mark.parametrize("command", ["ensure", "promote"])
def test_release_commands_default_to_the_central_ecr_registry(command: str):
    args = parse_args([command, "--version", "1.2.3"])

    assert args.repository == "quiltdata/benchling"
    assert args.registry_id == CENTRAL_ECR_REGISTRY_ID == "712023778557"


def test_make_does_not_export_an_ecr_registry_override():
    """The docker Makefile exports every variable; an ECR_REGISTRY default would
    override STS detection in `push-ci` and send prod builds to the dev account."""
    env = {key: value for key, value in os.environ.items() if key != "ECR_REGISTRY"}
    database = subprocess.run(
        ["make", "-C", str(Path(__file__).resolve().parents[1]), "-pn", "deploy-help"],
        capture_output=True,
        text=True,
        env=env,
        check=True,
    ).stdout

    assert not [line for line in database.splitlines() if line.split(" ", 1)[0] == "ECR_REGISTRY"]


def test_existing_immutable_image_is_reused_without_publishing():
    registry = FakeEcrRegistry("1.2.3")
    original_digest = registry.images["1.2.3"].digest

    outcome, digest = ensure_ecr_image(registry, "1.2.3", registry.publish_candidate)

    assert (outcome, digest) == ("existing", original_digest)
    assert registry.publish_calls == 0


def test_missing_immutable_image_is_published_once_and_verified():
    registry = FakeEcrRegistry("1.2.3", candidate_exists=False)

    outcome, digest = ensure_ecr_image(registry, "1.2.3", registry.publish_candidate)

    assert outcome == "created"
    assert digest == registry.images["1.2.3"].digest
    assert registry.publish_calls == 1


@pytest.mark.parametrize(
    ("configure", "message"),
    [
        (lambda registry: setattr(registry, "publish_succeeds", False), "Failed to publish"),
        (lambda registry: setattr(registry, "publish_adds_image", False), "cannot be found"),
    ],
)
def test_immutable_image_publication_failures_are_not_treated_as_reusable(configure, message: str):
    registry = FakeEcrRegistry("1.2.3", candidate_exists=False)
    configure(registry)

    with pytest.raises(RuntimeError, match=message):
        ensure_ecr_image(registry, "1.2.3", registry.publish_candidate)


@pytest.mark.parametrize(
    "image",
    [
        EcrImage(digest="not-a-digest", tags=("1.2.3",)),
        EcrImage(digest=image_digest("other"), tags=("other",)),
    ],
)
def test_unverifiable_existing_immutable_image_fails_closed(image: EcrImage):
    registry = FakeEcrRegistry("1.2.3")
    registry.images["1.2.3"] = image

    with pytest.raises(RuntimeError):
        ensure_ecr_image(registry, "1.2.3", registry.publish_candidate)
    assert registry.publish_calls == 0


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
    registry.images["latest"] = EcrImage(digest=image_digest("latest"), tags=tags)

    with pytest.raises(RuntimeError):
        promote_ecr_latest(registry, "1.2.3")
    assert registry.put_calls == []


def test_aws_lookup_failure_fails_closed():
    registry = FakeEcrRegistry("1.2.3")
    registry.fail_lookup = True

    with pytest.raises(RuntimeError, match="AWS lookup failed"):
        ensure_ecr_image(registry, "1.2.3", registry.publish_candidate)
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
    registry.images["1.9.0"] = EcrImage(digest=image_digest("1.9.0"), tags=("1.9.0",))
    assert promote_ecr_latest(registry, "1.9.0") == "stale"

    assert set(registry.images) >= {"2.0.0", "1.9.0", "latest"}
    assert registry.images["latest"].digest == registry.images["2.0.0"].digest


def test_partial_transaction_retry_preserves_image_digest_and_continues():
    registry = FakeEcrRegistry("1.2.3", candidate_exists=False)
    later_phase_attempts = 0

    def release_transaction() -> tuple[str, str]:
        nonlocal later_phase_attempts
        image_outcome, _ = ensure_ecr_image(registry, "1.2.3", registry.publish_candidate)
        promotion = promote_ecr_latest(registry, "1.2.3")
        later_phase_attempts += 1
        if later_phase_attempts == 1:
            raise RuntimeError("later publication phase failed")
        return image_outcome, promotion

    with pytest.raises(RuntimeError, match="later publication phase failed"):
        release_transaction()
    first_digest = registry.images["1.2.3"].digest

    assert release_transaction() == ("existing", "current")
    assert registry.publish_calls == 1
    assert later_phase_attempts == 2
    assert registry.images["1.2.3"].digest == first_digest
    assert registry.images["latest"].digest == first_digest
