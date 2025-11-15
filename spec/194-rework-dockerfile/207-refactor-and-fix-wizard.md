# Refactor and Fix Setup Wizard - Modular Architecture

**Date**: 2025-11-14
**Priority**: 🔴 CRITICAL
**Status**: 🔴 Not Started

---

## Problem Summary

The setup wizard has critical bugs AND is difficult to test because it's one monolithic function. We need to:

1. **Fix the bugs** (from 206-fix-setup-flow-bugs.md)
2. **Refactor into testable modules** to ensure correct flow
3. **Add comprehensive tests** to prevent regressions

---

## Required Architecture: Modular Wizard

### Phase-Based Modules

Each phase of the wizard should be a separate, testable module:

```
lib/wizard/
├── phase1-catalog-discovery.ts   - Detect and confirm catalog
├── phase2-stack-query.ts          - Query CloudFormation stack
├── phase3-parameter-collection.ts - Collect user inputs
├── phase4-validation.ts           - Validate all parameters
├── phase5-mode-decision.ts        - Choose integrated vs standalone
├── phase6-integrated-mode.ts      - Handle integrated mode path
├── phase7-standalone-mode.ts      - Handle standalone mode path
└── types.ts                       - Shared types for wizard flow
```

### Benefits of Modular Architecture

1. **Testable**: Each phase can be unit tested independently
2. **Clear Flow**: Explicit order enforced by module imports
3. **Maintainable**: Easy to find and fix bugs in specific phases
4. **Type-Safe**: TypeScript ensures data flows correctly between phases
5. **Debuggable**: Can log state between phases

---

## Phase 1: Catalog Discovery Module

**File**: `lib/wizard/phase1-catalog-discovery.ts`

### Responsibilities

1. Read quilt3 CLI config (don't query AWS yet)
2. Ask user to confirm detected catalog
3. If not confirmed, prompt for manual entry
4. Return confirmed catalog DNS

### Interface

```typescript
export interface CatalogDiscoveryResult {
  catalogDns: string;
  wasManuallyEntered: boolean;
  detectedCatalog?: string;
}

export async function runCatalogDiscovery(options: {
  yes?: boolean;
  catalogUrl?: string; // From CLI args
}): Promise<CatalogDiscoveryResult>
```

### Implementation Requirements

- ✅ Must NOT query AWS CloudFormation
- ✅ Must only read local quilt3 config
- ✅ Must ask for confirmation BEFORE any AWS operations
- ✅ Must handle --yes flag (use detected or provided catalog)
- ✅ Must validate catalog DNS format

### Test Cases

```typescript
describe('Phase 1: Catalog Discovery', () => {
  test('detects catalog from quilt3 config');
  test('asks user to confirm detected catalog');
  test('prompts for manual entry when user declines');
  test('validates catalog DNS format');
  test('respects --yes flag');
  test('uses catalogUrl from CLI args if provided');
});
```

---

## Phase 2: Stack Query Module

**File**: `lib/wizard/phase2-stack-query.ts`

### Responsibilities

1. Query CloudFormation stack for the confirmed catalog
2. Extract ALL available parameters from stack
3. Handle stack query failures gracefully
4. Return stack configuration

### Interface

```typescript
export interface StackQueryResult {
  stackArn: string;
  catalog: string;
  database: string;
  queueUrl: string;
  region: string;
  account: string;
  BenchlingSecret?: string; // May not exist
  stackQuerySucceeded: boolean;
}

export async function runStackQuery(
  catalogDns: string
): Promise<StackQueryResult>
```

### Implementation Requirements

- ✅ Must call inferQuiltConfig(catalogDns)
- ✅ Must extract BenchlingSecret output from stack
- ✅ Must handle missing stack gracefully
- ✅ Must return partial data on failure
- ✅ Must validate extracted data

### Test Cases

```typescript
describe('Phase 2: Stack Query', () => {
  test('queries stack for given catalog');
  test('extracts all parameters from stack');
  test('finds BenchlingSecret output when it exists');
  test('handles missing BenchlingSecret gracefully');
  test('handles stack query failures');
  test('validates stack ARN format');
});
```

---

## Phase 3: Parameter Collection Module

**File**: `lib/wizard/phase3-parameter-collection.ts`

### Responsibilities

1. Collect Benchling credentials
2. Collect package settings
3. Collect deployment configuration
4. Use stack query results as defaults (don't re-prompt)
5. Return complete configuration

### Interface

```typescript
export interface ParameterCollectionInput {
  stackQuery: StackQueryResult;
  yes?: boolean;
  // CLI args that override prompts
  benchlingTenant?: string;
  benchlingClientId?: string;
  benchlingClientSecret?: string;
  benchlingAppDefinitionId?: string;
  userBucket?: string;
  // ... other CLI overrides
}

export interface ParameterCollectionResult {
  benchling: {
    tenant: string;
    clientId: string;
    clientSecret: string;
    appDefinitionId: string;
    testEntryId?: string;
  };
  packages: {
    bucket: string;
    prefix: string;
    metadataKey: string;
  };
  deployment: {
    region: string;
    account: string;
  };
  logging: {
    level: string;
  };
  security: {
    enableVerification: boolean;
    webhookAllowList: string;
  };
}

export async function runParameterCollection(
  input: ParameterCollectionInput
): Promise<ParameterCollectionResult>
```

### Implementation Requirements

- ✅ Must NOT prompt for parameters already in stackQuery
- ✅ Must handle --yes flag with defaults
- ✅ Must handle CLI arg overrides
- ✅ Must validate all inputs
- ✅ Must NOT query AWS (all AWS data comes from stackQuery)

### Test Cases

```typescript
describe('Phase 3: Parameter Collection', () => {
  test('prompts for missing parameters');
  test('does not prompt for parameters from stack query');
  test('respects --yes flag with defaults');
  test('respects CLI arg overrides');
  test('validates all parameters');
  test('handles optional parameters');
});
```

---

## Phase 4: Validation Module

**File**: `lib/wizard/phase4-validation.ts`

### Responsibilities

1. Validate Benchling credentials (OAuth test)
2. Validate S3 bucket access
3. Validate app definition ID exists
4. Return validation result with errors

### Interface

```typescript
export interface ValidationInput {
  stackQuery: StackQueryResult;
  parameters: ParameterCollectionResult;
}

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  shouldExitForManifest: boolean; // True if no app ID
}

export async function runValidation(
  input: ValidationInput
): Promise<ValidationResult>
```

### Implementation Requirements

- ✅ Must validate BEFORE mode decision
- ✅ Must exit for manifest flow if no app ID
- ✅ Must test OAuth credentials with Benchling API
- ✅ Must test S3 bucket access
- ✅ Must collect all errors before returning

### Test Cases

```typescript
describe('Phase 4: Validation', () => {
  test('validates Benchling OAuth credentials');
  test('validates S3 bucket access');
  test('detects missing app definition ID');
  test('triggers manifest flow when no app ID');
  test('collects multiple validation errors');
  test('returns warnings for non-critical issues');
});
```

---

## Phase 5: Mode Decision Module

**File**: `lib/wizard/phase5-mode-decision.ts`

### Responsibilities

1. Determine if integrated mode is available
2. Ask user to choose mode (if applicable)
3. Return mode decision

### Interface

```typescript
export interface ModeDecisionInput {
  stackQuery: StackQueryResult;
  yes?: boolean;
}

export interface ModeDecisionResult {
  mode: 'integrated' | 'standalone';
  benchlingSecretArn?: string; // For integrated mode
}

export async function runModeDecision(
  input: ModeDecisionInput
): Promise<ModeDecisionResult>
```

### Implementation Requirements

- ✅ If BenchlingSecret exists, ask user
- ✅ If no BenchlingSecret, use standalone automatically
- ✅ Must handle --yes flag (default to integrated if available)
- ✅ Must be simple y/n prompt (not menu)

### Test Cases

```typescript
describe('Phase 5: Mode Decision', () => {
  test('asks user when BenchlingSecret exists');
  test('uses standalone automatically when no secret');
  test('respects --yes flag');
  test('returns integrated mode when user chooses it');
  test('returns standalone mode when user declines');
});
```

---

## Phase 6: Integrated Mode Module

**File**: `lib/wizard/phase6-integrated-mode.ts`

### Responsibilities

1. Build complete configuration
2. Save config with integratedStack: true
3. Update BenchlingSecret ARN
4. Show success message
5. Return (NO deployment)

### Interface

```typescript
export interface IntegratedModeInput {
  profile: string;
  catalogDns: string;
  stackQuery: StackQueryResult;
  parameters: ParameterCollectionResult;
  benchlingSecretArn: string;
  configStorage: ConfigStorage;
}

export interface IntegratedModeResult {
  success: boolean;
  configPath: string;
  secretArn: string;
}

export async function runIntegratedMode(
  input: IntegratedModeInput
): Promise<IntegratedModeResult>
```

### Implementation Requirements

- ✅ Must save config with integratedStack: true
- ✅ Must call syncSecretsToAWS with integrated mode
- ✅ Must show success message
- ✅ Must show webhook URL retrieval instructions
- ✅ Must NOT prompt for deployment
- ✅ Must NOT call deploy

### Test Cases

```typescript
describe('Phase 6: Integrated Mode', () => {
  test('saves config with integratedStack: true');
  test('updates BenchlingSecret ARN');
  test('shows success message');
  test('shows webhook URL instructions');
  test('does not prompt for deployment');
  test('does not call deploy command');
});
```

---

## Phase 7: Standalone Mode Module

**File**: `lib/wizard/phase7-standalone-mode.ts`

### Responsibilities

1. Build complete configuration
2. Save config with integratedStack: false
3. Create new secret with pattern
4. Ask about deployment
5. Deploy if user confirms
6. Show next steps

### Interface

```typescript
export interface StandaloneModeInput {
  profile: string;
  catalogDns: string;
  stackQuery: StackQueryResult;
  parameters: ParameterCollectionResult;
  configStorage: ConfigStorage;
  yes?: boolean;
  setupOnly?: boolean;
}

export interface StandaloneModeResult {
  success: boolean;
  configPath: string;
  secretArn: string;
  deployed: boolean;
}

export async function runStandaloneMode(
  input: StandaloneModeInput
): Promise<StandaloneModeResult>
```

### Implementation Requirements

- ✅ Must save config with integratedStack: false
- ✅ Must create secret: quiltdata/benchling-webhook/<profile>/<tenant>
- ✅ Must ask "Deploy to AWS now?"
- ✅ Must call deploy if user confirms
- ✅ Must handle --setup-only flag (skip deployment)
- ✅ Must show manual deployment instructions if declined

### Test Cases

```typescript
describe('Phase 7: Standalone Mode', () => {
  test('saves config with integratedStack: false');
  test('creates dedicated secret');
  test('prompts for deployment');
  test('deploys when user confirms');
  test('shows manual instructions when user declines');
  test('respects --setup-only flag');
  test('respects --yes flag');
});
```

---

## Main Setup Wizard Orchestrator

**File**: `bin/commands/setup-wizard.ts` (refactored)

### New Structure

```typescript
import { runCatalogDiscovery } from '../../lib/wizard/phase1-catalog-discovery';
import { runStackQuery } from '../../lib/wizard/phase2-stack-query';
import { runParameterCollection } from '../../lib/wizard/phase3-parameter-collection';
import { runValidation } from '../../lib/wizard/phase4-validation';
import { runModeDecision } from '../../lib/wizard/phase5-mode-decision';
import { runIntegratedMode } from '../../lib/wizard/phase6-integrated-mode';
import { runStandaloneMode } from '../../lib/wizard/phase7-standalone-mode';

export async function runSetupWizard(options: SetupWizardOptions): Promise<void> {
  // Show header
  console.log('Benchling Webhook Setup');

  // Phase 1: Catalog Discovery
  const catalogResult = await runCatalogDiscovery({
    yes: options.yes,
    catalogUrl: options.catalogUrl,
  });

  // Phase 2: Stack Query
  const stackQuery = await runStackQuery(catalogResult.catalogDns);

  // Phase 3: Parameter Collection
  const parameters = await runParameterCollection({
    stackQuery,
    yes: options.yes,
    // ... pass CLI args
  });

  // Phase 4: Validation
  const validation = await runValidation({
    stackQuery,
    parameters,
  });

  if (!validation.success) {
    if (validation.shouldExitForManifest) {
      console.log('Exiting to manifest creation flow...');
      return;
    }
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }

  // Phase 5: Mode Decision
  const modeDecision = await runModeDecision({
    stackQuery,
    yes: options.yes,
  });

  // Phase 6 or 7: Execute mode-specific path
  if (modeDecision.mode === 'integrated') {
    // Phase 6: Integrated Mode
    await runIntegratedMode({
      profile: options.profile,
      catalogDns: catalogResult.catalogDns,
      stackQuery,
      parameters,
      benchlingSecretArn: modeDecision.benchlingSecretArn!,
      configStorage: options.configStorage,
    });
    // Exit - no deployment
    return;
  } else {
    // Phase 7: Standalone Mode
    await runStandaloneMode({
      profile: options.profile,
      catalogDns: catalogResult.catalogDns,
      stackQuery,
      parameters,
      configStorage: options.configStorage,
      yes: options.yes,
      setupOnly: options.setupOnly,
    });
    // Exit
    return;
  }
}
```

### Benefits

- ✅ Clear, linear flow
- ✅ Each phase is isolated and testable
- ✅ Type-safe data flow between phases
- ✅ Easy to debug (log between phases)
- ✅ Integrated mode explicitly returns (can't fall through)
- ✅ Impossible to skip phases or execute out of order

---

## Testing Strategy

### Unit Tests for Each Phase

Each phase module has its own test file:

```
test/wizard/
├── phase1-catalog-discovery.test.ts
├── phase2-stack-query.test.ts
├── phase3-parameter-collection.test.ts
├── phase4-validation.test.ts
├── phase5-mode-decision.test.ts
├── phase6-integrated-mode.test.ts
└── phase7-standalone-mode.test.ts
```

### Integration Tests

Test the complete flow with mocked AWS:

```
test/wizard/
└── integration.test.ts
```

Test scenarios:
1. Integrated mode: wrong catalog → correct → confirm → update secret → exit
2. Standalone mode: no secret → create → deploy
3. Standalone mode: no secret → create → skip deploy
4. Edge cases: validation failures, stack query failures

---

## Implementation Order

### Step 1: Create Phase Modules (Without Tests)

1. Create `lib/wizard/types.ts` - Shared types
2. Create `lib/wizard/phase1-catalog-discovery.ts`
3. Create `lib/wizard/phase2-stack-query.ts`
4. Create `lib/wizard/phase3-parameter-collection.ts`
5. Create `lib/wizard/phase4-validation.ts`
6. Create `lib/wizard/phase5-mode-decision.ts`
7. Create `lib/wizard/phase6-integrated-mode.ts`
8. Create `lib/wizard/phase7-standalone-mode.ts`

### Step 2: Refactor setup-wizard.ts

1. Import all phase modules
2. Replace monolithic function with phase orchestration
3. Ensure clean exits in both modes

### Step 3: Verify Build

1. Run `npm run build`
2. Fix any TypeScript errors

### Step 4: Create Unit Tests

1. Create test file for each phase
2. Test each phase in isolation
3. Ensure 100% coverage of phase logic

### Step 5: Create Integration Tests

1. Test complete flow scenarios
2. Test with mocked AWS services
3. Verify correct flow execution

### Step 6: Manual Testing

1. Test integrated mode with real AWS
2. Test standalone mode with real AWS
3. Verify bugs are fixed

---

## Success Criteria

### Code Quality

- ✅ Each phase is < 150 lines
- ✅ Each phase has single responsibility
- ✅ All phases have comprehensive unit tests
- ✅ Integration tests cover all scenarios
- ✅ TypeScript compilation succeeds
- ✅ No linter errors

### Functional Requirements

- ✅ Catalog confirmation happens BEFORE stack query
- ✅ Only ONE catalog prompt
- ✅ Manual catalog entry triggers stack re-query
- ✅ Correct BenchlingSecret ARN is found
- ✅ Integrated mode exits cleanly (no deployment prompt)
- ✅ Standalone mode prompts for deployment

### Test Coverage

- ✅ Each phase has unit tests
- ✅ Integration tests cover all flows
- ✅ All test cases pass
- ✅ Manual testing confirms bugs are fixed

---

## Acceptance Test

Run this exact test case and verify it works correctly:

```bash
npm run setup -- --profile bench

# Expected flow:
# 1. Detects: nightly.quilttest.com
# 2. Asks: "Is nightly.quilttest.com the correct catalog?"
# 3. User says: NO
# 4. Prompts: "Enter catalog DNS name:"
# 5. User enters: bench.dev.quilttest.com
# 6. Queries stack for bench.dev.quilttest.com
# 7. Finds BenchlingSecret: arn:aws:secretsmanager:us-east-2:712023778557:secret:BenchlingSecret-gOM1ChBg4MK4-SWOYDs
# 8. Collects remaining parameters
# 9. Validates everything
# 10. Asks: "Use existing BenchlingSecret from Quilt stack?"
# 11. User says: YES
# 12. Updates BenchlingSecret ARN
# 13. Saves config with integratedStack: true
# 14. Shows success message
# 15. EXITS - NO deployment prompt
```

---

## Notes

- This is a COMPLETE refactoring - not just bug fixes
- The modular architecture ensures bugs can't happen
- Each phase is independently testable
- The flow is enforced by code structure, not just comments
- TypeScript ensures data flows correctly
- Manual testing is required before declaring success
