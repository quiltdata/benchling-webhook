# NPX UX Overhaul - Specification Summary

**Created**: 2025-11-03
**Branch**: `npx-ux`
**Target Version**: v0.7.0
**Status**: CORRECTED - Ready for Implementation

---

## CRITICAL: Read Document 18 First

**[18-CORRECTED-npx-ux-spec.md](./18-CORRECTED-npx-ux-spec.md)** contains CRITICAL CORRECTIONS to this specification.

**Four Critical Fixes**:

1. ✅ Use `quilt3 config` CLI (NOT `~/.quilt3/config.yml` file)
2. ✅ Default behavior: `npx @quiltdata/benchling-webhook` runs setup
3. ✅ README focuses ONLY on end-user simple experience
4. ✅ Target audience: End users ONLY (no power users, no CI/CD)

---

## Overview

This specification addresses the **critical gap** between the excellent wizard/tooling built for developers (`npm run setup`) and the manual, error-prone workflow that npx users face.

**The Core Problem**: Previous documentation recommended `npx setup` as "one command does everything," but this IGNORED the reality that several essential Benchling steps MUST be done manually in their web UI.

**The Solution**: Accept reality. Build a simple guided wizard that:
1. **Automates what we can** (AWS deployment, credential validation, config inference)
2. **Guides users clearly through what must be manual** (Benchling app creation, webhook URL config, app installation)
3. **Validates before deploying** (catch errors early)
4. **Makes it dead simple** (one command: `npx @quiltdata/benchling-webhook`)

---

## Documents in This Spec

### 0. [18-CORRECTED-npx-ux-spec.md](./18-CORRECTED-npx-ux-spec.md) ⭐⭐⭐ READ THIS FIRST

#### The Critical Corrections

- Use `quilt3 config` CLI (NOT YAML file)
- Default behavior runs setup wizard
- README is ultra-simple (end users only)
- Corrected helper module implementation
- Corrected CLI entry point
- Simplified README example

**Why This Matters**: Documents 15-17 have outdated assumptions. This doc corrects them all.

---

### 1. [15-npx-ux-reality-check.md](./15-npx-ux-reality-check.md) ⭐ **Context**

**The Wake-Up Call**

- Identifies what CAN vs CANNOT be automated
- Explains the ACTUAL Benchling workflow (7 steps, 4 are manual)
- Proposes three UX approaches (multi-command, single-command, hybrid)
- **Recommends**: Hybrid model (guided wizard + individual commands)

**Key Insights**:
- Benchling has NO API for manifest upload, app creation, or webhook configuration
- Users MUST use Benchling's web UI for these steps
- Previous "one command does everything" promise was **impossible**
- Solution: Make manual steps **crystal clear** with excellent guidance

---

### 2. [16-npx-ux-implementation-spec.md](./16-npx-ux-implementation-spec.md) ⭐ Blueprint (See Doc 18 for corrections)

#### The Technical Specification

Complete technical specification for all commands (with corrections from Doc 18):

#### Primary Command

| Command | Purpose | Users |
| --------- | --------- | ------- |
| `(default)` | Full guided wizard = setup | 99% of users |
| `setup` | Alias for default | Same |

#### Internal Commands (used by setup, not in README)

| Command | Purpose | Used By |
| --------- | --------- | --------- |
| `init` | Generate manifest | setup wizard |
| `deploy` | Deploy stack | setup wizard |
| `test` | Verify webhook | setup wizard |
| `logs` | Stream logs | debugging only |

#### Helper Modules

- `bin/commands/helpers/infer-quilt.ts` - Auto-detect Quilt config via `quilt3 config` CLI
- `bin/commands/helpers/validate-benchling.ts` - Validate OAuth credentials via API
- `bin/commands/helpers/webhook-test.ts` - Detect webhook events in CloudWatch

#### Key Features

- **Quilt Config Inference**: Execute `quilt3 config` → Find matching CloudFormation stack
- **Credential Validation**: Test OAuth before deploying (prevent bad deployments)
- **Manual Step Guidance**: Clear, boxed instructions with links and examples
- **Clipboard Integration**: Copy webhook URL automatically
- **Event Detection**: Wait for and detect webhook events in logs
- **State Persistence**: Pause and resume setup wizard

---

### 3. [17-implementation-checklist.md](./17-implementation-checklist.md) ⭐ Roadmap (Apply Doc 18 corrections)

#### The Implementation Plan

Detailed 3-week implementation plan with daily tasks (apply Doc 18 corrections):

**Week 1**: Core commands and helpers
- Day 1: Project structure
- Day 2: Helper modules (infer, validate, test)
- Day 3: Enhance `init` command
- Day 4: Enhance `deploy` command (interactive mode)
- Day 5: Implement `test` command

**Week 2**: Setup wizard
- Day 1: Setup command structure and phase progression
- Day 2: Manual step UX and state persistence
- Day 3: Webhook event detection
- Day 4: Logs command
- Day 5: Polish UX and config save

**Week 3**: Testing, docs, release
- Day 1-2: Integration testing and bug fixes
- Day 3: Update documentation (README, CLAUDE.md, screenshots)
- Day 4: Beta testing with real users
- Day 5: Release v0.7.0

---

## Key Design Principles

### 1. **Be Honest About Manual Steps**

❌ **Don't**: Promise "one command does everything"
✅ **Do**: "We automate what we can, guide you through what must be manual"

### 2. **Validate Early, Deploy Confidently**

- Test Quilt config inference before prompting for secrets
- Validate Benchling credentials via OAuth API before deploying
- Verify S3 bucket access before creating secrets
- Check ECS health and recent events in test command

### 3. **Provide Crystal Clear Manual Step Instructions**

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️  MANUAL STEP REQUIRED                                        │
│                                                                 │
│ Configure Webhook URL in Benchling                             │
│                                                                 │
│ 1. Go to: https://acme.benchling.com/settings/dev              │
│ 2. Open your app settings                                      │
│ 3. Paste webhook URL: https://abc123...amazonaws.com/webhook   │
│ 4. Save changes                                                │
│                                                                 │
│ Have you completed these steps? (y/n):                         │
└─────────────────────────────────────────────────────────────────┘
```

### 4. **Make It Resumable**

- Save progress to `.benchling-webhook-state.json`
- Allow users to pause and resume
- Skip already-completed phases
- Offer to reuse existing resources

### 5. **Provide Multiple Paths**

**Beginner Path**: `setup` (guided wizard)
**Power User Path**: `init` → `deploy` → `test` (granular control)
**CI/CD Path**: `deploy --quilt-stack-arn ... --benchling-secret ... --yes` (non-interactive)

---

## Comparison: Before vs After

### Before (v0.6.x)

**User Experience**:
```bash
# Step 1: Read complex README
# Step 2: Manually generate manifest
npx @quiltdata/benchling-webhook manifest

# Step 3: Manually upload to Benchling (no guidance)
# Step 4: Manually create AWS secret with long command
aws secretsmanager create-secret --name ... --secret-string '{...}'

# Step 5: Manually find Quilt stack ARN in CloudFormation console
# Step 6: Deploy
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123" \
  --benchling-secret "benchling-webhook-credentials"

# Step 7: Manually configure webhook URL (no guidance)
# Step 8: Manually install app (no guidance)
# Step 9: Manually test (hope it works)
```

**Pain Points**:
- 9 manual steps with lots of room for error
- No validation until after deployment
- Easy to miss steps (like installing the app)
- No way to verify it's working
- 15-30 minutes, high frustration

---

### After (v0.7.0)

**Option 1: Guided Setup (Beginners)**

```bash
npx @quiltdata/benchling-webhook@latest setup

# Wizard does:
# ✓ Generates manifest
# ⚠️ Pauses: "Upload this to Benchling, then press Y"
# ✓ Auto-detects Quilt config
# ✓ Prompts for credentials (validated)
# ✓ Creates AWS secret
# ✓ Deploys stack
# ⚠️ Pauses: "Configure webhook URL, then press Y"
# ⚠️ Pauses: "Install app, then press Y"
# ✓ Waits for webhook event
# 🎉 Success!
```

**Benefits**:
- Clear guidance at every step
- Validation before deployment
- Can't skip essential steps
- Automatic verification
- 10-15 minutes, low frustration

---

**Option 2: Step-by-Step (Power Users)**

```bash
npx @quiltdata/benchling-webhook@latest init
# (upload to Benchling)

npx @quiltdata/benchling-webhook@latest deploy
# Auto-detects Quilt, prompts for secrets, validates, deploys

# (configure webhook URL in Benchling)

npx @quiltdata/benchling-webhook@latest test
# Verifies health and recent events
```

**Benefits**:
- Granular control
- Can pause between steps
- Easy to update just deployment
- Each command is focused

---

**Option 3: Non-Interactive (CI/CD, existing workflow)**

```bash
npx @quiltdata/benchling-webhook@latest deploy \
  --quilt-stack-arn arn:aws:... \
  --benchling-secret my-secret \
  --yes
```

**Benefits**:
- Backward compatible
- Scriptable
- No prompts

---

## Success Metrics

### User Experience Goals

- ✅ Setup completion rate: >90% (up from ~60%)
- ✅ Time to first webhook: <15 min (down from 15-30 min)
- ✅ Support questions: -70%
- ✅ User satisfaction: >4.5/5

### Technical Goals

- ✅ Credential validation catches errors: >95% before deployment
- ✅ Quilt config detection accuracy: >95%
- ✅ Webhook health detection accuracy: >99%
- ✅ Zero deployments with invalid credentials

---

## Dependencies & Risks

### Dependencies (Already in package.json)

- ✅ `inquirer` - Interactive prompts
- ✅ `chalk` - Color output
- ✅ `ora` - Spinners
- ✅ `boxen` - Boxed messages
- ➕ `clipboardy` - Clipboard support (NEW, ~50KB)

**Package Size Impact**: +5% (~2.0 MB → ~2.1 MB)

### Risks

| Risk | Mitigation |
| ------ | ------------ |
| Quilt config inference fails | Provide manual input fallback |
| CloudWatch Logs delay events | Set 60s timeout, clear expectations |
| User skips manual steps | Validate in test command, helpful errors |
| Clipboard unavailable | Show URL prominently even if copy fails |

---

## Migration Path

### Backward Compatibility

**All v0.6.x workflows continue to work in v0.7.0**:

```bash
# Secrets-only mode (v0.6.x)
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn ... \
  --benchling-secret ... \
  --yes

# Still works ✓

# Legacy mode (v0.6.x)
npx @quiltdata/benchling-webhook deploy \
  --benchling-secrets @secrets.json \
  --catalog my-catalog.com

# Still works ✓
```

### New Recommended Approach

```bash
# First time
npx @quiltdata/benchling-webhook@latest setup

# Updates
npx @quiltdata/benchling-webhook@latest deploy --update
```

---

## What's Different from Previous Recommendations?

### Previous Recommendation (14-FINAL-RECOMMENDATION.md)

**Promised**: "One command does everything"

**Missed**:
- Benchling app creation MUST be manual
- Webhook URL configuration MUST be manual
- App installation MUST be manual
- No API exists for these steps

**Result**: Would have created a "wizard" that still left users confused about required manual steps

---

### This Recommendation (NPX UX Overhaul)

**Promise**: "We automate what we can, guide you clearly through what must be manual"

**Addresses**:
- ✅ Acknowledges manual steps upfront
- ✅ Provides crystal-clear instructions for each manual step
- ✅ Pauses at the right moments for user action
- ✅ Validates that manual steps were completed (test command)
- ✅ Provides multiple workflow options (guided, granular, scripted)

**Result**: Users understand what to expect, get excellent guidance, and succeed on first try

---

## Next Steps

### Immediate Actions

1. ✅ **Review Specifications** (This document + 15, 16, 17)
2. **Approve Approach** (Hybrid multi-phase model)
3. **Begin Week 1 Implementation**
   - Day 1: Project structure
   - Day 2: Helper modules
   - Day 3-5: Core commands

### Communication

- Share specs with team for feedback
- Demo working features as completed
- Beta test with 3-5 users before release
- Document learnings for future improvements

### Success Indicators

- User feedback: "This was so easy!"
- Support questions drop significantly
- Setup completion rate increases to >90%
- Positive GitHub reactions and comments

---

## Conclusion

This specification provides a **realistic, user-focused approach** to improving the npx experience. By accepting that some steps must be manual and providing excellent guidance for those steps, we create a delightful user experience that sets proper expectations and ensures success.

**The key insight**: Don't promise magic that doesn't exist. Instead, make the manual steps so clear and well-guided that they feel effortless.

---

## Related Documents

- [15-npx-ux-reality-check.md](./15-npx-ux-reality-check.md) - Problem analysis and approach comparison
- [16-npx-ux-implementation-spec.md](./16-npx-ux-implementation-spec.md) - Detailed technical specification
- [17-implementation-checklist.md](./17-implementation-checklist.md) - 3-week implementation roadmap
- [14-FINAL-RECOMMENDATION.md](./14-FINAL-RECOMMENDATION.md) - Previous (incomplete) recommendation
- [13-npx-setup-wizard-implementation.md](./13-npx-setup-wizard-implementation.md) - Original wizard concept

---

**Ready to Build?** 🚀

Let's transform the npx user experience from frustrating to delightful!
