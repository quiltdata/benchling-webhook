"""Package-name controls must not force the canvas wider than the entry."""

from src.canvas_blocks import blocks_to_dict, create_linked_package_browse_buttons, create_related_package_link_buttons
from src.packages import Package
from src.pagination import parse_related_package_button_id


def _packages():
    return [Package("dev.quilttest.com", "quilt-benchling", f"benchling/EXP25000{i:03}") for i in range(5)]


def test_related_link_buttons_each_have_their_own_row():
    packages = _packages()
    rows = blocks_to_dict(create_related_package_link_buttons("etr_123", packages, "quilt-benchling"))

    assert len(rows) == 5
    assert len({row["id"] for row in rows}) == 5
    for row, package in zip(rows, packages):
        assert row["type"] == "SECTION"
        assert len(row["children"]) == 1
        button = row["children"][0]
        assert button["text"] == f"Link {package.package_name}"
        assert parse_related_package_button_id(button["id"]) == ("etr_123", package.package_name)


def test_linked_browse_buttons_each_have_their_own_row():
    packages = _packages()
    rows = blocks_to_dict(create_linked_package_browse_buttons("etr_123", packages))

    assert len(rows) == 5
    assert len({row["id"] for row in rows}) == 5
    for row, package in zip(rows, packages):
        assert row["type"] == "SECTION"
        assert len(row["children"]) == 1
        assert row["children"][0]["text"] == f"Browse {package.package_name}"
