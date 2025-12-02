# Webhook AllowList Configuration Loss Investigation

**Date:** 2025-12-02
**Status:** Investigation
**Issue:** `webhookAllowList` from profile config is not being applied during deployment

## Problem Statement

The user runs `npm run setup -- --profile dev --yes` which shows:

```
Optional Configuration:
  Webhook Allow List: 59.0.1.1 (from existing config)
```

However, during deployment (`npm run setup -- deploy --profile dev`), we see:

```
Deployment Plan:
  Security Settings:
    Webhook Verification:    ENABLED
    IP Filtering:            ENABLED (Resource Policy)
                                     Allowed IPs: 59.0.1.1
```

But then during actual CDK deployment:

```
Resource Policy IP filtering: DISABLED (no webhookAllowList configured)
```

**The configuration is being lost somewhere between deployment plan display and CDK synthesis.**

## Investigation Steps

### Step 1: Trace Configuration Flow

1. **Profile Config Storage** (`~/.config/benchling-webhook/dev/config.json`)
   - ✓ Stores `security.webhookAllowList: "59.0.1.1"`

2. **CLI Command** (`bin/cli.ts`)
   - Entry point for `npm run setup -- deploy --profile dev`
   - Reads profile configuration
   - Passes to deployment command

3. **Deploy Command** (`bin/commands/deploy.ts`)
   - Loads profile config via `XDGConfig.readProfile(profile)`
   - Displays deployment plan showing correct IP
   - Calls CDK deployment

4. **CDK App** (`bin/benchling-webhook.ts`)
   - Receives environment variables
   - Instantiates stack

5. **CDK Stack** (`lib/benchling-webhook-stack.ts`)
   - Creates REST API Gateway
   - Should apply Resource Policy with IP filtering

### Step 2: Configuration Passing Mechanism

Need to identify how `webhookAllowList` flows from:
- Profile config → Deploy command → CDK process → Stack construct

Likely suspects:
1. Environment variables not being set
2. CDK context not being passed
3. Stack constructor not receiving parameter
4. Resource policy logic checking wrong variable

### Step 3: Key Files to Examine

1. `bin/commands/deploy.ts` - How does it pass config to CDK?
2. `bin/benchling-webhook.ts` - How does it receive config?
3. `lib/benchling-webhook-stack.ts` - How does it consume webhookAllowList?
4. `lib/rest-api-gateway.ts` - Where is resource policy created?

## Hypothesis

Based on the error pattern, likely causes:

### Hypothesis 1: Environment Variable Not Set
Deploy command may display the value but not pass it to CDK as environment variable.

### Hypothesis 2: CDK Context vs Environment Variables
CDK may be using context values instead of environment variables, and context isn't being populated.

### Hypothesis 3: Property Name Mismatch
The profile uses `security.webhookAllowList` but CDK expects different property name.

### Hypothesis 4: Empty String vs Undefined
The value might be converted to empty string somewhere, and logic checks for undefined/null.

## Required Investigation

1. **Trace Environment Variables**
   - What env vars does `deploy.ts` set before spawning CDK?
   - What env vars does `bin/benchling-webhook.ts` read?

2. **Trace Stack Instantiation**
   - What parameters are passed to `BenchlingWebhookStack` constructor?
   - How does stack access `webhookAllowList`?

3. **Trace Resource Policy Creation**
   - Where in `rest-api-gateway.ts` is allowlist used?
   - What variable name does it check?

## Expected Fix

Once we identify where the configuration is lost, we need to:

1. Ensure `deploy.ts` passes `webhookAllowList` to CDK process
2. Ensure CDK app receives and forwards the value
3. Ensure stack constructor receives the value
4. Ensure resource policy logic uses the correct variable

## Next Steps

1. Read `bin/commands/deploy.ts` to see how config is passed to CDK
2. Read `bin/benchling-webhook.ts` to see how CDK app receives config
3. Read `lib/benchling-webhook-stack.ts` to see stack constructor parameters
4. Read `lib/rest-api-gateway.ts` to see resource policy logic
5. Create comprehensive trace of data flow
6. Identify exact point where configuration is lost
7. Implement fix
8. Add test to prevent regression
