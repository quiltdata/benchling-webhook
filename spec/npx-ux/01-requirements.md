# Requirements Document

## GitHub Issue Reference

**Issue Number**: #182
**Issue Title**: NPX UX: Simple guided setup wizard
**Branch**: npx-ux
**Version**: 0.6.1 (no version change)

## Problem Statement

End users currently face complexity when setting up the Benchling webhook integration. The current workflow requires manual steps to generate manifests, create Benchling apps, configure credentials, and deploy to AWS. The goal is to provide a seamless, guided setup experience where users run a single command and are walked through the entire process with clear instructions at each step.

## User Stories

### Story 1: One-Command Setup Experience
**As an** end user new to Benchling webhook integration
**I want** to run a single npx command without any configuration
**So that** I can start the setup process immediately without reading documentation

### Story 2: Guided Manifest Generation
**As an** end user
**I want** the wizard to generate the Benchling app manifest automatically
**So that** I have the correct manifest file ready to upload to Benchling

### Story 3: Clear Manual Step Instructions
**As an** end user
**I want** clear, step-by-step instructions when the wizard pauses for manual actions
**So that** I know exactly what to do in the Benchling web interface

### Story 4: Automatic Quilt Configuration Detection
**As an** end user with an existing Quilt deployment
**I want** the wizard to auto-detect my Quilt configuration via `quilt3 config` CLI
**So that** I do not have to manually enter S3 bucket names, SQS queue ARNs, and catalog URLs

### Story 5: Pre-Deployment Credential Validation
**As an** end user
**I want** my Benchling credentials validated before deployment starts
**So that** I do not waste time on a failed deployment due to incorrect credentials

### Story 6: Automated AWS Deployment
**As an** end user
**I want** the wizard to automatically deploy the stack to AWS after configuration
**So that** I do not have to run separate deployment commands

### Story 7: Webhook Configuration Instructions
**As an** end user
**I want** clear instructions on configuring the webhook URL in Benchling after deployment
**So that** I can complete the integration setup successfully

### Story 8: Automatic Integration Testing
**As an** end user
**I want** the wizard to automatically test the webhook integration after deployment
**So that** I have confidence the integration is working before I leave the setup process

### Story 9: Simple README Documentation
**As an** end user
**I want** the README to show only the one-command setup experience
**So that** I am not overwhelmed with technical details for power users

## Acceptance Criteria

### AC1: Default Wizard Behavior
1. Running `npx @quiltdata/benchling-webhook` with no command defaults to running the setup wizard
2. Running `npx @quiltdata/benchling-webhook setup` explicitly invokes the setup wizard
3. The wizard provides a welcoming introduction explaining what it will do
4. The wizard displays a progress indicator showing current step and total steps

### AC2: Manifest Generation Step
1. Wizard generates a Benchling app manifest file automatically
2. Manifest is saved to a well-known location (e.g., `benchling-app-manifest.yaml`)
3. Wizard displays clear instructions on how to upload the manifest to Benchling
4. Wizard provides a direct link to Benchling app creation documentation
5. Wizard pauses and waits for user confirmation that the app was created

### AC3: Benchling Credential Collection
1. After manifest upload confirmation, wizard prompts for Benchling credentials
2. Wizard asks for: Tenant name, App Definition ID, Client ID, Client Secret
3. Wizard provides helpful hints for where to find each credential in Benchling
4. Wizard validates that all required fields are provided before proceeding

### AC4: Automatic Quilt Configuration
1. Wizard attempts to auto-detect Quilt config by running `quilt3 config` CLI command
2. If `quilt3` is not available, wizard provides clear error message with installation instructions
3. If Quilt config is found, wizard extracts catalog URL, S3 bucket, and region
4. Wizard displays detected configuration and asks user to confirm accuracy
5. If detection fails or user declines, wizard provides fallback manual entry prompts

### AC5: Pre-Deployment Validation
1. Wizard validates Benchling tenant accessibility by checking tenant URL
2. Wizard validates OAuth credentials by attempting to obtain an access token
3. Wizard validates S3 bucket access by performing a list objects operation
4. Wizard validates AWS credentials and permissions before deployment
5. Wizard displays clear error messages for any validation failures
6. Wizard allows user to retry credential entry if validation fails

### AC6: Automated Deployment
1. After successful validation, wizard displays a deployment summary
2. Wizard prompts user to confirm deployment with "yes/no" prompt
3. Wizard executes CDK deployment with appropriate parameters
4. Wizard displays deployment progress with clear status indicators
5. Wizard captures and stores the webhook URL from deployment outputs
6. Wizard handles deployment errors gracefully with actionable error messages

### AC7: Webhook Configuration Instructions
1. After successful deployment, wizard displays the webhook URL prominently
2. Wizard provides step-by-step instructions for configuring the webhook in Benchling
3. Wizard includes a direct link to Benchling webhook configuration documentation
4. Wizard pauses and waits for user confirmation that webhook is configured

### AC8: Automatic Integration Testing
1. After webhook configuration confirmation, wizard runs integration test automatically
2. Wizard uses the test entry ID if provided by user
3. Wizard displays test progress and results in real-time
4. Wizard provides clear success or failure indication
5. If test fails, wizard displays troubleshooting suggestions
6. Wizard allows user to retry the test if it fails

### AC9: Configuration Persistence
1. Wizard saves all configuration to XDG config directory for future use
2. Re-running wizard detects existing configuration and offers to update it
3. Wizard provides option to start fresh or use existing configuration
4. Wizard syncs secrets to AWS Secrets Manager for secure storage

### AC10: README Simplification
1. README documents the single command experience prominently at the top
2. README shows `npx @quiltdata/benchling-webhook` as the primary setup method
3. Technical details and power-user options are moved to separate documentation sections
4. README includes a "Quick Start" section showing only the essential one-command workflow

### AC11: Error Recovery
1. Wizard allows user to go back to previous steps if errors occur
2. Wizard saves progress so user can resume if interrupted
3. Wizard provides clear error messages with suggested remediation
4. Wizard offers help resources for common error scenarios

### AC12: Non-Interactive Mode
1. Wizard detects when running in non-interactive environment (CI/CD)
2. Wizard gracefully exits with helpful error message if required input is missing
3. Wizard documentation explains how to pre-configure for non-interactive use

## High-Level Implementation Approach

The implementation will build upon the existing setup infrastructure while adding a cohesive guided experience:

1. **CLI Default Command**: Modify `bin/cli.ts` to make the wizard the default command when no command is provided, providing a seamless entry point for new users

2. **Unified Wizard Flow**: Create a new orchestrator script that sequences existing components (manifest generation, credential collection, Quilt inference, validation, deployment, testing) into a single guided flow

3. **Reuse Existing Components**: Leverage existing functionality from `scripts/install-wizard.ts`, `scripts/infer-quilt-config.ts`, `bin/commands/manifest.ts`, `bin/commands/deploy.ts`, and `bin/commands/test.ts` to avoid duplication

4. **Enhanced User Guidance**: Add clear instructional text, progress indicators, and pause points at manual steps to guide users through the Benchling-specific actions

5. **Automatic Progression**: Connect each step automatically so the wizard flows from manifest generation through deployment and testing without requiring separate command invocations

6. **README Restructuring**: Update the README to emphasize the one-command experience while preserving detailed documentation in separate files for power users

## Success Metrics

### Metric 1: Setup Time Reduction
- Time from `npx` command to working webhook integration
- Target: Under 10 minutes for first-time setup with clear instructions
- Measured by timing wizard execution from start to successful test

### Metric 2: Setup Success Rate
- Percentage of wizard runs that complete successfully
- Target: 90%+ success rate for users with valid prerequisites
- Measured by tracking wizard completion vs. early exits

### Metric 3: User Error Rate
- Frequency of credential validation failures per user
- Target: Less than 2 retry attempts per credential type on average
- Measured by tracking validation retry counts

### Metric 4: Documentation Clarity
- Percentage of users who complete setup without external help
- Target: 95%+ completion without needing to consult additional documentation
- Measured by user feedback and support ticket analysis

### Metric 5: Manual Step Completion
- Time spent at Benchling manual step pause points
- Target: Under 3 minutes per manual step with clear instructions
- Measured by timing pause duration during wizard execution

### Metric 6: Configuration Reusability
- Percentage of repeat wizard runs that successfully reuse existing configuration
- Target: 100% reuse for valid stored configuration
- Measured by tracking XDG config read success rate

## Open Questions

### Question 1: Wizard Command Name
**Question**: Should the wizard be invoked with a dedicated command name (e.g., `setup`, `wizard`, `init`) or should it be the default when no command is provided?

**Context**: The issue requests "no command = runs setup wizard" but we need to determine if we should also support an explicit command name for clarity. The current `init` command exists but has different functionality.

**Recommendation**: Make it the default (no command) and also support explicit `setup` command, while deprecating or repurposing the current `init` command.

### Question 2: Quilt Configuration Prerequisite
**Question**: Should the wizard require `quilt3` CLI to be installed and configured before running, or should it support manual entry as a fallback?

**Context**: The issue states "Auto-detects Quilt config via `quilt3 config` CLI" but does not specify behavior if `quilt3` is unavailable.

**Recommendation**: Support both automatic detection and manual fallback, with clear guidance on installing `quilt3` if not found.

### Question 3: Test Entry Requirement
**Question**: Is a Benchling test entry ID required for the automatic integration test, or should the wizard support creating a test entry on-the-fly?

**Context**: Testing requires a valid Benchling entry to trigger the webhook, but creating an entry programmatically may require additional API permissions.

**Recommendation**: Make test entry ID optional in the wizard; if not provided, skip the automatic test and provide manual testing instructions.

### Question 4: Existing Configuration Behavior
**Question**: When re-running the wizard with existing configuration, should it update in place or create a new profile?

**Context**: Users may want to update credentials or redeploy without starting from scratch.

**Recommendation**: Detect existing configuration and offer three options: update existing, start fresh, or cancel. Default to update existing.

### Question 5: Progress Persistence Scope
**Question**: Should the wizard save progress after each step to support resumption, or is it acceptable to restart from the beginning if interrupted?

**Context**: Deployment can take several minutes; supporting resume would improve UX but adds complexity.

**Recommendation**: Save configuration after each completed step but require re-running deployment if interrupted during that phase. Document how to manually resume deployment if needed.

### Question 6: CI/CD Use Case Support
**Question**: Should the wizard support a fully non-interactive mode for CI/CD pipelines, or should those use cases continue using explicit commands?

**Context**: The issue states "Target = end users only - Not power users, not CI/CD" but we should clarify the boundary.

**Recommendation**: Wizard is interactive-only; CI/CD should use explicit commands (`deploy`, `validate`, etc.) with environment variables or config files.

## Related Issues and Dependencies

- Existing `scripts/install-wizard.ts` provides configuration collection and validation functionality
- Existing `scripts/infer-quilt-config.ts` provides Quilt configuration auto-detection
- Existing `bin/commands/manifest.ts` generates Benchling app manifest
- Existing `bin/commands/deploy.ts` handles CDK deployment orchestration
- Existing `bin/commands/test.ts` provides webhook integration testing
- XDG configuration system (`lib/xdg-config.ts`) provides configuration persistence
- AWS Secrets Manager integration (`scripts/sync-secrets.ts`) provides secure credential storage

## Technical Context

### Current Setup Flow (v0.6.1)
1. **Separate commands**: `manifest`, `init`, `deploy`, `test` must be run individually
2. **Manual configuration**: Users must edit `.env` or run `npm run setup` for local development
3. **Developer-focused**: README and commands assume familiarity with CDK and AWS
4. **Power user tools**: Designed for maintainers and advanced users

### Desired Setup Flow (v0.6.1 with npx-ux)
1. **Single entry point**: `npx @quiltdata/benchling-webhook` launches wizard
2. **Guided progression**: Wizard sequences all steps automatically with clear instructions
3. **End user focused**: Language and flow optimized for first-time users
4. **Simplified documentation**: README shows one-command experience prominently

### Key Files
- `/Users/ernest/GitHub/benchling-webhook/bin/cli.ts`: Main CLI entry point
- `/Users/ernest/GitHub/benchling-webhook/scripts/install-wizard.ts`: Configuration wizard
- `/Users/ernest/GitHub/benchling-webhook/scripts/infer-quilt-config.ts`: Quilt config detection
- `/Users/ernest/GitHub/benchling-webhook/bin/commands/`: Individual command implementations
- `/Users/ernest/GitHub/benchling-webhook/README.md`: Primary user documentation

### Existing Setup Scripts
- `npm run setup`: Interactive wizard for local development (developer tool)
- `scripts/install-wizard.ts`: Collects configuration, validates credentials, syncs secrets
- `scripts/infer-quilt-config.ts`: Auto-detects Quilt stack ARN, bucket, queue, catalog

### Reusable Components
- Manifest generation logic from `bin/commands/manifest.ts`
- Deployment orchestration from `bin/commands/deploy.ts`
- Integration testing from `bin/commands/test.ts`
- Validation logic from `scripts/install-wizard.ts`
- Quilt inference from `scripts/infer-quilt-config.ts`
- XDG config management from `lib/xdg-config.ts`
