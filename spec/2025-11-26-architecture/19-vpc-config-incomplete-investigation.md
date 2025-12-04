# VPC Configuration Investigation - Incomplete Config Issue

**Date:** 2025-12-02
**Issue:** Benchling webhook stack works with auto-generated VPC but not with Quilt stack VPC
**Status:** Root cause identified - Incomplete VPC configuration in config file

---

## Problem Statement

The current deployment uses an auto-generated VPC and works correctly. However, when attempting to use the Quilt stack's pre-existing VPC (`vpc-010008ef3cce35c0c`), the deployment fails or doesn't use the intended VPC.

---

## Investigation Findings

### Current Working Stack (Auto-Generated VPC)

**VPC Details:**
- VPC ID: `vpc-0f4b635e51b2d5b41`
- Name: `BenchlingWebhookStack/BenchlingWebhookVPC`
- CIDR: `10.0.0.0/16`
- Created: 2025-12-02

**Subnets:**
- Private Subnet 1: `subnet-0f85ebe1500defc78` (us-east-1a, 10.0.2.0/24)
- Private Subnet 2: `subnet-0ea5afdf42791d1df` (us-east-1b, 10.0.3.0/24)

**Routing:**
- Private subnets have NAT Gateway routes: 0.0.0.0/0 → NAT Gateway
- NAT Gateways: 2 (1 per AZ for high availability)

**Status:** ✅ Working correctly - ECS tasks running, API Gateway accessible, webhooks processing

### Quilt Stack VPC (Intended but Not Used)

**VPC Details:**
- VPC ID: `vpc-010008ef3cce35c0c`
- Name: `quilt-staging`
- CIDR: `10.0.0.0/16`
- From: Quilt CloudFormation stack

**Subnets:**
```
Private Subnets:
- subnet-09d384be5cc82f4a3 (us-east-1a, 10.0.0.0/18)   - quilt-staging-private-us-east-1a
- subnet-0c4d8951561fb21ea (us-east-1b, 10.0.128.0/18) - quilt-staging-private-us-east-1b

Public Subnets:
- subnet-0f667dc82fa781381 (us-east-1a, 10.0.64.0/19)  - quilt-staging-public-us-east-1a
- subnet-0e5edea8f1785e300 (us-east-1b, 10.0.192.0/19) - quilt-staging-public-us-east-1b

Intra Subnets:
- subnet-0eafcb74ad4785e1f (us-east-1a, 10.0.96.0/20)  - quilt-staging-intra-us-east-1a
- subnet-0feb0beb00f4f7a8c (us-east-1b, 10.0.224.0/20) - quilt-staging-intra-us-east-1b
```

**NAT Gateways:**
- `nat-0cbd29a1ccb8bf563` in subnet-0f667dc82fa781381 (us-east-1a public) - Available
- `nat-0e6a2ecfd65d28416` in subnet-0e5edea8f1785e300 (us-east-1b public) - Available

**Route Tables:**
```
Private subnet routing (BOTH AZs):
- 10.0.0.0/16 → local
- 0.0.0.0/0 → NAT Gateway (correctly configured!)
- ::/0 → Egress-only IGW
- pl-63a5400a (S3 prefix list) → vpce-082b8e6f426710e5c (S3 Gateway Endpoint)
```

**VPC Endpoints:**
- S3 Gateway Endpoint: `vpce-082b8e6f426710e5c` (available)

**Status:** ✅ Infrastructure is VALID - Has proper NAT Gateway routing, private subnets, and internet connectivity

---

## Root Cause: Incomplete Configuration

### Current Config File

`~/.config/benchling-webhook/default/config.json` contains:

```json
{
  "deployment": {
    "region": "us-east-1",
    "account": "712023778557",
    "vpc": {
      "vpcId": "vpc-010008ef3cce35c0c"
    }
  }
}
```

**Problem:** The VPC configuration is incomplete. It only has `vpcId` without:
- `privateSubnetIds` (required - minimum 2)
- `availabilityZones` (required - minimum 2)
- `vpcCidrBlock` (optional but helpful)
- `publicSubnetIds` (optional)

### Why Deployment Succeeded with Auto-Generated VPC

Looking at [lib/benchling-webhook-stack.ts:192-215](../lib/benchling-webhook-stack.ts):

```typescript
const vpc = config.deployment.vpc?.vpcId
    ? ec2.Vpc.fromVpcAttributes(this, "ExistingVPC", {
        vpcId: config.deployment.vpc.vpcId,
        availabilityZones: config.deployment.vpc.availabilityZones || [],  // EMPTY!
        privateSubnetIds: config.deployment.vpc.privateSubnetIds || [],    // EMPTY!
        publicSubnetIds: config.deployment.vpc.publicSubnetIds || [],
        vpcCidrBlock: config.deployment.vpc.vpcCidrBlock,
    })
    : new ec2.Vpc(this, "BenchlingWebhookVPC", { ... })
```

**Theory:** When `ec2.Vpc.fromVpcAttributes()` is called with empty subnet arrays, CDK may:
1. Fail validation at line 158-175 (should throw error if privateSubnetIds.length < 2)
2. The error WAS thrown, causing deployment to fall back or fail
3. User then removed the incomplete VPC config, allowing auto-generated VPC to work

**Evidence:** The working stack is deployed in `vpc-0f4b635e51b2d5b41` (auto-generated), NOT `vpc-010008ef3cce35c0c` (Quilt VPC).

### Why VPC Discovery Didn't Work

The codebase has `scripts/discover-vpc.ts` which can automatically discover VPC resources from a Quilt CloudFormation stack. However, this module is not integrated into the setup wizard.

**Current behavior:** Setup wizard writes only `vpcId` without calling VPC discovery

**Expected behavior:** Setup wizard should call `discoverVpcFromStack()` to populate complete VPC configuration

---

## Solutions

### Option 1: Quick Fix - Manual Config Completion ⚡

**Time:** < 1 minute
**Complexity:** Low
**Permanence:** Temporary workaround

Update `~/.config/benchling-webhook/default/config.json`:

```json
{
  "deployment": {
    "region": "us-east-1",
    "account": "712023778557",
    "vpc": {
      "vpcId": "vpc-010008ef3cce35c0c",
      "vpcCidrBlock": "10.0.0.0/16",
      "availabilityZones": ["us-east-1a", "us-east-1b"],
      "privateSubnetIds": [
        "subnet-09d384be5cc82f4a3",
        "subnet-0c4d8951561fb21ea"
      ],
      "publicSubnetIds": [
        "subnet-0f667dc82fa781381",
        "subnet-0e5edea8f1785e300"
      ]
    }
  }
}
```

**Testing:**
```bash
npm run deploy:dev -- --profile default --yes
```

**Pros:**
- Immediate fix
- Uses shared Quilt infrastructure
- No NAT Gateway cost duplication

**Cons:**
- Manual process, error-prone
- Doesn't fix root cause

---

### Option 2: Integrate VPC Discovery (Recommended) ✅

**Time:** 1-2 hours development
**Complexity:** Medium
**Permanence:** Fixes root cause

**Files to modify:**
1. `scripts/config/wizard.ts` or `scripts/install-wizard.ts`

**Implementation:**

```typescript
import { discoverVpcFromStack, DiscoveredVpc } from './discover-vpc';

// After getting Quilt stack ARN
if (quiltStackArn) {
    console.log("Discovering VPC from Quilt stack...");
    const discoveredVpc = await discoverVpcFromStack({
        stackArn: quiltStackArn,
        region: config.deployment.region,
    });

    if (discoveredVpc && discoveredVpc.isValid) {
        console.log(`✅ Found VPC: ${discoveredVpc.vpcId} (${discoveredVpc.name})`);
        console.log(`   Private subnets: ${discoveredVpc.subnets.filter(s => !s.isPublic).length}`);
        console.log(`   NAT Gateway: ${discoveredVpc.subnets.some(s => s.hasNatGateway) ? 'Yes' : 'No'}`);

        const useQuiltVpc = await confirm({
            message: "Use this VPC for webhook deployment?",
            default: true,
        });

        if (useQuiltVpc) {
            config.deployment.vpc = buildVpcConfig(discoveredVpc);
        }
    } else {
        console.warn("⚠️  Could not discover valid VPC from Quilt stack");
        if (discoveredVpc) {
            discoveredVpc.validationErrors.forEach(err => console.log(`   - ${err}`));
        }
        // Fall through to auto-generated VPC
    }
}

function buildVpcConfig(vpc: DiscoveredVpc): VpcConfig {
    const privateSubnets = vpc.subnets.filter(s => !s.isPublic);
    const publicSubnets = vpc.subnets.filter(s => s.isPublic);

    return {
        vpcId: vpc.vpcId,
        vpcCidrBlock: vpc.cidrBlock,
        availabilityZones: Array.from(new Set(privateSubnets.map(s => s.availabilityZone))),
        privateSubnetIds: privateSubnets.map(s => s.subnetId),
        publicSubnetIds: publicSubnets.map(s => s.subnetId),
    };
}
```

**Pros:**
- Fixes root cause permanently
- Fully automated
- Validates VPC before using it
- Better user experience

**Cons:**
- Requires development time
- Needs testing of wizard flow

---

### Option 3: Remove VPC Config (Simplest) 🧹

**Time:** < 10 seconds
**Complexity:** Trivial
**Permanence:** Keeps status quo

Remove the `vpc` section from `~/.config/benchling-webhook/default/config.json`:

```json
{
  "deployment": {
    "region": "us-east-1",
    "account": "712023778557"
    // Remove vpc section entirely
  }
}
```

**Pros:**
- Simplest solution
- Stack proven working with auto-generated VPC
- No VPC discovery needed

**Cons:**
- Duplicate NAT Gateway costs (~$32.40/month extra)
- Not using shared Quilt infrastructure
- Two separate VPCs to manage

---

## Cost Comparison

| Approach | NAT Gateway Cost/Month | Savings vs Auto-Gen |
|----------|----------------------|---------------------|
| Option 1: Use Quilt VPC | $32.40 | $32.40 |
| Option 2: Use Quilt VPC | $32.40 | $32.40 |
| Option 3: Auto-generated VPC | $64.80 | $0.00 |

**Total monthly savings by sharing Quilt VPC:** $32.40

---

## Recommendation

**Immediate action:** Use **Option 1** (manual config completion) to unblock deployment with Quilt VPC

**Long-term fix:** Implement **Option 2** (integrate VPC discovery into setup wizard)

**Acceptable alternative:** Use **Option 3** if cost is not a concern and separate VPCs are preferred

---

## Testing Checklist

After implementing chosen option:

- [ ] Deployment succeeds without errors
- [ ] ECS tasks start in correct private subnets (verify via AWS Console)
- [ ] ECS tasks can reach internet via NAT Gateway (check application logs for AWS API calls)
- [ ] Network Load Balancer can reach ECS tasks (verify health checks)
- [ ] API Gateway can reach NLB via VPC Link (test via endpoint)
- [ ] Webhook requests work end-to-end (test with Benchling webhook)
- [ ] CloudWatch logs show no network errors

---

## Related Specifications

- [06-vpc-discovery-spec.md](./06-vpc-discovery-spec.md) - Original VPC discovery specification
- [14-vpc-subnet-selection-fix.md](./14-vpc-subnet-selection-fix.md) - Previous VPC subnet issues
- [12-rest-nlb.md](./12-rest-nlb.md) - REST API v1 + NLB architecture

---

## Conclusion

The Quilt VPC is correctly configured with proper NAT Gateway routing and internet connectivity. The issue had two parts:

1. **Initial issue**: The setup wizard wasn't being used, so incomplete VPC configuration was manually written
2. **Root cause**: The VPC discovery code incorrectly selected "intra" subnets (isolated, no internet) instead of "private" subnets (with NAT Gateway)

## Fix Applied

Updated VPC discovery logic in two files:

1. **[lib/wizard/phase2-stack-query.ts:151](../lib/wizard/phase2-stack-query.ts#L151)**
   - Changed: `filter((s) => !s.isPublic)`
   - To: `filter((s) => !s.isPublic && s.hasNatGateway)`
   - This ensures only private subnets WITH NAT Gateway are selected (excludes intra subnets)

2. **[scripts/discover-vpc.ts:281](../scripts/discover-vpc.ts#L281)**
   - Updated validation to explicitly check for NAT Gateway presence
   - Added helpful error messages that distinguish between private and intra subnets
   - Now warns if intra subnets are found but can't be used

The VPC infrastructure is ready to use, and the setup wizard will now correctly discover and configure the proper subnet IDs.
