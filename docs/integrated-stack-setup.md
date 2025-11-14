# Integrated Stack Setup Flow

## Overview

When a Quilt stack already has a `BenchlingSecret` configured, the setup wizard automatically detects it and offers to use it instead of creating a new standalone webhook deployment. This is called "integrated mode."

## Detection

During setup, the system:

1. **Queries CloudFormation**: Checks the Quilt stack outputs for `BenchlingSecretArn` or `BenchlingSecret`
   - Location: `bin/commands/infer-quilt-config.ts` (lines 154-157)

2. **Passes to Wizard**: The detected secret ARN is passed through to the setup wizard
   - Location: `bin/commands/setup-wizard.ts` (lines 844, 869-875)

3. **Prompts User**: Asks whether to use the detected secret or create a new one
   - Location: `bin/commands/setup-wizard.ts` (lines 482-505)

## User Flow

### Step 1: Quilt Configuration Inference

```
Step 1: Inferring Quilt configuration from AWS...
✓ Found BenchlingSecret from Quilt stack: arn:aws:secretsmanager:...
```

### Step 2: Benchling Configuration

```
Step 2: Benchling Configuration

✓ Found BenchlingSecret in Quilt stack: arn:aws:secretsmanager:...
This Quilt stack already has Benchling webhook integration configured.
You can either use the integrated stack or deploy a separate standalone webhook.

? How do you want to deploy the Benchling webhook?
  ❯ Use integrated stack (update existing secret, no separate deployment needed)
    Deploy standalone webhook (create new secret and deploy separate stack)
```

**If user selects "Use integrated stack":**
```
✓ Using integrated stack mode
  - Will update BenchlingSecret in the Quilt stack
  - No separate webhook deployment needed
  - Quilt stack will handle webhook events
```
- The setup will UPDATE the existing secret with new credentials
- The profile config will store the secretArn
- NO standalone webhook stack is needed
- The deployment mode is tracked as "integrated" in metadata

**If user selects "Deploy standalone webhook":**
```
✓ Using standalone webhook mode
  - Will create a new BenchlingSecret
  - Will deploy a separate BenchlingWebhookStack
  - Standalone stack will handle webhook events
```
- A new secret will be created with the standard naming convention
- A standalone webhook stack can be deployed
- The deployment mode is tracked as "standalone" in metadata

## Secret Update Logic

When using an existing secret from the Quilt stack:

1. **Automatic Update**: The `sync-secrets.ts` automatically updates the existing secret (lines 399-408)
   ```typescript
   if (useExistingSecret) {
       // When using existing secret from Quilt stack, always update it (force is implied)
       console.log(`Updating BenchlingSecret from Quilt stack: ${secretName}...`);
       secretArn = await updateSecret(client, {
           name: secretName,
           value: secretValue,
           description: `Benchling Webhook configuration for ${config.benchling.tenant} (profile: ${profile})`,
       });
       action = "updated";
       console.log(`✓ BenchlingSecret updated: ${secretArn}`);
   }
   ```

2. **No Force Flag Needed**: The update is automatic when `useExistingSecret` is true
   - The secret already exists in the Quilt stack
   - We have permission to update it
   - Force is implied for integrated mode

3. **Validation**: If the secret ARN is found in CloudFormation outputs but doesn't exist in Secrets Manager, an error is thrown (lines 429-435)

## Next Steps After Setup

After completing setup, the next steps depend on the deployment mode chosen:

### For Integrated Stack Mode:
```
╔═══════════════════════════════════════════════════════════╗
║   Setup Complete!                                         ║
╚═══════════════════════════════════════════════════════════╝

Using Integrated Stack Mode
────────────────────────────────────────────────────────────────────────────────
✓ BenchlingSecret updated in Quilt stack
✓ No separate webhook deployment needed
✓ Quilt stack will handle webhook events

Next steps:
  1. Configure webhook URL in Benchling app settings
     (Get the webhook URL from your Quilt stack outputs)
  2. Test the webhook integration
  3. Monitor logs: npx ts-node scripts/check-logs.ts --profile [profile]
```

### For Standalone Stack Mode:
```
╔═══════════════════════════════════════════════════════════╗
║   Setup Complete!                                         ║
╚═══════════════════════════════════════════════════════════╝

Next steps:
  1. Deploy to AWS: npm run deploy
  2. Test integration: npm run test
  3. Check configuration: npm run setup:health
```

## Configuration Storage

The profile configuration stores the secret ARN and deployment mode:

### Integrated Stack Mode:
```json
{
  "benchling": {
    "tenant": "your-tenant",
    "clientId": "your-client-id",
    "clientSecret": "hidden",
    "appDefinitionId": "appdef_...",
    "secretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:BenchlingSecret-xxxxx"
  },
  "_metadata": {
    "version": "0.7.0",
    "createdAt": "2025-11-14T...",
    "updatedAt": "2025-11-14T...",
    "source": "wizard",
    "deploymentMode": "integrated"
  }
}
```

### Standalone Stack Mode:
```json
{
  "benchling": {
    "tenant": "your-tenant",
    "clientId": "your-client-id",
    "clientSecret": "hidden",
    "appDefinitionId": "appdef_..."
    // Note: NO secretArn field - will be created during deployment
  },
  "_metadata": {
    "version": "0.7.0",
    "createdAt": "2025-11-14T...",
    "updatedAt": "2025-11-14T...",
    "source": "wizard",
    "deploymentMode": "standalone"
  }
}
```

## Key Files

- **Detection**: `bin/commands/infer-quilt-config.ts`
  - Queries CloudFormation for BenchlingSecret output
  - Returns `benchlingSecretArn` in InferenceResult

- **User Prompt**: `bin/commands/setup-wizard.ts`
  - Lines 482-514: Prompts user to choose integrated vs standalone
  - Lines 626-645: Stores ARN and deployment mode metadata

- **Secret Update**: `bin/commands/sync-secrets.ts`
  - Lines 358-372: Detects if using existing secret
  - Lines 399-408: Updates existing secret without --force flag

## Implementation Notes

1. **Cherry-picked from deploy-077**: This feature was originally developed in the `deploy-077` branch and cherry-picked into `194-rework-dockerfile`

2. **Commits**:
   - `2b7c9ea`: feat: add catalog verification and BenchlingSecret reuse
   - `19fa103`: fix: improve setup wizard UX for catalog selection and secret reuse

3. **Testing**: The integrated flow should be tested with a Quilt stack that has a BenchlingSecret output

## Deployment Distinction

### Integrated Stack
- Quilt stack has BenchlingSecret output
- Setup wizard detects it and offers to use it
- User chooses to use the stack secret
- **No separate webhook deployment needed**
- Secret is updated with new credentials
- Quilt stack's webhook handler will use the updated secret

### Standalone Stack
- No BenchlingSecret detected, OR user chooses to create new secret
- Setup wizard creates a new secret
- User must deploy a standalone BenchlingWebhookStack
- Standalone stack references the new secret
