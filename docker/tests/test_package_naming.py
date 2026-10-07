from types import SimpleNamespace

import pytest

from src.package_naming import (
    MissingPlaceholderError,
    entry_package_name,
    prefix_pattern,
    prefix_placeholders,
    resolve_prefix,
)

ENTRY = {"id": "etr_1", "creator": {"handle": "jdoe", "name": "J Doe", "id": "ent_1"}, "folderId": "lib_1"}


def test_literal_prefix_is_unchanged():
    assert entry_package_name("benchling", "EXP0001", ENTRY) == "benchling/EXP0001"


def test_literal_prefix_never_reads_the_entry():
    entry = SimpleNamespace(to_dict=lambda: pytest.fail("entry should not be read"))
    assert entry_package_name("benchling", "EXP0001", entry) == "benchling/EXP0001"


def test_placeholder_filled_from_entry_dict():
    assert entry_package_name("{creator.handle}", "EXP0001", ENTRY) == "jdoe/EXP0001"


def test_placeholder_filled_from_sdk_entry():
    entry = SimpleNamespace(to_dict=lambda: ENTRY)
    assert entry_package_name("{creator.handle}", "EXP0001", entry) == "jdoe/EXP0001"


def test_placeholders_mix_with_literal_text():
    assert resolve_prefix("lab-{creator.handle}", ENTRY) == "lab-jdoe"
    assert resolve_prefix("{creator.handle}_{folderId}", ENTRY) == "jdoe_lib_1"


@pytest.mark.parametrize(
    "entry",
    [
        {"id": "etr_1"},
        {"id": "etr_1", "creator": None},
        {"id": "etr_1", "creator": {"handle": ""}},
        {"id": "etr_1", "creator": {"handle": None}},
        {"id": "etr_1", "creator": "J Doe <jdoe@ent_1>"},
        SimpleNamespace(),
    ],
)
def test_missing_placeholder_value_raises(entry):
    with pytest.raises(MissingPlaceholderError) as exc_info:
        entry_package_name("{creator.handle}", "EXP0001", entry)
    assert exc_info.value.placeholder == "creator.handle"
    assert "{creator.handle}" in str(exc_info.value)


def test_missing_placeholder_error_names_the_entry():
    with pytest.raises(MissingPlaceholderError, match="etr_1"):
        resolve_prefix("{creator.handle}", {"id": "etr_1"})


def test_prefix_placeholders():
    assert prefix_placeholders("benchling") == []
    assert prefix_placeholders("{creator.handle}") == ["creator.handle"]


@pytest.mark.parametrize(
    "pkg_prefix, name, matches",
    [
        ("benchling", "benchling/EXP0001", True),
        ("benchling", "benchling2/EXP0001", False),
        ("benchling", "jdoe/EXP0001", False),
        ("bench.ling", "benchXling/EXP0001", False),
        ("{creator.handle}", "jdoe/EXP0001", True),
        ("{creator.handle}", "EXP0001", False),
        ("lab-{creator.handle}", "lab-jdoe/EXP0001", True),
        ("lab-{creator.handle}", "jdoe/EXP0001", False),
    ],
)
def test_prefix_pattern(pkg_prefix, name, matches):
    assert bool(prefix_pattern(pkg_prefix).match(name)) is matches
