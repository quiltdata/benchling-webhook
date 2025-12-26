# Setup Wizard Decision Tree

## Design Principles

1. **Context before questions** - Always show what we detected before asking
2. **Yes/no with clear defaults** - No multi-choice menus, just binary decisions
3. **Understand motivation** - Each question maps to a real user need
4. **Avoid wasted work** - Don't collect parameters until we know the path

---

## Universal Entry Point

```
[START: benchling-webhook setup]
    ↓
[Phase 1: Discover Quilt catalog DNS]
    ↓
[Phase 2: Query Quilt stack for configuration]
    ↓
[Display Context Block] ← ALWAYS SHOW THIS FIRST
```

---

## Context Display Logic

**Always show before any questions:**

```
✓ Quilt Stack: {stackName}
  Region: {region}
  Account: {account}

Integration Status: {enabled|disabled|not-available}
{if secret exists}
  Secret: {arn}
  Current Tenant: {tenant}
  Current Client ID: {masked}
{endif}

{if workgroup exists}
  Athena Workgroup: {workgroupName}
{endif}
```

**Then branch based on discovery:**

---

## Branch A: Integration ENABLED + Secret EXISTS

### Motivation: User wants to update existing integrated webhook

```
Context Display:
  ✓ Integrated webhook is RUNNING
  → Currently receiving events in Quilt stack
  → Using shared BenchlingSecret

Question 1: "Update Benchling credentials?"
  [Y/n] Default: Yes

  ↓ YES                                    ↓ NO
  Collect credentials                       Question 2
  (show current, allow edit)                    ↓
  ↓                                        "Review config without changes?"
  Update secret in AWS                       [Y/n] Default: Yes
  Save local config                              ↓
  ✓ Done                                    ↓ YES          ↓ NO
                                           Save locally    Question 3
                                           ✓ Done               ↓
                                                           "Disable integration?"
                                                             [y/N] Default: No
                                                                ↓
                                                           ↓ YES          ↓ NO
                                                           Confirm:       Question 4
                                                           "Stop webhook?"     ↓
                                                           [y/N]          "Switch to standalone?"
                                                              ↓            [y/N] Default: No
                                                           Update stack        ↓
                                                           parameter      ↓ YES          ↓ NO
                                                           (3-5 min)      Confirm:       Exit
                                                           ✓ Done         "Create separate?"
                                                                         [y/N]
                                                                            ↓
                                                                         Disable integration
                                                                         Deploy standalone
                                                                         (8-10 min)
                                                                         ✓ Done
```

**Key insight:** Most users want to update credentials (Question 1 = Yes). All other options are escape hatches for edge cases.

---

## Branch B: Integration EXISTS but DISABLED

### Motivation: User needs to decide between enabling integration vs standalone

```
Context Display:
  ⚠ Integrated webhook is DISABLED
  → Your Quilt stack supports integration but it's off
  → Can enable it or deploy separately

Question 1: "Enable integrated webhook in Quilt stack?"
  [Y/n] Default: Yes

  Context for decision:
    If YES: Updates Quilt stack (3-5 min), uses shared resources
    If NO: Deploys separate infrastructure (5-10 min), independent

  ↓ YES                                    ↓ NO
  Collect credentials                      Question 2
  ↓                                            ↓
  Confirm:                                "Deploy standalone instead?"
  "Enable integration?"                     [Y/n] Default: Yes
  Shows what will change                        ↓
  [Y/n] Default: Yes                       ↓ YES          ↓ NO
     ↓                                     Collect creds   Exit
  Update Quilt stack parameter             ↓              (user unsure)
  (3-5 min, show progress)                Deploy stack
  ↓                                       (5-10 min)
  Wait for BenchlingSecret creation       ✓ Done
  ↓
  Populate secret
  ✓ Done
```

**Key insight:** Default to enabling integration (simpler, uses Quilt's resources). Standalone is the escape hatch.

---

## Branch C: Integration NOT AVAILABLE (Legacy)

### Motivation: User has no choice, must deploy standalone

```
Context Display:
  ✓ Legacy Quilt stack detected
  → Your Quilt stack doesn't support integrated webhooks
  → Will deploy as separate infrastructure

Question 1: "Deploy standalone webhook?"
  [Y/n] Default: Yes

  Context:
    Creates: BenchlingWebhookStack with dedicated resources
    Includes: Athena workgroup (stack-managed)
    Time: ~5-10 minutes

  ↓ YES                                    ↓ NO
  Collect credentials                      Exit
  ↓                                       (user not ready)
  Deploy stack
  (5-10 min, show progress)
  ✓ Done
```

**Key insight:** Only one question because there's only one viable path. The "No" is just "not now."

---

## Branch D: Existing STANDALONE Deployment

### Motivation: User wants to update existing standalone deployment

```
Context Display:
  ✓ Standalone webhook deployment found
  → Stack: {stackName}
  → Status: {status}
  → Deployed: {date}

Question 1: "Update credentials and redeploy?"
  [Y/n] Default: Yes

  ↓ YES                                    ↓ NO
  Collect credentials                      Question 2
  (show current, allow edit)                   ↓
  ↓                                       "Update secret only (no redeploy)?"
  Deploy stack update                      [Y/n] Default: Yes
  (5-10 min, show progress)                    ↓
  ✓ Done                                  ↓ YES          ↓ NO
                                         Update secret   Question 3
                                         ✓ Done              ↓
                                                        "Review config only?"
                                                         [Y/n] Default: Yes
                                                             ↓
                                                        ↓ YES          ↓ NO
                                                        Save locally   Exit
                                                        ✓ Done
```

**Key insight:** Most updates need redeployment. Secret-only update is for quick fixes. Review-only is rare.

---

## Branch E: NO Profile (First Time)

### Motivation: User is setting up for the first time

```
Context Display:
  ✓ Quilt Stack: {stackName}
  ⚠ No existing configuration found

  This appears to be your first time setting up the webhook.

→ Proceed to Branch A/B/C based on integration status
  (Same questions, but all fields are new entry)
```

**Key insight:** First-time setup follows same decision tree, just with empty starting values.

---

## Special: Branch F - Integration ENABLED but Secret MISSING

### Motivation: Quilt stack was updated but secret wasn't created (edge case)

```
Context Display:
  ⚠ Integration is enabled but BenchlingSecret is missing
  → This may indicate a stack update is still in progress
  → Or the secret creation failed

Question 1: "Wait for secret to be created?"
  [Y/n] Default: Yes

  ↓ YES                                    ↓ NO
  Poll for secret existence               Question 2
  (30 sec timeout)                             ↓
  ↓                                       "Create secret manually?"
  ↓ FOUND       ↓ TIMEOUT                  [y/N] Default: No
  Proceed to    Show error                     ↓
  populate      "Stack may need manual      ↓ YES          ↓ NO
  secret        investigation"             Create secret   Exit
                Suggest: check console      Populate it    (needs admin)
                Exit                        ✓ Done
```

**Key insight:** This is an error state. Default to waiting (stack might still be updating).

---

## Question Flow Analysis

### Path Depth by Branch

| Branch | Scenario | Questions to Success | Default Path |
|--------|----------|---------------------|--------------|
| A | Integrated running | 1 | Yes → Done |
| B | Integration disabled | 2 | Yes → Yes → Done |
| C | Legacy stack | 1 | Yes → Done |
| D | Standalone exists | 1 | Yes → Done |
| E | First time | Same as A/B/C | Depends on stack |
| F | Secret missing (edge) | 2 | Yes → Yes → Done |

**Maximum depth:** 4 questions (Branch A, all "No" escape hatches)

**Typical depth:** 1-2 questions

---

## Context-Aware Defaults

### Rule 1: Default to simplest path
- **Branch A:** Update credentials (not disable/switch)
- **Branch B:** Enable integration (not standalone)
- **Branch C:** Deploy (not exit)
- **Branch D:** Update and redeploy (not partial update)

### Rule 2: Destructive actions default to No
- "Disable integration?" → [y/N]
- "Switch to standalone?" → [y/N]

### Rule 3: Confirmations default to Yes
- "Enable integration?" → [Y/n] (after showing context)
- "Deploy standalone?" → [Y/n] (when no other option)

---

## Credential Collection Strategy

**Don't collect until path is confirmed:**

```
❌ BAD FLOW:
  Collect all credentials
  Ask: "What do you want to do?"
  (User picks "review only" - wasted effort)

✅ GOOD FLOW:
  Ask: "Update credentials?"
  If YES:
    Then collect credentials
  If NO:
    Ask: "Review only?"
    (No credential collection needed)
```

**Progressive disclosure:**
- Ask about action first
- Collect parameters only when needed
- Show current values during collection
- Allow "keep current" for each field

---

## --yes Flag Behavior

**Auto-accepts defaults, still requires:**

| Branch | Auto-Accepted | Still Prompts For |
|--------|---------------|-------------------|
| A | Q1: Yes (update creds) | Credentials if not in CLI args |
| B | Q1: Yes (enable integration) | Credentials, final confirmation |
| C | Q1: Yes (deploy) | Credentials |
| D | Q1: Yes (update & redeploy) | Credentials if not in CLI args |
| F | Q1: Yes (wait for secret) | Nothing |

**Safety overrides (always prompt):**
- Disabling integration (destructive)
- Switching modes (architectural change)
- Creating secrets manually (edge case)

---

## Error States and Validation

**Validate early, fail fast:**

```
After context display, before questions:
  ✓ Check AWS credentials
  ✓ Check IAM permissions
  ✓ Verify stack is not in UPDATE_IN_PROGRESS

  If any fail:
    Show clear error message
    Suggest remediation
    Exit (don't ask meaningless questions)
```

**During execution:**
```
Show progress for long operations:
  [████████████████        ] Updating stack... (2m 15s)

If operation fails:
  Show error
  Show last successful state
  Suggest rollback if needed
  Exit gracefully
```

---

## Success Criteria

### Cognitive Load
- ✅ Maximum 2 questions for typical flows
- ✅ Every question has clear yes/no answer
- ✅ Defaults handle 90% of use cases (just hit enter)
- ✅ Context explains the "why" before asking "what"

### Avoid Wasted Work
- ✅ Don't collect credentials before knowing the path
- ✅ Don't ask questions if there's only one valid answer
- ✅ Don't prompt for confirmation on non-destructive defaults

### User Motivation Mapping
- ✅ "Update creds" → Quick maintenance (Branch A, Q1)
- ✅ "Enable integration" → First setup on new stack (Branch B, Q1)
- ✅ "Deploy standalone" → Legacy stack or preference (Branch C, Q1)
- ✅ "Update deployment" → Maintenance on existing (Branch D, Q1)
- ✅ "Disable/switch" → Architecture change (Branch A, Q3-4)

### Clear Defaults
- ✅ Affirmative defaults for forward progress
- ✅ Negative defaults for destructive actions
- ✅ Escape hatches available but not prominent
