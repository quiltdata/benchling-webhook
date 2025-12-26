# Setup Wizard Unified Flow

## Universal Entry (All Flows)

```
1. [CODE] Discover Quilt catalog DNS
2. [CODE] Query Quilt stack for resources
3. [CODE] Display context:
   - Stack name, region, account
   - Integration status (enabled/disabled/missing)
   - Secret ARN (if exists) + current values
   - Workgroup name (if exists)

4. [CODE] Determine flow based on discovery:
   - Integration=ENABLED + Secret=EXISTS → Continue to Step 5A
   - Integration=DISABLED → Continue to Step 5B
   - Integration=MISSING (legacy) → Continue to Step 5C
   - Standalone=EXISTS → Continue to Step 5D
```

---

## Decision Points (Flow-Specific)

### Step 5A: Integration Running

```
5A. [HUMAN] "Update Benchling credentials?" [Y/n]
    Default: YES

    → YES: Continue to Step 10
    → NO: Continue to Step 6A
```

```
6A. [HUMAN] "Review config without changes?" [Y/n]
    Default: YES

    → YES: Continue to Step 20 (review only)
    → NO: Continue to Step 7A
```

```
7A. [HUMAN] "Disable integration?" [y/N]
    Default: NO

    → YES: Continue to Step 30 (disable)
    → NO: Continue to Step 8A
```

```
8A. [HUMAN] "Switch to standalone?" [y/N]
    Default: NO

    → YES: Continue to Step 40 (switch)
    → NO: Continue to Step 99 (exit)
```

---

### Step 5B: Integration Disabled

```
5B. [HUMAN] "Enable integrated webhook in Quilt?" [Y/n]
    Default: YES

    Shows context:
    - If YES: Updates stack (3-5 min), shared resources
    - If NO: Can deploy standalone instead

    → YES: Continue to Step 10
    → NO: Continue to Step 6B
```

```
6B. [HUMAN] "Deploy standalone instead?" [Y/n]
    Default: YES

    → YES: Continue to Step 10
    → NO: Continue to Step 99 (exit)
```

---

### Step 5C: Legacy Stack

```
5C. [CODE] Show explanation: "Your Quilt stack doesn't support integrated webhooks. Will deploy as standalone infrastructure."

6C. [HUMAN] "Deploy standalone webhook?" [Y/n]
    Default: YES

    → YES: Continue to Step 10
    → NO: Continue to Step 99 (exit)
```

---

### Step 5D: Update Standalone

```
5D. [HUMAN] "Update credentials and redeploy?" [Y/n]
    Default: YES

    → YES: Continue to Step 10
    → NO: Continue to Step 6D
```

```
6D. [HUMAN] "Update secret only (no redeploy)?" [Y/n]
    Default: YES

    → YES: Continue to Step 21 (secret only)
    → NO: Continue to Step 7D
```

```
7D. [HUMAN] "Review config only?" [Y/n]
    Default: YES

    → YES: Continue to Step 20 (review only)
    → NO: Continue to Step 99 (exit)
```

---

## Shared Execution Steps

### Step 10: Collect Credentials (SHARED)

```
10. [HUMAN] Collect Benchling parameters:
    - Tenant (show current if exists, allow edit)
    - Client ID (show masked if exists, allow edit)
    - Client Secret (always prompt, never show)
    - App Definition ID (show current if exists, allow edit)
    - Allow List (show current if exists, allow edit)

    → Continue based on flow:
      - Flow A (update running) → Step 11A
      - Flow B (enable integration) → Step 11B
      - Flow B (deploy standalone) → Step 11C
      - Flow C (legacy standalone) → Step 11C
      - Flow D (update standalone) → Step 11D
```

---

### Step 11A: Update Secret Only

```
11A. [CODE] Update BenchlingSecret in AWS
12A. [CODE] Save local config
     ✓ Done
```

---

### Step 11B: Enable Integration

```
11B. [HUMAN] Confirm enabling:
     "Enable integration?" [Y/n]
     Shows what will change
     Default: YES

     → YES: Continue to Step 12B
     → NO: Continue to Step 99 (exit)

12B. [CODE] Update Quilt stack parameter: BenchlingIntegration=Enabled
13B. [CODE] Poll stack status (show progress, 3-5 min)
14B. [CODE] Wait for BenchlingSecret creation
15B. [CODE] Populate BenchlingSecret with credentials
16B. [CODE] Save local config
     ✓ Done
```

---

### Step 11C: Deploy Standalone

```
11C. [CODE] Deploy BenchlingWebhookStack
12C. [CODE] Poll deployment (show progress, 5-10 min)
     - Creates BenchlingSecret
     - Creates Athena workgroup (webhook-managed)
     - Creates VPC Link, NLB, ECS service
13C. [CODE] Populate BenchlingSecret with credentials
14C. [CODE] Save local config
     ✓ Done
```

---

### Step 11D: Update Standalone Deployment

```
11D. [CODE] Deploy stack update
12D. [CODE] Poll deployment (show progress, 5-10 min)
13D. [CODE] Update BenchlingSecret with new credentials
14D. [CODE] Save local config
     ✓ Done
```

---

### Step 20: Review Only (SHARED)

```
20. [CODE] Save local config (no AWS changes)
    ✓ Done
```

---

### Step 21: Secret Only Update (SHARED)

```
21. [CODE] Update BenchlingSecret in AWS
22. [CODE] Save local config
    ✓ Done
```

---

### Step 30: Disable Integration (SHARED)

```
30. [HUMAN] Confirm disabling:
    "Stop webhook? (can re-enable later)" [y/N]
    Default: NO

    → YES: Continue to Step 31
    → NO: Continue to Step 99 (exit)

31. [CODE] Update Quilt stack parameter: BenchlingIntegration=Disabled
32. [CODE] Poll stack status (show progress, 3-5 min)
33. [CODE] Save local config
    ✓ Done
```

---

### Step 40: Switch to Standalone (SHARED)

```
40. [HUMAN] Confirm switching:
    "Create separate infrastructure? (~8-10 min)" [y/N]
    Shows what will change
    Default: NO

    → YES: Continue to Step 41
    → NO: Continue to Step 99 (exit)

41. [CODE] Update Quilt stack parameter: BenchlingIntegration=Disabled
42. [CODE] Poll stack status (show progress, 3-5 min)
43. [CODE] Deploy BenchlingWebhookStack
44. [CODE] Poll deployment (show progress, 5-10 min)
45. [CODE] Save local config
    ✓ Done
```

---

### Step 99: Exit (SHARED)

```
99. [CODE] Exit without changes
    ✓ Done
```

---

## Flow Summary Table

| From Step | Flow | Next Shared Step | Path |
|-----------|------|------------------|------|
| 5A YES | Update running | 10 → 11A | Credentials → Update secret |
| 5B YES | Enable integration | 10 → 11B | Credentials → Enable + populate |
| 5B NO → 6B YES | Deploy standalone | 10 → 11C | Credentials → Deploy stack |
| 5C YES | Legacy standalone | 10 → 11C | Credentials → Deploy stack |
| 5D YES | Update standalone | 10 → 11D | Credentials → Update stack |
| 5A NO → 6A YES | Review only | 20 | Save config only |
| 5D NO → 6D YES | Secret only | 21 | Update secret only |
| 5A NO → 6A NO → 7A YES | Disable | 30 | Confirm → Disable stack |
| 5A NO → 6A NO → 7A NO → 8A YES | Switch | 40 | Confirm → Disable + Deploy |

---

## Identical Nodes

### Credential Collection (Step 10)
- **Used by:** All flows that need parameters (A, B, C, D)
- **Purpose:** Single place to collect Benchling config

### Review Only (Step 20)
- **Used by:** Flow A (no update), Flow D (no update)
- **Purpose:** Just save local config, no AWS changes

### Secret Only Update (Step 21)
- **Used by:** Flow D (secret update without redeploy)
- **Purpose:** Update secret, skip stack deployment

### Disable Integration (Step 30)
- **Used by:** Flow A (user wants to turn off)
- **Purpose:** Update Quilt stack to disable webhook

### Switch to Standalone (Step 40)
- **Used by:** Flow A (user wants independent deployment)
- **Purpose:** Disable Quilt integration + deploy standalone

### Exit (Step 99)
- **Used by:** All flows when user declines action
- **Purpose:** Graceful exit without changes

---

## Golden Paths (Shortest Routes)

### Update running integration
```
Steps: 1 → 2 → 3 → 4[A] → 5A[YES] → 10 → 11A → 12A ✓
Questions: 1 (Step 5A)
Time: <1 min
```

### Enable integration (first time)
```
Steps: 1 → 2 → 3 → 4[B] → 5B[YES] → 10 → 11B[YES] → 12B → 13B → 14B → 15B → 16B ✓
Questions: 2 (Step 5B, Step 11B)
Time: 3-5 min
```

### Deploy standalone (legacy)
```
Steps: 1 → 2 → 3 → 4[C] → 5C → 6C[YES] → 10 → 11C → 12C → 13C → 14C ✓
Questions: 1 (Step 6C)
Time: 5-10 min
```

### Update standalone deployment
```
Steps: 1 → 2 → 3 → 4[D] → 5D[YES] → 10 → 11D → 12D → 13D → 14D ✓
Questions: 1 (Step 5D)
Time: 5-10 min
```
