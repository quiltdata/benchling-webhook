# Complete Setup Wizard User Flows

## Core Insight

The wizard is the **only interface** users have to:

- Configure credentials
- Choose architecture (integrated vs standalone)
- Enable/disable webhook functionality
- Update existing deployments
- Switch between modes

Each decision must be **informed by clear context** and offer **all relevant options**.

---

## Discovery-Driven Flow

### Phase 1: Catalog Discovery

→ Unchanged (detect catalog DNS)

### Phase 2: Stack Query + Context Display

**What we discover:**

- `BenchlingIntegration` parameter status (enabled/disabled/missing)
- `BenchlingSecret` existence and current values
- `BenchlingAthenaWorkgroup` availability
- VPC configuration

**What we show the user:**

```log
✓ Quilt Stack Found: quilt-prod-stack
  Region: us-east-1
  Account: 123456789012

Benchling Integration Status:
  Integration: Enabled
  Secret: arn:aws:secretsmanager:us-east-1:123456789012:secret:BenchlingSecret-abc123
  Workgroup: quilt-prod-BenchlingAthenaWorkgroup

Current Secret Contents:
  Tenant: acme-corp
  Client ID: clt_***xyz
  App Definition ID: app_***abc
  (Last updated: 2024-12-15)
```

**Decision:** Don't classify into paths yet. Show complete context first.

---

## Path 1: Integrated Mode Available (Parameter Enabled + Secret Exists)

### Context Display (Phase 2)

```log
✓ Detected: Quilt has integrated webhook ENABLED
  → Webhook is running inside Quilt stack
  → Using shared BenchlingSecret
  → Athena workgroup: quilt-prod-BenchlingAthenaWorkgroup

Current Configuration:
  Tenant: acme-corp
  Client ID: clt_***xyz
  App Definition ID: app_***abc
```

### Phase 3: Parameter Collection

**Question 1: What do you want to do?**

```log
The Quilt stack has an integrated webhook already configured.

What would you like to do?

  [1] Update credentials in existing secret (recommended)
      → Keep using integrated webhook
      → Update Benchling tenant/client ID/secret
      → No redeployment needed

  [2] Review configuration (keep existing credentials)
      → Verify settings without changes
      → Save local configuration file

  [3] Disable integrated webhook
      → Stops webhook in Quilt stack
      → Updates stack parameter: BenchlingIntegration=Disabled
      → Requires stack update (3-5 min)

  [4] Switch to standalone deployment
      → Creates separate webhook infrastructure
      → Disables Quilt integration
      → Deploys new CloudFormation stack

→ Select option [1-4]: _
```

**Default:** 1 (hit enter to update credentials)

### Option 1: Update Credentials

**Collect:**

- Benchling tenant (show current, allow edit)
- Client ID (show masked current, prompt for new or keep)
- Client secret (always prompt, never show)
- App definition ID (show current, allow edit)
- Allow list (show current, allow edit)

**Then:**

```
Updating BenchlingSecret...
  [████████████████████████] Done!

✓ Secret updated successfully
✓ Local configuration saved (~/.config/benchling-webhook/default/config.json)
✓ Setup complete - integrated webhook is ready
```

### Option 2: Review Only

**Show all parameters, confirm, save local config only:**

```
✓ Configuration reviewed and saved locally
  No changes made to AWS resources
```

### Option 3: Disable Integration

**Confirm:**

```
This will DISABLE the integrated webhook in your Quilt stack.

Before you proceed:
  • Webhooks will stop receiving events after ~3-5 minutes
  • You can re-enable later by running setup again
  • The BenchlingSecret will remain but won't be used

→ Disable integrated webhook? [y/N]: _
```

**If yes:**

```
Updating Quilt stack parameter...
  Parameter: BenchlingIntegration=Disabled
  [████████████████████████] Stack updating... (3m 24s)

✓ Stack update complete
✓ Integrated webhook disabled
✓ Configuration saved locally
```

### Option 4: Switch to Standalone

**Confirm implications:**

```
This will SWITCH from integrated to standalone mode:

  Changes:
  • Disables webhook in Quilt stack
  • Creates separate BenchlingWebhookStack
  • Creates dedicated BenchlingSecret
  • Creates dedicated Athena workgroup
  • Deploys independent infrastructure

  Time: ~8-10 minutes (Quilt update + new stack deployment)

→ Proceed with standalone deployment? [y/N]: _
```

**If yes:**

```
Step 1/2: Disabling Quilt integration...
  [████████████████████████] Stack updating... (3m 12s)
  ✓ Quilt integration disabled

Step 2/2: Deploying standalone webhook...
  [████████████████████████] Deploying stack... (5m 48s)
  ✓ Stack: BenchlingWebhookStack-default
  ✓ Created dedicated secret
  ✓ Created Athena workgroup: BenchlingWebhookStack-default-athena-workgroup

✓ Setup complete - standalone webhook is ready
```

---

## Path 2: Integration Available But Disabled (Parameter Exists, Value=Disabled)

### Context Display (Phase 2)

```
⚠ Detected: Quilt has integrated webhook DISABLED
  → Webhook parameter exists but is turned off
  → BenchlingSecret may or may not exist
  → Can be enabled or keep standalone
```

### Phase 3: Parameter Collection

**Question 1: How do you want to deploy the webhook?**

```
Your Quilt stack supports integrated webhooks, but it's currently disabled.

Choose deployment mode:

  [1] Enable integrated webhook in Quilt (recommended)
      → Updates Quilt stack: BenchlingIntegration=Enabled
      → Uses/creates shared BenchlingSecret
      → No separate infrastructure needed
      → Takes ~3-5 minutes

  [2] Deploy standalone webhook
      → Creates separate infrastructure
      → Independent from Quilt stack
      → Uses dedicated resources
      → Takes ~5-10 minutes

→ Select option [1/2]: _
```

**Default:** 1 (enable integration)

### Option 1: Enable Integration

**Collect credentials first:**

```
Benchling Configuration:
  Tenant: [acme-corp]
  Client ID: [clt_***xyz or enter new]
  Client Secret: [required, never displayed]
  App Definition ID: [app_***abc]
  Allow List: [10.0.0.0/8,172.16.0.0/12]
```

**Then confirm:**

```
This will ENABLE integrated webhook in your Quilt stack:

  Changes:
  • Updates parameter: BenchlingIntegration=Enabled
  • Creates/updates BenchlingSecret
  • Webhook starts receiving events after ~3-5 minutes
  • Uses Quilt's BenchlingAthenaWorkgroup

→ Enable integrated webhook? [Y/n]: _
```

**If yes:**

```
Updating Quilt stack...
  [████████████████████████] Stack updating... (3m 45s)

Waiting for BenchlingSecret creation...
  [████████████████████████] Verifying resources... Done!

Populating BenchlingSecret...
  [████████████████████████] Updating secret... Done!

✓ Stack update complete
✓ Integrated webhook enabled and configured
✓ Configuration saved locally
✓ Setup complete - webhook is ready to receive events
```

### Option 2: Deploy Standalone

**Collect credentials, then:**

```
Deploying standalone webhook stack...
  Creating: BenchlingWebhookStack-default
  [████████████████████████] Deploying... (5m 23s)

Resources created:
  ✓ BenchlingSecret: arn:aws:secretsmanager:...
  ✓ Athena Workgroup: BenchlingWebhookStack-default-athena-workgroup
  ✓ VPC Link: vlnk-***
  ✓ Network Load Balancer: nlb-***
  ✓ ECS Service: benchling-webhook-service

✓ Stack deployed successfully
✓ Configuration saved locally
✓ Setup complete - standalone webhook is ready
```

---

## Path 3: Legacy Stack (No Integration Parameter)

### Context Display (Phase 2)

```
✓ Detected: Legacy Quilt stack (no integrated webhook support)
  → Quilt stack predates BenchlingIntegration parameter
  → Must deploy as standalone infrastructure
  → Will create dedicated Athena workgroup
```

### Phase 3: Parameter Collection

**No choice needed - explain situation:**

```
Your Quilt stack doesn't support integrated webhooks.

Deploying standalone webhook:
  • Creates separate BenchlingWebhookStack
  • Creates dedicated BenchlingSecret
  • Creates dedicated Athena workgroup
  • Independent from Quilt stack

This is the only deployment option for legacy stacks.
```

**Collect credentials:**

```
Benchling Configuration:
  Tenant: [acme-corp]
  Client ID: [enter]
  Client Secret: [enter]
  App Definition ID: [enter]
  Allow List (optional): [leave blank for no IP filtering]
```

**Then deploy automatically (no confirm needed - only option):**

```
Deploying standalone webhook stack...
  Creating: BenchlingWebhookStack-default
  [████████████████████████] Deploying... (5m 18s)

Resources created:
  ✓ BenchlingSecret: arn:aws:secretsmanager:...
  ✓ Athena Workgroup: BenchlingWebhookStack-default-athena-workgroup
  ✓ VPC Link: vlnk-***
  ✓ Network Load Balancer: nlb-***
  ✓ ECS Service: benchling-webhook-service

✓ Stack deployed successfully
✓ Configuration saved locally
✓ Setup complete - standalone webhook is ready
```

---

## Update Existing Standalone Deployment

### Context Display (Phase 2)

```
✓ Detected: Existing standalone webhook deployment
  Stack: BenchlingWebhookStack-default
  Status: UPDATE_COMPLETE
  Deployed: 2024-12-10

  Secret: arn:aws:secretsmanager:...
  Workgroup: BenchlingWebhookStack-default-athena-workgroup

Current Configuration:
  Tenant: acme-corp
  Client ID: clt_***xyz
  App Definition ID: app_***abc
```

### Phase 3: Parameter Collection

**Question: What would you like to do?**

```
You have an existing standalone webhook deployment.

What would you like to do?

  [1] Update credentials (recommended)
      → Update Benchling tenant/client ID/secret
      → Redeploy stack with new configuration
      → Takes ~5-10 minutes

  [2] Update configuration only (no redeploy)
      → Update local configuration file
      → Update BenchlingSecret
      → No stack changes

  [3] Review configuration (no changes)
      → Verify settings without modifications

  [4] Switch to integrated mode
      → Requires Quilt stack with BenchlingIntegration support
      → Removes standalone stack
      → Enables integration in Quilt

→ Select option [1-4]: _
```

**Default:** 1 (update and redeploy)

---

## Special Case: First-Time Setup (No Profile)

### Context Display (Phase 2)

```
✓ Quilt Stack Found: quilt-prod-stack
⚠ No existing configuration found

  This appears to be your first time setting up the webhook.
```

**Then proceed with standard flow based on discovery (Path 1/2/3).**

---

## --yes Flag Behavior

**With `--yes`, auto-accept defaults but still require:**

- Credentials (if not provided via CLI args)
- Safety confirmations for destructive actions (disable, delete stack)

**Auto-accepted defaults:**

- Path 1: Option 1 (update credentials)
- Path 2: Option 1 (enable integration)
- Path 3: Auto-deploy (only option)

**Still prompt for:**

- Disabling integration (destructive)
- Switching modes (architectural change)
- Deleting resources (destructive)

---

## Success Criteria

### Golden Paths (Hit Enter)

1. **Path 1, Option 1:** Update credentials in integrated webhook → Just enter new values, hit enter
2. **Path 2, Option 1:** Enable integration → Enter credentials, hit enter
3. **Path 3:** Deploy standalone → Enter credentials, auto-deploys

### Context Visibility

- Always show current state before asking questions
- Show what will change before confirmation
- Show progress during long operations
- Show actionable success messages

### Minimal Questions

- Path 1 Integrated Existing: 1 choice (what to do) + credentials
- Path 2 Integration Disabled: 1 choice (enable or standalone) + credentials + 1 confirm
- Path 3 Legacy: 0 choices (only option) + credentials

### Escape Hatches

- Can disable integration (Path 1, Option 3)
- Can switch modes (Path 1, Option 4 or Update Standalone, Option 4)
- Can review without changes (all paths)
- Can bail out at any confirmation
