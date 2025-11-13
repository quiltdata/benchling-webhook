# Requirements Document - Issue #221: Next Steps

**GitHub Issue**: #221
**Title**: next steps
**Created**: 2025-11-12
**Branch**: 221-next-steps

## Problem Statement

The current CLI implementation has two user experience issues:

1. **Incorrect next steps context**: After completing the setup wizard, the displayed next steps assume users are working within the repository (showing `npm run deploy`) rather than using the published package via npx (which should show `npx @quiltdata/benchling-webhook deploy`)

2. **Incomplete default workflow**: The CLI should default to an 'install' action that automatically chains setup and deploy together, eliminating the need for users to run a separate deploy command after setup

## User Stories

### Story 1: Package User Experience
**As a** user installing the package via npx
**I want** to see next steps that work in my context (using npx commands)
**So that** I can successfully deploy without confusion about command syntax

**Current behavior**: Setup wizard shows:
```
Next steps:
  1. Deploy to AWS: npm run deploy
  2. Test integration: npm run test
```

**Expected behavior**: Setup wizard should show:
```
Next steps:
  1. Deploy to AWS: npx @quiltdata/benchling-webhook deploy
  2. Test integration: npx @quiltdata/benchling-webhook test
```

### Story 2: Seamless Installation Flow
**As a** user installing the package for the first time
**I want** setup and deployment to happen automatically in one step
**So that** I don't have to remember to run a separate deploy command

**Current behavior**: Users must run:
```bash
npx @quiltdata/benchling-webhook        # Run setup wizard
npx @quiltdata/benchling-webhook deploy # Then deploy manually
```

**Expected behavior**: Users should be able to run:
```bash
npx @quiltdata/benchling-webhook        # Runs setup + deploy automatically
```

With an option to skip deployment if needed:
```bash
npx @quiltdata/benchling-webhook --setup-only  # Just setup, no deploy
```

### Story 3: Repository Developer Experience
**As a** repository developer using npm scripts
**I want** to continue using `npm run deploy` and `npm run setup`
**So that** my development workflow remains unchanged

**Expected behavior**: Repository developers should still be able to use:
```bash
npm run setup      # Setup only
npm run deploy     # Deploy only
```

## Acceptance Criteria

### AC1: Context-Aware Next Steps
- [ ] Setup wizard detects whether it's running in repository context or npx context
- [ ] When run via npx, next steps display `npx @quiltdata/benchling-webhook <command>`
- [ ] When run via npm scripts, next steps display `npm run <command>`
- [ ] Custom profile next steps show correct command format for the context

### AC2: Chained Installation Workflow
- [ ] Default CLI behavior (no command specified) runs setup wizard followed by automatic deployment
- [ ] `--setup-only` flag available to run setup without deployment
- [ ] `--skip-confirmation` or `--yes` flag skips deployment confirmation prompt
- [ ] Errors during setup prevent deployment from running
- [ ] Users are informed that deployment will follow setup
- [ ] Deployment uses the same profile/stage as setup

### AC3: Backward Compatibility
- [ ] Existing `deploy` command continues to work independently
- [ ] Existing `init` command (legacy alias) continues to work
- [ ] Repository npm scripts (`npm run setup`, `npm run deploy`) continue to work
- [ ] All existing CLI flags and options remain functional

### AC4: User Feedback and Error Handling
- [ ] Clear progress indication during setup → deploy chain
- [ ] Deployment success/failure clearly reported
- [ ] Failed deployments provide actionable next steps
- [ ] Users can opt out of automatic deployment when prompted

## High-Level Implementation Approach

1. **Context Detection**: Add logic to detect execution context (npx vs repository)
2. **Next Steps Generation**: Create context-aware next steps message generator
3. **Chained Workflow**: Modify setup wizard to offer deployment after setup
4. **User Prompts**: Add confirmation prompt before automatic deployment
5. **Error Handling**: Ensure setup errors prevent deployment, handle deployment failures gracefully

## Success Criteria

1. **Accuracy**: Next steps match the user's execution context 100% of the time
2. **Convenience**: 90%+ of users successfully deploy using just `npx @quiltdata/benchling-webhook`
3. **Clarity**: Zero confusion-related issues reported about next steps commands
4. **Compatibility**: Zero breaking changes to existing workflows
5. **Documentation**: README.md accurately reflects new behavior

## Open Questions

1. **Default behavior choice**: Should the default be to deploy automatically, or should we always prompt? (Proposed: Prompt with default=yes)
2. **Skip flag naming**: Should we use `--setup-only`, `--no-deploy`, or both?
3. **Profile handling**: When chaining setup+deploy, should we support custom profile/stage flags?
4. **Test command context**: Should we also fix the test command in next steps, or only deploy?

## Out of Scope

- Modifying deployment logic itself (only changing when/how it's invoked)
- Changing configuration storage or validation
- Altering any commands other than the default behavior and next steps display
- Internationalization of messages

## Dependencies

- GitHub issue #221
- Current XDG configuration system (v0.7.0)
- Existing CLI architecture (Commander.js)
- Profile-based deployment system

## References

- Issue: https://github.com/quiltdata/benchling-webhook/issues/221
- README.md Quick Start section
- bin/cli.ts default behavior (lines 187-221)
- bin/commands/setup-wizard.ts next steps (lines 817-836)
