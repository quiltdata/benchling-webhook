# VPC Subnet Selection Fix: Explicit Subnet IDs

**Date:** 2025-12-01
**Status:** Proposed
**Category:** Infrastructure / VPC Configuration

---

## a) Symptom

**Users cannot reuse existing Quilt VPCs for Benchling webhook deployments.** The deployment always fails with:

```
Error: VPC (vpc-0123456789abcdef0) does not have private subnets.
The architecture requires private subnets with NAT Gateway for:
  - VPC Link to connect API Gateway to ECS tasks
  - ECS Fargate tasks with assignPublicIp: false
```

**Impact:**
- Users are forced to create a new VPC (~$32/month NAT Gateway cost)
- Cannot leverage existing Quilt VPC infrastructure
- Deployment friction and confusion

**Current Workaround:**
- Tell users to create a new VPC instead of reusing the Quilt VPC

---

## b) Analysis

### Root Cause: CDK's `Vpc.fromLookup()` Subnet Classification Failure

**Current Implementation ([lib/benchling-webhook-stack.ts:156-159](../lib/benchling-webhook-stack.ts#L156-L159)):**

```typescript
const vpc = config.deployment.vpc?.vpcId
    ? ec2.Vpc.fromLookup(this, "ExistingVPC", {
        vpcId: config.deployment.vpc.vpcId,
    })
    : new ec2.Vpc(this, "BenchlingWebhookVPC", { ... });
```

### Why `Vpc.fromLookup()` Fails

1. **CDK Heuristics are Brittle**
   - `Vpc.fromLookup()` runs at **synth time** (before deployment)
   - Uses heuristics to classify subnets as public/private
   - Looks for specific tags: `aws-cdk:subnet-type`, `aws-cdk:subnet-name`
   - Infers from route table patterns and naming conventions

2. **Quilt VPCs Don't Match CDK Expectations**
   - Created by Quilt stack (not CDK)
   - May use different subnet naming (e.g., "Application" vs "Private")
   - May lack CDK-specific tags
   - Route table analysis may misclassify subnets

3. **Silent Failure Mode**
   - Returns `vpc.privateSubnets = []` (empty array)
   - No warning or error during synth
   - Fails only at validation check: `if (vpc.privateSubnets.length === 0)`

### Evidence of the Problem

**VPC Discovery Works Correctly ([scripts/discover-vpc.ts:171-228](../scripts/discover-vpc.ts#L171-L228)):**

```typescript
// Step 5: Get route tables to determine subnet types
const routeTablesCmd = new DescribeRouteTablesCommand({ ... });
const routeTables = await ec2Client.send(routeTablesCmd);

// Build map of subnet -> NAT/IGW status
for (const routeTable of routeTables) {
    const hasIgw = routeTable.Routes?.some(r => r.GatewayId?.startsWith("igw-"));
    const hasNat = routeTable.Routes?.some(r => r.NatGatewayId?.startsWith("nat-"));

    for (const subnetId of subnetIds) {
        subnetRouteMap.set(subnetId, {
            isPublic: !!hasIgw,
            hasNatGateway: !!hasNat,
        });
    }
}

// Build discovered subnets with correct classification
const subnets: DiscoveredSubnet[] = ec2Subnets.map((subnet) => {
    const routeInfo = subnetRouteMap.get(subnetId) || { isPublic: false, hasNatGateway: false };
    return {
        subnetId,
        availabilityZone: subnet.AvailabilityZone || "",
        cidrBlock: subnet.CidrBlock || "",
        isPublic: routeInfo.isPublic,        // ✓ Correctly classified
        hasNatGateway: routeInfo.hasNatGateway,  // ✓ We know NAT status
    };
});
```

**The Problem:**
- VPC discovery **correctly** identifies private subnets by analyzing route tables
- Config stores only `vpcId` ([lib/types/config.ts:400-423](../lib/types/config.ts#L400-L423))
- CDK must re-discover and re-classify subnets using different heuristics
- CDK classification **fails** where our discovery succeeded

### Data Flow Comparison

**Current (Broken) Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│ VPC Discovery (scripts/discover-vpc.ts)                         │
│ - Queries EC2 API for subnets and route tables                 │
│ - Analyzes IGW/NAT routes to classify private/public           │
│ - Returns: vpcId, privateSubnets[] ✓                           │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Stores: { vpcId: "vpc-xxx" }  ❌ Lost subnet info!
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Config Storage (~/.config/benchling-webhook/profile/config.json)│
│ { deployment: { vpc: { vpcId: "vpc-xxx" } } }                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Passes: vpcId only
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ CDK Stack (lib/benchling-webhook-stack.ts)                      │
│ ec2.Vpc.fromLookup({ vpcId: "vpc-xxx" })                       │
│ - Re-discovers subnets using CDK heuristics                     │
│ - Fails to classify private subnets ❌                          │
│ - Returns: vpc.privateSubnets = []                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
               ❌ DEPLOYMENT FAILS
```

**Issue:** We throw away the subnet classification data we already have!

---

## c) Solution: Store and Use Explicit Subnet IDs

### Design: Use `Vpc.fromVpcAttributes()` with Explicit Subnets

**Proposed Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│ VPC Discovery (scripts/discover-vpc.ts)                         │
│ - Queries EC2 API for subnets and route tables                 │
│ - Analyzes IGW/NAT routes to classify private/public           │
│ - Returns: vpcId, privateSubnetIds[], availabilityZones[] ✓    │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Stores: { vpcId, privateSubnetIds[], azs[] } ✓
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Config Storage (~/.config/benchling-webhook/profile/config.json)│
│ { deployment: {                                                 │
│     vpc: {                                                      │
│       vpcId: "vpc-xxx",                                         │
│       privateSubnetIds: ["subnet-aaa", "subnet-bbb"],          │
│       availabilityZones: ["us-east-1a", "us-east-1b"]          │
│     }                                                           │
│ }}                                                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Passes: vpcId + explicit subnet IDs
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ CDK Stack (lib/benchling-webhook-stack.ts)                      │
│ ec2.Vpc.fromVpcAttributes({                                     │
│   vpcId: "vpc-xxx",                                             │
│   privateSubnetIds: ["subnet-aaa", "subnet-bbb"],              │
│   availabilityZones: ["us-east-1a", "us-east-1b"]              │
│ })                                                              │
│ - Uses EXACT subnets we discovered ✓                           │
│ - No heuristics, no re-classification needed                   │
│ - Returns: vpc.privateSubnets = [subnet-aaa, subnet-bbb] ✓     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
               ✓ DEPLOYMENT SUCCEEDS
```

### Implementation Changes

#### 1. Extend `VpcConfig` Type ([lib/types/config.ts](../lib/types/config.ts))

```typescript
export interface VpcConfig {
    /**
     * Existing VPC ID to use (optional)
     * @example "vpc-0123456789abcdef0"
     */
    vpcId?: string;

    /**
     * Private subnet IDs for ECS tasks and NLB
     * Required when vpcId is specified
     * Must have ≥2 subnets in different AZs
     *
     * Discovered by scripts/discover-vpc.ts during setup wizard.
     * Subnets are classified as private by analyzing route tables
     * for NAT Gateway routes (not IGW routes).
     *
     * @example ["subnet-0aaa", "subnet-0bbb"]
     */
    privateSubnetIds?: string[];

    /**
     * Public subnet IDs (optional)
     * Only needed if creating resources that require public subnets
     * @example ["subnet-0ccc", "subnet-0ddd"]
     */
    publicSubnetIds?: string[];

    /**
     * Availability zones for the subnets
     * Must match the order and count of privateSubnetIds
     * @example ["us-east-1a", "us-east-1b"]
     */
    availabilityZones?: string[];

    /**
     * Whether to create a new VPC if vpcId is not specified
     * @default true
     */
    createIfMissing?: boolean;
}
```

#### 2. Enhance `DiscoveredVpcInfo` ([lib/wizard/types.ts](../lib/wizard/types.ts))

```typescript
export interface DiscoveredVpcInfo {
    vpcId: string;
    name?: string;
    cidrBlock: string;
    privateSubnetCount: number;
    availabilityZoneCount: number;
    isValid: boolean;
    validationErrors: string[];

    // NEW: Actual subnet IDs and AZs for CDK
    privateSubnetIds: string[];
    publicSubnetIds: string[];
    availabilityZones: string[];
}
```

#### 3. Extract Subnet IDs in Phase 2 ([lib/wizard/phase2-stack-query.ts](../lib/wizard/phase2-stack-query.ts))

```typescript
// Current (lines 139-179):
const discoveredVpc = await discoverVpcFromStack({ stackArn, region });
if (discoveredVpc) {
    const privateSubnets = discoveredVpc.subnets.filter((s) => !s.isPublic);
    const azs = new Set(privateSubnets.map((s) => s.availabilityZone));

    discoveredVpcInfo = {
        vpcId: discoveredVpc.vpcId,
        name: discoveredVpc.name,
        cidrBlock: discoveredVpc.cidrBlock,
        privateSubnetCount: privateSubnets.length,
        availabilityZoneCount: azs.size,
        isValid: discoveredVpc.isValid,
        validationErrors: discoveredVpc.validationErrors,
    };
}

// Enhanced (add subnet IDs):
const discoveredVpc = await discoverVpcFromStack({ stackArn, region });
if (discoveredVpc) {
    const privateSubnets = discoveredVpc.subnets.filter((s) => !s.isPublic);
    const publicSubnets = discoveredVpc.subnets.filter((s) => s.isPublic);
    const azs = new Set(privateSubnets.map((s) => s.availabilityZone));

    discoveredVpcInfo = {
        vpcId: discoveredVpc.vpcId,
        name: discoveredVpc.name,
        cidrBlock: discoveredVpc.cidrBlock,
        privateSubnetCount: privateSubnets.length,
        availabilityZoneCount: azs.size,
        isValid: discoveredVpc.isValid,
        validationErrors: discoveredVpc.validationErrors,

        // NEW: Include actual subnet IDs for CDK
        privateSubnetIds: privateSubnets.map(s => s.subnetId),
        publicSubnetIds: publicSubnets.map(s => s.subnetId),
        availabilityZones: Array.from(azs),
    };
}
```

#### 4. Store Subnet IDs in Config (Wizard Phases)

When saving VPC configuration to profile:

```typescript
config.deployment.vpc = {
    vpcId: discoveredVpcInfo.vpcId,
    privateSubnetIds: discoveredVpcInfo.privateSubnetIds,
    publicSubnetIds: discoveredVpcInfo.publicSubnetIds,
    availabilityZones: discoveredVpcInfo.availabilityZones,
};
```

#### 5. Replace `Vpc.fromLookup()` with `Vpc.fromVpcAttributes()` ([lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts))

```typescript
// Current (lines 156-175):
const vpc = config.deployment.vpc?.vpcId
    ? ec2.Vpc.fromLookup(this, "ExistingVPC", {
        vpcId: config.deployment.vpc.vpcId,
    })
    : new ec2.Vpc(this, "BenchlingWebhookVPC", { ... });

// Enhanced (use explicit subnets):
const vpc = config.deployment.vpc?.vpcId
    ? ec2.Vpc.fromVpcAttributes(this, "ExistingVPC", {
        vpcId: config.deployment.vpc.vpcId,
        availabilityZones: config.deployment.vpc.availabilityZones || [],
        privateSubnetIds: config.deployment.vpc.privateSubnetIds || [],
        publicSubnetIds: config.deployment.vpc.publicSubnetIds,  // Optional
    })
    : new ec2.Vpc(this, "BenchlingWebhookVPC", { ... });
```

**Key Benefits of `fromVpcAttributes()`:**
- Uses **explicit subnet IDs** - no inference or heuristics
- Works at synth time (no runtime AWS API calls needed)
- Guaranteed to match what VPC discovery found
- No dependency on subnet tags or naming conventions
- Standard CDK pattern for existing infrastructure

#### 6. Enhanced Validation ([lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts))

```typescript
// Validate VPC configuration
if (config.deployment.vpc?.vpcId) {
    // Using explicit VPC config - validate we have subnet IDs
    const privateSubnetIds = config.deployment.vpc.privateSubnetIds || [];
    const azs = config.deployment.vpc.availabilityZones || [];

    if (privateSubnetIds.length < 2) {
        throw new Error(
            `VPC (${config.deployment.vpc.vpcId}) configuration is invalid.\n` +
            `Found ${privateSubnetIds.length} private subnet(s), need ≥2.\n\n` +
            `This usually means:\n` +
            `  1. VPC discovery failed during setup wizard\n` +
            `  2. Configuration was manually edited and is incomplete\n` +
            `  3. You're using an old config format (pre-v1.0)\n\n` +
            `Solution: Re-run setup wizard to re-discover VPC resources:\n` +
            `  npm run setup\n\n` +
            `Or create a new VPC by removing vpc.vpcId from config.`
        );
    }

    if (azs.length < 2) {
        throw new Error(
            `VPC (${config.deployment.vpc.vpcId}) subnets must span ≥2 availability zones.\n` +
            `Found ${azs.length} AZ(s).\n\n` +
            `Solution: Re-run setup wizard or create a new VPC.`
        );
    }

    console.log(`Using existing VPC: ${config.deployment.vpc.vpcId}`);
    console.log(`  Private subnets: ${privateSubnetIds.join(", ")}`);
    console.log(`  Availability zones: ${azs.join(", ")}`);
} else {
    // Creating new VPC - no validation needed
    console.log("Creating new VPC with private subnets and NAT Gateway");
}

// Double-check after VPC construction (should never fail)
if (vpc.privateSubnets.length === 0) {
    throw new Error(
        `Internal error: VPC has no private subnets. ` +
        `This should never happen - please report as a bug.`
    );
}
```

### Backward Compatibility

**Existing configs without subnet IDs:**
```json
{
  "deployment": {
    "vpc": {
      "vpcId": "vpc-0123456789abcdef0"
    }
  }
}
```

**Handling:**
1. Stack detects missing `privateSubnetIds` field
2. Throws clear error: "VPC configuration invalid. Re-run setup wizard."
3. User runs `npm run setup`
4. Wizard re-discovers VPC and adds subnet IDs:

```json
{
  "deployment": {
    "vpc": {
      "vpcId": "vpc-0123456789abcdef0",
      "privateSubnetIds": ["subnet-aaa", "subnet-bbb"],
      "availabilityZones": ["us-east-1a", "us-east-1b"]
    }
  }
}
```

**New installations:**
- Wizard always populates subnet IDs
- Works immediately with existing VPCs
- No manual intervention needed

---

## d) Alternatives Considered

### Alternative 1: Tag Quilt VPC Subnets

**Approach:** Add `aws-cdk:subnet-type` tags to Quilt VPC subnets so `Vpc.fromLookup()` can classify them.

**Why Rejected:**
- ❌ Requires modifying Quilt CloudFormation stack (not under our control)
- ❌ Users may not have IAM permissions to add tags
- ❌ Fragile - depends on external infrastructure staying tagged
- ❌ Doesn't help with other third-party VPCs
- ❌ Still requires heuristics - not guaranteed to work

### Alternative 2: Improve CDK Heuristics

**Approach:** Contribute to AWS CDK to improve `Vpc.fromLookup()` subnet classification.

**Why Rejected:**
- ❌ Can't modify CDK behavior in our timeframe
- ❌ Heuristics will always be unreliable for arbitrary third-party VPCs
- ❌ Would only help future CDK versions
- ❌ Still wouldn't work for current CDK users

### Alternative 3: Dynamic VPC Lookup at Deploy Time

**Approach:** Query AWS API during CDK deployment to discover subnets.

**Why Rejected:**
- ❌ CDK VPC operations must happen at synth time (not deploy time)
- ❌ Would require custom CloudFormation resources
- ❌ Adds deployment complexity and failure modes
- ❌ Slower deployments due to runtime API calls

### Alternative 4: Always Create New VPC

**Approach:** Never reuse Quilt VPC - always create a dedicated VPC.

**Why Rejected:**
- ❌ Adds ~$32/month NAT Gateway cost per deployment
- ❌ Creates VPC sprawl (unnecessary resource duplication)
- ❌ Users specifically want to reuse existing infrastructure
- ❌ Doesn't solve the root problem

### Alternative 5: Use VPC Peering

**Approach:** Create new VPC and peer with Quilt VPC.

**Why Rejected:**
- ❌ Adds complexity (peering connections, route tables)
- ❌ Still requires new VPC (~$32/month NAT cost)
- ❌ Additional latency for inter-VPC communication
- ❌ More moving parts = more failure modes

---

## Why Explicit Subnet IDs is Best

✅ **Zero Ambiguity** - Uses exactly the subnets we discovered via route table analysis
✅ **No Dependencies** - Works regardless of VPC tags or naming conventions
✅ **Standard Pattern** - `Vpc.fromVpcAttributes()` is the recommended CDK approach for existing infrastructure
✅ **Works with Any VPC** - Not specific to Quilt VPCs
✅ **Simple** - No heuristics, no inference, no guessing
✅ **Reliable** - Same classification logic from discovery to deployment
✅ **Fast** - No runtime AWS API calls needed
✅ **Backward Compatible** - Old configs get clear error message to re-run setup

---

## Implementation Checklist

- [ ] Update `VpcConfig` interface in [lib/types/config.ts](../lib/types/config.ts)
- [ ] Update `DiscoveredVpcInfo` interface in [lib/wizard/types.ts](../lib/wizard/types.ts)
- [ ] Modify [lib/wizard/phase2-stack-query.ts](../lib/wizard/phase2-stack-query.ts) to extract subnet IDs
- [ ] Update wizard phases to store subnet IDs in config
- [ ] Replace `Vpc.fromLookup()` with `Vpc.fromVpcAttributes()` in [lib/benchling-webhook-stack.ts](../lib/benchling-webhook-stack.ts)
- [ ] Add validation for missing subnet IDs with helpful error messages
- [ ] Test with existing Quilt VPC (the currently failing case)
- [ ] Test with new VPC creation
- [ ] Test backward compatibility (configs without subnet IDs)
- [ ] Update documentation and error messages
- [ ] Add integration test for VPC reuse

---

## Expected Outcome

After implementation:

1. **VPC Discovery** → Correctly identifies private subnets via route table analysis ✓ (already works)
2. **Config Storage** → Stores `vpcId` + `privateSubnetIds` + `availabilityZones` ✓ (new)
3. **CDK Deployment** → Uses explicit subnet IDs via `fromVpcAttributes()` ✓ (new)
4. **Result** → ECS and NLB deploy to correct private subnets ✓ (currently fails)

**User Experience:**
- Run `npm run setup` → VPC discovered with subnet IDs
- Run `npm run deploy:dev` → Deployment succeeds using Quilt VPC
- No manual subnet configuration needed
- Clear error messages if config is incomplete

**Cost Savings:**
- Eliminates need for separate VPC (~$32/month per deployment)
- Users can deploy multiple stages (dev/prod) in same VPC if desired
