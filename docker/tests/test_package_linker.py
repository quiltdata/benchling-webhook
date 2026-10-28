"""Regression tests for metadata-only related-package revisions."""

import io
import json
from unittest.mock import Mock, patch

import pytest
from botocore.exceptions import ClientError

from src.config import Config
from src.package_linker import PackageLinker, RelatedPackageLinkError, RelatedPackageWorkflowError

BUCKET = "lab-bucket"
PACKAGE_NAME = "ale/raw-data"
LATEST_KEY = f".quilt/named_packages/{PACKAGE_NAME}/latest"
OLD_HASH = "0" * 64

ENTRY = {
    "logical_key": "nested/data.txt",
    "physical_keys": [f"s3://{BUCKET}/raw/data.txt"],
    "size": 3,
    "hash": {"type": "SHA256", "value": "abc"},
    "meta": {"user_meta": {"kind": "raw"}},
}


def _manifest(metadata=None, message="before", workflow=None) -> bytes:
    header = {"user_meta": metadata or {"owner": "lab"}, "message": message}
    if workflow:
        header["workflow"] = workflow
    return (json.dumps(header) + "\n" + json.dumps(ENTRY) + "\n").encode()


def _config():
    config = Mock(spec=Config)
    config.package_key = "experiment_id"
    config.s3_bucket_name = BUCKET
    config.workflow = ""
    config.quilt_write_role_arn = None
    config.aws_region = "us-east-1"
    return config


class FakeS3:
    """Minimal conditional S3 object store used by PackageLinker."""

    def __init__(self, manifest=None):
        self.objects = {
            LATEST_KEY: OLD_HASH.encode(),
            f".quilt/packages/{OLD_HASH}": manifest or _manifest(),
        }
        self.etags = {}
        self._etag_counter = 0
        self.latest_conflicts_remaining = 0
        self.ambiguous_latest_commits_remaining = 0
        self.ambiguous_latest_superseded_remaining = 0
        self.committed_then_412_remaining = 0
        self.concurrent_hash = "1" * 64
        self.latest_puts = 0
        self.deleted = []
        for key in self.objects:
            self._set_etag(key)

    def _set_etag(self, key):
        self._etag_counter += 1
        self.etags[key] = f'"etag-{self._etag_counter}"'

    @staticmethod
    def _client_error(code, operation, status=404):
        return ClientError(
            {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}},
            operation,
        )

    def get_object(self, Bucket, Key):
        assert Bucket == BUCKET
        if Key not in self.objects:
            raise self._client_error("NoSuchKey", "GetObject")
        return {"Body": io.BytesIO(self.objects[Key]), "ETag": self.etags[Key]}

    def head_object(self, Bucket, Key):
        assert Bucket == BUCKET
        if Key not in self.objects:
            raise self._client_error("NoSuchKey", "HeadObject")
        return {"ETag": self.etags[Key]}

    def put_object(self, Bucket, Key, Body, IfMatch=None, IfNoneMatch=None, **_kwargs):
        assert Bucket == BUCKET
        if IfNoneMatch == "*" and Key in self.objects:
            raise self._client_error("PreconditionFailed", "PutObject", 412)
        if IfMatch is not None and self.etags.get(Key) != IfMatch:
            raise self._client_error("PreconditionFailed", "PutObject", 412)
        if Key == LATEST_KEY and IfMatch is not None:
            self.latest_puts += 1
            if self.committed_then_412_remaining:
                self.committed_then_412_remaining -= 1
                self.objects[Key] = Body if isinstance(Body, bytes) else Body.read()
                self._set_etag(Key)
                raise self._client_error("PreconditionFailed", "PutObject", 412)
            if self.latest_conflicts_remaining:
                self.latest_conflicts_remaining -= 1
                self.objects[LATEST_KEY] = self.concurrent_hash.encode()
                self._set_etag(LATEST_KEY)
                self.objects[f".quilt/packages/{self.concurrent_hash}"] = _manifest(
                    {"owner": "lab", "concurrent": True},
                    "concurrent update",
                )
                self._set_etag(f".quilt/packages/{self.concurrent_hash}")
                raise self._client_error("PreconditionFailed", "PutObject", 412)
            if self.ambiguous_latest_superseded_remaining:
                self.ambiguous_latest_superseded_remaining -= 1
                self.objects[LATEST_KEY] = self.concurrent_hash.encode()
                self._set_etag(LATEST_KEY)
                self.objects[f".quilt/packages/{self.concurrent_hash}"] = _manifest(
                    {"owner": "lab", "concurrent": True},
                    "concurrent update",
                )
                self._set_etag(f".quilt/packages/{self.concurrent_hash}")
                raise ConnectionError("connection reset after an ambiguously superseded write")
            if self.ambiguous_latest_commits_remaining:
                self.ambiguous_latest_commits_remaining -= 1
                self.objects[Key] = Body if isinstance(Body, bytes) else Body.read()
                self._set_etag(Key)
                raise ConnectionError("connection reset after write")
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.read()
        self._set_etag(Key)
        return {"ETag": self.etags[Key]}

    def delete_object(self, Bucket, Key, IfMatch=None):
        assert Bucket == BUCKET
        if IfMatch is not None and self.etags.get(Key) != IfMatch:
            raise self._client_error("PreconditionFailed", "DeleteObject", 412)
        self.deleted.append(Key)
        self.objects.pop(Key, None)
        self.etags.pop(Key, None)
        return {}

    def history(self):
        prefix = f".quilt/named_packages/{PACKAGE_NAME}/"
        return {key: value for key, value in self.objects.items() if key.startswith(prefix) and key != LATEST_KEY}


def _revision_rows(s3, top_hash):
    return [json.loads(line) for line in s3.objects[f".quilt/packages/{top_hash}"].decode().splitlines()]


def test_link_preserves_entries_and_adds_metadata_only_revision():
    s3 = FakeS3()

    result = PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP26000030")

    rows = _revision_rows(s3, result.top_hash)
    assert result.changed is True
    assert rows[0]["user_meta"] == {"owner": "lab", "experiment_id": "EXP26000030"}
    assert rows[0]["message"] == "Linked to EXP26000030 from Benchling"
    assert rows[1:] == [ENTRY]
    assert s3.objects[LATEST_KEY].decode() == result.top_hash


def test_two_links_in_same_second_keep_distinct_history_pointers():
    s3 = FakeS3()
    linker = PackageLinker(_config(), s3_client=s3)

    with patch("src.package_linker.time.time", return_value=1_000):
        first = linker.link(PACKAGE_NAME, BUCKET, "EXP1")
        second = linker.link(PACKAGE_NAME, BUCKET, "EXP2")

    assert s3.history() == {
        f".quilt/named_packages/{PACKAGE_NAME}/1000": first.top_hash.encode(),
        f".quilt/named_packages/{PACKAGE_NAME}/1001": second.top_hash.encode(),
    }
    assert _revision_rows(s3, second.top_hash)[0]["user_meta"] == {
        "owner": "lab",
        "experiment_id": "EXP1",
        "eln_entry": ["EXP2"],
    }


def test_latest_conflict_retains_ambiguous_history_and_retries_from_new_revision():
    s3 = FakeS3()
    s3.latest_conflicts_remaining = 1

    with patch("src.package_linker.time.time", return_value=2_000):
        result = PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    assert s3.latest_puts == 2
    assert s3.deleted == []
    assert list(s3.history()) == [
        f".quilt/named_packages/{PACKAGE_NAME}/2000",
        f".quilt/named_packages/{PACKAGE_NAME}/2001",
    ]
    assert s3.history()[f".quilt/named_packages/{PACKAGE_NAME}/2001"] == result.top_hash.encode()
    assert _revision_rows(s3, result.top_hash)[0]["user_meta"] == {
        "owner": "lab",
        "concurrent": True,
        "experiment_id": "EXP1",
    }


def test_workflow_rejection_publishes_nothing():
    s3 = FakeS3()
    before = dict(s3.objects)

    with patch("src.package_linker.check_workflow", return_value="metadata failed schema"):
        with pytest.raises(RelatedPackageWorkflowError, match="metadata failed schema"):
            PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    assert s3.objects == before


def test_revision_must_pass_the_workflow_the_package_was_stamped_with():
    stamped = _manifest(workflow={"id": "raw-data", "config": f"s3://{BUCKET}/.quilt/workflows/config.yml"})
    s3 = FakeS3(stamped)
    before = dict(s3.objects)

    with pytest.raises(RelatedPackageWorkflowError, match="'raw-data' workflow is specified"):
        PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    assert s3.objects == before


def test_package_pushed_without_workflow_is_not_held_to_bucket_default():
    s3 = FakeS3(_manifest(workflow={"id": None, "config": f"s3://{BUCKET}/.quilt/workflows/config.yml"}))
    s3.objects[".quilt/workflows/config.yml"] = (
        b'version: "1"\nis_workflow_required: false\ndefault_workflow: strict\n'
        b"workflows:\n  strict:\n    name: Strict\n    handle_pattern: ^nomatch/\n"
    )
    s3._set_etag(".quilt/workflows/config.yml")

    result = PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    assert result.changed is True
    assert s3.objects[LATEST_KEY].decode() == result.top_hash


def test_another_entrys_package_is_not_linked():
    s3 = FakeS3(_manifest({"entry_id": "etr_2", "display_id": "EXP2"}))
    before = dict(s3.objects)

    with pytest.raises(RelatedPackageLinkError, match="another Benchling entry's package"):
        PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    assert s3.objects == before


def test_ambiguous_latest_failure_keeps_committed_history_pointer():
    s3 = FakeS3()
    s3.ambiguous_latest_commits_remaining = 1

    with patch("src.package_linker.time.time", return_value=3_000):
        result = PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    history_key = f".quilt/named_packages/{PACKAGE_NAME}/3000"
    assert result.changed is True
    assert s3.objects[LATEST_KEY].decode() == result.top_hash
    assert s3.history() == {history_key: result.top_hash.encode()}
    assert history_key not in s3.deleted


def test_published_seal_rejects_related_package_revision():
    seal_entry = {
        "logical_key": "linked_packages.json",
        "physical_keys": [f"s3://{BUCKET}/{PACKAGE_NAME}/linked_packages.json"],
        "size": 2,
        "hash": {"type": "SHA256", "value": "sealed"},
        "meta": {},
    }
    sealed_manifest = _manifest() + (json.dumps(seal_entry) + "\n").encode()
    s3 = FakeS3(sealed_manifest)

    with pytest.raises(RelatedPackageLinkError, match="sealed by an accepted review"):
        PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    assert s3.objects[LATEST_KEY] == OLD_HASH.encode()
    assert not s3.history()


def test_staged_seal_rejects_related_package_revision():
    s3 = FakeS3()
    seal_key = f"{PACKAGE_NAME}/linked_packages.json"
    s3.objects[seal_key] = b"{}"
    s3._set_etag(seal_key)

    with pytest.raises(RelatedPackageLinkError, match="sealed by an accepted review"):
        PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    assert s3.objects[LATEST_KEY] == OLD_HASH.encode()
    assert not s3.history()


def test_ambiguous_superseded_latest_failure_retains_possible_committed_history():
    s3 = FakeS3()
    s3.ambiguous_latest_superseded_remaining = 1

    with patch("src.package_linker.time.time", return_value=4_000):
        with pytest.raises(RelatedPackageLinkError, match="ambiguously superseded"):
            PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    history_key = f".quilt/named_packages/{PACKAGE_NAME}/4000"
    assert list(s3.history()) == [history_key]
    assert history_key not in s3.deleted
    assert s3.objects[LATEST_KEY] == s3.concurrent_hash.encode()


def test_sdk_retry_412_after_commit_preserves_history_and_returns_success():
    s3 = FakeS3()
    s3.committed_then_412_remaining = 1

    with patch("src.package_linker.time.time", return_value=5_000):
        result = PackageLinker(_config(), s3_client=s3).link(PACKAGE_NAME, BUCKET, "EXP1")

    history_key = f".quilt/named_packages/{PACKAGE_NAME}/5000"
    assert s3.latest_puts == 1
    assert s3.objects[LATEST_KEY] == result.top_hash.encode()
    assert s3.history() == {history_key: result.top_hash.encode()}
    assert history_key not in s3.deleted
