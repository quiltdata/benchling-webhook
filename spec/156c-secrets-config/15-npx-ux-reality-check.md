# NPX UX Reality Check: The Actual Benchling Workflow

**Date**: 2025-11-03
**Status**: CRITICAL - Previous recommendation missed essential manual steps
**Branch**: `npx-ux`

---

## The Problem with Previous Recommendation

**What was proposed**: `npx setup` does everything in one command

**What was missed**: The ACTUAL Benchling app setup workflow requires MANUAL steps that CANNOT be automated:

1. ✅ Generate manifest file (can automate)
2. ❌ **Upload manifest to Benchling web console** (MANUAL - user must do this)
3. ❌ **Copy App Definition ID from Benchling UI** (MANUAL - only visible in Benchling)
4. ❌ **Install app in Benchling tenant** (MANUAL - must happen in Benchling UI)
5. ✅ Deploy webhook to AWS (can automate)
6. ❌ **Configure webhook URL in Benchling app settings** (MANUAL - must happen in Benchling UI)
7. ❌ **Test app by creating entry and using canvas** (MANUAL - user action in Benchling)

**Reality**: Steps 2, 3, 4, 6, 7 MUST be done manually in Benchling's web interface. No API exists to automate these steps.

---

## The Real Workflow: What Users MUST Do

### Phase 1: Benchling App Creation (MANUAL)

```
User in Browser:
1. Go to Benchling → Feature Settings → Developer Console → Apps
2. Click "Create" → "From manifest"
3. Upload app-manifest.yaml file
4. Copy App Definition ID (e.g., "app_def_abc123xyz")
```

### Phase 2: AWS Deployment (CAN AUTOMATE)

```
User in Terminal:
1. Provide Benchling credentials (client ID, secret, tenant)
2. Provide App Definition ID (from Phase 1)
3. Deploy to AWS
4. Get webhook URL back
```

### Phase 3: Benchling App Configuration (MANUAL)

```
User in Browser:
1. Go back to Benchling app settings
2. Paste webhook URL into webhook configuration
3. Install app in tenant/organization
4. Grant app access to projects
```

### Phase 4: Testing (MANUAL)

```
User in Benchling:
1. Create or open notebook entry
2. Insert Canvas → Select "Quilt Integration"
3. Interact with canvas
4. Verify webhook receives events
```

---

## What We CAN and CANNOT Automate

### ✅ CAN Automate

1. Generate manifest file
2. Infer Quilt configuration from `quilt3 config`
3. Validate Benchling OAuth credentials (test token endpoint)
4. Verify S3 bucket access
5. Create AWS Secrets Manager secret
6. Deploy CDK stack to AWS
7. Return webhook URL for user to copy
8. Check webhook logs to verify events received

### ❌ CANNOT Automate (Benchling UI Only)

1. Upload manifest to Benchling
2. Retrieve App Definition ID
3. Install app in tenant
4. Configure webhook URL in app settings
5. Grant app permissions to projects
6. Create test entries and interact with canvas

---

## Corrected UX Design: Guided Multi-Phase Setup

### Design Principle

**Accept reality**: Some steps MUST be manual. Make those steps CRYSTAL CLEAR and guide the user through them.

**Goal**: Minimize friction at boundaries between automated and manual steps.

---

## Proposed Command Structure

### Command 1: `npx @quiltdata/benchling-webhook@latest init`

**Purpose**: Generate manifest and show next steps

**What it does**:
```bash
$ npx @quiltdata/benchling-webhook@latest init

🚀 Benchling Webhook Setup - Phase 1: Create Benchling App

✓ Generated app-manifest.yaml

┌─────────────────────────────────────────────────────────────────┐
│ Next Steps (Manual - must be done in Benchling):                │
│                                                                 │
│ 1. Upload Manifest to Benchling                                │
│    • Go to: https://[tenant].benchling.com/settings/dev        │
│    • Click: "Create" → "From manifest"                         │
│    • Upload: app-manifest.yaml                                 │
│                                                                 │
│ 2. Copy Your App Definition ID                                 │
│    • After upload, Benchling shows: "app_def_xxxxx"            │
│    • Copy this ID - you'll need it for deployment              │
│                                                                 │
│ 3. Get OAuth Credentials                                       │
│    • Click "Generate Secret" in app settings                   │
│    • Copy Client ID and Client Secret                          │
│    • Keep these secure!                                        │
│                                                                 │
│ When you have these, run:                                      │
│   npx @quiltdata/benchling-webhook@latest deploy               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**User action**: Goes to Benchling, does manual steps, comes back with credentials

---

### Command 2: `npx @quiltdata/benchling-webhook@latest deploy`

**Purpose**: Interactive deployment with validation

**What it does**:
```bash
$ npx @quiltdata/benchling-webhook@latest deploy

🚀 Benchling Webhook Setup - Phase 2: Deploy to AWS

📋 Prerequisites Checklist:
   □ Created Benchling app from manifest
   □ Have App Definition ID (app_def_xxxxx)
   □ Have Client ID and Client Secret
   □ Quilt stack deployed in AWS

Ready to proceed? (y/n): y

🔍 Detecting Quilt configuration...
✓ Found Quilt stack: QuiltStack (us-east-1)
  Catalog: my-catalog.quiltdata.com
  Bucket: my-quilt-bucket
  Region: us-east-1

📝 Benchling Credentials

Benchling tenant (e.g., 'acme' for acme.benchling.com): acme
OAuth Client ID: client_abc123
OAuth Client Secret: ••••••••••••••••
App Definition ID (app_def_xxxxx): app_def_abc123xyz

🔐 Validating credentials...
✓ OAuth credentials valid
✓ S3 bucket accessible

💾 Storing secrets in AWS Secrets Manager...
✓ Created secret: benchling-webhook-acme

🚢 Deploying to AWS...
✓ Stack deployed successfully

┌─────────────────────────────────────────────────────────────────┐
│ 🎉 Deployment Complete!                                          │
│                                                                 │
│ Your webhook URL:                                               │
│   https://abc123.execute-api.us-east-1.amazonaws.com/webhook   │
│                                                                 │
│ Next Steps (Manual - must be done in Benchling):                │
│                                                                 │
│ 1. Configure Webhook URL                                       │
│    • Go to: https://acme.benchling.com/settings/dev            │
│    • Open your app settings                                    │
│    • Paste webhook URL (shown above)                           │
│    • Save changes                                              │
│                                                                 │
│ 2. Install App in Your Tenant                                  │
│    • Click "Install" in app Version History                    │
│    • Choose organizations/teams                                │
│    • Grant access to projects                                  │
│                                                                 │
│ 3. Test the Integration                                        │
│    • Create notebook entry in Benchling                        │
│    • Insert Canvas → "Quilt Integration"                       │
│    • Interact with canvas                                      │
│    • Run: npx @quiltdata/benchling-webhook@latest test         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Webhook URL copied to clipboard! ✓
```

**User action**: Goes to Benchling, configures webhook URL, installs app

---

### Command 3: `npx @quiltdata/benchling-webhook@latest test`

**Purpose**: Verify webhook is receiving events

**What it does**:
```bash
$ npx @quiltdata/benchling-webhook@latest test

🔍 Checking webhook health...

✓ Webhook endpoint responding: /health
✓ ECS tasks running: 2/2 healthy

📊 Recent Activity (last 5 minutes):
  ✓ Received 3 webhook events
  ✓ Processed 3 packages
  ✓ No errors

Latest Event:
  Type: v2.canvas.userInteracted
  Entry: EXP-123 (Sample Experiment)
  Time: 2025-11-03 14:32:18 UTC
  Status: ✓ Success

┌─────────────────────────────────────────────────────────────────┐
│ ✅ Webhook is working correctly!                                │
│                                                                 │
│ To view logs:                                                   │
│   aws logs tail /ecs/benchling-webhook --follow                │
│                                                                 │
│ To update deployment:                                           │
│   npx @quiltdata/benchling-webhook@latest deploy --update      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Alternative: Single "Setup" Command with Pauses

### `npx @quiltdata/benchling-webhook@latest setup` (Interactive)

**What it does**: Guides through ALL phases with pauses for manual steps

```bash
$ npx @quiltdata/benchling-webhook@latest setup

🚀 Benchling Webhook Setup Wizard

This wizard will guide you through the complete setup process.
Some steps require manual actions in Benchling's web interface.

═══════════════════════════════════════════════════════════════
PHASE 1: Create Benchling App
═══════════════════════════════════════════════════════════════

✓ Generated app-manifest.yaml

⚠️  MANUAL STEP REQUIRED

Please complete these steps in Benchling:

1. Upload Manifest
   → Go to: https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest
   → Follow instructions to upload app-manifest.yaml
   → Complete app creation

2. Copy App Definition ID
   → After upload, find the App Definition ID (app_def_xxxxx)
   → This is shown on the app overview page

3. Get OAuth Credentials
   → Click "Generate Secret" in app settings
   → Copy Client ID and Client Secret

Have you completed these steps? (y/n): y

═══════════════════════════════════════════════════════════════
PHASE 2: Deploy to AWS
═══════════════════════════════════════════════════════════════

🔍 Detecting Quilt configuration...
✓ Found Quilt stack: QuiltStack

📝 Enter Benchling Credentials

Benchling tenant: acme
Client ID: client_abc123
Client Secret: ••••••••••••••••
App Definition ID: app_def_abc123xyz

🔐 Validating...
✓ Credentials valid

🚢 Deploying...
✓ Stack deployed

Your webhook URL:
  https://abc123.execute-api.us-east-1.amazonaws.com/webhook

[Copied to clipboard]

═══════════════════════════════════════════════════════════════
PHASE 3: Configure App in Benchling
═══════════════════════════════════════════════════════════════

⚠️  MANUAL STEP REQUIRED

Please complete these steps in Benchling:

1. Configure Webhook URL
   → Go to: https://acme.benchling.com/settings/dev
   → Open your app settings
   → Paste webhook URL: https://abc123...amazonaws.com/webhook
   → Save changes

2. Install App
   → Click "Install" in Version History tab
   → Choose organizations/teams
   → Grant access to projects

Have you completed these steps? (y/n): y

═══════════════════════════════════════════════════════════════
PHASE 4: Test Integration
═══════════════════════════════════════════════════════════════

Let's verify the webhook is working:

Please create a test in Benchling:
  1. Open or create a notebook entry
  2. Insert Canvas → "Quilt Integration"
  3. Interact with the canvas

Press ENTER when you've done this...

🔍 Checking for webhook events...
⏳ Waiting for events (timeout: 60s)...

✓ Event received!
  Type: v2.canvas.userInteracted
  Entry: EXP-123
  Status: Success

═══════════════════════════════════════════════════════════════
🎉 Setup Complete!
═══════════════════════════════════════════════════════════════

Your Benchling webhook is fully configured and operational.

Resources:
  Webhook URL: https://abc123.execute-api.us-east-1.amazonaws.com/webhook
  AWS Secret: benchling-webhook-acme
  CloudWatch Logs: /ecs/benchling-webhook

Commands:
  npx @quiltdata/benchling-webhook@latest test     # Check health
  npx @quiltdata/benchling-webhook@latest logs     # View logs
  npx @quiltdata/benchling-webhook@latest deploy   # Update deployment
```

---

## Comparison: Multi-Command vs Single-Command Approach

### Option A: Multi-Command (Recommended)

**Pros**:
- ✅ User can pause and resume at any phase
- ✅ Clear separation of automated vs manual steps
- ✅ User can skip phases if already completed
- ✅ Easier to document (one command = one concept)
- ✅ Power users can script individual commands

**Cons**:
- ❌ More commands to remember
- ❌ User might get confused about which command to run next

**Commands**:
```bash
npx @quiltdata/benchling-webhook@latest init      # Phase 1: Generate manifest
npx @quiltdata/benchling-webhook@latest deploy    # Phase 2: Deploy to AWS
npx @quiltdata/benchling-webhook@latest test      # Phase 4: Verify
```

---

### Option B: Single-Command Setup (Alternative)

**Pros**:
- ✅ ONE command to rule them all
- ✅ Clear linear progression
- ✅ Prevents user from skipping essential steps
- ✅ Better for first-time users

**Cons**:
- ❌ Cannot pause and resume easily
- ❌ If setup fails mid-way, user must restart
- ❌ Harder to update just deployment without re-entering secrets

**Command**:
```bash
npx @quiltdata/benchling-webhook@latest setup     # All phases with pauses
```

---

## Recommended Approach: Hybrid Model

### Primary Workflow (First-Time Users)

```bash
npx @quiltdata/benchling-webhook@latest setup
# Interactive wizard with pauses for manual steps
```

### Individual Commands (Power Users / Updates)

```bash
npx @quiltdata/benchling-webhook@latest init              # Just generate manifest
npx @quiltdata/benchling-webhook@latest deploy            # Just deploy/update
npx @quiltdata/benchling-webhook@latest test              # Just test
npx @quiltdata/benchling-webhook@latest logs              # View CloudWatch logs
npx @quiltdata/benchling-webhook@latest manifest          # Alias for 'init'
```

### Secrets-Only Mode (Existing in v0.6.0)

```bash
npx @quiltdata/benchling-webhook@latest deploy \
  --quilt-stack-arn arn:aws:cloudformation:... \
  --benchling-secret my-secret-name \
  --yes
# Non-interactive, all params provided
```

---

## Key UX Principles

### 1. **Be Honest About Manual Steps**

❌ Don't say: "One command does everything"
✅ Do say: "We automate what we can, guide you through what must be manual"

### 2. **Provide Crystal Clear Instructions for Manual Steps**

- Include direct links to Benchling docs
- Show exact UI paths ("Go to X → Click Y → Find Z")
- Explain what user should see at each step
- Provide screenshots in docs

### 3. **Validate Before Proceeding**

- Check prerequisites before starting
- Test credentials before deploying
- Verify webhook receives events after configuration

### 4. **Copy Important Info to Clipboard**

- Webhook URL (so user can paste into Benchling)
- App Definition ID prompt (if we can detect it's not in clipboard)
- Secret names and ARNs

### 5. **Make It Resumable**

- Save progress so user can pause and resume
- Allow skipping phases if already completed
- Detect existing resources and offer to reuse/update

### 6. **Provide Clear Success Indicators**

- ✓ Clear checkmarks for completed steps
- ⚠️ Warning triangles for manual steps
- ⏳ Progress indicators for waiting
- 🎉 Celebration when fully complete

---

## Implementation Priority

### Phase 1: MVP (Week 1)

**Commands**:
- `init` - Generate manifest + show manual steps
- `deploy` - Interactive deployment (infer Quilt config, prompt for secrets, deploy)
- `test` - Check webhook health and recent activity

**Features**:
- Quilt config inference
- Benchling credential validation
- Secrets Manager integration
- Clear manual step instructions
- Webhook URL copy to clipboard

### Phase 2: Enhanced (Week 2)

**Commands**:
- `setup` - Full guided wizard with pauses
- `logs` - Stream CloudWatch logs
- `update` - Update existing deployment

**Features**:
- Progress persistence (save/resume)
- Automatic event waiting in test mode
- Better error messages with recovery suggestions
- Health check endpoint testing

### Phase 3: Polish (Week 3)

**Commands**:
- `diagnose` - Troubleshoot common issues
- `uninstall` - Clean removal of resources

**Features**:
- Common error detection and fixes
- Automatic retry on transient failures
- Better progress visualization
- Screenshots/video in documentation

---

## Documentation Updates

### README.md Structure

```markdown
## Quick Start

### Step 1: Generate Manifest
npx @quiltdata/benchling-webhook@latest init

### Step 2: Create App in Benchling
[Manual steps with screenshots]

### Step 3: Deploy to AWS
npx @quiltdata/benchling-webhook@latest deploy

### Step 4: Configure Webhook in Benchling
[Manual steps with screenshots]

### Step 5: Test
npx @quiltdata/benchling-webhook@latest test

## Alternative: Guided Setup
npx @quiltdata/benchling-webhook@latest setup
```

---

## Success Metrics

### User Experience
- Setup completion rate: >90% (up from estimated 60%)
- Time to first successful webhook: <15 minutes
- Support questions: -70%
- User satisfaction: >4.5/5

### Technical
- Credential validation catches errors: >95% before deployment
- Webhook health detection accuracy: >99%
- Zero deployments with invalid credentials

---

## Next Steps

1. ✅ Review this reality check
2. Choose: Multi-command vs Single-command vs Hybrid
3. Implement Phase 1 MVP (Week 1)
4. Test with real users
5. Iterate based on feedback
6. Release v0.7.0

---

## Related Documents

- [14-FINAL-RECOMMENDATION.md](./14-FINAL-RECOMMENDATION.md) - Previous (incomplete) recommendation
- [13-npx-setup-wizard-implementation.md](./13-npx-setup-wizard-implementation.md) - Implementation details
- [README.md](../../README.md) - Current documentation

---

**Reality Check Complete** ✅

The key insight: **Don't promise magic that doesn't exist. Instead, make the manual steps so clear and well-guided that they feel effortless.**
