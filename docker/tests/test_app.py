import json
from unittest.mock import Mock, patch

import pytest

from src.app import create_app


class TestFlaskApp:
    @pytest.fixture
    def mock_config(self):
        """Mock config with Python orchestration."""
        config = Mock()
        config.aws_region = "us-west-2"
        config.benchling_tenant = "test-tenant"
        config.benchling_client_id = "test-client-id"
        config.benchling_client_secret = "test-secret"
        config.s3_bucket_name = "test-bucket"
        config.s3_prefix = "benchling"
        config.queue_arn = "https://sqs.us-west-2.amazonaws.com/123456789012/test"
        config.quilt_catalog = "test.quiltdata.com"
        config.benchling_app_definition_id = ""
        config.enable_webhook_verification = False  # Disable verification for tests
        return config

    @pytest.fixture
    def mock_benchling_client(self):
        """Mock BenchlingClient."""
        client = Mock()
        # Mock entries.list_entries() to return empty result (no fallback entry)
        client.entries.list_entries.return_value.first.return_value = None
        return client

    @pytest.fixture
    def mock_execution_store(self):
        """Mock ExecutionStore."""
        store = Mock()
        store.executions = {}
        return store

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
            app = create_app()
            app.config["TESTING"] = True
            return app

    @pytest.fixture
    def client(self, app):
        return app.test_client()

    def test_health_endpoint(self, client):
        """Test health endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["status"] == "healthy"
        assert data["service"] == "benchling-webhook"

    def test_liveness_probe(self, client):
        """Test liveness probe."""
        response = client.get("/health/live")
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["status"] == "alive"

    def test_readiness_probe_success(self, client):
        """Test readiness probe success."""
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["status"] == "ready"
        assert data["orchestration"] == "python"

    def test_readiness_probe_failure(self, client):
        """Test readiness probe failure."""
        # Create app without mocking EntryPackager to simulate failure
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

        response = client.post(
            "/event",
            data=json.dumps(payload),
            content_type="application/json",
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["status"] == "ACCEPTED"

    def test_webhook_endpoint_no_payload(self, client):
        """Test webhook endpoint with no JSON payload."""
        response = client.post("/event", content_type="application/json")
        assert response.status_code == 400
        data = json.loads(response.data)
        assert "No JSON payload" in data["error"]

    def test_webhook_endpoint_validation_error(self, client):
        """Test webhook endpoint with validation error (missing entry_id)."""
        payload = {"invalid": "payload"}
        response = client.post(
            "/event",
            data=json.dumps(payload),
            content_type="application/json",
        )

        # Should return 400 for invalid payload (missing entry_id)
        assert response.status_code == 400
        data = json.loads(response.data)
        assert "entry_id" in data["error"]

    def test_404_error_handler(self, client):
        """Test 404 error handler."""
        response = client.get("/nonexistent")
        assert response.status_code == 404
        data = json.loads(response.data)
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

            response = client.post(
                "/canvas",
                data=json.dumps(payload),
                content_type="application/json",
            )

            # Should return 202 Accepted, not 200 with canvas blocks
            assert response.status_code == 202
            data = json.loads(response.data)
            assert data["status"] == "ACCEPTED"
            assert "execution_arn" in data

            # Should trigger async canvas update, not get_canvas_response()
            mock_manager_instance.handle_async.assert_called_once()
            mock_manager_instance.get_canvas_response.assert_not_called()

    @pytest.mark.local
    def test_canvas_endpoint_handles_browse_files_button(self, client, mock_benchling_client):
        """Test /canvas endpoint routes Browse Files button to correct handler.

        Note: This test requires AWS access (STS API) and is marked as local-only.
        """
        import time
        from unittest.mock import MagicMock

        # Simulate button click sent to /canvas endpoint (as Benchling does)
        payload = {
            "channel": "app_signals",
            "message": {
                "type": "v2.canvas.userInteracted",
                "buttonId": "browse-files-etr_123456-p0-s15",
                "canvasId": "canvas_abc",
            },
            "baseURL": "https://tenant.benchling.com",
        }

        # Mock the canvas update call
        mock_update_canvas = MagicMock()
        mock_benchling_client.apps.update_canvas = mock_update_canvas

        # Mock package files fetcher
        with patch("src.canvas.PackageFileFetcher") as mock_fetcher_class:
            mock_fetcher = MagicMock()
            mock_fetcher_class.return_value = mock_fetcher

            # Mock some files
            mock_file = MagicMock()
            mock_file.name = "test.txt"
            mock_file.size = 1024
            mock_file.size_display = "1.0 KB"
            mock_file.catalog_url = "https://catalog.example.com/test"
            mock_file.sync_url = "https://catalog.example.com/sync/test"

            mock_fetcher.get_package_files.return_value = [mock_file]

            response = client.post(
                "/canvas",
                data=json.dumps(payload),
                content_type="application/json",
            )

            # Should return 202 Accepted
            assert response.status_code == 202
            data = json.loads(response.data)
            assert data["status"] == "ACCEPTED"
            assert "Loading files" in data["message"]

            # Wait for async thread
            time.sleep(0.2)

            # Verify canvas was updated with file browser view
            assert mock_update_canvas.called
            call_args = mock_update_canvas.call_args
            assert call_args.kwargs["canvas_id"] == "canvas_abc"

            # Verify blocks contain file listing
            canvas_update = call_args.kwargs["canvas"]
            blocks = canvas_update.blocks
            assert len(blocks) > 0

            # Should have markdown with file listing
            markdown_block = blocks[0]
            # Blocks are now MarkdownUiBlockUpdate objects, not dicts
            from benchling_api_client.v2.stable.models.markdown_ui_block_update import MarkdownUiBlockUpdate

            assert isinstance(markdown_block, MarkdownUiBlockUpdate)
            assert "test.txt" in markdown_block.value

    def test_health_secrets_endpoint_with_json(self, monkeypatch):
        """Test /health/secrets reports JSON secret source."""
        json_str = json.dumps({
            "tenant": "test-tenant",
            "clientId": "test-id",
            "clientSecret": "test-secret"
        })
        monkeypatch.setenv("BENCHLING_SECRETS", json_str)
        # Set other required env vars
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test-queue")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

        # Create fresh app with new env vars
        with (
            patch("src.app.Benchling"),
            patch("src.app.EntryPackager"),
        ):
            app = create_app()
            app.config["TESTING"] = True
            client = app.test_client()

            response = client.get("/health/secrets")
            assert response.status_code == 200

            data = json.loads(response.data)
            assert data["status"] == "healthy"
            assert data["source"] == "environment_json"
            assert data["secrets_valid"] is True
            assert data["tenant_configured"] is True

    def test_health_secrets_endpoint_with_arn(self, mocker, monkeypatch):
        """Test /health/secrets reports Secrets Manager source."""
        from src.secrets_resolver import BenchlingSecrets

        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"
        monkeypatch.setenv("BENCHLING_SECRETS", arn)
        # Set other required env vars
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test-queue")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

        # Mock Secrets Manager
        mock_secrets = BenchlingSecrets("test-tenant", "test-id", "test-secret")
        mocker.patch("src.secrets_resolver.fetch_from_secrets_manager", return_value=mock_secrets)

        # Create fresh app
        with (
            patch("src.app.Benchling"),
            patch("src.app.EntryPackager"),
        ):
            app = create_app()
            app.config["TESTING"] = True
            client = app.test_client()

            response = client.get("/health/secrets")
            assert response.status_code == 200

            data = json.loads(response.data)
            assert data["status"] == "healthy"
            assert data["source"] == "secrets_manager"

    def test_health_secrets_endpoint_with_individual_vars(self, monkeypatch):
        """Test /health/secrets reports individual env var source."""
        monkeypatch.delenv("BENCHLING_SECRETS", raising=False)
        monkeypatch.setenv("BENCHLING_TENANT", "test-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "test-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "test-secret")
        # Set other required env vars
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test-queue")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

        # Create fresh app
        with (
            patch("src.app.Benchling"),
            patch("src.app.EntryPackager"),
        ):
            app = create_app()
            app.config["TESTING"] = True
            client = app.test_client()

            response = client.get("/health/secrets")
            assert response.status_code == 200

            data = json.loads(response.data)
            assert data["status"] == "healthy"
            assert data["source"] == "environment_vars"
