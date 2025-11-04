# NPX CLI vs Setup Scripts Gap Analysis

**Issue**: The npx commands in README.md don't align with the comprehensive setup scripts described in AGENTS.md, creating confusion about the proper workflow for npx users.

**Date**: 2025-11-03
**Status**: Analysis Complete

---

## Executive Summary

There's a **significant discrepancy** between:

1. **README.md** - Documentation for `npx` users (minimal, deployment-focused)
2. **AGENTS.md** - Documentation for developers/contributors (comprehensive setup with `npm run setup`)

The npx CLI (`dist/bin/cli.js`) provides a **streamlined deployment workflow** but lacks the **interactive configuration wizard** (`scripts/install-wizard.ts`) that `npm run setup` provides. This creates a confusing user experience where npx users can't access the guided setup workflow.

---

## Key Findings

### 1. Two Distinct User Personas

#### **Persona A: NPX Users (End Users)**

- **Goal**: Deploy webhook to AWS quickly
- **Entry Point**: `npx @quiltdata/benchling-webhook deploy`
- **Documentation**: README.md
- **Available Commands**:
  - `deploy` (default) - Deploy CDK stack
  - `init` - Interactive config generator (creates `.env` file)
  - `validate` - Validate configuration
  - `test` - Test webhook endpoint
  - `manifest` - Generate Benchling app manifest

#### **Persona B: Contributors/Developers**

- **Goal**: Local development, testing, contributing
- **Entry Point**: `npm run setup` → setup wizard
- **Documentation**: AGENTS.md
- **Available Commands**:
  - `npm run setup` - Interactive wizard with XDG config
  - `npm run setup:infer` - Infer Quilt config
  - `npm run setup:sync-secrets` - Sync to AWS Secrets Manager
  - `npm run test` - Unit tests
  - `npm run test:local` - Local integration
  - `npm run deploy:dev` - Deploy dev stack

---

## Gap Analysis

### Gap 1: Setup Wizard Not Available via NPX

**Problem**:

- `npm run setup` runs `ts-node scripts/install-wizard.ts`
- This script is **not compiled** or **exported** via the npx CLI
- NPX users can't access the comprehensive setup wizard

**Why It Matters**:

- The install-wizard provides:
  - Quilt config inference from `quilt3 config`
  - Benchling credential validation (OAuth token test)
  - S3 bucket access verification
  - AWS account verification
  - Automatic secrets sync to AWS Secrets Manager
  - XDG-compliant config storage (`~/.config/benchling-webhook/`)

**Current NPX Alternative**:

- `npx @quiltdata/benchling-webhook init` - Creates `.env` file (legacy mode)
- This is **less sophisticated** than install-wizard:
  - No Quilt config inference
  - No credential validation
  - No automatic secrets sync
  - Uses `.env` files instead of XDG config

### Gap 2: Different Configuration Models

| Feature | NPX Users | Developers |
|---------|-----------|------------|
| Config Storage | `.env` files | XDG config (`~/.config/benchling-webhook/`) |
| Setup Command | `npx ... init` | `npm run setup` |
| Credential Validation | ❌ None | ✅ OAuth validation |
| Quilt Inference | ⚠️ Basic | ✅ Advanced (from `quilt3 config`) |
| S3 Verification | ❌ None | ✅ HeadBucket + ListObjects |
| Secrets Sync | ⚠️ Manual (via `npm run config`) | ✅ Automatic (via wizard) |

### Gap 3: Documentation Confusion

**README.md** (for npx users):

```bash
# Step 1: Generate manifest
npx @quiltdata/benchling-webhook manifest

# Step 2: Create secret in AWS manually
aws secretsmanager create-secret --name ... --secret-string ...

# Step 3: Deploy
npx @quiltdata/benchling-webhook deploy \
  --quilt-stack-arn <arn> \
  --benchling-secret <name>
```

**AGENTS.md** (for developers):

```bash
# One-command setup (interactive wizard)
npm run setup
```

**The Confusion**:

- NPX users reading AGENTS.md think they can run `npm run setup` → **They can't** (it requires the repo)
- Developers reading README.md think npx is all they need → **They miss** the setup wizard features
- Neither document clearly explains when to use which approach

### Gap 4: Missing CLI Command for Setup Wizard

**Current State**:

- `bin/cli.ts` defines these commands:
  - `deploy` (default)
  - `init` - calls `bin/commands/init.ts`
  - `validate`
  - `test`
  - `manifest`

**Missing Command**:

- No `setup` command that runs the install-wizard
- The install-wizard (`scripts/install-wizard.ts`) is only accessible via `npm run setup`

**Why Not Included**:

- Setup wizard uses `ts-node` (TypeScript runtime)
- NPX package only includes compiled `.js` files in `dist/`
- Setup wizard has **development-time dependencies** (inquirer, AWS SDK, XDG config)

---

## Root Cause Analysis

### Why This Happened

1. **Package Structure Decision** (`package.json:7-12`):

   ```json
   "files": [
     "dist/",
     "README.md",
     "LICENSE",
     "env.template"
   ]
   ```

   - Only compiled `dist/` is published
   - `scripts/` directory is **excluded** from npm package
   - Setup wizard can't be accessed via npx

2. **Architectural Split**:
   - **`bin/`** = Production CLI tools (compiled to `dist/bin/`)
   - **`scripts/`** = Development-time setup scripts (run via `ts-node`)
   - This split is **intentional** per AGENTS.md:78-79

3. **Different Use Cases**:
   - **NPX** = Quick deployment for end users
   - **NPM/Git** = Comprehensive setup for contributors

---

## Impact Assessment

### For NPX Users

**Pain Points**:

1. **No guided setup** - Must manually create secrets in AWS
2. **No credential validation** - Deploy might fail late due to bad credentials
3. **No automatic inference** - Must manually find Quilt stack ARN
4. **No XDG config** - Can't use profile-based configuration

**Workarounds**:

- Use `npx ... init` to generate `.env` file (but it's less robust)
- Manually run `aws secretsmanager create-secret` (error-prone)
- Read CloudFormation console to find stack ARN (cumbersome)

### For Contributors

**Pain Points**:

1. **Documentation mismatch** - AGENTS.md shows advanced features not in README
2. **Unclear boundaries** - When to use npx vs npm commands?
3. **Duplication** - `bin/commands/init.ts` vs `scripts/install-wizard.ts` (similar but different)

---

## Recommendations

### Option 1: Export Setup Wizard via NPX (Comprehensive)

**Approach**: Compile and include setup wizard in npx package

**Changes Required**:

1. Move `scripts/install-wizard.ts` to `bin/commands/setup.ts`
2. Add `setup` command to `bin/cli.ts`
3. Update `package.json` to include setup dependencies
4. Update README to document `npx ... setup`

**Pros**:

- ✅ NPX users get full setup wizard
- ✅ Single source of truth for setup
- ✅ Better user experience

**Cons**:

- ❌ Increases package size (adds inquirer, AWS SDK, etc.)
- ❌ Blurs line between "end user tool" and "dev tool"
- ❌ More complex CLI maintenance

### Option 2: Enhance `init` Command (Incremental)

**Approach**: Improve existing `bin/commands/init.ts` with wizard features

**Changes Required**:

1. Add Quilt config inference to `init` command
2. Add credential validation to `init` command
3. Add automatic secrets sync to `init` command
4. Keep XDG config as dev-only feature

**Pros**:

- ✅ Improves NPX user experience
- ✅ No package bloat
- ✅ Maintains clear separation

**Cons**:

- ⚠️ Still have two setup implementations
- ⚠️ NPX users still use `.env` files
- ⚠️ Partial parity with setup wizard

### Option 3: Document the Distinction (Minimal)

**Approach**: Update README and AGENTS.md to clarify the two workflows

**Changes Required**:

1. Add "User Personas" section to README
2. Clarify when to use npx vs npm commands
3. Document `init` command limitations
4. Add migration path (npx → git clone → npm setup)

**Pros**:

- ✅ No code changes needed
- ✅ Quick to implement
- ✅ Maintains current architecture

**Cons**:

- ❌ Doesn't solve the UX gap
- ❌ NPX users still miss wizard features
- ❌ Two-tiered user experience

### Option 4: Hybrid Approach (Recommended)

**Approach**: Enhance `init` + improve documentation

**Phase 1: Quick Wins (Documentation)**

1. Add "NPX Users vs Contributors" section to README
2. Document `init` command with examples
3. Add troubleshooting guide for npx users
4. Cross-reference AGENTS.md for developers

**Phase 2: Incremental Improvements (Code)**

1. Add `--infer` flag to `init` command (Quilt config inference)
2. Add `--validate` flag to `init` command (credential validation)
3. Add `--sync-secrets` flag to `init` command (AWS Secrets Manager sync)
4. Keep setup wizard as dev-only (full XDG workflow)

**Phase 3: Future Enhancement (Optional)**

1. Consider publishing separate `@quiltdata/benchling-webhook-dev` package with setup wizard
2. Or add `npx @quiltdata/benchling-webhook setup --dev` for advanced users

**Pros**:

- ✅ Improves NPX user experience gradually
- ✅ Maintains clean architecture
- ✅ Doesn't bloat package immediately
- ✅ Clear migration path

**Cons**:

- ⚠️ Requires ongoing maintenance of both implementations

---

## Implementation Priorities

### Priority 1: Documentation Fixes (Immediate)

**File**: `README.md`

**Add Section**:

```markdown
## User Guide: NPX vs Development Setup

### For End Users (NPX Workflow)
You want to quickly deploy the webhook to AWS without cloning the repository.

**Requirements**:
- Node.js 18+ with npx
- AWS credentials configured
- Existing Quilt stack ARN

**Workflow**:
1. `npx @quiltdata/benchling-webhook manifest` - Generate Benchling app manifest
2. Create Benchling app in Benchling console
3. Create AWS secret: `aws secretsmanager create-secret ...`
4. `npx @quiltdata/benchling-webhook deploy --quilt-stack-arn <arn>`

**Limitations**:
- No interactive setup wizard
- No automatic credential validation
- No XDG config (uses `.env` files if needed)

### For Contributors (Development Workflow)
You want to contribute, test locally, or use advanced features.

**Requirements**:
- Git repository cloned
- Node.js 18+ and Python 3.x
- Docker for local testing

**Workflow**:
1. `git clone https://github.com/quiltdata/benchling-webhook.git`
2. `cd benchling-webhook`
3. `npm run setup` - Interactive configuration wizard
4. `npm run test` - Run tests
5. See AGENTS.md for full development guide

**Advantages**:
- ✅ Interactive setup wizard with validation
- ✅ Automatic Quilt config inference
- ✅ XDG-compliant configuration storage
- ✅ Local integration testing
- ✅ Full development toolkit
```

### Priority 2: Enhance `init` Command (Short Term)

**File**: `bin/commands/init.ts`

**Enhancements**:

1. Add `--infer` flag to detect Quilt catalog from `quilt3 config`
2. Add `--validate` flag to test Benchling credentials
3. Add `--sync-secrets` flag to push to AWS Secrets Manager
4. Add `--profile` flag for AWS profile selection

**Example Usage**:

```bash
# Basic init (current behavior)
npx @quiltdata/benchling-webhook init

# Enhanced init with inference and validation
npx @quiltdata/benchling-webhook init --infer --validate --sync-secrets
```

### Priority 3: CLI Help Improvements (Short Term)

**File**: `bin/cli.ts`

**Enhancements**:

1. Add detailed help text for `init` command
2. Add examples for common workflows
3. Add troubleshooting tips
4. Add link to AGENTS.md for advanced users

---

## Testing Strategy

### Test Cases for Enhanced Init Command

1. **TC-1: Basic Init**
   - Run `npx ... init` without flags
   - Verify `.env` file created with prompts

2. **TC-2: Init with Inference**
   - Run `npx ... init --infer`
   - Verify Quilt config detected from `quilt3 config`
   - Verify stack ARN detected from CloudFormation

3. **TC-3: Init with Validation**
   - Run `npx ... init --validate`
   - Verify Benchling OAuth credentials tested
   - Verify error handling for invalid credentials

4. **TC-4: Init with Secrets Sync**
   - Run `npx ... init --sync-secrets`
   - Verify secret created in AWS Secrets Manager
   - Verify secret ARN returned

5. **TC-5: Full Workflow**
   - Run `npx ... init --infer --validate --sync-secrets`
   - Run `npx ... deploy --quilt-stack-arn <arn>`
   - Verify successful deployment

---

## Conclusion

The **root cause** is an **architectural decision** to separate:

- **Production CLI** (npx, compiled, minimal) from
- **Development Tools** (npm scripts, TypeScript, comprehensive)

This separation is **intentional and reasonable**, but the **documentation doesn't clearly communicate** the distinction, leading to confusion.

**Recommended Action**: **Option 4 (Hybrid Approach)**

1. Immediate: Fix documentation to clarify the two workflows
2. Short-term: Enhance `init` command with flags for inference and validation
3. Long-term: Consider unified setup experience or separate dev package

**Next Steps**:

1. Review this analysis with team
2. Prioritize documentation fixes
3. Scope enhancement work for `init` command
4. Update README.md and AGENTS.md accordingly
