import json

import pytest
from botocore.exceptions import ClientError

from src import lambda_authorizer as authorizer


class DummySecretsClient:
    def __init__(self, secret: dict[str, str], raise_error: bool = False):
        self.secret = secret
        self.raise_error = raise_error

    def get_secret_value(self, SecretId: str):
        if self.raise_error:
            raise ClientError(
                {"Error": {"Code": "AccessDeniedException", "Message": "denied"}},
                "GetSecretValue",
            )
        return {"SecretString": json.dumps(self.secret)}


def _base_event():
    return {
        "headers": {
            "webhook-id": "abc123",
            "webhook-signature": "sig",
            "webhook-timestamp": "1234567890",
        },
        "body": "{}",
        "methodArn": "arn:aws:execute-api:region:123456789012:api/prod/POST/event",
    }


@pytest.fixture(autouse=True)
def set_secret_env(monkeypatch):
    monkeypatch.setenv("BENCHLING_SECRET_ARN", "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling")


def test_allows_valid_signature(monkeypatch):
    client = DummySecretsClient({"app_definition_id": "app_123"})
    monkeypatch.setattr(authorizer, "_get_secrets_client", lambda: client)

    calls = {"verified": False}

    def fake_verify(app_definition_id, body, headers):
        calls["verified"] = True
        assert app_definition_id == "app_123"
        assert body == "{}"
        assert headers["webhook-id"] == "abc123"

    monkeypatch.setattr(authorizer, "verify", fake_verify)

    result = authorizer.handler(_base_event(), {})

    assert result["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert result["context"]["authorized"] == "true"
    assert calls["verified"] is True


def test_denies_when_signature_invalid(monkeypatch):
    client = DummySecretsClient({"app_definition_id": "app_123"})
    monkeypatch.setattr(authorizer, "_get_secrets_client", lambda: client)

    def failing_verify(*_args, **_kwargs):
        raise ValueError("bad signature")

    monkeypatch.setattr(authorizer, "verify", failing_verify)

    result = authorizer.handler(_base_event(), {})

    assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert result["context"]["reason"] == "invalid_signature"


def test_denies_when_headers_missing(monkeypatch):
    client = DummySecretsClient({"app_definition_id": "app_123"})
    monkeypatch.setattr(authorizer, "_get_secrets_client", lambda: client)

    event = _base_event()
    event["headers"].pop("webhook-signature")

    result = authorizer.handler(event, {})

    assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert result["context"]["reason"] == "missing_headers"


def test_denies_when_secret_missing_app_definition(monkeypatch):
    client = DummySecretsClient({"client_id": "abc"})
    monkeypatch.setattr(authorizer, "_get_secrets_client", lambda: client)

    result = authorizer.handler(_base_event(), {})

    assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert result["context"]["reason"] == "missing_app_definition_id"


def test_denies_when_secret_lookup_fails(monkeypatch):
    client = DummySecretsClient({"app_definition_id": "app_123"}, raise_error=True)
    monkeypatch.setattr(authorizer, "_get_secrets_client", lambda: client)

    result = authorizer.handler(_base_event(), {})

    assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert result["context"]["reason"] == "secrets_manager_error"


def test_decodes_base64_body(monkeypatch):
    client = DummySecretsClient({"app_definition_id": "app_123"})
    monkeypatch.setattr(authorizer, "_get_secrets_client", lambda: client)

    captured = {}

    def fake_verify(_app_definition_id, body, _headers):
        captured["body"] = body

    monkeypatch.setattr(authorizer, "verify", fake_verify)

    event = _base_event()
    event["body"] = "eyJrZXkiOiAidmFsdWUifQ=="  # base64 for {"key": "value"}
    event["isBase64Encoded"] = True

    authorizer.handler(event, {})

    assert captured["body"] == '{"key": "value"}'
