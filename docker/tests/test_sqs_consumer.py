import asyncio
from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.package_event import RefreshOutcome, RefreshResult
from src.secrets_manager import SecretsManagerError
from src.sqs_consumer import (
    PackageEventParseError,
    SqsConsumer,
    main,
    parse_package_event_message,
    wait_for_ready_config,
)


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


@pytest.mark.anyio
async def test_main_applies_secrets_before_polling():
    """Regression: main() must apply secrets so s3_bucket_name is set before filtering."""
    mock_config = Mock()
    mock_config.s3_bucket_name = ""
    mock_config.pkg_prefix = "benchling"
    mock_config.aws_region = "us-east-1"

    mock_secrets = Mock()
    mock_secrets.user_bucket = "quilt-bake"
    mock_config.get_benchling_secrets.return_value = mock_secrets

    with (
        patch.dict("os.environ", {"PACKAGE_EVENT_QUEUE_URL": "https://sqs.us-east-1.amazonaws.com/123/test"}),
        patch("src.sqs_consumer.get_config", return_value=mock_config),
        patch("src.sqs_consumer.build_sqs_client"),
        patch("src.sqs_consumer.SqsConsumer.run", new_callable=AsyncMock),
    ):
        await main()

    mock_config.get_benchling_secrets.assert_called_once()
    mock_config.apply_benchling_secrets.assert_called_once_with(mock_secrets)


@pytest.mark.anyio
async def test_wait_for_ready_config_retries_until_secret_populated():
    """Fresh-deploy case: BenchlingSecret is created empty, then the config
    script populates it. The consumer must keep retrying rather than crashing.

    This is the root cause of the ECS Deployment Circuit Breaker failure the
    reviewer flagged on quiltdata/deployment#2357.
    """
    mock_config = Mock()
    mock_config.s3_bucket_name = "quilt-bake"
    mock_config.pkg_prefix = "benchling"
    mock_config.get_benchling_secrets.side_effect = [
        SecretsManagerError("Missing required parameters in secret"),
        SecretsManagerError("Missing required parameters in secret"),
        Mock(user_bucket="quilt-bake"),  # third attempt succeeds
    ]

    stop_event = asyncio.Event()

    with patch("src.sqs_consumer.get_config", return_value=mock_config):
        # initial_backoff=0 keeps the test fast; the behavior under test is
        # retry-until-success, not the wall-clock schedule.
        result = await wait_for_ready_config(stop_event, initial_backoff=0, max_backoff=0)

    assert result is mock_config
    assert mock_config.get_benchling_secrets.call_count == 3
    mock_config.apply_benchling_secrets.assert_called_once()


@pytest.mark.anyio
async def test_wait_for_ready_config_retries_on_missing_env_var():
    """get_config() raises ValueError when BenchlingSecret env var is empty.

    The retry loop must treat this the same as a SecretsManagerError so a
    mis-ordered deploy (e.g., env var populated slightly after container start)
    does not crash-loop.
    """
    mock_config = Mock()
    mock_config.s3_bucket_name = "quilt-bake"
    mock_config.pkg_prefix = "benchling"
    mock_config.get_benchling_secrets.return_value = Mock(user_bucket="quilt-bake")

    attempts = {"count": 0}

    def fake_get_config():
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise ValueError("Missing required environment variable: BenchlingSecret")
        return mock_config

    stop_event = asyncio.Event()

    with patch("src.sqs_consumer.get_config", side_effect=fake_get_config):
        result = await wait_for_ready_config(stop_event, initial_backoff=0, max_backoff=0)

    assert result is mock_config
    assert attempts["count"] == 2


@pytest.mark.anyio
async def test_wait_for_ready_config_short_circuits_on_stop():
    """SIGTERM during the readiness wait must exit the loop cleanly."""
    mock_config = Mock()
    mock_config.get_benchling_secrets.side_effect = SecretsManagerError("Secret is empty")

    stop_event = asyncio.Event()
    stop_event.set()  # simulate SIGTERM already delivered

    with patch("src.sqs_consumer.get_config", return_value=mock_config):
        result = await wait_for_ready_config(stop_event, initial_backoff=0, max_backoff=0)

    assert result is None
    # With stop_event pre-set, we should not even attempt a fetch.
    mock_config.get_benchling_secrets.assert_not_called()


@pytest.mark.anyio
async def test_main_exits_cleanly_when_stopped_during_wait():
    """End-to-end: main() must not invoke the consumer run loop if stopped
    before secrets become available."""
    mock_config = Mock()
    mock_config.get_benchling_secrets.side_effect = SecretsManagerError("Secret is empty")

    async def fake_wait_for_ready_config(stop_event, **_kwargs):
        return None  # simulate stop arriving before secrets populated

    with (
        patch.dict("os.environ", {"PACKAGE_EVENT_QUEUE_URL": "https://sqs.us-east-1.amazonaws.com/123/test"}),
        patch("src.sqs_consumer.wait_for_ready_config", side_effect=fake_wait_for_ready_config),
        patch("src.sqs_consumer.build_sqs_client") as build_client,
        patch("src.sqs_consumer.SqsConsumer.run", new_callable=AsyncMock) as run,
    ):
        rc = await main()

    assert rc == 0
    build_client.assert_not_called()
    run.assert_not_called()


@pytest.mark.anyio
async def test_receive_messages_caps_batch_size_to_concurrency(mock_config):
    """MaxNumberOfMessages should match concurrency so batched messages don't
    pile up in the semaphore backlog eating visibility timeout."""
    sqs_client = Mock()
    sqs_client.receive_message.return_value = {"Messages": []}
    consumer = SqsConsumer(
        queue_url="https://sqs.us-west-2.amazonaws.com/123456789012/test",
        config=mock_config,
        benchling_factory=Mock(),
        sqs_client=sqs_client,
        concurrency=3,
    )

    await consumer.receive_messages()

    kwargs = sqs_client.receive_message.call_args.kwargs
    assert kwargs["MaxNumberOfMessages"] == 3


@pytest.mark.anyio
async def test_receive_messages_batch_size_capped_at_ten(mock_config):
    """SQS caps MaxNumberOfMessages at 10 regardless of our concurrency."""
    sqs_client = Mock()
    sqs_client.receive_message.return_value = {"Messages": []}
    consumer = SqsConsumer(
        queue_url="https://sqs.us-west-2.amazonaws.com/123456789012/test",
        config=mock_config,
        benchling_factory=Mock(),
        sqs_client=sqs_client,
        concurrency=25,
    )

    await consumer.receive_messages()

    kwargs = sqs_client.receive_message.call_args.kwargs
    assert kwargs["MaxNumberOfMessages"] == 10
