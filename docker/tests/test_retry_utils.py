"""Tests for retry utilities."""

from unittest.mock import MagicMock, patch

import pytest
import requests
from requests.exceptions import ConnectionError, HTTPError, Timeout

from src.retry_utils import EXPORT_POLL_RETRY, LAMBDA_INVOKE_RETRY, REST_API_RETRY, should_retry_http_error


class TestShouldRetryHttpError:
    """Tests for HTTP error retry decision logic."""

    def test_retry_on_429_rate_limit(self):
        """Should retry on 429 (Rate Limit)."""
        response = MagicMock()
        response.status_code = 429
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is True

    def test_retry_on_500_server_error(self):
        """Should retry on 500 (Internal Server Error)."""
        response = MagicMock()
        response.status_code = 500
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is True

    def test_retry_on_502_bad_gateway(self):
        """Should retry on 502 (Bad Gateway)."""
        response = MagicMock()
        response.status_code = 502
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is True

    def test_retry_on_503_service_unavailable(self):
        """Should retry on 503 (Service Unavailable)."""
        response = MagicMock()
        response.status_code = 503
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is True

    def test_retry_on_504_gateway_timeout(self):
        """Should retry on 504 (Gateway Timeout)."""
        response = MagicMock()
        response.status_code = 504
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is True

    def test_no_retry_on_400_bad_request(self):
        """Should not retry on 400 (Bad Request)."""
        response = MagicMock()
        response.status_code = 400
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is False

    def test_no_retry_on_401_unauthorized(self):
        """Should not retry on 401 (Unauthorized)."""
        response = MagicMock()
        response.status_code = 401
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is False

    def test_no_retry_on_403_forbidden(self):
        """Should not retry on 403 (Forbidden)."""
        response = MagicMock()
        response.status_code = 403
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is False

    def test_no_retry_on_404_not_found(self):
        """Should not retry on 404 (Not Found)."""
        response = MagicMock()
        response.status_code = 404
        error = HTTPError(response=response)
        assert should_retry_http_error(error) is False

    def test_no_retry_on_non_http_error(self):
        """Should return False for non-HTTPError exceptions."""
        error = ValueError("Some error")
        assert should_retry_http_error(error) is False


class TestRestApiRetry:
    """Tests for REST_API_RETRY decorator."""

    def test_succeeds_on_first_attempt(self):
        """Should succeed without retry if first attempt works."""
        mock_func = MagicMock(return_value="success")
        decorated = REST_API_RETRY(mock_func)

        result = decorated()

        assert result == "success"
        assert mock_func.call_count == 1

    @patch("time.sleep")
    def test_retries_on_connection_error(self, mock_sleep):
        """Should retry on ConnectionError."""
        mock_func = MagicMock(side_effect=[ConnectionError("Connection failed"), "success"])
        decorated = REST_API_RETRY(mock_func)

        result = decorated()

        assert result == "success"
        assert mock_func.call_count == 2

    @patch("time.sleep")
    def test_retries_on_timeout(self, mock_sleep):
        """Should retry on Timeout."""
        mock_func = MagicMock(side_effect=[Timeout("Request timeout"), "success"])
        decorated = REST_API_RETRY(mock_func)

        result = decorated()

        assert result == "success"
        assert mock_func.call_count == 2

    @patch("time.sleep")
    def test_retries_on_http_error(self, mock_sleep):
        """Should retry on HTTPError (500)."""
        response = MagicMock()
        response.status_code = 500

        mock_func = MagicMock(side_effect=[HTTPError(response=response), "success"])
        decorated = REST_API_RETRY(mock_func)

        result = decorated()

        assert result == "success"
        assert mock_func.call_count == 2

    @patch("time.sleep")
    def test_fails_after_max_attempts(self, mock_sleep):
        """Should fail after 3 attempts (max for REST_API_RETRY)."""
        mock_func = MagicMock(side_effect=ConnectionError("Always fails"))
        decorated = REST_API_RETRY(mock_func)

        with pytest.raises(ConnectionError):
            decorated()

        assert mock_func.call_count == 3

    @patch("time.sleep")
    def test_exponential_backoff(self, mock_sleep):
        """Should use exponential backoff between retries."""
        mock_func = MagicMock(
            side_effect=[
                ConnectionError("Fail 1"),
                ConnectionError("Fail 2"),
                "success",
            ]
        )
        decorated = REST_API_RETRY(mock_func)

        result = decorated()

        assert result == "success"
        assert mock_func.call_count == 3
        # Should have called sleep twice (between attempts)
        assert mock_sleep.call_count == 2


class TestExportPollRetry:
    """Tests for EXPORT_POLL_RETRY decorator."""

    def test_succeeds_on_first_attempt(self):
        """Should succeed without retry if first attempt works."""
        mock_func = MagicMock(return_value="complete")
        decorated = EXPORT_POLL_RETRY(mock_func)

        result = decorated()

        assert result == "complete"
        assert mock_func.call_count == 1

    @patch("time.sleep")
    def test_retries_on_request_exception(self, mock_sleep):
        """Should retry on RequestException."""
        mock_func = MagicMock(
            side_effect=[
                requests.exceptions.RequestException("Polling failed"),
                "complete",
            ]
        )
        decorated = EXPORT_POLL_RETRY(mock_func)

        result = decorated()

        assert result == "complete"
        assert mock_func.call_count == 2

    @patch("time.sleep")
    def test_fails_after_max_attempts(self, mock_sleep):
        """Should fail after 10 attempts (max for EXPORT_POLL_RETRY)."""
        mock_func = MagicMock(side_effect=requests.exceptions.RequestException("Always fails"))
        decorated = EXPORT_POLL_RETRY(mock_func)

        with pytest.raises(requests.exceptions.RequestException):
            decorated()

        assert mock_func.call_count == 10


class TestLambdaInvokeRetry:
    """Tests for LAMBDA_INVOKE_RETRY decorator."""

    def test_succeeds_on_first_attempt(self):
        """Should succeed without retry if first attempt works."""
        mock_func = MagicMock(return_value={"status": "success"})
        decorated = LAMBDA_INVOKE_RETRY(mock_func)

        result = decorated()

        assert result == {"status": "success"}
        assert mock_func.call_count == 1

    @patch("time.sleep")
    def test_retries_on_exception(self, mock_sleep):
        """Should retry on any Exception."""
        mock_func = MagicMock(side_effect=[Exception("Lambda invocation failed"), {"status": "success"}])
        decorated = LAMBDA_INVOKE_RETRY(mock_func)

        result = decorated()

        assert result == {"status": "success"}
        assert mock_func.call_count == 2

    @patch("time.sleep")
    def test_fails_after_max_attempts(self, mock_sleep):
        """Should fail after 3 attempts (max for LAMBDA_INVOKE_RETRY)."""
        mock_func = MagicMock(side_effect=Exception("Always fails"))
        decorated = LAMBDA_INVOKE_RETRY(mock_func)

        with pytest.raises(Exception):
            decorated()

        assert mock_func.call_count == 3
