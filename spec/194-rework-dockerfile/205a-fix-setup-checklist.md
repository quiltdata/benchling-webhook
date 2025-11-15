# Fix Setup Flow Implementation Checklist

> Implementation checklist for [205-fix-setup-flow.md](./205-fix-setup-flow.md)

## Status: 🔴 Not Started

NOTE:

Unless explicitly told otherwise:

- Keep all existing rules for defaults
- Honor the '--yes' flag to skip prompts

---

## A. Core Flow Restructuring

### A1. Phase 1: Catalog Discovery & Confirmation

- [ ] Move catalog inference to start of wizard (before line 413 in setup-wizard.ts)
- [ ] Add y/n prompt: "Is `<catalog-dns>` correct?"
- [ ] If no, prompt for manual catalog DNS entry
- [ ] Only proceed to stack query after catalog confirmed

**Files**: `bin/commands/setup-wizard.ts` (lines 412-413)

---

### A2. Phase 2: Stack Query Enhancement

- [ ] Remove duplicate manual stack query (lines 479-517 in setup-wizard.ts)
- [ ] Use `inferQuiltConfig()` results directly for BenchlingSecret detection
- [ ] Extract ALL stack parameters upfront (stackArn, database, queueUrl, region, account, BenchlingSecret)
- [ ] Don't prompt for stack parameters that can be queried

**Files**:

- `bin/commands/setup-wizard.ts` (lines 479-517 - REMOVE)
- `bin/commands/infer-quilt-config.ts` (use existing query results)

---

### A3. Phase 3: Reorder Parameter Collection

- [ ] Move validation (lines 952-994) to run BEFORE deployment decision
- [ ] Keep order: Quilt → Benchling → Package → Deployment → **Validation** → Mode Decision
- [ ] Check for manifest flow: if no app definition ID, shift to manifest creation and EXIT wizard

**Files**: `bin/commands/setup-wizard.ts` (lines 412-994)

---

### A4. Phase 4: Fix Deployment Decision Timing

- [ ] Move deployment mode decision (lines 522-554) to AFTER validation (after line 994)
- [ ] Change prompt to simple y/n: "Use existing BenchlingSecret? (y/n)"
- [ ] Remove complex menu (lines 529-542), use binary confirm prompt

**Files**: `bin/commands/setup-wizard.ts` (lines 522-554 - MOVE)

---

### A5. Phase 4a: Integrated Mode Path

- [ ] If YES to BenchlingSecret usage:
  - [ ] Call `syncSecretsToAWS()` to UPDATE that secret ARN
  - [ ] Save config with `integratedStack: true`
  - [ ] Show success message
  - [ ] **EXIT cleanly** (no deployment prompt, no deployment next steps)

**Files**: `bin/commands/setup-wizard.ts` (new logic after line 994)

---

### A6. Phase 4b: Standalone Mode Path

- [ ] If NO to BenchlingSecret (or no BenchlingSecret exists):
  - [ ] Create/update dedicated secret: `quiltdata/benchling-webhook/<profile>/<tenant>`
  - [ ] Save config with `integratedStack: false`
  - [ ] Add y/n prompt: "Deploy to AWS now?"
  - [ ] If YES: call deploy command
  - [ ] If NO: show manual deploy instructions in next steps

**Files**:

- `bin/commands/setup-wizard.ts` (new logic after line 994)
- `bin/commands/deploy.ts` (import and call if user confirms)

---

## B. Secrets Management

### B7. Make Secrets Sync Mode-Aware

- [ ] Check `config.integratedStack` boolean in addition to `config.benchling.secretArn`
- [ ] Integrated mode: ALWAYS update the stack's BenchlingSecret ARN
- [ ] Standalone mode: Create new secret with pattern `quiltdata/benchling-webhook/<profile>/<tenant>`
- [ ] Don't create standalone secrets in integrated mode

**Files**: `bin/commands/sync-secrets.ts` (lines 358-444)

---

## C. Metadata Cleanup

### C8. Fix Metadata Field

- [ ] Replace `config._metadata.deploymentMode` with `config.integratedStack: boolean`
- [ ] Update all references (lines 666-685, 1035-1056)
- [ ] Ensure field is set correctly before secrets sync
- [ ] Update TypeScript types in `lib/types/config.ts`

**Files**:

- `bin/commands/setup-wizard.ts` (lines 666-685, 1035-1056)
- `lib/types/config.ts` (add `integratedStack?: boolean` field)

---

## D. User Experience Fixes

### D9. Simplify Decision Prompts

- [ ] Replace list menu (lines 529-542) with confirm prompt
- [ ] Remove explanatory messages during flow (show only at end)
- [ ] Use simple y/n questions throughout (except log-level)

**Files**: `bin/commands/setup-wizard.ts` (lines 529-542)

---

### D10. Fix Exit & Next Steps Display

- [ ] Integrated mode: suppress deployment next steps (lines 1050-1056)
- [ ] Integrated mode: show webhook URL retrieval instructions
- [ ] Standalone mode: show deployment command if user declined auto-deploy

**Files**: `bin/commands/setup-wizard.ts` (lines 1028-1057)

---

## E. Testing & Documentation

### E11. Update Tests

- [ ] Test catalog confirmation flow
- [ ] Test integrated mode: secret update only, no deployment
- [ ] Test standalone mode: secret creation + optional deployment
- [ ] Test manifest flow exit (no app ID case)
- [ ] Test validation failure handling

**Files**:

- Create: `spec/194-rework-dockerfile/205-setup-flow.test.ts`
- Or add to existing test suite

---

### E12. Update Documentation

- [ ] Update README with new flow sequence
- [ ] Document integrated vs standalone modes clearly
- [ ] Add troubleshooting for common validation failures
- [ ] Update this spec with implementation notes

**Files**:

- `README.md`
- `spec/194-rework-dockerfile/205-fix-setup-flow.md` (add implementation notes section)

---

## F. Edge Cases & Cleanup

### F13. Handle Edge Cases

- [ ] Existing config with old `deploymentMode` metadata (migration)
- [ ] Stack query failures (fallback to manual entry)
- [ ] Catalog config.json missing or invalid
- [ ] User cancellation at deployment prompt (Ctrl+C handling)

**Files**: `bin/commands/setup-wizard.ts`

---

### F14. Remove Redundant Code

- [ ] Remove duplicate stack query logic (lines 479-517)
- [ ] Remove deployment mode explanatory messages (lines 543-553)
- [ ] Clean up deployment mode conditional logic spread across file

**Files**: `bin/commands/setup-wizard.ts`

---

## Implementation Order

### Phase 1: Core (Critical Path)

**Priority**: 🔴 High
**Items**: A1-A6, C8
**Goal**: Reorder flow, fix decision timing
**Estimate**: 2-3 hours

### Phase 2: Integration (Essential)

**Priority**: 🟡 Medium
**Items**: B7, D10
**Goal**: Secrets sync, exit behavior
**Estimate**: 1-2 hours

### Phase 3: Polish (Important)

**Priority**: 🟢 Low
**Items**: D9, F13, F14
**Goal**: UX improvements, edge cases
**Estimate**: 1-2 hours

### Phase 4: Quality (Required)

**Priority**: 🟢 Low
**Items**: E11, E12
**Goal**: Tests, docs
**Estimate**: 2-3 hours

---

## Scope Estimate

- **Lines Modified**: ~300
- **Lines Removed**: ~50
- **Lines Added**: ~100
- **Files Changed**: 4-5
- **Total Effort**: 6-10 hours

---

## Key Principles Checklist

### ✅ Do

- [ ] Collect ALL parameters upfront
- [ ] Validate everything before making decisions
- [ ] Ask simple yes/no questions
- [ ] Exit cleanly after integrated secret update
- [ ] Query stack for as many parameters as possible

### ❌ Don't

- [ ] ~~Query stack BEFORE verifying catalog name~~
- [ ] ~~Check quilt3.config if the profile already has a different DNS name~~
- [ ] ~~Continue if the user does NOT have an application ID~~
- [ ] ~~Ask about deployment mode before collecting parameters~~
- [ ] ~~Create standalone secrets in integrated mode~~
- [ ] ~~Prompt for deployment in integrated mode~~
- [ ] ~~Ask for parameters that can be queried from the stack~~
- [ ] ~~Show complex menus for binary choices~~

---

## Success Criteria

1. [ ] User enters all parameters once, upfront
2. [ ] Validation happens before any deployment decisions
3. [ ] Integrated mode exits cleanly without creating extra secrets
4. [ ] Standalone mode deploys only when explicitly confirmed
5. [ ] No confusing menus - only simple y/n questions at decision points

---

## Progress Tracking

- **Created**: 2025-11-14
- **Started**: _Not started_
- **Completed**: _Not completed_
- **Reviewed**: _Not reviewed_
- **Deployed**: _Not deployed_
