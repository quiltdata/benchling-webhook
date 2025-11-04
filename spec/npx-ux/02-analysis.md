# Analysis Document

## GitHub Issue Reference

**Issue Number**: #182
**Issue Title**: NPX UX: Simple guided setup wizard
**Branch**: npx-ux
**Version**: 0.6.1 (no version change)

## Current State Assessment

### 1. CLI Architecture and Entry Points

#### 1.1 Current CLI Structure (bin/cli.ts)

The CLI uses Commander.js with the following command structure:

1. **deploy** (default command) - Lines 23-56
   - Currently the default when no command is specified
   - Accepts extensive options (--quilt-stack-arn, --benchling-secret, etc.)
   - Focused on deployment execution, not setup
   - No welcoming guidance for first-time users

2. **init** - Lines 58-73
   - Creates `.env` files for developer workflow
   - Does not integrate with npx one-command workflow
   - Separate from the XDG configuration system
   - Developer-centric, not end-user focused

3. **validate** - Lines 75-88
   - Validates configuration but requires existing config
   - Not part of setup flow

4. **test** - Lines 90-102
   - Tests deployed endpoint
   - Separate from setup flow

5. **manifest** - Lines 104-116
   - Generates Benchling app manifest
   - Standalone command, not integrated into wizard

**Challenge**: Lines 119-121 show that when no command is provided, the CLI displays help text rather than launching a wizard. This is the opposite of the requirement "no command = runs setup wizard".

#### 1.2 CLI Default Behavior Gap

**Current**: `npx @quiltdata/benchling-webhook` displays help menu
**Required**: Should launch interactive setup wizard
**Gap**: Need to modify default behavior to invoke wizard instead of help

### 2. Existing Wizard Infrastructure

#### 2.1 install-wizard.ts (scripts/install-wizard.ts)

**Strengths**:
- Comprehensive configuration collection (Steps 1-7, lines 328-738)
- Inquirer-based interactive prompts
- Validation for Benchling tenant, OAuth credentials, and S3 buckets
- XDG configuration persistence
- AWS Secrets Manager integration
- Non-interactive mode support

**Architecture**:
- Wizard is designed as an npm script (`npm run setup`)
- Developer-focused workflow (local development setup)
- Uses XDG config but doesn't guide through Benchling app creation
- No deployment orchestration
- No post-deployment testing

**Gaps**:
1. **No manifest generation step** - Doesn't start with Benchling app creation
2. **No deployment execution** - Saves config but doesn't deploy
3. **No webhook configuration instructions** - Doesn't guide user to set webhook URL
4. **No integration testing** - Doesn't validate end-to-end functionality
5. **Separate from CLI commands** - Not accessible via npx default behavior

#### 2.2 Validation Functions (lines 54-257)

Existing validation capabilities:
- `validateBenchlingTenant()` - HTTP accessibility check
- `validateBenchlingCredentials()` - OAuth token acquisition test
- `validateS3BucketAccess()` - S3 HeadBucket and ListObjects operations
- `verifyCDKDeploymentAccount()` - STS GetCallerIdentity

**Strength**: Robust validation infrastructure already exists
**Challenge**: Validation happens after config collection, not pre-deployment

### 3. Quilt Configuration Inference

#### 3.1 infer-quilt-config.ts (scripts/infer-quilt-config.ts)

**Capabilities**:
- Executes `quilt3 config` CLI command to get catalog URL
- Lists CloudFormation stacks to find Quilt deployments
- Extracts stack outputs (bucket, database, queue ARN, catalog URL)
- Interactive stack selection when multiple found
- Non-interactive mode with fallback to first stack

**Architecture** (lines 202-297):
1. Check quilt3 CLI for catalog URL
2. Search CloudFormation for Quilt stacks
3. Match catalog URL to stack or prompt for selection
4. Extract and populate configuration

**Strengths**:
- Well-designed inference logic
- Handles multiple stack scenarios
- Good error handling

**Gaps**:
1. Runs as separate script, not integrated into wizard flow
2. No clear user guidance when quilt3 not found
3. No retry mechanism if inference fails

### 4. Configuration Management

#### 4.1 XDG Configuration System (lib/xdg-config.ts)

**Architecture**:
- Three-file configuration model:
  - `default.json` (user config)
  - `config/default.json` (derived/inferred config)
  - `deploy/default.json` (deployment artifacts)
- Profile support (default, dev, prod) - lines 369-639
- JSON schema validation with Ajv - lines 46-95
- Atomic writes with backup - lines 283-332

**Strengths**:
- Robust configuration persistence
- Profile isolation for multiple environments
- Schema validation prevents corruption

**Challenges**:
1. **Complexity barrier** - Three-file model not obvious to end users
2. **No guided creation** - Assumes user knows what to configure
3. **Profile concept** - May confuse first-time users
4. **Manual directory creation** - Need explicit directory setup

#### 4.2 Configuration Resolver Pattern

From `lib/utils/config-resolver.ts` (referenced in deploy.ts lines 8-11):
- `parseStackArn()` - Extracts region, account, stackName from ARN
- `extractStackOutputs()` - Fetches CloudFormation stack outputs
- `ConfigResolverError` - Structured error handling

**Strength**: Clean separation of concerns for stack introspection

### 5. Command Implementations

#### 5.1 manifest.ts (bin/commands/manifest.ts)

**Current Flow**:
1. Loads config using `loadConfigSync()`
2. Generates YAML manifest with hardcoded structure
3. Writes to file (default: `app-manifest.yaml`)
4. Displays boxed next steps

**Strengths**:
- Clear next-step instructions (lines 44-53)
- Links to Benchling documentation

**Gaps**:
1. No pause for user confirmation
2. No validation that manifest was uploaded
3. Not integrated into larger wizard flow

#### 5.2 init.ts (bin/commands/init.ts)

**Purpose**: Generate `.env` files for developer workflow

**Architecture**:
- Prompts for catalog, bucket, tenant, credentials (lines 55-107)
- Attempts inference if `--infer` flag set
- Writes `.env` file with structured comments

**Challenge**: This is `.env`-based, not XDG-based. Creates parallel configuration system that conflicts with install-wizard.ts XDG approach.

**Gap**: Developer tool, not suitable for end-user npx workflow

#### 5.3 deploy.ts (bin/commands/deploy.ts)

**Current Flow** (lines 48-200+):
1. Validate required parameters (quiltStackArn, benchlingSecret)
2. Parse stack ARN
3. Check if secret exists in Secrets Manager
4. Prompt to create secret if missing (calls config command)
5. Check CDK bootstrap status
6. Display deployment plan
7. Execute CDK deploy

**Strengths**:
- Good validation and error messages
- Bootstrap checking prevents deployment failures
- Secrets Manager integration

**Gaps**:
1. Assumes secrets already created or prompts for npm script
2. No post-deployment webhook configuration guidance
3. No integration testing after deployment
4. Deployment-focused, not setup-focused

### 6. Testing Infrastructure

From package.json scripts (lines 29-38):
- `test` - Typecheck + TS tests + Python tests
- `test:local` - Docker build + local Flask test
- `test:remote` - Deploy dev + test deployed endpoint
- `test:ci` - Typecheck + TS tests only

**Observation**: `test:remote` includes deployment, suggesting deployment+test orchestration exists

**Gap**: No `test.ts` command integration with setup wizard for automatic validation

### 7. Documentation Structure

#### 7.1 README.md Current State

**Structure** (from lines 1-150):
1. Prerequisites section (lines 5-10)
2. Four-step setup process:
   - Create Benchling app (manifest command)
   - Store secrets in AWS Secrets Manager (manual aws cli)
   - Deploy to AWS (deploy command)
   - Install in Benchling (manual)

**Challenges**:
1. **Multi-step complexity** - Four separate steps, not one command
2. **Technical prerequisites** - Assumes AWS CLI knowledge
3. **Manual secret creation** - AWS CLI command required
4. **Developer focus** - References Secrets Manager, CloudFormation

**Gap**: No prominent "one-command setup" experience as required by AC10

#### 7.2 CLAUDE.md Developer Guide

From CLAUDE.md (lines 1-400+):
- Comprehensive developer documentation
- Setup, architecture, testing, deployment workflows
- Power user focused

**Observation**: This is the right level of detail for power users, but overwhelming for end users seeking simple setup

### 8. Current Workflow Sequence Issues

#### 8.1 Configuration Workflow Fragmentation

**Current pathways**:
1. **Developer path**: `npm run setup` → XDG config → manual deployment
2. **npx manifest path**: `npx ... manifest` → manual Benchling upload → manual secret creation → `npx ... deploy`
3. **npx init path**: `npx ... init` → `.env` file → manual deployment

**Challenge**: Three different workflows with overlapping but incompatible configuration approaches

#### 8.2 Manual Steps Required

Current manual intervention points:
1. Generate manifest
2. Upload manifest to Benchling
3. Copy App Definition ID
4. Create AWS secret with credentials
5. Deploy stack
6. Copy webhook URL
7. Configure webhook in Benchling
8. Test integration

**Gap**: Eight manual steps vs. requirement for guided single flow

### 9. Error Handling and User Guidance

#### 9.1 Current Error Messages

**Positive examples**:
- deploy.ts lines 31-41: Clear error for missing --quilt-stack-arn with usage example
- deploy.ts lines 177-187: Helpful explanation of CDK bootstrap with command

**Gaps**:
1. No recovery prompts in most commands
2. No "go back" capability in wizards
3. Limited help resources for errors

#### 9.2 Progress Indication

**Current state**:
- Ora spinners used in deploy.ts and init.ts
- No overall progress indicator across multi-step workflow
- No saved state for resumption

**Gap**: AC1 requirement for "progress indicator showing current step and total steps" not implemented

### 10. Deployment Orchestration

#### 10.1 CDK Execution Pattern

From deploy.ts:
- Uses `execSync()` to call CDK CLI commands
- Passes environment variables for configuration
- Synchronous execution with spinner indicators

**Challenge**: Tightly coupled to CDK CLI, difficult to extract progress information

#### 10.2 Post-Deployment Artifact Capture

**Current state**: deployment.ts execution, but unclear where webhook URL is captured

**Gap**: No clear mechanism to extract deployment outputs for display to user

### 11. Integration Testing Capabilities

From bin/commands/test.ts (not read yet, but referenced):
- Exists as separate command
- Requires webhook URL

**Gap**: Not integrated into setup flow, user must manually invoke

### 12. Code Quality and Patterns

#### 12.1 Positive Patterns Observed

1. **TypeScript strict mode** - Good type safety
2. **Commander.js** - Standard CLI framework
3. **Inquirer/Enquirer** - Interactive prompts with validation
4. **Ora** - Clear spinner feedback
5. **Boxen** - Attractive terminal output
6. **Chalk** - Colored output for emphasis

#### 12.2 Architectural Idioms to Maintain

1. **Command pattern** - Separate command files in bin/commands/
2. **Async/await** - Modern promise handling
3. **Structured errors** - ConfigResolverError pattern
4. **Validation functions** - Separate, testable validation logic
5. **Configuration separation** - User vs. derived vs. deployment

### 13. Technical Debt and Refactoring Opportunities

#### 13.1 Configuration System Duplication

**Issue**: Two parallel configuration systems:
1. `.env` files (init.ts, historical)
2. XDG configuration (install-wizard.ts, current)

**Debt**: init.ts should be deprecated or refactored to use XDG

#### 13.2 Command Fragmentation

**Issue**: Related functionality spread across:
- CLI commands (bin/commands/)
- Scripts (scripts/)
- npm scripts (package.json)

**Opportunity**: Consolidate setup-related functionality into unified wizard orchestrator

#### 13.3 Validation Duplication

**Observation**:
- Validation in install-wizard.ts
- Validation in deploy.ts (secret existence, bootstrap)
- Validation in validate.ts command

**Opportunity**: Extract to shared validation module

### 14. Architectural Challenges

#### 14.1 CLI Default Behavior Change

**Challenge**: Changing default command from deploy to wizard
- Commander.js uses `isDefault: true` flag (line 24)
- Need to ensure backward compatibility with explicit `deploy` command
- Help display logic needs adjustment (lines 119-121)

#### 14.2 Wizard State Management

**Challenge**: Supporting interruption and resumption
- XDG config provides persistence
- Need to detect partial configuration
- Need to offer resume vs. restart options

**Risk**: Complexity vs. user benefit tradeoff

#### 14.3 Non-Interactive Detection

**Challenge**: Wizard should fail gracefully in CI/CD
- stdin.isTTY detection needed
- Clear error message required
- Documentation for non-interactive alternatives

#### 14.4 Progress Persistence Granularity

**Challenge**: How much state to save between steps?
- After each prompt? (Very granular, complex)
- After each section? (Step 1, Step 2, etc.)
- After critical milestones only? (Simpler, less recovery)

#### 14.5 Deployment Integration

**Challenge**: Wizard needs to call CDK deploy and capture output
- Deploy command uses execSync with streaming output
- Need to capture webhook URL from deployment
- Need to handle deployment errors gracefully
- Long-running operation (several minutes)

### 15. Constraints and Limitations

#### 15.1 External Dependencies

**Quilt3 CLI**:
- Not guaranteed to be installed
- Inference depends on it (infer-quilt-config.ts line 58)
- Requirement: Support manual fallback

**AWS CDK**:
- Required for deployment
- Package.json shows it as devDependency
- Challenge: May not be available in npx context

**Docker**:
- Required for building webhook processor
- Not part of this wizard scope (deployment handles it)

#### 15.2 AWS API Constraints

**CloudFormation**:
- Stack outputs may not be immediately available
- API rate limiting possible with many stacks
- Cross-region complexity

**Secrets Manager**:
- Permission requirements (CreateSecret, DescribeSecret)
- Secret naming constraints
- Cost implications (mentioned in deploy.ts logic)

#### 15.3 Benchling API Constraints

**Manual steps required**:
- App manifest upload (no programmatic API)
- App installation (requires admin permissions)
- Webhook URL configuration (manual web UI operation)

**Validation limitations**:
- OAuth token validation requires valid credentials
- Test entry may not exist
- Webhook signature verification requires deployment

### 16. Gap Analysis

#### 16.1 Requirements vs. Current State

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| AC1: Default wizard behavior | Help displayed | Need to change default command |
| AC2: Manifest generation | Separate command | Need to integrate into wizard flow |
| AC3: Credential collection | In install-wizard.ts | Need to integrate into wizard |
| AC4: Quilt auto-config | Separate script | Need to integrate inference |
| AC5: Pre-deployment validation | Partial in install-wizard | Need comprehensive validation |
| AC6: Automated deployment | Separate command | Need to orchestrate in wizard |
| AC7: Webhook instructions | Not present | Need to add guidance step |
| AC8: Auto integration test | Separate command | Need to integrate test.ts |
| AC9: Config persistence | XDG system exists | Need to detect/reuse existing |
| AC10: README simplification | Multi-step manual | Need to rewrite for one-command |
| AC11: Error recovery | Limited | Need back navigation and resume |
| AC12: Non-interactive mode | Partial in install-wizard | Need wizard-level detection |

#### 16.2 Component Reusability Assessment

**Highly reusable** (minimal changes needed):
- Quilt inference logic (infer-quilt-config.ts)
- Validation functions (install-wizard.ts lines 54-257)
- XDG configuration system (lib/xdg-config.ts)
- Manifest generation (manifest.ts)

**Moderately reusable** (interface changes needed):
- Deploy command (needs to be callable programmatically)
- Test command (needs to be callable programmatically)
- Configuration collection (install-wizard.ts prompts)

**Not reusable** (conflicts with requirements):
- init.ts (`.env`-based, developer-focused)
- Current CLI default behavior (help display)

### 17. User Experience Challenges

#### 17.1 Complexity Barriers

**Technical terminology**:
- CloudFormation stack ARNs
- Secrets Manager
- OAuth client credentials
- App Definition ID

**Challenge**: Need to provide context and help text without overwhelming users

#### 17.2 Long-Running Operations

**Deployment timing**:
- CDK synth + deploy can take 5-10 minutes
- Docker image build + push time
- CloudFormation stack creation

**Challenge**: Keep user engaged during wait, provide progress updates

#### 17.3 Manual Interruptions

**Benchling-side steps**:
1. Upload manifest (web UI, can't automate)
2. Install app (requires admin, can't automate)
3. Configure webhook (web UI, can't automate)

**Challenge**: Clear pause points with "Press Enter when ready" prompts

#### 17.4 Error Attribution

**Ambiguous failures**:
- Is OAuth failure due to wrong credentials or network?
- Is S3 failure due to permissions or bucket name?
- Is deployment failure due to CDK, IAM, or resource limits?

**Challenge**: Provide actionable error messages with suggested fixes

### 18. Design Considerations

#### 18.1 Wizard Flow Architecture

**Options**:
1. **Linear wizard** - Single long function with sequential steps
   - Pros: Simple, clear flow
   - Cons: Hard to test, difficult to modify

2. **Step-based wizard** - Array of step objects with execute methods
   - Pros: Modular, testable, resumable
   - Cons: More complex, more files

3. **State machine** - Explicit state transitions
   - Pros: Maximum flexibility, clear states
   - Cons: High complexity, over-engineering risk

**Recommendation**: Step-based approach balances modularity with simplicity

#### 18.2 Progress Tracking

**Options**:
1. Step counter (Step 1 of 8)
2. Progress bar
3. Checklist display
4. Milestone-based ("Configuration → Deployment → Testing")

**Consideration**: Step counter aligns with requirement AC1

#### 18.3 Configuration Reuse Strategy

**Scenarios**:
1. Fresh install (no existing config)
2. Partial config (user interrupted)
3. Complete config (re-run wizard)
4. Multiple profiles (dev, prod)

**Challenge**: Detecting state and offering appropriate options

### 19. Testing Implications

#### 19.1 Wizard Testing Challenges

**Manual steps**:
- Can't fully automate Benchling interactions
- Can't test actual webhook URL configuration

**Approach**: Mock external services, test wizard logic separately

#### 19.2 Integration Testing

**Current test infrastructure**:
- `test:local` - Docker-based
- `test:remote` - Full deployment test

**Gap**: Wizard flow testing needs separate test suite

### 20. Backward Compatibility Concerns

#### 20.1 Existing Users

**Current workflows must continue working**:
- `npx ... deploy` with explicit parameters
- `npm run setup` for developer workflow
- `.env` files in git repositories

**Challenge**: Wizard as default shouldn't break existing scripts/CI

#### 20.2 Configuration Migration

**Existing XDG configurations**:
- Users who ran `npm run setup` already have config
- Wizard should detect and offer to use/update

**Challenge**: Smooth transition path

### 21. Documentation Challenges

#### 21.1 Audience Segmentation

**Three distinct audiences**:
1. End users (want simple setup)
2. Power users (want control and options)
3. Developers (want architecture details)

**Challenge**: README must satisfy all three without overwhelming anyone

#### 21.2 Help Text Discoverability

**Current state**:
- Help text in command definitions
- Examples in README
- Detailed docs in CLAUDE.md

**Gap**: In-wizard help not yet designed

## Summary of Key Challenges

### High Priority Challenges

1. **CLI default behavior change** - Requires careful Commander.js configuration and backward compatibility testing
2. **Wizard orchestration architecture** - Need to design step-based system that integrates existing components
3. **Deployment output capture** - Extract webhook URL from CDK execution for display
4. **Manual step guidance** - Clear instructions at pause points for Benchling web UI operations
5. **Configuration detection and reuse** - Detect existing XDG config and offer appropriate options

### Medium Priority Challenges

6. **Progress indication** - Implement step counter and spinner feedback
7. **Error recovery** - Add back navigation and resume capabilities
8. **Non-interactive detection** - Graceful failure with clear guidance
9. **Validation consolidation** - Extract common validation patterns to shared module
10. **Documentation restructuring** - Simplify README for end users, preserve detail elsewhere

### Lower Priority Challenges

11. **Configuration system unification** - Deprecate `.env` approach in favor of XDG
12. **Testing infrastructure** - Add wizard-specific test coverage
13. **Profile management** - Clarify when/how to use profiles
14. **Help text expansion** - Add contextual help throughout wizard

## Next Steps

This analysis identifies the current state and challenges. The next document (03-specifications.md) will define the desired end state and success criteria for addressing these challenges.
