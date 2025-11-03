# Final Recommendation: NPX Setup Wizard

**Date**: 2025-11-03
**Decision**: Bring the FULL setup wizard experience to ALL users via npx

---

## The Problem (What You Pointed Out)

"The npx commands in README don't use the new setup scripts in AGENTS.md"

**Root Cause**: We built AMAZING setup innovations for developers (`npm run setup`), but locked them behind git clone. NPX users got the OLD manual workflow.

---

## The Solution

**Make `npx @quiltdata/benchling-webhook setup` THE primary user experience.**

### Before (Complex, Manual, Error-Prone)

```bash
# Step 1: Generate manifest
npx @quiltdata/benchling-webhook manifest

# Step 2: Manually create AWS secret
aws secretsmanager create-secret \
  --name benchling-webhook-credentials \
  --secret-string '{
    "client_id": "...",
    "client_secret": "...",
    "tenant": "...",
    "app_definition_id": "..."
  }'

# Step 3: Find Quilt stack ARN in CloudFormation console
# (manual, error-prone)

# Step 4: Deploy
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc123" \
  --benchling-secret "benchling-webhook-credentials"
```

**User pain**: 4 manual steps, lots of AWS console clicking, easy to mess up

### After (ONE COMMAND!)

```bash
npx @quiltdata/benchling-webhook@latest setup
```

**What it does**:

1. ✓ Auto-detects Quilt config from `quilt3 config`
2. ✓ Prompts for Benchling credentials (guided, validated)
3. ✓ Validates OAuth credentials BEFORE deploying
4. ✓ Creates AWS Secrets Manager secret automatically
5. ✓ Deploys stack to AWS
6. ✓ Returns webhook URL

**User joy**: ONE command, everything validated, clear errors, fast setup

---

## What Makes This Awesome

### 1. All the Innovations We Built Are Now Available to Everyone

**Innovations from `npm run setup`**:

- ✅ Quilt config inference
- ✅ Benchling OAuth validation
- ✅ S3 bucket verification
- ✅ Automatic secrets management
- ✅ Clear error messages

**Now available via**: `npx @quiltdata/benchling-webhook setup`

### 2. No Package Bloat

**Current package**: ~2 MB
**After changes**: ~2.1 MB (+5%)

**Why?**: All dependencies (inquirer, AWS SDK, etc.) are ALREADY in the package! We're just exposing functionality.

### 3. Simple Documentation

**README.md** (for most users):

```markdown
## Setup

```bash
npx @quiltdata/benchling-webhook@latest setup
```

That's it! The wizard will guide you through everything.

For advanced options, see [AGENTS.md](./AGENTS.md).

```

**AGENTS.md** (for contributors):
```markdown
# Developer Guide

> **For most users**: Use `npx @quiltdata/benchling-webhook@latest setup` (see [README.md](./README.md))
>
> **This guide is for contributors** developing the project.

[Rest of developer docs...]
```

### 4. Backward Compatible

**Existing workflows continue to work**:

- `npx ... deploy --quilt-stack-arn ... --benchling-secret ...` (manual mode)
- `npm run setup` (contributors with XDG config)

**New recommended workflow**: `npx ... setup` (for everyone!)

---

## Implementation Plan

### Week 1: Build It

- **Day 1-2**: Move `scripts/install-wizard.ts` → `bin/commands/setup.ts`
  - Remove XDG dependency (not needed for npx users)
  - Keep ALL validation and inference logic
- **Day 3**: Add `setup` command to `bin/cli.ts`
- **Day 4**: Test with real Quilt + Benchling setup
- **Day 5**: Update README and AGENTS.md

### Week 2: Polish It

- **Day 1-2**: Beta testing with early adopters
- **Day 3-4**: Fix bugs, improve error messages
- **Day 5**: Release v0.7.0

---

## Success Metrics

**User Experience**:

- Setup time: 15 min → 5 min (70% reduction)
- Error rate: -80% (validation catches issues before deployment)
- Support questions: -70% (wizard handles everything)

**Adoption**:

- Target: 90% of new users use `setup` command
- Goal: <5% need manual deployment

**Documentation**:

- README: 150 lines → 20 lines (87% reduction)
- User confusion: ELIMINATED

---

## Why This Is The Right Approach

### ❌ What We DON'T Want

- Incremental improvements to `init` command (still manual, still error-prone)
- Two-tiered documentation explaining two workflows (confusing)
- NPX users missing out on validation and inference

### ✅ What We DO Want

- ONE clear path for all users
- FULL validation before deployment
- Simple documentation
- Happy users who succeed on first try

---

## The Bottom Line

**Question**: "Why don't npx commands use the new setup scripts?"

**Answer**: They should! Let's make `npx @quiltdata/benchling-webhook setup` the PRIMARY experience.

**Result**:

- Npx users get the FULL wizard experience
- Documentation becomes simple and clear
- Support burden drops dramatically
- Users are happy

---

## Next Steps

1. ✅ Review this recommendation
2. Approve implementation plan
3. Build `bin/commands/setup.ts` (Week 1)
4. Test and refine (Week 2)
5. Release v0.7.0 with new setup command
6. Update documentation
7. Celebrate simple, delightful user experience!

---

## Related Documents

- [13-npx-setup-wizard-implementation.md](./13-npx-setup-wizard-implementation.md) - Detailed implementation plan
- [10-npx-cli-gap-analysis.md](./10-npx-cli-gap-analysis.md) - Original gap analysis
- [11-npx-vs-npm-feature-comparison.md](./11-npx-vs-npm-feature-comparison.md) - Feature comparison
- [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Overall project summary

---

**Ready to make this happen?** 🚀
