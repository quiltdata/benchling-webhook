from unittest.mock import MagicMock, Mock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from src.app import create_app


class TestFastAPIApp:
    @pytest.fixture
    def mock_config(self):
        """Mock config with secrets-only mode configuration."""
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
        config.enable_webhook_verification = (
            False  # Lambda authorizer handles verification; flag retained for compatibility
        )
        config.quilt_write_role_arn = ""
        config.webhook_allow_list = ""
        config.pkg_key = "experiment_id"
        config.pkg_prefix = "benchling"
        config.log_level = "INFO"
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
        return packager

    @pytest.fixture
    def app(
        self,
        mock_config,
        mock_benchling_client,
        mock_entry_packager,
    ):
        with (
            patch("src.app.get_config", return_value=mock_config),
            patch("src.app.Benchling", return_value=mock_benchling_client),
            patch("src.app.EntryPackager", return_value=mock_entry_packager),
        ):
            return create_app()

    @pytest.fixture
    def client(self, app):
        return TestClient(app)

    def test_health_endpoint(self, client):
        """Test health endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "benchling-webhook"

    def test_liveness_probe(self, client):
        """Test liveness probe."""
        response = client.get("/health/live")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "alive"

    def test_readiness_probe_success(self, client):
        """Test readiness probe success."""
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert data["orchestration"] == "python"

    def test_readiness_probe_failure(self, client):
        """Test readiness probe failure."""
        with patch("src.app.get_config") as mock_get_config:
            mock_get_config.side_effect = Exception("Config failed")
            with pytest.raises(Exception):
                create_app()

    def test_webhook_endpoint_success(self, client, mock_entry_packager):
        """Test webhook endpoint with valid payload."""
        mock_entry_packager.execute_workflow_async.return_value = "etr_123456"

        payload = {
            "channel": "events",
            "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
            "baseURL": "https://tenant.benchling.com",
        }

        response = client.post("/event", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ACCEPTED"

    def test_webhook_endpoint_no_payload(self, client):
        """Test webhook endpoint with no JSON payload."""
        response = client.post("/event", data="", headers={"Content-Type": "application/json"})
        assert response.status_code == 400
        data = response.json()
        assert "No JSON payload" in data["error"]

    def test_webhook_endpoint_validation_error(self, client):
        """Test webhook endpoint with validation error (missing entry_id)."""
        payload = {"invalid": "payload"}
        response = client.post("/event", json=payload)

        assert response.status_code == 400
        data = response.json()
        assert "entry_id" in data["error"]

    def test_404_error_handler(self, client):
        """Test 404 error handler."""
        response = client.get("/nonexistent")
        assert response.status_code == 404
        data = response.json()
        assert "error" in data
        assert "not found" in data["error"].lower()

    def test_canvas_endpoint_async_update(self, client, mock_entry_packager):
        """Test /canvas endpoint returns 202 and triggers async update."""
        mock_entry_packager.execute_workflow_async.return_value = "etr_123456"

        payload = {
            "channel": "events",
            "message": {"type": "v2.canvas.initialized", "resourceId": "etr_123456"},
            "baseURL": "https://tenant.benchling.com",
            "context": {"canvasId": "canvas_123"},
        }

        with patch("src.app.CanvasManager") as mock_canvas_manager:
            mock_manager_instance = Mock()
            mock_canvas_manager.return_value = mock_manager_instance
            mock_manager_instance.get_package_browser_blocks.return_value = [MagicMock()]

            response = client.post("/canvas", json=payload)

            assert response.status_code == 202
            data = response.json()
            assert data["status"] == "ACCEPTED"
            assert "execution_arn" in data

            mock_manager_instance.handle_async.assert_called_once()
            mock_manager_instance.get_canvas_response.assert_not_called()

    @pytest.mark.local
    def test_canvas_endpoint_handles_browse_files_button(self, client, mock_benchling_client):
        """Test /canvas endpoint routes Browse Files button to correct handler.

        Note: This test requires AWS access (STS API) and is marked as local-only.
        """
        import time

        payload = {
            "channel": "app_signals",
            "message": {
                "type": "v2.canvas.userInteracted",
                "buttonId": "browse-files-etr_123456-p0-s15",
                "canvasId": "canvas_abc",
            },
            "baseURL": "https://tenant.benchling.com",
        }

        mock_update_canvas = MagicMock()
        mock_benchling_client.apps.update_canvas = mock_update_canvas

        with patch("src.app.CanvasManager") as mock_canvas_manager:
            mock_manager_instance = MagicMock()
            mock_canvas_manager.return_value = mock_manager_instance
            from benchling_api_client.v2.stable.models.markdown_ui_block_type import MarkdownUiBlockType
            from benchling_api_client.v2.stable.models.markdown_ui_block_update import MarkdownUiBlockUpdate

            mock_manager_instance.get_package_browser_blocks.return_value = [
                MarkdownUiBlockUpdate(type=MarkdownUiBlockType.MARKDOWN, value="file listing: test.txt")  # type: ignore
            ]

            mock_file = MagicMock()
            mock_file.name = "test.txt"
            mock_file.size = 1024
            mock_file.size_display = "1.0 KB"
            mock_file.catalog_url = "https://catalog.example.com/test"
            mock_file.sync_url = "https://catalog.example.com/sync/test"

            with patch("src.canvas.PackageFileFetcher") as mock_fetcher_class:
                mock_fetcher = MagicMock()
                mock_fetcher_class.return_value = mock_fetcher
                mock_fetcher.get_package_files.return_value = [mock_file]

                response = client.post("/canvas", json=payload)

                assert response.status_code == 202
                data = response.json()
                assert data["status"] == "ACCEPTED"
                assert "Loading files" in data["message"]

                time.sleep(0.2)

                assert mock_update_canvas.called
                call_args = mock_update_canvas.call_args
                assert call_args.kwargs["canvas_id"] == "canvas_abc"

                canvas_update = call_args.kwargs["canvas"]
                blocks = canvas_update.blocks
                assert len(blocks) > 0

                from benchling_api_client.v2.stable.models.markdown_ui_block_update import MarkdownUiBlockUpdate

                assert isinstance(blocks[0], MarkdownUiBlockUpdate)
                assert "test.txt" in blocks[0].value

    def test_webhook_verification_enabled(self, mock_config):
        """Test webhook verification is enabled when configured."""
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

            # Mock successful verification
            mock_verify.return_value = None

            response = client.post(
                "/event",
                json=payload,
                headers={
                    "webhook-id": "test-id",
                    "webhook-signature": "test-sig",
                    "webhook-timestamp": "1234567890",
                },
            )

            # Verify the signature verification was called
            assert mock_verify.called
            assert response.status_code == 200

    def test_webhook_verification_disabled(self, mock_config):
        """Test webhook verification can be disabled."""
        mock_config.enable_webhook_verification = False

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

            response = client.post("/event", json=payload)

            # Verification should not be called when disabled
            assert not mock_verify.called
            assert response.status_code == 200

    def test_webhook_verification_missing_headers(self, mock_config):
        """Test webhook verification rejects requests with missing headers."""
        mock_config.enable_webhook_verification = True
        mock_config.benchling_app_definition_id = "app_123"

        with (
            patch("src.app.get_config", return_value=mock_config),
            patch("src.app.Benchling"),
            patch("src.app.EntryPackager"),
        ):
            app = create_app()
            client = TestClient(app)

            payload = {
                "channel": "events",
                "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
                "baseURL": "https://tenant.benchling.com",
            }

            # Send request without webhook headers
            response = client.post("/event", json=payload)

            # Should be rejected with 403 Forbidden
            assert response.status_code == status.HTTP_403_FORBIDDEN
            data = response.json()
            assert data["reason"] == "missing_headers"
            assert "webhook-id" in data["message"]

    def test_webhook_verification_invalid_signature(self, mock_config):
        """Test webhook verification rejects requests with invalid signature."""
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

            response = client.post(
                "/event",
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
            assert "verification failed" in data["message"].lower()

    def test_webhook_verification_missing_app_definition_id(self, mock_config):
        """Test webhook verification fails when app_definition_id is not configured."""
        mock_config.enable_webhook_verification = True
        mock_config.benchling_app_definition_id = ""  # Not configured

        with (
            patch("src.app.get_config", return_value=mock_config),
            patch("src.app.Benchling"),
            patch("src.app.EntryPackager"),
        ):
            app = create_app()
            client = TestClient(app)

            payload = {
                "channel": "events",
                "message": {"type": "v2.entry.updated.fields", "resourceId": "etr_123456"},
                "baseURL": "https://tenant.benchling.com",
            }

            response = client.post(
                "/event",
                json=payload,
                headers={
                    "webhook-id": "test-id",
                    "webhook-signature": "test-sig",
                    "webhook-timestamp": "1234567890",
                },
            )

            # Should be rejected with 403 Forbidden
            assert response.status_code == status.HTTP_403_FORBIDDEN
            data = response.json()
            assert data["reason"] == "missing_app_definition_id"
