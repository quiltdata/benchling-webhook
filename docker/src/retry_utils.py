"""
Retry utilities for handling transient failures.

This module provides retry decorators matching Step Functions retry behavior,
using the tenacity library for exponential backoff and retry logic.
"""

import requests
import structlog
from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

logger = structlog.get_logger(__name__)


def should_retry_http_error(exception: Exception) -> bool:
    """
    Determine if HTTP error should be retried.

    Retry on:
    - 429 (Rate Limit)
    - 500, 502, 503, 504 (Server Errors)

    Do not retry on:
    - 400, 401, 403, 404 (Client Errors)

    Args:
        exception: The exception to check

    Returns:
        True if the error should be retried, False otherwise
    """
    if isinstance(exception, requests.exceptions.HTTPError):
        if exception.response is not None:
            status_code = exception.response.status_code
            return status_code in [429, 500, 502, 503, 504]
    return False


def log_retry_attempt(retry_state: RetryCallState) -> None:
    """
    Log retry attempts for debugging.

    Args:
        retry_state: The retry state from tenacity
    """
    exception = retry_state.outcome.exception() if retry_state.outcome else None
    logger.warning(
        "Retrying after failure",
        attempt=retry_state.attempt_number,
        exception=str(exception) if exception else None,
    )


# Retry configuration matching Step Functions patterns

#: REST API retry: 3 attempts with 5-60s exponential backoff
REST_API_RETRY = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=5, max=60),
    retry=(
        retry_if_exception_type((requests.exceptions.ConnectionError, requests.exceptions.Timeout))
        | retry_if_exception(should_retry_http_error)  # type: ignore[arg-type]
    ),
    reraise=True,
)

#: Export polling retry: 10 attempts with 10-60s exponential backoff
EXPORT_POLL_RETRY = retry(
    stop=stop_after_attempt(10),
    wait=wait_exponential(multiplier=1, min=10, max=60),
    retry=retry_if_exception_type((requests.exceptions.RequestException,)),
    reraise=True,
)

#: Lambda invocation retry: 3 attempts with 10-60s exponential backoff
LAMBDA_INVOKE_RETRY = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=10, max=60),
    retry=retry_if_exception_type((Exception,)),
    reraise=True,
)
