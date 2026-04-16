"""Tests for the FIFO packaging-request consumer."""

import json
from unittest.mock import AsyncMock, Mock

import pytest

from src.packaging_consumer import PackagingConsumer


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _packaging_consumer(entry_packager: Mock) -> tuple[PackagingConsumer, AsyncMock]:
    sqs_client = Mock()
    consumer = PackagingConsumer(
        queue_url="https://sqs.us-west-2.amazonaws.com/123/test.fifo",
        sqs_client=sqs_client,
        entry_packager=entry_packager,
    )
    delete_mock = AsyncMock()
    consumer.delete_message = delete_mock  # type: ignore[method-assign]
    return consumer, delete_mock


def _message(body: dict, *, message_group_id: str = "etr_abc") -> dict:
    return {
        "MessageId": f"msg-{message_group_id}",
        "ReceiptHandle": f"rh-{message_group_id}",
        "Attributes": {"MessageGroupId": message_group_id},
        "Body": json.dumps(body),
    }


@pytest.mark.anyio
async def test_consumer_runs_workflow_and_deletes_on_success():
    entry_packager = Mock()
    entry_packager.benchling = Mock()
    entry_packager.execute_workflow = Mock(return_value={"status": "SUCCESS"})

    consumer, delete_mock = _packaging_consumer(entry_packager)

    body = {"message": {"type": "v2.entry.created", "resourceId": "etr_abc"}}
    await consumer.process_message(_message(body))

    entry_packager.execute_workflow.assert_called_once()
    payload_arg = entry_packager.execute_workflow.call_args.args[0]
    assert payload_arg.entry_id == "etr_abc"
    delete_mock.assert_awaited_once_with("rh-etr_abc")


@pytest.mark.anyio
async def test_consumer_retains_message_on_workflow_error():
    entry_packager = Mock()
    entry_packager.benchling = Mock()
    entry_packager.execute_workflow = Mock(side_effect=RuntimeError("boom"))

    consumer, delete_mock = _packaging_consumer(entry_packager)

    body = {"message": {"type": "v2.entry.created", "resourceId": "etr_abc"}}
    await consumer.process_message(_message(body))

    delete_mock.assert_not_awaited()


@pytest.mark.anyio
async def test_consumer_deletes_unparseable_messages():
    """A malformed body in a FIFO group blocks the entire group; delete it."""
    entry_packager = Mock()
    entry_packager.benchling = Mock()
    entry_packager.execute_workflow = Mock()

    consumer, delete_mock = _packaging_consumer(entry_packager)

    bad_message = {
        "MessageId": "msg-bad",
        "ReceiptHandle": "rh-bad",
        "Attributes": {"MessageGroupId": "etr_abc"},
        "Body": "not-json",
    }
    await consumer.process_message(bad_message)

    entry_packager.execute_workflow.assert_not_called()
    delete_mock.assert_awaited_once_with("rh-bad")


@pytest.mark.anyio
async def test_consumer_dispatches_messages_in_arrival_order():
    """Sequential dispatch is what eliminates the canvas_id race; SQS FIFO
    ordering is the AWS-side guarantee, the consumer just calls
    process_message for each message it receives.
    """
    entry_packager = Mock()
    entry_packager.benchling = Mock()
    seen: list[str] = []

    def record(payload):
        seen.append(payload.event_type)
        return {"status": "SUCCESS"}

    entry_packager.execute_workflow = record

    consumer, _delete_mock = _packaging_consumer(entry_packager)

    entry_msg = _message({"message": {"type": "v2.entry.created", "id": "1", "resourceId": "etr_abc"}})
    canvas_msg = _message(
        {
            "message": {
                "type": "v2.canvas.created",
                "id": "2",
                "resourceId": "etr_abc",
                "canvasId": "cnvs_x",
            }
        }
    )

    await consumer.process_message(entry_msg)
    await consumer.process_message(canvas_msg)

    assert seen == ["v2.entry.created", "v2.canvas.created"]
