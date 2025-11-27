/**
 * VPC Discovery Module
 *
 * Discovers VPC resources from Quilt CloudFormation stack and validates
 * them against architecture requirements.
 *
 * @module scripts/discover-vpc
 */

import {
    CloudFormationClient,
    DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
    EC2Client,
    DescribeVpcsCommand,
    DescribeSubnetsCommand,
    DescribeRouteTablesCommand,
    DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";

/**
 * VPC discovery options
 */
export interface VpcDiscoveryOptions {
    /** CloudFormation stack ARN */
    stackArn: string;
    /** AWS region */
    region: string;
    /** AWS profile to use (optional) */
    awsProfile?: string;
}

/**
 * Discovered subnet information
 */
export interface DiscoveredSubnet {
    /** Subnet ID */
    subnetId: string;
    /** Availability zone */
    availabilityZone: string;
    /** CIDR block */
    cidrBlock: string;
    /** Whether subnet is public (has IGW route) */
    isPublic: boolean;
    /** Whether subnet has NAT Gateway in route table */
    hasNatGateway: boolean;
    /** Subnet name from tags */
    name?: string;
}

/**
 * Discovered VPC information
 */
export interface DiscoveredVpc {
    /** VPC ID */
    vpcId: string;
    /** VPC name from tags */
    name?: string;
    /** CIDR block */
    cidrBlock: string;
    /** AWS region */
    region: string;
    /** Subnets in VPC */
    subnets: DiscoveredSubnet[];
    /** Security group IDs */
    securityGroups: string[];
    /** Whether VPC meets architecture requirements */
    isValid: boolean;
    /** Validation error messages */
    validationErrors: string[];
}

/**
 * Extracts stack name from ARN
 */
function extractStackNameFromArn(arn: string): string {
    // ARN format: arn:aws:cloudformation:region:account:stack/stack-name/guid
    const parts = arn.split("/");
    if (parts.length >= 2) {
        return parts[1];
    }
    throw new Error(`Invalid stack ARN format: ${arn}`);
}

/**
 * Discovers VPC resources from CloudFormation stack
 *
 * Quilt stacks don't create their own VPC - they use existing VPCs.
 * We discover the VPC by looking at the OutboundSecurityGroup output,
 * which references the VPC used by the stack.
 *
 * @param options - Discovery options
 * @returns Discovered VPC or null if not found
 */
export async function discoverVpcFromStack(
    options: VpcDiscoveryOptions,
): Promise<DiscoveredVpc | null> {
    const { stackArn, region } = options;

    // Initialize AWS clients
    const cfnConfig = { region };
    const ec2Config = { region };

    const cfnClient = new CloudFormationClient(cfnConfig);
    const ec2Client = new EC2Client(ec2Config);

    try {
        // Step 1: Get OutboundSecurityGroup from stack outputs
        const stackName = extractStackNameFromArn(stackArn);
        const describeStacksCmd = new DescribeStacksCommand({
            StackName: stackName,
        });

        const stacksResponse = await cfnClient.send(describeStacksCmd);
        const stack = stacksResponse.Stacks?.[0];
        if (!stack) {
            return null;
        }

        // Find OutboundSecurityGroup output
        const outboundSgOutput = stack.Outputs?.find(
            (o) => o.OutputKey === "OutboundSecurityGroup",
        );
        if (!outboundSgOutput || !outboundSgOutput.OutputValue) {
            return null;
        }

        const securityGroupId = outboundSgOutput.OutputValue;

        // Step 2: Get VPC ID from security group
        const sgDetailsCmd = new DescribeSecurityGroupsCommand({
            GroupIds: [securityGroupId],
        });
        const sgDetailsResponse = await ec2Client.send(sgDetailsCmd);
        const securityGroup = sgDetailsResponse.SecurityGroups?.[0];

        if (!securityGroup || !securityGroup.VpcId) {
            return null;
        }

        const vpcId = securityGroup.VpcId;

        // Step 3: Enrich VPC metadata via EC2 API
        const vpcDetailsCmd = new DescribeVpcsCommand({
            VpcIds: [vpcId],
        });
        const vpcDetailsResponse = await ec2Client.send(vpcDetailsCmd);
        const vpcDetails = vpcDetailsResponse.Vpcs?.[0];

        if (!vpcDetails) {
            return null;
        }

        const vpcName = vpcDetails.Tags?.find((t) => t.Key === "Name")?.Value;
        const cidrBlock = vpcDetails.CidrBlock || "";

        // Step 4: Get subnet details
        const subnetsCmd = new DescribeSubnetsCommand({
            Filters: [
                {
                    Name: "vpc-id",
                    Values: [vpcId],
                },
            ],
        });
        const subnetsResponse = await ec2Client.send(subnetsCmd);
        const ec2Subnets = subnetsResponse.Subnets || [];

        // Step 5: Get route tables to determine subnet types
        const routeTablesCmd = new DescribeRouteTablesCommand({
            Filters: [
                {
                    Name: "vpc-id",
                    Values: [vpcId],
                },
            ],
        });
        const routeTablesResponse = await ec2Client.send(routeTablesCmd);
        const routeTables = routeTablesResponse.RouteTables || [];

        // Build map of subnet -> route table -> NAT/IGW status
        const subnetRouteMap = new Map<
            string,
            { isPublic: boolean; hasNatGateway: boolean }
        >();

        for (const routeTable of routeTables) {
            // Check if route table has IGW or NAT Gateway
            const hasIgw = routeTable.Routes?.some(
                (r) => r.GatewayId?.startsWith("igw-"),
            );
            const hasNat = routeTable.Routes?.some(
                (r) => r.NatGatewayId?.startsWith("nat-"),
            );

            // Map subnets to this route table
            const subnetIds =
                routeTable.Associations?.map((a) => a.SubnetId).filter(
                    (id): id is string => !!id,
                ) || [];

            for (const subnetId of subnetIds) {
                subnetRouteMap.set(subnetId, {
                    isPublic: !!hasIgw,
                    hasNatGateway: !!hasNat,
                });
            }
        }

        // Build discovered subnets
        const subnets: DiscoveredSubnet[] = ec2Subnets.map((subnet) => {
            const subnetId = subnet.SubnetId || "";
            const routeInfo = subnetRouteMap.get(subnetId) || {
                isPublic: false,
                hasNatGateway: false,
            };
            const name = subnet.Tags?.find((t) => t.Key === "Name")?.Value;

            return {
                subnetId,
                availabilityZone: subnet.AvailabilityZone || "",
                cidrBlock: subnet.CidrBlock || "",
                isPublic: routeInfo.isPublic,
                hasNatGateway: routeInfo.hasNatGateway,
                name,
            };
        });

        // Step 6: Get security groups
        const securityGroupsCmd = new DescribeSecurityGroupsCommand({
            Filters: [
                {
                    Name: "vpc-id",
                    Values: [vpcId],
                },
            ],
        });
        const securityGroupsResponse = await ec2Client.send(securityGroupsCmd);
        const securityGroups = (securityGroupsResponse.SecurityGroups || [])
            .map((sg) => sg.GroupId)
            .filter((id): id is string => !!id);

        // Step 7: Build discovered VPC
        const discoveredVpc: DiscoveredVpc = {
            vpcId,
            name: vpcName,
            cidrBlock,
            region,
            subnets,
            securityGroups,
            isValid: false,
            validationErrors: [],
        };

        // Step 8: Validate VPC
        validateVpc(discoveredVpc);

        return discoveredVpc;
    } catch (error) {
        const err = error as Error;
        throw new Error(`VPC discovery failed: ${err.message}`);
    }
}

/**
 * Validates VPC meets architecture requirements
 *
 * Requirements:
 * - Must have ≥2 private subnets in different AZs
 * - Private subnets must have NAT Gateway for outbound access
 *
 * @param vpc - Discovered VPC to validate
 */
function validateVpc(vpc: DiscoveredVpc): void {
    const errors: string[] = [];

    // Check private subnets
    const privateSubnets = vpc.subnets.filter((s) => !s.isPublic);
    if (privateSubnets.length < 2) {
        errors.push(
            `Insufficient private subnets (found ${privateSubnets.length}, need ≥2)`,
        );
    }

    // Check AZ distribution
    const azs = new Set(privateSubnets.map((s) => s.availabilityZone));
    if (azs.size < 2) {
        errors.push(
            `Private subnets span only ${azs.size} AZ(s) (need ≥2 for high availability)`,
        );
    }

    // Check NAT Gateway
    const hasNat = vpc.subnets.some((s) => s.hasNatGateway);
    if (!hasNat) {
        errors.push(
            "No NAT Gateway configured (required for ECS outbound access)",
        );
    }

    vpc.isValid = errors.length === 0;
    vpc.validationErrors = errors;
}
