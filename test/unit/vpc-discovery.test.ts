/**
 * Unit tests for VPC discovery module
 *
 * @group unit
 */

import { discoverVpcFromStack } from "../../scripts/discover-vpc";

// Mock AWS SDK clients
jest.mock("@aws-sdk/client-cloudformation");
jest.mock("@aws-sdk/client-ec2");

import {
    CloudFormationClient,
    DescribeStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import {
    EC2Client,
    DescribeVpcsCommand,
    DescribeSubnetsCommand,
    DescribeRouteTablesCommand,
    DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";

describe("VPC Discovery", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("discoverVpcFromStack", () => {
        it("should discover valid VPC with private subnets and NAT Gateway", async () => {
            // Mock CloudFormation response
            (CloudFormationClient.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeStackResourcesCommand) {
                    return Promise.resolve({
                        StackResources: [
                            {
                                ResourceType: "AWS::EC2::VPC",
                                PhysicalResourceId: "vpc-12345",
                            },
                        ],
                    });
                }
                return Promise.resolve({});
            });

            // Mock EC2 responses
            (EC2Client.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeVpcsCommand) {
                    return Promise.resolve({
                        Vpcs: [
                            {
                                VpcId: "vpc-12345",
                                CidrBlock: "10.0.0.0/16",
                                Tags: [{ Key: "Name", Value: "test-vpc" }],
                            },
                        ],
                    });
                } else if (command instanceof DescribeSubnetsCommand) {
                    return Promise.resolve({
                        Subnets: [
                            {
                                SubnetId: "subnet-1",
                                AvailabilityZone: "us-east-1a",
                                CidrBlock: "10.0.1.0/24",
                                Tags: [{ Key: "Name", Value: "private-1" }],
                            },
                            {
                                SubnetId: "subnet-2",
                                AvailabilityZone: "us-east-1b",
                                CidrBlock: "10.0.2.0/24",
                                Tags: [{ Key: "Name", Value: "private-2" }],
                            },
                        ],
                    });
                } else if (command instanceof DescribeRouteTablesCommand) {
                    return Promise.resolve({
                        RouteTables: [
                            {
                                RouteTableId: "rtb-1",
                                Routes: [
                                    {
                                        DestinationCidrBlock: "0.0.0.0/0",
                                        NatGatewayId: "nat-12345",
                                    },
                                ],
                                Associations: [
                                    { SubnetId: "subnet-1" },
                                    { SubnetId: "subnet-2" },
                                ],
                            },
                        ],
                    });
                } else if (command instanceof DescribeSecurityGroupsCommand) {
                    return Promise.resolve({
                        SecurityGroups: [
                            { GroupId: "sg-1" },
                            { GroupId: "sg-2" },
                        ],
                    });
                }
                return Promise.resolve({});
            });

            const result = await discoverVpcFromStack({
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid",
                region: "us-east-1",
            });

            expect(result).not.toBeNull();
            expect(result?.vpcId).toBe("vpc-12345");
            expect(result?.name).toBe("test-vpc");
            expect(result?.cidrBlock).toBe("10.0.0.0/16");
            expect(result?.subnets).toHaveLength(2);
            expect(result?.isValid).toBe(true);
            expect(result?.validationErrors).toHaveLength(0);
        });

        it("should return null when no VPC found in stack", async () => {
            (CloudFormationClient.prototype.send as jest.Mock).mockResolvedValue({
                StackResources: [],
            });

            const result = await discoverVpcFromStack({
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid",
                region: "us-east-1",
            });

            expect(result).toBeNull();
        });

        it("should mark VPC as invalid when insufficient private subnets", async () => {
            // Mock CloudFormation response
            (CloudFormationClient.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeStackResourcesCommand) {
                    return Promise.resolve({
                        StackResources: [
                            {
                                ResourceType: "AWS::EC2::VPC",
                                PhysicalResourceId: "vpc-12345",
                            },
                        ],
                    });
                }
                return Promise.resolve({});
            });

            // Mock EC2 responses - only 1 private subnet
            (EC2Client.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeVpcsCommand) {
                    return Promise.resolve({
                        Vpcs: [
                            {
                                VpcId: "vpc-12345",
                                CidrBlock: "10.0.0.0/16",
                            },
                        ],
                    });
                } else if (command instanceof DescribeSubnetsCommand) {
                    return Promise.resolve({
                        Subnets: [
                            {
                                SubnetId: "subnet-1",
                                AvailabilityZone: "us-east-1a",
                                CidrBlock: "10.0.1.0/24",
                            },
                        ],
                    });
                } else if (command instanceof DescribeRouteTablesCommand) {
                    return Promise.resolve({
                        RouteTables: [
                            {
                                Routes: [
                                    {
                                        DestinationCidrBlock: "0.0.0.0/0",
                                        NatGatewayId: "nat-12345",
                                    },
                                ],
                                Associations: [{ SubnetId: "subnet-1" }],
                            },
                        ],
                    });
                } else if (command instanceof DescribeSecurityGroupsCommand) {
                    return Promise.resolve({
                        SecurityGroups: [],
                    });
                }
                return Promise.resolve({});
            });

            const result = await discoverVpcFromStack({
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid",
                region: "us-east-1",
            });

            expect(result).not.toBeNull();
            expect(result?.isValid).toBe(false);
            expect(result?.validationErrors.some((err) =>
                err.includes("Insufficient private subnets")
            )).toBe(true);
        });

        it("should mark VPC as invalid when no NAT Gateway", async () => {
            // Mock CloudFormation response
            (CloudFormationClient.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeStackResourcesCommand) {
                    return Promise.resolve({
                        StackResources: [
                            {
                                ResourceType: "AWS::EC2::VPC",
                                PhysicalResourceId: "vpc-12345",
                            },
                        ],
                    });
                }
                return Promise.resolve({});
            });

            // Mock EC2 responses - 2 subnets but no NAT Gateway
            (EC2Client.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeVpcsCommand) {
                    return Promise.resolve({
                        Vpcs: [
                            {
                                VpcId: "vpc-12345",
                                CidrBlock: "10.0.0.0/16",
                            },
                        ],
                    });
                } else if (command instanceof DescribeSubnetsCommand) {
                    return Promise.resolve({
                        Subnets: [
                            {
                                SubnetId: "subnet-1",
                                AvailabilityZone: "us-east-1a",
                                CidrBlock: "10.0.1.0/24",
                            },
                            {
                                SubnetId: "subnet-2",
                                AvailabilityZone: "us-east-1b",
                                CidrBlock: "10.0.2.0/24",
                            },
                        ],
                    });
                } else if (command instanceof DescribeRouteTablesCommand) {
                    return Promise.resolve({
                        RouteTables: [
                            {
                                Routes: [], // No NAT Gateway routes
                                Associations: [
                                    { SubnetId: "subnet-1" },
                                    { SubnetId: "subnet-2" },
                                ],
                            },
                        ],
                    });
                } else if (command instanceof DescribeSecurityGroupsCommand) {
                    return Promise.resolve({
                        SecurityGroups: [],
                    });
                }
                return Promise.resolve({});
            });

            const result = await discoverVpcFromStack({
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid",
                region: "us-east-1",
            });

            expect(result).not.toBeNull();
            expect(result?.isValid).toBe(false);
            expect(result?.validationErrors.some((err) =>
                err.includes("No NAT Gateway configured")
            )).toBe(true);
        });

        it("should handle AWS API errors gracefully", async () => {
            (CloudFormationClient.prototype.send as jest.Mock).mockRejectedValue(
                new Error("AccessDenied"),
            );

            await expect(
                discoverVpcFromStack({
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid",
                    region: "us-east-1",
                }),
            ).rejects.toThrow("VPC discovery failed");
        });
    });
});
