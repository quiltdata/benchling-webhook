from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.package_event import RefreshOutcome, RefreshResult
from src.sqs_consumer import PackageEventParseError, SqsConsumer, parse_package_event_message


@pytest.fixture
def mock_config():
    config = Mock()
    config.s3_bucket_name = "test-bucket"
    config.pkg_prefix = "benchling"
    return config


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_parse_package_event_message_success():
    parsed = parse_package_event_message(
        '{"detail":{"bucket":"test-bucket","handle":"benchling/EXP0001","topHash":"abc123"}}'
    )

    assert parsed.bucket == "test-bucket"
    assert parsed.package_name == "benchling/EXP0001"
    assert parsed.top_hash == "abc123"


@pytest.mark.parametrize(
    "body",
    [
        "{}",
        '{"detail":{}}',
        '{"detail":{"handle":"benchling/EXP0001"}}',
        '{"detail":{"bucket":"test-bucket","handle":"benchling/EXP0001","topHash":123}}',
    ],
)
def test_parse_package_event_message_rejects_invalid_payload(body):
    with pytest.raises(PackageEventParseError):
        parse_package_event_message(body)


@pytest.mark.anyio
async def test_consumer_deletes_success_outcomes(mock_config):
    sqs_client = Mock()
    consumer = SqsConsumer(
        queue_url="https://sqs.us-west-2.amazonaws.com/123456789012/test",
        config=mock_config,
        benchling_factory=Mock(),
        sqs_client=sqs_client,
    )
    consumer.delete_message = AsyncMock()

    with patch(
        "src.sqs_consumer.refresh_canvas_for_package_event",
        return_value=RefreshResult(RefreshOutcome.SUCCESS),
    ):
        await consumer.process_message(
            {
                "MessageId": "msg-1",
                "ReceiptHandle": "receipt-1",
                "Body": '{"detail":{"bucket":"test-bucket","handle":"benchling/EXP0001","topHash":"abc123"}}',
            }
        )

    consumer.delete_message.assert_awaited_once_with("receipt-1")


@pytest.mark.anyio
async def test_consumer_retains_transient_failures(mock_config):
    sqs_client = Mock()
    consumer = SqsConsumer(
        queue_url="https://sqs.us-west-2.amazonaws.com/123456789012/test",
        config=mock_config,
        benchling_factory=Mock(),
        sqs_client=sqs_client,
    )
    consumer.delete_message = AsyncMock()

    with patch(
        "src.sqs_consumer.refresh_canvas_for_package_event",
        return_value=RefreshResult(RefreshOutcome.TRANSIENT_ERROR),
    ):
        await consumer.process_message(
            {
                "MessageId": "msg-1",
                "ReceiptHandle": "receipt-1",
                "Body": '{"detail":{"bucket":"test-bucket","handle":"benchling/EXP0001","topHash":"abc123"}}',
            }
        )

    consumer.delete_message.assert_not_awaited()


@pytest.mark.anyio
async def test_consumer_retains_parse_failures(mock_config):
    sqs_client = Mock()
    consumer = SqsConsumer(
        queue_url="https://sqs.us-west-2.amazonaws.com/123456789012/test",
        config=mock_config,
        benchling_factory=Mock(),
        sqs_client=sqs_client,
    )
    consumer.delete_message = AsyncMock()

    await consumer.process_message(
        {
            "MessageId": "msg-1",
            "ReceiptHandle": "receipt-1",
            "Body": '{"detail":{"bucket":"test-bucket"}}',
        }
    )

    consumer.delete_message.assert_not_awaited()


@pytest.mark.anyio
async def test_consumer_deletes_filtered_messages(mock_config):
    sqs_client = Mock()
    consumer = SqsConsumer(
        queue_url="https://sqs.us-west-2.amazonaws.com/123456789012/test",
        config=mock_config,
        benchling_factory=Mock(),
        sqs_client=sqs_client,
    )
    consumer.delete_message = AsyncMock()

    await consumer.process_message(
        {
            "MessageId": "msg-1",
            "ReceiptHandle": "receipt-1",
            "Body": '{"detail":{"bucket":"other-bucket","handle":"benchling/EXP0001","topHash":"abc123"}}',
        }
    )

    consumer.delete_message.assert_awaited_once_with("receipt-1")
