"""Tests for the FIFO packaging-request consumer."""

import asyncio
import json
from unittest.mock import AsyncMock, Mock

import pytest

from src.package_naming import MissingPlaceholderError
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
async def test_consumer_deletes_message_when_placeholder_has_no_value():
    """A missing pkg_prefix placeholder value won't fill in on retry; don't block the group."""
    entry_packager = Mock()
    entry_packager.benchling = Mock()
    entry_packager.execute_workflow = Mock(
        side_effect=MissingPlaceholderError("creator.handle", "{creator.handle}", "etr_abc")
    )

    consumer, delete_mock = _packaging_consumer(entry_packager)

    body = {"message": {"type": "v2.entry.created", "resourceId": "etr_abc"}}
    await consumer.process_message(_message(body))

    delete_mock.assert_awaited_once_with("rh-etr_abc")


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


@pytest.mark.anyio
@pytest.mark.parametrize(("canvas_entry", "runs"), [("etr_abc", True), ("etr_other", False)])
async def test_consumer_resolves_a_queued_click_from_the_canvas_record(canvas_entry, runs):
    """A queued Update Package click packages the entry Benchling records for its canvas."""
    entry_packager = Mock()
    entry_packager.benchling = Mock()
    entry_packager.benchling.apps.get_canvas_by_id.return_value = Mock(resource_id=canvas_entry)
    entry_packager.execute_workflow = Mock(return_value={"status": "SUCCESS"})

    consumer, _ = _packaging_consumer(entry_packager)

    body = {
        "message": {
            "type": "v2.canvas.userInteracted",
            "buttonId": "update-package-etr_abc",
            "canvasId": "cnvs_abc",
        }
    }
    await consumer.process_message(_message(body))

    entry_packager.benchling.apps.get_canvas_by_id.assert_called_once_with("cnvs_abc")
    assert entry_packager.execute_workflow.called is runs


@pytest.mark.anyio
async def test_consumer_resolves_a_queued_click_off_the_event_loop():
    """The canvas lookup is a blocking Benchling call; it must not stall the consumer's event loop."""
    seen: list = []

    def lookup(canvas_id):
        try:
            asyncio.get_running_loop()
            seen.append("event loop")
        except RuntimeError:
            seen.append("worker thread")
        return Mock(resource_id="etr_abc")

    entry_packager = Mock()
    entry_packager.benchling = Mock()
    entry_packager.benchling.apps.get_canvas_by_id.side_effect = lookup
    entry_packager.execute_workflow = Mock(return_value={"status": "SUCCESS"})

    consumer, _ = _packaging_consumer(entry_packager)

    body = {
        "message": {
            "type": "v2.canvas.userInteracted",
            "buttonId": "update-package-etr_abc",
            "canvasId": "cnvs_abc",
        }
    }
    await consumer.process_message(_message(body))

    assert seen == ["worker thread"]
    entry_packager.execute_workflow.assert_called_once()
