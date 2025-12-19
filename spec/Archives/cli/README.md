# CLI Implementation Specification

This directory contains the complete specification for implementing npx-based CLI functionality for the `@quiltdata/benchling-webhook` package.

## Goal

Enable users to deploy Benchling webhook integration to AWS using:

```bash
npx @quiltdata/benchling-webhook deploy
```

Without needing to clone the repository or manually manage configuration files.

## Documents

### 1. [CLI_SPEC.md](CLI_SPEC.md)
**Complete technical specification for the CLI implementation**

Covers:
- Architecture and file structure
- CLI interface design (commands, options, help)
- Configuration loading strategy (priority, validation)
- Error handling and user guidance
- Help display formatting
- Refactoring plan for existing code
- Build and publish configuration

**Start here** to understand the complete system design.

### 2. [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md)
**Step-by-step implementation guide**

Covers:
- Phase 1: Project Setup (dependencies, TypeScript config, package.json)
- Phase 2: Extract Core Logic (config utilities, refactor bin/benchling-webhook.ts)
- Phase 3: Implement CLI (entry point, commands: deploy/init/validate)
- Phase 4: Update Documentation
- Phase 5: Testing (manual and automated)
- Phase 6: Publishing (pre-publish checklist, npm publish)

**Use this** as your implementation roadmap. Follow phases sequentially.

### 3. [EXAMPLES.md](EXAMPLES.md)
**Comprehensive usage examples**

Covers:
- Quick start scenarios (beginner to expert)
- First-time setup workflows
- Deployment scenarios (basic, multi-env, CI/CD)
- Configuration management
- Troubleshooting common issues
- CI/CD integration (GitHub Actions, GitLab CI, Jenkins, Docker)
- Advanced usage (programmatic, multi-tenant, health checks)

**Reference this** when writing documentation or testing user workflows.

### 4. [DOCUMENTATION_UPDATES.md](DOCUMENTATION_UPDATES.md)
**Complete documentation update plan**

Covers:
- Files to update (README.md, AGENTS.md, env.template, CHANGELOG.md, package.json)
- New documentation files to create (CLI_GUIDE.md, MIGRATION_GUIDE.md)
- Documentation structure
- Style guide for examples
- Update checklist
- Post-release communication plan

**Follow this** when updating project documentation for the release.

## Quick Reference

### Key Features

✅ **Zero Repository Access** - Users never need to clone the repo
✅ **Progressive Disclosure** - Shows help naturally when needed
✅ **Dual-Mode Operation** - Works as both CLI and importable library
✅ **Smart Defaults** - Infers AWS settings from Quilt catalog
✅ **Clear Error Messages** - Every error tells users what to do next

### Commands

```bash
# Interactive setup
npx @quiltdata/benchling-webhook init

# Deploy
npx @quiltdata/benchling-webhook deploy

# Validate without deploying
npx @quiltdata/benchling-webhook validate

# Help
npx @quiltdata/benchling-webhook --help
```

### Configuration Priority

1. **CLI flags** - `--catalog`, `--bucket`, etc.
2. **Environment variables** - `QUILT_CATALOG`, `BENCHLING_CLIENT_ID`, etc.
3. **.env file** - Project-local configuration
4. **Inferred values** - Auto-discovered from Quilt catalog
5. **Defaults** - Hardcoded fallbacks

### Required User Input

Users must provide:
- `QUILT_CATALOG` - Quilt catalog URL
- `QUILT_USER_BUCKET` - S3 bucket for data
- `BENCHLING_TENANT` - Benchling tenant name
- `BENCHLING_CLIENT_ID` - OAuth client ID
- `BENCHLING_CLIENT_SECRET` - OAuth client secret
- `BENCHLING_APP_DEFINITION_ID` - App definition ID (if webhook verification enabled)

Everything else (AWS account, region, SQS queue, database) is automatically inferred!

## Implementation Timeline

| Phase | Duration | Description |
| ------- | ---------- | ------------- |
| Phase 1: Setup | 2 hours | Install dependencies, configure TypeScript, update package.json |
| Phase 2: Core | 4 hours | Extract config utilities, refactor bin/benchling-webhook.ts |
| Phase 3: CLI | 8 hours | Implement CLI entry point and commands (init, deploy, validate) |
| Phase 4: Docs | 2 hours | Update README, AGENTS.md, env.template, create new docs |
| Phase 5: Testing | 4 hours | Write tests, manual testing, fix issues |
| Phase 6: Publishing | 2 hours | Build, test with npm link, publish to npm |
| **Total** | **~22 hours** | **~3 working days** |

## Dependencies

### New Dependencies to Add

```json
{
  "dependencies": {
    "commander": "^12.0.0",      // CLI argument parsing
    "dotenv-expand": "^11.0.0",  // .env variable expansion
    "chalk": "^4.1.2",           // Terminal colors (v4 for CommonJS)
    "ora": "^5.4.1",             // Spinner/progress indicators (v5 for CommonJS)
    "enquirer": "^2.4.1",        // Interactive prompts
    "boxen": "^5.1.2"            // Terminal boxes (v5 for CommonJS)
  }
}
```

Note: Specific versions chosen for CommonJS compatibility.

## Key Design Decisions

### 1. Why Commander.js?
- Industry standard, well-maintained
- Excellent TypeScript support
- Rich feature set (subcommands, options, help formatting)
- Used by major projects (npm, webpack, etc.)

### 2. Why Not ESM-Only?
- CDK requires CommonJS
- Chalk v5+ and Ora v6+ are ESM-only, breaking compatibility
- Using v4/v5 maintains CommonJS support

### 3. Why Separate Commands Directory?
- Cleaner separation of concerns
- Each command is independently testable
- Easier to add new commands later
- Follows Commander.js best practices

### 4. Why Keep bin/benchling-webhook.ts?
- Backwards compatibility for existing users
- Library usage (programmatic access)
- Separation of CLI and core deployment logic

### 5. Why Auto-Inference?
- Reduces configuration burden (5 values → everything else automatic)
- Leverages existing Quilt infrastructure
- Aligns with "just works" philosophy
- Users only provide Benchling credentials + catalog URL

## Success Criteria

The implementation is successful if:

1. ✅ User can run `npx @quiltdata/benchling-webhook init && deploy` from scratch
2. ✅ All error messages are actionable (tell user exactly what to do)
3. ✅ Inference discovers AWS settings, queue, database automatically
4. ✅ Package can still be imported as a library
5. ✅ Help text is comprehensive and well-formatted
6. ✅ All existing npm scripts still work
7. ✅ Documentation is clear and complete

## Testing Strategy

### Manual Testing

```bash
# Test help
npx benchling-webhook --help
npx benchling-webhook init --help
npx benchling-webhook deploy --help
npx benchling-webhook validate --help

# Test init
npx benchling-webhook init
npx benchling-webhook init --force
npx benchling-webhook init --minimal
npx benchling-webhook init --infer

# Test validate
npx benchling-webhook validate
npx benchling-webhook validate --verbose
npx benchling-webhook validate --env-file .env.test

# Test deploy
npx benchling-webhook deploy
npx benchling-webhook deploy --yes
npx benchling-webhook deploy --region us-west-2
npx benchling-webhook deploy --catalog test.com --bucket test-bucket
```

### Automated Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e
```

## Publishing Checklist

Before publishing v0.6.0:

- [ ] All TypeScript compiles without errors
- [ ] All tests pass
- [ ] Manual testing completed
- [ ] `env.template` included in package
- [ ] `dist/bin/cli.js` is executable
- [ ] README.md updated with npx usage
- [ ] CHANGELOG.md updated
- [ ] AGENTS.md updated
- [ ] Version bumped in package.json
- [ ] Built locally and tested with `npm link`
- [ ] Published to npm
- [ ] Tested from npm: `npx @quiltdata/benchling-webhook --help`
- [ ] GitHub release created
- [ ] Documentation deployed
- [ ] Social media announcement prepared

## Rollout Plan

### Phase 1: Internal Testing (Week 1)
- Deploy to internal staging environment
- Team members test with real credentials
- Collect feedback, fix issues

### Phase 2: Beta Release (Week 2)
- Publish as `0.6.0-beta.1`
- Announce to select users for testing
- Monitor npm downloads and GitHub issues
- Iterate based on feedback

### Phase 3: Stable Release (Week 3)
- Publish as `0.6.0`
- Update all documentation
- Announce on social media, blog, newsletter
- Monitor for issues, respond to user questions

### Phase 4: Migration (Weeks 4-8)
- Encourage existing users to try new CLI
- Provide migration support
- Update all external tutorials/guides
- Gather feedback for v0.7.0

## Maintenance Plan

### Weekly
- Monitor GitHub issues for CLI-related problems
- Respond to user questions
- Track npm download statistics

### Monthly
- Review analytics to see which commands are used most
- Update documentation based on user feedback
- Fix any bugs discovered

### Quarterly
- Major version bump if breaking changes needed
- Add new features based on user requests
- Review and update all documentation
- Check for dependency updates

## Future Enhancements

Ideas for v0.7.0 and beyond:

1. **OAuth Flow for Benchling** - Automate credential setup
2. **Secrets Manager Integration** - Read credentials from AWS Secrets Manager
3. **Multi-Stack Support** - Deploy multiple stacks with one command
4. **Status Command** - Check deployment health
5. **Destroy Command** - Easy stack teardown
6. **Diff Command** - Preview changes before deploy
7. **Logs Command** - Tail CloudWatch logs
8. **Environment Profiles** - Named configurations (dev, staging, prod)
9. **Plugin System** - Allow custom commands
10. **Web UI** - Optional web interface for configuration

## Getting Help

If you have questions while implementing:

1. Read the relevant specification document
2. Check the examples in [EXAMPLES.md](EXAMPLES.md)
3. Review the refactoring guide in [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md)
4. Ask the team in Slack/Discord
5. Open a GitHub discussion

## Contributing

When implementing:

1. Follow the phase order in [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md)
2. Test each phase before moving to the next
3. Update documentation as you go
4. Write tests for new functionality
5. Get code review before merging
6. Update this README if anything changes

## License

Apache-2.0 (same as main project)

---

**Last Updated:** 2025-10-29
**Version:** 0.6.0-spec
**Status:** Ready for implementation
