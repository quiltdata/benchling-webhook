# Implementation Checklist: NPX UX Overhaul (v0.7.0)

**Branch**: `npx-ux`
**Target Release**: v0.7.0
**Status**: Ready to Start

---

## Week 1: Core Commands & Helpers

### Day 1: Setup Project Structure

- [ ] Create `bin/commands/helpers/` directory
- [ ] Add dependencies to `package.json`:
  - [ ] `clipboardy` (clipboard support)
  - [ ] `boxen` (already present - verify)
  - [ ] `inquirer` (already present - verify)
  - [ ] `ora` (already present - verify)
  - [ ] `chalk` (already present - verify)
- [ ] Update TypeScript config for new helpers
- [ ] Create test structure: `test/commands/helpers/`

**Acceptance Criteria**:
- New directory structure exists
- Dependencies installed
- TypeScript compiles without errors

---

### Day 2: Implement Helper Modules

#### `bin/commands/helpers/infer-quilt.ts`

- [ ] Read `quilt3 config`
- [ ] Parse YAML to extract catalog URL
- [ ] Query CloudFormation for matching stack
- [ ] Extract stack outputs (bucket, region, queue ARN)
- [ ] Handle errors gracefully (file not found, no matching stack)
- [ ] Return structured `QuiltConfig` object
- [ ] Add unit tests

#### `bin/commands/helpers/validate-benchling.ts`

- [ ] Implement OAuth token endpoint call
- [ ] Handle HTTP errors (401, 403, 404, 500)
- [ ] Parse token response
- [ ] Return structured `ValidationResult`
- [ ] Add unit tests with mocked fetch

#### `bin/commands/helpers/webhook-test.ts`

- [ ] Query CloudWatch Logs for recent events
- [ ] Parse log messages to extract event details
- [ ] Implement polling with timeout
- [ ] Handle missing log group gracefully
- [ ] Return structured `WebhookTestResult`
- [ ] Add unit tests with mocked CloudWatch client

**Acceptance Criteria**:
- All three helper modules implemented
- Unit tests pass with >90% coverage
- TypeScript types are correct
- Error handling is comprehensive

---

### Day 3: Enhance `init` Command

#### Update `bin/commands/init.ts`

- [ ] Rename from `manifest.ts` (or keep both as aliases)
- [ ] Generate `app-manifest.yaml`
- [ ] Display boxed instructions with chalk + boxen
- [ ] Add `--output <path>` option
- [ ] Add `--open` option to launch browser
- [ ] Copy manifest path to clipboard (optional)
- [ ] Update tests

**Output Example**:
```
✓ Created app-manifest.yaml

┌─────────────────────────────────────────────────┐
│ Next Steps:                                     │
│                                                 │
│ 1. Upload to Benchling                         │
│    https://docs.benchling.com/...              │
│ ...                                             │
└─────────────────────────────────────────────────┘
```

**Acceptance Criteria**:
- Manifest generation works
- Instructions are clear and formatted nicely
- Options work as expected
- Tests pass

---

### Day 4: Enhance `deploy` Command - Interactive Mode

#### Update `bin/commands/deploy.ts`

**Phase 1: Add interactive mode detection**
- [ ] Detect if no args provided → interactive mode
- [ ] Detect `--quilt-stack-arn` + `--benchling-secret` → secrets-only mode
- [ ] Detect `--benchling-secrets` + `--catalog` → legacy mode

**Phase 2: Implement interactive flow**
- [ ] Call `inferQuiltConfig()` helper
- [ ] Display detected config with confirmation prompt
- [ ] Prompt for Benchling credentials (tenant, client ID, secret, app ID)
- [ ] Call `validateBenchlingCredentials()` helper
- [ ] Verify S3 bucket access
- [ ] Create/update AWS secret
- [ ] Show deployment summary
- [ ] Confirm before deploying
- [ ] Deploy stack
- [ ] Display webhook URL
- [ ] Copy to clipboard

**Phase 3: Manual Quilt config fallback**
- [ ] If inference fails, prompt for manual input:
  - Stack ARN or name
  - Region
  - Bucket name
  - Catalog URL

**Acceptance Criteria**:
- Interactive mode works end-to-end
- Secrets-only mode still works (backward compat)
- Legacy mode still works (backward compat)
- Credential validation prevents bad deployments
- Tests cover all three modes

---

### Day 5: Implement `test` Command

#### Create `bin/commands/test.ts`

- [ ] Find deployed stack (by name or ARN)
- [ ] Check ECS service status
- [ ] Check ALB target health
- [ ] Query CloudWatch for recent events
- [ ] Parse and display event summary
- [ ] Add `--wait` mode (polls for new events)
- [ ] Add `--timeout <seconds>` option
- [ ] Add `--tail` mode (follow logs)
- [ ] Display helpful error messages if no events found

**Output Example**:
```
🔍 Checking webhook health...

✓ Stack: benchling-webhook (deployed)
✓ ECS Service: Running (2/2 tasks)
✓ API Gateway: Responding

📊 Recent Activity (last 5 minutes):
  ✓ 3 events received
  ✓ 3 packages processed
```

**Acceptance Criteria**:
- Health checks work
- Event detection works
- Wait mode works with timeout
- Error messages are helpful
- Tests pass

---

## Week 2: Setup Wizard

### Day 1: Implement `setup` Command Structure

#### Create `bin/commands/setup.ts`

**Phase 1: Setup skeleton**
- [ ] Create command handler
- [ ] Add options: `--save`, `--skip-test`, `--no-deploy`
- [ ] Implement welcome screen
- [ ] Implement prerequisites check
- [ ] Create phase header function
- [ ] Create `waitForManualStep()` function

**Phase 2: Implement phase progression**
- [ ] Phase 1: Generate manifest (call `manifestCommand`)
- [ ] Phase 1: Wait for manual upload
- [ ] Phase 2: Infer Quilt config
- [ ] Phase 2: Prompt for credentials
- [ ] Phase 2: Validate credentials
- [ ] Phase 2: Create secret
- [ ] Phase 2: Deploy (conditionally)
- [ ] Phase 3: Wait for webhook URL configuration
- [ ] Phase 4: Test integration (conditionally)
- [ ] Success screen

**Acceptance Criteria**:
- Command structure works
- Phases execute in order
- Manual step pauses work
- Tests cover happy path

---

### Day 2: Implement Manual Step UX

#### Enhance `waitForManualStep()` function

- [ ] Display boxed instructions with warning color
- [ ] Prompt for confirmation (Y/n)
- [ ] Handle "no" response gracefully (save state, exit)
- [ ] Handle "yes" response (continue to next phase)
- [ ] Add variant for "press ENTER" (no confirmation needed)

#### Add state persistence (for resume capability)

- [ ] Create `.benchling-webhook-state.json` file
- [ ] Save completed phases
- [ ] Load state on startup
- [ ] Skip completed phases if resuming
- [ ] Delete state file on success

**Acceptance Criteria**:
- Manual steps are clear
- User can pause/resume setup
- State persistence works
- Tests cover pause/resume

---

### Day 3: Implement Webhook Event Detection

#### Enhance Phase 4 (Testing)

- [ ] Prompt user to create test event
- [ ] Wait for ENTER keypress
- [ ] Call `waitForWebhookEvents()` with 60s timeout
- [ ] Display spinner during wait
- [ ] Display success if event received
- [ ] Display warning if no event (with guidance)
- [ ] Provide link to logs command

**Acceptance Criteria**:
- Event detection works
- Timeout works correctly
- User guidance is helpful
- Tests with mocked CloudWatch

---

### Day 4: Implement `logs` Command

#### Create `bin/commands/logs.ts`

- [ ] Accept options: `--follow`, `--since`, `--filter`
- [ ] Detect region from stack or config
- [ ] Build `aws logs tail` command
- [ ] Execute with `execSync` and inherit stdio
- [ ] Handle errors (log group not found, no credentials)

**Alternative: Use AWS SDK directly**
- [ ] Use CloudWatchLogsClient
- [ ] Implement log streaming
- [ ] Format output nicely
- [ ] Handle pagination

**Acceptance Criteria**:
- Logs stream correctly
- Follow mode works
- Filter works
- Errors are handled

---

### Day 5: Polish UX & Add Config Save

#### Polish all commands

- [ ] Consistent color scheme:
  - Cyan for section headers
  - Green for success
  - Yellow for warnings
  - Red for errors
  - Dim for secondary info
- [ ] Consistent spinner usage
- [ ] Consistent boxed message style
- [ ] Add emojis sparingly (✓, ⚠️, 🚀, 🔍, 📊, 📝, 🎉)

#### Implement `--save` option

- [ ] Save config to `.benchling-webhook.json`
- [ ] Include: secret name, stack ARN, region, webhook URL
- [ ] Add `.benchling-webhook.json` to `.gitignore` template
- [ ] Load saved config in future runs (offer as defaults)

**Acceptance Criteria**:
- All commands look polished
- Save/load config works
- User experience is delightful

---

## Week 3: Testing, Documentation & Release

### Day 1-2: Integration Testing

#### Test full workflows

- [ ] Test `setup` command end-to-end
  - Fresh setup (no existing resources)
  - Resume after pause
  - With real Benchling credentials (test tenant)
  - With real Quilt stack
- [ ] Test `init` + `deploy` + `test` workflow
- [ ] Test secrets-only mode (existing workflow)
- [ ] Test legacy mode (existing workflow)
- [ ] Test error scenarios:
  - Invalid credentials
  - No Quilt config
  - S3 access denied
  - Stack deployment failure
  - Webhook not receiving events

#### Fix bugs

- [ ] Document bugs found
- [ ] Prioritize (blocking vs. nice-to-have)
- [ ] Fix blocking bugs
- [ ] Test fixes

**Acceptance Criteria**:
- All workflows work end-to-end
- No critical bugs
- Error handling is robust

---

### Day 3: Update Documentation

#### Update `README.md`

- [ ] Add "Quick Start" section with three options:
  1. Guided setup (recommended)
  2. Step-by-step
  3. Non-interactive
- [ ] Update "All Commands" section
- [ ] Add examples for each command
- [ ] Add troubleshooting section
- [ ] Add FAQ section

#### Update `CLAUDE.md` (developer guide)

- [ ] Document new helper modules
- [ ] Update daily development workflow
- [ ] Document testing approach for new commands
- [ ] Update command reference

#### Create visual guides

- [ ] Screenshots of Benchling UI steps:
  - Upload manifest
  - Copy App Definition ID
  - Configure webhook URL
  - Install app
- [ ] Optional: Record screencast of `setup` command
- [ ] Add to `docs/` directory

**Acceptance Criteria**:
- Documentation is complete
- Examples work
- Screenshots are clear
- Video is helpful (if created)

---

### Day 4: Beta Testing

#### Prepare beta release

- [ ] Create beta tag: `v0.7.0-beta.1`
- [ ] Publish to npm with `beta` tag
- [ ] Create GitHub pre-release

#### Recruit testers

- [ ] Internal team (2-3 people)
- [ ] Early adopter users (2-3 people)
- [ ] Provide testing checklist

#### Collect feedback

- [ ] Setup time
- [ ] Confusion points
- [ ] Error messages clarity
- [ ] Documentation gaps
- [ ] Feature requests

**Acceptance Criteria**:
- Beta published
- At least 3 testers complete full workflow
- Feedback collected and categorized

---

### Day 5: Release v0.7.0

#### Finalize release

- [ ] Incorporate beta feedback
- [ ] Fix high-priority issues
- [ ] Update `CHANGELOG.md`
- [ ] Update version in `package.json`
- [ ] Create git tag: `v0.7.0`

#### Publish

- [ ] Publish to npm (latest tag)
- [ ] Create GitHub release with notes
- [ ] Update documentation links
- [ ] Announce in discussions/Discord/Slack

#### Monitor

- [ ] Watch npm downloads
- [ ] Monitor GitHub issues
- [ ] Respond to user questions
- [ ] Track success metrics

**Acceptance Criteria**:
- v0.7.0 published successfully
- Documentation updated
- No critical bugs reported in first 24 hours

---

## Post-Release: Metrics Tracking

### Week 4-5: Monitor Success Metrics

Track these metrics:

#### User Experience
- [ ] Setup completion rate (target: >90%)
- [ ] Average time to first webhook event (target: <15 min)
- [ ] Support question volume (target: -70% vs v0.6.x)
- [ ] User satisfaction via GitHub reactions/comments

#### Technical
- [ ] Credential validation success rate
- [ ] Quilt config detection accuracy
- [ ] Webhook health check accuracy
- [ ] Error rate in deployments

#### Adoption
- [ ] % of users using `setup` command
- [ ] % of users using individual commands
- [ ] % still using legacy mode

**Review after 2 weeks**:
- Analyze metrics
- Identify pain points
- Plan v0.7.1 improvements

---

## Backlog / Future Enhancements

### v0.8.0 Ideas

- [ ] `diagnose` command - troubleshoot common issues automatically
- [ ] `uninstall` command - clean removal of all resources
- [ ] `update` command - update existing deployment with new image
- [ ] Configuration profiles (dev, staging, prod)
- [ ] Better CloudWatch Insights queries
- [ ] Webhook event replay for testing
- [ ] Integration with Benchling API to validate app installation
- [ ] Auto-rotation of secrets

### Nice-to-Have Polish

- [ ] Progress bar for long operations
- [ ] Better table formatting for test results
- [ ] Export logs to file
- [ ] Metrics dashboard (web UI)
- [ ] Slack/email notifications for webhook events

---

## Risk Mitigation

### Risks & Mitigation Strategies

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Quilt config inference fails | High | Medium | Provide manual input fallback |
| CloudWatch Logs delay | Medium | High | Set realistic expectations (60s timeout) |
| Clipboard doesn't work | Low | Low | Show URL prominently even if copy fails |
| User skips manual steps | High | Medium | Validate in test command, provide clear errors |
| AWS credentials not configured | High | Low | Check early, provide helpful error message |
| Package size increases significantly | Low | Low | Monitor bundle size, all deps already present |

---

## Success Criteria Summary

**Definition of Done for v0.7.0**:

- [ ] All Week 1-3 tasks completed
- [ ] All acceptance criteria met
- [ ] Integration tests pass
- [ ] Documentation complete
- [ ] Beta testing successful
- [ ] No critical bugs
- [ ] Published to npm as `latest`
- [ ] GitHub release created

**Success Indicators** (measured over 2 weeks post-release):

- Setup completion rate >90%
- Time to first webhook <15 minutes
- Support questions reduced by 70%
- Positive user feedback
- No rollback required

---

## Notes

**Development Tips**:

- Implement helpers first - they're testable in isolation
- Test each command individually before integrating into `setup`
- Use feature flags if needed for gradual rollout
- Keep backward compatibility with v0.6.x workflows
- Write tests as you go - don't leave for the end

**Testing Strategy**:

- Unit tests: Helpers, individual functions
- Integration tests: Full command workflows
- Manual testing: Real Benchling + Quilt setup
- Beta testing: Real users with real data

**Communication**:

- Update team on progress daily
- Demo working features as completed
- Gather feedback early and often
- Be transparent about challenges

---

**Checklist Ready** ✅

Let's build this! 🚀
