# Implementation Checklist

Use this checklist to track progress while implementing the CLI functionality.

## Phase 1: Project Setup

### Dependencies
- [ ] Install `commander` (^12.0.0)
- [ ] Install `dotenv-expand` (^11.0.0)
- [ ] Install `chalk@4` (^4.1.2)
- [ ] Install `ora@5` (^5.4.1)
- [ ] Install `enquirer` (^2.4.1)
- [ ] Install `boxen@5` (^5.1.2)
- [ ] Update `package.json` dependencies section
- [ ] Run `npm install` to install all dependencies

### TypeScript Configuration
- [ ] Update `tsconfig.json` with correct settings
- [ ] Set `outDir` to `./dist`
- [ ] Set `rootDir` to `./`
- [ ] Include `bin/**/*` and `lib/**/*`
- [ ] Exclude `dist`, `node_modules`, `**/*.test.ts`
- [ ] Verify TypeScript compiles without errors

### Package Configuration
- [ ] Update `package.json` bin field to `dist/bin/cli.js`
- [ ] Add `env.template` to files array
- [ ] Update scripts: `build`, `prebuild`, `postbuild`
- [ ] Add `prepublishOnly` script
- [ ] Update description with CLI mention
- [ ] Add CLI-related keywords
- [ ] Verify `package.json` is valid JSON

### Directory Structure
- [ ] Create `lib/utils/` directory
- [ ] Create `bin/commands/` directory
- [ ] Create `.scratch/cli/` directory (already exists)
- [ ] Verify all directories exist

---

## Phase 2: Extract Core Logic

### Config Utility
- [ ] Create `lib/utils/config.ts`
- [ ] Define `Config` interface
- [ ] Define `ConfigOptions` interface
- [ ] Define `ValidationResult` interface
- [ ] Define `ValidationError` interface
- [ ] Implement `loadDotenv()` function
- [ ] Implement `loadConfigSync()` function
- [ ] Implement `mergeInferredConfig()` function
- [ ] Implement `validateConfig()` function
- [ ] Implement `formatValidationErrors()` function
- [ ] Export all public interfaces and functions
- [ ] Add TypeScript types for all functions
- [ ] Test config loading with sample .env file
- [ ] Test validation with valid/invalid configs

### Refactor bin/benchling-webhook.ts
- [ ] Read current `bin/benchling-webhook.ts` implementation
- [ ] Extract `checkCdkBootstrap()` as pure function
- [ ] Extract `inferStackConfig()` wrapper function
- [ ] Extract `createStack()` as pure function
- [ ] Remove console.log statements (return values instead)
- [ ] Remove process.exit() calls (throw errors instead)
- [ ] Create `BootstrapStatus` interface
- [ ] Create `DeploymentResult` interface
- [ ] Create `InferenceResult` interface
- [ ] Export all functions for CLI and library use
- [ ] Keep legacy main() for backwards compatibility
- [ ] Update imports in dependent files
- [ ] Test refactored functions compile
- [ ] Test legacy workflow still works

---

## Phase 3: Implement CLI

### Main CLI Entry Point
- [ ] Create `bin/cli.ts` file
- [ ] Add shebang: `#!/usr/bin/env node`
- [ ] Import commander, chalk, and command handlers
- [ ] Load package.json for version
- [ ] Create program with `.name()`, `.description()`, `.version()`
- [ ] Define `deploy` command (with `isDefault: true`)
- [ ] Add all deploy options (catalog, bucket, tenant, etc.)
- [ ] Define `init` command
- [ ] Add all init options (output, force, minimal, infer)
- [ ] Define `validate` command
- [ ] Add all validate options (env-file, verbose)
- [ ] Add error handling for command failures
- [ ] Add help output when no args provided
- [ ] Call `program.parse()`
- [ ] Make file executable: `chmod +x bin/cli.ts`
- [ ] Test CLI compiles to `dist/bin/cli.js`
- [ ] Test `--help` works

### Deploy Command
- [ ] Create `bin/commands/deploy.ts`
- [ ] Import required dependencies (ora, chalk, boxen, etc.)
- [ ] Import config utilities and core functions
- [ ] Define `deployCommand()` async function
- [ ] Display welcome box with title
- [ ] Step 1: Load configuration with spinner
- [ ] Step 2: Attempt inference from catalog
- [ ] Step 3: Merge inferred values
- [ ] Step 4: Validate configuration
- [ ] Handle validation errors with formatted output
- [ ] Display warnings if any
- [ ] Step 5: Check CDK bootstrap (if enabled)
- [ ] Handle bootstrap errors with solution
- [ ] Step 6: Display deployment plan
- [ ] Step 7: Prompt for confirmation (unless --yes)
- [ ] Step 8: Create stack (synthesis)
- [ ] Step 9: Execute CDK deploy via execSync
- [ ] Handle deployment errors
- [ ] Display success message with next steps
- [ ] Export deployCommand function
- [ ] Test deploy command with mock config
- [ ] Test deploy command with real config (dry run)

### Init Command
- [ ] Create `bin/commands/init.ts`
- [ ] Import fs, path, ora, chalk, boxen, enquirer
- [ ] Import inferConfiguration function
- [ ] Define `InitOptions` interface
- [ ] Define `initCommand()` async function
- [ ] Display welcome box
- [ ] Show what user will need
- [ ] Check if output file exists
- [ ] Prompt to overwrite if exists and not --force
- [ ] Define interactive prompts array
- [ ] Prompt for: catalog, bucket, tenant, client ID, secret, app ID
- [ ] Validate each prompt input
- [ ] Build .env content with header
- [ ] Add required user values
- [ ] If --infer: attempt inference from catalog
- [ ] Add inferred values to .env content
- [ ] Add optional configuration section (unless --minimal)
- [ ] Write file to disk
- [ ] Display success message with next steps
- [ ] Export initCommand function
- [ ] Test init command (interrupt with Ctrl+C)
- [ ] Test init command with --force
- [ ] Test init command with --infer

### Validate Command
- [ ] Create `bin/commands/validate.ts`
- [ ] Import ora, chalk, boxen, config utilities
- [ ] Import checkCdkBootstrap, inferConfiguration
- [ ] Define `validateCommand()` async function
- [ ] Display welcome box
- [ ] Step 1: Load configuration with spinner
- [ ] Step 2: Attempt inference from catalog
- [ ] Step 3: Merge inferred values
- [ ] Step 4: Validate configuration
- [ ] Display validation result
- [ ] If verbose: show configuration summary
- [ ] Show required user values with ✓/✗
- [ ] Show inferred values with ✓/✗
- [ ] Step 5: Check AWS credentials
- [ ] Show account ID if found
- [ ] Step 6: Check CDK bootstrap (if account/region available)
- [ ] Display final result box
- [ ] If valid: show success with deploy command
- [ ] If invalid: show errors with solutions
- [ ] Exit with appropriate code
- [ ] Export validateCommand function
- [ ] Test validate with missing config
- [ ] Test validate with complete config
- [ ] Test validate with --verbose

---

## Phase 4: Update Documentation

### README.md
- [ ] Add badges (npm version, license)
- [ ] Add "New in v0.6.0" notice
- [ ] Replace "Quick Install" with "Quick Start"
- [ ] Show npx as Option 1 (recommended)
- [ ] Show repository clone as Option 2
- [ ] Add "What You'll Need" section
- [ ] Add "CLI Reference" section
- [ ] Document all commands (init, deploy, validate)
- [ ] Add "Configuration" section
- [ ] Explain priority order
- [ ] List required configuration
- [ ] List auto-inferred configuration
- [ ] Add "Examples" section
- [ ] Update "Usage" section with CLI examples
- [ ] Add "Programmatic Usage" section
- [ ] Test all command examples work
- [ ] Test all links resolve

### AGENTS.md
- [ ] Update "Deployment" section
- [ ] Show npx as "Quick Deploy (Recommended)"
- [ ] Keep repository method as alternative
- [ ] Update configuration section
- [ ] Explain minimal required config
- [ ] Explain auto-inferred config
- [ ] Add validation section
- [ ] Test all examples work

### env.template
- [ ] Update header comment
- [ ] Mention `npx @quiltdata/benchling-webhook init`
- [ ] Add footer with CLI usage examples
- [ ] Keep all existing configuration options
- [ ] Verify format is valid

### CHANGELOG.md
- [ ] Add new [0.6.0] section
- [ ] List all new features (CLI, init, validate, etc.)
- [ ] List all changes (config loading, refactoring, etc.)
- [ ] List all fixes
- [ ] Add migration guide section
- [ ] Show old vs new workflow
- [ ] Note no breaking changes
- [ ] Set release date when publishing

### package.json
- [ ] Update description to mention CLI/npx
- [ ] Add CLI-related keywords
- [ ] Add homepage URL
- [ ] Add bugs URL
- [ ] Verify all URLs are correct

### New Documentation Files
- [ ] Create `docs/` directory
- [ ] Create `docs/CLI_GUIDE.md`
- [ ] Copy comprehensive CLI docs from EXAMPLES.md
- [ ] Create `docs/MIGRATION_GUIDE.md`
- [ ] Write migration guide for existing users
- [ ] Show old vs new workflows
- [ ] Explain benefits
- [ ] Provide step-by-step migration
- [ ] Update CI/CD examples
- [ ] Add FAQ section

### docker/README.md
- [ ] Add note at top recommending CLI for most users
- [ ] Keep existing Docker documentation
- [ ] Note Docker guide is for advanced users

---

## Phase 5: Testing

### Manual Testing
- [ ] Build project: `npm run build`
- [ ] Verify `dist/bin/cli.js` exists and is executable
- [ ] Test `--help`: `node dist/bin/cli.js --help`
- [ ] Test `--version`: `node dist/bin/cli.js --version`
- [ ] Test `init --help`: `node dist/bin/cli.js init --help`
- [ ] Test `deploy --help`: `node dist/bin/cli.js deploy --help`
- [ ] Test `validate --help`: `node dist/bin/cli.js validate --help`
- [ ] Test init command (run and cancel)
- [ ] Test init with --output flag
- [ ] Test init with --force flag
- [ ] Test validate with missing config
- [ ] Test validate with valid config
- [ ] Test validate with --verbose
- [ ] Test deploy with missing config (should fail)
- [ ] Test deploy with valid config (dry run)
- [ ] Create test .env file
- [ ] Test deploy with test .env (full deployment)
- [ ] Verify stack deploys successfully
- [ ] Test all CLI options work
- [ ] Test error messages are helpful

### Local npm Testing
- [ ] Run `npm link` in project directory
- [ ] Test globally: `benchling-webhook --help`
- [ ] Test with npx: `npx benchling-webhook --help`
- [ ] Create separate test directory
- [ ] Test CLI from different directory
- [ ] Test init creates .env file
- [ ] Test deploy uses .env file
- [ ] Verify everything works as expected
- [ ] Run `npm unlink` when done

### Automated Testing
- [ ] Create `lib/utils/config.test.ts`
- [ ] Test `loadDotenv()` function
- [ ] Test `loadConfigSync()` with various inputs
- [ ] Test config priority (CLI > env > .env)
- [ ] Test `validateConfig()` with valid/invalid configs
- [ ] Test `formatValidationErrors()` output
- [ ] Create `bin/benchling-webhook.test.ts`
- [ ] Test `checkCdkBootstrap()` function
- [ ] Test `inferConfiguration()` function
- [ ] Test `createStack()` function
- [ ] Create `bin/commands/deploy.test.ts`
- [ ] Test deployCommand with mock data
- [ ] Run all tests: `npm test`
- [ ] Verify all tests pass
- [ ] Add test coverage report
- [ ] Aim for >80% coverage

### Documentation Testing
- [ ] Extract all bash code blocks from docs
- [ ] Test each command example
- [ ] Verify all commands execute without errors
- [ ] Check all internal links resolve
- [ ] Check all external links resolve
- [ ] Verify code formatting is consistent
- [ ] Check for typos and grammar
- [ ] Ensure all examples use `@quiltdata/benchling-webhook`
- [ ] Verify env.template is valid
- [ ] Test that .env.template → .env works

---

## Phase 6: Publishing

### Pre-Publish
- [ ] Run full test suite: `npm test`
- [ ] Run linter: `npm run lint`
- [ ] Build project: `npm run build`
- [ ] Verify dist/ contains all files
- [ ] Check dist/bin/cli.js is executable
- [ ] Check dist/lib/ contains all modules
- [ ] Test with npm link
- [ ] Create test account and deploy
- [ ] Verify deployment works end-to-end
- [ ] Review all documentation one more time
- [ ] Update version in package.json (0.6.0)
- [ ] Update CHANGELOG.md with release date
- [ ] Commit all changes
- [ ] Create git tag: `git tag v0.6.0`

### Publish to npm
- [ ] Log in to npm: `npm login`
- [ ] Verify you have publish access
- [ ] Publish: `npm publish --access public`
- [ ] Verify package on npm: https://www.npmjs.com/package/@quiltdata/benchling-webhook
- [ ] Check package page shows updated README
- [ ] Test installation: `npx @quiltdata/benchling-webhook --help`
- [ ] Test from fresh directory
- [ ] Test init command from npm
- [ ] Test deploy command from npm
- [ ] Verify everything works

### Post-Publish
- [ ] Push to GitHub: `git push origin main --tags`
- [ ] Create GitHub release (v0.6.0)
- [ ] Copy CHANGELOG entry to release notes
- [ ] Attach any relevant files
- [ ] Announce on Twitter/LinkedIn
- [ ] Announce on company blog
- [ ] Send email to existing users
- [ ] Update any external documentation
- [ ] Update company wiki/docs
- [ ] Monitor GitHub issues for problems
- [ ] Respond to user questions
- [ ] Fix critical bugs immediately

---

## Verification Checklist

### Functionality
- [ ] ✅ User can run `npx @quiltdata/benchling-webhook` without cloning repo
- [ ] ✅ Init command creates valid .env file
- [ ] ✅ Deploy command deploys stack successfully
- [ ] ✅ Validate command checks configuration correctly
- [ ] ✅ Configuration can be provided via .env, env vars, or CLI flags
- [ ] ✅ Values are auto-inferred from catalog
- [ ] ✅ Error messages are clear and actionable
- [ ] ✅ Help text is comprehensive
- [ ] ✅ Package can be imported as library
- [ ] ✅ All existing npm scripts still work

### Documentation
- [ ] ✅ README.md shows npx-first approach
- [ ] ✅ All command examples are correct
- [ ] ✅ All links work
- [ ] ✅ Migration guide is clear
- [ ] ✅ CLI guide is comprehensive
- [ ] ✅ CHANGELOG is up to date
- [ ] ✅ env.template is correct

### Quality
- [ ] ✅ TypeScript compiles without errors
- [ ] ✅ No linter warnings
- [ ] ✅ All tests pass
- [ ] ✅ Test coverage >80%
- [ ] ✅ No security vulnerabilities
- [ ] ✅ Dependencies are up to date
- [ ] ✅ Package size is reasonable

### UX
- [ ] ✅ First-time user can deploy in <15 minutes
- [ ] ✅ Error messages guide user to solution
- [ ] ✅ Spinners/progress indicators work
- [ ] ✅ Colors/formatting look good
- [ ] ✅ Prompts are clear and validate input
- [ ] ✅ Success messages are celebratory
- [ ] ✅ Help text is well-formatted

---

## Rollback Plan

If critical issues are found after publish:

### Minor Issues
- [ ] Fix in patch release (0.6.1)
- [ ] Publish fix
- [ ] Announce fix

### Major Issues
- [ ] Deprecate 0.6.0: `npm deprecate @quiltdata/benchling-webhook@0.6.0 "Critical bug, use 0.5.x"`
- [ ] Publish fixed version (0.6.1) or rollback to 0.5.x
- [ ] Communicate to all users
- [ ] Update documentation
- [ ] Post-mortem analysis

---

## Progress Tracking

**Started:** _______________

**Phase 1 Complete:** _______________
**Phase 2 Complete:** _______________
**Phase 3 Complete:** _______________
**Phase 4 Complete:** _______________
**Phase 5 Complete:** _______________
**Phase 6 Complete:** _______________

**Published:** _______________

**Total Time:** _______________ hours

---

## Notes

Use this section to track any deviations from the plan, issues encountered, or lessons learned:

```
Date: _______________
Note: _______________________________________________
_____________________________________________________
_____________________________________________________

Date: _______________
Note: _______________________________________________
_____________________________________________________
_____________________________________________________
```

---

## Sign-Off

**Implementation Complete:** [ ]
**Reviewed By:** _______________
**Date:** _______________
**Approved By:** _______________
**Date:** _______________

---

**Good luck with the implementation! 🚀**
