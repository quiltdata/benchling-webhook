# A10: Async Canvas Updates on Package Completion

## Problem

After the webhook uploads files to S3 and sends an SQS message to the Quilt
packager, the workflow returns immediately. The Benchling canvas says
*"Package will be created/updated asynchronously"* but never refreshes once the
package is actually created. The user must manually reload the canvas to see
the package.

## Solution

0. **Fix `Payload.canvas_id`** — it currently misses the `context.canvasId`
   path used by canvas-initialization events, so the value would silently be
   `None` on every `v2.canvas.initialized` webhook.
1. **Persist `canvas_id` in package metadata** (`entry.json`) so we can find
   which canvas to update later.
2. **Subscribe to `package-revision` events** emitted by the Quilt stack on
   the default EventBridge bus.
3. **Refresh the canvas** (async, in a background thread) when a matching
   event arrives and `canvas_id` is present in the package metadata.

---

## Part 0: Fix `Payload.canvas_id` Parser

**Bug:** `Payload.canvas_id` (`docker/src/payload.py:178-180`) only reads
`self._message.get("canvasId")`. But for `v2.canvas.initialized` events,
Benchling sends `canvasId` in the top-level `context` object, not in
`message`. Evidence:

- `docker/tests/test_app.py:142` — `"context": {"canvasId": "canvas_123"}`
- `docker/tests/test_flexible_routes.py:194,214` — same pattern
- `docker/tests/test_app.py:173` — `v2.canvas.userInteracted` uses
  `message.canvasId` (works today)

The tests pass because `CanvasManager` is mocked; they never assert that
`payload.canvas_id` resolved correctly.

### Tasks

| # | What | Where |
|---|------|-------|
| 1 | Update `canvas_id` property to fall back to `self._payload.get("context", {}).get("canvasId")` when `message.canvasId` is absent | `docker/src/payload.py:178-180` |
| 2 | Update init logging (`has_canvas_id`) to reflect both paths | `docker/src/payload.py:46` |
| 3 | Add explicit unit tests: canvas_id from `message`, from `context`, from neither | `docker/tests/test_payload.py` |
| 4 | Add an assertion to the existing canvas-init integration test that `payload.canvas_id` is not None | `docker/tests/test_app.py:~152` |

---

## Part 1: Store `canvas_id` in `entry.json`

**Goal:** When a canvas-initiated workflow writes `entry.json`, include
`canvas_id`. When a non-canvas event updates the same package, preserve the
existing `canvas_id` (never overwrite with `null`).

### Tasks

| # | What | Where |
|---|------|-------|
| 1 | Add optional `canvas_id: Optional[str] = None` parameter to `_create_metadata_files` | `docker/src/entry_packager.py:542` (signature) |
| 2 | Include `"canvas_id": canvas_id` in `entry_json` dict **only when not None** | `docker/src/entry_packager.py:589-603` (entry_json construction) |
| 3 | Pass `payload.canvas_id` from `_process_export` into `_create_metadata_files` | `docker/src/entry_packager.py:495-505` (call site) |
| 4 | When `payload.canvas_id` is None, read existing `entry.json` from S3 before overwriting to preserve an earlier `canvas_id` | `docker/src/entry_packager.py:_process_export`, before `_create_metadata_files` call |
| 5 | Add tests for canvas_id round-trip (present, absent, preserved) | `docker/tests/test_entry_packager.py` |

### Payload availability by event type

| Event type | `canvas_id` source | Present? |
|---|---|---|
| `v2.canvas.initialized` | `context.canvasId` | Always (after Part 0 fix) |
| `v2.canvas.userInteracted` | `message.canvasId` | Always |
| `v2.entry.created` | — | Never |
| `v2.entry.updated.*` | — | Never |

For entry events (`canvas_id is None`), task 4 reads the existing `entry.json`
from S3 to carry forward a previously-stored `canvas_id`.

---

## Part 2: EventBridge Rule (CDK)

**Goal:** Catch `package-revision` events for our bucket and route them to a
new FastAPI endpoint on the existing service.

### Event shape (emitted by Quilt stack on default bus)

```json
{
  "source": "com.quiltdata",
  "detail-type": "package-revision",
  "detail": {
    "type": "created",
    "bucket": "<our-bucket>",
    "handle": "benchling/EXP25000076",
    "topHash": "a0fddace..."
  }
}
```

Docs: <https://docs.quilt.bio/quilt-platform-administrator/advanced/package-events>

### Transport: EventBridge → API Gateway (direct target)

EventBridge supports API Gateway REST APIs as **direct rule targets** using an
IAM role (not an API Destination). This is the correct primitive because:

- **API Destinations** use Connection auth types: Basic, API Key, or OAuth.
  They are designed for *external* HTTP endpoints.
- **API Gateway targets** use an IAM execution role that EventBridge assumes
  to invoke the API. This is the native pattern for calling your own API
  Gateway from EventBridge within the same account.

The CDK construct is `aws-events-targets.ApiGateway`.

### Package prefix parameter

The EventBridge rule filters events by `detail.handle` prefix so it only
fires for packages created by this integration (e.g. `benchling/*`). The
prefix value (`pkg_prefix`) lives in Secrets Manager and is only available at
container runtime — the CDK layer never sees it.

**Approach:** Add a `PackagePrefix` CfnParameter defaulting to `"benchling"`,
matching the existing pattern for `PackageBucket`, `QuiltDatabase`, etc. (all
have config-driven defaults that can be overridden at deploy time).

**Tradeoff:** If someone changes `pkg_prefix` in their Benchling secret to a
non-default value, they must also pass the matching `PackagePrefix` parameter
during stack update. This is consistent with how `PackageBucket` already
works.

### Tasks

| # | What | Where |
|---|------|-------|
| 1 | Add `events` and `events-targets` imports | `lib/benchling-webhook-stack.ts` |
| 2 | Add `PackagePrefix` CfnParameter (type String, default `"benchling"`) | `lib/benchling-webhook-stack.ts` (near line 128, after `PackageBucket`) |
| 3 | Create EventBridge rule on the default bus matching `source: "com.quiltdata"`, `detail-type: "package-revision"`, filtered to bucket (`PackageBucket` param) and `detail.handle` prefix (`PackagePrefix` param) | `lib/benchling-webhook-stack.ts` (new resource) |
| 4 | Add `ApiGateway` target pointing to `POST /{stage}/package-event` with an IAM execution role | `lib/benchling-webhook-stack.ts` (new resource) |
| 5 | Grant the execution role `execute-api:Invoke` on the specific resource path | `lib/benchling-webhook-stack.ts` |
| 6 | Ensure the REST API resource policy allows the EventBridge role (currently the policy may be IP-restricted via `webhookAllowList`) | `lib/rest-api-gateway.ts:58-100` |

### Cross-account note

If the Quilt stack runs in a different account, the EventBridge rule must live
in the **Quilt account** (where events are emitted) with a cross-account
target, OR the Quilt account must forward events to our account's default bus.
This is a deployment-time concern, not a code change.

---

## Part 3: New FastAPI Endpoint (Async Handler)

**Goal:** Receive the EventBridge event, return 200 immediately, then look up
`canvas_id` from package metadata and refresh the canvas in a background
thread.

### Why async?

EventBridge → API Gateway has a **5-second integration timeout** (29s is only
for VPC Link, and EventBridge does not honor it). Refreshing a canvas requires:

1. Read `entry.json` from S3 via the package manifest (~1-2s)
2. Query Athena for linked packages (`canvas.py:208`) (~2-5s)
3. Call Benchling API to update canvas (`canvas.py:305`) (~1-2s)

Total can exceed 5s. If EventBridge gets a timeout, it retries (up to 185
times by default), causing duplicate canvas refreshes. The handler **must**
return 200 immediately and do the work in a background thread, following the
same pattern as `execute_workflow_async` (`entry_packager.py:831-897`) and
`canvas.handle_async` (`canvas.py:649-651`).

### Tasks

| # | What | Where |
|---|------|-------|
| 1 | Add `POST /package-event` and `POST /{stage}/package-event` routes (**no** Benchling HMAC verification) | `docker/src/app.py` (new handler, near line 744) |
| 2 | Parse EventBridge event body: extract `detail.bucket`, `detail.handle`, `detail.topHash` | New handler |
| 3 | Return `200 {"status": "ACCEPTED"}` immediately | New handler |
| 4 | In a background thread: read `entry.json` from the package via `PackageFileFetcher.get_package_metadata(handle)` | `docker/src/package_files.py:251-284` (existing) |
| 5 | If `canvas_id` is present, construct a minimal `Payload` and call `CanvasManager(benchling, config, payload).update_canvas()` | `docker/src/payload.py:22-41`, `docker/src/canvas.py:288-319` |
| 6 | If `canvas_id` is absent, log and return (no-op) | Background thread |
| 7 | Add idempotency guard: skip refresh if `topHash` matches the hash already shown (optional, prevents duplicate refreshes from EventBridge retries) | New handler |
| 8 | Add tests for the new endpoint (with/without canvas_id, malformed events, background thread execution) | `docker/tests/test_package_event.py` (new) |

### Minimal Payload construction (no webhook required)

```python
payload = Payload({"message": {"canvasId": canvas_id, "resourceId": entry_id}})
canvas_manager = CanvasManager(benchling, config, payload)
canvas_manager.update_canvas()
```

This works because `CanvasManager.update_canvas()` → `_make_blocks()` →
`_make_markdown_content()` queries Athena fresh for the latest package state
(`docker/src/canvas.py:208-211`). The newly-created package will appear
automatically.

---

## Part 4: Update Canvas Footer

**Goal:** Remove or soften the "asynchronously" note since the canvas now
auto-refreshes.

| # | What | Where |
|---|------|-------|
| 1 | Consider removing static "Package will be created/updated asynchronously" footer text, or change to "Package updates automatically" | `docker/src/canvas_formatting.py:279-285` |
| 2 | Optionally add a "Last updated" timestamp to the footer | `docker/src/canvas_formatting.py:format_canvas_footer` |

---

## Sequence Diagram

```
Benchling          Our Service          S3       SQS/Quilt       EventBridge
   |                    |                |           |                |
   |-- webhook -------->|                |           |                |
   |                    | (store canvas_id in entry.json)             |
   |<-- canvas (async) -|                |           |                |
   |                    |-- upload ----->|           |                |
   |                    |-- SQS msg ------------>|  |                |
   |                    |                |           |                |
   |                    |           (Quilt creates package)           |
   |                    |                |           |                |
   |                    |                |    package-revision ------>|
   |                    |                |           |                |
   |                    |<---------- POST /package-event (200 immediate)
   |                    |                |           |                |
   |                    | [background thread]       |                |
   |                    |-- read entry.json from S3  |                |
   |                    | (get canvas_id)            |                |
   |<-- update_canvas --|                |           |                |
```

## Verification

1. **Unit tests**: `Payload.canvas_id` from `context` vs `message` (Part 0)
2. **Unit tests**: canvas_id round-trip in entry.json (Part 1, task 5)
3. **Unit tests**: `/package-event` endpoint returns 200, spawns background
   thread, handles missing canvas_id (Part 3, task 8)
4. **Integration test**: Trigger a canvas workflow, verify entry.json contains
   `canvas_id`, then POST a simulated `package-revision` event and confirm the
   canvas updates
5. **Manual E2E**: Create an entry in Benchling, observe canvas shows initial
   state, wait for Quilt to package, observe canvas auto-refreshes with
   package data
