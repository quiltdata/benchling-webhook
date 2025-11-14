# Specifications Document - Issue #221: Next Steps

**Reference**:
- spec/221-next-steps/01-requirements.md
- spec/221-next-steps/02-analysis.md
**GitHub Issue**: #221

## Desired End State

### 1. Context-Aware CLI Behavior

The CLI shall detect its execution context and adjust all user-facing messages accordingly:

- **NPX context**: When executed via `npx @quiltdata/benchling-webhook`, all command suggestions use `npx @quiltdata/benchling-webhook <command>`
- **Repository context**: When executed within the repository via `npm run` or `ts-node`, command suggestions use `npm run <script>`

### 2. Chained Installation Workflow

The default CLI behavior (no command specified) shall execute a complete installation workflow:

1. Run setup wizard to collect configuration
2. Save configuration to XDG config directory
3. Sync secrets to AWS Secrets Manager
4. Prompt user for deployment confirmation (default: yes)
5. Execute deployment using the configured profile
6. Display deployment outputs and next steps

Users may opt out of automatic deployment via:
- Interactive prompt (answer "no")
- `--setup-only` CLI flag
- Non-interactive mode without explicit deploy consent

### 3. Standalone Commands Preserved

All existing commands shall continue to work independently:

- `deploy` - Deploy without running setup
- `init` - Legacy alias for setup wizard
- `validate` - Validate configuration
- `test` - Test deployed webhook
- `manifest` - Generate app manifest
- `setup-profile` - Create new profile
- `health-check` - Check configuration health

### 4. Dynamic Next Steps Messages

Next steps messages shall be generated dynamically based on:

- **Execution context** (npx vs repository)
- **Profile name** (default, dev, prod, custom)
- **Stage** (dev, prod)
- **Deployment status** (success, failure, skipped)

**Example next steps for npx users**:
```
╔═══════════════════════════════════════════════════════════╗
║   Setup Complete!                                         ║
╚═══════════════════════════════════════════════════════════╝

Webhook URL: https://abc123.execute-api.us-east-1.amazonaws.com/prod/webhook

Next steps:
  1. Configure webhook URL in Benchling app settings
  2. Test webhook: npx @quiltdata/benchling-webhook test
  3. Check logs: npx @quiltdata/benchling-webhook health-check

For more commands: npx @quiltdata/benchling-webhook --help
```

**Example next steps for repository developers**:
```
Next steps:
  1. Configure webhook URL in Benchling app settings
  2. Test webhook: npm run test:dev
  3. Check logs: npm run logs

For more commands: npm run --silent
```

## Success Criteria

### Functional Requirements

1. **FR1**: Context detection correctly identifies npx vs repository execution 100% of the time
2. **FR2**: Setup wizard offers deployment after configuration, defaulting to "yes"
3. **FR3**: Deployment executes using the same profile/stage as setup
4. **FR4**: Next steps messages match execution context and profile
5. **FR5**: All existing commands remain functional without modification
6. **FR6**: `--setup-only` flag skips deployment prompt
7. **FR7**: Non-interactive mode respects `--yes` flag for deployment
8. **FR8**: Errors during setup prevent deployment from executing
9. **FR9**: Deployment failures display actionable error messages

### Non-Functional Requirements

1. **NFR1**: Backward compatibility - zero breaking changes to existing workflows
2. **NFR2**: Performance - context detection adds <100ms overhead
3. **NFR3**: Reliability - error handling prevents partial states
4. **NFR4**: Usability - clear progress indication during multi-step operations
5. **NFR5**: Maintainability - modular code structure for easy updates

## Architectural Goals

### Goal 1: Separation of Concerns

Create dedicated modules for:
- **Context detection** (`lib/context-detector.ts`)
- **Next steps generation** (`lib/next-steps-generator.ts`)
- **Command orchestration** (enhanced `bin/cli.ts`)

### Goal 2: Composable Commands

Commands should be composable and reusable:
- Setup wizard can be called standalone or as part of chain
- Deploy command can be called standalone or programmatically
- Each command returns structured data for orchestration

### Goal 3: Testable Architecture

All new functionality must be unit testable:
- Context detection logic testable with mocked file system
- Next steps generation testable with fixture data
- Command chaining testable with mocked commands

## Design Principles

### Principle 1: Fail Fast

- Invalid configuration prevents deployment
- Setup errors halt the workflow immediately
- Clear error messages guide recovery

### Principle 2: User Consent

- Never deploy without user confirmation (interactive mode)
- Provide clear information before deployment
- Allow easy opt-out at multiple points

### Principle 3: Consistent Experience

- Same message format across contexts
- Predictable command behavior
- Familiar patterns from existing code

### Principle 4: Progressive Disclosure

- Show essential information first
- Detailed output available via flags
- Help text guides users to more information

## Integration Points

### Integration 1: Setup Wizard → Deploy Command

**Flow**:
1. Setup wizard completes successfully
2. Configuration saved to XDG config
3. Secrets synced to AWS
4. User prompted: "Deploy to AWS now?"
5. If yes: Call `deployCommand({ profile, stage })`
6. Display deployment outputs

**Contract**:
- Setup provides profile name and stage
- Deploy reads configuration from XDG config
- Deploy returns outputs (webhook URL, stack ARN)
- Errors propagate to orchestrator

### Integration 2: Context Detector → Next Steps Generator

**Flow**:
1. Context detector determines execution environment
2. Next steps generator receives context + profile info
3. Generator produces formatted message
4. Message displayed to user

**Contract**:
```typescript
interface ExecutionContext {
  isRepository: boolean;
  isNpx: boolean;
  packageName: string;
  availableScripts: string[];
}

interface NextStepsInput {
  context: ExecutionContext;
  profile: string;
  stage: string;
  deploymentResult?: DeploymentResult;
}

function generateNextSteps(input: NextStepsInput): string;
```

### Integration 3: CLI → Command Orchestrator

**Flow**:
1. CLI parses arguments
2. Determines if default behavior triggered
3. Calls orchestrator with options
4. Orchestrator manages workflow
5. Results displayed to user

**Contract**:
- Orchestrator is async function
- Returns exit code (0 = success, 1 = failure)
- Handles all errors internally
- Uses consistent output formatting

## API Contracts

### Context Detector API

```typescript
interface ExecutionContext {
  /** True if running from repository (has package.json with matching name) */
  isRepository: boolean;

  /** True if running via npx */
  isNpx: boolean;

  /** Package name for command suggestions */
  packageName: string;

  /** Available npm scripts (if repository) */
  availableScripts: string[];
}

function detectContext(): ExecutionContext;
```

### Next Steps Generator API

```typescript
interface DeploymentResult {
  success: boolean;
  webhookUrl?: string;
  stackArn?: string;
  region?: string;
  error?: string;
}

interface NextStepsOptions {
  context: ExecutionContext;
  profile: string;
  stage: string;
  deployment?: DeploymentResult;
  skipDeployment?: boolean;
}

function generateNextSteps(options: NextStepsOptions): string;
```

### Command Orchestrator API

```typescript
interface OrchestrationOptions {
  profile?: string;
  stage?: string;
  setupOnly?: boolean;
  skipConfirmation?: boolean;
  nonInteractive?: boolean;
  awsProfile?: string;
  awsRegion?: string;
}

async function orchestrateInstallation(options: OrchestrationOptions): Promise<void>;
```

## Quality Gates

### QG1: Context Detection Accuracy
- **Metric**: 100% correct detection in test scenarios
- **Test cases**:
  - npx execution
  - Repository npm scripts
  - Repository ts-node
  - Global installation

### QG2: Backward Compatibility
- **Metric**: All existing tests pass
- **Test cases**:
  - Standalone deploy command
  - Setup command with all flags
  - All npm scripts
  - Non-interactive mode

### QG3: User Experience
- **Metric**: Clear progress indication at each step
- **Validation**:
  - Progress messages displayed
  - Errors clearly explained
  - Next steps actionable

### QG4: Error Handling
- **Metric**: Graceful failure at each step
- **Test cases**:
  - Setup fails before deploy
  - Deploy fails after setup
  - User cancels at prompt
  - Network errors

## Validation Criteria

### VC1: README Alignment
- README Quick Start matches actual behavior
- Examples work as documented
- No conflicting information

### VC2: Command Help Text
- `--help` output accurately describes behavior
- All flags documented
- Examples match execution context

### VC3: Error Messages
- All error messages actionable
- No cryptic stack traces to users
- Recovery steps provided

## Risk Assessment

### Risk 1: Context Detection False Positives
**Likelihood**: Low
**Impact**: High (wrong next steps shown)
**Mitigation**: Comprehensive test suite with edge cases

### Risk 2: Deploy Failures After Setup
**Likelihood**: Medium
**Impact**: Medium (user frustration)
**Mitigation**: Clear error handling, guide to retry deploy only

### Risk 3: Breaking Changes
**Likelihood**: Low
**Impact**: High (breaks CI/CD pipelines)
**Mitigation**: Extensive testing, careful flag design

### Risk 4: Non-Interactive Confusion
**Likelihood**: Medium
**Impact**: Medium (CI/CD issues)
**Mitigation**: Clear documentation, sensible defaults

## Constraints

### Technical Constraints
1. Must work with Node.js 18+
2. Must use existing Commander.js structure
3. Must maintain XDG config compatibility
4. Must preserve all existing CLI flags

### Design Constraints
1. No UI frameworks (terminal only)
2. No database or persistent state beyond config
3. No network calls for context detection
4. No breaking changes to public API

### Resource Constraints
1. Implementation should fit in single sprint
2. No new external dependencies (use existing: inquirer, chalk, commander)
3. Maintain test coverage above 85%

## Documentation Requirements

### Updates Required
1. **README.md**: Update Quick Start to match actual behavior
2. **MIGRATION.md**: Add notes about new default behavior
3. **CLI help text**: Update all command descriptions
4. **CHANGELOG.md**: Document changes in next release

### New Documentation
1. Context detection algorithm explanation
2. Command chaining behavior guide
3. Troubleshooting guide for deployment failures

## Future Considerations

### Not in Scope (But Worth Noting)
1. **Smart retries**: Automatic retry of failed deployments
2. **Rollback support**: Undo deployment if setup changes
3. **Multi-stage deployment**: Deploy to dev then prod in one flow
4. **Health checks**: Post-deployment validation
5. **Usage analytics**: Track which flows users prefer

These are explicitly out of scope for this issue but may inform design decisions for extensibility.

## Summary

The desired end state delivers:

1. **Correct next steps** based on execution context
2. **Seamless installation** via setup + deploy chaining
3. **Backward compatibility** for all existing workflows
4. **Clear user feedback** at every step
5. **Robust error handling** with actionable guidance

This will be achieved through:
- Context detection module
- Next steps generator module
- Enhanced command orchestration
- Comprehensive testing
- Updated documentation

All while maintaining the existing CLI architecture and design patterns established in the codebase.
