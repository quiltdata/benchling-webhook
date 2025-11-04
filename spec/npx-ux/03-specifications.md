# Engineering Specifications Document

## GitHub Issue Reference

**Issue Number**: #182
**Issue Title**: NPX UX: Simple guided setup wizard
**Branch**: npx-ux
**Version**: 0.6.1 (no version change)

## Executive Summary

This document defines the engineering specifications for a guided setup wizard that transforms the Benchling webhook integration from a multi-step, developer-focused process into a seamless, single-command experience for end users. The system shall orchestrate manifest generation, credential collection, configuration management, deployment, and validation into one cohesive flow while maintaining backward compatibility with existing power-user workflows.

## Architectural Goals

### AG1: Single Entry Point Architecture

The CLI shall provide a unified entry point that defaults to wizard behavior while preserving explicit command access:

1. **Default Wizard Invocation**: Running `npx @quiltdata/benchling-webhook` without arguments shall launch the setup wizard
2. **Explicit Command Access**: All existing commands (`deploy`, `validate`, `test`, `manifest`) shall remain accessible with explicit invocation
3. **Backward Compatibility**: Existing scripts and CI/CD workflows using explicit commands shall continue functioning without modification
4. **Non-Interactive Detection**: The wizard shall detect non-interactive environments and fail gracefully with actionable guidance

### AG2: Step-Based Orchestration Model

The wizard shall implement a modular, testable architecture based on discrete steps:

1. **Step Interface Contract**: Each step shall expose a consistent interface for execution, validation, and state persistence
2. **Linear Progression**: Steps shall execute in a fixed sequence with clear dependencies
3. **State Persistence**: Each completed step shall persist its state to enable interruption recovery
4. **Progress Indication**: The system shall display current step position and total step count throughout execution
5. **Atomic Completion**: Each step shall complete fully or not at all; partial step state shall not be persisted

### AG3: Configuration as Single Source of Truth

The XDG configuration system shall serve as the authoritative source for all deployment state:

1. **Unified Storage Model**: All configuration shall be stored in XDG directories (`~/.config/benchling-webhook/`)
2. **Three-Layer Separation**: User-provided configuration, inferred configuration, and deployment artifacts shall be stored separately
3. **Schema Validation**: All configuration writes shall validate against JSON schemas before persistence
4. **Automatic Detection**: The wizard shall detect existing configuration and offer reuse, update, or replacement options
5. **Secrets Synchronization**: Credentials shall be automatically synchronized to AWS Secrets Manager after collection

### AG4: Reusable Component Integration

The wizard shall leverage existing infrastructure rather than duplicating functionality:

1. **Manifest Generation**: `bin/commands/manifest.ts` logic shall be callable programmatically
2. **Validation Functions**: `scripts/install-wizard.ts` validation functions shall be extracted to shared modules
3. **Quilt Inference**: `scripts/infer-quilt-config.ts` logic shall be integrated without modification
4. **Deployment Execution**: `bin/commands/deploy.ts` orchestration shall be invoked programmatically
5. **Integration Testing**: `bin/commands/test.ts` functionality shall be callable from wizard context

## Design Principles

### DP1: Fail-Fast Validation

The system shall validate prerequisites and credentials before executing time-consuming operations:

1. **Pre-Flight Checks**: AWS credentials, Quilt configuration, and system dependencies shall be validated before wizard start
2. **Credential Validation**: Benchling OAuth credentials shall be validated before deployment initiation
3. **Resource Validation**: S3 bucket access and IAM permissions shall be verified before CDK execution
4. **Clear Error Attribution**: Validation failures shall provide specific error messages with remediation steps

### DP2: Progressive Disclosure

The wizard shall present information incrementally to avoid overwhelming users:

1. **Step-by-Step Guidance**: Only current step information shall be displayed at any given time
2. **Contextual Help**: Instructions shall be provided at the point of need, not upfront
3. **Technical Detail Hiding**: Implementation details (CloudFormation, Docker, IAM) shall be abstracted from user view
4. **Success Path Focus**: Error scenarios shall be handled without exposing technical complexity

### DP3: Explicit Pause Points

The wizard shall pause at manual steps and wait for explicit user confirmation:

1. **Manual Step Detection**: Steps requiring Benchling web UI interaction shall be identified clearly
2. **Clear Instructions**: Each pause point shall display numbered, actionable instructions
3. **Confirmation Prompt**: User shall explicitly acknowledge task completion before wizard proceeds
4. **Help Resources**: Direct links to Benchling documentation shall be provided at each pause point

### DP4: Graceful Degradation

The system shall provide fallback options when automatic operations fail:

1. **Quilt Inference Fallback**: If `quilt3` CLI is unavailable, manual entry shall be offered
2. **Deployment Retry**: Deployment failures shall allow credential correction and retry without restarting
3. **Test Optional**: Integration testing shall be optional if test entry ID is unavailable
4. **Partial Progress**: Completed steps shall be preserved if user exits wizard early

## System Specifications

### SS1: CLI Command Routing

The CLI routing system shall meet the following specifications:

**1.1 Default Behavior**:
- Commander.js default action shall invoke wizard when no command is provided
- Help text shall be displayed only with explicit `--help` or `-h` flags
- Version information shall be displayed only with explicit `--version` or `-V` flags

**1.2 Explicit Command Support**:
- All existing commands shall remain accessible: `deploy`, `validate`, `test`, `manifest`, `init`
- Explicit `setup` command shall be added as an alias for wizard invocation
- Command help text shall reference wizard as primary setup method

**1.3 Non-Interactive Detection**:
- `process.stdin.isTTY` shall be checked before wizard invocation
- Non-interactive environments shall receive error message with documentation link
- Exit code shall be 1 for non-interactive detection

### SS2: Wizard Flow Orchestration

The wizard orchestration system shall implement the following flow:

**Step 1: Welcome and Prerequisites Check**
- Display welcome message explaining wizard purpose
- Verify Node.js version meets minimum requirements (>= 18.0.0)
- Check for AWS CLI availability and valid credentials
- Attempt to detect existing XDG configuration
- Offer configuration reuse, update, or fresh start options
- Display progress indicator: "Step 1 of 8"

**Step 2: Manifest Generation**
- Prompt for Benchling tenant name if not in existing config
- Generate Benchling app manifest YAML file
- Save manifest to `benchling-app-manifest.yaml` in current directory
- Display manifest file location prominently
- Provide step-by-step Benchling app creation instructions
- Display link to Benchling app creation documentation
- Pause with "Press Enter when you have created the app in Benchling..."

**Step 3: Benchling Credential Collection**
- Prompt for App Definition ID (with hint on where to find it)
- Prompt for Client ID (with hint on where to find it)
- Prompt for Client Secret (with masked input)
- Prompt for optional Test Entry ID for integration testing
- Display entered credentials summary (secret masked)
- Offer to edit if user made mistakes

**Step 4: Quilt Configuration Detection**
- Attempt to execute `quilt3 config` to detect catalog URL
- If successful, display detected catalog and confirm with user
- Search CloudFormation stacks for matching Quilt deployments
- If multiple stacks found, prompt user to select correct one
- Extract stack ARN, bucket name, queue ARN, region, and catalog URL
- If detection fails, prompt for manual entry with helpful hints
- Validate S3 bucket accessibility before proceeding

**Step 5: Pre-Deployment Validation**
- Validate Benchling tenant accessibility via HTTP request
- Validate OAuth credentials by attempting token acquisition
- Validate S3 bucket access with HeadBucket and ListObjects
- Verify AWS account and region with STS GetCallerIdentity
- Check CDK bootstrap status for target region and account
- Display validation summary with clear pass/fail indicators
- Offer to retry if any validation fails

**Step 6: Configuration Persistence**
- Save all collected configuration to XDG config directory
- Sync secrets to AWS Secrets Manager with unique name
- Display configuration summary with file locations
- Confirm configuration is ready for deployment

**Step 7: Automated Deployment**
- Display deployment summary with key parameters
- Prompt for deployment confirmation with yes/no
- Execute CDK deployment with real-time progress output
- Capture webhook URL from deployment outputs
- Save deployment artifacts to XDG deploy directory
- Display deployment success with webhook URL prominently
- Handle deployment errors with actionable error messages

**Step 8: Webhook Configuration and Testing**
- Display webhook URL in prominent format
- Provide step-by-step webhook configuration instructions
- Display link to Benchling webhook configuration documentation
- Pause with "Press Enter when webhook is configured in Benchling..."
- If test entry ID provided, automatically run integration test
- Display test results with clear success/failure indication
- If test fails, provide troubleshooting suggestions and offer retry
- Display completion message with summary of what was accomplished

### SS3: Progress Tracking Requirements

The progress tracking system shall meet the following specifications:

**3.1 Visual Progress Indicators**:
- Step counter shall display as "Step N of 8" at each step
- Current step name shall be displayed with step counter
- Spinner shall indicate active background operations
- Success/failure icons shall mark completed validation steps

**3.2 State Persistence Model**:
- Configuration state shall be written after Step 6 completion
- Deployment artifacts shall be written after Step 7 completion
- Intermediate steps (1-5) shall not persist state individually
- Re-running wizard shall detect completed steps and offer to skip or redo

**3.3 Progress Communication**:
- Long-running operations (deployment) shall display elapsed time
- Estimated completion time shall be shown for operations over 30 seconds
- Background processes shall provide periodic status updates
- Error states shall be communicated immediately with context

### SS4: Configuration Management Specifications

The configuration management system shall meet the following specifications:

**4.1 Detection Logic**:
- XDG config directory shall be checked for `default.json` on wizard start
- If found, configuration version and completeness shall be validated
- User shall be prompted with three options: "Use existing", "Update existing", "Start fresh"
- "Use existing" shall skip credential collection and proceed to validation
- "Update existing" shall pre-populate prompts with existing values
- "Start fresh" shall archive existing config with timestamp and start new

**4.2 Validation Requirements**:
- All configuration writes shall validate against JSON schema before persistence
- Schema validation errors shall display specific field issues
- Corrupt configuration files shall trigger backup restoration prompt
- Configuration version mismatches shall trigger migration or fresh setup

**4.3 Secrets Management Flow**:
- Secrets shall be synchronized to AWS Secrets Manager after collection
- Secret name shall follow pattern: `benchling-webhook-{tenant}-{timestamp}`
- Existing secrets with same tenant shall be detected and offered for reuse
- Secret ARN shall be stored in XDG config for deployment reference
- Secrets Manager unavailability shall allow fallback to environment variables

### SS5: Deployment Integration Specifications

The deployment integration shall meet the following specifications:

**5.1 CDK Orchestration**:
- Deployment shall invoke CDK programmatically via `child_process.execSync`
- Environment variables shall be passed for configuration parameters
- Deployment output shall be streamed in real-time to user
- Deployment errors shall be captured and parsed for actionable messages

**5.2 Output Capture Requirements**:
- CloudFormation stack outputs shall be extracted after deployment completion
- Webhook URL (API Gateway endpoint) shall be parsed from outputs
- ALB DNS name and other relevant outputs shall be captured
- All deployment artifacts shall be saved to XDG deploy directory

**5.3 Error Handling Contract**:
- CDK bootstrap errors shall display bootstrap command and documentation link
- IAM permission errors shall display required permissions and troubleshooting steps
- Resource limit errors shall provide guidance on quota increase requests
- Deployment failures shall preserve configuration for retry without re-entry

### SS6: Testing Strategy Specifications

The testing strategy shall meet the following specifications:

**6.1 Wizard Flow Testability**:
- Each wizard step shall be implemented as a testable function
- Step functions shall accept configuration input and return output state
- External dependencies (AWS APIs, file system) shall be mockable
- Integration tests shall mock Inquirer prompts with predetermined answers

**6.2 Validation Testing Requirements**:
- Validation functions shall be tested with valid and invalid inputs
- AWS API calls shall be mocked with realistic responses
- Error scenarios shall be tested for each validation type
- Timeout behavior shall be validated for long-running operations

**6.3 Configuration Management Testing**:
- Configuration detection logic shall be tested with various existing states
- Schema validation shall be tested with invalid configuration structures
- File system operations shall be mocked to avoid test pollution
- Concurrent access scenarios shall be tested for race conditions

**6.4 Integration Test Coverage**:
- End-to-end wizard flow shall be tested with mocked external services
- Deployment orchestration shall be tested with mocked CDK execution
- Error recovery paths shall be validated with simulated failures
- Non-interactive detection shall be tested in simulated CI environments

## Integration Points and API Contracts

### IP1: CLI Command Interface

**Contract**: `bin/cli.ts` shall expose the following command structure:

```typescript
interface CLICommand {
    name: string;
    description: string;
    action: (options: CommandOptions) => Promise<void>;
    options?: CommandOption[];
    isDefault?: boolean;
}

interface WizardCommand extends CLICommand {
    name: "setup";
    isDefault: true;
    detectInteractive(): boolean;
    executeWizard(): Promise<WizardResult>;
}
```

**Integration Requirements**:
- Wizard shall be registered as default command with Commander.js
- Existing commands shall remain registered with explicit names
- Help text shall be updated to reference wizard as primary flow

### IP2: Wizard Step Interface

**Contract**: Each wizard step shall implement a consistent interface:

```typescript
interface WizardStep {
    name: string;
    description: string;
    stepNumber: number;
    totalSteps: number;

    execute(context: WizardContext): Promise<WizardStepResult>;
    validate(context: WizardContext): Promise<ValidationResult>;
    canSkip(context: WizardContext): boolean;
}

interface WizardContext {
    config: PartialConfiguration;
    existingConfig?: Configuration;
    userChoices: Map<string, any>;
}

interface WizardStepResult {
    success: boolean;
    updatedContext: WizardContext;
    error?: WizardError;
}
```

**Integration Requirements**:
- Steps shall be executed in sequence by orchestrator
- Each step shall receive context from previous steps
- Steps shall be independently testable with mocked context

### IP3: Configuration Schema Contract

**Contract**: Configuration schema shall define the structure for all persisted state:

```typescript
interface UserConfiguration {
    benchlingTenant: string;
    benchlingAppDefinitionId: string;
    benchlingClientId: string;
    benchlingClientSecret: string;
    benchlingTestEntry?: string;
    benchlingEnableWebhookVerification?: boolean;
    benchlingLogLevel?: string;
}

interface InferredConfiguration {
    quiltStackArn: string;
    quiltBucket: string;
    quiltQueue: string;
    quiltCatalog: string;
    awsRegion: string;
    awsAccount: string;
}

interface DeploymentArtifacts {
    webhookUrl: string;
    stackName: string;
    deploymentTime: string;
    albDnsName?: string;
    secretArn: string;
}
```

**Integration Requirements**:
- Schemas shall be validated with Ajv JSON Schema validator
- Invalid configurations shall be rejected with specific error messages
- Configuration version shall be tracked for migration support

### IP4: Validation Function Contract

**Contract**: Validation functions shall implement consistent interface:

```typescript
interface ValidationFunction {
    name: string;
    description: string;

    validate(config: PartialConfiguration): Promise<ValidationResult>;
}

interface ValidationResult {
    valid: boolean;
    error?: ValidationError;
    warnings?: string[];
}

interface ValidationError {
    message: string;
    remediation: string;
    documentationLink?: string;
}
```

**Integration Requirements**:
- Validation functions shall be extracted from `scripts/install-wizard.ts`
- Functions shall be independently testable with mocked AWS APIs
- Error messages shall follow consistent format with remediation steps

### IP5: Deployment Orchestrator Contract

**Contract**: Deployment orchestration shall expose programmatic interface:

```typescript
interface DeploymentOrchestrator {
    deploy(config: DeploymentConfiguration): Promise<DeploymentResult>;
    getStatus(stackName: string): Promise<DeploymentStatus>;
    getOutputs(stackName: string): Promise<StackOutputs>;
}

interface DeploymentConfiguration {
    quiltStackArn: string;
    benchlingSecretArn: string;
    region: string;
    account: string;
    imageTag?: string;
}

interface DeploymentResult {
    success: boolean;
    stackName: string;
    outputs: StackOutputs;
    duration: number;
    error?: DeploymentError;
}
```

**Integration Requirements**:
- Deployment logic from `bin/commands/deploy.ts` shall be refactored for programmatic use
- Real-time progress shall be communicated via callbacks or event emitters
- Deployment errors shall be structured for programmatic handling

## Quality Gates and Validation Criteria

### QG1: User Experience Metrics

The system shall meet the following user experience quality gates:

**Setup Time**:
- Total time from `npx` invocation to successful test shall be under 10 minutes for users with prerequisites met
- Manual steps (Benchling app creation, webhook configuration) shall account for majority of time
- Automated steps (validation, deployment, testing) shall complete in under 5 minutes combined

**Error Recovery Time**:
- Credential validation failures shall allow retry within 30 seconds
- Deployment failures shall allow retry within 1 minute without re-entry
- Configuration corruption shall allow recovery within 2 minutes via backup restoration

**Success Rate**:
- 90% of wizard runs with valid prerequisites shall complete successfully
- Pre-flight validation shall catch 95% of configuration issues before deployment
- Integration tests shall have less than 5% false failure rate

### QG2: Code Quality Requirements

The implementation shall meet the following code quality standards:

**Type Safety**:
- All wizard functions shall have explicit TypeScript type annotations
- No `any` types shall be used without justification in code comments
- All configuration interfaces shall be exported from shared types module

**Test Coverage**:
- Wizard orchestration logic shall have minimum 90% line coverage
- Each wizard step shall have unit tests covering success and failure paths
- Integration tests shall cover end-to-end wizard flow with mocked external services
- Error handling paths shall be explicitly tested

**Code Organization**:
- Wizard implementation shall reside in `bin/commands/setup.ts` or `bin/wizard/` directory
- Shared validation logic shall be extracted to `lib/validation/` module
- Step implementations shall be separate files in `bin/wizard/steps/` directory
- Configuration schemas shall be defined in `lib/types/config-schema.ts`

**Documentation**:
- Each wizard step shall have JSDoc comments explaining purpose and behavior
- Complex validation logic shall have inline comments explaining rationale
- Error messages shall reference documentation when appropriate
- Configuration schema shall be documented with JSON Schema descriptions

### QG3: Backward Compatibility Requirements

The implementation shall maintain backward compatibility:

**Existing Command Preservation**:
- All existing CLI commands shall function identically with explicit invocation
- Environment variable-based configuration shall continue working
- `.env` file support shall be maintained for local development workflows
- npm scripts (`npm run setup`, `npm run deploy:dev`) shall continue functioning

**Configuration Migration**:
- Existing XDG configurations shall be detected and remain usable
- Configuration version mismatches shall trigger automatic migration
- Deprecated configuration keys shall be migrated with warnings
- Multiple configuration profiles shall continue working

**CI/CD Compatibility**:
- Non-interactive environments shall gracefully exit without wizard launch
- Explicit commands with options shall continue working in scripts
- Environment variable overrides shall take precedence over wizard configuration
- Exit codes shall remain consistent with existing behavior

### QG4: Security and Reliability Requirements

The implementation shall meet security and reliability standards:

**Credential Handling**:
- Secrets shall never be logged to console or files
- Credential prompts shall use masked input (Inquirer password type)
- AWS Secrets Manager shall be preferred over environment variables
- Configuration files shall have restrictive permissions (0600)

**Error Handling**:
- All external API calls shall have timeout configurations
- Network failures shall be retryable with exponential backoff
- Unhandled promise rejections shall be caught and logged
- Stack traces shall be suppressed in user-facing error messages

**Validation Rigor**:
- User inputs shall be validated before use in API calls
- Configuration schemas shall enforce required fields and data types
- AWS ARNs shall be parsed and validated before use
- URLs shall be validated with proper URL parsing

**Audit Trail**:
- All configuration changes shall be logged with timestamps
- Deployment operations shall be logged to CloudWatch
- Wizard completion shall log summary to local file
- Error scenarios shall log full context for debugging

### QG5: Documentation Completeness

The documentation shall meet the following requirements:

**README Simplification**:
- Primary Quick Start section shall show only `npx @quiltdata/benchling-webhook` command
- Prerequisites shall be listed clearly with installation links
- Troubleshooting section shall cover common wizard issues
- Advanced usage shall be moved to separate documentation files

**In-Wizard Help**:
- Each manual step shall provide clear, numbered instructions
- Credential prompts shall include hints on where to find values
- Error messages shall include remediation steps and documentation links
- Success messages shall confirm what was accomplished

**Developer Documentation**:
- CLAUDE.md shall document wizard architecture and design decisions
- Code comments shall explain complex validation logic
- Testing strategy shall be documented with examples
- Integration points shall be documented with interface contracts

## Technical Uncertainties and Risks

### TU1: CDK Output Capture Reliability

**Uncertainty**: Reliably extracting webhook URL from CDK deployment output

**Risk Level**: Medium

**Description**: The current deployment approach uses `execSync` with streaming output, making it challenging to programmatically extract specific output values like the webhook URL. CloudFormation stack outputs must be queried separately after deployment.

**Mitigation Options**:
1. Parse CloudFormation stack outputs using AWS SDK after deployment completion
2. Use CDK programmatic API instead of CLI invocation for better control
3. Implement structured logging in CDK constructs to emit outputs in parseable format

**Decision Required**: Select output capture approach and validate reliability

### TU2: Long-Running Operation User Experience

**Uncertainty**: Maintaining user engagement during 5-10 minute deployment

**Risk Level**: Medium

**Description**: CDK deployment can take 5-10 minutes, during which the wizard must keep the user informed and prevent perception that the process has hung. Real-time progress from CloudFormation is difficult to extract from CDK CLI.

**Mitigation Options**:
1. Display estimated time remaining with periodic updates
2. Show CloudFormation event stream to demonstrate progress
3. Provide contextual information about what's being deployed
4. Allow user to background process and check status later

**Decision Required**: Define progress indication strategy for long operations

### TU3: Quilt Configuration Inference Reliability

**Uncertainty**: Matching `quilt3 config` catalog URL to CloudFormation stack

**Risk Level**: Low

**Description**: The inference logic assumes catalog URL in `quilt3 config` matches a CloudFormation stack output, but users may have multiple Quilt stacks or mismatched configurations.

**Mitigation Options**:
1. Prompt user to select stack when multiple matches found
2. Allow manual override if automatic detection fails
3. Validate inferred configuration before proceeding
4. Provide clear instructions for running `quilt3 config` if not found

**Decision Required**: Define fallback strategy when inference fails

### TU4: Non-Interactive Environment Detection Edge Cases

**Uncertainty**: Reliably detecting all non-interactive environments (CI/CD, scripts)

**Risk Level**: Low

**Description**: `process.stdin.isTTY` check may not catch all non-interactive scenarios, particularly in containerized environments or remote execution contexts.

**Mitigation Options**:
1. Check multiple indicators (`isTTY`, environment variables, stdin readability)
2. Add timeout to interactive prompts with fallback to non-interactive error
3. Document explicit `--non-interactive` flag for forcing non-wizard behavior
4. Test in multiple CI environments (GitHub Actions, GitLab CI, Jenkins)

**Decision Required**: Define comprehensive non-interactive detection strategy

### TU5: Configuration Corruption Recovery

**Uncertainty**: Handling partial or corrupt configuration states gracefully

**Risk Level**: Low

**Description**: Users may manually edit XDG configuration files and introduce errors, or process may be killed during write operations, leaving corrupt state.

**Mitigation Options**:
1. Implement atomic configuration writes with temporary files and rename
2. Create automatic backup before any configuration modification
3. Validate schema on every configuration read with automatic recovery
4. Provide explicit "reset configuration" command for manual recovery

**Decision Required**: Define configuration recovery strategy and user communication

## Success Criteria

The implementation shall be considered successful when:

1. **Primary User Journey**: A user can run `npx @quiltdata/benchling-webhook` and complete entire setup in under 10 minutes with clear guidance at each step

2. **Validation Effectiveness**: Pre-deployment validation catches 95% of configuration issues before starting time-consuming deployment operations

3. **Error Recovery**: Users can recover from common errors (credential mistakes, deployment failures) without restarting wizard from beginning

4. **Documentation Clarity**: 95% of users complete setup without needing to consult external documentation beyond in-wizard instructions

5. **Backward Compatibility**: All existing CLI commands, npm scripts, and CI/CD workflows continue functioning without modification

6. **Code Quality**: Implementation achieves 90% test coverage with clear separation of concerns and maintainable architecture

7. **User Satisfaction**: Post-setup survey indicates 90% user satisfaction with setup experience compared to previous multi-step process

## Out of Scope

The following items are explicitly excluded from this implementation:

1. **Multi-Profile Management UI**: Wizard creates single default profile; advanced profile management remains CLI-based
2. **Configuration Migration Tool**: Automatic migration from `.env` to XDG is not included
3. **Rollback Capability**: Automated rollback of failed deployments is not included
4. **Webhook Testing Without Test Entry**: Wizard does not create test entries programmatically
5. **Custom CDK Synthesis**: Advanced CDK customization remains power-user territory
6. **Graphical User Interface**: Wizard is terminal-based; web UI is not included
7. **Benchling App Auto-Creation**: Manifest upload and app creation remain manual steps
8. **Multi-Region Deployment**: Wizard deploys to single region; multi-region is power-user workflow

## Related Issues and Dependencies

This implementation builds upon:

- **XDG Configuration System**: `lib/xdg-config.ts` provides configuration persistence foundation
- **Validation Infrastructure**: `scripts/install-wizard.ts` provides credential validation functions
- **Quilt Inference**: `scripts/infer-quilt-config.ts` provides CloudFormation stack detection
- **Manifest Generation**: `bin/commands/manifest.ts` provides Benchling app manifest creation
- **Deployment Orchestration**: `bin/commands/deploy.ts` provides CDK deployment execution
- **Integration Testing**: `bin/commands/test.ts` provides webhook validation capabilities

This implementation does not modify:

- **Infrastructure Constructs**: CDK stack definitions in `lib/` remain unchanged
- **Docker Application**: Flask webhook processor in `docker/` remains unchanged
- **Python Testing**: Integration test scripts remain unchanged
- **CI/CD Pipelines**: GitHub Actions workflows remain unchanged
