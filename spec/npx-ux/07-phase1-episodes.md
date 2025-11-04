# Phase 1 Episodes: CLI Infrastructure Pre-factoring

**GitHub Issue**: #182
**Branch**: phase1-cli-infrastructure (off npx-ux)
**Phase**: Phase 1 - CLI Infrastructure Pre-factoring
**Date**: 2025-11-03

## Overview

This document breaks down the Phase 1 implementation into atomic, independently testable episodes. Each episode represents a single committable change that can be validated through TDD (Test-Driven Development) cycle: Red → Green → Refactor.

### Episode Principles

1. **Atomic**: Each episode is a single, focused change
2. **Testable**: Each episode has clear, measurable test criteria
3. **Independent**: Episodes can be tested and committed separately
4. **Sequential**: Episodes maintain working state throughout
5. **TDD Cycle**: Write failing test → implement → refactor

### Episode Sequencing Strategy

Episodes are organized into three parallel streams that can be implemented independently:

- **Stream A**: Error Handling Foundation (Episodes 1-3)
- **Stream B**: CLI Mode Abstraction (Episodes 4-7)
- **Stream C**: Configuration Management (Episodes 8-11)

After all streams complete, final integration episodes (12-13) merge everything together.

---

## Stream A: Error Handling Foundation

### Episode 1: Create CLIError Base Class and Hierarchy

**Objective**: Establish error type system for consistent error handling

**Duration**: 15-20 minutes

**Files**:
- Create: `lib/errors/cli-errors.ts`
- Create: `test/errors/cli-errors.test.ts`

**TDD Cycle**:

1. **Red**: Write failing test
   ```typescript
   // test/errors/cli-errors.test.ts
   describe("CLIError", () => {
       it("should format error with message only", () => {
           const error = new ConfigurationError("Config file not found");
           expect(error.format()).toContain("✗ Config file not found");
       });

       it("should format error with suggestion", () => {
           const error = new ConfigurationError(
               "Config file not found",
               "Run: npm run setup"
           );
           expect(error.format()).toContain("💡 Run: npm run setup");
       });

       it("should format error with details", () => {
           const error = new ConfigurationError(
               "Config file not found",
               "Run: npm run setup",
               "Path: ~/.config/benchling-webhook/default.json"
           );
           expect(error.format()).toContain("Path:");
       });
   });
   ```

2. **Green**: Implement CLIError base class
   - Create abstract `CLIError` class with `format()` method
   - Implement error formatting with chalk colors
   - Add `getExitCode()` abstract method

3. **Refactor**: Clean up formatting logic
   - Extract color constants
   - Ensure consistent spacing
   - Add JSDoc comments

**Success Criteria**:
- [ ] All error formatting tests pass
- [ ] Error hierarchy is clear and documented
- [ ] Exit codes are properly defined

**Commit**: `feat(errors): add CLIError base class and hierarchy`

---

### Episode 2: Implement Specific Error Types

**Objective**: Create concrete error classes for different failure modes

**Duration**: 15-20 minutes

**Files**:
- Modify: `lib/errors/cli-errors.ts`
- Modify: `test/errors/cli-errors.test.ts`

**TDD Cycle**:

1. **Red**: Write tests for each error type
   ```typescript
   describe("ConfigurationError", () => {
       it("should return exit code 1", () => {
           const error = new ConfigurationError("test");
           expect(error.getExitCode()).toBe(1);
       });
   });

   describe("ValidationError", () => {
       it("should return exit code 1", () => {
           const error = new ValidationError("test");
           expect(error.getExitCode()).toBe(1);
       });
   });

   describe("AWSError", () => {
       it("should store AWS error code", () => {
           const error = new AWSError(
               "Secret not found",
               "ResourceNotFoundException"
           );
           expect(error.awsErrorCode).toBe("ResourceNotFoundException");
       });

       it("should return exit code 2", () => {
           const error = new AWSError("test", "TestError");
           expect(error.getExitCode()).toBe(2);
       });
   });

   describe("UserCancelledError", () => {
       it("should format as yellow warning", () => {
           const error = new UserCancelledError();
           expect(error.format()).toContain("Operation cancelled");
       });

       it("should return exit code 130", () => {
           const error = new UserCancelledError();
           expect(error.getExitCode()).toBe(130);
       });
   });
   ```

2. **Green**: Implement error types
   - Add `ConfigurationError`
   - Add `ValidationError`
   - Add `AWSError` with `awsErrorCode` property
   - Add `DeploymentError`
   - Add `UserCancelledError` with custom formatting
   - Add `NonInteractiveError`

3. **Refactor**: Ensure DRY principles
   - Extract common patterns
   - Add comprehensive JSDoc
   - Verify error message clarity

**Success Criteria**:
- [ ] All error type tests pass
- [ ] Exit codes are appropriate
- [ ] Error messages are user-friendly
- [ ] AWS error includes error code

**Commit**: `feat(errors): implement specific error types`

---

### Episode 3: Create Global Error Handler

**Objective**: Provide centralized error handling and process exit

**Duration**: 15-20 minutes

**Files**:
- Create: `lib/errors/error-handler.ts`
- Modify: `test/errors/cli-errors.test.ts`

**TDD Cycle**:

1. **Red**: Write error handler tests
   ```typescript
   describe("ErrorHandler", () => {
       let mockExit: jest.SpyInstance;
       let mockConsoleError: jest.SpyInstance;

       beforeEach(() => {
           mockExit = jest.spyOn(process, "exit").mockImplementation();
           mockConsoleError = jest.spyOn(console, "error").mockImplementation();
       });

       afterEach(() => {
           mockExit.mockRestore();
           mockConsoleError.mockRestore();
       });

       it("should handle CLIError with formatted output", () => {
           const error = new ConfigurationError("test");
           ErrorHandler.handle(error);

           expect(mockConsoleError).toHaveBeenCalled();
           expect(mockExit).toHaveBeenCalledWith(1);
       });

       it("should handle unknown errors", () => {
           const error = new Error("Unknown error");
           ErrorHandler.handle(error);

           expect(mockConsoleError).toHaveBeenCalled();
           expect(mockExit).toHaveBeenCalledWith(1);
       });

       it("should show stack trace in debug mode", () => {
           process.env.DEBUG = "true";
           const error = new Error("test");
           ErrorHandler.handle(error);

           expect(mockConsoleError).toHaveBeenCalledWith(error);
           delete process.env.DEBUG;
       });
   });

   describe("ErrorHandler.wrap", () => {
       it("should wrap async function with error handling", async () => {
           const mockFn = jest.fn().mockRejectedValue(new Error("test"));
           const wrapped = ErrorHandler.wrap(mockFn);

           await wrapped();

           expect(mockFn).toHaveBeenCalled();
       });
   });
   ```

2. **Green**: Implement ErrorHandler
   - Add `handle()` method for error processing
   - Add `wrap()` method for async function wrapping
   - Handle CLIError vs unknown errors
   - Support DEBUG mode for stack traces

3. **Refactor**: Improve error output
   - Ensure consistent formatting
   - Add proper spacing
   - Verify exit codes

**Success Criteria**:
- [ ] ErrorHandler tests pass
- [ ] CLIError formatted correctly
- [ ] Unknown errors handled gracefully
- [ ] DEBUG mode shows stack traces
- [ ] wrap() method works correctly

**Commit**: `feat(errors): add global error handler`

---

## Stream B: CLI Mode Abstraction

### Episode 4: Define ICommandMode Interface

**Objective**: Create interface contract for command modes

**Duration**: 10-15 minutes

**Files**:
- Create: `lib/cli/command-mode.ts`
- Create: `lib/cli/types.ts`
- Create: `test/cli/command-mode.test.ts`

**TDD Cycle**:

1. **Red**: Write interface validation tests
   ```typescript
   describe("ICommandMode interface", () => {
       class TestMode implements ICommandMode {
           register(program: Command): void {
               // Implementation
           }

           shouldHandle(args: string[]): boolean {
               return false;
           }

           async execute(args: string[]): Promise<void> {
               // Implementation
           }
       }

       it("should define required methods", () => {
           const mode = new TestMode();
           expect(mode.register).toBeDefined();
           expect(mode.shouldHandle).toBeDefined();
           expect(mode.execute).toBeDefined();
       });

       it("register should accept Commander program", () => {
           const mode = new TestMode();
           const program = new Command();
           expect(() => mode.register(program)).not.toThrow();
       });

       it("shouldHandle should return boolean", () => {
           const mode = new TestMode();
           expect(typeof mode.shouldHandle([])).toBe("boolean");
       });

       it("execute should return Promise", () => {
           const mode = new TestMode();
           const result = mode.execute([]);
           expect(result).toBeInstanceOf(Promise);
       });
   });
   ```

2. **Green**: Define interfaces
   - Create `ICommandMode` interface
   - Create `CommandDefinition` interface
   - Create `CommandOption` interface
   - Add comprehensive JSDoc

3. **Refactor**: Improve documentation
   - Add usage examples in JSDoc
   - Document interface contracts
   - Add type constraints

**Success Criteria**:
- [ ] Interface tests compile and pass
- [ ] All methods properly typed
- [ ] JSDoc documentation complete
- [ ] Type definitions exported

**Commit**: `feat(cli): define ICommandMode interface`

---

### Episode 5: Implement LegacyCommandMode Class Structure

**Objective**: Create LegacyCommandMode skeleton with command registry

**Duration**: 20-25 minutes

**Files**:
- Create: `lib/cli/legacy-command-mode.ts`
- Create: `test/cli/legacy-command-mode.test.ts`

**TDD Cycle**:

1. **Red**: Write structural tests
   ```typescript
   describe("LegacyCommandMode", () => {
       let mode: LegacyCommandMode;

       beforeEach(() => {
           mode = new LegacyCommandMode();
       });

       it("should implement ICommandMode", () => {
           expect(mode.register).toBeDefined();
           expect(mode.shouldHandle).toBeDefined();
           expect(mode.execute).toBeDefined();
       });

       it("should initialize with command definitions", () => {
           // Access private commands via reflection for testing
           const commands = (mode as any).commands;
           expect(commands.has("deploy")).toBe(true);
           expect(commands.has("init")).toBe(true);
           expect(commands.has("validate")).toBe(true);
           expect(commands.has("test")).toBe(true);
           expect(commands.has("manifest")).toBe(true);
       });

       it("should mark deploy as default command", () => {
           const commands = (mode as any).commands;
           const deployDef = commands.get("deploy");
           expect(deployDef.isDefault).toBe(true);
       });
   });
   ```

2. **Green**: Implement class structure
   - Create `LegacyCommandMode` class implementing `ICommandMode`
   - Initialize `commands` Map with command definitions
   - Define all existing commands (deploy, init, validate, test, manifest)
   - Use stub action functions temporarily

3. **Refactor**: Clean up structure
   - Extract command definitions to constants
   - Add JSDoc comments
   - Ensure type safety

**Success Criteria**:
- [ ] Class structure tests pass
- [ ] All commands registered
- [ ] Command definitions complete
- [ ] Type checking passes

**Commit**: `feat(cli): implement LegacyCommandMode structure`

---

### Episode 6: Implement Command Routing Logic

**Objective**: Add shouldHandle() and execute() logic

**Duration**: 25-30 minutes

**Files**:
- Modify: `lib/cli/legacy-command-mode.ts`
- Modify: `test/cli/legacy-command-mode.test.ts`

**TDD Cycle**:

1. **Red**: Write routing tests
   ```typescript
   describe("LegacyCommandMode.shouldHandle", () => {
       let mode: LegacyCommandMode;

       beforeEach(() => {
           mode = new LegacyCommandMode();
       });

       it("should handle no arguments", () => {
           expect(mode.shouldHandle([])).toBe(true);
       });

       it("should handle explicit commands", () => {
           expect(mode.shouldHandle(["deploy"])).toBe(true);
           expect(mode.shouldHandle(["init"])).toBe(true);
           expect(mode.shouldHandle(["validate"])).toBe(true);
           expect(mode.shouldHandle(["test"])).toBe(true);
           expect(mode.shouldHandle(["manifest"])).toBe(true);
       });

       it("should handle help flags", () => {
           expect(mode.shouldHandle(["--help"])).toBe(true);
           expect(mode.shouldHandle(["-h"])).toBe(true);
       });

       it("should handle version flags", () => {
           expect(mode.shouldHandle(["--version"])).toBe(true);
           expect(mode.shouldHandle(["-v"])).toBe(true);
       });

       it("should not handle unknown commands", () => {
           expect(mode.shouldHandle(["unknown"])).toBe(false);
       });

       it("should handle commands with options", () => {
           expect(mode.shouldHandle(["deploy", "--yes"])).toBe(true);
       });
   });

   describe("LegacyCommandMode.execute", () => {
       let mode: LegacyCommandMode;
       let mockOutputHelp: jest.Mock;

       beforeEach(() => {
           mode = new LegacyCommandMode();
           mockOutputHelp = jest.fn();
       });

       it("should show help when no arguments", async () => {
           const mockProgram = {
               outputHelp: mockOutputHelp
           };

           // Mock Commander program creation
           jest.spyOn(Command.prototype, "outputHelp").mockImplementation(mockOutputHelp);

           await mode.execute([]);

           expect(mockOutputHelp).toHaveBeenCalled();
       });

       it("should parse and execute commands", async () => {
           const mockParseAsync = jest.spyOn(Command.prototype, "parseAsync").mockResolvedValue();

           await mode.execute(["deploy"]);

           expect(mockParseAsync).toHaveBeenCalledWith(["deploy"], { from: "user" });
       });
   });
   ```

2. **Green**: Implement routing logic
   - Implement `shouldHandle()` method
   - Implement `execute()` method
   - Handle no-args case (show help)
   - Handle command execution via Commander

3. **Refactor**: Optimize logic
   - Simplify conditional checks
   - Extract common patterns
   - Add error handling

**Success Criteria**:
- [ ] Routing tests pass
- [ ] shouldHandle() correctly identifies valid invocations
- [ ] execute() shows help for no args
- [ ] execute() delegates to Commander for commands

**Commit**: `feat(cli): implement command routing logic`

---

### Episode 7: Integrate Command Registration

**Objective**: Complete register() method with full Commander integration

**Duration**: 30-35 minutes

**Files**:
- Modify: `lib/cli/legacy-command-mode.ts`
- Modify: `test/cli/legacy-command-mode.test.ts`

**TDD Cycle**:

1. **Red**: Write registration tests
   ```typescript
   describe("LegacyCommandMode.register", () => {
       let mode: LegacyCommandMode;
       let program: Command;

       beforeEach(() => {
           mode = new LegacyCommandMode();
           program = new Command();
       });

       it("should register all commands", () => {
           mode.register(program);

           const commands = program.commands;
           expect(commands.some(cmd => cmd.name() === "deploy")).toBe(true);
           expect(commands.some(cmd => cmd.name() === "init")).toBe(true);
           expect(commands.some(cmd => cmd.name() === "validate")).toBe(true);
           expect(commands.some(cmd => cmd.name() === "test")).toBe(true);
           expect(commands.some(cmd => cmd.name() === "manifest")).toBe(true);
       });

       it("should register command options", () => {
           mode.register(program);

           const deployCmd = program.commands.find(cmd => cmd.name() === "deploy");
           const options = deployCmd?.options;

           expect(options?.some(opt => opt.flags.includes("--quilt-stack-arn"))).toBe(true);
           expect(options?.some(opt => opt.flags.includes("--benchling-secret"))).toBe(true);
           expect(options?.some(opt => opt.flags.includes("--yes"))).toBe(true);
       });

       it("should register command descriptions", () => {
           mode.register(program);

           const deployCmd = program.commands.find(cmd => cmd.name() === "deploy");
           expect(deployCmd?.description()).toContain("Deploy");
       });

       it("should register default command", () => {
           mode.register(program);

           const deployCmd = program.commands.find(cmd => cmd.name() === "deploy");
           expect(deployCmd?.isDefault).toBe(true);
       });
   });

   describe("LegacyCommandMode command actions", () => {
       it("should call deployCommand for deploy", async () => {
           const mockDeployCommand = jest.fn().mockResolvedValue(undefined);
           jest.mock("../../bin/commands/deploy", () => ({
               deployCommand: mockDeployCommand
           }));

           const mode = new LegacyCommandMode();
           const program = new Command();
           mode.register(program);

           await program.parseAsync(["node", "cli.js", "deploy"]);

           expect(mockDeployCommand).toHaveBeenCalled();
       });
   });
   ```

2. **Green**: Implement registration
   - Implement `register()` method
   - Iterate over command definitions
   - Register each command with Commander
   - Add options to commands
   - Add help text to commands
   - Wire up action handlers

3. **Refactor**: Clean up registration
   - Extract option registration logic
   - Ensure proper error handling
   - Add JSDoc comments

**Success Criteria**:
- [ ] Registration tests pass
- [ ] All commands registered with Commander
- [ ] Options properly configured
- [ ] Actions properly wired
- [ ] Default command set correctly

**Commit**: `feat(cli): implement command registration`

---

## Stream C: Configuration Management

### Episode 8: Create ConfigurationManager Class Structure

**Objective**: Set up ConfigurationManager skeleton with XDG integration

**Duration**: 20-25 minutes

**Files**:
- Create: `lib/config/configuration-manager.ts`
- Create: `test/config/configuration-manager.test.ts`

**TDD Cycle**:

1. **Red**: Write structural tests
   ```typescript
   describe("ConfigurationManager", () => {
       let configMgr: ConfigurationManager;

       beforeEach(() => {
           configMgr = new ConfigurationManager();
       });

       it("should initialize with default profile", () => {
           expect(configMgr).toBeDefined();
           const profile = (configMgr as any).profile;
           expect(profile).toBe("default");
       });

       it("should accept custom profile", () => {
           const customMgr = new ConfigurationManager("test");
           const profile = (customMgr as any).profile;
           expect(profile).toBe("test");
       });

       it("should initialize XDG config", () => {
           const xdgConfig = (configMgr as any).xdgConfig;
           expect(xdgConfig).toBeDefined();
       });

       it("should define async methods", () => {
           expect(configMgr.exists).toBeDefined();
           expect(configMgr.load).toBeDefined();
           expect(configMgr.loadUser).toBeDefined();
           expect(configMgr.loadDerived).toBeDefined();
           expect(configMgr.loadDeploy).toBeDefined();
           expect(configMgr.saveUser).toBeDefined();
           expect(configMgr.saveDeploy).toBeDefined();
           expect(configMgr.getPaths).toBeDefined();
       });
   });
   ```

2. **Green**: Implement class structure
   - Create `ConfigurationManager` class
   - Add constructor with profile parameter
   - Initialize XDG config wrapper
   - Add method stubs for all operations
   - Add JSDoc documentation

3. **Refactor**: Clean up structure
   - Ensure proper TypeScript types
   - Add comprehensive JSDoc
   - Extract type definitions if needed

**Success Criteria**:
- [ ] Structure tests pass
- [ ] Class properly initialized
- [ ] All methods defined
- [ ] TypeScript compiles without errors

**Commit**: `feat(config): create ConfigurationManager structure`

---

### Episode 9: Implement Configuration Loading Methods

**Objective**: Add load(), loadUser(), loadDerived(), loadDeploy() methods

**Duration**: 30-35 minutes

**Files**:
- Modify: `lib/config/configuration-manager.ts`
- Modify: `test/config/configuration-manager.test.ts`

**TDD Cycle**:

1. **Red**: Write loading tests
   ```typescript
   describe("ConfigurationManager.exists", () => {
       it("should return true when config exists", async () => {
           const mockXdgConfig = {
               read: jest.fn().mockResolvedValue({ key: "value" })
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const result = await configMgr.exists();

           expect(result).toBe(true);
           expect(mockXdgConfig.read).toHaveBeenCalledWith({
               type: "user",
               profile: "default",
               throwIfMissing: false
           });
       });

       it("should return false when config missing", async () => {
           const mockXdgConfig = {
               read: jest.fn().mockResolvedValue(null)
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const result = await configMgr.exists();

           expect(result).toBe(false);
       });
   });

   describe("ConfigurationManager.loadUser", () => {
       it("should load user configuration", async () => {
           const mockConfig = { quiltStackArn: "test-arn" };
           const mockXdgConfig = {
               read: jest.fn().mockResolvedValue(mockConfig)
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const result = await configMgr.loadUser();

           expect(result).toEqual(mockConfig);
           expect(mockXdgConfig.read).toHaveBeenCalledWith({
               type: "user",
               profile: "default",
               throwIfMissing: false,
               validate: true
           });
       });

       it("should throw ConfigurationError on failure", async () => {
           const mockXdgConfig = {
               read: jest.fn().mockRejectedValue(new Error("Read failed"))
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           await expect(configMgr.loadUser()).rejects.toThrow(ConfigurationError);
       });
   });

   // Similar tests for loadDerived() and loadDeploy()
   ```

2. **Green**: Implement loading methods
   - Implement `exists()` method
   - Implement `loadUser()` with validation
   - Implement `loadDerived()` without validation
   - Implement `loadDeploy()` without validation
   - Wrap errors in ConfigurationError

3. **Refactor**: DRY up loading logic
   - Extract common loading pattern
   - Ensure consistent error handling
   - Add proper null checks

**Success Criteria**:
- [ ] Loading tests pass
- [ ] Configuration loaded correctly
- [ ] Errors wrapped appropriately
- [ ] Missing configs handled gracefully

**Commit**: `feat(config): implement configuration loading`

---

### Episode 10: Implement Configuration Saving Methods

**Objective**: Add saveUser() and saveDeploy() methods

**Duration**: 25-30 minutes

**Files**:
- Modify: `lib/config/configuration-manager.ts`
- Modify: `test/config/configuration-manager.test.ts`

**TDD Cycle**:

1. **Red**: Write saving tests
   ```typescript
   describe("ConfigurationManager.saveUser", () => {
       it("should save user configuration", async () => {
           const mockXdgConfig = {
               write: jest.fn().mockResolvedValue(undefined)
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const config = { quiltStackArn: "test-arn" };
           await configMgr.saveUser(config);

           expect(mockXdgConfig.write).toHaveBeenCalledWith({
               type: "user",
               profile: "default",
               backup: true,
               validate: true,
               addMetadata: true
           }, config);
       });

       it("should throw ConfigurationError on failure", async () => {
           const mockXdgConfig = {
               write: jest.fn().mockRejectedValue(new Error("Write failed"))
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const config = { quiltStackArn: "test-arn" };

           await expect(configMgr.saveUser(config)).rejects.toThrow(ConfigurationError);
       });
   });

   describe("ConfigurationManager.saveDeploy", () => {
       it("should save deployment configuration", async () => {
           const mockXdgConfig = {
               write: jest.fn().mockResolvedValue(undefined)
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const config = { webhookUrl: "https://example.com" };
           await configMgr.saveDeploy(config);

           expect(mockXdgConfig.write).toHaveBeenCalledWith({
               type: "deploy",
               profile: "default",
               backup: false,
               validate: false,
               addMetadata: true
           }, config);
       });
   });
   ```

2. **Green**: Implement saving methods
   - Implement `saveUser()` with validation and backup
   - Implement `saveDeploy()` without validation
   - Wrap errors in ConfigurationError
   - Ensure proper options passed to XDG config

3. **Refactor**: Clean up saving logic
   - Ensure consistent error messages
   - Add proper type checking
   - Add JSDoc documentation

**Success Criteria**:
- [ ] Saving tests pass
- [ ] Configuration saved correctly
- [ ] Errors wrapped appropriately
- [ ] Backup and validation options correct

**Commit**: `feat(config): implement configuration saving`

---

### Episode 11: Implement Configuration Merging

**Objective**: Add load() method with configuration merging logic

**Duration**: 25-30 minutes

**Files**:
- Modify: `lib/config/configuration-manager.ts`
- Modify: `test/config/configuration-manager.test.ts`

**TDD Cycle**:

1. **Red**: Write merging tests
   ```typescript
   describe("ConfigurationManager.load", () => {
       it("should merge all configurations", async () => {
           const mockXdgConfig = {
               read: jest.fn()
                   .mockResolvedValueOnce({ quiltStackArn: "user-arn" })  // user
                   .mockResolvedValueOnce({ region: "us-east-1" })        // derived
                   .mockResolvedValueOnce({ webhookUrl: "https://..." })  // deploy
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const result = await configMgr.load();

           expect(result).toEqual({
               quiltStackArn: "user-arn",
               region: "us-east-1",
               webhookUrl: "https://..."
           });
       });

       it("should prioritize deploy over derived over user", async () => {
           const mockXdgConfig = {
               read: jest.fn()
                   .mockResolvedValueOnce({ key: "user-value" })
                   .mockResolvedValueOnce({ key: "derived-value" })
                   .mockResolvedValueOnce({ key: "deploy-value" })
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const result = await configMgr.load();

           expect(result.key).toBe("deploy-value");
       });

       it("should handle missing configurations gracefully", async () => {
           const mockXdgConfig = {
               read: jest.fn()
                   .mockResolvedValueOnce({ key: "user-value" })
                   .mockResolvedValueOnce(null)  // derived missing
                   .mockResolvedValueOnce(null)  // deploy missing
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const result = await configMgr.load();

           expect(result).toEqual({ key: "user-value" });
       });
   });

   describe("ConfigurationManager.getPaths", () => {
       it("should return XDG paths for profile", () => {
           const mockPaths = {
               user: "/path/to/user.json",
               derived: "/path/to/derived.json",
               deploy: "/path/to/deploy.json"
           };

           const mockXdgConfig = {
               getPaths: jest.fn().mockReturnValue(mockPaths)
           };

           const configMgr = new ConfigurationManager();
           (configMgr as any).xdgConfig = mockXdgConfig;

           const result = configMgr.getPaths();

           expect(result).toEqual(mockPaths);
           expect(mockXdgConfig.getPaths).toHaveBeenCalledWith("default");
       });
   });
   ```

2. **Green**: Implement merging logic
   - Implement `load()` method
   - Call loadUser(), loadDerived(), loadDeploy()
   - Implement `merge()` private method
   - Ensure proper priority: deploy > derived > user
   - Implement `getPaths()` method

3. **Refactor**: Optimize merging
   - Ensure proper spread operator usage
   - Handle undefined/null values
   - Add JSDoc documentation

**Success Criteria**:
- [ ] Merging tests pass
- [ ] Configuration priority correct
- [ ] Missing configs handled
- [ ] getPaths() returns correct paths

**Commit**: `feat(config): implement configuration merging`

---

## Integration Episodes

### Episode 12: Refactor CLI Entry Point

**Objective**: Update bin/cli.ts to use new abstractions

**Duration**: 30-35 minutes

**Files**:
- Modify: `bin/cli.ts`
- Create: `test/cli/cli-integration.test.ts`

**TDD Cycle**:

1. **Red**: Write integration tests
   ```typescript
   describe("CLI integration", () => {
       let originalArgv: string[];

       beforeEach(() => {
           originalArgv = process.argv;
       });

       afterEach(() => {
           process.argv = originalArgv;
       });

       it("should show help when no arguments", async () => {
           const mockOutputHelp = jest.spyOn(Command.prototype, "outputHelp").mockImplementation();

           process.argv = ["node", "cli.js"];

           // Import and run CLI
           await import("../../bin/cli");

           expect(mockOutputHelp).toHaveBeenCalled();
       });

       it("should route to legacy mode for explicit commands", async () => {
           const mockParseAsync = jest.spyOn(Command.prototype, "parseAsync").mockResolvedValue();

           process.argv = ["node", "cli.js", "deploy"];

           await import("../../bin/cli");

           expect(mockParseAsync).toHaveBeenCalled();
       });

       it("should handle errors with ErrorHandler", async () => {
           const mockHandle = jest.spyOn(ErrorHandler, "handle").mockImplementation();
           const mockExecute = jest.spyOn(LegacyCommandMode.prototype, "execute")
               .mockRejectedValue(new Error("test"));

           process.argv = ["node", "cli.js", "deploy"];

           await import("../../bin/cli");

           expect(mockHandle).toHaveBeenCalled();
       });
   });
   ```

2. **Green**: Refactor CLI entry point
   - Import LegacyCommandMode
   - Import ErrorHandler
   - Create main() function
   - Extract args from process.argv
   - Instantiate LegacyCommandMode
   - Check shouldHandle() and route accordingly
   - Wrap with ErrorHandler

3. **Refactor**: Clean up entry point
   - Remove old command registration code
   - Ensure proper error handling
   - Add JSDoc comments
   - Verify shebang line

**Success Criteria**:
- [ ] CLI integration tests pass
- [ ] All existing CLI tests still pass
- [ ] Help display works
- [ ] Commands route correctly
- [ ] Error handling works

**Commit**: `refactor(cli): migrate entry point to LegacyCommandMode`

---

### Episode 13: Add Comprehensive Documentation

**Objective**: Document all new abstractions with JSDoc

**Duration**: 20-25 minutes

**Files**:
- Modify: `lib/cli/command-mode.ts`
- Modify: `lib/cli/legacy-command-mode.ts`
- Modify: `lib/config/configuration-manager.ts`
- Modify: `lib/errors/cli-errors.ts`
- Modify: `lib/errors/error-handler.ts`

**TDD Cycle**:

1. **Red**: Write documentation validation tests
   ```typescript
   describe("Documentation", () => {
       it("should have JSDoc for all public methods", () => {
           // Parse TypeScript files and verify JSDoc presence
           const files = [
               "lib/cli/command-mode.ts",
               "lib/cli/legacy-command-mode.ts",
               "lib/config/configuration-manager.ts",
               "lib/errors/cli-errors.ts",
               "lib/errors/error-handler.ts"
           ];

           for (const file of files) {
               const content = fs.readFileSync(file, "utf-8");
               const publicMethods = extractPublicMethods(content);

               for (const method of publicMethods) {
                   expect(hasJSDoc(content, method)).toBe(true);
               }
           }
       });
   });
   ```

2. **Green**: Add JSDoc comments
   - Add JSDoc for all interfaces
   - Add JSDoc for all classes
   - Add JSDoc for all public methods
   - Add JSDoc for all parameters
   - Add JSDoc for return types
   - Include usage examples where appropriate

3. **Refactor**: Improve documentation
   - Ensure consistency in style
   - Add cross-references
   - Include examples
   - Add @throws tags for errors

**Success Criteria**:
- [ ] All public interfaces documented
- [ ] All classes documented
- [ ] All methods documented
- [ ] Examples provided where helpful
- [ ] TypeScript compiles without warnings

**Commit**: `docs(cli): add comprehensive JSDoc documentation`

---

## Final Validation

### Pre-Merge Checklist

Before merging Phase 1 implementation:

1. **Test Coverage**:
   ```bash
   npm run test              # All tests pass
   npm run test:coverage     # Coverage > 90% on new code
   ```

2. **Code Quality**:
   ```bash
   npm run lint              # No linting errors
   npm run build:typecheck   # No TypeScript errors
   ```

3. **Backward Compatibility**:
   ```bash
   npm run test:local        # Integration tests pass
   ```

4. **Manual Testing**:
   - [ ] `npx benchling-webhook` shows help
   - [ ] `npx benchling-webhook --help` shows help
   - [ ] `npx benchling-webhook --version` shows version
   - [ ] `npx benchling-webhook deploy --help` shows deploy help
   - [ ] All existing commands still work

5. **Documentation**:
   - [ ] All JSDoc comments complete
   - [ ] README unchanged (no user-facing changes)
   - [ ] Phase 1 design document matches implementation

---

## Episode Summary

### Total Episodes: 13

**Stream A (Error Handling)**: 3 episodes, ~50-60 minutes
- Episode 1: CLIError base class
- Episode 2: Specific error types
- Episode 3: Global error handler

**Stream B (CLI Mode)**: 4 episodes, ~85-105 minutes
- Episode 4: ICommandMode interface
- Episode 5: LegacyCommandMode structure
- Episode 6: Command routing logic
- Episode 7: Command registration

**Stream C (Configuration)**: 4 episodes, ~100-120 minutes
- Episode 8: ConfigurationManager structure
- Episode 9: Configuration loading
- Episode 10: Configuration saving
- Episode 11: Configuration merging

**Integration**: 2 episodes, ~50-60 minutes
- Episode 12: CLI entry point refactoring
- Episode 13: Documentation

**Total Estimated Time**: 285-345 minutes (4.75-5.75 hours)

### Episode Dependencies

```
Stream A (Episodes 1-3)
  └─> No dependencies, can start immediately

Stream B (Episodes 4-7)
  └─> Depends on: Episode 2 (error types)

Stream C (Episodes 8-11)
  └─> Depends on: Episode 2 (error types)

Integration (Episodes 12-13)
  └─> Depends on: All streams complete
```

### Implementation Order Options

**Sequential** (one stream at a time):
1. Complete Stream A (Episodes 1-3)
2. Complete Stream B (Episodes 4-7)
3. Complete Stream C (Episodes 8-11)
4. Complete Integration (Episodes 12-13)

**Parallel** (if multiple developers):
1. Start Stream A
2. After Episode 2 complete, start Stream B and Stream C in parallel
3. Complete Integration after all streams done

**Recommended** (single developer, optimal flow):
1. Episodes 1-2 (error foundation)
2. Episode 4 (interface definition)
3. Episode 8 (config structure)
4. Episodes 3, 5-7 (error handler + CLI mode)
5. Episodes 9-11 (config implementation)
6. Episodes 12-13 (integration)
