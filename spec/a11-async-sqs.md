# A11: Replace EventBridge→HTTP with EventBridge→SQS for Package-Revision Events

## Problem

A10 wired up `package-revision` events via
**EventBridge → API Gateway → VPC Link → NLB → ECS FastAPI**. It works, but
the HTTP path is the wrong primitive for this traffic:

- The handler is **internally async** — it returns 200 immediately and runs
  the real work (`_refresh_canvas_for_package_event`) in a background thread.
  The HTTP round-trip exists only to hand work to the container.
- EventBridge → API Gateway has a **5-second integration timeout**, with
  retries up to 185×. Any handler blip (cold start, GC pause, restart)
  triggers duplicate canvas refreshes.
- The standalone (`lib/benchling-webhook-stack.ts:314-345`) needs an
  EventBridge IAM role + API Gateway resource policy carve-out; the
  integrated template (PR quiltdata/deployment#2357) additionally needs a
  synthetic API key via `Connection` + `ApiDestination` because troposphere
  lacks the L2 target helper.
- Neither flavor gets the real benefit of event buffering — EventBridge has
  no queue depth you can scale on, and Benchling API rate-limits apply.
- **The `/package-event` route is an internet-reachable HTTPS endpoint.**
  Even gated by an IAM resource policy (standalone) or synthetic API key
  (integrated), it's still a public attack surface: DNS-resolvable,
  TLS-handshake-able, and log-pollutable by anyone who scans API Gateway
  hostnames. One misconfigured resource policy or leaked API key and
  external callers can trigger canvas refreshes. The route exists only to
  receive AWS-internal traffic that never needed to leave AWS in the first
  place.

SQS is the native AWS primitive for "hand an event to a long-running
consumer with buffering, retry, DLQ, and depth-based scaling" — and it
stays entirely inside AWS's IAM perimeter. The FastAPI HTTP endpoint is a
workaround for not having it.

## Solution

1. **EventBridge rule target = SQS queue** (both flavors). The rule
   filters on `source: com.quiltdata` and `detail-type: package-revision`
   only — identical to A10 after the filter-in-IaC fix. Bucket and
   package prefix are **not** in the rule pattern: they live in the
   Benchling secret and the IaC layer cannot know them at deploy time
   (see [`spec/2026-04-11-iac-integrated/01-iac-breakage.md`](2026-04-11-iac-integrated/01-iac-breakage.md)).
   Both are enforced inside `refresh_canvas_for_package_event` (Part 3).
2. **A dedicated sidecar container** in the same ECS task definition runs a
   single-process SQS consumer (`python -m src.sqs_consumer`). It long-polls
   the queue, dispatches each message to an extracted refresh function with
   a total-function contract, and deletes only on definitive success.
3. **Remove** the `/package-event` routes, the EventBridge IAM role, the API
   Gateway resource-policy statement, and (integrated) the
   `Connection` + `ApiDestination` + API-key dance.
4. **Single poison-message policy: DLQ via redrive.** The consumer never
   deletes a message it did not successfully process. All failure classes
   — parse failure, permanent error, transient error — rely on SQS
   redelivery and `maxReceiveCount: 5` to surface poisoned messages in the
   DLQ. There is no delete-immediately path.

---

## Security posture

Moving to SQS **removes an internet-reachable HTTPS route** (`POST
/package-event` on both stage-prefixed and un-prefixed paths). After this
change:

- No DNS name, no TLS endpoint, no API Gateway logs accumulating scanner
  traffic for this function.
- Authorization reduces to a single IAM question ("can this principal
  `sqs:SendMessage` to this queue?") answered inside AWS. No resource
  policies to audit, no API keys to rotate.
- The inbound Benchling webhook routes remain public by necessity — but the
  `/package-event` surface that only AWS ever legitimately called is gone.

For the integrated flavor specifically, this deletes the
`x-eventbridge-source: quilt-package-revision` API key entirely. That key
is a shared secret embedded in CloudFormation and forwarded to API Gateway
as a header — a low-entropy authenticator for a publicly-reachable
endpoint. Removing it is a net security improvement independent of the
SQS migration's other benefits.

---

## Process model (exact counts)

This section pins down the unit-of-consumer at every layer. Reviewers
previously flagged "how many consumers per task" as ambiguous — there is
exactly one authoritative answer per layer:

| Layer | Count | Why |
|---|---|---|
| ECS tasks running the consumer | `N_tasks` (same as HTTP service, typically 2) | Sidecar container is colocated with HTTP container in the same task definition. Scaling the service scales both together. |
| Sidecar containers per task | **1** | One `ContainerDefinition` with `command: ["python", "-m", "src.sqs_consumer"]`, `essential: false`. |
| OS processes per sidecar container | **1** | `python -m src.sqs_consumer` is a single process. **No gunicorn, no multiprocessing, no worker forking.** |
| Asyncio event loops per process | **1** | Top-level `asyncio.run(main())`. |
| SQS receive coroutines per event loop | **1** | A single long-polling receive loop — the only caller of `ReceiveMessage`. |
| Concurrent in-flight handler coroutines per process | **≤ N_concurrency** (default `5`, env-tunable via `PACKAGE_EVENT_CONCURRENCY`) | Bounded by `asyncio.Semaphore(N_concurrency)`. The receive coroutine acquires the semaphore before spawning each handler. |

**Effective Benchling-call concurrency** = `N_concurrency × N_tasks`.
With defaults, this is `5 × 2 = 10` simultaneous Benchling calls across
the fleet. This is the headline rate-limit-safety number and must match
observability alarm thresholds (Part 4).

Nothing about this count depends on gunicorn workers, FastAPI lifespan, or
Uvicorn — the consumer runs in its own process and has no HTTP plumbing.

---

## Why a sidecar container (not FastAPI lifespan)

The webhook container runs under `gunicorn --preload -k
uvicorn.workers.UvicornWorker --workers 2` (`docker/Dockerfile`). FastAPI's
`lifespan` hook fires **per worker process**, not per task. A lifespan-based
consumer would therefore start **two pollers inside every ECS task**,
silently doubling Benchling call volume and breaking the counts above.

Workarounds exist (worker-0 leader election via file lock in a gunicorn
`post_fork` hook, dropping to `--workers 1`, supervisord inside one
container) but each fights the process model. The clean answer is a
**sidecar container in the same ECS task definition**:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Sidecar container** (this spec) | Exactly one consumer process per task, guaranteed by container boundary. Same task def, same env, same task role, same log group (different streams). No changes to gunicorn topology. Sidecar is `essential: true`, so a consumer crash forces ECS to replace the task — queue drain and HTTP serving have equal weight in the reliability story. | One more container definition; slightly larger task memory footprint. A consumer-only crash also takes down the HTTP container on that task, but Fargate replaces it quickly and the service runs ≥2 tasks. | **Chosen.** |
| FastAPI lifespan asyncio consumer | Single container, fewer moving parts. | Runs once per gunicorn worker → concurrency becomes `workers × semaphore × tasks`, not `semaphore × tasks`. Defeats the point of SQS backpressure. | Reject — breaks the rate-limit story. |
| Gunicorn `post_fork` + worker-index gate | No extra container. | Fragile: depends on worker index stability across restarts; couples lifecycle to HTTP server; PID-lock dance. | Reject. |
| Separate ECS service | Strong isolation. | Doubles task definitions, scaling policies, deploy pipelines. | Reject — sidecar gives isolation without the overhead. |
| Lambda (EventBridge→SQS→Lambda or EventBridge→Lambda) | No long-running process. | Must extract refresh logic + Benchling client bootstrap + secrets plumbing into a Lambda-deployable package. Real refactor. | Defer — revisit if/when we split the app. |
| Keep HTTP endpoint, just simplify CDK | Zero code change. | Doesn't address the 5s timeout / retry-storm / public-endpoint problems. | Reject. |

### Sidecar details

- Same Docker image as the HTTP container; different `command` in the task
  definition (`python -m src.sqs_consumer`).
- Shares the task IAM role — which now also includes SQS receive/delete.
- No port mappings, no load-balancer target.
- **`essential: true`** on the sidecar. A consumer crash must force ECS to
  replace the task; otherwise the HTTP container keeps passing load-balancer
  health checks while the queue silently stops draining, and the first
  signal of failure is queue-depth alarm lag (minutes of unprocessed
  events). Replacement cost is low — the service runs ≥2 tasks and Fargate
  brings a new one up promptly — while the cost of a silent outage is
  stale canvases and unbounded queue growth.
- Container-level CloudWatch log stream `/sqs-consumer` alongside the
  existing `/webhook` stream.

## Why SQS (not direct EventBridge→Lambda)

SQS earns its keep by buffering bursts against Benchling API rate limits.
Queue depth gives natural backpressure; DLQ gives a replay surface. Without
SQS, a 50-revision burst pushes all 50 concurrent calls into Benchling and
hopes none 429. With SQS, the consumer controls concurrency.

---

## Dependency policy: sync boto3 via `asyncio.to_thread`

The consumer reuses the existing dependency surface in
[`docker/pyproject.toml`](../docker/pyproject.toml) — specifically, the
already-declared `boto3==1.42.89`. No new packages.

| Dep | Status | Usage |
|---|---|---|
| `boto3==1.42.89` | Already declared | SQS `ReceiveMessage` / `DeleteMessage`; all downstream S3, Athena, Benchling-adjacent calls reused from existing refresh code. |
| `aioboto3` | Not added | See rationale below. |
| `asyncio` (stdlib) | N/A | Event loop, `asyncio.to_thread`, `Semaphore`. |

### Why not `aioboto3`?

`aioboto3` would be the natural choice *if* the consumer's hot path were
dominated by concurrent I/O waiting on boto3 responses. It isn't. The
structural reasons to stay on sync boto3 are:

1. **The refresh path is end-to-end synchronous.** The extracted
   `refresh_canvas_for_package_event` function reuses
   `PackageFileFetcher` (sync boto3 S3), Athena queries (sync boto3),
   the Benchling SDK (sync `requests`), and `quilt3` (sync). Making only
   SQS `Receive`/`Delete` async would yield a mixed-mode process where
   the event loop is blocked on the downstream calls anyway. Async SQS
   buys no throughput when the handler it dispatches to is sync.
2. **Uniform sync is simpler than mixed.** A mixed codebase means two
   exception hierarchies (`botocore.exceptions.ClientError` vs
   `aiobotocore.exceptions.*` which re-exports but lags boto3 patch
   versions), two client lifecycles, and classification rules in
   *Refresh-path contract* that must handle both. Wrapping sync calls in
   `asyncio.to_thread` keeps one exception surface and one client
   factory.
3. **Concurrency is already bounded at 5 per process.** The default
   thread-pool executor (`min(32, cpu_count + 4)` threads) comfortably
   handles `N_concurrency = 5` plus the single receive coroutine. The
   thread-pool ceiling only becomes relevant if concurrency is raised
   above ~25 per process, which would also require re-examining
   Benchling rate limits — a separate decision, not forced by this work.
4. **`aioboto3` tracks `aiobotocore` tracks `botocore`.** Adopting it
   means pinning all three and accepting that each boto3 bump requires
   verifying the aiobotocore version catches up. That's real ongoing
   maintenance for zero throughput benefit given reason 1.

### When to revisit

Add `aioboto3` deliberately, in its own PR, if *any* of these become true:

- The refresh path is rewritten to use async HTTP clients (e.g., httpx
  replacing the Benchling SDK's requests), at which point mixed-mode
  becomes the cost and going fully async becomes the win.
- `N_concurrency` needs to exceed ~25 per process and thread-pool
  saturation shows up in profiling.
- A future consumer handles a different event stream where the SQS
  round-trip itself is the bottleneck.

None of these apply today.

---

## Part 1: Standalone design (CDK)

**File:** `lib/benchling-webhook-stack.ts`

### New resources

| Resource | Purpose |
|---|---|
| `sqs.Queue` "PackageEventQueue" | Main queue; `visibilityTimeout: 300s`. Must comfortably exceed the sum of downstream timeouts a single refresh can accumulate (`PackageFileFetcher` + Athena poll + Benchling SDK are each 30s-class). A tighter window would let a slow-but-legitimate refresh become visible and be picked up by another consumer, causing duplicate canvas updates — the exact failure this migration exists to eliminate. See Part 3 *Visibility timeout* for when to switch to heartbeats instead. |
| `sqs.Queue` "PackageEventDLQ" | Dead-letter queue; 14-day retention. Main queue's `redriveAllowPolicy` targets it with `maxReceiveCount: 5`. |
| `events.Rule` "PackageRevisionRule" | Same event pattern as A10: `source: com.quiltdata` + `detail-type: package-revision` only. Bucket/prefix filtering happens inside the refresh function (see Part 3), not in the rule. |
| `targets.SqsQueue` target | Replaces `targets.ApiGateway`. Queue grants `sqs:SendMessage` to `events.amazonaws.com` automatically via CDK helper. |

### Wiring

- Pass `packageEventQueueUrl` into `FargateService` (new prop).
- Grant the shared ECS **task role** (not execution role)
  `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` on
  the queue. The task role is shared between HTTP container and consumer
  sidecar — only the sidecar exercises these permissions.
- Add a **second container definition** to the task: same image, command
  `["python", "-m", "src.sqs_consumer"]`, `essential: true` (consumer
  crash replaces the task — see *Sidecar details* for rationale), own log
  stream (`/ecs/<stack>/sqs-consumer`). No port mappings, no target-group
  attachment.
- Expose `PACKAGE_EVENT_QUEUE_URL`, `PACKAGE_EVENT_CONCURRENCY` (default
  `5`), and `PACKAGE_EVENT_GRACEFUL_TIMEOUT` (default `30`) on **both**
  containers — HTTP container ignores them, but shared env keeps the task
  definition symmetric.

### Resources to delete

| Currently (A10) | Why removable |
|---|---|
| `eventBridgeApiRole` (IAM Role) | No longer invoking API Gateway from EventBridge. |
| `eventBridgeApiRole.addToPolicy(execute-api:Invoke)` | Same. |
| `this.api.api.addToResourcePolicy(...)` for `POST /package-event` | Same. |
| `targets.ApiGateway(...)` target | Replaced by `targets.SqsQueue(...)`. |

The REST API, VPC Link, NLB, and Fargate service itself are **unchanged** —
they still serve Benchling's inbound webhooks.

### CfnParameter changes

None required. Queue URL and DLQ ARN are CDK-managed; concurrency and
graceful timeout are runtime env vars with hardcoded defaults (overridable
at deploy time via the task definition if needed, without a CFN parameter).

---

## Part 2: Integrated design (troposphere)

**File:** `t4/template/benchling.py` (in `quiltdata/deployment`)

### Differences from standalone

Troposphere has no L2 target helper, but SQS-as-target is simpler than
API-destination-as-target — no `Connection`, no `ApiDestination`, no synthetic
API key. The net CFN is **shorter** than PR quiltdata/deployment#2357.

### New resources

| Resource | Purpose |
|---|---|
| `sqs.Queue` `BenchlingPackageEventQueue` | `Condition: BenchlingEnabled`, `VisibilityTimeout: 300` (must cover worst-case refresh latency — see Part 1 rationale), `RedrivePolicy` → DLQ with `maxReceiveCount: 5`. |
| `sqs.Queue` `BenchlingPackageEventDLQ` | `Condition: BenchlingEnabled`, 14-day retention. |
| `sqs.QueuePolicy` | Allow `events.amazonaws.com` to `SendMessage` scoped to the rule ARN via `aws:SourceArn` condition. |
| `events.Rule` `BenchlingPackageRevisionRule` | Same event pattern as standalone — `source` + `detail-type` only (no bucket/prefix; those are secret-derived and enforced at the app layer). `Targets` = `[{Arn: queue.GetAtt('Arn'), Id: 'BenchlingPackageEventQueue'}]`. |

### Resources to delete (vs PR quiltdata/deployment#2357)

- `benchling_eb_connection` (`events.Connection`)
- `benchling_api_destination` (`events.ApiDestination`)
- `benchling_eb_role` (`helpers.make_assumable_role`)
- The API-key `x-eventbridge-source` construct entirely

### ECS integration

- Add a second `ContainerDefinition` to the task (mirrors standalone
  sidecar): same image, `Command: ["python", "-m", "src.sqs_consumer"]`,
  `Essential: True` (consumer crash replaces the task — see *Sidecar
  details* in Part 1 for rationale), own CloudWatch log stream. No port
  mappings.
- Add `PACKAGE_EVENT_QUEUE_URL`, `PACKAGE_EVENT_CONCURRENCY`, and
  `PACKAGE_EVENT_GRACEFUL_TIMEOUT` to the shared environment block.
- Extend the task role with `sqs:ReceiveMessage`, `sqs:DeleteMessage`,
  `sqs:GetQueueAttributes` on the queue ARN.

### Cross-account note

Identical to A10: if the Quilt stack runs in a different account from the
webhook, the rule must live in the emitting account with cross-account SQS
target (SQS queue policy must allow `events.amazonaws.com` from that
account), OR the Quilt account forwards events to our default bus.

---

## Part 3: Consumer design (shared between flavors)

**File:** new `docker/src/sqs_consumer.py` — a standalone `python -m`
entrypoint (not integrated into `app.py`). Consumer is container-level code
and therefore **identical for standalone and integrated deployments**. It
reads `PACKAGE_EVENT_QUEUE_URL` from env; deployment flavor is invisible.

### Entrypoint and runtime model

1. `python -m src.sqs_consumer` enters `asyncio.run(main())` — single
   process, single event loop (see *Process model* above).
2. On SIGTERM (ECS stop), set an asyncio stop event; drain in-flight
   handlers up to `PACKAGE_EVENT_GRACEFUL_TIMEOUT` seconds (default 30s)
   — and set the sidecar container's ECS `stopTimeout` to the same value.
   After the deadline, cancel remaining tasks and exit.
3. All blocking boto3 calls (SQS receive/delete, S3, Athena, Benchling
   SDK) run via `asyncio.to_thread(...)`. No new async SDK; see
   *Dependency policy*.

### Consumer loop

| # | Behavior |
|---|---|
| 1 | Long-poll SQS: `WaitTimeSeconds=20`, `MaxNumberOfMessages=10`. |
| 2 | For each message, acquire `asyncio.Semaphore(N_concurrency)` then spawn a handler coroutine. The receive loop itself does not block on Benchling; it only blocks when the semaphore is saturated, which is the desired backpressure signal. |
| 3 | Handler coroutine: parse EventBridge envelope, call the extracted refresh function, act on its returned `RefreshResult`. |
| 4 | **Delete** the SQS message **only** when the handler path reaches a `SUCCESS`, `SKIPPED_STALE`, or `SKIPPED_NO_CANVAS` outcome. These are the three "definitive, work-is-done" outcomes. |
| 5 | **Do not delete** the SQS message in any other case — parse failure, `TRANSIENT_ERROR`, `PERMANENT_ERROR`, unexpected exception thrown by the handler itself, or handler-coroutine cancellation before completion. Let the SQS visibility timeout expire so the message is redelivered; `maxReceiveCount: 5` will eventually move it to the DLQ. |
| 6 | Emit a structured log line per message with `sqs_message_id`, `package_handle`, `top_hash`, `duration_ms`, `outcome` (one of the five `RefreshOutcome` values, or `PARSE_ERROR` / `CONSUMER_BUG` for pre-handler failures). Also emit a CloudWatch EMF metric keyed on `outcome`. |

### Visibility timeout

The queue is configured at `300s` (Parts 1 & 2). This is a fixed window,
not an extending lease, and it must stay comfortably above the longest
handler duration SQS will ever see. Today that means: sum of the
30s-class timeouts in `PackageFileFetcher`, Athena polling, and Benchling
SDK calls, with margin for GC pauses and retries.

If worst-case handler latency ever grows past ~4 minutes — because a
downstream timeout is raised, or the refresh path adds a new blocking
step — the consumer must stop relying on a fixed window and start
emitting `ChangeMessageVisibility` heartbeats (extend by 60s every 30s of
in-flight work). The cutover point is whichever comes first: the
P99 `duration_ms` EMF metric approaching 240s, or any operator-observed
duplicate refresh that correlates with a slow first attempt. Until then,
the fixed window is simpler and sufficient.

### Poison-message policy (authoritative)

**One policy, one path: DLQ via redrive.** The consumer has no
delete-on-failure branch. The complete decision table:

| Condition | SQS action | Eventual fate |
|---|---|---|
| Handler returns `RefreshResult(outcome=SUCCESS)` | `DeleteMessage` | Removed from queue. |
| Handler returns `RefreshResult(outcome=SKIPPED_STALE)` | `DeleteMessage` | Removed from queue. |
| Handler returns `RefreshResult(outcome=SKIPPED_NO_CANVAS)` | `DeleteMessage` | Removed from queue. |
| Handler returns `RefreshResult(outcome=TRANSIENT_ERROR)` | Nothing — visibility timeout expires, SQS redelivers | DLQ after 5 redeliveries. |
| Handler returns `RefreshResult(outcome=PERMANENT_ERROR)` | Nothing — visibility timeout expires, SQS redelivers | DLQ after 5 redeliveries. |
| Message body is not valid JSON / not an EventBridge envelope / missing `detail.handle` | Nothing — logged as `PARSE_ERROR` | DLQ after 5 redeliveries. |
| Handler coroutine raises unexpectedly (should not happen — refresh function is total) | Nothing — logged as `CONSUMER_BUG` with stack trace | DLQ after 5 redeliveries. |

Rationale for not delete-on-permanent-error: a `PERMANENT_ERROR`
classification is a best-effort guess from the refresh function. If the
classification itself is buggy (e.g., a transient Benchling outage
misclassified as permanent), delete-on-permanent-error would silently drop
recoverable work. Redrive-to-DLQ costs only 5 retries of wasted work but
guarantees operator visibility for every failure class. We pay that cost
deliberately.

### Refresh-path contract (total function)

**File:** new `docker/src/package_event.py`, extracted from
`_refresh_canvas_for_package_event` (`docker/src/app.py:745-807`).

The existing helper catches every exception and returns `None` — a direct
extraction would make the consumer treat every failure as success and
delete the message. **The extracted function must be a total function: it
never raises; it always returns a `RefreshResult`.**

```python
class RefreshOutcome(Enum):
    SUCCESS = "success"
    SKIPPED_STALE = "skipped_stale"            # event top_hash older than latest
    SKIPPED_NO_CANVAS = "skipped_no_canvas"    # entry.json has no canvas_id
    TRANSIENT_ERROR = "transient_error"        # retry via SQS redelivery
    PERMANENT_ERROR = "permanent_error"        # still redriven to DLQ (see policy above)


@dataclass(frozen=True)
class RefreshResult:
    outcome: RefreshOutcome
    error_type: str | None = None    # exception class name, when applicable
    error_message: str | None = None # truncated; safe for logging
    # No raw exception object or traceback — caller must not need to re-raise
    # to decide retention.


def refresh_canvas_for_package_event(
    package_name: str,
    top_hash: str | None,
    *,
    config: Config,
    benchling_factory: Callable[[], Benchling],
) -> RefreshResult: ...
```

### Contract guarantees

1. **Total function.** `refresh_canvas_for_package_event` catches every
   exception internally. It never propagates exceptions to the consumer.
   If it does, that is a bug; the consumer treats it as `CONSUMER_BUG`
   (see poison-message policy) and does not delete the message.
2. **The `RefreshResult` alone is sufficient.** The consumer decides delete
   vs retain using only `result.outcome`. It does not need the exception,
   the traceback, or any side-channel state.
3. **No partial work.** `SUCCESS` means the canvas was updated; any failure
   mid-refresh returns `TRANSIENT_ERROR` or `PERMANENT_ERROR`, never
   `SUCCESS`.

### Classification rules inside the refresh function

| Condition | `RefreshOutcome` |
|---|---|
| `CanvasManager.update_canvas` returns `{"success": True}` | `SUCCESS` |
| `get_package_top_hash(package_name)` returns a hash ≠ event `top_hash` (stale event) | `SKIPPED_STALE` |
| `metadata` from `get_package_metadata` missing `canvas_id` or `entry_id` | `SKIPPED_NO_CANVAS` |
| Benchling SDK raises HTTP 5xx, HTTP 429, or timeout | `TRANSIENT_ERROR` |
| `botocore.exceptions.ClientError` with retryable code (`ThrottlingException`, `InternalError`, etc.) | `TRANSIENT_ERROR` |
| Network-level `requests.exceptions.ConnectionError` or `socket.timeout` | `TRANSIENT_ERROR` |
| Benchling SDK raises HTTP 4xx (excluding 429) | `PERMANENT_ERROR` |
| `ValueError` / `KeyError` from malformed package metadata | `PERMANENT_ERROR` |
| Any other `Exception` subclass | `TRANSIENT_ERROR` (fail-open to retry; DLQ on repeat) |

`BaseException` subclasses (`KeyboardInterrupt`, `SystemExit`,
`asyncio.CancelledError`) are **not** caught — they propagate to the event
loop so shutdown signals are honored. The consumer treats propagation of
these as "shutdown in progress," not `CONSUMER_BUG`.

### HTTP route fate

The existing `POST /package-event` and `POST /{stage}/package-event` routes
(`docker/src/app.py:888-896`) remain during the rollout soak (Part 5,
steps 2-3) so that flipping the EventBridge rule target back restores
service without a container redeploy. Both the HTTP handler and the SQS
consumer call the same `refresh_canvas_for_package_event` function; the
HTTP handler discards the `RefreshResult` (it has no message to delete and
has already returned 200 to EventBridge).

The routes are **removed in the follow-up PR described in Part 5, step 4.**
Keeping them permanently would preserve the public-endpoint concern from
*Security posture*, which is a non-negotiable load-bearing reason to
complete the rollout.

---

## Part 4: Observability

| # | What | Threshold / detail |
|---|---|---|
| 1 | CloudWatch alarm on `ApproximateNumberOfMessagesVisible` for main queue | Alarm if > 20 for 5 consecutive minutes. Signals consumer lag relative to effective concurrency (`5 × N_tasks`). |
| 2 | CloudWatch alarm on `ApproximateNumberOfMessagesVisible` for DLQ | Alarm on any value > 0, 1-minute evaluation. **Any DLQ message is an operator-actionable event.** |
| 3 | Structured log per message | Fields: `sqs_message_id`, `package_handle`, `top_hash`, `duration_ms`, `outcome`. Use existing `structlog` config. |
| 4 | EMF metric per outcome | Namespace `BenchlingWebhook/PackageEvent`; dimension `outcome`. Emit one data point per processed message. |
| 5 | EMF metric for Benchling 429s | Namespace `BenchlingWebhook/PackageEvent`; metric `benchling_rate_limited`. Used to tune `PACKAGE_EVENT_CONCURRENCY`. |

DLQ messages, `PARSE_ERROR` logs, and `CONSUMER_BUG` logs are the three
channels that must never exceed zero without someone looking — the
triangulation that makes the "no silent drops" guarantee actually hold.

---

## Part 5: Rollout

1. Ship consumer code + `refresh_canvas_for_package_event` extraction
   behind `PACKAGE_EVENT_QUEUE_URL` env gate. Absence = sidecar exits
   immediately (no-op), preserving current HTTP behavior.
2. Standalone: deploy CDK change that creates queue + rule target = SQS +
   sidecar container, **without** removing the HTTP route. EventBridge now
   writes to SQS; consumer starts processing. HTTP route is dead code
   behind the EventBridge rule change but still callable for manual
   rollback.
3. Observe DLQ (should stay at zero), queue depth (should stay low), and
   canvas-refresh latency for one business day.
4. Remove HTTP route + EventBridge→API-Gateway wiring in follow-up PR.
   This PR closes the public-endpoint security concern; it is not optional.
5. Integrated: same sequence on the quiltdata/deployment side — land
   SQS-based rule + sidecar in `t4/template/benchling.py`, soak, then
   remove the `Connection` / `ApiDestination` / `x-eventbridge-source`
   trio in a follow-up.

---

## Verification

1. **Unit**: consumer parses a representative EventBridge SQS-wrapped
   message and calls `refresh_canvas_for_package_event` with correct args.
2. **Unit**: consumer's SQS-delete decision matches the Poison-message
   policy table — delete-called for `SUCCESS`, `SKIPPED_STALE`,
   `SKIPPED_NO_CANVAS`; delete-NOT-called for `TRANSIENT_ERROR`,
   `PERMANENT_ERROR`, parse failure, and unexpected handler exception.
3. **Unit**: `refresh_canvas_for_package_event` returns the correct
   `RefreshOutcome` for a representative sample of the classification
   table — happy path, stale top_hash, missing canvas_id, Benchling 5xx,
   Benchling 4xx, unexpected `RuntimeError`.
4. **Deploy smoke test (standalone)**: in `dev` profile, publish a
   synthetic `package-revision` event via `aws events put-events` and
   confirm the canvas updates end-to-end.
5. **Deploy smoke test (integrated)**: same, in `auto-stack-dev`.
6. **Manual DLQ check**: push one malformed event against `dev`; confirm
   it lands in the DLQ after redrive and the consumer keeps processing
   subsequent messages.

---

## Out of scope

- Changes to A10's `canvas_id` persistence or parsing logic (Parts 0-1 of
  A10 remain load-bearing).
- Changes to inbound Benchling webhook HTTP routes, HMAC verification, or
  API Gateway resource policies unrelated to `/package-event`.
- FIFO semantics — `package-revision` events are idempotent (re-running a
  canvas refresh is safe), so standard SQS is sufficient.
- Adding `aioboto3` or any other new Python dependency — see
  *Dependency policy*.
