import io
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
import yaml
from botocore.exceptions import ClientError

from src.canvas_formatting import format_package_rejected
from src.packaging_status import check_workflow, list_entries, read_status, status_key, unresolved, write_status

BUCKET = "bkt"
NAME = "benchling/EXP1"
META = {"display_id": "EXP1"}
ENTRIES = [{"logical_key": "entry.json", "size": 10, "meta": {}}]
SCHEMA = {"type": "object", "required": ["project"]}


class FakeS3:
    def __init__(self, objects=None, denied=()):
        self.objects = dict(objects or {})
        self.denied = set(denied)

    def get_object(self, Bucket, Key, **_):
        if (Bucket, Key) in self.denied:
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "GetObject")
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def put_object(self, Bucket, Key, Body):
        if (Bucket, Key) in self.denied:
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "PutObject")
        self.objects[(Bucket, Key)] = Body

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        keys = sorted(k for b, k in self.objects if b == Bucket and k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start : start + 2]
        more = start + 2 < len(keys)
        contents = [{"Key": k, "Size": len(self.objects[(Bucket, k)])} for k in page]
        return {
            "Contents": contents,
            "IsTruncated": more,
            **({"NextContinuationToken": str(start + 2)} if more else {}),
        }


def s3_with(config, schemas=None, **kw):
    objects = {(BUCKET, ".quilt/workflows/config.yml"): yaml.safe_dump(config).encode()}
    for key, schema in (schemas or {}).items():
        objects[(BUCKET, key)] = json.dumps(schema).encode()
    return FakeS3(objects, **kw)


def config(workflows, default=None, schemas=None):
    c = {"version": "1", "workflows": workflows}
    if default:
        c["default_workflow"] = default
    if schemas:
        c["schemas"] = {sid: {"url": f"s3://{BUCKET}/{key}"} for sid, key in schemas.items()}
    return c


def check(s3, workflow="", meta=META, entries=ENTRIES, message="msg") -> str:
    """The rejection reason, or "" when the pre-check would let the package through."""
    return check_workflow(s3, BUCKET, workflow, NAME, message, meta, entries) or ""


def test_unset_workflow_validates_against_bucket_default():
    s3 = s3_with(
        config({"strict": {"name": "S", "metadata_schema": "m"}}, default="strict", schemas={"m": "s/m.json"}),
        {"s/m.json": SCHEMA},
    )
    assert "'project' is a required property" in check(s3)


def test_named_workflow_missing_from_config_is_rejected():
    s3 = s3_with(config({"BZ_workflow": {"name": "BZ"}}))
    assert "There is no 'BZ-Workflow' workflow" in check(s3, workflow="BZ-Workflow")


def test_handle_pattern_is_enforced():
    s3 = s3_with(config({"w": {"name": "W", "handle_pattern": "^raw/"}}, default="w"))
    assert "doesn't match required pattern" in check(s3)


def test_entries_schema_is_enforced():
    entries_schema = {"type": "array", "contains": {"properties": {"logical_key": {"const": "README.md"}}}}
    s3 = s3_with(
        config({"w": {"name": "W", "entries_schema": "e"}}, default="w", schemas={"e": "s/e.json"}),
        {"s/e.json": entries_schema},
    )
    assert "Package entries failed validation" in check(s3)


def test_valid_package_passes():
    s3 = s3_with(
        config({"w": {"name": "W", "metadata_schema": "m"}}, default="w", schemas={"m": "s/m.json"}),
        {"s/m.json": SCHEMA},
    )
    assert check(s3, meta={**META, "project": "p"}) == ""


def test_no_config_passes_unless_a_workflow_is_named():
    assert check(FakeS3()) == ""
    assert "no workflows config exist" in check(FakeS3(), workflow="w")


@pytest.mark.parametrize(
    "s3",
    [
        # Unreadable config, unreadable schema: let the packager decide.
        FakeS3(denied={(BUCKET, ".quilt/workflows/config.yml")}),
        s3_with(
            config({"w": {"name": "W", "metadata_schema": "m"}}, default="w", schemas={"m": "s/m.json"}),
            denied={(BUCKET, "s/m.json")},
        ),
        # A transient error reading the config.
        Mock(get_object=Mock(side_effect=TimeoutError())),
    ],
)
def test_unknowable_is_not_a_rejection(s3):
    assert check(s3) == ""


def test_status_round_trip_lives_beside_the_source_prefix():
    s3 = FakeS3()
    write_status(s3, BUCKET, NAME, "rejected", workflow="w", message="nope")
    assert status_key(NAME) == "benchling/EXP1.packaging_status.json"
    assert not status_key(NAME).startswith(f"{NAME}/")
    assert (read_status(s3, BUCKET, NAME) or {}).get("message") == "nope"
    assert read_status(FakeS3(), BUCKET, NAME) is None


def test_status_write_failure_does_not_raise():
    write_status(FakeS3(denied={(BUCKET, status_key(NAME))}), BUCKET, NAME, "requested")


def test_list_entries_includes_leftovers_across_pages():
    s3 = FakeS3(
        {
            (BUCKET, f"{NAME}/entry.json"): b"{}",
            (BUCKET, f"{NAME}/old/run.csv"): b"abc",
            (BUCKET, f"{NAME}/old.txt"): b"a",
            (BUCKET, f"{NAME}/dir/"): b"",
            (BUCKET, status_key(NAME)): b"{}",
            (BUCKET, "benchling/EXP10/entry.json"): b"{}",
        }
    )
    assert list_entries(s3, BUCKET, NAME) == [
        {"logical_key": "entry.json", "size": 2, "meta": {}},
        {"logical_key": "old/run.csv", "size": 3, "meta": {}},
        {"logical_key": "old.txt", "size": 1, "meta": {}},
    ]
    assert list_entries(object(), BUCKET, NAME) is None


def test_unresolved():
    now = datetime(2026, 10, 6, 12, 0, 0, 700000, tzinfo=timezone.utc)
    old = {"state": "requested", "at": (now - timedelta(minutes=11)).isoformat()}
    assert unresolved(old, None, now) == "stalled"
    assert unresolved(old, now - timedelta(minutes=1), now) is None  # a revision landed after the request
    assert unresolved({**old, "at": (now - timedelta(minutes=5)).isoformat()}, None, now) is None
    rejected = {"state": "rejected", "at": now.isoformat()}
    assert unresolved(rejected, None, now) == "rejected"
    # A revision in the same second (S3 drops the fraction) supersedes the rejection.
    assert unresolved(rejected, now.replace(microsecond=0), now) is None


def test_rejected_markdown_names_workflow_and_reason():
    md = format_package_rejected("BZ_workflow", "Metadata failed validation:\n'project' is required")
    assert "`BZ_workflow`" in md and "'project' is required" in md and "Update Package" in md
    assert "default workflow" in format_package_rejected("", "x")
