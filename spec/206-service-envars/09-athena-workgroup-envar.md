# Specification: BENCHLING_ATHENA_WORKGROUP Environment Variable

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-16

**Status**: READY FOR IMPLEMENTATION

**Last Updated**: 2025-11-16 - Verified that `TabulatorOpenQueryWorkGroup` is available as a Quilt stack output

## Overview

Add support for configuring a custom Athena workgroup via the `BENCHLING_ATHENA_WORKGROUP` environment variable. This allows deployments to use dedicated workgroups for better cost tracking, query management, and isolation.

**Note**: The Athena workgroup **IS available as a Quilt stack output** (`TabulatorOpenQueryWorkGroup`) and should be resolved at deployment time from the CloudFormation stack, similar to `PackagerQueueUrl` and `UserAthenaDatabaseName`. This follows the same pattern as other managed Quilt resources.

## Problem Statement

Currently, the Benchling webhook service hardcodes Athena queries to use the `primary` workgroup (see [lib/fargate-service.ts:182](lib/fargate-service.ts#L182)). This limitation:

1. **Prevents cost allocation**: Cannot track Athena costs separately per deployment
2. **Limits query management**: Cannot apply workgroup-specific query limits or encryption
3. **Reduces isolation**: All deployments share the same workgroup resources
4. **Inflexible for multi-tenant**: Cannot isolate different customers/environments

### Current Implementation

**IAM Permissions** ([lib/fargate-service.ts:172-185](lib/fargate-service.ts#L172-L185)):
```typescript
taskRole.addToPolicy(
    new iam.PolicyStatement({
        actions: [
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
            "athena:StopQueryExecution",
            "athena:GetWorkGroup",
        ],
        resources: [
            `arn:aws:athena:${region}:${account}:workgroup/primary`,  // ← HARDCODED
        ],
    }),
);
```

**Python Application** ([docker/src/package_query.py:106-110](docker/src/package_query.py#L106-L110)):
```python
response = self.athena.start_query_execution(
    QueryString=query,
    QueryExecutionContext={"Database": self.database},
    ResultConfiguration={"OutputLocation": self.output_location},
    # No WorkGroup parameter - defaults to 'primary'
)
```

## Goals

### Primary Goals

1. **Configurable Workgroup**: Allow specifying custom Athena workgroup per deployment
2. **Backward Compatibility**: Default to `primary` workgroup when not specified
3. **Cost Tracking**: Enable per-deployment or per-customer Athena cost allocation
4. **Consistent Pattern**: Follow existing environment variable patterns

### Secondary Goals

1. **Query Management**: Support workgroup-specific limits and settings
2. **Security**: Support workgroup-specific encryption settings
3. **Multi-Tenant Ready**: Enable isolated workgroups per customer

## Desired End State

### Environment Variable

**New Container Environment Variable**:
- `BENCHLING_ATHENA_WORKGROUP` (optional, defaults to `primary`)
- Type: String
- Format: Workgroup name (e.g., `primary`, `benchling-prod`, `benchling-sales`)
- Validation: Must be a valid Athena workgroup name (alphanumeric, hyphens, underscores)

### Configuration Flow

**Managed Resource** (resolved from Quilt stack outputs at deployment time):

```
Quilt Stack Output (TabulatorOpenQueryWorkGroup) →
  Deployment Command (resolveQuiltServices) →
    CloudFormation Parameter (AthenaWorkgroup) →
      ECS Task Definition (BENCHLING_ATHENA_WORKGROUP env var) →
        Python Application (uses workgroup in Athena API calls)
```

This follows the **same pattern** as other managed resources like `PackagerQueueUrl` and `UserAthenaDatabaseName`, which are resolved from Quilt stack outputs at deployment time.

### IAM Permissions Update

**CDK Stack** ([lib/fargate-service.ts:172-185](lib/fargate-service.ts#L172-L185)):
```typescript
// Grant Athena access to task role for package querying
const athenaWorkgroup = props.athenaWorkgroup || 'primary';
taskRole.addToPolicy(
    new iam.PolicyStatement({
        actions: [
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
            "athena:StopQueryExecution",
            "athena:GetWorkGroup",
        ],
        resources: [
            `arn:aws:athena:${region}:${account}:workgroup/${athenaWorkgroup}`,
        ],
    }),
);
```

### Python Application Update

**PackageQuery Class** ([docker/src/package_query.py:41-88](docker/src/package_query.py#L41-L88)):
```python
def __init__(
    self,
    bucket: str,
    catalog_url: str,
    database: Optional[str] = None,
    region: Optional[str] = None,
    athena_output_bucket: Optional[str] = None,
    workgroup: Optional[str] = None,  # NEW PARAMETER
):
    """Initialize Athena query client.

    Args:
        ...
        workgroup: Athena workgroup name (defaults to BENCHLING_ATHENA_WORKGROUP
            env var or 'primary')
    """
    self.workgroup = (
        workgroup
        or os.getenv("BENCHLING_ATHENA_WORKGROUP", "primary")
    )

    self.logger.info(
        "Initialized PackageQuery",
        database=self.database,
        bucket=bucket,
        catalog=catalog_url,
        region=self.region,
        workgroup=self.workgroup,
        output_location=self.output_location,
    )
```

**Query Execution** ([docker/src/package_query.py:106-110](docker/src/package_query.py#L106-L110)):
```python
response = self.athena.start_query_execution(
    QueryString=query,
    QueryExecutionContext={"Database": self.database},
    ResultConfiguration={"OutputLocation": self.output_location},
    WorkGroup=self.workgroup,  # NEW: Use configured workgroup
)
```

## Implementation Plan

### Phase 1: CDK Infrastructure

**Files to Update**:
1. `lib/types/config.ts` - Add `athenaWorkgroup` to `DeploymentConfig`
2. `lib/benchling-webhook-stack.ts` - Add CloudFormation parameter
3. `lib/fargate-service.ts` - Update IAM permissions and environment variable
4. `bin/commands/deploy.ts` - Pass workgroup from profile config

**Changes**:

**`lib/types/config.ts`**:
```typescript
interface QuiltServices {
  /**
   * SQS queue URL for package creation jobs
   */
  packagerQueueUrl: string;

  /**
   * Athena database name for user data
   */
  athenaUserDatabase: string;

  /**
   * Quilt catalog web host (hostname only)
   */
  quiltWebHost: string;

  /**
   * Athena workgroup for queries (NEW)
   * Resolved from TabulatorOpenQueryWorkGroup stack output
   */
  athenaWorkgroup?: string;

  /**
   * Iceberg database name (optional)
   */
  icebergDatabase?: string;
}
```

**`lib/utils/service-resolver.ts`**:
```typescript
// Add to resolveQuiltServices function after extracting other outputs

// Step 7: Extract optional Athena workgroup
const athenaWorkgroup = outputs.TabulatorOpenQueryWorkGroup;

return {
    packagerQueueUrl,
    athenaUserDatabase,
    quiltWebHost,
    ...(icebergDatabase && { icebergDatabase }),
    ...(athenaWorkgroup && { athenaWorkgroup }),  // NEW
};
```

**`lib/benchling-webhook-stack.ts`**:
```typescript
// Add CloudFormation parameter (resolved at deployment time)
const athenaWorkgroupParam = new cdk.CfnParameter(this, "AthenaWorkgroup", {
    type: "String",
    description: "Athena workgroup for package queries (resolved from Quilt stack)",
    default: "",  // Will be resolved at deployment time
});

// Pass to Fargate service
const fargateService = new MultiEnvironmentFargateService(this, "FargateService", {
    // ... existing props ...
    athenaWorkgroup: athenaWorkgroupParam.valueAsString || "primary",
});
```

**`lib/fargate-service.ts`**:
```typescript
export interface MultiEnvironmentFargateServiceProps {
    // ... existing props ...

    /**
     * Athena workgroup for package queries
     * Resolved from Quilt stack TabulatorOpenQueryWorkGroup output
     * @default 'primary'
     */
    athenaWorkgroup?: string;
}

export class MultiEnvironmentFargateService extends Construct {
    constructor(scope: Construct, id: string, props: MultiEnvironmentFargateServiceProps) {
        // ... existing code ...

        const athenaWorkgroup = props.athenaWorkgroup || 'primary';

        // Update IAM permissions to use resolved workgroup
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetQueryResults",
                    "athena:StopQueryExecution",
                    "athena:GetWorkGroup",
                ],
                resources: [
                    `arn:aws:athena:${region}:${account}:workgroup/${athenaWorkgroup}`,
                ],
            }),
        );

        // Add environment variable
        const environmentVars: { [key: string]: string } = {
            // ... existing vars ...
            BENCHLING_ATHENA_WORKGROUP: athenaWorkgroup,
        };
    }
}
```

**`bin/commands/deploy.ts`**:
```typescript
// Resolve services from Quilt stack
const services = await resolveQuiltServices({
    stackArn: config.quilt.stackArn,
});

// Pass all resolved services to CDK
await runCdkCommand("deploy", [
    "--parameters", `PackagerQueueUrl=${services.packagerQueueUrl}`,
    "--parameters", `AthenaUserDatabase=${services.athenaUserDatabase}`,
    "--parameters", `QuiltWebHost=${services.quiltWebHost}`,
    "--parameters", `AthenaWorkgroup=${services.athenaWorkgroup || 'primary'}`,  // NEW
    // ... other parameters ...
]);
```

### Phase 2: Python Application

**Files to Update**:
1. `docker/src/package_query.py` - Add workgroup parameter and usage
2. `docker/src/canvas.py` - Pass workgroup when creating PackageQuery
3. `docker/tests/test_package_query.py` - Add workgroup tests

**Changes**:

**`docker/src/package_query.py`**:
```python
class PackageQuery:
    def __init__(
        self,
        bucket: str,
        catalog_url: str,
        database: Optional[str] = None,
        region: Optional[str] = None,
        athena_output_bucket: Optional[str] = None,
        workgroup: Optional[str] = None,
    ):
        # ... existing initialization ...

        self.workgroup = (
            workgroup
            or os.getenv("BENCHLING_ATHENA_WORKGROUP", "primary")
        )

        self.logger.info(
            "Initialized PackageQuery",
            database=self.database,
            bucket=bucket,
            catalog=catalog_url,
            region=self.region,
            workgroup=self.workgroup,
            output_location=self.output_location,
        )

    def _execute_query(self, query: str, timeout: int = 30) -> List[Dict[str, Any]]:
        # ... existing code ...

        response = self.athena.start_query_execution(
            QueryString=query,
            QueryExecutionContext={"Database": self.database},
            ResultConfiguration={"OutputLocation": self.output_location},
            WorkGroup=self.workgroup,  # NEW
        )

        # ... rest of method ...
```

### Phase 3: Testing

**Unit Tests**:
- Test default workgroup (`primary`)
- Test custom workgroup
- Test environment variable override
- Test IAM permission scoping

**Integration Tests**:
- Test Athena queries with custom workgroup
- Test fallback to primary workgroup
- Verify CloudFormation parameter passing

**Test Files**:
- `test/benchling-webhook-stack.test.ts` - CloudFormation parameter
- `test/multi-environment-fargate-service.test.ts` - Environment variable
- `docker/tests/test_package_query.py` - Python workgroup usage

### Phase 4: Documentation

**Files to Update**:
1. `README.md` - Document new environment variable
2. `.env.example` - Add example configuration
3. `CHANGELOG.md` - Add feature note
4. `spec/206-service-envars/IMPLEMENTATION-SUMMARY.md` - Update with this feature

## Configuration Examples

### Profile Configuration

**`~/.config/benchling-webhook/sales/config.json`**:
```json
{
  "schemaVersion": "0.7.0",
  "deployment": {
    "stage": "prod",
    "region": "us-east-1",
    "account": "123456789012"
  },
  "benchling": {
    "tenant": "acme-corp",
    "secretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-acme"
  },
  "quilt": {
    "stackArn": "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-prod/...",
    "catalog": "quilt.acme.com",
    "database": "quilt_acme_catalog",
    "queueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue",
    "region": "us-east-1"
  }
}
```

**Note**: The Athena workgroup is **NOT** configured in the profile. It is automatically resolved from the Quilt stack's `TabulatorOpenQueryWorkGroup` output at deployment time, just like `catalog`, `database`, and `queueUrl`.

### Local Development

**`.env`**:
```bash
# Athena Configuration
QUILT_DATABASE=quilt_dev_catalog
BENCHLING_ATHENA_WORKGROUP=benchling-dev

# AWS Configuration
AWS_REGION=us-east-1
AWS_PROFILE=dev
```

### Docker Compose

**`docker/docker-compose.yml`**:
```yaml
services:
  webhook:
    environment:
      - BENCHLING_ATHENA_WORKGROUP=benchling-local
      - QUILT_DATABASE=quilt_local_catalog
```

## Benefits

### Cost Allocation

**Before**:
- All Athena queries use `primary` workgroup
- Cannot separate costs by deployment/customer
- Difficult to track usage patterns

**After**:
- Each deployment can use dedicated workgroup
- Cost Explorer shows per-workgroup spending
- Clear attribution for billing/chargebacks

### Query Management

**Workgroup-Specific Settings**:
- **Query Limits**: Set per-query data scanned limits
- **Result Location**: Dedicated S3 bucket per workgroup
- **Encryption**: Different KMS keys per customer
- **Query History**: Isolated query logs per deployment

### Multi-Tenant Support

**Customer Isolation**:
```
benchling-customer-a → workgroup: benchling-customer-a
benchling-customer-b → workgroup: benchling-customer-b
benchling-internal  → workgroup: benchling-internal
```

**Benefits**:
- Separate cost tracking per customer
- Independent query limits
- Isolated performance
- Security boundaries

## Backward Compatibility

### Default Behavior

**When `BENCHLING_ATHENA_WORKGROUP` is not set**:
- Defaults to `primary` workgroup
- No behavior change from current implementation
- Existing deployments continue to work

### Migration Path

**No Migration Required**:
- Existing deployments automatically use `primary`
- New deployments can specify custom workgroup
- Gradual adoption as needed

**Optional Update**:
```bash
# Update profile configuration
vim ~/.config/benchling-webhook/prod/config.json
# Add: "athenaWorkgroup": "benchling-prod"

# Redeploy
npx @quiltdata/benchling-webhook deploy --profile prod --stage prod --yes
```

## Validation and Error Handling

### Deployment-Time Validation

**Validate Workgroup Exists**:
```typescript
// In deploy command
const athena = new AWS.Athena({ region });
try {
    await athena.getWorkGroup({ WorkGroup: workgroupName }).promise();
} catch (error) {
    throw new Error(`Athena workgroup '${workgroupName}' not found in ${region}`);
}
```

### Runtime Validation

**Container Startup**:
```python
# Validate workgroup is accessible
try:
    response = self.athena.get_work_group(WorkGroup=self.workgroup)
    logger.info("Athena workgroup validated", workgroup=self.workgroup)
except ClientError as e:
    if e.response['Error']['Code'] == 'InvalidRequestException':
        logger.error(
            "Athena workgroup not found",
            workgroup=self.workgroup,
            error=str(e)
        )
        raise ValueError(f"Invalid Athena workgroup: {self.workgroup}")
    raise
```

### IAM Permission Errors

**Clear Error Messages**:
```python
except ClientError as e:
    if e.response['Error']['Code'] == 'AccessDeniedException':
        logger.error(
            "Access denied to Athena workgroup",
            workgroup=self.workgroup,
            hint="Check ECS task role has athena:StartQueryExecution permission"
        )
```

## Testing Strategy

### Unit Tests

**CDK Stack Tests**:
```typescript
test('default workgroup is primary', () => {
    const stack = new BenchlingWebhookStack(app, 'TestStack', config);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: [
            {
                Environment: arrayWith(
                    { Name: 'BENCHLING_ATHENA_WORKGROUP', Value: 'primary' }
                )
            }
        ]
    });
});

test('custom workgroup is configured', () => {
    const customConfig = {
        ...config,
        deployment: { ...config.deployment, athenaWorkgroup: 'benchling-test' }
    };

    const stack = new BenchlingWebhookStack(app, 'TestStack', customConfig);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: [
            {
                Environment: arrayWith(
                    { Name: 'BENCHLING_ATHENA_WORKGROUP', Value: 'benchling-test' }
                )
            }
        ]
    });

    // Verify IAM permissions
    template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
            Statement: arrayWith(
                {
                    Action: arrayWith('athena:StartQueryExecution'),
                    Resource: stringLike('*:workgroup/benchling-test')
                }
            )
        }
    });
});
```

**Python Tests**:
```python
def test_default_workgroup():
    """Test PackageQuery defaults to 'primary' workgroup."""
    query = PackageQuery(
        bucket="test-bucket",
        catalog_url="test.catalog.com",
        database="test_db"
    )
    assert query.workgroup == "primary"

def test_custom_workgroup():
    """Test PackageQuery uses custom workgroup."""
    query = PackageQuery(
        bucket="test-bucket",
        catalog_url="test.catalog.com",
        database="test_db",
        workgroup="benchling-test"
    )
    assert query.workgroup == "benchling-test"

def test_environment_variable_workgroup(monkeypatch):
    """Test PackageQuery reads BENCHLING_ATHENA_WORKGROUP env var."""
    monkeypatch.setenv("BENCHLING_ATHENA_WORKGROUP", "benchling-env")
    query = PackageQuery(
        bucket="test-bucket",
        catalog_url="test.catalog.com",
        database="test_db"
    )
    assert query.workgroup == "benchling-env"
```

### Integration Tests

**Test Athena Query with Custom Workgroup**:
```python
@pytest.mark.integration
def test_query_with_custom_workgroup():
    """Test actual Athena query execution with custom workgroup."""
    workgroup = os.getenv("TEST_ATHENA_WORKGROUP", "primary")
    query = PackageQuery(
        bucket=os.getenv("TEST_BUCKET"),
        catalog_url=os.getenv("TEST_CATALOG"),
        database=os.getenv("QUILT_DATABASE"),
        workgroup=workgroup
    )

    # Execute test query
    result = query.find_unique_packages("test_key", "test_value")

    # Verify query used correct workgroup
    # (Check CloudWatch Logs or Athena query history)
```

## Success Criteria

### Functional Criteria

1. ✅ **Default workgroup works**: Deployments without configuration use `primary`
2. ✅ **Custom workgroup works**: Deployments can specify custom workgroup
3. ✅ **Environment variable honored**: `BENCHLING_ATHENA_WORKGROUP` overrides default
4. ✅ **IAM permissions scoped**: Task role has permission only for specified workgroup
5. ✅ **Profile configuration works**: Workgroup can be set in profile config

### Non-Functional Criteria

1. ✅ **Backward compatible**: Existing deployments continue to work unchanged
2. ✅ **Clear error messages**: Invalid workgroup produces actionable error
3. ✅ **Well documented**: README and examples show workgroup configuration
4. ✅ **Test coverage maintained**: Unit and integration tests cover new functionality
5. ✅ **Performance neutral**: No performance impact from workgroup configuration

## Open Questions

1. **Q**: Should we validate workgroup exists at deployment time?
   **A**: Yes - add pre-flight check in deployment command to fail fast with clear error message

2. **Q**: Should we support multiple workgroups per deployment?
   **A**: No - single workgroup keeps configuration simple. Use separate profiles for different workgroups.

3. **Q**: Should we auto-create workgroup if it doesn't exist?
   **A**: **No** - workgroups are created by the Quilt CloudFormation stack and exposed via the `TabulatorOpenQueryWorkGroup` output. The Benchling webhook stack only consumes this value.

4. **Q**: Should workgroup name be validated against naming rules?
   **A**: Yes - validate alphanumeric, hyphens, underscores only (1-128 characters)

5. **Q**: Should we support workgroup ARN in addition to name?
   **A**: No - name is sufficient and simpler. ARN can be constructed: `arn:aws:athena:${region}:${account}:workgroup/${name}`

6. **Q**: Is this resolved from Quilt stack outputs like other services?
   **A**: **YES** - the workgroup is resolved from the `TabulatorOpenQueryWorkGroup` stack output, following the same pattern as `PackagerQueueUrl` and `UserAthenaDatabaseName`.

## Dependencies

### Quilt Stack Resources

**CloudFormation Stack Output**:
- `TabulatorOpenQueryWorkGroup` - The Athena workgroup name created by the Quilt stack
- Example value: `QuiltTabulatorOpenQuery-tf-dev-bench`
- The Quilt stack creates this workgroup resource (type: `AWS::Athena::WorkGroup`)

**IAM Permissions**:
- ECS task role must have `athena:GetWorkGroup` permission for the workgroup
- ECS task role must have `athena:StartQueryExecution` permission for the workgroup
- S3 permissions for the workgroup's result bucket (already configured via existing S3 permissions)

**Note**: The workgroup is created and managed by the Quilt CloudFormation stack, not by the Benchling webhook stack.

### Code Dependencies

- Python boto3 Athena client (already available)
- TypeScript AWS CDK IAM module (already available)
- No new dependencies required

## Risk Assessment

### Low Risk

**Why Low Risk**:
- Backward compatible (defaults to `primary`)
- Well-defined scope (single environment variable)
- No breaking changes
- Incremental adoption

**Mitigation**:
- Comprehensive testing
- Clear documentation
- Validation at deployment time

## Related Work

### Athena Result Location

Currently hardcoded to `aws-athena-query-results-{account}-{region}`. Future work could:
- Support custom result bucket per workgroup
- Use workgroup's default result location
- Add `ATHENA_RESULT_BUCKET` environment variable

### Workgroup Encryption

Future enhancement could configure KMS encryption per workgroup:
```typescript
interface WorkgroupConfig {
    name: string;
    kmsKeyArn?: string;
    resultBucket?: string;
}
```

## Conclusion

Adding `BENCHLING_ATHENA_WORKGROUP` enables:
- **Cost Tracking**: Per-deployment Athena cost allocation
- **Query Management**: Workgroup-specific limits and settings
- **Multi-Tenant**: Customer isolation with dedicated workgroups
- **Flexibility**: Easy configuration without breaking changes

This aligns with the Phase 1 goals of making service configuration explicit and configurable while maintaining backward compatibility.

### Key Findings from Stack Analysis

**Verified on Stack**: `tf-dev-bench` (us-east-2)

1. **Stack Output Confirmed**: `TabulatorOpenQueryWorkGroup` exists with value `QuiltTabulatorOpenQuery-tf-dev-bench`
2. **Resource Type**: The Quilt stack creates an `AWS::Athena::WorkGroup` resource (LogicalId: `IcebergWorkGroup`)
3. **Resolution Pattern**: Follows same pattern as `PackagerQueueUrl`, `UserAthenaDatabaseName`, and `QuiltWebHost`
4. **No Profile Config Needed**: The workgroup is automatically discovered from the stack, not manually configured

This means the implementation is **simpler** than initially thought - no new profile configuration fields needed, just add support for the existing stack output.

## Next Steps

1. Implement Phase 1: CDK infrastructure updates
   - Update `lib/utils/service-resolver.ts` to extract `TabulatorOpenQueryWorkGroup`
   - Add `athenaWorkgroup` to `QuiltServices` interface
   - Add CloudFormation parameter in `lib/benchling-webhook-stack.ts`
   - Pass workgroup to Fargate service and update IAM permissions
   - Update deploy command to pass workgroup parameter
2. Implement Phase 2: Python application updates
   - Add `workgroup` parameter to `PackageQuery.__init__()`
   - Read from `BENCHLING_ATHENA_WORKGROUP` environment variable
   - Use workgroup in `start_query_execution` calls
3. Implement Phase 3: Testing
   - Add unit tests for workgroup resolution
   - Add integration tests with actual Athena queries
4. Implement Phase 4: Documentation
   - Update README with workgroup information
   - Add to CHANGELOG
   - Update IMPLEMENTATION-SUMMARY
5. Update `IMPLEMENTATION-SUMMARY.md` with this feature
