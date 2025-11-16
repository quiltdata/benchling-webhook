#!/usr/bin/env node
/**
 * Stack Status Command
 *
 * Reports CloudFormation stack status and BenchlingIntegration parameter state
 * for a given configuration profile.
 *
 * @module commands/status
 */

import chalk from "chalk";
import ora from "ora";
import { CloudFormationClient, DescribeStacksCommand, DescribeStackEventsCommand, DescribeStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand } from "@aws-sdk/client-ecs";
import { ElasticLoadBalancingV2Client, DescribeTargetHealthCommand, DescribeTargetGroupsCommand, DescribeRulesCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { SecretsManagerClient, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";
import { XDGConfig } from "../../lib/xdg-config";
import type { XDGBase } from "../../lib/xdg-base";

export interface StatusCommandOptions {
    /** Configuration profile name */
    profile?: string;
    /** AWS profile to use */
    awsProfile?: string;
    /** Config storage implementation (for testing) */
    configStorage?: XDGBase;
    /** Show detailed stack events */
    detailed?: boolean;
    /** Auto-refresh interval in seconds (0 or non-numeric to disable) */
    timer?: string | number;
    /** Exit after reaching terminal status (default: true, use --no-exit to keep monitoring) */
    exit?: boolean;
}

export interface StatusResult {
    success: boolean;
    stackStatus?: string;
    benchlingIntegrationEnabled?: boolean;
    lastUpdateTime?: string;
    stackArn?: string;
    region?: string;
    error?: string;
    stackOutputs?: {
        benchlingUrl?: string;
        secretArn?: string;
        dockerImage?: string;
        ecsLogGroup?: string;
        apiGatewayLogGroup?: string;
    };
    secretInfo?: {
        name: string;
        lastModified?: Date;
        accessible: boolean;
        error?: string;
    };
    listenerRules?: Array<{
        priority: string;
        path: string;
        targetGroupArn: string;
    }>;
    ecsServices?: Array<{
        serviceName: string;
        status: string;
        desiredCount: number;
        runningCount: number;
        pendingCount: number;
        rolloutState?: string;
        logGroup?: string;
        logStreamPrefix?: string;
    }>;
    albTargetGroups?: Array<{
        targetGroupName: string;
        healthyCount: number;
        unhealthyCount: number;
        drainingCount: number;
        targets: Array<{
            id: string;
            health: string;
            reason?: string;
        }>;
    }>;
    stackEvents?: Array<{
        timestamp: Date;
        resourceId: string;
        status: string;
        reason?: string;
    }>;
}

/**
 * Gets stack status from CloudFormation
 */
async function getStackStatus(
    stackArn: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult> {
    try {
        // Extract stack name from ARN
        const stackNameMatch = stackArn.match(/stack\/([^/]+)\//);
        if (!stackNameMatch) {
            throw new Error(`Invalid stack ARN format: ${stackArn}`);
        }
        const stackName = stackNameMatch[1];

        // Configure AWS SDK client
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        // Describe stack
        const command = new DescribeStacksCommand({
            StackName: stackName,
        });
        const response = await client.send(command);
        const stack = response.Stacks?.[0];

        if (!stack) {
            throw new Error(`Stack not found: ${stackName}`);
        }

        // Extract BenchlingIntegration parameter
        const param = stack.Parameters?.find((p) => p.ParameterKey === "BenchlingIntegration");
        const benchlingIntegrationEnabled = param?.ParameterValue === "Enabled";

        // Extract stack outputs
        const outputs = stack.Outputs || [];
        const stackOutputs = {
            benchlingUrl: outputs.find((o) => o.OutputKey === "BenchlingUrl")?.OutputValue,
            secretArn: outputs.find((o) => o.OutputKey === "BenchlingSecretArn" || o.OutputKey === "BenchlingClientSecretArn" || o.OutputKey === "SecretArn")?.OutputValue,
            dockerImage: outputs.find((o) => o.OutputKey === "BenchlingDockerImage" || o.OutputKey === "DockerImage")?.OutputValue,
            ecsLogGroup: outputs.find((o) => o.OutputKey === "EcsLogGroup")?.OutputValue,
            apiGatewayLogGroup: outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup")?.OutputValue,
        };

        return {
            success: true,
            stackStatus: stack.StackStatus,
            benchlingIntegrationEnabled,
            lastUpdateTime: stack.LastUpdatedTime?.toISOString() || stack.CreationTime?.toISOString(),
            stackArn,
            region,
            stackOutputs,
        };
    } catch (error) {
        return {
            success: false,
            error: (error as Error).message,
            stackArn,
            region,
        };
    }
}

/**
 * Formats stack status with color coding
 */
export function formatStackStatus(status: string): string {
    if (status.includes("COMPLETE") && !status.includes("ROLLBACK")) {
        return chalk.green(status);
    } else if (status.includes("IN_PROGRESS")) {
        return chalk.yellow(status);
    } else if (status.includes("FAILED") || status.includes("ROLLBACK")) {
        return chalk.red(status);
    } else {
        return chalk.dim(status);
    }
}

/**
 * Checks if stack status is terminal (no further updates expected)
 */
function isTerminalStatus(status?: string): boolean {
    if (!status) return false;
    return status.endsWith("_COMPLETE") || status.endsWith("_FAILED");
}

/**
 * Parses timer value (string or number) and returns interval in milliseconds
 * Returns null if timer is disabled (0 or non-numeric string)
 */
function parseTimerValue(timer?: string | number): number | null {
    if (timer === undefined) return 10000; // Default 10 seconds

    const numValue = typeof timer === "string" ? parseFloat(timer) : timer;

    // If NaN or 0, disable timer
    if (isNaN(numValue) || numValue === 0) {
        return null;
    }

    // Return milliseconds
    return numValue * 1000;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clear screen and move cursor to top
 */
function clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
}

/**
 * Gets ECS service health information
 */
async function getEcsServiceHealth(
    stackName: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult["ecsServices"]> {
    try {
        // Configure AWS SDK clients
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const ecsClient = new ECSClient(clientConfig);

        // Find ECS resources in stack
        const resourcesCommand = new DescribeStackResourcesCommand({
            StackName: stackName,
        });
        const resourcesResponse = await cfClient.send(resourcesCommand);

        const ecsServices = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::ECS::Service",
        ) || [];

        if (ecsServices.length === 0) {
            return undefined;
        }

        // Get cluster name (assuming all services use the same cluster)
        const clusterResource = resourcesResponse.StackResources?.find(
            (r) => r.ResourceType === "AWS::ECS::Cluster",
        );
        const clusterName = clusterResource?.PhysicalResourceId || stackName;

        // Describe all ECS services
        const serviceArns = ecsServices
            .map((s) => s.PhysicalResourceId)
            .filter((arn): arn is string => !!arn);

        if (serviceArns.length === 0) {
            return undefined;
        }

        const servicesCommand = new DescribeServicesCommand({
            cluster: clusterName,
            services: serviceArns,
        });
        const servicesResponse = await ecsClient.send(servicesCommand);

        // Get log groups from task definitions
        const servicesWithLogs = await Promise.all(
            (servicesResponse.services || []).map(async (svc: { serviceName?: string; status?: string; desiredCount?: number; runningCount?: number; pendingCount?: number; deployments?: Array<{ rolloutState?: string; taskDefinition?: string }> }) => {
                let logGroup: string | undefined;
                let logStreamPrefix: string | undefined;

                // Get task definition ARN from the current deployment
                const taskDefArn = svc.deployments?.[0]?.taskDefinition;
                if (taskDefArn) {
                    try {
                        const taskDefCommand = new DescribeTaskDefinitionCommand({
                            taskDefinition: taskDefArn,
                        });
                        const taskDefResponse = await ecsClient.send(taskDefCommand);

                        // Extract log group and stream prefix from first container's log configuration
                        const logConfig = taskDefResponse.taskDefinition?.containerDefinitions?.[0]?.logConfiguration;
                        if (logConfig?.logDriver === "awslogs") {
                            logGroup = logConfig.options?.["awslogs-group"];
                            logStreamPrefix = logConfig.options?.["awslogs-stream-prefix"];
                        }
                    } catch (error) {
                        // Log group query failed, continue without it
                        console.error(chalk.dim(`  Could not retrieve log group for ${svc.serviceName}: ${(error as Error).message}`));
                    }
                }

                return {
                    serviceName: svc.serviceName || "Unknown",
                    status: svc.status || "UNKNOWN",
                    desiredCount: svc.desiredCount || 0,
                    runningCount: svc.runningCount || 0,
                    pendingCount: svc.pendingCount || 0,
                    rolloutState: svc.deployments?.[0]?.rolloutState,
                    logGroup,
                    logStreamPrefix,
                };
            }),
        );

        return servicesWithLogs;
    } catch (error) {
        // ECS health check is optional, don't fail the entire command
        console.error(chalk.dim(`  Could not retrieve ECS service health: ${(error as Error).message}`));
        return undefined;
    }
}

/**
 * Gets recent stack events
 */
async function getRecentStackEvents(
    stackName: string,
    region: string,
    awsProfile?: string,
    maxEvents = 10,
): Promise<StatusResult["stackEvents"]> {
    try {
        // Configure AWS SDK client
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        const command = new DescribeStackEventsCommand({
            StackName: stackName,
        });
        const response = await client.send(command);

        return response.StackEvents?.slice(0, maxEvents).map((event) => ({
            timestamp: event.Timestamp || new Date(),
            resourceId: event.LogicalResourceId || "Unknown",
            status: event.ResourceStatus || "UNKNOWN",
            reason: event.ResourceStatusReason,
        }));
    } catch (error) {
        // Stack events are optional, don't fail the entire command
        console.error(chalk.dim(`  Could not retrieve stack events: ${(error as Error).message}`));
        return undefined;
    }
}

/**
 * Gets ALB target group health information
 */
async function getAlbTargetHealth(
    stackName: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult["albTargetGroups"]> {
    try {
        // Configure AWS SDK clients
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const elbClient = new ElasticLoadBalancingV2Client(clientConfig);

        // Find Target Group resources in stack
        const resourcesCommand = new DescribeStackResourcesCommand({
            StackName: stackName,
        });
        const resourcesResponse = await cfClient.send(resourcesCommand);

        const targetGroups = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::ElasticLoadBalancingV2::TargetGroup",
        ) || [];

        if (targetGroups.length === 0) {
            return undefined;
        }

        // Get target group ARNs
        const targetGroupArns = targetGroups
            .map((tg) => tg.PhysicalResourceId)
            .filter((arn): arn is string => !!arn);

        if (targetGroupArns.length === 0) {
            return undefined;
        }

        // Get target group names
        const tgInfoCommand = new DescribeTargetGroupsCommand({
            TargetGroupArns: targetGroupArns,
        });
        const tgInfoResponse = await elbClient.send(tgInfoCommand);

        const result: StatusResult["albTargetGroups"] = [];

        // Get health for each target group
        for (const tgArn of targetGroupArns) {
            const healthCommand = new DescribeTargetHealthCommand({
                TargetGroupArn: tgArn,
            });
            const healthResponse = await elbClient.send(healthCommand);

            const tgInfo = tgInfoResponse.TargetGroups?.find((tg) => tg.TargetGroupArn === tgArn);
            const tgName = tgInfo?.TargetGroupName || tgArn.split("/").pop() || "Unknown";

            const targets = healthResponse.TargetHealthDescriptions?.map((target) => ({
                id: target.Target?.Id || "Unknown",
                health: target.TargetHealth?.State || "unknown",
                reason: target.TargetHealth?.Reason,
            })) || [];

            const healthyCount = targets.filter((t) => t.health === "healthy").length;
            const unhealthyCount = targets.filter((t) => t.health === "unhealthy").length;
            const drainingCount = targets.filter((t) => t.health === "draining").length;

            result.push({
                targetGroupName: tgName,
                healthyCount,
                unhealthyCount,
                drainingCount,
                targets,
            });
        }

        return result.length > 0 ? result : undefined;
    } catch (error) {
        // ALB health check is optional, don't fail the entire command
        console.error(chalk.dim(`  Could not retrieve ALB target health: ${(error as Error).message}`));
        return undefined;
    }
}

/**
 * Gets Secrets Manager secret information
 */
async function getSecretInfo(
    secretArn: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult["secretInfo"]> {
    try {
        // Configure AWS SDK client
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new SecretsManagerClient(clientConfig);

        const command = new DescribeSecretCommand({
            SecretId: secretArn,
        });
        const response = await client.send(command);

        // Only use LastChangedDate - do NOT fall back to CreatedDate
        // If LastChangedDate is undefined, the secret has never been modified

        // Extract full secret name from ARN (includes random suffix)
        // ARN format: arn:aws:secretsmanager:region:account:secret:name-suffix
        const fullSecretName = secretArn.split(":secret:")[1] || response.Name || secretArn;

        return {
            name: fullSecretName,
            lastModified: response.LastChangedDate,
            accessible: true,
        };
    } catch (error) {
        // Extract secret name from ARN: arn:aws:secretsmanager:region:account:secret:name-6chars
        // The secret name is everything after "secret:" in the ARN
        const secretName = secretArn.split(":secret:")[1] || secretArn.split(":").pop() || secretArn;
        return {
            name: secretName,
            accessible: false,
            error: (error as Error).message,
        };
    }
}

/**
 * Gets ALB listener rules information
 */
async function getListenerRules(
    stackName: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult["listenerRules"]> {
    try {
        // Configure AWS SDK clients
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const elbClient = new ElasticLoadBalancingV2Client(clientConfig);

        // Find Listener Rule resources in stack
        const resourcesCommand = new DescribeStackResourcesCommand({
            StackName: stackName,
        });
        const resourcesResponse = await cfClient.send(resourcesCommand);

        const listenerRules = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::ElasticLoadBalancingV2::ListenerRule",
        ) || [];

        if (listenerRules.length === 0) {
            return undefined;
        }

        const result: StatusResult["listenerRules"] = [];

        // Get details for each listener rule
        for (const ruleResource of listenerRules) {
            const ruleArn = ruleResource.PhysicalResourceId;
            if (!ruleArn) continue;

            // Extract listener ARN from rule ARN
            const listenerArnMatch = ruleArn.match(/(arn:aws:elasticloadbalancing:[^:]+:[^:]+:listener\/[^/]+\/[^/]+\/[^/]+)/);
            if (!listenerArnMatch) continue;

            const listenerArn = listenerArnMatch[1];
            const rulesCommand = new DescribeRulesCommand({
                ListenerArn: listenerArn,
            });
            const rulesResponse = await elbClient.send(rulesCommand);

            const rule = rulesResponse.Rules?.find((r) => r.RuleArn === ruleArn);
            if (rule) {
                const pathCondition = rule.Conditions?.find((c) => c.Field === "path-pattern");
                const path = pathCondition?.Values?.[0] || "N/A";
                const targetGroupArn = rule.Actions?.[0]?.TargetGroupArn || "N/A";

                result.push({
                    priority: rule.Priority || "N/A",
                    path,
                    targetGroupArn: targetGroupArn.split("/").pop() || targetGroupArn,
                });
            }
        }

        return result.length > 0 ? result : undefined;
    } catch (error) {
        // Listener rules are optional, don't fail the entire command
        console.error(chalk.dim(`  Could not retrieve listener rules: ${(error as Error).message}`));
        return undefined;
    }
}

/**
 * Fetches complete status including all health checks
 */
async function fetchCompleteStatus(
    stackArn: string,
    stackName: string,
    region: string,
    awsProfile?: string,
): Promise<StatusResult> {
    const result = await getStackStatus(stackArn, region, awsProfile);

    if (!result.success) {
        return result;
    }

    // Get additional info in parallel
    const secretArn = result.stackOutputs?.secretArn;
    const [ecsServices, albTargetGroups, secretInfo, listenerRules, stackEvents] = await Promise.all([
        getEcsServiceHealth(stackName, region, awsProfile),
        getAlbTargetHealth(stackName, region, awsProfile),
        secretArn ? getSecretInfo(secretArn, region, awsProfile) : Promise.resolve(undefined),
        getListenerRules(stackName, region, awsProfile),
        getRecentStackEvents(stackName, region, awsProfile, 3),
    ]);

    result.ecsServices = ecsServices;
    result.albTargetGroups = albTargetGroups;
    result.secretInfo = secretInfo;
    result.listenerRules = listenerRules;
    result.stackEvents = stackEvents;

    return result;
}

/**
 * Displays status result to console
 */
/* istanbul ignore next */
function displayStatusResult(result: StatusResult, profile: string, quiltConfig?: import("../../lib/types/config").QuiltConfig): void {
    const stackName = result.stackArn?.match(/stack\/([^/]+)\//)?.[1] || result.stackArn || "Unknown";
    const region = result.region || "Unknown";

    // Format last updated time in local timezone
    let lastUpdatedStr = "";
    if (result.lastUpdateTime) {
        const lastUpdated = new Date(result.lastUpdateTime);
        const timeStr = lastUpdated.toLocaleString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        lastUpdatedStr = ` @ ${timeStr} (${timezone})`;
    }

    // Display header with last updated time
    console.log(chalk.bold(`\nStack Status for Profile: ${profile}${lastUpdatedStr}\n`));
    console.log(chalk.dim("─".repeat(80)));
    console.log(`${chalk.bold("Stack:")} ${chalk.cyan(stackName)}  ${chalk.bold("Region:")} ${chalk.cyan(region)}`);
    console.log(`${chalk.bold("Stack Status:")} ${formatStackStatus(result.stackStatus!)}  ${chalk.bold("BenchlingIntegration:")} ${result.benchlingIntegrationEnabled ? chalk.green("✓ Enabled") : chalk.yellow("⚠ Disabled")}`);
    console.log("");

    // Display stack outputs and secret info on one line each
    if (result.stackOutputs) {
        if (result.stackOutputs.benchlingUrl) {
            console.log(`${chalk.bold("Benchling URL:")} ${chalk.cyan(result.stackOutputs.benchlingUrl)}`);
        }
        if (result.stackOutputs.dockerImage) {
            console.log(`${chalk.bold("Docker Image:")} ${chalk.dim(result.stackOutputs.dockerImage)}`);
        }
    }

    // Display secret info on one line
    if (result.secretInfo) {
        let secretLine = `${chalk.bold("Secrets Manager:")} `;
        if (result.secretInfo.accessible) {
            if (result.secretInfo.lastModified) {
                // Secret has been modified - show with green checkmark
                secretLine += `${chalk.green("✓")} ${chalk.cyan(result.secretInfo.name)}`;
                const deltaMs = Date.now() - result.secretInfo.lastModified.getTime();
                const minutes = Math.floor(deltaMs / 60000);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);

                let timeStr: string;
                if (days > 0) {
                    timeStr = `${days} day${days !== 1 ? "s" : ""} ago`;
                } else if (hours > 0) {
                    timeStr = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
                } else if (minutes > 0) {
                    timeStr = `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
                } else {
                    timeStr = "just now";
                }
                secretLine += chalk.dim(` (Last modified: ${timeStr})`);
            } else {
                // Secret never modified - needs attention!
                secretLine += `${chalk.red(result.secretInfo.name)} ${chalk.red("(NEVER MODIFIED - needs updating)")}`;
            }
        } else {
            secretLine += `${chalk.red("✗")} ${chalk.red(result.secretInfo.name)} - ${chalk.dim(result.secretInfo.error || "Inaccessible")}`;
        }
        console.log(secretLine);
    }

    // Display log groups
    if (result.stackOutputs?.ecsLogGroup || result.stackOutputs?.apiGatewayLogGroup) {
        console.log(`${chalk.bold("CloudWatch Logs:")}`);
        if (result.stackOutputs.ecsLogGroup) {
            console.log(`  ${chalk.cyan("ECS:")} ${chalk.dim(result.stackOutputs.ecsLogGroup)}`);
        }
        if (result.stackOutputs.apiGatewayLogGroup) {
            console.log(`  ${chalk.cyan("API Gateway:")} ${chalk.dim(result.stackOutputs.apiGatewayLogGroup)}`);
        }
    }

    // Display Quilt stack resources (discovered from stack, not outputs)
    if (quiltConfig) {
        const resources = [];
        if (quiltConfig.athenaUserWorkgroup) resources.push({ label: "User Workgroup", value: quiltConfig.athenaUserWorkgroup });
        if (quiltConfig.athenaIcebergWorkgroup) resources.push({ label: "Iceberg Workgroup", value: quiltConfig.athenaIcebergWorkgroup });
        if (quiltConfig.icebergDatabase) resources.push({ label: "Iceberg Database", value: quiltConfig.icebergDatabase });
        if (quiltConfig.athenaResultsBucket) resources.push({ label: "Athena Results Bucket", value: quiltConfig.athenaResultsBucket });
        if (quiltConfig.athenaResultsBucketPolicy) resources.push({ label: "Results Bucket Policy", value: quiltConfig.athenaResultsBucketPolicy });

        if (resources.length > 0) {
            console.log(`${chalk.bold("Quilt Stack Resources:")}`);
            for (const res of resources) {
                console.log(`  ${chalk.cyan(res.label + ":")} ${chalk.dim(res.value)}`);
            }
        }
    }

    console.log("");

    // Display listener rules
    if (result.listenerRules && result.listenerRules.length > 0) {
        console.log(chalk.bold("ALB Listener Rules:"));
        for (const rule of result.listenerRules) {
            console.log(`  ${chalk.cyan(rule.path)} ${chalk.dim(`(priority: ${rule.priority})`)}`);
            console.log(`    → ${chalk.dim(rule.targetGroupArn)}`);
        }
        console.log("");
    }

    // Display ECS service health in compact table format
    if (result.ecsServices && result.ecsServices.length > 0) {
        console.log(chalk.bold("ECS Services:"));

        // Table header
        const statusHeader = "Status";
        const nameHeader = "Service";
        const tasksHeader = "Tasks";
        const rolloutHeader = "Rollout";
        const logHeader = "Log Group";

        // Calculate column widths
        const maxNameLen = Math.max(nameHeader.length, ...result.ecsServices.map(s => s.serviceName.length));
        const nameWidth = Math.min(maxNameLen + 2, 40); // Cap at 40 chars
        const tasksWidth = 12;
        const rolloutWidth = 15;

        // Print header
        console.log(`  ${statusHeader.padEnd(8)} ${nameHeader.padEnd(nameWidth)} ${tasksHeader.padEnd(tasksWidth)} ${rolloutHeader.padEnd(rolloutWidth)} ${logHeader}`);
        console.log(`  ${chalk.dim("─".repeat(8))} ${chalk.dim("─".repeat(nameWidth))} ${chalk.dim("─".repeat(tasksWidth))} ${chalk.dim("─".repeat(rolloutWidth))} ${chalk.dim("─".repeat(30))}`);

        // Print rows
        for (const svc of result.ecsServices) {
            const statusIcon = svc.status === "ACTIVE" ? "✓" : "⚠";
            const statusColor = svc.status === "ACTIVE" ? chalk.green : chalk.yellow;
            const tasksMatch = svc.runningCount === svc.desiredCount;
            const tasksColor = tasksMatch ? chalk.green : chalk.yellow;

            const statusCol = `${statusColor(statusIcon)} ${statusColor(svc.status)}`.padEnd(8 + 10); // +10 for ANSI codes
            const nameCol = chalk.cyan(svc.serviceName.padEnd(nameWidth));
            const tasksText = svc.pendingCount > 0
                ? `${svc.runningCount}/${svc.desiredCount} (${svc.pendingCount} pending)`
                : `${svc.runningCount}/${svc.desiredCount}`;
            const tasksCol = tasksColor(tasksText).padEnd(tasksWidth + (tasksMatch ? 10 : 10)); // Account for ANSI

            let rolloutCol = "";
            if (svc.rolloutState) {
                if (svc.rolloutState === "COMPLETED") {
                    rolloutCol = chalk.green(svc.rolloutState).padEnd(rolloutWidth + 10);
                } else if (svc.rolloutState === "FAILED") {
                    rolloutCol = chalk.red(svc.rolloutState + " ❌").padEnd(rolloutWidth + 10);
                } else {
                    rolloutCol = chalk.yellow(svc.rolloutState).padEnd(rolloutWidth + 10);
                }
            } else {
                rolloutCol = chalk.dim("-").padEnd(rolloutWidth + 10);
            }

            let logCol: string;
            if (svc.logGroup) {
                if (svc.logStreamPrefix) {
                    logCol = chalk.dim(`${svc.logGroup}/${svc.logStreamPrefix}`);
                } else {
                    logCol = chalk.dim(svc.logGroup);
                }
            } else {
                logCol = chalk.dim("-");
            }

            console.log(`  ${statusCol} ${nameCol} ${tasksCol} ${rolloutCol} ${logCol}`);
        }
        console.log("");
    }

    // Display ALB target group health
    if (result.albTargetGroups && result.albTargetGroups.length > 0) {
        console.log(chalk.bold("ALB Target Groups:"));
        for (const tg of result.albTargetGroups) {
            const allHealthy = tg.healthyCount > 0 && tg.unhealthyCount === 0;
            const hasUnhealthy = tg.unhealthyCount > 0;
            const statusIcon = allHealthy ? "✓" : hasUnhealthy ? "✗" : "⚠";
            const statusColor = allHealthy ? chalk.green : hasUnhealthy ? chalk.red : chalk.yellow;

            console.log(`  ${statusColor(statusIcon)} ${chalk.cyan(tg.targetGroupName)}`);
            console.log(`    Targets: ${chalk.green(`${tg.healthyCount} healthy`)}${tg.unhealthyCount > 0 ? chalk.red(` / ${tg.unhealthyCount} unhealthy`) : ""}${tg.drainingCount > 0 ? chalk.dim(` / ${tg.drainingCount} draining`) : ""}`);

            // Show unhealthy target details
            const unhealthyTargets = tg.targets.filter((t) => t.health === "unhealthy");
            if (unhealthyTargets.length > 0) {
                for (const target of unhealthyTargets) {
                    console.log(`      ${chalk.red("✗")} ${chalk.dim(target.id)}: ${chalk.red(target.health)}`);
                    if (target.reason) {
                        console.log(`        ${chalk.dim(target.reason)}`);
                    }
                }
            }
        }
        console.log("");
    }

    // Display recent stack events
    if (result.stackEvents && result.stackEvents.length > 0) {
        const now = new Date();
        console.log(chalk.bold("Recent Stack Events:"));
        console.log(chalk.dim(`  Current time: ${now.toISOString().replace("T", " ").substring(0, 19)} UTC\n`));

        for (const event of result.stackEvents) {
            // Calculate time delta
            const deltaMs = now.getTime() - event.timestamp.getTime();
            const deltaMinutes = Math.floor(deltaMs / 60000);
            const deltaHours = Math.floor(deltaMinutes / 60);
            const deltaDays = Math.floor(deltaHours / 24);

            let deltaStr: string;
            if (deltaDays > 0) {
                deltaStr = `${deltaDays}d ${deltaHours % 24}h ago`;
            } else if (deltaHours > 0) {
                deltaStr = `${deltaHours}h ${deltaMinutes % 60}m ago`;
            } else if (deltaMinutes > 0) {
                deltaStr = `${deltaMinutes}m ago`;
            } else {
                deltaStr = "just now";
            }

            const statusStr = formatStackStatus(event.status);
            console.log(`  ${chalk.dim(deltaStr.padEnd(15))} ${statusStr}`);
            console.log(`    ${chalk.cyan(event.resourceId)}`);
            if (event.reason && event.reason !== "None") {
                console.log(`    ${chalk.dim(event.reason)}`);
            }
        }
        console.log("");
    }

    // Show next steps based on status
    if (result.stackStatus?.includes("IN_PROGRESS")) {
        console.log(chalk.bold("Status:"));
        console.log(chalk.yellow("  ⏳ Stack update in progress..."));
        console.log(chalk.dim("  Auto-refreshing until complete...\n"));
    } else if (result.stackStatus?.includes("COMPLETE") && !result.stackStatus.includes("ROLLBACK")) {
        console.log(chalk.bold("Status:"));
        console.log(chalk.green("  ✓ Stack is up to date\n"));

        if (!result.benchlingIntegrationEnabled) {
            console.log(chalk.bold("Action Required:"));
            console.log(chalk.yellow("  BenchlingIntegration is Disabled"));
            console.log(chalk.dim("  Enable it via CloudFormation console or re-run setup\n"));
        }
    } else if (result.stackStatus?.includes("FAILED") || result.stackStatus?.includes("ROLLBACK")) {
        console.log(chalk.bold("Status:"));
        console.log(chalk.red("  ❌ Stack update failed or rolled back"));
        console.log(chalk.dim("  Check CloudFormation console for detailed error messages\n"));
    }

    // CloudFormation console link
    const stackArn = result.stackArn || "";
    const consoleUrl = `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/stackinfo?stackId=${encodeURIComponent(stackArn)}`;
    console.log(chalk.bold("CloudFormation Console:"));
    console.log(chalk.cyan(`  ${consoleUrl}\n`));

    console.log(chalk.dim("─".repeat(80)));
}

/**
 * Status command implementation
 */
export async function statusCommand(options: StatusCommandOptions = {}): Promise<StatusResult> {
    const {
        profile = "default",
        awsProfile,
        configStorage,
        timer,
        exit = true,
    } = options;

    const xdg = configStorage || new XDGConfig();

    // Load configuration
    let config;
    try {
        config = xdg.readProfile(profile);
    } catch {
        const errorMsg = `Profile '${profile}' not found. Run setup first.`;
        console.error(chalk.red(`\n❌ ${errorMsg}\n`));
        return {
            success: false,
            error: errorMsg,
        };
    }

    // Check if integrated stack
    if (!config.integratedStack) {
        const errorMsg = "Status command is only available for integrated stack mode";
        console.log(chalk.yellow(`\n⚠️  ${errorMsg}\n`));
        console.log(chalk.dim("This profile is configured for standalone deployment."));
        console.log(chalk.dim("Use CloudFormation console to check webhook stack status.\n"));
        return {
            success: false,
            error: errorMsg,
        };
    }

    // Extract stack info
    const stackArn = config.quilt.stackArn;
    if (!stackArn) {
        return {
            success: false,
            error: "Quilt stack ARN not found in configuration. This command requires a Quilt stack ARN to check integration status.",
        };
    }
    const region = config.deployment.region;
    const stackName = stackArn.match(/stack\/([^/]+)\//)?.[1] || stackArn;

    // Parse timer value
    const refreshInterval = parseTimerValue(timer);

    // Setup Ctrl+C handler for graceful exit
    let shouldExit = false;
    const exitHandler = (): void => {
        shouldExit = true;
        console.log(chalk.dim("\n\n⚠️  Interrupted by user. Exiting...\n"));
        process.exit(0);
    };
    process.on("SIGINT", exitHandler);

    try {
        let result: StatusResult;
        let isFirstRun = true;

        // Watch loop
        while (true) {
            // Clear screen on subsequent runs
            if (!isFirstRun && refreshInterval) {
                clearScreen();
            }

            // Fetch and display status
            result = await fetchCompleteStatus(stackArn, stackName, region, awsProfile);

            if (!result.success) {
                console.error(chalk.red(`❌ Failed to get stack status: ${result.error}\n`));
                return result;
            }

            displayStatusResult(result, profile, config.quilt);

            // Check if we should exit (no timer or user disabled it)
            if (!refreshInterval) {
                break;
            }

            // If terminal status, announce completion and exit (unless --no-exit is set)
            if (isTerminalStatus(result.stackStatus)) {
                if (exit) {
                    if (result.stackStatus?.includes("COMPLETE") && !result.stackStatus.includes("ROLLBACK")) {
                        console.log(chalk.green("✓ Stack reached stable state. Monitoring complete.\n"));
                    } else if (result.stackStatus?.includes("FAILED") || result.stackStatus?.includes("ROLLBACK")) {
                        console.log(chalk.red("✗ Stack operation failed. Monitoring stopped.\n"));
                    } else {
                        console.log(chalk.dim("⟳ Stack reached terminal state. Auto-refresh stopped.\n"));
                    }
                    break;
                }
                // If --no-exit is set, continue monitoring even after terminal status
            }

            // Show countdown with live updates
            const totalSeconds = Math.floor(refreshInterval / 1000);
            const spinner = ora({
                text: chalk.dim(`⟳ Refreshing in ${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}... (Ctrl+C to exit)`),
                color: "gray",
            }).start();

            for (let i = totalSeconds; i > 0; i--) {
                spinner.text = chalk.dim(`⟳ Refreshing in ${i} second${i !== 1 ? "s" : ""}... (Ctrl+C to exit)`);
                await sleep(1000);
                if (shouldExit) break;
            }

            spinner.stop();

            if (shouldExit) {
                break;
            }

            isFirstRun = false;
        }

        // Clean up handler
        process.off("SIGINT", exitHandler);

        return result!;
    } catch (error) {
        // Clean up handler on error
        process.off("SIGINT", exitHandler);
        throw error;
    }
}
