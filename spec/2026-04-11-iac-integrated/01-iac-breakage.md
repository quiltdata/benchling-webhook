# IAC Breakage Analysis: EventBridge Rule for Integrated Stack

## Context

Commits `c90d15a` (canvas refresh, PR #375) and `1f728f2` (IaC for integrated
mode, PR #377) introduced two features that are **broken** for the integrated
stack:

1. **Prefix filter in EventBridge rule** — uses a deploy-time parameter for a
   value that is a runtime secret
2. **Missing EventBridge rule** — only exists in the standalone CDK stack, not
   in the Quilt stack IaC needed for integrated mode

---

## Recommendation

### 1. Move ALL filtering from EventBridge rule to Docker

Both the prefix and bucket are runtime values from Secrets Manager — the
CDK/IaC layer cannot know them. The EventBridge rule should match only on
`source` and `detail-type`. All filtering happens in Docker, where the config
is available.

**EventBridge rule (both standalone and integrated):**

```json
{
    "source": ["com.quiltdata"],
    "detail-type": ["package-revision"]
}
```

No bucket filter. No prefix filter. Zero dependency on IaC knowing anything
from the secret.

**Docker (`app.py`, in `_handle_package_event_impl`):**

The existing bucket check at line 844 stays. Add prefix filtering after it:

```python
expected_prefix = f"{config.pkg_prefix}/"
if not package_name.startswith(expected_prefix):
    logger.info("Ignored package event outside prefix",
                package_name=package_name, expected_prefix=expected_prefix)
    return JSONResponse({"status": "IGNORED"}, status_code=200)
```

**Cleanup:** Remove `PackagePrefix` CfnParameter and `PackageBucket` from the
EventBridge rule pattern in `benchling-webhook-stack.ts`, and the
corresponding `PackagePrefix` override in `deploy.ts:764`.

### 2. Add EventBridge rule to Quilt stack IaC for integrated mode

The Quilt stack IaC must create the EventBridge rule, IAM role, and API Gateway
resource policy when `BenchlingIntegration` is enabled. These resources
currently only exist in the standalone CDK stack.

The rule goes on the **default bus** (where `pkgevents` Lambda publishes) and
requires no secret-derived values — just `source` and `detail-type`:

```python
# Quilt stack IaC (troposphere), gated on BenchlingIntegration
events.Rule(
    "BenchlingPackageRevisionRule",
    EventPattern={
        "source": ["com.quiltdata"],
        "detail-type": ["package-revision"],
    },
    Targets=[...],  # API Gateway POST /package-event
)
```

This can be created before the secret is populated, with no ordering
dependency.

---

## Changes Required

| Where                            | What                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `lib/benchling-webhook-stack.ts` | Remove `handle` prefix and `bucket` from rule pattern                            |
| `lib/benchling-webhook-stack.ts` | Remove `PackagePrefix` CfnParameter                                             |
| `bin/commands/deploy.ts`         | Remove `PackagePrefix` from parameter overrides                                  |
| `docker/src/app.py`              | Add runtime prefix filtering in `/package-event` handler                         |
| Quilt stack IaC (external)       | Add EventBridge rule + IAM role + API GW policy, gated on `BenchlingIntegration` |

---

## Appendix: EventBridge Bus and Scoping Investigation

During analysis we investigated whether filtering in the EventBridge rule is
necessary for correctness.

### What we found

- The Quilt stack creates a **custom EventBridge bus** per stack
  (`quilt-${StackName}`) in `deployment/t4/template/events.py`.
- However, the `pkgevents` Lambda publishes `package-revision` events to the
  **default bus** — it calls `put_events()` without specifying `EventBusName`.
  This contrasts with `S3SNSToEventBridge`, which explicitly targets the custom
  bus via a `BUS_ARN` env var.
- The event detail contains **no stack identifier** — just `bucket`, `handle`,
  `topHash`, `type`, and `version`.

Filed as quiltdata/enterprise#1028: add source stack info to event detail and
publish to the custom bus.

### Is the bucket filter in the rule required?

**No.** The Docker handler validates the bucket (`app.py:844`) and rejects
mismatches. Without the bucket filter, the only cost is unnecessary API Gateway
invocations from other stacks in the same account — rejected at the application
layer. Duplicate events from a same-bucket scenario can be debounced.

### Why not keep the bucket filter as an optimization?

The bucket name is configured in the benchling-webhook secret during the setup
wizard. The Quilt IaC does not necessarily have it as a parameter. Requiring
the bucket in the rule would create a dependency between IaC and the secret,
defeating the goal of letting the rule be created independently, before the
secret is populated.

The Docker layer is the correctness gate for both bucket and prefix.
