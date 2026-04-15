import asyncio
import json
import os
import signal
import time
from dataclasses import dataclass
from typing import Any, Callable

import boto3
import structlog
from benchling_sdk.auth.client_credentials_oauth2 import ClientCredentialsOAuth2
from benchling_sdk.benchling import Benchling
from botocore.config import Config as BotocoreConfig

from .config import Config, get_config
from .package_event import RefreshOutcome, refresh_canvas_for_package_event
from .secrets_manager import SecretsManagerError

logger = structlog.get_logger(__name__)

DELETE_OUTCOMES = {
    RefreshOutcome.SUCCESS.value,
    RefreshOutcome.SKIPPED_STALE.value,
    RefreshOutcome.SKIPPED_NO_CANVAS.value,
    "skipped_filtered",
}

# Backoff bounds for the pre-start readiness wait when Benchling secrets are
# not yet populated (e.g., fresh deploy where the config script has not run).
# Starting at 30s keeps Secrets Manager churn low; capping at 300s bounds the
# worst-case time-to-process after secrets finally appear.
READY_WAIT_INITIAL_SECONDS = 30
READY_WAIT_MAX_SECONDS = 300


class PackageEventParseError(ValueError):
    """Raised when an SQS message cannot be parsed as a package event."""


@dataclass(frozen=True)
class PackageEventMessage:
    package_name: str
    bucket: str
    top_hash: str | None


def parse_package_event_message(body: str) -> PackageEventMessage:
    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise PackageEventParseError("Message body is not valid JSON") from exc

    if not isinstance(event, dict):
        raise PackageEventParseError("Message body must decode to an object")

    detail = event.get("detail")
    if not isinstance(detail, dict):
        raise PackageEventParseError("package event detail is required")

    package_name = detail.get("handle")
    if not isinstance(package_name, str) or not package_name:
        raise PackageEventParseError("package event detail.handle is required")

    bucket = detail.get("bucket")
    if not isinstance(bucket, str) or not bucket:
        raise PackageEventParseError("package event detail.bucket is required")

    top_hash = detail.get("topHash")
    if top_hash is not None and not isinstance(top_hash, str):
        raise PackageEventParseError("package event detail.topHash must be a string when present")

    return PackageEventMessage(package_name=package_name, bucket=bucket, top_hash=top_hash)


def create_benchling_client(config: Config) -> Benchling:
    secrets = config.get_benchling_secrets()
    config.apply_benchling_secrets(secrets)
    auth_method = ClientCredentialsOAuth2(
        client_id=secrets.client_id,
        client_secret=secrets.client_secret,
    )
    return Benchling(url=f"https://{secrets.tenant}.benchling.com", auth_method=auth_method)


class SqsConsumer:
    def __init__(
        self,
        *,
        queue_url: str,
        config: Config,
        benchling_factory: Callable[[], Benchling],
        sqs_client: Any,
        concurrency: int = 5,
        graceful_timeout: int = 30,
        stop_event: asyncio.Event | None = None,
    ):
        self.queue_url = queue_url
        self.config = config
        self.benchling_factory = benchling_factory
        self.sqs_client = sqs_client
        self.concurrency = concurrency
        self.graceful_timeout = graceful_timeout
        self.stop_event = stop_event if stop_event is not None else asyncio.Event()
        self.semaphore = asyncio.Semaphore(concurrency)
        self.in_flight_tasks: set[asyncio.Task[None]] = set()

    async def receive_messages(self) -> list[dict[str, Any]]:
        # Cap batch size to concurrency: with WaitTimeSeconds=20 and a bounded
        # semaphore, asking for more than `concurrency` messages just makes the
        # tail messages sit in the semaphore backlog eating visibility timeout.
        batch_size = max(1, min(10, self.concurrency))
        response = await asyncio.to_thread(
            self.sqs_client.receive_message,
            QueueUrl=self.queue_url,
            WaitTimeSeconds=20,
            MaxNumberOfMessages=batch_size,
        )
        return response.get("Messages", [])

    async def delete_message(self, receipt_handle: str) -> None:
        await asyncio.to_thread(
            self.sqs_client.delete_message,
            QueueUrl=self.queue_url,
            ReceiptHandle=receipt_handle,
        )

    async def process_message(self, message: dict[str, Any]) -> None:
        sqs_message_id = message.get("MessageId", "unknown")
        receipt_handle = message.get("ReceiptHandle")
        start_time = time.monotonic()
        package_handle: str | None = None
        top_hash: str | None = None
        outcome = "consumer_bug"
        should_delete = False

        try:
            parsed = parse_package_event_message(message.get("Body", ""))
            package_handle = parsed.package_name
            top_hash = parsed.top_hash

            expected_prefix = f"{self.config.pkg_prefix}/"
            if parsed.bucket != self.config.s3_bucket_name:
                outcome = "skipped_filtered"
                should_delete = True
                logger.info(
                    "Ignoring package event for unexpected bucket",
                    sqs_message_id=sqs_message_id,
                    bucket=parsed.bucket,
                    expected_bucket=self.config.s3_bucket_name,
                    package_handle=package_handle,
                )
            elif not parsed.package_name.startswith(expected_prefix):
                outcome = "skipped_filtered"
                should_delete = True
                logger.info(
                    "Ignoring package event outside configured prefix",
                    sqs_message_id=sqs_message_id,
                    package_handle=package_handle,
                    expected_prefix=expected_prefix,
                )
            else:
                result = await asyncio.to_thread(
                    refresh_canvas_for_package_event,
                    parsed.package_name,
                    parsed.top_hash,
                    config=self.config,
                    benchling_factory=self.benchling_factory,
                )
                outcome = result.outcome.value
                should_delete = outcome in DELETE_OUTCOMES
        except PackageEventParseError as exc:
            outcome = "parse_error"
            logger.error(
                "Failed to parse package event message",
                sqs_message_id=sqs_message_id,
                error=str(exc),
                exc_info=True,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            outcome = "consumer_bug"
            logger.error(
                "Unexpected package event consumer failure",
                sqs_message_id=sqs_message_id,
                package_handle=package_handle,
                top_hash=top_hash,
                error=str(exc),
                error_type=type(exc).__name__,
                exc_info=True,
            )
        finally:
            if should_delete and receipt_handle:
                await self.delete_message(receipt_handle)

            logger.info(
                "Processed package event SQS message",
                sqs_message_id=sqs_message_id,
                package_handle=package_handle,
                top_hash=top_hash,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                outcome=outcome,
            )

    async def _run_task(self, message: dict[str, Any]) -> None:
        try:
            await self.process_message(message)
        finally:
            self.semaphore.release()

    def _track_task(self, task: asyncio.Task[None]) -> None:
        self.in_flight_tasks.add(task)
        task.add_done_callback(self.in_flight_tasks.discard)

    async def run(self) -> None:
        while not self.stop_event.is_set():
            messages = await self.receive_messages()
            for message in messages:
                if self.stop_event.is_set():
                    break
                await self.semaphore.acquire()
                task = asyncio.create_task(self._run_task(message))
                self._track_task(task)

        if not self.in_flight_tasks:
            return

        _done, pending = await asyncio.wait(self.in_flight_tasks, timeout=self.graceful_timeout)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    def request_stop(self) -> None:
        self.stop_event.set()


def build_sqs_client(region: str) -> Any:
    session = boto3.Session(region_name=region)
    return session.client(
        "sqs",
        config=BotocoreConfig(
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=30,
        ),
    )


async def _sleep_with_stop(stop_event: asyncio.Event, seconds: float) -> bool:
    """Sleep up to ``seconds``, returning early if ``stop_event`` is set.

    Returns ``True`` if the stop event fired during the sleep, ``False`` on timeout.
    """
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False


async def wait_for_ready_config(
    stop_event: asyncio.Event,
    *,
    initial_backoff: float = READY_WAIT_INITIAL_SECONDS,
    max_backoff: float = READY_WAIT_MAX_SECONDS,
) -> Config | None:
    """Block until Benchling secrets are populated and loadable.

    The consumer has no useful work without valid secrets (it cannot filter
    messages without ``s3_bucket_name`` / ``pkg_prefix``). Rather than crashing
    and tripping the ECS deployment circuit breaker on a fresh deploy where
    the secret is created empty by design, we loop here until the secret is
    populated. The signal-driven ``stop_event`` lets ECS stop us cleanly.

    Returns the ready ``Config``, or ``None`` if the stop event fired first.
    """
    attempt = 0
    backoff = initial_backoff
    while not stop_event.is_set():
        try:
            config = get_config()
            secrets = config.get_benchling_secrets()
            config.apply_benchling_secrets(secrets)
        except (SecretsManagerError, ValueError) as exc:
            attempt += 1
            logger.warning(
                "Benchling secrets not ready; SQS consumer waiting before retry",
                attempt=attempt,
                retry_in_seconds=backoff,
                error=str(exc).split("\n", 1)[0],
                error_type=type(exc).__name__,
            )
            if await _sleep_with_stop(stop_event, backoff):
                return None
            backoff = min(backoff * 2, max_backoff)
            continue

        logger.info(
            "SQS consumer config loaded from secrets",
            s3_bucket_name=config.s3_bucket_name,
            pkg_prefix=config.pkg_prefix,
            attempts=attempt + 1,
        )
        return config

    return None


async def main() -> int:
    queue_url = os.getenv("PACKAGE_EVENT_QUEUE_URL", "").strip()
    if not queue_url:
        logger.info("PACKAGE_EVENT_QUEUE_URL not configured; SQS consumer exiting")
        return 0

    # Install signal handlers up front so the container can be stopped cleanly
    # even while we're waiting for secrets to become available.
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:  # pragma: no cover - platform specific
            signal.signal(sig, lambda _signum, _frame: stop_event.set())

    config = await wait_for_ready_config(stop_event)
    if config is None:
        logger.info("SQS consumer stopped before Benchling secrets became available")
        return 0

    sqs_client = build_sqs_client(config.aws_region)
    concurrency = int(os.getenv("PACKAGE_EVENT_CONCURRENCY", "5"))
    graceful_timeout = int(os.getenv("PACKAGE_EVENT_GRACEFUL_TIMEOUT", "30"))

    consumer = SqsConsumer(
        queue_url=queue_url,
        config=config,
        benchling_factory=lambda: create_benchling_client(config),
        sqs_client=sqs_client,
        concurrency=concurrency,
        graceful_timeout=graceful_timeout,
        stop_event=stop_event,
    )

    await consumer.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
