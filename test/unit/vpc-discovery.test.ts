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
    DescribeStacksCommand,
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
            // Mock CloudFormation response - stack outputs with OutboundSecurityGroup
            (CloudFormationClient.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeStacksCommand) {
                    return Promise.resolve({
                        Stacks: [
                            {
                                Outputs: [
                                    {
                                        OutputKey: "OutboundSecurityGroup",
                                        OutputValue: "sg-test123",
                                    },
                                ],
                            },
                        ],
                    });
                }
                return Promise.resolve({});
            });

            // Mock EC2 responses
            let sgCallCount = 0;
            (EC2Client.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeSecurityGroupsCommand) {
                    sgCallCount++;
                    if (sgCallCount === 1) {
                        // First call: get VPC from security group
                        return Promise.resolve({
                            SecurityGroups: [
                                {
                                    GroupId: "sg-test123",
                                    VpcId: "vpc-12345",
                                },
                            ],
                        });
                    } else {
                        // Second call: get all security groups in VPC
                        return Promise.resolve({
                            SecurityGroups: [
                                { GroupId: "sg-1" },
                                { GroupId: "sg-2" },
                            ],
                        });
                    }
                } else if (command instanceof DescribeVpcsCommand) {
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

        it("should return null when no OutboundSecurityGroup found in stack", async () => {
            (CloudFormationClient.prototype.send as jest.Mock).mockResolvedValue({
                Stacks: [
                    {
                        Outputs: [],
                    },
                ],
            });

            const result = await discoverVpcFromStack({
                stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid",
                region: "us-east-1",
            });

            expect(result).toBeNull();
        });

        it("should mark VPC as invalid when insufficient private subnets", async () => {
            // Mock CloudFormation response - stack outputs with OutboundSecurityGroup
            (CloudFormationClient.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeStacksCommand) {
                    return Promise.resolve({
                        Stacks: [
                            {
                                Outputs: [
                                    {
                                        OutputKey: "OutboundSecurityGroup",
                                        OutputValue: "sg-test123",
                                    },
                                ],
                            },
                        ],
                    });
                }
                return Promise.resolve({});
            });

            // Mock EC2 responses - only 1 private subnet
            let sgCallCount = 0;
            (EC2Client.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeSecurityGroupsCommand) {
                    sgCallCount++;
                    if (sgCallCount === 1) {
                        // First call: get VPC from security group
                        return Promise.resolve({
                            SecurityGroups: [
                                {
                                    GroupId: "sg-test123",
                                    VpcId: "vpc-12345",
                                },
                            ],
                        });
                    } else {
                        // Second call: get all security groups in VPC
                        return Promise.resolve({
                            SecurityGroups: [],
                        });
                    }
                } else if (command instanceof DescribeVpcsCommand) {
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
            // Mock CloudFormation response - stack outputs with OutboundSecurityGroup
            (CloudFormationClient.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeStacksCommand) {
                    return Promise.resolve({
                        Stacks: [
                            {
                                Outputs: [
                                    {
                                        OutputKey: "OutboundSecurityGroup",
                                        OutputValue: "sg-test123",
                                    },
                                ],
                            },
                        ],
                    });
                }
                return Promise.resolve({});
            });

            // Mock EC2 responses - 2 subnets but no NAT Gateway
            let sgCallCount = 0;
            (EC2Client.prototype.send as jest.Mock).mockImplementation((command) => {
                if (command instanceof DescribeSecurityGroupsCommand) {
                    sgCallCount++;
                    if (sgCallCount === 1) {
                        // First call: get VPC from security group
                        return Promise.resolve({
                            SecurityGroups: [
                                {
                                    GroupId: "sg-test123",
                                    VpcId: "vpc-12345",
                                },
                            ],
                        });
                    } else {
                        // Second call: get all security groups in VPC
                        return Promise.resolve({
                            SecurityGroups: [],
                        });
                    }
                } else if (command instanceof DescribeVpcsCommand) {
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
                err.includes("Insufficient private subnets with NAT Gateway")
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
