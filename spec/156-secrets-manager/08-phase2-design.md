# Phase 2 Design: CLI Parameter Addition

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-31
**Phase**: DECO - Design (Phase 2)

## Overview

This design document specifies the technical architecture for **Phase 2: CLI Parameter Addition** as defined in [04-phases.md](./04-phases.md). This phase adds the `--benchling-secrets` CLI option and `BENCHLING_SECRETS` environment variable support while maintaining full backward compatibility with existing individual secret parameters.

**Phase 1 Prerequisite**: This phase depends on Phase 1's validation framework (implemented in `lib/utils/secrets.ts`).

## Design Objectives

1. **Add CLI Parameter**: Introduce `--benchling-secrets` option accepting ARN or JSON
2. **Add Environment Variable**: Support `BENCHLING_SECRETS` environment variable
3. **File Input Support**: Enable `@filename` syntax for JSON file input
4. **Backward Compatibility**: Maintain existing individual secret parameters
5. **Priority Resolution**: Define clear precedence when multiple sources present
6. **Pre-Deployment Validation**: Validate secrets before CDK deployment
7. **User Communication**: Provide deprecation warnings and migration guidance

## Technical Architecture

### 1. CLI Parameter Definition

**Location**: `/Users/ernest/GitHub/benchling-webhook/bin/cli.ts`

**Implementation Strategy**:

Add new option to the deploy command using commander.js pattern:

```typescript
.option("--benchling-secrets <value>", "Benchling secrets (ARN or JSON, supports @file.json)")
```

**Positioning**: Add after existing Benchling-related options (line ~31) to group related parameters together.

**Type**: String parameter accepting:
- ARN: `arn:aws:secretsmanager:region:account:secret:name`
- JSON inline: `{"client_id":"...","client_secret":"...","tenant":"..."}`
- JSON file: `@secrets.json` (@ prefix indicates file path)

### 2. Configuration System Integration

**Location**: `/Users/ernest/GitHub/benchling-webhook/lib/utils/config.ts`

#### 2.1 Interface Updates

**Modify `ConfigOptions` interface** (lines 41-53):

```typescript
export interface ConfigOptions {
  envFile?: string;
  catalog?: string;
  bucket?: string;
  tenant?: string;
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  profile?: string;
  region?: string;
  imageTag?: string;
  benchlingSecrets?: string;  // Add this line
}
```

**Note**: `Config` interface already includes `benchlingSecrets?: string` (line 20), so no change needed there.

#### 2.2 Configuration Loading Logic

**Modify `loadConfigSync` function** (lines 120-170):

The function already supports `benchlingSecrets` loading with correct priority:
```typescript
// Unified secrets (priority: CLI > env > .env)
benchlingSecrets: options.benchlingSecrets || envVars.BENCHLING_SECRETS,
```

**No changes needed** - this already implements the correct priority chain.

#### 2.3 File Input Processing

**Add new function** after `loadDotenv` (after line 110):

```typescript
/**
 * Process benchling-secrets parameter, handling @file.json syntax
 *
 * @param input - The benchling-secrets value (ARN, JSON, or @filepath)
 * @returns Processed secret string
 * @throws Error if file not found or not readable
 */
export function processBenchlingSecretsInput(input: string): string {
  const trimmed = input.trim();

  // Check for @file syntax
  if (trimmed.startsWith("@")) {
    const filePath = trimmed.slice(1); // Remove @ prefix
    const resolvedPath = resolve(filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(
        `Secrets file not found: ${filePath}\n` +
        `  Resolved path: ${resolvedPath}\n` +
        `  Tip: Use relative or absolute path after @ (e.g., @secrets.json or @/path/to/secrets.json)`
      );
    }

    try {
      const fileContent = readFileSync(resolvedPath, "utf-8");
      return fileContent.trim();
    } catch (error) {
      throw new Error(
        `Failed to read secrets file: ${filePath}\n` +
        `  Error: ${(error as Error).message}`
      );
    }
  }

  // Return as-is for ARN or inline JSON
  return trimmed;
}
```

**Dependencies**: Requires `readFileSync` import from `fs`.

**Call Site**: Modify `loadConfigSync` to process the input:

```typescript
// Unified secrets (priority: CLI > env > .env)
const rawSecrets = options.benchlingSecrets || envVars.BENCHLING_SECRETS;
benchlingSecrets: rawSecrets ? processBenchlingSecretsInput(rawSecrets) : undefined,
```

### 3. Validation Integration

**Location**: `/Users/ernest/GitHub/benchling-webhook/bin/commands/deploy.ts`

#### 3.1 Secret Validation Hook

**Add validation step** after configuration loading (after line 48) and before config validation (before line 51):

```typescript
// 2a. Validate benchling-secrets if provided
if (config.benchlingSecrets) {
  spinner.text = "Validating Benchling secrets...";

  try {
    const secretsConfig = parseAndValidateSecrets(config.benchlingSecrets);

    // Display secret source and format
    if (secretsConfig.format === "arn") {
      spinner.info(`Using Benchling secrets from ARN: ${maskArn(secretsConfig.arn!)}`);
    } else {
      spinner.info("Using Benchling secrets from JSON configuration");
    }

    // Check for deprecated parameter usage
    const hasOldParams = !!(
      config.benchlingTenant ||
      config.benchlingClientId ||
      config.benchlingClientSecret
    );

    if (hasOldParams) {
      spinner.warn("Both --benchling-secrets and individual secret parameters provided");
      console.log(chalk.yellow("\n  ⚠ DEPRECATION WARNING:"));
      console.log(chalk.yellow("  Individual secret parameters (--tenant, --client-id, --client-secret) are deprecated."));
      console.log(chalk.yellow("  The --benchling-secrets parameter will take precedence.\n"));
      console.log(chalk.dim("  Migration guide: https://github.com/quiltdata/benchling-webhook/blob/main/docs/secrets-migration.md\n"));

      // Clear old parameters to avoid confusion
      config.benchlingTenant = undefined;
      config.benchlingClientId = undefined;
      config.benchlingClientSecret = undefined;
      config.benchlingAppDefinitionId = undefined;
    }

  } catch (error) {
    spinner.fail("Secret validation failed");
    console.log();

    if (error instanceof SecretsValidationError) {
      console.error(chalk.red.bold("❌ Benchling Secrets Error\n"));
      console.error(error.formatForCLI());
      console.log(chalk.yellow("Secrets format:"));
      console.log("  ARN:  arn:aws:secretsmanager:region:account:secret:name");
      console.log("  JSON: {\"client_id\":\"...\",\"client_secret\":\"...\",\"tenant\":\"...\"}");
      console.log("  File: @secrets.json\n");
    } else {
      console.error(chalk.red((error as Error).message));
    }

    process.exit(1);
  }
}
```

**Dependencies**: Requires imports:
```typescript
import { parseAndValidateSecrets, SecretsValidationError } from "../../lib/utils/secrets";
```

#### 3.2 Helper Function for ARN Masking

**Add utility function** at the end of deploy.ts:

```typescript
/**
 * Mask sensitive parts of ARN for display
 * Shows region and partial secret name, masks account
 */
function maskArn(arn: string): string {
  // Pattern: arn:aws:secretsmanager:region:account:secret:name
  const match = arn.match(/^(arn:aws:secretsmanager:[^:]+:)(\d{12})(:.+)$/);

  if (match) {
    const [, prefix, account, suffix] = match;
    const maskedAccount = "****" + account.slice(-4);
    return prefix + maskedAccount + suffix;
  }

  return arn; // Return as-is if pattern doesn't match
}
```

### 4. Configuration Priority Logic

**Priority Order** (highest to lowest):

1. `--benchling-secrets` CLI option
2. `BENCHLING_SECRETS` environment variable
3. `BENCHLING_SECRETS` from .env file
4. Individual parameters (deprecated):
   - `--tenant` / `BENCHLING_TENANT`
   - `--client-id` / `BENCHLING_CLIENT_ID`
   - `--client-secret` / `BENCHLING_CLIENT_SECRET`
   - `--app-id` / `BENCHLING_APP_DEFINITION_ID`

**Resolution Logic**:
- When `benchlingSecrets` is present, individual parameters are ignored
- Deprecation warning displayed when both are present
- Individual parameters still validated when used alone (Phase 1 complete = keep backward compat)

### 5. Validation Rules

**File Input Validation**:
- File path must exist and be readable
- File must contain valid JSON or ARN
- Clear error messages include resolved path

**ARN Validation** (uses Phase 1 functions):
- Must match pattern: `arn:aws:secretsmanager:region:account:secret:name`
- Region must be non-empty
- Account must be 12 digits
- Secret name must be non-empty

**JSON Validation** (uses Phase 1 functions):
- Must be valid JSON object
- Required fields: `client_id`, `client_secret`, `tenant`
- Optional fields: `app_definition_id`, `api_url`
- All fields must be non-empty strings
- Tenant must be alphanumeric with hyphens
- API URL must be valid URL format if provided

### 6. Deployment Plan Display

**Location**: `/Users/ernest/GitHub/benchling-webhook/bin/commands/deploy.ts` (lines 110-140)

**Modification Strategy**:

**Current Display** (lines 122-127):
```typescript
console.log(`    ${chalk.bold("Benchling Tenant:")}         ${config.benchlingTenant}`);
console.log(`    ${chalk.bold("Benchling Client ID:")}      ${config.benchlingClientId}`);
console.log(`    ${chalk.bold("Benchling Client Secret:")}  ${config.benchlingClientSecret ? "***" + config.benchlingClientSecret.slice(-4) : "(not set)"}`);
if (config.benchlingAppDefinitionId) {
    console.log(`    ${chalk.bold("Benchling App ID:")}        ${config.benchlingAppDefinitionId}`);
}
```

**Updated Display**:
```typescript
// Display Benchling configuration
if (config.benchlingSecrets) {
    const secretsConfig = parseAndValidateSecrets(config.benchlingSecrets);

    if (secretsConfig.format === "arn") {
        console.log(`    ${chalk.bold("Benchling Secrets:")}        ARN (${maskArn(secretsConfig.arn!)})`);
    } else {
        // Display from parsed JSON
        console.log(`    ${chalk.bold("Benchling Tenant:")}         ${secretsConfig.data!.tenant}`);
        console.log(`    ${chalk.bold("Benchling Client ID:")}      ${secretsConfig.data!.client_id}`);
        console.log(`    ${chalk.bold("Benchling Client Secret:")}  ***${secretsConfig.data!.client_secret.slice(-4)}`);
        if (secretsConfig.data!.app_definition_id) {
            console.log(`    ${chalk.bold("Benchling App ID:")}        ${secretsConfig.data!.app_definition_id}`);
        }
    }
} else {
    // Fallback to individual parameters (deprecated path)
    console.log(`    ${chalk.bold("Benchling Tenant:")}         ${config.benchlingTenant}`);
    console.log(`    ${chalk.bold("Benchling Client ID:")}      ${config.benchlingClientId}`);
    console.log(`    ${chalk.bold("Benchling Client Secret:")}  ${config.benchlingClientSecret ? "***" + config.benchlingClientSecret.slice(-4) : "(not set)"}`);
    if (config.benchlingAppDefinitionId) {
        console.log(`    ${chalk.bold("Benchling App ID:")}        ${config.benchlingAppDefinitionId}`);
    }
}
```

### 7. Help Text Updates

**Location**: `/Users/ernest/GitHub/benchling-webhook/bin/cli.ts` (lines 22-46)

**Current Options** (lines 26-31):
```typescript
.option("--tenant <name>", "Benchling tenant")
.option("--client-id <id>", "Benchling OAuth client ID")
.option("--client-secret <secret>", "Benchling OAuth client secret")
.option("--app-id <id>", "Benchling app definition ID")
```

**Updated Options**:
```typescript
.option("--benchling-secrets <value>", "Benchling secrets configuration (ARN, JSON, or @file)")
.option("--tenant <name>", "Benchling tenant (deprecated, use --benchling-secrets)")
.option("--client-id <id>", "Benchling OAuth client ID (deprecated, use --benchling-secrets)")
.option("--client-secret <secret>", "Benchling OAuth client secret (deprecated, use --benchling-secrets)")
.option("--app-id <id>", "Benchling app definition ID (deprecated, use --benchling-secrets)")
```

**Help Examples** (add extended help section):

When user runs `npx @quiltdata/benchling-webhook deploy --help`, they should see:

```
Options:
  --benchling-secrets <value>  Benchling secrets configuration (ARN, JSON, or @file)
  --tenant <name>              Benchling tenant (deprecated, use --benchling-secrets)
  --client-id <id>             Benchling OAuth client ID (deprecated, use --benchling-secrets)
  --client-secret <secret>     Benchling OAuth client secret (deprecated, use --benchling-secrets)
  --app-id <id>                Benchling app definition ID (deprecated, use --benchling-secrets)

Examples:
  # Using AWS Secrets Manager ARN
  $ npx @quiltdata/benchling-webhook deploy --benchling-secrets "arn:aws:secretsmanager:..."

  # Using inline JSON
  $ npx @quiltdata/benchling-webhook deploy --benchling-secrets '{"client_id":"...","client_secret":"...","tenant":"..."}'

  # Using JSON file
  $ npx @quiltdata/benchling-webhook deploy --benchling-secrets @secrets.json

  # Using environment variable
  $ export BENCHLING_SECRETS='{"client_id":"...","client_secret":"...","tenant":"..."}'
  $ npx @quiltdata/benchling-webhook deploy
```

**Implementation**: Add `.addHelpText('after', '...')` to deploy command after options definition.

### 8. Error Handling

**Error Scenarios**:

1. **File Not Found**:
   ```
   ❌ Benchling Secrets Error

   Secrets file not found: secrets.json
     Resolved path: /Users/example/project/secrets.json
     Tip: Use relative or absolute path after @ (e.g., @secrets.json)
   ```

2. **Invalid JSON**:
   ```
   ❌ Benchling Secrets Error

   Invalid JSON in secret data

   Errors:
     × json: JSON parse error: Unexpected token } in JSON at position 45
       → Ensure the secret data is valid JSON
   ```

3. **Invalid ARN**:
   ```
   ❌ Benchling Secrets Error

   Invalid secret ARN

   Errors:
     × arn: Invalid AWS Secrets Manager ARN format
       → Expected format: arn:aws:secretsmanager:region:account:secret:name
   ```

4. **Missing Required Fields**:
   ```
   ❌ Benchling Secrets Error

   Invalid secret data structure

   Errors:
     × client_id: Missing required field: client_id
       → Add "client_id" to your secret configuration
     × client_secret: Missing required field: client_secret
       → Add "client_secret" to your secret configuration
   ```

5. **Both Old and New Parameters**:
   ```
   ⚠ DEPRECATION WARNING:
   Individual secret parameters (--tenant, --client-id, --client-secret) are deprecated.
   The --benchling-secrets parameter will take precedence.

   Migration guide: https://github.com/quiltdata/benchling-webhook/blob/main/docs/secrets-migration.md
   ```

**Error Handling Strategy**:
- All validation errors caught before CDK deployment
- Clear, actionable error messages with suggestions
- File errors include resolved paths
- JSON errors include parse position
- ARN errors include expected format
- Deprecation warnings are non-blocking

### 9. Backward Compatibility

**Compatibility Requirements**:

1. **Existing Workflows Must Work**: All existing deployments using individual parameters must continue to work without changes
2. **No Breaking Changes**: This is a 0.6.x release - no breaking changes allowed
3. **Graceful Degradation**: If `benchlingSecrets` validation fails, don't break existing parameter paths
4. **Warning Strategy**: Warnings only when mixing approaches, not when using old approach alone

**Compatibility Matrix**:

| Old Parameters | New Parameter | Behavior |
| ---------------- | --------------- | ---------- |
| ✅ Present     | ❌ Not Present | Use old parameters (no warning) |
| ❌ Not Present | ✅ Present     | Use new parameter |
| ✅ Present     | ✅ Present     | Use new parameter (warning displayed) |
| ❌ Not Present | ❌ Not Present | Validation error |

**Validation Changes**:
- Current validation in `validateConfig` checks individual parameters
- Must continue to work when `benchlingSecrets` not provided
- Add parallel validation path for `benchlingSecrets`
- Both paths should produce equivalent validation errors

### 10. Testing Strategy

**Unit Tests** (new test file: `lib/utils/config.test.ts`):
- Test `processBenchlingSecretsInput` with inline JSON
- Test `processBenchlingSecretsInput` with @file syntax
- Test `processBenchlingSecretsInput` with ARN
- Test file not found error
- Test file read error
- Test priority: CLI > env > .env
- Test backward compatibility with old parameters

**Integration Tests** (new test file: `bin/commands/deploy.test.ts`):
- Test deploy command with `--benchling-secrets` ARN
- Test deploy command with `--benchling-secrets` JSON
- Test deploy command with `--benchling-secrets @file.json`
- Test deploy command with `BENCHLING_SECRETS` env var
- Test deploy command with old parameters (no warning)
- Test deploy command with both old and new (warning displayed)
- Test validation errors display correctly
- Test masked ARN display
- Test masked secret display in deployment plan

**Manual Testing**:
- Test with real secrets file
- Test with real AWS Secrets Manager ARN
- Test error scenarios
- Test help text display
- Test deprecation warnings

### 11. Implementation Dependencies

**External Dependencies**:
- No new npm packages required
- Uses existing `commander`, `chalk`, `ora` packages
- Uses Node.js `fs` and `path` built-ins

**Internal Dependencies**:
- Depends on Phase 1: `lib/utils/secrets.ts` validation functions
- Uses existing: `lib/utils/config.ts` configuration system
- Uses existing: `bin/commands/deploy.ts` deployment flow

**File Changes Required**:
1. `/Users/ernest/GitHub/benchling-webhook/bin/cli.ts` - Add CLI option
2. `/Users/ernest/GitHub/benchling-webhook/lib/utils/config.ts` - Add file processing
3. `/Users/ernest/GitHub/benchling-webhook/bin/commands/deploy.ts` - Add validation integration
4. Tests: Add new test files for coverage

### 12. Success Metrics

**Functional Requirements**:
- ✅ CLI accepts `--benchling-secrets` with ARN
- ✅ CLI accepts `--benchling-secrets` with inline JSON
- ✅ CLI accepts `--benchling-secrets @file.json`
- ✅ Environment variable `BENCHLING_SECRETS` works
- ✅ File input reads and validates JSON
- ✅ Priority resolution works correctly
- ✅ Deprecation warnings display appropriately
- ✅ Backward compatibility maintained
- ✅ Help text updated with examples

**Quality Requirements**:
- ✅ All new code has > 90% test coverage
- ✅ All error scenarios have clear messages
- ✅ All validation uses Phase 1 functions
- ✅ No breaking changes to existing functionality
- ✅ IDE diagnostics resolved

**User Experience Requirements**:
- ✅ Error messages are actionable
- ✅ Help text includes clear examples
- ✅ Secrets are masked in all output
- ✅ Deprecation warnings guide migration

## Design Decisions

### Decision 1: Use @ Prefix for File Input

**Rationale**:
- Industry standard pattern (used by Docker, curl, etc.)
- Unambiguous (ARN and JSON don't start with @)
- Simple to parse and validate
- Familiar to developers

**Alternatives Considered**:
- `file://` URI scheme - More verbose, less familiar
- Automatic detection - Ambiguous with ARN/JSON strings
- Separate `--benchling-secrets-file` option - More CLI clutter

### Decision 2: Clear Old Parameters When New Parameter Present

**Rationale**:
- Prevents confusion about which values are being used
- Makes precedence explicit in code
- Simplifies testing and validation
- Reduces risk of mixed-state bugs

**Alternatives Considered**:
- Merge values (old as fallback) - Could lead to unexpected behavior
- Error on conflict - Too strict, breaks migration path
- Silently ignore old - User confusion about what's being used

### Decision 3: Deprecation Warnings Only When Mixed

**Rationale**:
- Don't nag users who haven't migrated yet
- Smooth migration path without forced upgrades
- Warnings when mixing indicate likely user error
- Maintains user-friendly upgrade experience

**Alternatives Considered**:
- Always warn when old params used - Too noisy
- Never warn - Users won't know to migrate
- Hard error on old params - Breaking change

### Decision 4: Validate Before CDK Deployment

**Rationale**:
- Fail fast before expensive CDK operations
- Clear error messages at validation stage
- No partial deployments from bad configs
- Better user experience

**Alternatives Considered**:
- Validate during CDK synth - Too late, worse error messages
- Validate in CDK construct - Hard to test, poor error formatting
- No validation - User gets CloudFormation errors

### Decision 5: Mask Secrets in All Display

**Rationale**:
- Security best practice
- Prevents accidental exposure in logs
- Consistent with existing `benchlingClientSecret` masking
- Only show last 4 characters for verification

**Alternatives Considered**:
- No masking - Security risk
- Full masking - Can't verify correct secret used
- Configurable masking - Unnecessary complexity

## Architecture Diagrams

### Configuration Flow

```
User Input
  ↓
CLI Parser (commander.js)
  ↓
ConfigOptions
  ↓
processBenchlingSecretsInput()
  ├─ @file → read file → return content
  ├─ ARN → return as-is
  └─ JSON → return as-is
  ↓
loadConfigSync()
  ├─ Priority: CLI > env > .env
  └─ Process @file syntax
  ↓
Partial<Config>
  ↓
parseAndValidateSecrets() [Phase 1]
  ├─ detectSecretsFormat()
  ├─ validateSecretArn() OR
  └─ validateSecretData()
  ↓
BenchlingSecretsConfig
  ↓
Deploy Command
  ↓
CDK Stack
```

### Priority Resolution

```
┌─────────────────────────────────────┐
│ Configuration Source Priority        │
├─────────────────────────────────────┤
│ 1. --benchling-secrets (CLI)        │  Highest
│ 2. BENCHLING_SECRETS (env)          │
│ 3. BENCHLING_SECRETS (.env file)    │
│ 4. Individual params (deprecated)   │  Lowest
└─────────────────────────────────────┘

When benchlingSecrets present:
  ✓ Use benchlingSecrets
  ✓ Clear individual params
  ✓ Show deprecation warning if individual params also present

When benchlingSecrets absent:
  ✓ Use individual params
  ✓ No warning (backward compatible)
```

### Validation Flow

```
deploy command starts
  ↓
Load config
  ↓
benchlingSecrets present? ──No──→ Use individual params (existing flow)
  ↓ Yes
  ↓
parseAndValidateSecrets()
  ↓
Valid? ──No──→ Display error and exit
  ↓ Yes
  ↓
Check for old params present
  ↓
Both present? ──Yes──→ Show deprecation warning
  ↓                    Clear old params
  ↓ No (only new)
  ↓
Continue with deployment
```

## Security Considerations

### 1. Secret Masking

**Implementation**:
- Mask all secrets in CLI output
- Show only last 4 characters of client_secret
- Mask account ID in ARN (show region and partial name)
- Never log full secret values

**Applies to**:
- Deployment plan display
- Error messages
- Progress spinner messages
- Success messages

### 2. File Permissions

**Recommendations** (document in help text):
- Secrets files should have restrictive permissions (600)
- Add `secrets.json` to `.gitignore`
- Use environment variables in CI/CD
- Use AWS Secrets Manager ARNs in production

**Implementation**:
- No permission checks in code (user responsibility)
- Document best practices in README

### 3. Environment Variable Exposure

**Risk**: Environment variables visible to all processes

**Mitigation**:
- Recommend ARN references over inline JSON in production
- Document risks in README
- Prefer `.env` file over shell `export`
- Use AWS Secrets Manager for production deployments

## Documentation Requirements

**Files to Update**:

1. **README.md**:
   - Add secrets configuration section
   - Add examples for all three input methods
   - Add migration guide reference

2. **New: docs/secrets-migration.md**:
   - Step-by-step migration from old parameters
   - Examples for each deployment scenario
   - Troubleshooting common issues

3. **CLI Help Text**:
   - Update option descriptions
   - Add examples section
   - Mark deprecated options

4. **env.template**:
   - Add `BENCHLING_SECRETS=` example
   - Comment old parameters as deprecated

## Rollout Plan

**Phase 2 Release** (v0.6.x):

1. **Code Implementation**: Follow episodes in 09-phase2-episodes.md
2. **Testing**: Follow checklist in 10-phase2-checklist.md
3. **Documentation**: Update all docs before release
4. **Release Notes**: Document new feature and deprecation
5. **Communication**: Email users about new feature

**Future Phases**:
- **Phase 3-4**: Enable ARN reference and inline secrets in CDK
- **Phase 7**: Complete documentation and migration guide
- **Phase 8**: Remove deprecated parameters in v1.0

## Open Questions

None - all design decisions documented above.

## References

- **Phase 1 Design**: [05-phase1-design.md](./05-phase1-design.md)
- **Phase 1 Implementation**: `/Users/ernest/GitHub/benchling-webhook/lib/utils/secrets.ts`
- **Phases Breakdown**: [04-phases.md](./04-phases.md)
- **Specifications**: [03-specifications.md](./03-specifications.md)
- **Commander.js Docs**: https://github.com/tj/commander.js
- **AWS Secrets Manager ARN Format**: https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_iam-permissions.html

## Conclusion

This design provides a complete technical specification for adding `--benchling-secrets` CLI parameter support. The implementation maintains full backward compatibility while introducing modern secrets management. The design leverages Phase 1's validation framework and follows existing CLI patterns using commander.js.

**Next Steps**:
1. Create episodes document (09-phase2-episodes.md)
2. Create checklist document (10-phase2-checklist.md)
3. Begin TDD implementation following episodes
