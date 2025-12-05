"""Tests for degraded startup behavior when Benchling secrets are unavailable."""

from fastapi import status
from fastapi.testclient import TestClient

from src.app import create_app


class TestDegradedStartup:
    def test_health_and_readiness_stay_healthy_without_secret(self):
        """Health probes should remain 200 while reporting degraded mode."""
        client = TestClient(create_app())

        health = client.get("/health")
        assert health.status_code == 200
        health_body = health.json()
        assert health_body["status"] == "healthy"
        assert health_body.get("mode") == "degraded"
        assert "BenchlingSecret" in health_body.get("warning", "")

        readiness = client.get("/health/ready")
        assert readiness.status_code == 200
        readiness_body = readiness.json()
        assert readiness_body["status"] == "degraded"
        assert readiness_body.get("mode") == "degraded"
        assert "action" in readiness_body

    def test_webhook_endpoints_return_actionable_error_without_secret(self):
        """Webhook endpoints should return a meaningful 503 instead of failing startup."""
        client = TestClient(create_app())

        response = client.post("/event", json={"channel": "events"})
        assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        body = response.json()
        assert body["error"] == "benchling_secret_unavailable"
        assert "BenchlingSecret" in body["message"]
        assert "action" in body

    def test_config_endpoint_reports_degraded_state_without_secret(self):
        """Config endpoint should surface degraded mode context."""
        client = TestClient(create_app())

        response = client.get("/config")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "degraded"
        assert body["error"] == "benchling_secret_unavailable"
        assert body["aws"]["benchling_secret_name"] is None
        assert body["security"]["webhook_verification_enabled"] is False
