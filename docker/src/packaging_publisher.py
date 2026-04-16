"""
Publish packaging requests to the FIFO SQS queue.

The webhook handler enqueues a message here instead of spawning a daemon
thread. A separate consumer (``packaging_consumer``) drains the queue and
runs ``EntryPackager.execute_workflow``. ``MessageGroupId=entry_id`` ensures
SQS FIFO sequences all work for a single entry, eliminating the race where
overlapping entry/canvas events trampled each other's ``entry.json``.
"""

from __future__ import annotations

import json
import os
from typing import Any

import structlog

from .payload import Payload

logger = structlog.get_logger(__name__)


PACKAGING_REQUEST_QUEUE_URL_ENV = "PACKAGING_REQUEST_QUEUE_URL"


class PackagingQueueNotConfiguredError(RuntimeError):
    """Raised when the packaging-request queue URL env var is missing."""


def get_packaging_queue_url() -> str:
    """Return the configured packaging-request queue URL or raise."""
    url = os.getenv(PACKAGING_REQUEST_QUEUE_URL_ENV, "").strip()
    if not url:
        raise PackagingQueueNotConfiguredError(
            f"{PACKAGING_REQUEST_QUEUE_URL_ENV} is not configured; " "cannot enqueue packaging request"
        )
    return url


def publish_packaging_request(
    sqs_client: Any,
    queue_url: str,
    payload: Payload,
) -> str:
    """Send a packaging request to the FIFO queue keyed by entry_id.

    Args:
        sqs_client: boto3 SQS client.
        queue_url: FIFO queue URL (must end in ``.fifo``).
        payload: Parsed webhook payload.

    Returns:
        The SQS MessageId on success.

    Raises:
        Exception: Any error from ``send_message`` propagates so the webhook
            can return 5xx and Benchling will retry.
    """
    entry_id = payload.entry_id  # raises ValueError if missing — let it propagate
    body = json.dumps(payload.raw_payload)

    response = sqs_client.send_message(
        QueueUrl=queue_url,
        MessageBody=body,
        MessageGroupId=entry_id,
        # ContentBasedDeduplication on the queue handles duplicate webhook
        # deliveries within SQS's 5-min dedup window.
    )
    message_id = response.get("MessageId", "")

    logger.info(
        "Published packaging request",
        entry_id=entry_id,
        canvas_id=payload.canvas_id,
        event_type=payload.event_type,
        sqs_message_id=message_id,
    )
    return message_id
