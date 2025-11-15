# Fix Setup Flow Specification

## Problem Summary

The setup wizard asks the wrong questions at the wrong time.
This creates a confusing user experience and complicates the logic.
Worse, it does NOT actually use the new secret for integrated deployments.

## Required Flow

### 1. Catalog Discovery

- Check quilt3 config for catalog DNS
- **ASK**: "Is `<catalog-dns>` correct? (y/n)"
- If no: prompt for catalog DNS name

### 2. Stack Query

- Find the CloudFormation stack for that catalog
- Query stack outputs/parameters for ALL available values:
  - Stack ARN
  - Athena Database
  - SQS Queue URL
  - BenchlingSecret ARN (if exists)
  - Region
  - Account ID
  - Any other queryable parameters

### 3. Collect ALL Parameters

**Before making any decisions, collect/verify everything:**

#### Stack Parameters

From above

#### Benchling Configuration

- Tenant
- App Definition ID
- OAuth Client ID
- OAuth Client Secret
- Test Entry ID (optional)

#### Package Configuration

- S3 Bucket
- S3 Prefix
- Metadata Key

#### Deployment Configuration

- Confirm/override region (from stack query)
- Confirm/override account ID (from stack query)
- Log level
- IP allowlist

#### Validation

- Validate all parameters (Benchling API, S3 access, etc.)

### 4. BenchlingSecret Decision (AFTER collection)

**Now that we have all parameters:**

**If BenchlingSecret exists in stack:**

- **ASK**: "Quilt stack has a BenchlingSecret. Use to configure that stack? (y/n)"

- **If YES (integrated mode):**
  - **UPDATE** _that_ BenchlingSecret ARN with collected credentials
  - Save config with `integratedStack: true`

- **EXIT** - no deployment needed, no separate secret creation

**If NO (standalone mode):**

If no BenchlingSecret, or the user says no:

- Create/update dedicated secret: `quiltdata/benchling-webhook/<profile>/<tenant>`
- Save config with `integratedStack: false`
- **ASK**: "Deploy to AWS now? (y/n)"
- If yes: deploy standalone stack

## Key Principles

### Do

1. Collect ALL parameters upfront
2. Validate everything before making decisions
3. Ask simple yes/no questions
4. Exit cleanly after integrated secret update
5. Query stack for as many parameters as possible

### Don't

1. Query stack BEFORE verifying catalog name
1. Check quilt3.config if the profile already has a different DNS name
1. Continue if the user does NOT have an application ID (shift to manifest flow)
1. Ask about deployment mode before collecting parameters
1. Create standalone secrets in integrated mode
1. Prompt for deployment in integrated mode
1. Ask for parameters that can be queried from the stack
1. Show complex menus for binary choices - use simple y/n prompts (i.e., except for log-level)

## Expected Outcomes

### Integrated Stack Mode (BenchlingSecret exists, user says yes)

1. Find catalog ✓
2. Query stack for parameters ✓
3. Collect ALL Benchling/package/deployment parameters ✓
4. Validate everything ✓
5. Ask: "Use existing BenchlingSecret?" → Yes
6. Update BenchlingSecret with collected values ✓
7. Save config (integratedStack: true) ✓
8. **Exit** - Done! ✓

### Standalone Mode (BenchlingSecret=no or doesn't exist)

1. Find catalog ✓
2. Query stack for parameters ✓
3. Collect ALL Benchling/package/deployment parameters ✓
4. Validate everything ✓
5. Ask: "Use existing BenchlingSecret?" → No (or doesn't exist)
6. Create/update dedicated secret ✓
7. Save config (integratedStack: false) ✓
8. Ask: "Deploy to AWS now?" ✓
9. Deploy if yes ✓

## Files to Modify

- [bin/commands/setup-wizard.ts](../bin/commands/setup-wizard.ts) - Main setup flow logic
- Any utility functions that handle the deployment decision flow

## Success Criteria

1. User enters all parameters once, upfront
2. Validation happens before any deployment decisions
3. Integrated mode exits cleanly without creating extra secrets
4. Standalone mode deploys only when explicitly confirmed
5. No confusing menus - only simple y/n questions at decision points
