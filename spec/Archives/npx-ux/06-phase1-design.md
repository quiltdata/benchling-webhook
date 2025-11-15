# Phase 1 Design: CLI Infrastructure Pre-factoring

**GitHub Issue**: #182
**Branch**: phase1-cli-infrastructure (off npx-ux)
**Phase**: Phase 1 - CLI Infrastructure Pre-factoring
**Date**: 2025-11-03

## Overview

This document defines the technical architecture for Phase 1, which establishes the foundational abstractions required to support both existing CLI functionality and the future wizard mode. This is a PRE-FACTORING phase: we extract and wrap existing code in clean abstractions without changing any user-facing behavior.

### Phase 1 Objectives

1. **CLI Mode Abstraction**: Extract current command handling into a `LegacyCommandMode` class that encapsulates existing behavior
2. **Configuration Layer Enhancement**: Create a `ConfigurationManager` class that provides a unified interface for configuration operations
3. **Error Handling Standardization**: Define `CLIError` types and error handling patterns for consistent user feedback

### Critical Constraints

- **Zero User-Facing Changes**: All existing CLI commands must work identically
- **100% Backward Compatibility**: All existing tests must pass without modification
- **No New Features**: This phase only refactors internal structure
- **Testable Abstractions**: All new classes must be independently testable

## Architecture Design

### 1. CLI Mode Abstraction

#### 1.1 Current State Analysis

The current CLI entry point (`bin/cli.ts`) uses Commander.js directly with commands registered inline:

```typescript
// Current structure
program
    .command("deploy", { isDefault: true })
    .action(async (options) => { await deployCommand(options); });

program
    .command("init")
    .action(async (options) => { await initCommand(options); });

// Show help when no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
```

**Problems with Current Approach**:
- Command routing logic is mixed with command registration
- Default behavior (showing help) is hardcoded
- No abstraction for command execution flow
- Difficult to test command routing independently
- No clear extension point for wizard mode

#### 1.2 Proposed Architecture: Command Mode Pattern

**Design Decision**: Implement a Command Mode pattern where each execution mode (legacy commands vs wizard) is encapsulated in a separate class with a consistent interface.

```typescript
/**
 * Base interface for CLI execution modes
 */
interface ICommandMode {
    /**
     * Initialize the mode with Commander program instance
     */
    register(program: Command): void;

    /**
     * Determine if this mode should handle the current invocation
     */
    shouldHandle(args: string[]): boolean;

    /**
     * Execute the mode
     */
    execute(args: string[]): Promise<void>;
}
```

#### 1.3 LegacyCommandMode Implementation

**Location**: `lib/cli/legacy-command-mode.ts`

**Responsibilities**:
- Register all existing commands with Commander.js
- Maintain existing command behavior exactly
- Handle default behavior (show help when no args)
- Provide isolated, testable command routing

**Implementation Strategy**:

```typescript
/**
 * Legacy command mode - wraps existing CLI behavior
 *
 * This mode handles all explicit command invocations:
 * - deploy (default command)
 * - init
 * - validate
 * - test
 * - manifest
 */
export class LegacyCommandMode implements ICommandMode {
    private readonly commands: Map<string, CommandDefinition>;

    constructor() {
        // Initialize command definitions
        this.commands = new Map([
            ["deploy", {
                description: "Deploy the CDK stack to AWS",
                isDefault: true,
                action: deployCommand,
                options: [ /* ... */ ]
            }],
            // ... other commands
        ]);
    }

    /**
     * Register all commands with Commander program
     */
    register(program: Command): void {
        for (const [name, def] of this.commands) {
            const cmd = program
                .command(name, { isDefault: def.isDefault })
                .description(def.description);

            // Add options
            for (const opt of def.options || []) {
                cmd.option(opt.flags, opt.description, opt.defaultValue);
            }

            // Add help text
            if (def.helpText) {
                cmd.addHelpText("after", def.helpText);
            }

            // Register action
            cmd.action(async (options) => {
                try {
                    await def.action(options);
                } catch (error) {
                    this.handleError(error, name);
                }
            });
        }
    }

    /**
     * Legacy mode handles explicit commands or no args (help)
     */
    shouldHandle(args: string[]): boolean {
        // Handle if no arguments (show help)
        if (args.length === 0) {
            return true;
        }

        // Handle if explicit command provided
        const firstArg = args[0];
        return this.commands.has(firstArg) ||
               firstArg === "--help" ||
               firstArg === "-h" ||
               firstArg === "--version" ||
               firstArg === "-v";
    }

    /**
     * Execute legacy command mode
     */
    async execute(args: string[]): Promise<void> {
        // If no args, show help
        if (args.length === 0) {
            const program = new Command();
            this.register(program);
            program.outputHelp();
            return;
        }

        // Otherwise, let Commander handle the command
        const program = new Command();
        this.register(program);
        await program.parseAsync(args, { from: "user" });
    }

    /**
     * Handle command errors consistently
     */
    private handleError(error: unknown, commandName: string): void {
        console.error(chalk.red((error as Error).message));
        process.exit(1);
    }
}
```

**Key Design Decisions**:

1. **Encapsulation**: All existing command logic stays in `bin/commands/` - we only wrap the registration and routing
2. **Testability**: Command routing can be tested by checking `shouldHandle()` with different argument combinations
3. **Isolation**: Changes to wizard mode won't affect legacy command behavior
4. **Backward Compatibility**: Existing command implementations remain unchanged

#### 1.4 CLI Entry Point Refactoring

**Location**: `bin/cli.ts`

**New Structure**:

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { LegacyCommandMode } from "../lib/cli/legacy-command-mode";

// Load package.json for version
const pkg = require("../package.json");

/**
 * Main CLI entry point
 *
 * Determines execution mode and delegates to appropriate handler.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // Initialize command modes
    const legacyMode = new LegacyCommandMode();

    // Determine which mode should handle this invocation
    if (legacyMode.shouldHandle(args)) {
        await legacyMode.execute(args);
        return;
    }

    // Future: if wizardMode.shouldHandle(args) { ... }

    // Fallback: show help
    const program = new Command()
        .name("benchling-webhook")
        .description("Benchling Webhook Integration for Quilt")
        .version(pkg.version);

    legacyMode.register(program);
    program.outputHelp();
}

// Execute with error handling
main().catch((error) => {
    console.error(chalk.red(error.message));
    process.exit(1);
});
```

**Benefits of This Refactoring**:
- Clear separation of concerns
- Easy to add wizard mode in Phase 2
- Testable command routing logic
- Maintains exact same behavior as before

### 2. Configuration Layer Enhancement

#### 2.1 Current State Analysis

Configuration is currently handled through:
- Direct file reads in command implementations
- XDG config functions in `lib/xdg-config.ts`
- Environment variable access scattered across commands
- Type definitions in `lib/types/config.ts`

**Problems**:
- No unified interface for configuration operations
- Commands must know about file paths and XDG structure
- Difficult to test configuration logic
- No consistent error handling for config failures

#### 2.2 Proposed Architecture: ConfigurationManager

**Design Decision**: Create a `ConfigurationManager` class that provides a high-level API for all configuration operations, hiding the complexity of XDG directories, file I/O, and schema validation.

**Location**: `lib/config/configuration-manager.ts`

**Responsibilities**:
- Provide unified API for reading/writing configuration
- Abstract XDG directory structure
- Handle configuration validation
- Manage configuration profiles
- Provide clear error messages

#### 2.3 ConfigurationManager Implementation

```typescript
/**
 * Configuration Manager
 *
 * Provides unified interface for all configuration operations.
 * Wraps existing XDG config functions with cleaner API.
 */
export class ConfigurationManager {
    private readonly profile: ProfileName;
    private readonly xdgConfig: XDGConfig;

    constructor(profile: ProfileName = "default") {
        this.profile = profile;
        this.xdgConfig = new XDGConfig(); // Existing XDG config wrapper
    }

    /**
     * Check if configuration exists for current profile
     */
    async exists(): Promise<boolean> {
        try {
            const userConfig = await this.xdgConfig.read({
                type: "user",
                profile: this.profile,
                throwIfMissing: false
            });
            return userConfig !== null;
        } catch {
            return false;
        }
    }

    /**
     * Load complete configuration (merged from all sources)
     */
    async load(): Promise<CompleteConfig> {
        const user = await this.loadUser();
        const derived = await this.loadDerived();
        const deploy = await this.loadDeploy();

        // Merge configurations with priority: deploy > derived > user
        return this.merge({ user, derived, deploy });
    }

    /**
     * Load user configuration only
     */
    async loadUser(): Promise<UserConfig> {
        try {
            const config = await this.xdgConfig.read({
                type: "user",
                profile: this.profile,
                throwIfMissing: false,
                validate: true
            });
            return config || {};
        } catch (error) {
            throw new ConfigurationError(
                "Failed to load user configuration",
                `Profile: ${this.profile}`,
                (error as Error).message
            );
        }
    }

    /**
     * Load derived configuration
     */
    async loadDerived(): Promise<DerivedConfig> {
        try {
            const config = await this.xdgConfig.read({
                type: "derived",
                profile: this.profile,
                throwIfMissing: false
            });
            return config || {};
        } catch {
            return {};
        }
    }

    /**
     * Load deployment artifacts
     */
    async loadDeploy(): Promise<DeploymentConfig> {
        try {
            const config = await this.xdgConfig.read({
                type: "deploy",
                profile: this.profile,
                throwIfMissing: false
            });
            return config || {};
        } catch {
            return {};
        }
    }

    /**
     * Save user configuration
     */
    async saveUser(config: UserConfig): Promise<void> {
        try {
            await this.xdgConfig.write({
                type: "user",
                profile: this.profile,
                backup: true,
                validate: true,
                addMetadata: true
            }, config);
        } catch (error) {
            throw new ConfigurationError(
                "Failed to save user configuration",
                `Profile: ${this.profile}`,
                (error as Error).message
            );
        }
    }

    /**
     * Save deployment artifacts
     */
    async saveDeploy(config: DeploymentConfig): Promise<void> {
        try {
            await this.xdgConfig.write({
                type: "deploy",
                profile: this.profile,
                backup: false,
                validate: false,
                addMetadata: true
            }, config);
        } catch (error) {
            throw new ConfigurationError(
                "Failed to save deployment configuration",
                `Profile: ${this.profile}`,
                (error as Error).message
            );
        }
    }

    /**
     * Get configuration file paths
     */
    getPaths(): XDGConfigPaths {
        return this.xdgConfig.getPaths(this.profile);
    }

    /**
     * Merge configurations with appropriate priority
     */
    private merge(configs: ConfigSet): CompleteConfig {
        return {
            ...configs.user,
            ...configs.derived,
            ...configs.deploy
        };
    }
}
```

**Key Design Decisions**:

1. **Wrapper Pattern**: Don't rewrite XDG config logic, just wrap it with cleaner API
2. **Error Handling**: Convert low-level errors to `ConfigurationError` with context
3. **Profile Management**: Profile name passed in constructor, all operations use it
4. **Separation of Concerns**: Commands interact with ConfigurationManager, not file system

#### 2.4 Integration with Existing Code

**Migration Strategy**:

1. **Phase 1**: Create ConfigurationManager alongside existing code
2. **Commands Keep Working**: Don't modify command implementations yet
3. **Tests Validate Equivalence**: New ConfigurationManager must produce same results as existing code
4. **Future Phases**: Gradually migrate commands to use ConfigurationManager

**Example Usage** (for future reference, not implemented in Phase 1):

```typescript
// Future: How commands will use ConfigurationManager
async function deployCommand(options: DeployOptions): Promise<void> {
    const configMgr = new ConfigurationManager();

    // Load configuration
    const config = await configMgr.load();

    // Use configuration
    const quiltStackArn = options.quiltStackArn || config.quiltStackArn;

    // ... deployment logic ...

    // Save deployment artifacts
    await configMgr.saveDeploy({
        webhookUrl: deployedUrl,
        deployedAt: new Date().toISOString()
    });
}
```

### 3. Error Handling Standardization

#### 3.1 Current State Analysis

Error handling is currently inconsistent:
- Some commands use `console.error()` with chalk.red()
- Some throw errors that bubble up to process.exit(1)
- Error messages have varying formats
- No structured error types
- Stack traces sometimes leak to users

#### 3.2 Proposed Architecture: CLIError Hierarchy

**Design Decision**: Create a hierarchy of error types that represent different CLI failure modes, each with consistent formatting and user-friendly messages.

**Location**: `lib/errors/cli-errors.ts`

#### 3.3 CLIError Implementation

```typescript
/**
 * Base class for all CLI errors
 *
 * Provides consistent error formatting and user-friendly messages.
 */
export abstract class CLIError extends Error {
    constructor(
        message: string,
        public readonly suggestion?: string,
        public readonly details?: string
    ) {
        super(message);
        this.name = this.constructor.name;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Format error for display to user
     */
    format(): string {
        const lines: string[] = [];

        // Main error message
        lines.push(chalk.red.bold(`✗ ${this.message}`));

        // Suggestion (if provided)
        if (this.suggestion) {
            lines.push("");
            lines.push(chalk.yellow(`💡 ${this.suggestion}`));
        }

        // Details (if provided)
        if (this.details) {
            lines.push("");
            lines.push(chalk.dim(`   ${this.details}`));
        }

        return lines.join("\n");
    }

    /**
     * Exit code for this error type
     */
    abstract getExitCode(): number;
}

/**
 * Configuration-related errors
 */
export class ConfigurationError extends CLIError {
    getExitCode(): number {
        return 1;
    }
}

/**
 * Validation errors (user input or configuration)
 */
export class ValidationError extends CLIError {
    getExitCode(): number {
        return 1;
    }
}

/**
 * AWS API errors
 */
export class AWSError extends CLIError {
    constructor(
        message: string,
        public readonly awsErrorCode: string,
        suggestion?: string,
        details?: string
    ) {
        super(message, suggestion, details);
    }

    getExitCode(): number {
        return 2;
    }
}

/**
 * Deployment errors
 */
export class DeploymentError extends CLIError {
    getExitCode(): number {
        return 3;
    }
}

/**
 * User cancellation (not an error, but uses error mechanism)
 */
export class UserCancelledError extends CLIError {
    constructor(message = "Operation cancelled by user") {
        super(message);
    }

    format(): string {
        return chalk.yellow(this.message);
    }

    getExitCode(): number {
        return 130; // Standard exit code for SIGINT
    }
}

/**
 * Non-interactive environment detection
 */
export class NonInteractiveError extends CLIError {
    constructor() {
        super(
            "Cannot run interactive wizard in non-TTY environment",
            "Use explicit commands in CI/CD environments",
            "See: https://github.com/quiltdata/benchling-webhook#cli-usage"
        );
    }

    getExitCode(): number {
        return 1;
    }
}
```

#### 3.4 Error Handler

**Location**: `lib/errors/error-handler.ts`

```typescript
/**
 * Global error handler for CLI
 *
 * Provides consistent error display and process exit.
 */
export class ErrorHandler {
    /**
     * Handle error and exit process
     */
    static handle(error: unknown): never {
        if (error instanceof CLIError) {
            // Format and display CLI error
            console.error();
            console.error(error.format());
            console.error();
            process.exit(error.getExitCode());
        }

        // Unknown error - display with stack trace in debug mode
        if (process.env.DEBUG) {
            console.error(error);
        } else {
            console.error(chalk.red((error as Error).message));
        }

        process.exit(1);
    }

    /**
     * Wrap async function with error handling
     */
    static wrap<T extends (...args: any[]) => Promise<any>>(
        fn: T
    ): T {
        return (async (...args: any[]) => {
            try {
                return await fn(...args);
            } catch (error) {
                ErrorHandler.handle(error);
            }
        }) as T;
    }
}
```

#### 3.5 Integration Pattern

**Updated CLI Entry Point**:

```typescript
async function main(): Promise<void> {
    try {
        const args = process.argv.slice(2);
        const legacyMode = new LegacyCommandMode();

        if (legacyMode.shouldHandle(args)) {
            await legacyMode.execute(args);
            return;
        }

        // Fallback
        const program = new Command();
        legacyMode.register(program);
        program.outputHelp();
    } catch (error) {
        ErrorHandler.handle(error);
    }
}

main();
```

**Command Implementation Pattern**:

```typescript
// Commands can throw typed errors
export async function deployCommand(options: DeployOptions): Promise<void> {
    // Validation
    if (!options.quiltStackArn) {
        throw new ValidationError(
            "Missing required parameter: --quilt-stack-arn",
            "Provide Quilt stack ARN via --quilt-stack-arn or QUILT_STACK_ARN environment variable",
            "Example: --quilt-stack-arn arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc"
        );
    }

    // AWS operations
    try {
        await checkSecretExists(secret, region);
    } catch (error) {
        if ((error as any).Code === "ResourceNotFoundException") {
            throw new AWSError(
                "Benchling secret not found",
                "ResourceNotFoundException",
                `Create secret using: npm run config -- --secret-name ${secret}`,
                `Region: ${region}`
            );
        }
        throw error;
    }

    // ... rest of implementation
}
```

## Implementation Plan

### Work Breakdown

This phase is divided into three independent work streams that can be implemented and tested separately:

#### Stream 1: CLI Mode Abstraction

**Files to Create**:
- `lib/cli/command-mode.ts` - ICommandMode interface
- `lib/cli/legacy-command-mode.ts` - LegacyCommandMode implementation
- `test/cli/legacy-command-mode.test.ts` - Unit tests

**Files to Modify**:
- `bin/cli.ts` - Refactor to use LegacyCommandMode

**Tests**:
- Command routing logic (shouldHandle)
- Command registration
- Help text display
- Version display
- Error handling

#### Stream 2: Configuration Layer Enhancement

**Files to Create**:
- `lib/config/configuration-manager.ts` - ConfigurationManager implementation
- `test/config/configuration-manager.test.ts` - Unit tests

**Files to Reference** (not modify):
- `lib/xdg-config.ts` - Existing XDG config implementation
- `lib/types/config.ts` - Existing type definitions

**Tests**:
- Configuration loading (all types)
- Configuration saving
- Configuration merging
- Error handling
- Profile management

#### Stream 3: Error Handling Standardization

**Files to Create**:
- `lib/errors/cli-errors.ts` - Error class hierarchy
- `lib/errors/error-handler.ts` - Global error handler
- `test/errors/cli-errors.test.ts` - Unit tests

**Files to Modify**:
- `bin/cli.ts` - Add ErrorHandler usage

**Tests**:
- Error formatting
- Exit code generation
- Error type hierarchy
- Suggestion display

### Testing Strategy

#### Unit Tests

Each component must have comprehensive unit tests:

1. **LegacyCommandMode**:
   - Test `shouldHandle()` with various argument combinations
   - Test command registration
   - Test error handling
   - Mock Commander.js to verify integration

2. **ConfigurationManager**:
   - Test all CRUD operations
   - Test configuration merging logic
   - Test error conditions (missing files, invalid JSON, etc.)
   - Mock file system operations

3. **CLIError Types**:
   - Test error formatting
   - Test exit codes
   - Test suggestion and details display

#### Integration Tests

Verify that refactored code behaves identically to original:

1. **CLI Integration Tests**:
   - Run actual CLI commands and verify output
   - Test help text display
   - Test version display
   - Test command execution

2. **Configuration Integration Tests**:
   - Verify XDG directory structure
   - Verify file format compatibility
   - Test with actual configuration files

#### Backward Compatibility Tests

**Critical**: All existing tests must pass without modification

```bash
npm run test          # All existing tests must pass
npm run test:ts       # TypeScript tests
npm run lint          # No linting errors
```

### Success Criteria

Phase 1 is complete when:

1. **All New Code Has Tests**: Minimum 90% coverage on new modules
2. **All Existing Tests Pass**: Zero test modifications required
3. **CLI Behavior Unchanged**: Manual testing confirms identical behavior
4. **Linting Passes**: No TypeScript or ESLint errors
5. **Documentation Complete**: JSDoc comments on all public interfaces
6. **Code Review Ready**: Clean git history with descriptive commits

## Integration Points

### For Future Phases

This Phase 1 design establishes these integration points for future work:

#### Phase 2: Wizard Mode Implementation

The wizard mode will implement the same `ICommandMode` interface:

```typescript
class WizardMode implements ICommandMode {
    shouldHandle(args: string[]): boolean {
        // Wizard handles when:
        // 1. No arguments provided AND in TTY environment
        // 2. Explicit "setup" command
        return (args.length === 0 && process.stdin.isTTY) ||
               args[0] === "setup";
    }

    // ... wizard implementation
}
```

#### Phase 3: Command Migration

Commands will gradually migrate to use new infrastructure:

```typescript
// Old way (Phase 1 - unchanged)
export async function deployCommand(options: DeployOptions): Promise<void> {
    // Direct file access and error handling
}

// New way (Phase 3 - future)
export async function deployCommand(
    options: DeployOptions,
    configMgr: ConfigurationManager
): Promise<void> {
    // Use configMgr for all configuration operations
    // Throw typed errors for failures
}
```

## Risk Mitigation

### Risk 1: Breaking Existing Functionality

**Mitigation**:
- Wrap, don't rewrite
- Maintain 100% test pass rate
- Manual testing of all commands before merge
- Incremental commit strategy (one component at a time)

### Risk 2: Increased Complexity

**Mitigation**:
- Keep abstractions simple and focused
- Comprehensive JSDoc documentation
- Clear separation of concerns
- Follow existing code patterns where possible

### Risk 3: Merge Conflicts

**Mitigation**:
- Small, focused commits
- Coordinate with other development work
- Rebase frequently from main branch

## Dependencies

### External Dependencies

No new npm packages required. This phase uses:
- `commander` (existing)
- `chalk` (existing)
- `enquirer` (existing)

### Internal Dependencies

- `lib/xdg-config.ts` - Existing XDG configuration
- `lib/types/config.ts` - Existing type definitions
- `lib/utils/config-resolver.ts` - Existing config resolution
- `bin/commands/*.ts` - Existing command implementations

## Appendix

### TypeScript Interfaces

**Complete ICommandMode Interface**:

```typescript
/**
 * Command execution mode interface
 *
 * Represents a distinct mode of CLI operation (e.g., legacy commands, wizard).
 */
export interface ICommandMode {
    /**
     * Register this mode's commands and options with Commander
     *
     * @param program - Commander.js program instance
     */
    register(program: Command): void;

    /**
     * Determine if this mode should handle the current invocation
     *
     * @param args - Command-line arguments (excluding node and script path)
     * @returns true if this mode should handle execution
     */
    shouldHandle(args: string[]): boolean;

    /**
     * Execute this mode
     *
     * @param args - Command-line arguments
     * @throws CLIError for known error conditions
     */
    execute(args: string[]): Promise<void>;
}
```

**Command Definition Interface**:

```typescript
/**
 * Definition for a CLI command
 */
export interface CommandDefinition {
    /**
     * Command name
     */
    name: string;

    /**
     * Command description
     */
    description: string;

    /**
     * Whether this is the default command
     */
    isDefault?: boolean;

    /**
     * Command options
     */
    options?: CommandOption[];

    /**
     * Additional help text
     */
    helpText?: string;

    /**
     * Command action function
     */
    action: (options: any) => Promise<void>;
}

/**
 * Definition for a command option
 */
export interface CommandOption {
    /**
     * Option flags (e.g., "-f, --force")
     */
    flags: string;

    /**
     * Option description
     */
    description: string;

    /**
     * Default value
     */
    defaultValue?: any;
}
```

### File Structure

After Phase 1, the project structure will be:

```
benchling-webhook/
├── bin/
│   ├── cli.ts                          # [MODIFIED] Refactored entry point
│   ├── commands/
│   │   ├── deploy.ts                   # [UNCHANGED] Existing command
│   │   ├── init.ts                     # [UNCHANGED] Existing command
│   │   ├── manifest.ts                 # [UNCHANGED] Existing command
│   │   ├── test.ts                     # [UNCHANGED] Existing command
│   │   └── validate.ts                 # [UNCHANGED] Existing command
│   └── ...
├── lib/
│   ├── cli/                            # [NEW] CLI infrastructure
│   │   ├── command-mode.ts             # [NEW] ICommandMode interface
│   │   └── legacy-command-mode.ts      # [NEW] Legacy command handler
│   ├── config/                         # [NEW] Configuration layer
│   │   └── configuration-manager.ts    # [NEW] Unified config API
│   ├── errors/                         # [NEW] Error handling
│   │   ├── cli-errors.ts               # [NEW] Error type hierarchy
│   │   └── error-handler.ts            # [NEW] Global error handler
│   ├── types/
│   │   └── config.ts                   # [UNCHANGED] Existing types
│   ├── utils/
│   │   └── config-resolver.ts          # [UNCHANGED] Existing resolver
│   ├── xdg-config.ts                   # [UNCHANGED] Existing XDG config
│   └── ...
└── test/
    ├── cli/                            # [NEW] CLI tests
    │   └── legacy-command-mode.test.ts # [NEW]
    ├── config/                         # [NEW] Config tests
    │   └── configuration-manager.test.ts # [NEW]
    └── errors/                         # [NEW] Error tests
        └── cli-errors.test.ts          # [NEW]
```

### Commit Strategy

Suggested commit sequence:

1. `feat(cli): add ICommandMode interface and error types`
   - Add `lib/cli/command-mode.ts`
   - Add `lib/errors/cli-errors.ts`
   - Add `lib/errors/error-handler.ts`

2. `feat(cli): implement LegacyCommandMode`
   - Add `lib/cli/legacy-command-mode.ts`
   - Add tests

3. `feat(config): add ConfigurationManager`
   - Add `lib/config/configuration-manager.ts`
   - Add tests

4. `refactor(cli): migrate entry point to use LegacyCommandMode`
   - Modify `bin/cli.ts`
   - Verify all existing tests pass

5. `docs(cli): add JSDoc documentation for Phase 1 abstractions`
   - Add comprehensive documentation

6. `test(cli): add integration tests for refactored CLI`
   - Ensure backward compatibility
