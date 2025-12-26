# Setup Wizard Optimization Plan

## Executive Summary

**Current state:** Wizard asks generic "use integrated mode?" question regardless of Quilt stack state.

**Proposed state:** Wizard presents three contextual paths based on automatic detection, minimizing user decisions.

---

## Three User Paths (Based on Detection)

### Path 1: Quilt Has Integrated Webhook (Enabled)

**Detection:** `BenchlingIntegration=Enabled` + `BenchlingSecret` exists

**User Experience:**

```
✓ Detected: Quilt has integrated webhook (enabled)
  → Updating Benchling credentials in existing secret
  [Progress bar: Updating secret...]
  ✓ Secret updated successfully
  ✓ Configuration saved
```

**User Decision:** None (automatic)

**Action:** Populate existing secret, save config, **complete setup** (no separate deployment phase)

---

### Path 2: Quilt Has Integrated Webhook (Disabled)

**Detection:** `BenchlingIntegration=Disabled` (parameter exists but off)

**User Experience:**

```
⚠ Detected: Quilt has integrated webhook (disabled)

  Option A: Enable integrated webhook in Quilt
    • Updates Quilt stack to enable BenchlingIntegration
    • Waits for stack update (3-5 minutes)
    • Populates secret when ready
    • Setup complete (no separate deployment)

  Option B: Deploy standalone webhook
    • Creates separate infrastructure
    • Independent from Quilt stack
    • Deploys CloudFormation stack immediately

  → Which approach do you prefer? [A/B]
```

**User Decision:** Enable Quilt integration OR deploy standalone

**Action (A):** Update Quilt stack parameter → **poll with progress** → populate secret → **complete setup**

**Action (B):** Deploy standalone stack → **poll with progress** → **complete setup**

---

### Path 3: Legacy Quilt (No Integration Parameter)

**Detection:** No `BenchlingIntegration` parameter in stack

**User Experience:**

```
✓ Detected: Legacy Quilt stack (no integrated webhook)
  → Deploying standalone webhook infrastructure
  → Creates dedicated Athena workgroup
  [Progress bar: Deploying CloudFormation stack...]
  ✓ Stack deployed successfully
  ✓ Configuration saved
```

**User Decision:** None (automatic deployment)

**Action:** Deploy standalone stack with webhook-managed workgroup → **poll with progress** → **complete setup**

---

## Refactoring Strategy

### Current Phase Structure (7 phases)

```
Phase 1: Catalog Discovery
Phase 2: Stack Query
Phase 3: Parameter Collection
Phase 4: Validation
Phase 5: Mode Decision
Phase 6: Integrated Mode (update secret, EXIT)
Phase 7: Standalone Mode (create secret, ASK about deploy, EXIT)

THEN: Separate deploy command (user runs manually)
```

**Problem:** Status updates and deployments are separated from setup, requiring user to remember next steps.

### Proposed Phase Structure (4 phases)

```
Phase 1: Catalog Discovery
  → Detect catalog DNS

Phase 2: Stack Query + Classification
  → Discover resources + BenchlingIntegration status
  → Classify: Path 1 (enabled) / Path 2 (disabled) / Path 3 (legacy)
  → Return classification with context

Phase 3: Parameter Collection + Validation
  → Collect parameters (merged phases 3+4)
  → Validate immediately (faster feedback)

Phase 4: Execute Path (merged phases 5+6+7 + deployment)
  → Path 1: Update secret → DONE
  → Path 2A: Update Quilt stack (poll) → populate secret → DONE
  → Path 2B: Deploy standalone (poll) → DONE
  → Path 3: Deploy standalone (poll) → DONE
```

**Key Change:** Setup wizard **completes the entire workflow** including stack updates/deployments, not just configuration.

---

## Key Changes Required

### 1. Phase 2: Add Classification Logic

- Already detects `benchlingIntegrationEnabled`
- Add classifier: Enabled → Path 1, Disabled → Path 2, Missing → Path 3
- Return path recommendation with clear explanation

### 2. Phase 4: Fold Deployment Into Setup

- **Remove** separate deploy command concept
- **Add** Quilt stack updater (Path 2A)
  - Update `BenchlingIntegration` parameter
  - Poll with spinner/progress bar (3-5 min)
  - Verify secret creation post-update
- **Add** standalone deployer (Path 2B/3)
  - Deploy CloudFormation stack
  - Poll with progress (5-10 min)
  - Show real-time events
- **Remove** "setup-only" mode (always complete workflow)

### 3. Phase 4: Contextual User Prompts

- Path 1: No prompt (auto-execute)
- Path 2: A/B choice (enable integration vs standalone)
- Path 3: No prompt (auto-deploy)

### 4. Phase 4: Workgroup Resolution

- Path 1/2A: Use discovered `BenchlingAthenaWorkgroup`
- Path 2B/3: Create `{stackName}-athena-workgroup` in webhook stack
- Pass resolved name to deployment/configuration

---

## User Experience Transformation

### Before (Current): Setup + Manual Deploy

```
$ benchling-webhook setup
? Use integrated webhook? [Y/n]
  (User confused: "Is integration enabled? Will it work?")
✓ Configuration saved

Next steps:
  Run: benchling-webhook deploy --profile default
```

**Problem:** User must remember and run separate command; no feedback on actual deployment.

### After (Proposed): Complete Workflow

```
$ benchling-webhook setup

✓ Detected: Quilt has integrated webhook (enabled)
  → Updating Benchling credentials in existing secret
  [████████████████████████] Updating secret... Done!
✓ Secret updated successfully
✓ Configuration saved
✓ Setup complete - webhook is ready to receive events
```

**Result:** Single command completes entire workflow; user gets immediate confirmation that webhook is operational.

---

## Implementation Checklist

### Core Refactoring

- [ ] Merge Phases 3+4 (parameter collection + validation)
- [ ] Add path classification to Phase 2 (return Path 1/2/3)
- [ ] Rewrite Phase 4 (old 5+6+7) as unified executor
- [ ] Remove `setupOnly` / `isPartOfInstall` flags (always deploy)

### New Capabilities

- [ ] Quilt stack updater: Update `BenchlingIntegration` parameter
- [ ] CloudFormation poller: Show progress for stack updates/deployments
- [ ] Progress indicators: Spinners/bars for long operations
- [ ] Real-time event display: CloudFormation stack events during deploy

### Workgroup Logic

- [ ] Phase 2: Detect `BenchlingAthenaWorkgroup` availability
- [ ] Phase 4: Conditional workgroup creation in webhook stack (Path 2B/3 only)
- [ ] Pass resolved workgroup name to CDK deployment

### Testing & Documentation

- [ ] Update tests for 3 paths (enabled/disabled/legacy)
- [ ] Add integration tests for Quilt stack updates
- [ ] Update README: Remove separate deploy step
- [ ] Add troubleshooting for stack update failures

---

## Success Criteria

1. **Single command:** `benchling-webhook setup` completes entire workflow
2. **Path 1:** Zero decisions, auto-updates secret, instant feedback
3. **Path 2:** One decision (A/B), executes choice fully (including deploy/update)
4. **Path 3:** Zero decisions, auto-deploys standalone
5. **All paths:** Clear detection explanation + progress visibility + success confirmation
6. **No separate deploy command:** Users never need to run additional commands
