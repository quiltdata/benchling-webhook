# Setup Wizard Linear Flow

## Legend

- **[CODE]** = Automatic detection/branching by system
- **[HUMAN]** = User decision required
- **→** = Flow continues
- **✓** = Terminal success state

---

## Flow Start

```
1. Discover Quilt catalog DNS
2. Query Quilt stack (get BenchlingIntegration status)
3. Display context block (stack info, integration status, secrets)

   ↓

4. [CODE] Branch based on discovery:
   - Integration=ENABLED + Secret EXISTS → Flow A
   - Integration=DISABLED → Flow B
   - Integration parameter MISSING → Flow C
   - Standalone stack EXISTS → Flow D
```

---

## Flow A: Integration Already Running

**Context:** Integrated webhook is enabled and has credentials

```
5. [HUMAN] "Update Benchling credentials?" [Y/n]

   ↓ YES                                    ↓ NO

6. Collect credentials                  7. [HUMAN] "Review config without changes?" [Y/n]
   (show current, allow edit)
   ↓                                       ↓ YES          ↓ NO

8. Update secret in AWS                 9. Save config  10. [HUMAN] "Disable integration?" [y/N]
   ✓ Done                                  ✓ Done
                                                           ↓ YES          ↓ NO

                                                       11. Confirm      12. [HUMAN] "Switch to standalone?" [y/N]
                                                           implications
                                                           ↓                ↓ YES          ↓ NO

                                                       13. Update stack 14. Disable +    15. Exit
                                                           (3-5 min)        Deploy new      ✓ Done
                                                           ✓ Done          (8-10 min)
                                                                           ✓ Done
```

**Golden path:** Step 5 YES → Step 6 → Step 8 ✓ (most common)

---

## Flow B: Integration Available But Disabled

**Context:** Quilt supports integration but it's turned off

```
5. [HUMAN] "Enable integrated webhook in Quilt?" [Y/n]

   Context shown:
   - If YES: Updates stack (3-5 min), shared resources
   - If NO: Can deploy standalone instead

   ↓ YES                                    ↓ NO

6. Collect credentials                  7. [HUMAN] "Deploy standalone instead?" [Y/n]
   ↓
                                           ↓ YES          ↓ NO
7. [HUMAN] Confirm enabling
   "Enable integration?" [Y/n]          8. Collect creds 9. Exit
   Shows what will change                   ↓              (user unsure)
   ↓                                                       ✓ Done
                                        9. Deploy stack
8. Update Quilt stack parameter            (5-10 min)
   (3-5 min)                                ✓ Done
   ↓

9. Wait for BenchlingSecret creation
   ↓

10. Populate secret
    ✓ Done
```

**Golden path:** Step 5 YES → Step 6 → Step 7 YES → Steps 8-10 ✓

---

## Flow C: Legacy Stack (No Integration Support)

**Context:** Quilt stack doesn't support integration, must go standalone

```
5. [CODE] Only one option: standalone deployment

6. Show explanation:
   "Your Quilt stack doesn't support integrated webhooks.
    Will deploy as separate infrastructure."

7. [HUMAN] "Deploy standalone webhook?" [Y/n]

   ↓ YES                                    ↓ NO

8. Collect credentials                  9. Exit
   ↓                                       (user not ready)
                                           ✓ Done
9. Deploy stack
   (5-10 min)
   ✓ Done
```

**Golden path:** Step 7 YES → Step 8 → Step 9 ✓

---

## Flow D: Update Existing Standalone

**Context:** Standalone webhook stack already deployed

```
5. [HUMAN] "Update credentials and redeploy?" [Y/n]

   ↓ YES                                    ↓ NO

6. Collect credentials                  7. [HUMAN] "Update secret only (no redeploy)?" [Y/n]
   (show current, allow edit)
   ↓                                       ↓ YES          ↓ NO

8. Deploy stack update                  9. Update       10. [HUMAN] "Review config only?" [Y/n]
   (5-10 min)                              secret
   ✓ Done                                  ✓ Done         ↓ YES          ↓ NO

                                                       11. Save config 12. Exit
                                                           ✓ Done         ✓ Done
```

**Golden path:** Step 5 YES → Step 6 → Step 8 ✓

---

## Decision Summary

| Flow | Human Decisions | Code Decisions | Golden Path Length |
|------|----------------|----------------|-------------------|
| A | 1-4 (avg: 1) | Branch selection | 3 steps |
| B | 2-3 | Branch selection | 5 steps |
| C | 1 | Branch selection, no alternatives | 3 steps |
| D | 1-3 (avg: 1) | Branch selection | 3 steps |

---

## Human Decision Characteristics

### Flow A (Running Integration)
- **Q1:** Update credentials? → **Default: YES** (maintenance)
- **Q2:** Review only? → **Default: YES** (if Q1=NO, passive action)
- **Q3:** Disable? → **Default: NO** (destructive, rare)
- **Q4:** Switch to standalone? → **Default: NO** (architectural change, rare)

### Flow B (Integration Disabled)
- **Q1:** Enable integration? → **Default: YES** (simpler than standalone)
- **Q2:** Confirm enable? → **Default: YES** (after showing changes)
- **Q3:** Deploy standalone instead? → **Default: YES** (if Q1=NO, only alternative)

### Flow C (Legacy)
- **Q1:** Deploy standalone? → **Default: YES** (only option)

### Flow D (Update Standalone)
- **Q1:** Update and redeploy? → **Default: YES** (full update)
- **Q2:** Secret only? → **Default: YES** (if Q1=NO, quick fix)
- **Q3:** Review only? → **Default: YES** (if Q2=NO, passive)

---

## Code Decision Points

All flows start with:

```
[CODE] Step 4: Choose flow based on discovery

  if (integration=ENABLED && secret_exists):
      → Flow A (update running)

  elif (integration=DISABLED):
      → Flow B (enable or standalone)

  elif (integration_parameter_missing):
      → Flow C (legacy, standalone only)

  elif (standalone_stack_exists):
      → Flow D (update standalone)

  elif (first_time):
      → Flow B or C (depends on stack capability)
```

**No user input needed for branching.**

---

## Typical Session Examples

### Example 1: Update existing integration
```
Steps: 1 → 2 → 3 → 4[CODE→A] → 5[HUMAN:YES] → 6 → 8 ✓
Questions: 1
Time: <1 minute
```

### Example 2: First-time setup (modern stack)
```
Steps: 1 → 2 → 3 → 4[CODE→B] → 5[HUMAN:YES] → 6 → 7[HUMAN:YES] → 8 → 9 → 10 ✓
Questions: 2
Time: 3-5 minutes
```

### Example 3: Legacy stack setup
```
Steps: 1 → 2 → 3 → 4[CODE→C] → 5[CODE] → 6 → 7[HUMAN:YES] → 8 → 9 ✓
Questions: 1
Time: 5-10 minutes
```

### Example 4: Disable integration (rare)
```
Steps: 1 → 2 → 3 → 4[CODE→A] → 5[HUMAN:NO] → 7[HUMAN:NO] → 10[HUMAN:YES] → 11 → 13 ✓
Questions: 3
Time: 3-5 minutes
```
