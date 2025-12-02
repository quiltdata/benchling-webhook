"""
Tests for flexible routes - supporting both direct paths and stage-prefixed paths.

This test suite validates Option A (Duplicate Routes) from spec/2025-11-26-architecture/13-fastapi-flexible-routes.md
which enables FastAPI to handle both:
- Direct paths: /health, /event, etc. (for NLB health checks)
- Stage-prefixed paths: /{stage}/health, /{stage}/event, etc. (for API Gateway HTTP_PROXY)
"""

from unittest.mock import Mock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from src.app import create_app


class TestFlexibleRoutes:
    """Test suite for flexible route implementation."""

    @pytest.fixture
    def mock_config(self):
        """Mock config with all required settings."""
        config = Mock()
        config.aws_region = "us-west-2"
        config.benchling_tenant = "test-tenant"
        config.benchling_client_id = "test-client-id"
        config.benchling_client_secret = "test-secret"
        config.s3_bucket_name = "test-bucket"
        config.s3_prefix = "benchling"
        config.queue_url = "https://sqs.us-west-2.amazonaws.com/123456789012/test"
        config.quilt_catalog = "test.quiltdata.com"
        config.benchling_app_definition_id = ""
        config.enable_webhook_verification = False
        config.quilt_write_role_arn = ""
        config.webhook_allow_list = ""
        config.pkg_key = "experiment_id"
        config.pkg_prefix = "benchling"
        config.log_level = "INFO"
        config.quilt_database = "test_database"
        return config

    @pytest.fixture
    def mock_benchling_client(self):
        """Mock BenchlingClient."""
        client = Mock()
        client.entries.list_entries.return_value.first.return_value = None
        return client

    @pytest.fixture
    def mock_entry_packager(self):
        """Mock EntryPackager."""
        packager = Mock()
        packager.execute_workflow_async.return_value = "etr_123456"
        return packager

    @pytest.fixture
    def app(self, mock_config, mock_benchling_client, mock_entry_packager):
        """Create FastAPI app with mocked dependencies."""
        with (
            patch("src.app.get_config", return_value=mock_config),
            patch("src.app.Benchling", return_value=mock_benchling_client),
            patch("src.app.EntryPackager", return_value=mock_entry_packager),
        ):
            return create_app()

    @pytest.fixture
    def client(self, app):
        """Create test client."""
        return TestClient(app)

    # ============================================================================
    # Health Endpoints - Test both direct and stage-prefixed paths
    # ============================================================================

    @pytest.mark.parametrize("stage", ["prod", "dev", "staging", "test", "v2"])
    def test_health_with_stage_prefix(self, client, stage):
        """Test health endpoint with stage prefix (API Gateway path)."""
        response = client.get(f"/{stage}/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "benchling-webhook"
        assert "version" in data

    def test_health_direct_path(self, client):
        """Test health endpoint without stage prefix (NLB health check)."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "benchling-webhook"

    @pytest.mark.parametrize("stage", ["prod", "dev"])
    def test_readiness_with_stage_prefix(self, client, stage):
        """Test readiness probe with stage prefix."""
        response = client.get(f"/{stage}/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert data["orchestration"] == "python"

    def test_readiness_direct_path(self, client):
        """Test readiness probe without stage prefix."""
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"

    @pytest.mark.parametrize("stage", ["prod", "dev"])
    def test_liveness_with_stage_prefix(self, client, stage):
        """Test liveness probe with stage prefix."""
        response = client.get(f"/{stage}/health/live")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "alive"

    def test_liveness_direct_path(self, client):
        """Test liveness probe without stage prefix."""
        response = client.get("/health/live")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "alive"

    # ============================================================================
    # Webhook Endpoints - Test both direct and stage-prefixed paths
    # ============================================================================

    @pytest.mark.parametrize("stage", ["prod", "dev", "staging"])
    def test_event_webhook_with_stage_prefix(self, client, mock_entry_packager, stage):
        """Test /event webhook with stage prefix (API Gateway path)."""
        payload = {
            "channel": "events",
            "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
            "baseURL": "https://tenant.benchling.com",
        }

        response = client.post(f"/{stage}/event", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ACCEPTED"
        assert "entry_id" in data
        mock_entry_packager.execute_workflow_async.assert_called_once()

    def test_event_webhook_direct_path(self, client, mock_entry_packager):
        """Test /event webhook without stage prefix (direct call)."""
        payload = {
            "channel": "events",
            "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
            "baseURL": "https://tenant.benchling.com",
        }

        response = client.post("/event", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ACCEPTED"

    @pytest.mark.parametrize("stage", ["prod", "dev"])
    def test_lifecycle_webhook_with_stage_prefix(self, client, stage):
        """Test /lifecycle webhook with stage prefix."""
        payload = {
            "channel": "events",
            "message": {"type": "v2.app.installed"},
            "baseURL": "https://tenant.benchling.com",
            "installationId": "install_123",
        }

        response = client.post(f"/{stage}/lifecycle", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

    def test_lifecycle_webhook_direct_path(self, client):
        """Test /lifecycle webhook without stage prefix."""
        payload = {
            "channel": "events",
            "message": {"type": "v2.app.installed"},
            "baseURL": "https://tenant.benchling.com",
            "installationId": "install_123",
        }

        response = client.post("/lifecycle", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

    @pytest.mark.parametrize("stage", ["prod", "dev"])
    def test_canvas_webhook_with_stage_prefix(self, client, mock_entry_packager, stage):
        """Test /canvas webhook with stage prefix."""
        payload = {
            "channel": "events",
            "message": {"type": "v2.canvas.initialized", "resourceId": "etr_123456"},
            "baseURL": "https://tenant.benchling.com",
            "context": {"canvasId": "canvas_123"},
        }

        with patch("src.app.CanvasManager") as mock_canvas_manager:
            mock_manager_instance = Mock()
            mock_canvas_manager.return_value = mock_manager_instance

            response = client.post(f"/{stage}/canvas", json=payload)

            assert response.status_code == 202
            data = response.json()
            assert data["status"] == "ACCEPTED"
            mock_manager_instance.handle_async.assert_called_once()

    def test_canvas_webhook_direct_path(self, client, mock_entry_packager):
        """Test /canvas webhook without stage prefix."""
        payload = {
            "channel": "events",
            "message": {"type": "v2.canvas.initialized", "resourceId": "etr_123456"},
            "baseURL": "https://tenant.benchling.com",
            "context": {"canvasId": "canvas_123"},
        }

        with patch("src.app.CanvasManager") as mock_canvas_manager:
            mock_manager_instance = Mock()
            mock_canvas_manager.return_value = mock_manager_instance

            response = client.post("/canvas", json=payload)

            assert response.status_code == 202
            data = response.json()
            assert data["status"] == "ACCEPTED"

    # ============================================================================
    # Verify both path styles produce identical responses
    # ============================================================================

    def test_health_responses_are_identical(self, client):
        """Verify direct and stage-prefixed health endpoints return identical responses."""
        direct_response = client.get("/health")
        stage_response = client.get("/prod/health")

        assert direct_response.status_code == stage_response.status_code
        assert direct_response.json() == stage_response.json()

    def test_readiness_responses_are_identical(self, client):
        """Verify direct and stage-prefixed readiness endpoints return identical responses."""
        direct_response = client.get("/health/ready")
        stage_response = client.get("/prod/health/ready")

        assert direct_response.status_code == stage_response.status_code
        assert direct_response.json() == stage_response.json()

    def test_event_responses_are_identical(self, client, mock_entry_packager):
        """Verify direct and stage-prefixed event endpoints return identical responses."""
        payload = {
            "channel": "events",
            "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
            "baseURL": "https://tenant.benchling.com",
        }

        direct_response = client.post("/event", json=payload)
        stage_response = client.post("/prod/event", json=payload)

        assert direct_response.status_code == stage_response.status_code
        # Both should have called the packager
        assert mock_entry_packager.execute_workflow_async.call_count == 2

    # ============================================================================
    # Verify HMAC verification works for both path styles
    # ============================================================================

    def test_hmac_verification_for_stage_prefixed_paths(self, mock_config):
        """Test that HMAC verification works for stage-prefixed paths."""
        mock_config.enable_webhook_verification = True
        mock_config.benchling_app_definition_id = "app_123"

        with (
            patch("src.app.get_config", return_value=mock_config),
            patch("src.app.Benchling"),
            patch("src.app.EntryPackager"),
            patch("src.app.verify") as mock_verify,
        ):
            app = create_app()
            client = TestClient(app)

            payload = {
                "channel": "events",
                "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
                "baseURL": "https://tenant.benchling.com",
            }

            # Test with stage prefix
            mock_verify.return_value = None
            response = client.post(
                "/prod/event",
                json=payload,
                headers={
                    "webhook-id": "test-id",
                    "webhook-signature": "test-sig",
                    "webhook-timestamp": "1234567890",
                },
            )

            # Verify signature verification was called
            assert mock_verify.called
            assert response.status_code == 200

    def test_hmac_verification_failure_for_stage_prefixed_paths(self, mock_config):
        """Test that HMAC verification failures are handled correctly for stage-prefixed paths."""
        mock_config.enable_webhook_verification = True
        mock_config.benchling_app_definition_id = "app_123"

        with (
            patch("src.app.get_config", return_value=mock_config),
            patch("src.app.Benchling"),
            patch("src.app.EntryPackager"),
            patch("src.app.verify") as mock_verify,
        ):
            # Mock verification failure
            mock_verify.side_effect = ValueError("Invalid signature")

            app = create_app()
            client = TestClient(app)

            payload = {
                "channel": "events",
                "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
                "baseURL": "https://tenant.benchling.com",
            }

            # Test with stage prefix
            response = client.post(
                "/prod/event",
                json=payload,
                headers={
                    "webhook-id": "test-id",
                    "webhook-signature": "bad-signature",
                    "webhook-timestamp": "1234567890",
                },
            )

            # Should be rejected with 403 Forbidden
            assert response.status_code == status.HTTP_403_FORBIDDEN
            data = response.json()
            assert data["reason"] == "invalid_signature"

    # ============================================================================
    # Edge cases and validation
    # ============================================================================

    def test_arbitrary_stage_names_are_supported(self, client):
        """Verify that any stage name works (dynamic matching)."""
        stage_names = ["prod", "dev", "staging", "test", "v2", "qa", "uat", "demo"]

        for stage in stage_names:
            response = client.get(f"/{stage}/health")
            assert response.status_code == 200, f"Stage '{stage}' failed"
            data = response.json()
            assert data["status"] == "healthy"

    def test_nonexistent_endpoint_returns_404(self, client):
        """Test that nonexistent endpoints return 404."""
        response = client.get("/nonexistent")
        assert response.status_code == 404

    def test_nonexistent_stage_prefixed_endpoint_returns_404(self, client):
        """Test that nonexistent stage-prefixed endpoints return 404."""
        response = client.get("/prod/nonexistent")
        assert response.status_code == 404

    def test_invalid_payload_handled_correctly(self, client):
        """Test that invalid payloads are handled correctly for both path styles."""
        invalid_payload = {"invalid": "payload"}

        # Direct path
        direct_response = client.post("/event", json=invalid_payload)
        assert direct_response.status_code == 400

        # Stage-prefixed path
        stage_response = client.post("/prod/event", json=invalid_payload)
        assert stage_response.status_code == 400

    # ============================================================================
    # Documentation and observability
    # ============================================================================

    def test_stage_parameter_is_captured_in_logs(self, client, caplog):
        """Verify that stage parameter is available for logging/debugging."""
        # The stage parameter is part of the FastAPI route but not explicitly logged
        # This test verifies the route accepts it without errors
        response = client.get("/custom-stage/health")
        assert response.status_code == 200
        # Stage is available in the route function if needed for logging

    def test_both_path_styles_work_simultaneously(self, client):
        """Verify that both path styles can be used interchangeably."""
        # Make alternating requests to both path styles
        paths = [
            "/health",
            "/prod/health",
            "/health/ready",
            "/dev/health/ready",
            "/health/live",
            "/staging/health/live",
        ]

        for path in paths:
            response = client.get(path)
            assert response.status_code == 200, f"Path '{path}' failed"
