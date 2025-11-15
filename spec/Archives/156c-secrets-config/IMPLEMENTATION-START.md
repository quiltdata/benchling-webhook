# NPX UX Implementation - START HERE

**Date**: 2025-11-03
**Branch**: `npx-ux`
**Target**: v0.7.0
**Status**: ✅ Ready to Implement

---

## Quick Summary

Build a **simple guided setup wizard** that makes Benchling webhook deployment effortless for end users.

**One Command**:

```bash
npx @quiltdata/benchling-webhook
```

That's it. The wizard guides them through everything.

---

## What to Read

### 1. Start Here: [18-CORRECTED-npx-ux-spec.md](./18-CORRECTED-npx-ux-spec.md)

**Why**: This has the CORRECT implementation details.

**Key Points**:

- Use `quilt3 config` CLI (NOT YAML file)
- Default behavior = run setup wizard
- README = ultra-simple (end users only)
- See corrected helper module code

### 2. Context: [15-npx-ux-reality-check.md](./15-npx-ux-reality-check.md)

**Why**: Understand what CAN vs CANNOT be automated

**Key Insight**: Benchling has NO API for manifest upload, app creation, or webhook config. These MUST be manual steps with clear guidance.

### 3. Checklist: [17-implementation-checklist.md](./17-implementation-checklist.md)

**Why**: 3-week roadmap with daily tasks

**Apply Doc 18 corrections** when implementing Day 2 helpers.

---

## Implementation Priority

### Week 1: Core (Days 1-5)

Build the foundation:

1. **Day 1**: Project structure
   - Create `bin/commands/helpers/` directory
   - Add `clipboardy` dependency

2. **Day 2**: Helper modules (CRITICAL - use Doc 18 corrections)
   - `infer-quilt.ts` - Use `execSync('quilt3 config')`
   - `validate-benchling.ts` - OAuth validation
   - `webhook-test.ts` - CloudWatch event detection

3. **Day 3**: CLI entry point
   - Default action = setup wizard
   - Individual commands for internal use

4. **Day 4-5**: Setup command
   - Phase 1: Generate manifest + pause
   - Phase 2: Deploy to AWS
   - Phase 3: Configure webhook + pause
   - Phase 4: Test integration

### Week 2: Polish (Days 1-5)

Make it beautiful:

- Manual step UX (clear boxed instructions)
- State persistence (pause/resume)
- Event detection in test phase
- Logs command for debugging
- Config save option

### Week 3: Ship (Days 1-5)

Get it out the door:

- Integration testing
- Documentation (ultra-simple README)
- Beta testing (3-5 users)
- Release v0.7.0

---

## Critical Implementation Notes

### ✅ DO

1. **Use `quilt3 config` CLI**

   ```typescript
   const catalogUrl = execSync("quilt3 config", { encoding: "utf-8" }).trim();
   ```

2. **Default behavior = setup**

   ```typescript
   program.action(async () => {
       await setupCommand({});
   });
   ```

3. **Ultra-simple README**
   - Only document: `npx @quiltdata/benchling-webhook`
   - No power user docs
   - No CI/CD workflows
   - Advanced → CLAUDE.md

4. **Clear manual step instructions**
   - Boxed with yellow border
   - Step-by-step with URLs
   - Confirm before continuing

### ❌ DON'T

1. **Don't read `~/.quilt3/config.yml`** (doesn't exist)
2. **Don't document power user commands in README** (goes in CLAUDE.md)
3. **Don't promise automation that's impossible** (be honest about manual steps)
4. **Don't skip credential validation** (test OAuth before deploying)

---

## Success Criteria

### User Experience

- ✅ User runs ONE command
- ✅ Clear guidance at each manual step
- ✅ Validation catches errors before deployment
- ✅ Webhook tested automatically
- ✅ Setup completes in 10-15 minutes

### Technical

- ✅ Quilt config detection via CLI works
- ✅ Credential validation prevents bad deployments
- ✅ Event detection verifies webhook works
- ✅ State persistence allows pause/resume
- ✅ All tests pass

### Adoption

- ✅ >90% setup completion rate
- ✅ Support questions drop 70%
- ✅ Positive user feedback

---

## Example User Flow

```bash
$ npx @quiltdata/benchling-webhook

🚀 Benchling Webhook Setup

This wizard will guide you through the complete setup.

═══ PHASE 1: Create Benchling App ═══

✓ Generated app-manifest.yaml

┌─────────────────────────────────────────────────┐
│ ⚠️  MANUAL STEP REQUIRED                        │
│                                                 │
│ Upload Manifest to Benchling                   │
│                                                 │
│ 1. Go to your Benchling tenant:                │
│    → Settings → Developer Console → Apps       │
│ ...                                             │
└─────────────────────────────────────────────────┘

Have you completed these steps? (y/n): y

═══ PHASE 2: Deploy to AWS ═══

🔍 Detecting Quilt configuration...
✓ Found Quilt stack: QuiltStack
  Catalog: my-catalog.quiltdata.com
  Region: us-east-1
  Bucket: my-quilt-bucket

📝 Enter Benchling Credentials

Benchling tenant: acme
OAuth Client ID: client_abc123
OAuth Client Secret: ••••••••
App Definition ID: app_def_xyz789

🔐 Validating credentials...
✓ Credentials validated ✓

💾 Creating AWS secret: benchling-webhook-acme
✓ Secret created

🚢 Deploying to AWS...
✓ Stack deployed

✅ Deployment Complete!

Your webhook URL:
  https://abc123.execute-api.us-east-1.amazonaws.com/webhook

(Copied to clipboard)

═══ PHASE 3: Configure Webhook in Benchling ═══

┌─────────────────────────────────────────────────┐
│ ⚠️  MANUAL STEP REQUIRED                        │
│                                                 │
│ Configure Webhook URL                          │
│                                                 │
│ 1. Go to: https://acme.benchling.com/...      │
│ 2. Paste webhook URL                           │
│ ...                                             │
└─────────────────────────────────────────────────┘

Have you completed these steps? (y/n): y

═══ PHASE 4: Test Integration ═══

┌─────────────────────────────────────────────────┐
│ Let's verify the webhook is working!           │
│                                                 │
│ In Benchling:                                   │
│ 1. Open or create a notebook entry             │
│ 2. Insert Canvas → 'Quilt Integration'         │
│ 3. Interact with the canvas                    │
└─────────────────────────────────────────────────┘

Press ENTER when ready...

🔍 Waiting for webhook events...
✓ Event received! ✓
  Type: v2.canvas.userInteracted
  Entry: EXP-123

═══ 🎉 Setup Complete! ═══

┌─────────────────────────────────────────────────┐
│ Your Benchling webhook is ready!               │
│                                                 │
│ Webhook URL: https://abc123...                 │
│ AWS Secret: benchling-webhook-acme             │
│                                                 │
│ Next steps:                                     │
│ • Use Quilt canvas in your entries             │
│ • View logs: npx ... logs                      │
└─────────────────────────────────────────────────┘
```

---

## Testing Plan

### Unit Tests

```bash
npm run test:ts
```

- `infer-quilt.test.ts` - Test CLI execution and CloudFormation lookup
- `validate-benchling.test.ts` - Test OAuth validation
- `webhook-test.test.ts` - Test event detection

### Integration Tests

```bash
npm run test:local
```

- Full setup flow with real AWS
- Real Benchling credentials (test tenant)
- Verify event detection works

### User Testing

- 3-5 beta testers
- Fresh Benchling + Quilt setup
- Collect feedback on:
  - Clarity of instructions
  - Error messages
  - Time to complete
  - Pain points

---

## Release Checklist

- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] Documentation updated (README ultra-simple)
- [ ] Beta testing complete (3-5 users)
- [ ] No critical bugs
- [ ] CHANGELOG.md updated
- [ ] Version bumped to v0.7.0
- [ ] Git tag created
- [ ] Published to npm
- [ ] GitHub release created

---

## Questions During Implementation?

**Refer to**:

1. [18-CORRECTED-npx-ux-spec.md](./18-CORRECTED-npx-ux-spec.md) - Code examples
2. [15-npx-ux-reality-check.md](./15-npx-ux-reality-check.md) - Reasoning
3. [17-implementation-checklist.md](./17-implementation-checklist.md) - Tasks

**Key Principle**: Make it simple. One command. Clear guidance. Validate early. Test automatically.

---

## Let's Build This! 🚀

The specs are solid. The approach is validated. Time to make npx users' lives better.

**Start with Week 1, Day 1** and follow the checklist.

Good luck! 🎉
