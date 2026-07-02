# Issue 392: Configurability

## Overview

**Goal:** Make the Benchling webhook configuration more flexible to support diverse deployment patterns without hardcoded assumptions.

**Key themes:**
1. Configurable workflows — allow operators to define which workflows trigger which webhook actions
2. Multiple buckets — support routing events to different S3 buckets for different experiments
3. No auto-creation — stop implicitly creating resources (buckets, workgroups, etc.) on deploy; require explicit setup

## Motivation

### Single-workflow, single-bucket assumption

The current stack presumes a single Benchling webhook workflow and a single S3 target bucket. This limits the system to one pipeline per deployment. Customers who need to:

- Route different entry types (e.g. assays vs. experiments) to different destinations
- Stage data in separate buckets per project or team
- Trigger distinct post-processing logic per workflow type

...must deploy separate stacks or work around the constraint with post-hoc routing.

### Implicit resource creation

The CDK stack auto-creates buckets and workgroups when they are referenced but don't exist. This is convenient for first-time setup but dangerous for production:

- A typo in a bucket name creates an unintended resource
- Deploying with a staging prefix that shouldn't exist silently provisions infrastructure
- Cleanup / teardown is harder when resources were auto-created rather than explicitly managed

### Workflow coupling

The webhook event handler is tightly coupled to a single pipeline: receive event → write to designated prefix → done. There is no branching logic based on the event type, workflow ID, or entry schema. Making the workflow configurable means the handler can dispatch to different processing paths based on rules.

## What Success Looks Like

1. **Configurable workflows** — a mapping from event conditions (workflow type, entry schema, etc.) to actions (write to bucket A, invoke Lambda B, etc.) defined in the profile config
2. **Multi-bucket support** — the webhook can write to different S3 buckets depending on the event, not just a single `packages.bucket`
3. **No auto-creation** — the deploy step fails early if referenced resources don't exist, forcing the operator to provision them explicitly

## Open Questions

- What is the configuration format for workflow rules? (JSON schema, YAML, HCL?)
- How do we validate workflow rules at deploy time vs. at runtime?
- Should multi-bucket support be implemented at the CDK level (multiple `Bucket` constructs) or purely at the application layer (conditional routing in Python)?
- For "no auto-creation", do we need pre-deploy validation hooks, or is a `cdk diff` / dry-run sufficient?

## Related

- [#317: Streamline Config](spec/317-streamline-config/) — previous work on decoupling `ProfileConfig` from the CDK stack; introduced `StackConfig` interface
- [#206: Service Envars](spec/206-service-envars/) — service environment variable configuration
- [a11: Async SQS](spec/a11-async-sqs.md) — recent async event processing refactor

## Next Steps

- [ ] Define the configurable workflow rule schema
- [ ] Implement multi-bucket routing in the event handler
- [ ] Add pre-deploy validation for resource existence
- [ ] Document the configuration format for operators
