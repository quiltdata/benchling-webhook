# Phase 3 Design Document - Command Chaining

**Phase**: 3 of 3
**Reference**: spec/221-next-steps/04-phases.md
**GitHub Issue**: #221

## Overview

Phase 3 implements the core requirement from issue #221: making the CLI default to an 'install' action that chains setup and deploy commands. This eliminates the need for users to manually invoke deploy after setup.

## Design Goals

1. **Seamless Installation**: Default CLI behavior runs setup → deploy chain
2. **User Consent**: Always prompt before deploying (unless --yes flag)
3. **Backward Compatibility**: All existing commands work unchanged
4. **Clear Feedback**: Users understand what's happening at each step
5. **Error Resilience**: Setup failures prevent deployment, clear recovery paths

## Architecture

### Command Flow

```
User runs: npx @quiltdata/benchling-webhook
    ↓
CLI Entry (bin/cli.ts)
    ↓
Detects: No command specified
    ↓
Executes: Install Command (new default)
    ↓
    ├─→ Step 1: Run Setup Wizard
    │   └─→ Returns: ProfileConfig + success status
    ↓
    ├─→ Step 2: Check Setup Success
    │   ├─→ If failed: Exit with error
    │   └─→ If succeeded: Continue
    ↓
    ├─→ Step 3: Prompt for Deployment
    │   ├─→ "Setup complete! Deploy now? (Y/n)"
    │   ├─→ If --yes flag: Skip prompt, auto-deploy
    │   ├─→ If --setup-only flag: Skip deployment entirely
    │   └─→ If user declines: Show next steps
    ↓
    ├─→ Step 4: Execute Deployment (if confirmed)
    │   └─→ Returns: DeploymentResult
    ↓
    └─→ Step 5: Display Results
        ├─→ Show webhook URL (if deployed)
        ├─→ Show next steps (with deployment context)
        └─→ Show recovery commands (if errors)
```

### Key Components

#### 1. CLI Orchestration (bin/cli.ts)

**Current Behavior**:
- Default command: setup wizard only
- User must manually run deploy after

**New Behavior**:
- Default command: 'install' (setup + deploy chain)
- Explicit 'setup' command still works (backward compatibility)
- New flags:
  - `--setup-only`: Skip deployment step
  - `--yes`: Auto-confirm deployment

**Changes Required**:
```typescript
// Change default behavior
if (!args.length || (args.length > 0 && args[0].startsWith("--"))) {
    // NEW: Run install command (setup + deploy chain)
    installCommand(options)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        });
}
```

#### 2. Install Command (bin/commands/install.ts) - NEW FILE

**Purpose**: Orchestrate setup → deploy workflow

**Interface**:
```typescript
export interface InstallCommandOptions {
    profile?: string;
    inheritFrom?: string;
    awsProfile?: string;
    awsRegion?: string;
    setupOnly?: boolean;      // Skip deployment
    yes?: boolean;            // Skip confirmation
    nonInteractive?: boolean; // Non-interactive mode
}

export async function installCommand(options: InstallCommandOptions): Promise<void>;
```

**Implementation Flow**:
1. Run setup wizard
2. Check setup success
3. If --setup-only: Display next steps and exit
4. Prompt for deployment (unless --yes)
5. If confirmed: Run deploy command
6. Display deployment results
7. Show context-aware next steps

#### 3. Setup Wizard Updates (bin/commands/setup-wizard.ts)

**Current Behavior**:
- Always displays next steps at the end
- Returns void (Promise<void>)

**New Behavior**:
- Accept `isPartOfInstall` parameter
- Return setup status and config
- Only show next steps if NOT part of install

**Changes Required**:
```typescript
export interface SetupWizardOptions {
    profile?: string;
    inheritFrom?: string;
    nonInteractive?: boolean;
    skipValidation?: boolean;
    skipSecretsSync?: boolean;
    awsProfile?: string;
    awsRegion?: string;
    isPartOfInstall?: boolean;  // NEW: Suppress next steps if true
}

export interface SetupWizardResult {  // NEW: Return value
    success: boolean;
    config: ProfileConfig;
    profile: string;
}

export async function setupWizardCommand(
    options: SetupWizardOptions = {}
): Promise<SetupWizardResult>;
```

**Key Changes**:
1. Return result instead of void
2. Suppress "Setup Complete!" message if `isPartOfInstall` is true
3. Only call `generateNextSteps()` if NOT part of install

#### 4. Deploy Command Integration (bin/commands/deploy.ts)

**Current Behavior**:
- Already works as standalone command
- Returns deployment outputs

**New Behavior**:
- No changes needed!
- Will be called programmatically by install command
- Already returns structured data

**Interface** (existing):
```typescript
export async function deployCommand(options: DeployOptions): Promise<void>;
```

**Enhancement** (optional for better integration):
```typescript
export interface DeployCommandResult {
    success: boolean;
    webhookUrl?: string;
    stackArn?: string;
    region?: string;
    error?: string;
}

// Return structured result for programmatic use
export async function deployCommand(
    options: DeployOptions
): Promise<DeployCommandResult>;
```

#### 5. Next Steps Generator Updates (lib/next-steps-generator.ts)

**Current Behavior**:
- Generates next steps after setup only
- Does not handle deployment context

**New Behavior**:
- Accept optional `deployment` parameter
- Show different next steps based on deployment status
- Already supports context detection (Phase 2)

**Changes Required**:
```typescript
// Already defined in types, just use it:
export interface NextStepsOptions {
    profile: string;
    stage?: string;
    context?: ExecutionContext;
    deployment?: DeploymentResult;  // Phase 3 addition
    skipDeployment?: boolean;        // Phase 3 addition
}
```

**Next Steps Variations**:

1. **Setup Complete (No Deploy)** - When --setup-only used:
```
Next steps:
  1. Deploy to AWS: [deploy command]
  2. Test integration: [test command]
```

2. **Deploy Success**:
```
Setup and deployment complete!

Webhook URL: https://abc123.execute-api.us-east-1.amazonaws.com/prod/webhook

Next steps:
  1. Configure webhook URL in Benchling app settings
  2. Test webhook: [test command]
  3. Check logs: [health-check command]
```

3. **Deploy Failure** (show recovery):
```
Setup complete, but deployment failed!

Error: [error message]

Next steps:
  1. Fix the error above
  2. Retry deployment: [deploy command]
  3. Check configuration: [health-check command]
```

### Confirmation Prompt

**Interactive Mode**:
```
╔═══════════════════════════════════════════════════════════╗
║   Setup Complete!                                         ║
╚═══════════════════════════════════════════════════════════╝

Configuration saved to: ~/.config/benchling-webhook/default/config.json

Deploy to AWS now? This will create CloudFormation stack with:
  - ECS Fargate service
  - API Gateway endpoint
  - Application Load Balancer

Estimated time: 5-10 minutes

? Deploy now? (Y/n) _
```

**Non-Interactive Mode**:
- If `--yes` flag: Auto-deploy without prompt
- If `--setup-only` flag: Skip deployment
- If neither: Error (require explicit flag)

### Error Handling

#### Setup Fails

```typescript
try {
    const setupResult = await setupWizardCommand({
        ...options,
        isPartOfInstall: true,
    });

    if (!setupResult.success) {
        console.error("Setup failed. Deployment skipped.");
        process.exit(1);
    }
} catch (error) {
    console.error(`Setup error: ${error.message}`);
    console.error("Deployment skipped.");
    process.exit(1);
}
```

#### Deploy Fails

```typescript
try {
    const deployResult = await deployCommand({
        profile: setupResult.profile,
        stage: stage,
    });

    if (!deployResult.success) {
        console.error("\n❌ Deployment failed!");
        console.error(`Error: ${deployResult.error}`);

        // Show recovery next steps
        const nextSteps = generateNextSteps({
            profile: setupResult.profile,
            stage: stage,
            deployment: deployResult,
        });
        console.log(nextSteps);

        process.exit(1);
    }
} catch (error) {
    console.error(`\n❌ Deployment error: ${error.message}`);
    console.error("Setup was successful. You can retry deployment with:");
    console.error(`  npm run deploy -- --profile ${profile} --stage ${stage}`);
    process.exit(1);
}
```

#### User Cancels

```typescript
const { shouldDeploy } = await inquirer.prompt([{
    type: "confirm",
    name: "shouldDeploy",
    message: "Deploy now?",
    default: true,
}]);

if (!shouldDeploy) {
    console.log("\n✓ Setup complete! Deployment skipped.");

    // Show next steps for manual deployment
    const nextSteps = generateNextSteps({
        profile: setupResult.profile,
        stage: stage,
        skipDeployment: true,
    });
    console.log(nextSteps);

    process.exit(0);
}
```

## CLI Flag Design

### Existing Flags (Preserved)

- `--profile <name>`: Configuration profile
- `--inherit-from <name>`: Inherit from base profile
- `--region <region>`: AWS region
- `--aws-profile <name>`: AWS credentials profile
- `--yes, -y`: Non-interactive mode (existing in deploy)

### New Flags (Phase 3)

- `--setup-only`: Run setup without deployment
  - Mutually exclusive with `--yes`
  - Shows next steps with deploy command

### Flag Combinations

| Command | Flags | Behavior |
|---------|-------|----------|
| `npx @quiltdata/benchling-webhook` | (none) | Interactive setup + deploy prompt |
| `npx @quiltdata/benchling-webhook --yes` | `--yes` | Setup + auto-deploy |
| `npx @quiltdata/benchling-webhook --setup-only` | `--setup-only` | Setup only, no deploy |
| `npx @quiltdata/benchling-webhook setup` | explicit | Setup only (backward compat) |
| `npx @quiltdata/benchling-webhook deploy` | explicit | Deploy only (existing) |

### Flag Validation

```typescript
function validateFlags(options: InstallCommandOptions): void {
    if (options.setupOnly && options.yes) {
        throw new Error(
            "Cannot use both --setup-only and --yes flags. " +
            "Use --setup-only to skip deployment, or --yes to auto-deploy."
        );
    }
}
```

## Backward Compatibility

### Preserved Behaviors

1. **Explicit Commands**: All existing commands work unchanged
   - `setup` - Runs setup wizard only
   - `deploy` - Runs deployment only
   - `init` - Alias for setup
   - All other commands unchanged

2. **Flags**: All existing flags preserved
   - `--profile`
   - `--stage`
   - `--region`
   - `--aws-profile`
   - Deploy-specific flags

3. **npm Scripts**: Repository developers' scripts work unchanged
   - `npm run setup` - Still runs setup only
   - `npm run deploy:dev` - Still runs deploy only
   - No breaking changes to workflows

### Migration Path

Users can continue using old workflows:
```bash
# Old workflow (still works)
npx @quiltdata/benchling-webhook setup
npx @quiltdata/benchling-webhook deploy

# New workflow (default)
npx @quiltdata/benchling-webhook
# (prompts for deploy after setup)
```

## Testing Strategy

### Unit Tests

1. **Install Command Tests** (`test/bin/install.test.ts`):
   - Setup success → prompt → deploy
   - Setup failure → exit
   - `--yes` flag → auto-deploy
   - `--setup-only` flag → skip deploy
   - User cancels → show next steps
   - Deploy failure → show recovery

2. **CLI Orchestration Tests** (`test/bin/cli.test.ts`):
   - Default command is install
   - Explicit commands work
   - Flag parsing correct
   - Error handling

3. **Next Steps Tests** (`test/lib/next-steps-generator.test.ts`):
   - With deployment result
   - With deployment failure
   - With skipDeployment flag

### Integration Tests

1. **End-to-End Flow**:
   - Mock setup wizard
   - Mock deploy command
   - Verify orchestration
   - Verify output messages

2. **Error Scenarios**:
   - Setup fails before deploy
   - Deploy fails after setup
   - Network errors
   - User interruption (Ctrl+C)

### Manual Testing

1. **Fresh Install**:
   ```bash
   npx @quiltdata/benchling-webhook
   # Verify: setup runs, prompts for deploy, deploy succeeds
   ```

2. **Non-Interactive**:
   ```bash
   npx @quiltdata/benchling-webhook --yes --profile dev
   # Verify: auto-deploys without prompt
   ```

3. **Setup Only**:
   ```bash
   npx @quiltdata/benchling-webhook --setup-only
   # Verify: setup runs, deployment skipped
   ```

4. **Backward Compatibility**:
   ```bash
   npx @quiltdata/benchling-webhook setup
   npx @quiltdata/benchling-webhook deploy
   # Verify: both work independently
   ```

## Success Criteria

### Functional

- [ ] Default CLI runs install command (setup + deploy)
- [ ] User prompted for deployment after setup
- [ ] `--yes` flag auto-deploys without prompt
- [ ] `--setup-only` flag skips deployment
- [ ] Setup errors prevent deployment
- [ ] Deploy errors show recovery steps
- [ ] All existing commands work unchanged
- [ ] Next steps include deployment context

### Non-Functional

- [ ] No breaking changes to existing workflows
- [ ] Clear progress messages at each step
- [ ] Deployment takes 5-10 minutes (unchanged)
- [ ] Error messages actionable
- [ ] Help text accurate

### Quality

- [ ] Unit test coverage >85%
- [ ] All integration tests pass
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] Manual testing scenarios pass
- [ ] Documentation updated

## Documentation Updates

### README.md

Update Quick Start section:
```markdown
## Quick Start

### New Installation (Recommended)

Run the interactive installer to set up and deploy in one step:

```bash
npx @quiltdata/benchling-webhook
```

This will:
1. Walk you through configuration
2. Prompt to deploy to AWS
3. Display your webhook URL

### Advanced Options

**Setup Only** (skip deployment):
```bash
npx @quiltdata/benchling-webhook --setup-only
```

**Non-Interactive Mode** (auto-deploy):
```bash
npx @quiltdata/benchling-webhook --yes --profile prod
```

**Standalone Commands** (manual workflow):
```bash
# Run setup only
npx @quiltdata/benchling-webhook setup

# Deploy separately
npx @quiltdata/benchling-webhook deploy
```
```

### CHANGELOG.md

```markdown
## [0.8.0] - 2025-11-XX

### Changed

- **CLI Default Behavior**: CLI now defaults to 'install' command which chains setup and deploy
  - Users are prompted to deploy after setup completes
  - Use `--setup-only` flag to skip deployment
  - Use `--yes` flag to auto-deploy without prompt
  - Existing `setup` and `deploy` commands work unchanged (backward compatible)

### Added

- `--setup-only` flag: Run setup without prompting for deployment
- Install command: Orchestrates setup → deploy workflow with user confirmation
- Enhanced next steps: Show deployment-specific guidance based on results

### Migration

No breaking changes. Old workflows continue to work:
- `npx @quiltdata/benchling-webhook setup` still runs setup only
- `npx @quiltdata/benchling-webhook deploy` still runs deploy only
- New default: `npx @quiltdata/benchling-webhook` runs setup + deploy
```

## Implementation Checklist

- [ ] Create spec documents (design, episodes, checklist)
- [ ] Write failing tests for install command
- [ ] Create `bin/commands/install.ts`
- [ ] Update `bin/cli.ts` to default to install
- [ ] Modify `bin/commands/setup-wizard.ts` return value
- [ ] Update `lib/next-steps-generator.ts` deployment handling
- [ ] Implement confirmation prompt
- [ ] Add error handling for all paths
- [ ] Update all tests to pass
- [ ] Fix IDE diagnostics
- [ ] Update README.md
- [ ] Update CHANGELOG.md
- [ ] Run full test suite
- [ ] Manual testing

## Risk Assessment

### High Risk

- **Breaking changes**: Mitigated by preserving explicit commands
- **User confusion**: Mitigated by clear prompts and help text

### Medium Risk

- **Deploy failures**: Mitigated by clear error messages and recovery steps
- **Non-interactive issues**: Mitigated by requiring explicit flags

### Low Risk

- **Test coverage**: Comprehensive test plan in place
- **Documentation**: Clear update plan

## Summary

Phase 3 completes the vision from issue #221 by implementing command chaining. The install command orchestrates setup and deployment with user confirmation, while maintaining full backward compatibility. Clear error handling and context-aware next steps guide users through any issues.
