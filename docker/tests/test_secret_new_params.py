"""Tests for the pkg_bucket_map and auto_packaging secret parameters."""

import json
from unittest.mock import Mock

import pytest

from src.secrets_manager import SecretsManagerError, fetch_benchling_secret

BASE_SECRET = {
    "tenant": "acme",
    "client_id": "test-id",
    "client_secret": "test-secret",
    "app_definition_id": "appdef_test",
    "pkg_prefix": "benchling",
    "pkg_key": "experiment_id",
    "user_bucket": "default-bucket",
    "log_level": "INFO",
    "enable_webhook_verification": "true",
}


def _fetch(secret_dict):
    mock_client = Mock()
    mock_client.get_secret_value.return_value = {"SecretString": json.dumps(secret_dict)}
    return fetch_benchling_secret(mock_client, "us-east-1", "test-secret")


class TestPkgBucketMap:
    def test_absent_defaults_to_none(self):
        result = _fetch(BASE_SECRET)
        assert result.pkg_bucket_map is None

    def test_valid_map_parsed(self):
        secret = {**BASE_SECRET, "pkg_bucket_map": {"lib_a": "bucket-a", "src_p": "bucket-p"}}
        result = _fetch(secret)
        assert result.pkg_bucket_map == {"lib_a": "bucket-a", "src_p": "bucket-p"}

    def test_non_dict_rejected(self):
        secret = {**BASE_SECRET, "pkg_bucket_map": ["bucket-a"]}
        with pytest.raises(SecretsManagerError, match="pkg_bucket_map"):
            _fetch(secret)

    def test_empty_key_rejected(self):
        secret = {**BASE_SECRET, "pkg_bucket_map": {"": "bucket-a"}}
        with pytest.raises(SecretsManagerError, match="pkg_bucket_map"):
            _fetch(secret)

    def test_non_string_value_rejected(self):
        secret = {**BASE_SECRET, "pkg_bucket_map": {"lib_a": 42}}
        with pytest.raises(SecretsManagerError, match="pkg_bucket_map"):
            _fetch(secret)


class TestAutoPackaging:
    def test_absent_defaults_to_true(self):
        result = _fetch(BASE_SECRET)
        assert result.auto_packaging is True

    def test_false_string_parsed(self):
        secret = {**BASE_SECRET, "auto_packaging": "false"}
        result = _fetch(secret)
        assert result.auto_packaging is False

    def test_true_string_parsed(self):
        secret = {**BASE_SECRET, "auto_packaging": "true"}
        result = _fetch(secret)
        assert result.auto_packaging is True

    def test_boolean_false_parsed(self):
        secret = {**BASE_SECRET, "auto_packaging": False}
        result = _fetch(secret)
        assert result.auto_packaging is False

    def test_invalid_value_rejected(self):
        secret = {**BASE_SECRET, "auto_packaging": "maybe"}
        with pytest.raises(SecretsManagerError, match="auto_packaging"):
            _fetch(secret)


class TestConfigApplication:
    def test_config_applies_new_fields(self):
        from src.config import Config

        secret = {
            **BASE_SECRET,
            "pkg_bucket_map": {"lib_a": "bucket-a"},
            "auto_packaging": "false",
        }
        secret_data = _fetch(secret)

        config = Config.__new__(Config)
        # Initialize only the attributes apply_benchling_secrets touches
        config._test_mode = False
        config.apply_benchling_secrets(secret_data)

        assert config.pkg_bucket_map == {"lib_a": "bucket-a"}
        assert config.auto_packaging is False
