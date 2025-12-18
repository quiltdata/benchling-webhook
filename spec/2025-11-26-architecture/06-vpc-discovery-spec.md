# VPC Discovery and Configuration Specification

**Status**: Draft
**Date**: 2025-11-26
**Related**: [04-arch-reqs.md](04-arch-reqs.md), [lib/benchling-webhook-stack.ts:150-193](../../lib/benchling-webhook-stack.ts#L150-L193)

## Overview

This specification defines how the setup wizard discovers VPC resources from the Quilt stack and prompts users to either reuse existing VPC resources or auto-create new ones. This enables seamless integration with existing Quilt infrastructure while maintaining the flexibility to deploy standalone.

## Background

### Current State (v0.9.0)

The current architecture supports two VPC deployment modes:

1. **Auto-create VPC** (default): Creates a new VPC with:
   - 2 Availability Zones
   - Public subnets (for NAT Gateways)
   - Private subnets with NAT Gateway (for ECS tasks)
   - 2 NAT Gateways (1 per AZ for HA)

2. **Use existing VPC**: Requires `config.deployment.vpc.vpcId` to be set manually

```typescript
// Current implementation (lib/benchling-webhook-stack.ts:154-173)
const vpc = config.deployment.vpc?.vpcId
    ? ec2.Vpc.fromLookup(this, "ExistingVPC", {
        vpcId: config.deployment.vpc.vpcId,
    })
    : new ec2.Vpc(this, "BenchlingWebhookVPC", {
        maxAzs: 2,
        natGateways: 2,
        // ... subnet configuration
    });
```

### Problem

Users must manually discover and configure VPC IDs from their Quilt stack, which is error-prone and requires AWS CLI knowledge. The setup wizard should automate this discovery and present users with clear options.

## Requirements

### Functional Requirements

1. **VPC Discovery**: Setup wizard must discover VPC resources from the Quilt CloudFormation stack
2. **Interactive Prompts**: Present discovered resources to users with clear descriptions
3. **Validation**: Verify that selected VPCs meet architecture requirements (private subnets, NAT Gateway)
4. **Fallback**: Support auto-creation when no suitable VPC is found or user declines existing resources
5. **Configuration Storage**: Store VPC selection in profile config for deployment

### Non-Functional Requirements

1. **Performance**: VPC discovery should complete within 5 seconds
2. **Reliability**: Handle missing resources gracefully (stack may not have VPC)
3. **Usability**: Clear prompts with resource IDs, names, and subnet counts
4. **Idempotency**: Re-running setup should show currently configured VPC as default

## Architecture

### VPC Discovery Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User provides Quilt Stack ARN                                │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Query CloudFormation Stack Resources                         │
│    - DescribeStackResources (VPC, Subnets, Security Groups)     │
│    - DescribeStacks (Outputs for validation)                    │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Enrich VPC Metadata via EC2 API                              │
│    - DescribeVpcs (CIDR, Tags, Name)                            │
│    - DescribeSubnets (Type, AZ, CIDR, Route Tables)             │
│    - DescribeRouteTables (NAT Gateway presence)                 │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Validate VPC Suitability                                     │
│    ✓ Has private subnets (≥2 AZs)                               │
│    ✓ Has NAT Gateway(s) for outbound access                     │
│    ✓ Has security groups (ElbTargetSecurityGroup)               │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Prompt User                                                  │
│    Option 1: Use discovered VPC (vpc-xxxxx - 4 subnets)         │
│    Option 2: Create new VPC (recommended for isolation)         │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Store Selection in Profile Config                            │
│    config.deployment.vpc.vpcId = "vpc-xxxxx" | undefined        │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Input: Quilt Stack ARN
```
arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/...
```

#### Output: VPC Configuration
```typescript
interface DiscoveredVpc {
    vpcId: string;                    // vpc-0d8b7e50c0bb25d97
    name?: string;                    // "quilt-staging-VPC"
    cidrBlock: string;                // "10.0.0.0/16"
    region: string;                   // "us-east-1"
    subnets: DiscoveredSubnet[];
    securityGroups: string[];         // [sg-xxx, sg-yyy]
    isValid: boolean;                 // meets architecture requirements
    validationErrors: string[];       // ["No private subnets found"]
}

interface DiscoveredSubnet {
    subnetId: string;                 // subnet-xxxxx
    availabilityZone: string;         // us-east-1a
    cidrBlock: string;                // 10.0.1.0/24
    isPublic: boolean;                // false
    hasNatGateway: boolean;           // true
    name?: string;                    // "quilt-staging-PrivateSubnet1"
}
```

## Implementation Plan

### Phase 1: VPC Discovery Module

**File**: `scripts/discover-vpc.ts`

```typescript
import { CloudFormationClient, DescribeStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand } from "@aws-sdk/client-ec2";

export interface VpcDiscoveryOptions {
    stackArn: string;
    region: string;
}

export interface DiscoveredVpc {
    vpcId: string;
    name?: string;
    cidrBlock: string;
    region: string;
    subnets: DiscoveredSubnet[];
    securityGroups: string[];
    isValid: boolean;
    validationErrors: string[];
}

export interface DiscoveredSubnet {
    subnetId: string;
    availabilityZone: string;
    cidrBlock: string;
    isPublic: boolean;
    hasNatGateway: boolean;
    name?: string;
}

/**
 * Discover VPC resources from Quilt CloudFormation stack
 */
export async function discoverVpcFromStack(
    options: VpcDiscoveryOptions
): Promise<DiscoveredVpc | null> {
    // 1. Query CloudFormation for VPC resources
    // 2. Enrich with EC2 metadata
    // 3. Validate architecture requirements
    // 4. Return discovered VPC or null
}

/**
 * Validate VPC meets architecture requirements
 */
function validateVpc(vpc: DiscoveredVpc): void {
    // Check private subnets (≥2 AZs)
    // Check NAT Gateway presence
    // Set vpc.isValid and vpc.validationErrors
}
```

**AWS API Calls**:

1. `CloudFormation.DescribeStackResources` - Get VPC ID from stack
   ```bash
   aws cloudformation describe-stack-resources \
     --stack-name quilt-staging \
     --region us-east-1 \
     --query 'StackResources[?ResourceType==`AWS::EC2::VPC`]'
   ```

2. `EC2.DescribeVpcs` - Get VPC metadata (CIDR, tags, name)
   ```bash
   aws ec2 describe-vpcs \
     --vpc-ids vpc-xxxxx \
     --region us-east-1
   ```

3. `EC2.DescribeSubnets` - Get subnet details
   ```bash
   aws ec2 describe-subnets \
     --filters "Name=vpc-id,Values=vpc-xxxxx" \
     --region us-east-1
   ```

4. `EC2.DescribeRouteTables` - Verify NAT Gateway presence
   ```bash
   aws ec2 describe-route-tables \
     --filters "Name=vpc-id,Values=vpc-xxxxx" \
     --query 'RouteTables[].Routes[?NatGatewayId!=null]'
   ```

### Phase 2: Setup Wizard Integration

**File**: `scripts/install-wizard.ts` (modifications)

```typescript
import { discoverVpcFromStack } from "./discover-vpc";

async function promptForVpcConfiguration(
    stackArn: string,
    region: string,
    existingVpcId?: string
): Promise<string | undefined> {
    console.log("\n🔍 Discovering VPC resources from Quilt stack...");

    const discoveredVpc = await discoverVpcFromStack({ stackArn, region });

    if (!discoveredVpc) {
        console.log("ℹ️  No VPC found in Quilt stack. A new VPC will be created.");
        return undefined;
    }

    // Validate VPC
    if (!discoveredVpc.isValid) {
        console.log(`⚠️  Discovered VPC (${discoveredVpc.vpcId}) does not meet requirements:`);
        discoveredVpc.validationErrors.forEach(err => console.log(`   - ${err}`));
        console.log("ℹ️  A new VPC will be created instead.");
        return undefined;
    }

    // Present options to user
    const choices = [
        {
            title: `Use existing VPC (${discoveredVpc.vpcId})`,
            value: discoveredVpc.vpcId,
            description: `${discoveredVpc.name || 'Unnamed VPC'} - ${discoveredVpc.subnets.length} subnets in ${new Set(discoveredVpc.subnets.map(s => s.availabilityZone)).size} AZs`
        },
        {
            title: "Create new VPC (recommended for isolation)",
            value: undefined,
            description: "Auto-create VPC with 2 AZs, private subnets, and NAT Gateways"
        }
    ];

    const response = await prompts({
        type: "select",
        name: "vpcId",
        message: "VPC Configuration",
        choices,
        initial: existingVpcId === discoveredVpc.vpcId ? 0 : 1
    });

    return response.vpcId;
}
```

### Phase 3: Configuration Storage

**Profile Config Update**:

```typescript
// ~/.config/benchling-webhook/{profile}/config.json
{
    "deployment": {
        "region": "us-east-1",
        "vpc": {
            "vpcId": "vpc-0d8b7e50c0bb25d97"  // or undefined for auto-create
        }
    }
}
```

## User Experience

### Scenario 1: VPC Found and Valid

```
🔍 Discovering VPC resources from Quilt stack...
✓ Found VPC: vpc-0d8b7e50c0bb25d97 (quilt-staging-VPC)
  - CIDR: 10.0.0.0/16
  - Subnets: 6 subnets across 2 AZs
  - Private subnets: 2 (with NAT Gateway)
  - Security groups: 3

? VPC Configuration
  ❯ Use existing VPC (vpc-0d8b7e50c0bb25d97)
    quilt-staging-VPC - 6 subnets in 2 AZs

  ○ Create new VPC (recommended for isolation)
    Auto-create VPC with 2 AZs, private subnets, and NAT Gateways
```

### Scenario 2: VPC Found but Invalid

```
🔍 Discovering VPC resources from Quilt stack...
✓ Found VPC: vpc-xxxxx (quilt-dev-VPC)
⚠️  Discovered VPC (vpc-xxxxx) does not meet requirements:
   - No private subnets found
   - NAT Gateway not configured

ℹ️  A new VPC will be created with the required configuration.
```

### Scenario 3: No VPC in Stack

```
🔍 Discovering VPC resources from Quilt stack...
ℹ️  No VPC found in Quilt stack. A new VPC will be created.
```

### Scenario 4: Re-running Setup (Idempotent)

```
🔍 Discovering VPC resources from Quilt stack...
✓ Found VPC: vpc-0d8b7e50c0bb25d97 (quilt-staging-VPC)

? VPC Configuration (currently: vpc-0d8b7e50c0bb25d97)
  ❯ Use existing VPC (vpc-0d8b7e50c0bb25d97)  [Current]
    quilt-staging-VPC - 6 subnets in 2 AZs

  ○ Create new VPC (recommended for isolation)
    Auto-create VPC with 2 AZs, private subnets, and NAT Gateways
```

## Validation Rules

### VPC Requirements

1. **Private Subnets**: Must have ≥2 private subnets in different AZs
2. **NAT Gateway**: At least one NAT Gateway for outbound internet access
3. **Routing**: Private subnets must route through NAT Gateway
4. **AZ Distribution**: Subnets must span ≥2 availability zones (for HA)

### Validation Logic

```typescript
function validateVpc(vpc: DiscoveredVpc): void {
    const errors: string[] = [];

    // Check private subnets
    const privateSubnets = vpc.subnets.filter(s => !s.isPublic);
    if (privateSubnets.length < 2) {
        errors.push(`Insufficient private subnets (found ${privateSubnets.length}, need ≥2)`);
    }

    // Check AZ distribution
    const azs = new Set(privateSubnets.map(s => s.availabilityZone));
    if (azs.size < 2) {
        errors.push(`Private subnets span only ${azs.size} AZ(s) (need ≥2 for HA)`);
    }

    // Check NAT Gateway
    const hasNat = vpc.subnets.some(s => s.hasNatGateway);
    if (!hasNat) {
        errors.push("No NAT Gateway configured (required for ECS outbound access)");
    }

    vpc.isValid = errors.length === 0;
    vpc.validationErrors = errors;
}
```

## Error Handling

### AWS API Errors

| Error | Cause | Mitigation |
| ------- | ------- | ------------ |
| `StackNotFoundException` | Invalid stack ARN | Prompt user to verify stack ARN |
| `AccessDenied` | Missing IAM permissions | Display required IAM permissions |
| `InvalidVpcID.NotFound` | VPC deleted after discovery | Fall back to auto-create |
| `RequestTimeout` | Network issues | Retry with exponential backoff (3 attempts) |

### IAM Permissions Required

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:DescribeStackResources",
                "cloudformation:DescribeStacks",
                "ec2:DescribeVpcs",
                "ec2:DescribeSubnets",
                "ec2:DescribeRouteTables",
                "ec2:DescribeSecurityGroups"
            ],
            "Resource": "*"
        }
    ]
}
```

## Testing Strategy

### Unit Tests

1. **VPC Discovery**:
   - Mock CloudFormation responses (VPC found, no VPC, invalid ARN)
   - Mock EC2 responses (VPC metadata, subnets, route tables)
   - Test validation logic (valid VPC, missing private subnets, no NAT Gateway)

2. **Configuration Storage**:
   - Test saving VPC ID to profile config
   - Test idempotent re-runs (existing VPC shown as default)

### Integration Tests

1. **Real Stack Discovery**:
   - Test against `quilt-staging` stack in us-east-1
   - Verify discovered VPC matches expected structure
   - Validate subnet classification (public/private)

2. **Wizard Flow**:
   - Test full setup flow with VPC discovery
   - Test user selection (existing VPC vs auto-create)
   - Verify config written correctly

### Test Data (from quilt-staging)

```typescript
const expectedQuiltStagingVpc: DiscoveredVpc = {
    vpcId: "vpc-0d8b7e50c0bb25d97",
    name: "quilt-staging-VPC",
    cidrBlock: "10.0.0.0/16",
    region: "us-east-1",
    subnets: [
        {
            subnetId: "subnet-xxxxx1",
            availabilityZone: "us-east-1a",
            cidrBlock: "10.0.1.0/24",
            isPublic: false,
            hasNatGateway: true,
            name: "quilt-staging-PrivateSubnet1"
        },
        {
            subnetId: "subnet-xxxxx2",
            availabilityZone: "us-east-1b",
            cidrBlock: "10.0.2.0/24",
            isPublic: false,
            hasNatGateway: true,
            name: "quilt-staging-PrivateSubnet2"
        }
        // ... more subnets
    ],
    securityGroups: [
        "sg-0a5e911c4e28c1eaa",  // ElbPrivateAccessorSecurityGroup
        "sg-061cb33bfaad4a929",  // ElbPrivateSecurityGroup
        "sg-005272997a01f399a"   // ElbTargetSecurityGroup
    ],
    isValid: true,
    validationErrors: []
};
```

## Migration Path

### Existing Deployments

Users with manually configured VPC IDs will continue to work:

```typescript
// Before: Manual VPC configuration
{
    "deployment": {
        "vpc": {
            "vpcId": "vpc-xxxxx"  // manually discovered
        }
    }
}

// After: Re-running setup shows current VPC as default
// No breaking changes - configuration format unchanged
```

### New Deployments

New users will benefit from automatic VPC discovery without manual AWS CLI queries.

## Alternative Approaches Considered

### 1. Always Auto-Create VPC (Rejected)

**Pros**: Simplest implementation, no discovery needed
**Cons**: Wastes resources, users want to reuse Quilt VPC for cost savings

### 2. Manual VPC ID Entry (Current, Rejected)

**Pros**: No AWS API calls needed
**Cons**: Poor UX, error-prone, requires AWS CLI knowledge

### 3. Auto-Select First VPC (Rejected)

**Pros**: No user prompt needed
**Cons**: Dangerous - may select wrong VPC, no user control

### 4. Discover + Prompt (Selected)

**Pros**: Best UX, safe (user confirms), flexible (can decline)
**Cons**: Requires AWS API calls, slightly more complex

## Open Questions

1. **Security Groups**: Should we also discover and reuse Quilt security groups?
   - **Decision**: Not in v1.0 - CDK creates security groups automatically
   - **Rationale**: Security group reuse is complex (port conflicts, rule management)

2. **Subnet Selection**: Should we allow users to select specific subnets?
   - **Decision**: Not in v1.0 - use all private subnets in VPC
   - **Rationale**: CDK handles subnet selection automatically

3. **NAT Gateway Sharing**: Is it safe to share NAT Gateways with Quilt?
   - **Decision**: Yes - NAT Gateway is designed for shared use
   - **Rationale**: Cost savings, no resource conflicts

4. **Cross-Region**: Should we support VPC discovery in different regions?
   - **Decision**: Yes - use `quilt.region` for VPC discovery
   - **Rationale**: Quilt stack and Benchling stack may be in different regions

## Success Metrics

1. **Adoption**: ≥80% of users with Quilt stacks select "Use existing VPC"
2. **Error Rate**: <5% of VPC discoveries fail (excluding permission errors)
3. **Time Savings**: VPC discovery completes in <5 seconds
4. **Support Tickets**: Zero support tickets related to VPC configuration

## References

- [04-arch-reqs.md](04-arch-reqs.md) - Architecture requirements
- [lib/benchling-webhook-stack.ts:150-193](../../lib/benchling-webhook-stack.ts#L150-L193) - VPC configuration code
- [lib/types/config.ts:395-423](../../lib/types/config.ts#L395-L423) - VpcConfig type definition
- AWS CloudFormation API: [DescribeStackResources](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackResources.html)
- AWS EC2 API: [DescribeVpcs](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeVpcs.html)

## Appendix: Example AWS CLI Commands

### Discover VPC from Stack

```bash
# Get VPC ID from CloudFormation stack
aws cloudformation describe-stack-resources \
  --stack-name quilt-staging \
  --region us-east-1 \
  --query 'StackResources[?ResourceType==`AWS::EC2::VPC`].[LogicalResourceId,PhysicalResourceId]' \
  --output text

# Get VPC metadata
aws ec2 describe-vpcs \
  --vpc-ids vpc-0d8b7e50c0bb25d97 \
  --region us-east-1 \
  --query 'Vpcs[0].[VpcId,CidrBlock,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# Get subnets
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=vpc-0d8b7e50c0bb25d97" \
  --region us-east-1 \
  --query 'Subnets[].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# Check for NAT Gateways
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=vpc-0d8b7e50c0bb25d97" \
  --region us-east-1 \
  --query 'RouteTables[].Routes[?NatGatewayId!=`null`].[RouteTableId,DestinationCidrBlock,NatGatewayId]' \
  --output table
```
