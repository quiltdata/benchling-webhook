# Analysis Document - Issue #221: Next Steps

**Reference**: spec/221-next-steps/01-requirements.md
**GitHub Issue**: #221

## Current State Analysis

### 1. Execution Context Detection

**Current Implementation**: None
**Location**: bin/cli.ts, bin/commands/setup-wizard.ts

The CLI currently has no mechanism to detect whether it's being executed via:
- `npx @quiltdata/benchling-webhook` (package user)
- `npm run setup` (repository developer)
- `ts-node bin/cli.ts` (repository developer)

**Code Evidence** (bin/cli.ts:187-221):
```typescript
if ((!args.length || (args.length > 0 && args[0].startsWith("--") && !isHelpOrVersion))) {
    // ... setup wizard invocation
    setupWizardCommand(options)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        });
}
```

**Analysis**: The default behavior simply runs the setup wizard without any context awareness or follow-up actions.

### 2. Next Steps Display

**Current Implementation**: Hardcoded, assumes repository context
**Location**: bin/commands/setup-wizard.ts:817-836

**Code Evidence**:
```typescript
console.log("Next steps:");
if (profile === "default") {
    console.log("  1. Deploy to AWS: npm run deploy");
    console.log("  2. Test integration: npm run test\n");
} else if (profile === "dev") {
    console.log("  1. Deploy to AWS: npm run deploy:dev");
    console.log("  2. Test integration: npm run test:dev\n");
} else if (profile === "prod") {
    console.log("  1. Deploy to AWS: npm run deploy:prod");
    console.log("  2. Test integration: npm run test:prod\n");
} else {
    console.log(`  1. Deploy to AWS: npm run deploy -- --profile ${profile} --stage ${profile}`);
    console.log(`  2. Check logs: npx ts-node scripts/check-logs.ts --profile ${profile}\n`);
}
```

**Issues Identified**:
1. **Incorrect assumptions**: Always shows `npm run` commands, which don't work for npx users
2. **Inconsistency**: Custom profiles show a mix of `npm run` and `npx ts-node` (note: this last line is actually npx)
3. **Missing context**: No way to determine if user has access to npm scripts
4. **Incomplete**: Test commands assume repository structure

### 3. CLI Command Architecture

**Current Structure**:
- **Default behavior** (no command): Runs setup wizard only
- **Explicit commands**: `deploy`, `init`, `validate`, `test`, `manifest`, etc.
- **Command registration**: Commander.js based, registered in bin/cli.ts

**Code Evidence** (bin/cli.ts:19-41):
```typescript
program
    .name("benchling-webhook")
    .description("Benchling Webhook Integration for Quilt - Deploy lab notebook integration to AWS\n\n" +
                 "Run without arguments for interactive setup wizard")
    .version(pkg.version, "-v, --version", "Display version number")
```

**Analysis**:
- Clear separation of concerns between commands
- Setup and deploy are independent operations
- No built-in chaining mechanism
- Default behavior is documented but not leveraging full potential

### 4. Deployment Command

**Current Implementation**: Standalone command
**Location**: bin/commands/deploy.ts

**Key characteristics**:
- Can be invoked independently
- Requires configuration to exist (reads from XDG config)
- Has extensive options for customization
- Returns deployment outputs (including webhook URL)

**Integration potential**: High - deploy command is already modular and can be invoked programmatically.

### 5. Package.json Configuration

**Relevant fields**:
```json
{
  "name": "@quiltdata/benchling-webhook",
  "bin": {
    "benchling-webhook": "./dist/bin/cli.js"
  },
  "scripts": {
    "setup": "ts-node bin/cli.ts",
    "deploy:prod": "ts-node bin/cli.ts deploy --stage prod",
    // ... etc
  }
}
```

**Analysis**:
- Package name: `@quiltdata/benchling-webhook`
- Binary name: `benchling-webhook`
- NPX invocation: `npx @quiltdata/benchling-webhook`
- Repository npm scripts exist for developer convenience

### 6. README.md Documented Behavior

**Quick Start section** (README.md:18-45):
```markdown
### 2. Run the setup wizard

npx @quiltdata/benchling-webhook@latest

The wizard will:
1. Detect your Quilt stack from AWS CloudFormation
2. Collect and validate your Benchling credentials
3. Sync secrets to AWS Secrets Manager
4. Deploy to AWS  // <-- CLAIMS to deploy, but doesn't!
```

**Critical Finding**: README.md claims step 2 deploys to AWS, but the current implementation only runs setup. This is a **documentation/behavior mismatch**.

## Architectural Patterns

### Current CLI Pattern
```
User invokes CLI
  → Parse command
  → Execute single command
  → Exit
```

### Proposed CLI Pattern
```
User invokes CLI (no command)
  → Run setup wizard
  → Prompt for deployment
  → If yes: Execute deploy command
  → Display context-aware next steps
  → Exit
```

## Constraints and Limitations

### Technical Constraints

1. **Process model**: Node.js process execution model requires careful handling of async operations
2. **Commander.js**: Need to work within Commander's command parsing model
3. **Error handling**: Must handle errors at each step of the chain
4. **Exit codes**: Need proper exit codes for CI/CD integration

### Backward Compatibility Constraints

1. **Existing npm scripts**: Must not break `npm run setup`, `npm run deploy`, etc.
2. **Explicit commands**: `npx @quiltdata/benchling-webhook deploy` must continue to work
3. **Command options**: All existing flags must remain functional
4. **Legacy `init` command**: Must continue to work as alias

### User Experience Constraints

1. **Non-interactive mode**: `--yes` flag should still work and skip all prompts
2. **Profile inheritance**: Complex profile scenarios must be handled
3. **Error recovery**: Failed setups shouldn't attempt deployment
4. **Progress indication**: Users need clear feedback during multi-step operations

## Gap Analysis

### Gap 1: Context Detection
**Current**: No detection mechanism
**Required**: Reliable way to determine execution context
**Complexity**: Medium - need to check for package structure, npm scripts availability

### Gap 2: Next Steps Generator
**Current**: Hardcoded messages in setup-wizard.ts
**Required**: Dynamic message generator based on context and profile
**Complexity**: Low - straightforward string generation logic

### Gap 3: Command Chaining
**Current**: No chaining support
**Required**: Ability to run setup → deploy as atomic operation
**Complexity**: Medium - need to handle errors, prompts, and state between commands

### Gap 4: Documentation Sync
**Current**: README claims behavior that doesn't exist
**Required**: Update README to match actual behavior (or implement claimed behavior)
**Complexity**: Low - documentation update

### Gap 5: User Prompts
**Current**: No prompt before deployment
**Required**: Confirmation prompt with sensible defaults
**Complexity**: Low - add inquirer prompt

## Challenges and Risks

### Challenge 1: Detecting Execution Context
**Problem**: How to reliably detect if running via npx vs repository?

**Possible approaches**:
1. Check if `node_modules/@quiltdata/benchling-webhook` exists in cwd
2. Check if `package.json` in cwd has matching name
3. Check if typescript source files exist (bin/*.ts)
4. Check process.argv[1] path

**Risk**: False positives/negatives leading to incorrect next steps

### Challenge 2: Error Handling in Chains
**Problem**: Setup succeeds but deploy fails - what should we show?

**Considerations**:
- Should we consider this a partial success or failure?
- What exit code to use?
- Should we rollback setup?
- How to guide users to retry just deployment?

**Risk**: Confused users with partial failures

### Challenge 3: Non-Interactive Mode
**Problem**: How should `--yes` flag work with chained operations?

**Options**:
1. Auto-deploy without prompting
2. Skip deployment by default
3. Require explicit `--no-deploy` to skip

**Risk**: Unexpected behavior in CI/CD pipelines

### Challenge 4: Profile/Stage Coordination
**Problem**: Setup creates profile, deploy needs to use the same profile/stage

**Considerations**:
- How to pass context between setup and deploy?
- What if user specified `--profile` flag?
- Should deploy inherit all setup options?

**Risk**: Mismatched configuration between setup and deploy

## Code Idioms and Conventions

### Existing Patterns to Follow

1. **Chalk for output styling**:
   ```typescript
   console.log(chalk.blue("Creating app manifest..."));
   console.error(chalk.red((error as Error).message));
   console.warn(chalk.yellow("⚠️  Warning message"));
   ```

2. **Inquirer for prompts**:
   ```typescript
   const { proceed } = await inquirer.prompt([{
       type: "confirm",
       name: "proceed",
       message: "Continue with deployment?",
       default: true,
   }]);
   ```

3. **Boxed output for important messages**: Used in manifest command (via boxen library)

4. **Async/await pattern**: All commands are async functions

5. **Error handling pattern**:
   ```typescript
   try {
       await command(options);
   } catch (error) {
       console.error(chalk.red((error as Error).message));
       process.exit(1);
   }
   ```

6. **Options destructuring**:
   ```typescript
   const {
       profile = "default",
       stage = "prod",
       region,
   } = options;
   ```

## Technical Debt Opportunities

1. **Extract next steps logic**: Move from setup-wizard.ts to separate module for reusability
2. **Add context module**: Create dedicated module for execution context detection
3. **Command orchestration**: Consider adding a command orchestrator pattern for multi-step workflows
4. **Testing gaps**: Add tests for CLI invocation and next steps generation

## Dependencies and Integration Points

### Internal Dependencies
- `bin/cli.ts` - CLI entry point
- `bin/commands/setup-wizard.ts` - Setup wizard command
- `bin/commands/deploy.ts` - Deploy command
- `lib/xdg-config.ts` - Configuration management
- `package.json` - Package metadata and scripts

### External Dependencies
- `commander` - CLI framework
- `inquirer` - Interactive prompts
- `chalk` - Terminal styling
- `boxen` - Boxed messages

### File System Dependencies
- `~/.config/benchling-webhook/{profile}/` - XDG configuration
- `package.json` - Context detection
- `node_modules/` - Context detection

## Summary

The current implementation has a clear separation between setup and deploy commands, but lacks:

1. **Context awareness**: Cannot detect execution environment
2. **Command chaining**: No mechanism to run multi-step workflows
3. **Dynamic messaging**: Next steps are hardcoded and incorrect for npx users
4. **README alignment**: Documentation promises behavior that doesn't exist

The codebase uses consistent patterns (chalk, inquirer, async/await) that will support the required changes. The main architectural gap is the lack of a command orchestration layer for chaining operations with proper error handling and user feedback.

The solution requires:
- Adding context detection logic
- Creating a next steps generator module
- Implementing command chaining with user confirmation
- Updating documentation to match behavior
- Ensuring backward compatibility with existing workflows
