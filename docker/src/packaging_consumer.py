"""
Drain the FIFO packaging-request queue and run ``EntryPackager.execute_workflow``.

Runs as a third Fargate sidecar container (alongside the webhook container and
the existing package-event consumer). FIFO + ``MessageGroupId=entry_id`` makes
this consumer process work for any single entry sequentially, eliminating the
race condition the ``.canvas_id`` sidecar used to mask.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import time
from typing import Any

import structlog

from .entry_packager import EntryPackager
from .payload import Payload
from .sqs_consumer import (
    BaseSqsConsumer,
    build_sqs_client,
    create_benchling_client,
    wait_for_ready_config,
)

logger = structlog.get_logger(__name__)


class PackagingConsumer(BaseSqsConsumer):
    """Consume FIFO packaging requests and dispatch to ``execute_workflow``."""

    def __init__(
        self,
        *,
        queue_url: str,
        sqs_client: Any,
        entry_packager: EntryPackager,
        concurrency: int = 5,
        graceful_timeout: int = 30,
        stop_event: asyncio.Event | None = None,
    ):
        super().__init__(
            queue_url=queue_url,
            sqs_client=sqs_client,
            concurrency=concurrency,
            graceful_timeout=graceful_timeout,
            stop_event=stop_event,
        )
        self.entry_packager = entry_packager

    async def process_message(self, message: dict[str, Any]) -> None:
        sqs_message_id = message.get("MessageId", "unknown")
        receipt_handle = message.get("ReceiptHandle")
        message_group_id = (message.get("Attributes") or {}).get("MessageGroupId")
        start_time = time.monotonic()
        outcome = "consumer_bug"
        should_delete = False
        entry_id: str | None = None

        try:
            body_str = message.get("Body") or ""
            try:
                raw = json.loads(body_str)
            except json.JSONDecodeError as exc:
                outcome = "parse_error"
                # Permanent: a malformed body will never succeed. Delete so it
                # does not block subsequent messages in the same MessageGroup.
                should_delete = True
                logger.error(
                    "Failed to parse packaging-request body as JSON",
                    sqs_message_id=sqs_message_id,
                    message_group_id=message_group_id,
                    error=str(exc),
                )
                return

            payload = Payload(raw, benchling=self.entry_packager.benchling)
            entry_id = payload.entry_id

            await asyncio.to_thread(self.entry_packager.execute_workflow, payload)
            outcome = "success"
            should_delete = True
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            outcome = "workflow_error"
            # Leave the message on the queue. Visibility timeout (40 min) plus
            # maxReceiveCount=3 will route persistent failures to the DLQ.
            logger.error(
                "Packaging workflow failed; leaving message for retry",
                sqs_message_id=sqs_message_id,
                message_group_id=message_group_id,
                entry_id=entry_id,
                error=str(exc),
                error_type=type(exc).__name__,
                exc_info=True,
            )
        finally:
            if should_delete and receipt_handle:
                await self.delete_message(receipt_handle)

            logger.info(
                "Processed packaging request",
                sqs_message_id=sqs_message_id,
                message_group_id=message_group_id,
                entry_id=entry_id,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                outcome=outcome,
            )


async def main() -> int:
    queue_url = os.getenv("PACKAGING_REQUEST_QUEUE_URL", "").strip()
    if not queue_url:
        logger.info("PACKAGING_REQUEST_QUEUE_URL not configured; packaging consumer exiting")
        return 0

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:  # pragma: no cover - platform specific
            signal.signal(sig, lambda _signum, _frame: stop_event.set())

    config = await wait_for_ready_config(stop_event)
    if config is None:
        logger.info("Packaging consumer stopped before Benchling secrets became available")
        return 0

    sqs_client = build_sqs_client(config.aws_region)
    concurrency = int(os.getenv("PACKAGING_REQUEST_CONCURRENCY", "5"))
    graceful_timeout = int(os.getenv("PACKAGING_REQUEST_GRACEFUL_TIMEOUT", "30"))

    benchling = create_benchling_client(config)
    entry_packager = EntryPackager(benchling=benchling, config=config)

    consumer = PackagingConsumer(
        queue_url=queue_url,
        sqs_client=sqs_client,
        entry_packager=entry_packager,
        concurrency=concurrency,
        graceful_timeout=graceful_timeout,
        stop_event=stop_event,
    )

    await consumer.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
