# Multi-Environment Architecture Specification: Review & Gap Analysis

**Date**: 2025-11-04
**Reviewer**: Claude
**Specification**: [13-multi-environment-architecture-spec.md](./13-multi-environment-architecture-spec.md)
**Status**: ✅ **APPROVED** - Specification is sound and ready for implementation

---

## Executive Summary

The multi-environment architecture specification in document `13-multi-environment-architecture-spec.md` has been thoroughly reviewed against the current codebase (v0.6.3). The specification is **architecturally sound** and **implementable** as written.

### Key Findings

✅ **Architecture is Clean and Well-Designed**
- Single stack with multiple stages (dev/prod) - optimal cost/isolation balance
- Leverages existing XDG profile system effectively
- Maintains backward compatibility
- Clear separation of concerns

✅ **Specification is Complete**
- All required changes are documented
- Implementation examples are detailed and accurate
- Migration path is well-defined
- Success criteria are measurable

✅ **No Critical Gaps Found**
- Current codebase structure supports the proposed changes
- XDG profile system already has necessary foundation
- Deployment flow is well-specified
- Testing strategy is comprehensive

⚠️ **Minor Enhancements Recommended**
- Additional details on some edge cases (documented below)
- Clarifications on deployment state management
- Enhanced error handling guidance

---

## Current State Analysis (v0.6.3)

### 1. Infrastructure (CDK)

#### Current Single-Environment Stack

```typescript
// lib/benchling-webhook-stack.ts (lines 34-181)
export class BenchlingWebhookStack extends cdk.Stack {
    // ✅ Single ECS cluster
    // ✅ Single Fargate service
    // ✅ Single ALB
    // ✅ API Gateway with hardcoded "prod" stage (line 57)
    // ✅ Parameters for quiltStackArn, benchlingSecret, imageTag
}
```

**Gap Analysis**:
- ❌ API Gateway stage is hardcoded to "prod"
- ❌ No support for multiple environments
- ✅ Parameter system ready for extension

#### Current ALB/API Gateway Integration

```typescript
// lib/alb-api-gateway.ts (lines 53-66)
this.api = new apigateway.RestApi(scope, "BenchlingWebhookAPI", {
    restApiName: "BenchlingWebhookAPI",
    policy: policyDocument,
    deployOptions: {
        stageName: "prod",  // ❌ HARDCODED
        // ...
    },
});
```

**Gap Analysis**:
- ❌ Single stage deployment
- ❌ No stage → target group routing
- ✅ Structure supports multiple stages (needs refactoring)

#### Current Fargate Service

```typescript
// lib/fargate-service.ts (lines 46-494)
export class FargateService extends Construct {
    public readonly service: ecs.FargateService;  // ❌ SINGULAR
    public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    public readonly cluster: ecs.Cluster;

    constructor() {
        // Creates single service with single task definition
        // ❌ No multi-environment support
    }
}
```

**Gap Analysis**:
- ❌ Returns single service (not Map<string, ecs.FargateService>)
- ❌ Creates single target group (not per-environment)
- ❌ No environment-specific configuration
- ✅ Shared cluster/ALB foundation is correct

### 2. Configuration System (XDG)

#### Profile Support (Already Implemented!)

```typescript
// lib/xdg-config.ts (lines 369-619)
export class XDGConfig {
    // ✅ Profile directories: getProfileDir(profileName)
    // ✅ Profile paths: getProfilePaths(profileName)
    // ✅ Profile read/write: readProfileConfig(), writeProfileConfig()
    // ✅ Profile listing: listProfiles()
    // ✅ Profile loading: loadProfile(profileName)
}
```

**Gap Analysis**:
- ✅ **Excellent news**: Multi-profile system is already implemented!
- ✅ Supports named profiles ("default", "dev", "prod", etc.)
- ✅ Separate directories per profile
- ⚠️ Not yet integrated with deployment commands

### 3. Deployment System

#### Current Deploy Command

```typescript
// bin/commands/deploy.ts (lines 91-412)
export async function deployCommand(options: {
    quiltStackArn?: string;
    benchlingSecret?: string;
    imageTag?: string;
    // ❌ No profile parameter
    // ❌ No environment parameter
}): Promise<void>
```

**Gap Analysis**:
- ❌ No `--profile` option
- ❌ No `--environment` (dev/prod) distinction
- ❌ Hardcoded to single environment
- ✅ XDG config integration exists (lines 102-113)

#### Deployment Config Storage

```typescript
// bin/commands/deploy.ts (lines 22-36, 42-89)
interface DeploymentConfig {
    dev?: EnvironmentConfig;      // ✅ READY for dev
    prod?: EnvironmentConfig;     // ✅ READY for prod
}

function storeDeploymentConfig(
    environment: "dev" | "prod",  // ✅ Already supports both!
    config: EnvironmentConfig
): void
```

**Gap Analysis**:
- ✅ **Excellent news**: `deploy.json` structure already supports dev/prod!
- ✅ Storage function accepts environment parameter
- ❌ Currently only "prod" is written (line 355)

### 4. Testing System

#### Test Scripts (npm)

```json
// package.json (lines 35-37)
"test:dev": "make -C docker test-deployed-dev",
"test:prod": "make -C docker test-deployed-prod",
```

**Gap Analysis**:
- ✅ Both dev and prod test targets exist
- ✅ Makefile targets exist (see below)

#### Makefile Test Targets

```makefile
# docker/make.deploy (lines referenced in Makefile)
test-deployed-dev: check-xdg
	@DEV_ENDPOINT=$$(jq -r '.dev.endpoint // empty' $(XDG_CONFIG)/deploy.json)
	# ✅ Reads from .dev.endpoint

test-deployed-prod: check-xdg
	@PROD_ENDPOINT=$$(jq -r '.prod.endpoint // empty' $(XDG_CONFIG)/deploy.json)
	# ✅ Reads from .prod.endpoint
```

**Gap Analysis**:
- ✅ Test infrastructure already expects dev/prod separation
- ✅ Reads from correct `deploy.json` structure
- ⚠️ Will fail if dev deployment doesn't exist (auto-deploy mitigates this)

---

## Specification Review: Section by Section

### Section: Proposed Architecture (Lines 65-111)

**Assessment**: ✅ **Excellent**

The proposed architecture diagram clearly shows:
- Single stack (BenchlingWebhookStack)
- Shared infrastructure (VPC, ECS Cluster, ALB)
- Separate services per environment
- Two API Gateway stages routing to respective services

**Implementation Notes**:
1. Shared cluster is already implemented ([fargate-service.ts:56](../../lib/fargate-service.ts#L56))
2. Multiple services will require refactoring `FargateService` constructor
3. API Gateway stage creation is straightforward CDK pattern

**No gaps found**.

### Section: Profile-Based Configuration (Lines 113-160)

**Assessment**: ✅ **Well-Specified**

Profile structure is clear:
- `default.json` for production (end users)
- `dev.json` for development (maintainers, optional)
- Clear differentiation via `benchlingAppDefinitionId`, `quiltStackArn`, `imageTag`

**Implementation Notes**:
1. XDG profile system already supports this ([xdg-config.ts:369-619](../../lib/xdg-config.ts#L369-L619))
2. Secret naming convention is clean: `quiltdata/benchling-webhook/{profile}/{tenant}`
3. Profile → Stage mapping is logical

**Gap Identified**:
- ⚠️ Spec doesn't specify how to handle missing `dev.json` gracefully
- **Recommendation**: Add fallback logic to deploy only prod stage if dev profile missing

### Section: Deployment Flow (Lines 162-200)

**Assessment**: ✅ **Clear and Actionable**

The deployment flow is well-documented:
1. Profile selection via `--profile` flag
2. Image tag differentiation (`latest` vs semantic version)
3. Separate npm commands for dev/prod

**Implementation Notes**:
1. Current `deployCommand` needs `--profile` and `--environment` parameters added
2. Profile → environment mapping is clear (dev profile → dev stage)
3. Image tag logic already exists ([benchling-webhook-stack.ts:123](../../lib/benchling-webhook-stack.ts#L123))

**Gap Identified**:
- ⚠️ What happens if user runs `deploy:prod` with `--profile dev`?
- **Recommendation**: Add validation to prevent profile/environment mismatches

### Section: CDK Implementation Changes (Lines 202-407)

**Assessment**: ✅ **Detailed and Implementable**

All three constructs are specified with code examples:

#### 1. AlbApiGateway Changes (Lines 206-243)

**Current State**:
```typescript
// Current: Returns single API with single stage
public readonly api: apigateway.RestApi;
```

**Proposed**:
```typescript
// Proposed: Returns API with multiple stages
public readonly stages: Map<string, apigateway.Stage>;
```

**Assessment**:
- ✅ Straightforward refactoring
- ✅ Backward compatible (can return both `api` and `stages`)
- ✅ Example code is correct CDK syntax

**Implementation Complexity**: Low

#### 2. FargateService Changes (Lines 245-340)

**Current State**:
```typescript
// Current: Creates single service
constructor(scope, id, props: FargateServiceProps)
```

**Proposed**:
```typescript
// Proposed: Creates multiple services from array
readonly environments: Array<{
    name: string;
    imageTag: string;
    secretName: string;
}>
```

**Assessment**:
- ✅ Well-structured approach
- ✅ Loop-based construction is correct pattern
- ⚠️ Large refactoring (single service → multiple services)
- ✅ Shared resources (cluster, ALB) remain shared

**Implementation Complexity**: Medium-High

**Gap Identified**:
- ⚠️ Listener routing: How does ALB route to correct target group?
- **Recommendation**: Add ALB listener rules based on path prefix (e.g., `/dev/*` → dev target group)
- **Alternative**: Use API Gateway stage routing only (cleaner)

#### 3. Stack Constructor Changes (Lines 342-406)

**Proposed**:
```typescript
export interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly devProfile?: { secretName: string; imageTag: string; };
    readonly prodProfile: { secretName: string; imageTag: string; };
}
```

**Assessment**:
- ✅ Optional `devProfile` allows backward compatibility
- ✅ Conditional environment creation is elegant
- ✅ Output creation for all stages is correct

**Gap Identified**:
- ⚠️ How are `devProfile` and `prodProfile` populated?
- **Recommendation**: Add logic to read from XDG profiles in `bin/benchling-webhook.ts` (CDK app entry)

**Implementation Complexity**: Low

### Section: CLI Implementation Changes (Lines 409-501)

**Assessment**: ✅ **Comprehensive**

#### 1. Deploy Command Changes (Lines 414-442)

**Proposed**:
```typescript
export async function deployCommand(options: {
    profile?: string;           // NEW
    environment?: "dev" | "prod";  // NEW
}): Promise<void>
```

**Assessment**:
- ✅ Clean parameter additions
- ✅ Profile resolution logic is clear
- ✅ Maps environment to profile correctly

**Implementation Complexity**: Low

#### 2. npm Script Updates (Lines 445-458)

**Proposed**:
```json
"deploy:dev": "ts-node bin/cli.ts deploy --environment dev --profile dev",
"deploy:prod": "ts-node bin/cli.ts deploy --environment prod --profile default",
```

**Current**:
```json
"deploy:dev": "npm run test && ts-node bin/dev-deploy.ts",
"deploy:prod": "ts-node bin/cli.ts deploy",
```

**Assessment**:
- ⚠️ Current `deploy:dev` uses separate script (`bin/dev-deploy.ts`)
- ✅ Consolidation to single deploy command is better
- ⚠️ Behavioral change: `deploy:dev` no longer runs tests first

**Gap Identified**:
- ⚠️ Current `dev-deploy.ts` has additional logic (test + build + deploy)
- **Recommendation**: Migrate useful logic from `dev-deploy.ts` to main deploy command
- **Alternative**: Keep `deploy:dev` as is, add new `deploy:dev-only` for direct deploy

#### 3. Profile Setup Command (Lines 460-501)

**Assessment**:
- ✅ New command is well-specified
- ✅ Interactive prompts are appropriate
- ✅ Secret naming is consistent

**Implementation Complexity**: Low

**Recommendation**: Add this to CLI command registry in [bin/cli.ts](../../bin/cli.ts)

### Section: Secrets Manager Strategy (Lines 503-535)

**Assessment**: ✅ **Well-Defined**

Secret naming convention:
```
quiltdata/benchling-webhook/<profile>/<tenant>
```

**Examples**:
- `quiltdata/benchling-webhook/default/my-company` → Production
- `quiltdata/benchling-webhook/dev/my-company` → Development

**Assessment**:
- ✅ Clear naming convention
- ✅ Profile-based separation
- ✅ Tenant suffix for multi-tenant support
- ✅ Secret structure is consistent across profiles

**Implementation Notes**:
1. Current secret generation in [lib/utils/secrets.ts](../../lib/utils/secrets.ts) (line 126 reference)
2. Needs update to use profile name instead of hardcoded "default"

**No gaps found**.

### Section: Migration Path (Lines 537-563)

**Assessment**: ✅ **Excellent Phased Approach**

Three non-breaking phases:
1. Add multi-stage support (both point to same backend initially)
2. Add profile support (optional)
3. Separate ECS services (full isolation)

**Assessment**:
- ✅ Backward compatible at each phase
- ✅ Existing deployments continue working
- ✅ Users can adopt incrementally

**Recommendation**: Phase 3 requires database migration for `deploy.json` structure - document this clearly.

### Section: Cost Analysis (Lines 565-589)

**Assessment**: ✅ **Realistic and Transparent**

Cost breakdown:
- Single environment: ~$70-100/month
- Dual environment: ~$85-145/month (+15-45%)

**Assessment**:
- ✅ Cost increase is modest (15-45%)
- ✅ Shared infrastructure minimizes costs
- ✅ Alternative (separate accounts) would be 2x cost

**No gaps found**.

### Section: Testing Strategy (Lines 591-637)

**Assessment**: ✅ **Already Mostly Implemented**

Test commands:
- `npm run test:dev` - ✅ Already exists
- `npm run test:prod` - ✅ Already exists

Makefile targets:
- `test-deployed-dev` - ✅ Already reads `.dev.endpoint`
- `test-deployed-prod` - ✅ Already reads `.prod.endpoint`

**Gap Identified**:
- ⚠️ `deploy.json` structure needs dev/prod sections populated
- ⚠️ Current deployment only writes to prod section (deploy.ts:355)

**Recommendation**: Update `storeDeploymentConfig()` calls to use correct environment parameter.

### Section: User Experience (Lines 639-675)

**Assessment**: ✅ **User-Centric Design**

Two personas:
1. **End Users**: Simple flow (setup → deploy:prod → test:prod)
2. **Maintainers**: Advanced flow (setup profiles → deploy both → test both)

**Assessment**:
- ✅ End users unaffected (no profile awareness needed)
- ✅ Maintainers get powerful multi-environment workflow
- ✅ Graceful degradation (dev profile is optional)

**Recommendation**: Update documentation to clarify these two workflows.

### Section: Security Considerations (Lines 677-699)

**Assessment**: ✅ **Thorough Security Analysis**

Benefits:
- ✅ Least privilege (separate IAM roles)
- ✅ Secret isolation (separate Secrets Manager secrets)
- ✅ Network isolation (separate target groups)
- ✅ Audit trail (separate CloudWatch logs)

Limitations:
- ⚠️ Same VPC (acceptable trade-off for cost)
- ⚠️ Same account (not as isolated as multi-account)
- ⚠️ Same cluster (metrics aggregated)

**Assessment**:
- ✅ Security trade-offs are clearly documented
- ✅ Recommendations are appropriate
- ✅ Multi-account option preserved for strict requirements

**No gaps found**.

### Section: Implementation Checklist (Lines 701-728)

**Assessment**: ✅ **Comprehensive and Actionable**

Four phases with clear tasks:
1. Multi-Stage API Gateway (4 tasks)
2. Profile System (4 tasks)
3. Multi-Service ECS (4 tasks)
4. Testing & Documentation (5 tasks)

**Assessment**:
- ✅ All major work items captured
- ✅ Logical ordering (infrastructure → config → services → tests)
- ✅ Documentation tasks included

**Recommendation**: Add task for updating error messages and validation.

---

## Gap Analysis Summary

### Critical Gaps: None ✅

The specification is complete and implementable.

### Minor Gaps Identified

1. **API Gateway Stage Routing** (Medium Priority)
   - **Location**: Line 89-100 (spec)
   - **Issue**: ALB routing logic not specified
   - **Recommendation**: Clarify whether ALB or API Gateway handles routing
   - **Proposed Solution**: API Gateway routes to ALB, ALB has single listener, target group selected by API Gateway stage

2. **Profile/Environment Validation** (Medium Priority)
   - **Location**: Line 169-200 (spec)
   - **Issue**: No validation for profile/environment mismatches
   - **Recommendation**: Add validation in deploy command
   - **Proposed Solution**:
     ```typescript
     if (options.environment === "prod" && options.profile === "dev") {
         throw new Error("Cannot deploy prod environment with dev profile");
     }
     ```

3. **Missing dev.json Handling** (Low Priority)
   - **Location**: Line 365-379 (spec)
   - **Issue**: No fallback if dev profile doesn't exist
   - **Recommendation**: Only deploy prod stage if devProfile is undefined
   - **Proposed Solution**: Already handled in spec (line 373-379)

4. **deploy:dev Script Migration** (Medium Priority)
   - **Location**: Line 451 (spec)
   - **Issue**: Current `deploy:dev` uses separate script with test + build logic
   - **Recommendation**: Migrate logic or document behavioral change
   - **Proposed Solution**: Keep current script, add `deploy:dev-only` for new flow

5. **deploy.json Environment Section** (High Priority)
   - **Location**: Line 355 (deploy.ts)
   - **Issue**: Currently hardcoded to write "prod" section only
   - **Recommendation**: Pass environment parameter to `storeDeploymentConfig()`
   - **Proposed Solution**:
     ```typescript
     // Determine environment from options
     const env = options.environment || "prod";
     storeDeploymentConfig(env, { ... });
     ```

### Enhancements Recommended

1. **Add Environment Variable for Stage** (Low Priority)
   - Add `STAGE` environment variable to containers
   - Useful for logging and debugging
   - Already specified in spec (line 298)

2. **Add Cost Allocation Tags** (Nice to Have)
   - Tag resources with environment (dev/prod)
   - Enables cost tracking per environment
   - Mentioned in success criteria (line 776)

3. **Auto-scaling Policy Differentiation** (Nice to Have)
   - Dev: 1-2 tasks
   - Prod: 2-10 tasks
   - Currently both are 2-10 (fargate-service.ts:456-459)

---

## Implementation Readiness Assessment

### Infrastructure (CDK)

| Component | Current State | Spec Requirements | Gap | Complexity |
| ----------- | -------------- | ------------------- | ----- | ------------ |
| API Gateway | Single stage ("prod") | Multiple stages (dev/prod) | Medium | Low |
| Fargate Service | Single service | Multiple services | High | Medium-High |
| ALB | Single listener | Stage-based routing | Medium | Low |
| Stack Props | Basic parameters | Profile-based props | Low | Low |

**Overall**: 🟡 Moderate refactoring required

### Configuration (XDG)

| Component | Current State | Spec Requirements | Gap | Complexity |
| ----------- | -------------- | ------------------- | ----- | ------------ |
| Profile System | ✅ Implemented | Profile read/write | None | None |
| Profile Listing | ✅ Implemented | List profiles | None | None |
| Profile Creation | ✅ Implemented | Setup command | Minor | Low |

**Overall**: 🟢 Ready to use (minor additions only)

### Deployment (CLI)

| Component | Current State | Spec Requirements | Gap | Complexity |
| ----------- | -------------- | ------------------- | ----- | ------------ |
| Deploy Command | No profile support | --profile, --environment | Medium | Low |
| npm Scripts | Separate scripts | Unified approach | Medium | Low |
| Deploy Config | Structure ready | Environment param | Low | Low |

**Overall**: 🟡 Moderate changes required

### Testing

| Component | Current State | Spec Requirements | Gap | Complexity |
| ----------- | -------------- | ------------------- | ----- | ------------ |
| Test Scripts | ✅ Both exist | dev/prod tests | None | None |
| Makefile | ✅ Both exist | dev/prod targets | None | None |
| Deploy.json | Structure ready | Populate both sections | Low | Low |

**Overall**: 🟢 Ready to use (minor updates only)

---

## Recommendations for Implementation

### Phase 1: Foundation (Estimated: 2-3 days)

1. **Update API Gateway Construct**
   - Refactor `AlbApiGateway` to support multiple stages
   - Add `environments` array parameter
   - Create stage → target group mapping
   - File: [lib/alb-api-gateway.ts](../../lib/alb-api-gateway.ts)

2. **Update Deployment Config Writer**
   - Add environment parameter to `storeDeploymentConfig()`
   - Update call sites to pass correct environment
   - File: [bin/commands/deploy.ts](../../bin/commands/deploy.ts#L355)

3. **Add Deploy Command Parameters**
   - Add `--profile` and `--environment` options
   - Add profile → environment mapping logic
   - Add validation for mismatches
   - File: [bin/commands/deploy.ts](../../bin/commands/deploy.ts#L91)

### Phase 2: Multi-Service Infrastructure (Estimated: 3-4 days)

4. **Refactor FargateService Construct**
   - Change from single service to multiple services
   - Accept `environments` array
   - Create separate task definitions and target groups
   - Update return types (service → services Map)
   - File: [lib/fargate-service.ts](../../lib/fargate-service.ts)
   - ⚠️ **Breaking change**: Requires stack update

5. **Update Stack Constructor**
   - Accept `devProfile` and `prodProfile` props
   - Pass environments array to FargateService
   - Wire API Gateway stages to target groups
   - File: [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts)

### Phase 3: CLI & Tooling (Estimated: 2 days)

6. **Add Profile Setup Command**
   - Implement `setup-profile` command
   - Add interactive prompts
   - Generate secret names correctly
   - File: New file `bin/commands/setup-profile.ts`

7. **Update npm Scripts**
   - Update `deploy:dev` to use new parameters
   - Ensure backward compatibility
   - Update documentation
   - File: [package.json](../../package.json)

### Phase 4: Testing & Documentation (Estimated: 2 days)

8. **Update Tests**
   - Add integration tests for multi-environment
   - Test profile switching
   - Test deployment isolation
   - Files: `test/**/*.test.ts`

9. **Update Documentation**
   - Update README.md with new workflow
   - Update CLAUDE.md with architecture changes
   - Add migration guide
   - Files: [README.md](../../README.md), [CLAUDE.md](../../CLAUDE.md)

### Total Estimated Effort: 9-11 days

---

## Risk Assessment

### High Risk Areas

1. **Fargate Service Refactoring** (Risk: Medium)
   - Large structural change (single → multiple services)
   - Requires stack update (potential downtime)
   - **Mitigation**: Test thoroughly in dev environment first

2. **Backward Compatibility** (Risk: Low)
   - Existing users should not be affected
   - Optional dev profile maintains compatibility
   - **Mitigation**: Add comprehensive migration testing

3. **Cost Implications** (Risk: Low)
   - 15-45% cost increase documented
   - Users may be surprised by cost increase
   - **Mitigation**: Document costs clearly in README

### Medium Risk Areas

4. **Profile/Environment Mismatch** (Risk: Medium)
   - Users might deploy wrong profile to wrong environment
   - Could result in incorrect configuration
   - **Mitigation**: Add validation and clear error messages

5. **Secret Management** (Risk: Low)
   - Multiple secrets to manage (dev/prod)
   - Could sync wrong secret to wrong environment
   - **Mitigation**: Use consistent naming convention

### Low Risk Areas

6. **API Gateway Routing** (Risk: Low)
   - Stage-based routing is standard pattern
   - Well-documented in AWS
   - **Mitigation**: None needed

---

## Validation Checklist

Before implementation, verify:

- [ ] XDG profile system supports all required operations
- [ ] Current deployment flow is fully understood
- [ ] Breaking changes are documented and communicated
- [ ] Rollback plan exists for each phase
- [ ] Cost increase is acceptable to stakeholders
- [ ] Test infrastructure can handle multiple environments
- [ ] Documentation is updated before release

---

## Conclusion

### Overall Assessment: ✅ **APPROVED FOR IMPLEMENTATION**

The specification is:
- ✅ Architecturally sound
- ✅ Well-documented with detailed examples
- ✅ Implementable with current codebase
- ✅ Backward compatible (with phased approach)
- ✅ Cost-effective (shared infrastructure)
- ✅ Secure (appropriate isolation)

### Minor Improvements Recommended

1. Add validation for profile/environment mismatches
2. Clarify ALB routing strategy (API Gateway stage → target group)
3. Update deployment config writer to accept environment parameter
4. Migrate or document behavioral change in `deploy:dev` script
5. Add error handling for missing profiles

### Next Steps

1. **Review this document** with team
2. **Prioritize phases** based on business needs
3. **Create implementation tasks** in issue tracker
4. **Begin Phase 1** (foundation work)
5. **Test in dev environment** before production rollout

---

## Appendix: File Change Summary

### Files to Create

1. `bin/commands/setup-profile.ts` - New profile setup command
2. `spec/176-test-prod/15-migration-guide.md` - User migration guide

### Files to Modify

1. **lib/alb-api-gateway.ts** (lines 8-87)
   - Add `environments` parameter
   - Create multiple stages
   - Return `stages` Map

2. **lib/fargate-service.ts** (lines 12-494)
   - Accept `environments` array
   - Create multiple services
   - Return `services` and `targetGroups` Maps

3. **lib/benchling-webhook-stack.ts** (lines 11-181)
   - Add `devProfile` and `prodProfile` props
   - Pass environments to constructs
   - Create outputs for all stages

4. **bin/commands/deploy.ts** (lines 91-174, 355)
   - Add `--profile` and `--environment` parameters
   - Read from XDG profiles
   - Pass environment to `storeDeploymentConfig()`

5. **bin/cli.ts**
   - Register `setup-profile` command

6. **package.json** (lines 21-22)
   - Update `deploy:dev` and `deploy:prod` scripts

7. **README.md**
   - Document multi-environment workflow
   - Add profile setup instructions

8. **CLAUDE.md**
   - Update architecture diagram
   - Update configuration section

---

## References

- Specification: [13-multi-environment-architecture-spec.md](./13-multi-environment-architecture-spec.md)
- Issue: [#176 - Test Production Deployments](https://github.com/quiltdata/benchling-webhook/issues/176)
- Current Version: v0.6.3
- XDG Config Implementation: [lib/xdg-config.ts](../../lib/xdg-config.ts)
- AWS CDK API Gateway Docs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway-readme.html
- AWS CDK ECS Docs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs-readme.html
