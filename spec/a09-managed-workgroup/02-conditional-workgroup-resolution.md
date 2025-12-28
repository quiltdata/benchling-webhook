# Conditional Athena Workgroup Resolution (Follow-on)

## Goal

Resolve ambiguity in the previous plan: the webhook stack must **use the Quilt-managed workgroup if it exists**, otherwise **create a webhook-managed workgroup**.

## Resolution Rules

1. **Discover Quilt-managed workgroup**
   - Target name: `{quiltStackName}-BenchlingAthenaWorkgroup`
   - If this exists in the Quilt stack of interest, use it.

2. **Fallback creation (webhook-managed)**
   - Only when rule 1 fails.
   - Name format: `{benchlingWebhookStackName}-athena-workgroup`
   - Created in the Benchling Webhook stack.

## Required Behavior

- No unconditional creation of the webhook-managed workgroup.
- The runtime config/env var must use the **resolved** workgroup name (Quilt-managed or webhook-managed).
- Name resolution must be deterministic from stack metadata (no magic constants).

## Implementation Notes (Concise)

- Keep Quilt stack discovery for the workgroup, but key on the Quilt stack name prefix.
- When discovery returns a name, bypass creation and pass that to the Fargate service.
- When discovery returns nothing, create the webhook-managed workgroup and pass that name instead.
- Ensure `xdg-launch` (or equivalent env var construction) derives the name from the same resolution logic.

## Open Items

- Where resolution logic lives (CDK vs. deploy-time discovery) must be decided and documented.
- If CDK cannot conditionally create without a custom resource, document the chosen mechanism.
