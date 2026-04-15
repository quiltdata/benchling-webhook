"""Tests for the FIFO packaging-request publisher."""

import json
from unittest.mock import Mock

import pytest

from src.packaging_publisher import (
    PackagingQueueNotConfiguredError,
    get_packaging_queue_url,
    publish_packaging_request,
)
from src.payload import Payload


@pytest.fixture
def queue_url():
    return "https://sqs.us-west-2.amazonaws.com/123456789012/packaging.fifo"


@pytest.fixture
def entry_payload():
    return Payload(
        {
            "message": {
                "type": "v2.entry.created",
                "id": "evt_1",
                "resourceId": "etr_abc",
                "timestamp": "2026-04-15T10:00:00Z",
            },
            "baseURL": "https://demo.benchling.com",
        }
    )


@pytest.fixture
def canvas_payload():
    return Payload(
        {
            "message": {
                "type": "v2.canvas.created",
                "id": "evt_2",
                "resourceId": "etr_abc",
                "canvasId": "cnvs_xyz",
                "timestamp": "2026-04-15T10:00:01Z",
            },
            "baseURL": "https://demo.benchling.com",
        }
    )


def test_publish_uses_entry_id_as_message_group_id(queue_url, entry_payload):
    """All work for a single entry must serialize via MessageGroupId=entry_id."""
    sqs_client = Mock()
    sqs_client.send_message.return_value = {"MessageId": "msg-1"}

    publish_packaging_request(sqs_client, queue_url, entry_payload)

    kwargs = sqs_client.send_message.call_args.kwargs
    assert kwargs["QueueUrl"] == queue_url
    assert kwargs["MessageGroupId"] == "etr_abc"


def test_publish_canvas_event_groups_with_matching_entry(queue_url, entry_payload, canvas_payload):
    """A canvas event for the same entry must land in the same MessageGroup."""
    sqs_client = Mock()
    sqs_client.send_message.return_value = {"MessageId": "x"}

    publish_packaging_request(sqs_client, queue_url, entry_payload)
    publish_packaging_request(sqs_client, queue_url, canvas_payload)

    group_ids = [c.kwargs["MessageGroupId"] for c in sqs_client.send_message.call_args_list]
    assert group_ids == ["etr_abc", "etr_abc"]


def test_publish_body_round_trips_through_payload(queue_url, canvas_payload):
    """The serialized body must reconstruct an equivalent Payload on the consumer."""
    sqs_client = Mock()
    sqs_client.send_message.return_value = {"MessageId": "x"}

    publish_packaging_request(sqs_client, queue_url, canvas_payload)

    body = sqs_client.send_message.call_args.kwargs["MessageBody"]
    rebuilt = Payload(json.loads(body))

    assert rebuilt.entry_id == canvas_payload.entry_id
    assert rebuilt.canvas_id == canvas_payload.canvas_id
    assert rebuilt.event_type == canvas_payload.event_type


def test_publish_returns_message_id(queue_url, entry_payload):
    sqs_client = Mock()
    sqs_client.send_message.return_value = {"MessageId": "msg-42"}

    result = publish_packaging_request(sqs_client, queue_url, entry_payload)

    assert result == "msg-42"


def test_get_packaging_queue_url_raises_when_unset(monkeypatch):
    monkeypatch.delenv("PACKAGING_REQUEST_QUEUE_URL", raising=False)
    with pytest.raises(PackagingQueueNotConfiguredError):
        get_packaging_queue_url()


def test_get_packaging_queue_url_returns_value(monkeypatch):
    monkeypatch.setenv("PACKAGING_REQUEST_QUEUE_URL", "https://sqs/x.fifo")
    assert get_packaging_queue_url() == "https://sqs/x.fifo"
