"""Test that version numbers are synchronized across all files."""

import json
import re
from pathlib import Path

import pytest


def get_package_json_version():
    """Get version from package.json in repo root."""
    package_json_path = Path(__file__).parent.parent.parent / "package.json"
    with open(package_json_path) as f:
        data = json.load(f)
        return data["version"]


def get_pyproject_version():
    """Get version from docker/pyproject.toml."""
    pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
    with open(pyproject_path) as f:
        content = f.read()
        match = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
        if match:
            return match.group(1)
        raise ValueError("Could not find version in pyproject.toml")


def get_app_manifest_version():
    """Get version from docker/app-manifest.yaml."""
    manifest_path = Path(__file__).parent.parent / "app-manifest.yaml"
    with open(manifest_path) as f:
        content = f.read()
        match = re.search(r'^\s*version:\s*(.+)$', content, re.MULTILINE)
        if match:
            return match.group(1).strip()
        raise ValueError("Could not find version in app-manifest.yaml")


def test_versions_match():
    """Test that all three version numbers match."""
    package_version = get_package_json_version()
    pyproject_version = get_pyproject_version()
    manifest_version = get_app_manifest_version()

    assert package_version == pyproject_version, (
        f"package.json version ({package_version}) does not match "
        f"pyproject.toml version ({pyproject_version})"
    )

    assert package_version == manifest_version, (
        f"package.json version ({package_version}) does not match "
        f"app-manifest.yaml version ({manifest_version})"
    )

    assert pyproject_version == manifest_version, (
        f"pyproject.toml version ({pyproject_version}) does not match "
        f"app-manifest.yaml version ({manifest_version})"
    )


if __name__ == "__main__":
    # Allow running this test directly to check versions
    try:
        test_versions_match()
        print("✅ All versions match!")
        package_version = get_package_json_version()
        print(f"   Version: {package_version}")
    except AssertionError as e:
        print(f"❌ Version mismatch: {e}")
        print(f"   package.json: {get_package_json_version()}")
        print(f"   pyproject.toml: {get_pyproject_version()}")
        print(f"   app-manifest.yaml: {get_app_manifest_version()}")
        exit(1)
