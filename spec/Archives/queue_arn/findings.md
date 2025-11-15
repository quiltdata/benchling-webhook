# Queue URL/ARN Findings - Comprehensive Audit

This document catalogs ALL instances of queue-related references found throughout the codebase during the exhaustive search for the QUEUE_URL to QUEUE_ARN migration.

## Summary

**Status**: Migration to QUEUE_ARN completed, but documentation still references old patterns
**Critical Finding**: Python code correctly converts ARN to URL for boto3 (line 700 in entry_packager.py)
**Key Issue**: Extensive documentation still references SQS_QUEUE_URL and QUEUE_NAME patterns

---

## 1. ACTIVE CODE (Production/Runtime)

### 1.1 Python Code - CORRECT ✓

#### /Users/ernest/GitHub/benchling-webhook/docker/src/config.py

**Line 15**: `queue_arn: str = os.getenv("QUEUE_ARN", "")`

- **Context**: Configuration dataclass reads QUEUE_ARN from environment
- **Status**: CORRECT - uses QUEUE_ARN
- **Action**: NO CHANGE NEEDED

**Line 28**: `"queue_arn",` (in required_fields list)

- **Context**: Validates queue_arn is required
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

#### /Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py

**Line 695**: `arn_parts = self.config.queue_arn.split(":")`
**Lines 696-700**: ARN to URL conversion logic

```python
# ARN format: arn:aws:sqs:region:account:queue-name
# URL format: https://sqs.region.amazonaws.com/account/queue-name
arn_parts = self.config.queue_arn.split(":")
if len(arn_parts) >= 6:
    region = arn_parts[3]
    account = arn_parts[4]
    queue_name = arn_parts[5]
    queue_url = f"https://sqs.{region}.amazonaws.com/{account}/{queue_name}"
```

- **Context**: Converts ARN to URL for boto3.send_message() call
- **Status**: CORRECT - boto3 requires QueueUrl parameter (not ARN)
- **Why ARN to URL conversion is needed**: AWS boto3 SQS client's send_message() method requires QueueUrl parameter, not QueueArn
- **Action**: NO CHANGE NEEDED - this conversion is essential

**Line 703**: `queue_url = self.config.queue_arn` (fallback)

- **Context**: Fallback if ARN parsing fails
- **Status**: CORRECT - safe fallback
- **Action**: NO CHANGE NEEDED

**Line 706**: `QueueUrl=queue_url, MessageBody=json.dumps(message_body)`

- **Context**: boto3 send_message call
- **Status**: CORRECT - uses QueueUrl parameter as required by boto3
- **Action**: NO CHANGE NEEDED

---

### 1.2 TypeScript Code - CORRECT ✓

#### /Users/ernest/GitHub/benchling-webhook/lib/utils/config.ts

**Line 25**: `queueArn: string;` (interface)

- **Context**: Config interface definition
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

**Line 144**: `queueArn: envVars.QUEUE_ARN,`

- **Context**: Loading config from environment
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

**Line 173**: `queueArn: config.queueArn || inferredVars.QUEUE_ARN,`

- **Context**: Merging inferred config
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

**Line 214**: `["queueArn", "SQS queue ARN"],`

- **Context**: Validation field definition
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

#### /Users/ernest/GitHub/benchling-webhook/lib/utils/stack-inference.ts

**Line 203-207**: Stack output lookup and QUEUE_ARN extraction

```typescript
const queueArnOutput = stackDetails.outputs.find(
    (o) => o.OutputKey === "PackagerQueueArn",
);
if (queueArnOutput) {
    vars.QUEUE_ARN = queueArnOutput.OutputValue;
}
```

- **Context**: Searches CloudFormation stack for PackagerQueueArn output
- **Status**: CORRECT - looks for PackagerQueueArn (not PackagerQueueUrl)
- **Action**: NO CHANGE NEEDED

**Lines 341-342**: Display inferred QUEUE_ARN

- **Context**: Console logging of inferred values
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

#### /Users/ernest/GitHub/benchling-webhook/lib/benchling-webhook-stack.ts

**Line 15**: `readonly queueArn: string;` (interface)
**Line 79-82**: CloudFormation parameter definition
**Line 118**: `const queueArnValue = queueArnParam.valueAsString;`
**Line 152**: `queueArn: queueArnValue,`

- **Context**: Stack props and CloudFormation parameter
- **Status**: CORRECT - uses queueArn throughout
- **Action**: NO CHANGE NEEDED

---

#### /Users/ernest/GitHub/benchling-webhook/lib/fargate-service.ts

**Line 15**: `readonly queueArn: string;` (interface)
**Line 89**: `"sqs:GetQueueUrl",` (IAM permission)

- **Context**: IAM policy permissions for SQS
- **Status**: CORRECT - IAM action name is "sqs:GetQueueUrl" (AWS API name)
- **Note**: This is the AWS IAM action name, not a variable name
- **Action**: NO CHANGE NEEDED

**Line 92**: `resources: [props.queueArn],`

- **Context**: IAM policy resource ARN
- **Status**: CORRECT - IAM policies use ARNs
- **Action**: NO CHANGE NEEDED

**Line 181**: `QUEUE_ARN: props.queueArn,`

- **Context**: Environment variable passed to container
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

#### /Users/ernest/GitHub/benchling-webhook/bin/benchling-webhook.ts

**Line 128**: `queueArn: config.queueArn,`
**Line 204**: `"QUEUE_ARN",` (required variable)
**Line 291**: `queueArn: config.QUEUE_ARN!,`

- **Context**: Various uses of queueArn
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

#### /Users/ernest/GitHub/benchling-webhook/bin/commands/init.ts

**Lines 152-154**: Write QUEUE_ARN to .env file

```typescript
if (inferredVars.QUEUE_ARN) {
    envLines.push(`# SQS queue ARN for Quilt packaging`);
    envLines.push(`QUEUE_ARN=${inferredVars.QUEUE_ARN}`);
}
```

- **Context**: Generates .env file with QUEUE_ARN
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

#### /Users/ernest/GitHub/benchling-webhook/bin/commands/deploy.ts

**Line 128**: `console.log(\`    ${chalk.bold("Queue ARN:")}                ${config.queueArn}\`);`

- **Context**: Display config during deployment
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

### 1.3 Test Code - CORRECT ✓

All test files use QUEUE_ARN and queueArn correctly:

- `/Users/ernest/GitHub/benchling-webhook/test/benchling-webhook-stack.test.ts`
- `/Users/ernest/GitHub/benchling-webhook/test/utils-stack-inference.test.ts`
- `/Users/ernest/GitHub/benchling-webhook/test/utils-config.test.ts`
- `/Users/ernest/GitHub/benchling-webhook/docker/tests/test_entry_packager.py`
- `/Users/ernest/GitHub/benchling-webhook/docker/tests/test_config_env_vars.py`

**Action**: NO CHANGES NEEDED

---

### 1.4 Configuration Files - CORRECT ✓

#### /Users/ernest/GitHub/benchling-webhook/env.template

**Line 62**: `# - QUEUE_ARN              (from Quilt stack outputs)`

- **Context**: Template showing QUEUE_ARN
- **Status**: CORRECT
- **Action**: NO CHANGE NEEDED

---

## 2. DOCUMENTATION (Outdated References)

### 2.1 References to SQS_QUEUE_URL (OUTDATED)

These are **DOCUMENTATION ONLY** references that describe a pattern that is **NO LONGER USED** in the actual code:

#### /Users/ernest/GitHub/benchling-webhook/AGENTS.md

**Line 102**: `| \`SQS_QUEUE_URL\` | From Quilt stack outputs |`

- **Context**: Documentation table
- **Status**: OUTDATED - should be QUEUE_ARN
- **Action**: UPDATE documentation

---

#### /Users/ernest/GitHub/benchling-webhook/spec/cli/*.md files

Multiple references to SQS_QUEUE_URL in:

- `QUICK_REFERENCE.md` (lines 116, 159)
- `DOCUMENTATION_UPDATES.md` (line 194)
- `CLI_SPEC.md` (lines 250, 342, 396, 507, 628, 929)
- `IMPLEMENTATION_SUMMARY.md` (line 234)
- `REFACTORING_GUIDE.md` (lines 207, 237, 1021)
- `EXAMPLES.md` (line 394)

**Context**: All are spec/documentation files describing proposed CLI behavior
**Status**: OUTDATED - these specs reference old SQS_QUEUE_URL pattern
**Action**: UPDATE all specs to use QUEUE_ARN pattern instead

---

#### /Users/ernest/GitHub/benchling-webhook/docker/README.md

**Line 182**: `- \`SQS_QUEUE_URL\` - SQS queue for Quilt packaging`

- **Context**: Docker documentation
- **Status**: OUTDATED
- **Action**: UPDATE to QUEUE_ARN

#### /Users/ernest/GitHub/benchling-webhook/docker/src/README.md

**Line 101**: `- \`SQS_QUEUE_URL\` - SQS queue for async processing`

- **Context**: Source documentation
- **Status**: OUTDATED
- **Action**: UPDATE to QUEUE_ARN

---

### 2.2 References to QUEUE_NAME (Unused Pattern)

#### Multiple spec files reference QUEUE_NAME

- `AGENTS.md` (line 101)
- `spec/cli/QUICK_REFERENCE.md` (lines 115, 158)
- `spec/cli/DOCUMENTATION_UPDATES.md` (line 193)
- `spec/cli/CLI_SPEC.md` (lines 249, 341, 392, 506, 628, 928)
- `spec/cli/IMPLEMENTATION_SUMMARY.md` (line 233)
- `spec/cli/REFACTORING_GUIDE.md` (lines 206, 236, 1018, 1020)
- `spec/cli/EXAMPLES.md` (line 393)
- `doc/PARAMETERS.md` (line 43)

**Context**: Documentation references to queue name (not ARN)
**Status**: These appear to be part of CLI spec proposals that were never fully implemented
**Action**: DO NOT MODIFY - these are legacy spec files (not in docs/ or top-level), leave as-is

---

### 2.3 References to queueUrl / sqsQueueUrl (Spec Only)

#### /Users/ernest/GitHub/benchling-webhook/bin/commands/validate.ts

**Line 89**: `"sqsQueueUrl",` (in validation list)

- **Context**: Validates field named sqsQueueUrl
- **Status**: INCORRECT - validates a field that doesn't exist in Config interface
- **Action**: FIX - remove sqsQueueUrl from validation list (dead code)

#### Multiple spec files reference sqsQueueUrl

- `spec/cli/CLI_SPEC.md` (lines 851, 929, 986, 1230)
- `spec/cli/REFACTORING_GUIDE.md` (lines 111, 207, 237, 285, 1155)
- `spec/cli/EXAMPLES.md` (line 243)

**Context**: Spec documents describing proposed CLI behavior
**Status**: OUTDATED specs - these reference a pattern not used in actual code
**Action**: DO NOT MODIFY - these are legacy spec files (not in docs/ or top-level), leave as-is

---

## 3. LEGACY/HISTORICAL REFERENCES

### 3.1 Git History

- `.git/logs/HEAD` contains commit messages about QUEUE_URL transitions
- **Action**: NO CHANGE NEEDED (historical records)

---

### 3.2 Changelog

#### /Users/ernest/GitHub/benchling-webhook/CHANGELOG.md

- Lines 10-12: Documents the BREAKING CHANGE from QUEUE_URL to QUEUE_ARN
- Line 42: References old "Unified queue configuration to use QUEUE_URL"
- Line 51: References fix for SQS_QUEUE_URL
- **Context**: Historical documentation of changes
- **Action**: NO CHANGE NEEDED (accurate historical records)

---

### 3.3 Test/Development Scripts

#### /Users/ernest/GitHub/benchling-webhook/docker/scripts/run_local.py

**Line 32**: `os.environ.setdefault("QUEUE_URL", "https://sqs.us-west-2.amazonaws.com/123456789012/test-queue")`

- **Context**: Local development script
- **Status**: OUTDATED - uses old QUEUE_URL name
- **Action**: UPDATE to QUEUE_ARN

#### /Users/ernest/GitHub/benchling-webhook/docker/scripts/test_benchling.py

**Line 53**: `queue_url="https://sqs.us-east-2.amazonaws.com/test/queue",`

- **Context**: Test script parameter
- **Status**: OUTDATED - uses old queue_url parameter name
- **Action**: FIX - update to use queue_arn parameter

#### /Users/ernest/GitHub/benchling-webhook/docker/tests/test_app.py

**Line 20**: `config.queue_url = "https://sqs.us-west-2.amazonaws.com/123456789012/test"`

- **Context**: Test setting queue_url on config object
- **Status**: ERROR - config.py defines queue_arn, not queue_url
- **Action**: FIX - should use queue_arn

---

### 3.4 Docker Compose

#### /Users/ernest/GitHub/benchling-webhook/docker/docker-compose.yml

**Lines 17, 55**: `- QUEUE_URL=${QUEUE_URL}`

- **Context**: Docker compose environment variables
- **Status**: OUTDATED - should use QUEUE_ARN
- **Action**: UPDATE to QUEUE_ARN

---

## 4. SPECIAL CASES

### 4.1 AWS IAM Actions

**Location**: `/Users/ernest/GitHub/benchling-webhook/lib/fargate-service.ts:89`
**Reference**: `"sqs:GetQueueUrl"`

**Important Note**: This is an AWS IAM action name, NOT a variable name. The AWS SQS API action is called "GetQueueUrl" regardless of whether you're using ARNs or URLs in your code.

**Action**: NO CHANGE NEEDED - this is the correct AWS API action name

---

### 4.2 boto3 QueueUrl Parameter

**Location**: `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py:706`
**Reference**: `QueueUrl=queue_url`

**Important Note**: boto3's SQS client requires the parameter name to be "QueueUrl" (not "QueueArn"). This is why we convert ARN to URL format on lines 695-700.

**Action**: NO CHANGE NEEDED - boto3 API requirement

---

## 5. SUMMARY BY CATEGORY

### ✓ CORRECT (No Changes Needed)

- All Python production code (`config.py`, `entry_packager.py`)
- All TypeScript production code (`*.ts` in lib/, bin/)
- All test files (Python and TypeScript)
- Main configuration template (`env.template`)
- IAM action names in policies
- boto3 QueueUrl parameter usage

### ⚠️ NEEDS UPDATE (Documentation Only)

- Docker documentation (`docker/README.md`, `docker/src/README.md`)
- `AGENTS.md` table
- **DO NOT UPDATE**: Legacy spec files in `spec/cli/` - left as-is (historical proposals)

### 🐛 NEEDS FIX (Actual Bugs)

- `docker/scripts/run_local.py` - uses old QUEUE_URL
- `docker/docker-compose.yml` - uses old QUEUE_URL
- `docker/tests/test_app.py` - uses config.queue_url (should be queue_arn)
- `docker/scripts/test_benchling.py` - uses queue_url parameter (should be queue_arn)
- `bin/commands/validate.ts` - validates sqsQueueUrl (dead code, should be removed)

### 📚 KEEP AS-IS (Historical/Informational)

- `CHANGELOG.md` - accurate historical records
- Git history in `.git/logs/`
- Legacy spec files in `spec/cli/` - historical proposals, not active code

---

## 6. KEY ARCHITECTURAL INSIGHTS

### Why We Use ARN in Config But URL for boto3

1. **Configuration Storage**: We store the queue ARN because:
   - ARNs are the canonical AWS identifier
   - CloudFormation outputs provide ARNs
   - IAM policies require ARNs

2. **boto3 API Requirement**: We convert to URL because:
   - boto3's `send_message()` requires `QueueUrl` parameter
   - The conversion is deterministic: `arn:aws:sqs:region:account:queue-name` → `https://sqs.region.amazonaws.com/account/queue-name`
   - Conversion happens at runtime in `entry_packager.py` lines 695-700

3. **This Pattern is CORRECT**: The ARN-to-URL conversion is not a bug, it's a necessary adapter between CloudFormation/IAM (which use ARNs) and boto3 (which requires URLs).

---

## 7. RECOMMENDATION PRIORITY

### HIGH PRIORITY (Actual Bugs)

1. Fix `docker/tests/test_app.py` - broken test (config.queue_url → config.queue_arn)
2. Fix `docker/docker-compose.yml` - wrong env var (QUEUE_URL → QUEUE_ARN)
3. Fix `docker/scripts/run_local.py` - wrong env var (QUEUE_URL → QUEUE_ARN)
4. Fix `docker/scripts/test_benchling.py` - wrong parameter (queue_url → queue_arn)
5. Fix `bin/commands/validate.ts` - remove dead code (sqsQueueUrl validation)

### MEDIUM PRIORITY (User-Facing Documentation)

1. Update `AGENTS.md` (SQS_QUEUE_URL → QUEUE_ARN)
2. Update `docker/README.md` and `docker/src/README.md` (SQS_QUEUE_URL → QUEUE_ARN)

### LOW PRIORITY (Internal Specs)

1. **DO NOT UPDATE**: Legacy spec files in `spec/cli/` - kept as-is for historical reference

---

## 8. VERIFICATION CHECKLIST

After making changes, verify:

- [ ] All Python code uses `config.queue_arn`
- [ ] All TypeScript code uses `queueArn` property
- [ ] Environment variables use `QUEUE_ARN`
- [ ] CloudFormation outputs use `PackagerQueueArn`
- [ ] boto3 calls still use `QueueUrl` parameter (with ARN-to-URL conversion)
- [ ] IAM policies still reference ARNs in `resources`
- [ ] Documentation reflects QUEUE_ARN pattern
- [ ] Tests pass with QUEUE_ARN configuration
