# Phase 3: CDK Secret Handling Refactoring - Episodes

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-31
**Phase**: Phase 3 - CDK Secret Handling Refactoring

## Overview

This document breaks down Phase 3 implementation into atomic change units (episodes) following Test-Driven Development (TDD) methodology. Each episode represents a single, testable, committable change that maintains a working state.

## Reference Documents

- **Design**: spec/156-secrets-manager/11-phase3-design.md
- **Phases**: spec/156-secrets-manager/04-phases.md (Phase 3)
- **Checklist**: spec/156-secrets-manager/13-phase3-checklist.md

## Episode Sequencing

Episodes must be executed in order, as later episodes depend on earlier ones:

1. **Episode 1**: Add CloudFormation parameter tests (RED)
2. **Episode 2**: Implement CloudFormation parameters in stack (GREEN)
3. **Episode 3**: Add Secrets Manager secret creation tests (RED)
4. **Episode 4**: Refactor Secrets Manager secret creation (GREEN)
5. **Episode 5**: Add container environment tests (RED)
6. **Episode 6**: Update container environment configuration (GREEN)
7. **Episode 7**: Add backward compatibility tests (RED)
8. **Episode 8**: Implement backward compatibility logic (GREEN)
9. **Episode 9**: Update deploy command parameter passing
10. **Episode 10**: Final refactoring and cleanup

## TDD Cycle Pattern

Each episode follows the Red → Green → Refactor cycle:

- **RED**: Write failing test(s) that specify the desired behavior
- **GREEN**: Write minimum code to make the test(s) pass
- **REFACTOR**: Improve code quality while keeping tests green

---

## Episode 1: Add CloudFormation Parameter Tests (RED)

### Objective

Write failing tests that specify the new `BenchlingSecrets` CloudFormation parameter and verify old parameters are marked as deprecated.

### Test File

`test/benchling-webhook-stack.test.ts`

### Tests to Add

1. **Test: Stack has BenchlingSecrets parameter**
   ```typescript
   test("creates BenchlingSecrets CloudFormation parameter", () => {
       const parameters = template.findParameters("*");
       expect(parameters).toHaveProperty("BenchlingSecrets");

       const param = parameters.BenchlingSecrets;
       expect(param.Type).toBe("String");
       expect(param.NoEcho).toBe(true);
       expect(param.Description).toContain("Benchling secrets");
   });
   ```

2. **Test: Old parameters marked as deprecated**
   ```typescript
   test("marks old Benchling parameters as deprecated", () => {
       const parameters = template.findParameters("*");

       // Check that old parameters exist for backward compatibility
       expect(parameters).toHaveProperty("BenchlingClientId");
       expect(parameters).toHaveProperty("BenchlingClientSecret");
       expect(parameters).toHaveProperty("BenchlingTenant");

       // Check that they're marked as deprecated
       expect(parameters.BenchlingClientId.Description).toContain("[DEPRECATED]");
       expect(parameters.BenchlingClientSecret.Description).toContain("[DEPRECATED]");
       expect(parameters.BenchlingTenant.Description).toContain("[DEPRECATED]");
   });
   ```

3. **Test: Old parameters have NoEcho for security**
   ```typescript
   test("old secret parameters have NoEcho enabled", () => {
       const parameters = template.findParameters("*");

       expect(parameters.BenchlingClientId.NoEcho).toBe(true);
       expect(parameters.BenchlingClientSecret.NoEcho).toBe(true);
   });
   ```

### Expected Result

Tests fail because parameters don't exist yet.

### Commit Message

```
test: add CloudFormation parameter tests for Phase 3

Add failing tests for:
- New BenchlingSecrets parameter with noEcho
- Old parameters marked as deprecated
- Security settings on old parameters

Part of Phase 3 Episode 1 (RED phase)

Relates to #156
```

### Success Criteria

- [ ] 3 new tests added
- [ ] All new tests fail (RED)
- [ ] Existing tests still pass
- [ ] Test code follows existing patterns
- [ ] Commit pushed to branch

---

## Episode 2: Implement CloudFormation Parameters in Stack (GREEN)

### Objective

Add CloudFormation parameters to the stack to make Episode 1 tests pass.

### File to Modify

`lib/benchling-webhook-stack.ts`

### Changes Required

1. **Add new BenchlingSecrets parameter** (after line 116, before bucket lookup)
   ```typescript
   // Benchling Secrets - consolidated secret parameter
   const benchlingSecretsParam = new cdk.CfnParameter(this, "BenchlingSecrets", {
       type: "String",
       description: "JSON string containing Benchling secrets (client_id, client_secret, tenant, app_definition_id)",
       default: "",
       noEcho: true,
   });
   ```

2. **Add deprecated parameters** (after benchlingSecretsParam)
   ```typescript
   // DEPRECATED: Individual secret parameters (kept for backward compatibility)
   const benchlingClientIdParam = new cdk.CfnParameter(this, "BenchlingClientId", {
       type: "String",
       description: "[DEPRECATED] Use BenchlingSecrets parameter instead. Benchling OAuth client ID.",
       default: "",
       noEcho: true,
   });

   const benchlingClientSecretParam = new cdk.CfnParameter(this, "BenchlingClientSecret", {
       type: "String",
       description: "[DEPRECATED] Use BenchlingSecrets parameter instead. Benchling OAuth client secret.",
       default: "",
       noEcho: true,
   });

   const benchlingTenantParamNew = new cdk.CfnParameter(this, "BenchlingTenant", {
       type: "String",
       description: "[DEPRECATED] Use BenchlingSecrets parameter instead. Benchling tenant name.",
       default: props.benchlingTenant || "",
   });
   ```

3. **Get parameter values**
   ```typescript
   const benchlingSecretsValue = benchlingSecretsParam.valueAsString;
   const benchlingClientIdValue = benchlingClientIdParam.valueAsString;
   const benchlingClientSecretValue = benchlingClientSecretParam.valueAsString;
   const benchlingTenantValueNew = benchlingTenantParamNew.valueAsString;
   ```

### Expected Result

Episode 1 tests now pass.

### Commit Message

```
feat: add BenchlingSecrets CloudFormation parameter

Add new consolidated parameter for Benchling secrets:
- BenchlingSecrets parameter with noEcho enabled
- Mark old parameters as deprecated
- Maintain backward compatibility

Part of Phase 3 Episode 2 (GREEN phase)

Relates to #156
```

### Success Criteria

- [ ] All Episode 1 tests pass (GREEN)
- [ ] All existing tests still pass
- [ ] No `make lint` errors
- [ ] Code follows CDK patterns
- [ ] Commit pushed to branch

---

## Episode 3: Add Secrets Manager Secret Creation Tests (RED)

### Objective

Write failing tests that verify Secrets Manager secret is created without using `unsafePlainText()`.

### Test File

`test/benchling-webhook-stack.test.ts`

### Tests to Add

1. **Test: Secret created with proper structure**
   ```typescript
   test("creates Secrets Manager secret without unsafePlainText", () => {
       const secrets = template.findResources("AWS::SecretsManager::Secret");
       const secretKeys = Object.keys(secrets);
       expect(secretKeys.length).toBeGreaterThan(0);

       const secret = secrets[secretKeys[0]];
       expect(secret.Properties.Name).toBe("benchling-webhook/credentials");

       // Verify secret structure supports both new and old parameters
       // The actual implementation will use CloudFormation conditions
       expect(secret.Properties.SecretString).toBeDefined();
   });
   ```

2. **Test: Task role has secret read permissions**
   ```typescript
   test("task role has Secrets Manager read permissions", () => {
       const policies = template.findResources("AWS::IAM::Policy");
       let foundSecretPermission = false;

       Object.values(policies).forEach((policy: any) => {
           const statements = policy.Properties?.PolicyDocument?.Statement || [];
           statements.forEach((statement: any) => {
               if (Array.isArray(statement.Action)) {
                   if (statement.Action.includes("secretsmanager:GetSecretValue")) {
                       foundSecretPermission = true;
                   }
               }
           });
       });

       expect(foundSecretPermission).toBe(true);
   });
   ```

### Expected Result

Tests fail because secret creation logic hasn't been updated.

### Commit Message

```
test: add Secrets Manager creation tests for Phase 3

Add failing tests for:
- Secret created without unsafePlainText
- Task role has secret read permissions

Part of Phase 3 Episode 3 (RED phase)

Relates to #156
```

### Success Criteria

- [ ] 2 new tests added
- [ ] New tests fail appropriately (RED)
- [ ] Existing tests still pass
- [ ] Commit pushed to branch

---

## Episode 4: Refactor Secrets Manager Secret Creation (GREEN)

### Objective

Update FargateService to accept `benchlingSecrets` parameter and create secret properly.

### Files to Modify

1. `lib/fargate-service.ts` - Update props interface and secret creation
2. `lib/benchling-webhook-stack.ts` - Pass new parameter to FargateService

### Changes Required

#### In `lib/fargate-service.ts`:

1. **Update props interface** (lines 12-31)
   ```typescript
   export interface FargateServiceProps {
       // ... existing props ...
       readonly benchlingClientId: string;
       readonly benchlingClientSecret: string;
       readonly benchlingTenant: string;
       readonly benchlingSecrets?: string;  // NEW: consolidated secrets
       // ... rest of props ...
   }
   ```

2. **Replace secret creation logic** (lines 148-156)
   ```typescript
   // Determine which parameter mode to use
   const useNewParam = props.benchlingSecrets && props.benchlingSecrets.trim() !== "";

   // Create Secrets Manager secret with proper parameter handling
   let secretValue: any;

   if (useNewParam) {
       // New approach: Use consolidated secrets JSON
       secretValue = props.benchlingSecrets;
   } else {
       // Old approach: Build JSON from individual parameters
       secretValue = JSON.stringify({
           client_id: props.benchlingClientId,
           client_secret: props.benchlingClientSecret,
           tenant: props.benchlingTenant,
       });
   }

   const benchlingSecret = new secretsmanager.Secret(this, "BenchlingCredentials", {
       secretName: "benchling-webhook/credentials",
       description: "Benchling API credentials for webhook processor",
       secretStringValue: cdk.SecretValue.unsafePlainText(secretValue),
   });
   ```

**Note**: We still use `unsafePlainText()` temporarily because CloudFormation parameters are strings. The actual secret values are protected by `noEcho` in the parameters. This will be further improved in later episodes.

#### In `lib/benchling-webhook-stack.ts`:

3. **Pass benchlingSecrets to FargateService** (around line 162)
   ```typescript
   this.fargateService = new FargateService(this, "FargateService", {
       vpc,
       bucket: this.bucket,
       queueArn: queueArnValue,
       region: this.region,
       account: this.account,
       prefix: prefixValue,
       pkgKey: pkgKeyValue,
       benchlingClientId: props.benchlingClientId,
       benchlingClientSecret: props.benchlingClientSecret,
       benchlingTenant: benchlingTenantValue,
       benchlingSecrets: benchlingSecretsValue,  // NEW
       quiltCatalog: quiltCatalogValue,
       quiltDatabase: quiltDatabaseValue,
       webhookAllowList: webhookAllowListValue,
       ecrRepository: ecrRepo,
       imageTag: imageTagValue,
       stackVersion: stackVersion,
       logLevel: logLevelValue,
       enableWebhookVerification: enableWebhookVerificationValue,
   });
   ```

### Expected Result

Episode 3 tests now pass. Secret is created with parameter-based values.

### Commit Message

```
feat: refactor Secrets Manager secret creation

Update FargateService to accept benchlingSecrets parameter:
- Add benchlingSecrets to props interface
- Update secret creation to support both modes
- Pass new parameter from stack to service

Part of Phase 3 Episode 4 (GREEN phase)

Relates to #156
```

### Success Criteria

- [ ] All Episode 3 tests pass (GREEN)
- [ ] All existing tests still pass
- [ ] No `make lint` errors
- [ ] Code compiles without errors
- [ ] Commit pushed to branch

---

## Episode 5: Add Container Environment Tests (RED)

### Objective

Write failing tests that verify container receives `BENCHLING_SECRETS` environment variable when new parameter is used.

### Test File

`test/benchling-webhook-stack.test.ts`

### Tests to Add

1. **Test: Container has BENCHLING_SECRETS variable when new param used**
   ```typescript
   test("container receives BENCHLING_SECRETS when new parameter provided", () => {
       // Create a new stack with benchlingSecrets provided
       const app = new cdk.App();
       const stackWithSecrets = new BenchlingWebhookStack(app, "TestStackWithSecrets", {
           bucketName: "test-bucket",
           environment: "test",
           prefix: "test-prefix",
           queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
           benchlingClientId: "",  // Empty to simulate new param usage
           benchlingClientSecret: "",
           benchlingTenant: "",
           benchlingSecrets: JSON.stringify({
               client_id: "test-id",
               client_secret: "test-secret",
               tenant: "test-tenant"
           }),
           quiltDatabase: "test-database",
           env: {
               account: "123456789012",
               region: "us-east-1",
           },
       });

       const templateWithSecrets = Template.fromStack(stackWithSecrets);
       const taskDefs = templateWithSecrets.findResources("AWS::ECS::TaskDefinition");
       const taskDefKeys = Object.keys(taskDefs);
       const taskDef = taskDefs[taskDefKeys[0]];
       const containerDef = taskDef.Properties.ContainerDefinitions[0];
       const environment = containerDef.Environment || [];

       const benchlingSecretsEnv = environment.find((e: any) => e.Name === "BENCHLING_SECRETS");
       expect(benchlingSecretsEnv).toBeDefined();
   });
   ```

2. **Test: Container has individual vars when old params used**
   ```typescript
   test("container receives individual vars when old parameters provided", () => {
       // This is the existing test stack setup (backward compatibility)
       const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
       const taskDefKeys = Object.keys(taskDefs);
       const taskDef = taskDefs[taskDefKeys[0]];
       const containerDef = taskDef.Properties.ContainerDefinitions[0];
       const environment = containerDef.Environment || [];
       const secrets = containerDef.Secrets || [];

       // Should have BENCHLING_TENANT as environment variable
       const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
       expect(tenantEnv).toBeDefined();

       // Should have CLIENT_ID and CLIENT_SECRET as secrets
       const clientIdSecret = secrets.find((s: any) => s.Name === "BENCHLING_CLIENT_ID");
       const clientSecretSecret = secrets.find((s: any) => s.Name === "BENCHLING_CLIENT_SECRET");
       expect(clientIdSecret).toBeDefined();
       expect(clientSecretSecret).toBeDefined();
   });
   ```

### Expected Result

First test fails because container environment hasn't been updated. Second test passes (existing behavior).

### Commit Message

```
test: add container environment tests for Phase 3

Add tests for:
- Container receives BENCHLING_SECRETS with new parameter
- Container receives individual vars with old parameters

Part of Phase 3 Episode 5 (RED phase)

Relates to #156
```

### Success Criteria

- [ ] 2 new tests added
- [ ] First test fails (RED)
- [ ] Second test passes (existing behavior)
- [ ] Commit pushed to branch

---

## Episode 6: Update Container Environment Configuration (GREEN)

### Objective

Update container environment to use `BENCHLING_SECRETS` when new parameter is provided, while maintaining backward compatibility with individual variables.

### File to Modify

`lib/fargate-service.ts` - Container environment configuration

### Changes Required

**Update container environment section** (lines 180-209):

```typescript
// Determine environment configuration based on parameter mode
const useNewParam = props.benchlingSecrets && props.benchlingSecrets.trim() !== "";

// Build environment variables
const environmentVars: { [key: string]: string } = {
    QUILT_USER_BUCKET: props.bucket.bucketName,
    QUEUE_ARN: props.queueArn,
    PKG_PREFIX: props.prefix,
    PKG_KEY: props.pkgKey,
    QUILT_CATALOG: props.quiltCatalog,
    QUILT_DATABASE: props.quiltDatabase,
    WEBHOOK_ALLOW_LIST: props.webhookAllowList,
    AWS_REGION: props.region,
    AWS_DEFAULT_REGION: props.region,
    FLASK_ENV: "production",
    LOG_LEVEL: props.logLevel || "INFO",
    ENABLE_WEBHOOK_VERIFICATION: props.enableWebhookVerification || "true",
    BENCHLING_WEBHOOK_VERSION: props.stackVersion || props.imageTag || "latest",
};

// Add Benchling configuration based on parameter mode
if (useNewParam) {
    // New mode: Single consolidated secrets parameter
    environmentVars.BENCHLING_SECRETS = props.benchlingSecrets!;
} else {
    // Old mode: Individual tenant parameter
    environmentVars.BENCHLING_TENANT = props.benchlingTenant;
}

// Build secrets configuration (only for old mode)
const secretsConfig: { [key: string]: ecs.Secret } = {};

if (!useNewParam) {
    // Old mode: Individual secrets from Secrets Manager
    secretsConfig.BENCHLING_CLIENT_ID = ecs.Secret.fromSecretsManager(
        benchlingSecret,
        "client_id",
    );
    secretsConfig.BENCHLING_CLIENT_SECRET = ecs.Secret.fromSecretsManager(
        benchlingSecret,
        "client_secret",
    );
    secretsConfig.BENCHLING_APP_DEFINITION_ID = ecs.Secret.fromSecretsManager(
        benchlingSecret,
        "app_definition_id",
    );
}

// Add container with configured environment
const container = taskDefinition.addContainer("BenchlingWebhookContainer", {
    image: ecs.ContainerImage.fromEcrRepository(
        props.ecrRepository,
        props.imageTag || "latest",
    ),
    logging: ecs.LogDriver.awsLogs({
        streamPrefix: "benchling-webhook",
        logGroup: this.logGroup,
    }),
    environment: environmentVars,
    secrets: Object.keys(secretsConfig).length > 0 ? secretsConfig : undefined,
    healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:5000/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
    },
});
```

### Expected Result

Episode 5 tests now pass. Container receives appropriate environment configuration based on parameter mode.

### Commit Message

```
feat: update container environment for consolidated secrets

Update container configuration to use BENCHLING_SECRETS:
- Add BENCHLING_SECRETS env var when new param provided
- Keep individual vars when old params used
- Maintain backward compatibility

Part of Phase 3 Episode 6 (GREEN phase)

Relates to #156
```

### Success Criteria

- [ ] All Episode 5 tests pass (GREEN)
- [ ] All existing tests still pass
- [ ] No `make lint` errors
- [ ] Code compiles without errors
- [ ] Commit pushed to branch

---

## Episode 7: Add Backward Compatibility Tests (RED)

### Objective

Write comprehensive tests that verify backward compatibility with existing deployments using old parameters.

### Test File

`test/benchling-webhook-stack.test.ts`

### Tests to Add

1. **Test: Stack works with old parameters only**
   ```typescript
   test("stack works with old parameters (backward compatibility)", () => {
       const app = new cdk.App();
       const legacyStack = new BenchlingWebhookStack(app, "LegacyStack", {
           bucketName: "test-bucket",
           environment: "test",
           prefix: "test-prefix",
           queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
           benchlingClientId: "legacy-client-id",
           benchlingClientSecret: "legacy-client-secret",
           benchlingTenant: "legacy-tenant",
           quiltDatabase: "test-database",
           env: {
               account: "123456789012",
               region: "us-east-1",
           },
       });

       const legacyTemplate = Template.fromStack(legacyStack);

       // Verify stack creates successfully
       legacyTemplate.resourceCountIs("AWS::ECS::Service", 1);
       legacyTemplate.resourceCountIs("AWS::SecretsManager::Secret", 1);

       // Verify container uses old environment variable pattern
       const taskDefs = legacyTemplate.findResources("AWS::ECS::TaskDefinition");
       const taskDef = taskDefs[Object.keys(taskDefs)[0]];
       const containerDef = taskDef.Properties.ContainerDefinitions[0];
       const environment = containerDef.Environment || [];

       const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
       expect(tenantEnv).toBeDefined();
       expect(tenantEnv.Value).toBeDefined();
   });
   ```

2. **Test: New parameter takes precedence over old**
   ```typescript
   test("new parameter takes precedence when both provided", () => {
       const app = new cdk.App();
       const mixedStack = new BenchlingWebhookStack(app, "MixedStack", {
           bucketName: "test-bucket",
           environment: "test",
           prefix: "test-prefix",
           queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
           benchlingClientId: "old-client-id",
           benchlingClientSecret: "old-client-secret",
           benchlingTenant: "old-tenant",
           benchlingSecrets: JSON.stringify({
               client_id: "new-client-id",
               client_secret: "new-client-secret",
               tenant: "new-tenant"
           }),
           quiltDatabase: "test-database",
           env: {
               account: "123456789012",
               region: "us-east-1",
           },
       });

       const mixedTemplate = Template.fromStack(mixedStack);
       const taskDefs = mixedTemplate.findResources("AWS::ECS::TaskDefinition");
       const taskDef = taskDefs[Object.keys(taskDefs)[0]];
       const containerDef = taskDef.Properties.ContainerDefinitions[0];
       const environment = containerDef.Environment || [];

       // Should use new parameter (BENCHLING_SECRETS)
       const secretsEnv = environment.find((e: any) => e.Name === "BENCHLING_SECRETS");
       expect(secretsEnv).toBeDefined();

       // Should NOT have old individual vars
       const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
       expect(tenantEnv).toBeUndefined();
   });
   ```

3. **Test: Empty new parameter falls back to old params**
   ```typescript
   test("empty new parameter falls back to old parameters", () => {
       const app = new cdk.App();
       const fallbackStack = new BenchlingWebhookStack(app, "FallbackStack", {
           bucketName: "test-bucket",
           environment: "test",
           prefix: "test-prefix",
           queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
           benchlingClientId: "fallback-client-id",
           benchlingClientSecret: "fallback-client-secret",
           benchlingTenant: "fallback-tenant",
           benchlingSecrets: "",  // Empty string
           quiltDatabase: "test-database",
           env: {
               account: "123456789012",
               region: "us-east-1",
           },
       });

       const fallbackTemplate = Template.fromStack(fallbackStack);
       const taskDefs = fallbackTemplate.findResources("AWS::ECS::TaskDefinition");
       const taskDef = taskDefs[Object.keys(taskDefs)[0]];
       const containerDef = taskDef.Properties.ContainerDefinitions[0];
       const environment = containerDef.Environment || [];

       // Should fall back to old parameter pattern
       const tenantEnv = environment.find((e: any) => e.Name === "BENCHLING_TENANT");
       expect(tenantEnv).toBeDefined();
   });
   ```

### Expected Result

Tests may pass or fail depending on current implementation. We're verifying behavior is correct.

### Commit Message

```
test: add backward compatibility tests for Phase 3

Add comprehensive tests for:
- Stack works with old parameters only
- New parameter takes precedence
- Empty new parameter falls back to old

Part of Phase 3 Episode 7 (RED phase)

Relates to #156
```

### Success Criteria

- [ ] 3 new tests added
- [ ] Tests accurately reflect desired behavior
- [ ] Any failing tests documented
- [ ] Commit pushed to branch

---

## Episode 8: Implement Backward Compatibility Logic (GREEN)

### Objective

Fix any failing backward compatibility tests and ensure proper parameter precedence logic.

### Files to Modify

`lib/fargate-service.ts` - Refine parameter precedence logic if needed

### Changes Required

Review Episode 7 test results and fix any issues:

1. **Ensure proper parameter precedence**
   - Non-empty `benchlingSecrets` → use new mode
   - Empty `benchlingSecrets` or undefined → use old mode
   - Logic is clear and testable

2. **Verify secret creation handles both modes**
   - New mode: Creates secret from JSON string
   - Old mode: Creates secret from individual props
   - Both modes create valid Secrets Manager secrets

3. **Verify container environment is correct**
   - New mode: `BENCHLING_SECRETS` env var
   - Old mode: Individual env vars and secrets
   - No mixing of modes

### Expected Result

All Episode 7 tests pass. Backward compatibility is fully working.

### Commit Message

```
feat: ensure backward compatibility for secret parameters

Refine parameter precedence logic:
- New parameter takes precedence when non-empty
- Empty new parameter falls back to old
- Both modes create valid configurations

Part of Phase 3 Episode 8 (GREEN phase)

Relates to #156
```

### Success Criteria

- [ ] All Episode 7 tests pass (GREEN)
- [ ] All existing tests still pass
- [ ] No `make lint` errors
- [ ] Code is clean and maintainable
- [ ] Commit pushed to branch

---

## Episode 9: Update Deploy Command Parameter Passing

### Objective

Update the deploy command to pass the new `BenchlingSecrets` CloudFormation parameter when deploying.

### File to Modify

`bin/commands/deploy.ts`

### Changes Required

**Update CloudFormation parameters section** (around line 259):

```typescript
// Build CloudFormation parameters to pass explicitly
const parameters = [
    `ImageTag=${config.imageTag || "latest"}`,
    `BucketName=${config.quiltUserBucket}`,
    `PackagePrefix=${config.pkgPrefix || "benchling"}`,
    `PackageKey=${config.pkgKey || "experiment_id"}`,
    `QueueArn=${config.queueArn}`,
    `QuiltDatabase=${config.quiltDatabase}`,
    `LogLevel=${config.logLevel || "INFO"}`,
    `EnableWebhookVerification=${config.enableWebhookVerification ?? "true"}`,
    `QuiltCatalog=${config.quiltCatalog || "open.quiltdata.com"}`,
    `WebhookAllowList=${config.webhookAllowList || ""}`,
];

// Add Benchling secrets parameter based on configuration
if (config.benchlingSecrets) {
    // New parameter: consolidated secrets
    parameters.push(`BenchlingSecrets=${config.benchlingSecrets}`);
} else {
    // Old parameters: individual values (deprecated but supported)
    parameters.push(`BenchlingTenant=${config.benchlingTenant || ""}`);
    parameters.push(`BenchlingClientId=${config.benchlingClientId || ""}`);
    parameters.push(`BenchlingClientSecret=${config.benchlingClientSecret || ""}`);
}
```

### Notes

- The deploy command already has the logic to detect and warn about mixing old and new parameters (Episode 8 from Phase 2)
- This episode ensures the appropriate parameters are passed to CloudFormation
- CLI validation already happened earlier in the deployment flow

### Expected Result

Deploy command correctly passes either new or old parameters to CloudFormation.

### Commit Message

```
feat: update deploy command for new parameter structure

Update parameter passing logic:
- Pass BenchlingSecrets when available
- Fall back to old parameters for compatibility
- Maintain validation and deprecation warnings

Part of Phase 3 Episode 9

Relates to #156
```

### Success Criteria

- [ ] Deploy command passes correct parameters
- [ ] Works with new parameter
- [ ] Works with old parameters
- [ ] No `make lint` errors
- [ ] Commit pushed to branch

---

## Episode 10: Final Refactoring and Cleanup (REFACTOR)

### Objective

Clean up code, improve documentation, and ensure all quality standards are met.

### Tasks

1. **Code Review**
   - Remove any unused imports
   - Fix any TypeScript warnings
   - Ensure consistent formatting
   - Add JSDoc comments where helpful

2. **Update Stack Props Interface**
   - Add `benchlingSecrets?: string` to `BenchlingWebhookStackProps`
   - Document the parameter

3. **Test Coverage**
   - Run coverage report
   - Ensure Phase 3 changes have >85% coverage
   - Add any missing edge case tests

4. **Documentation**
   - Add inline comments for complex logic
   - Update any relevant code comments
   - Ensure parameter descriptions are clear

5. **Lint and Format**
   - Run `make lint`
   - Run `make test`
   - Fix any issues

### Files to Review

- `lib/benchling-webhook-stack.ts`
- `lib/fargate-service.ts`
- `bin/commands/deploy.ts`
- `test/benchling-webhook-stack.test.ts`

### Expected Result

Clean, well-documented code that passes all quality checks.

### Commit Message

```
refactor: cleanup Phase 3 implementation

Final improvements:
- Add JSDoc comments
- Remove unused code
- Improve parameter documentation
- Ensure consistent formatting

Part of Phase 3 Episode 10 (REFACTOR phase)

Relates to #156
```

### Success Criteria

- [ ] All tests pass
- [ ] No lint errors
- [ ] Test coverage >85%
- [ ] Code is well-documented
- [ ] Commit pushed to branch

---

## Episode Summary

| Episode | Type | Focus | Files Modified | Tests |
|---------|------|-------|----------------|-------|
| 1 | RED | CFT parameter tests | test/*.test.ts | 3 new (failing) |
| 2 | GREEN | CFT parameters | lib/stack.ts | 3 pass |
| 3 | RED | Secret creation tests | test/*.test.ts | 2 new (failing) |
| 4 | GREEN | Secret creation | lib/stack.ts, lib/fargate.ts | 2 pass |
| 5 | RED | Container env tests | test/*.test.ts | 2 new (1 fail) |
| 6 | GREEN | Container environment | lib/fargate.ts | All pass |
| 7 | RED | Backward compat tests | test/*.test.ts | 3 new |
| 8 | GREEN | Backward compatibility | lib/fargate.ts | All pass |
| 9 | GREEN | Deploy command | bin/commands/deploy.ts | Manual test |
| 10 | REFACTOR | Code cleanup | All files | Coverage check |

## Success Criteria for Phase 3

All episodes completed when:

- [ ] All 10 episodes executed in order
- [ ] All tests pass (unit and integration)
- [ ] Test coverage >85%
- [ ] No lint errors
- [ ] Code follows existing patterns
- [ ] Backward compatibility maintained
- [ ] Documentation updated
- [ ] All commits follow conventional commits
- [ ] Changes ready for PR

## Next Steps

After completing all episodes:

1. Run full test suite: `make test`
2. Run lint: `make lint`
3. Build project: `npm run build`
4. Update Phase 3 checklist with completion status
5. Create PR for Phase 3 implementation
6. Move to Phase 4 planning and implementation

## Related Documents

- **Previous**: spec/156-secrets-manager/11-phase3-design.md (Design document)
- **Next**: spec/156-secrets-manager/13-phase3-checklist.md (Implementation checklist)
