/**
 * ECS Service Discovery Utilities
 *
 * Shared utilities for discovering ECS services and their log groups
 * from CloudFormation stacks. Used by both status and logs commands.
 *
 * @module utils/ecs-service-discovery
 */

import type { fromIni } from "@aws-sdk/credential-providers";

export interface ECSServiceInfo {
    serviceName: string;
    containerName?: string;
    logGroup?: string;
    logStreamPrefix?: string;
}

export interface ECSServiceDiscoveryOptions {
    /**
     * Optional patterns to filter containers by their log stream prefix.
     * Only containers whose logStreamPrefix starts with one of these patterns will be included.
     * If not specified, all containers are included.
     * Example: ['benchling/', 'benchling-nginx/']
     */
    containerFilterPatterns?: string[];
}

/**
 * Discover all ECS services in a CloudFormation stack and their log groups
 *
 * @param stackName - CloudFormation stack name
 * @param region - AWS region
 * @param awsProfile - Optional AWS profile name
 * @returns Map of service names to log group names
 */
export async function discoverECSServiceLogGroups(
    stackName: string,
    region: string,
    awsProfile?: string,
): Promise<Record<string, string>> {
    try {
        const { CloudFormationClient, DescribeStackResourcesCommand } = await import("@aws-sdk/client-cloudformation");
        const { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand } = await import("@aws-sdk/client-ecs");

        // Configure AWS SDK clients
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            const { fromIni: fromIniImport } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIniImport({ profile: awsProfile });
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
            return {};
        }

        // Get cluster name
        const clusterResource = resourcesResponse.StackResources?.find(
            (r) => r.ResourceType === "AWS::ECS::Cluster",
        );
        const clusterName = clusterResource?.PhysicalResourceId || stackName;

        // Get service ARNs
        const serviceArns = ecsServices
            .map((s) => s.PhysicalResourceId)
            .filter((arn): arn is string => !!arn);

        if (serviceArns.length === 0) {
            return {};
        }

        // Describe all services
        const servicesCommand = new DescribeServicesCommand({
            cluster: clusterName,
            services: serviceArns,
        });
        const servicesResponse = await ecsClient.send(servicesCommand);

        // Get log groups from ALL services
        const logGroups: Record<string, string> = {};

        for (const svc of servicesResponse.services || []) {
            const taskDefArn = svc.deployments?.[0]?.taskDefinition;
            if (!taskDefArn) continue;

            try {
                const taskDefCommand = new DescribeTaskDefinitionCommand({
                    taskDefinition: taskDefArn,
                });
                const taskDefResponse = await ecsClient.send(taskDefCommand);

                const logConfig = taskDefResponse.taskDefinition?.containerDefinitions?.[0]?.logConfiguration;
                if (logConfig?.logDriver === "awslogs") {
                    const logGroupName = logConfig.options?.["awslogs-group"];
                    if (logGroupName) {
                        const serviceName = svc.serviceName || "unknown";
                        logGroups[serviceName] = logGroupName;
                    }
                }
            } catch {
                // Skip this service if we can't get its task definition
                continue;
            }
        }

        return logGroups;
    } catch (error) {
        console.warn(`Could not discover ECS services: ${(error as Error).message}`);
        return {};
    }
}

/**
 * Discover ECS services with full information (for status command)
 *
 * @param stackName - CloudFormation stack name
 * @param region - AWS region
 * @param awsProfile - Optional AWS profile name
 * @param options - Optional discovery options (e.g., container filtering)
 * @returns Array of ECS service information
 */
export async function discoverECSServices(
    stackName: string,
    region: string,
    awsProfile?: string,
    options?: ECSServiceDiscoveryOptions,
): Promise<ECSServiceInfo[]> {
    try {
        const { CloudFormationClient, DescribeStackResourcesCommand } = await import("@aws-sdk/client-cloudformation");
        const { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand } = await import("@aws-sdk/client-ecs");

        // Configure AWS SDK clients
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            const { fromIni: fromIniImport } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIniImport({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const ecsClient = new ECSClient(clientConfig);

        // Find ECS resources in stack
        const resourcesCommand = new DescribeStackResourcesCommand({
            StackName: stackName,
        });
        const resourcesResponse = await cfClient.send(resourcesCommand);

        const ecsServiceResources = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::ECS::Service",
        ) || [];

        if (ecsServiceResources.length === 0) {
            return [];
        }

        // Get cluster name
        const clusterResource = resourcesResponse.StackResources?.find(
            (r) => r.ResourceType === "AWS::ECS::Cluster",
        );
        const clusterName = clusterResource?.PhysicalResourceId || stackName;

        // Get service ARNs
        const serviceArns = ecsServiceResources
            .map((s) => s.PhysicalResourceId)
            .filter((arn): arn is string => !!arn);

        if (serviceArns.length === 0) {
            return [];
        }

        // Describe all services
        const servicesCommand = new DescribeServicesCommand({
            cluster: clusterName,
            services: serviceArns,
        });
        const servicesResponse = await ecsClient.send(servicesCommand);

        // Get log groups from task definitions
        // IMPORTANT: Return one entry per CONTAINER, not per service
        // Multi-container services (like benchling with nginx + app) need separate entries
        const services: ECSServiceInfo[] = [];

        for (const svc of servicesResponse.services || []) {
            const taskDefArn = svc.deployments?.[0]?.taskDefinition;
            if (!taskDefArn) {
                continue;
            }

            try {
                const taskDefCommand = new DescribeTaskDefinitionCommand({
                    taskDefinition: taskDefArn,
                });
                const taskDefResponse = await ecsClient.send(taskDefCommand);

                // Iterate through ALL containers in the task definition
                const containers = taskDefResponse.taskDefinition?.containerDefinitions || [];
                for (const container of containers) {
                    const logConfig = container.logConfiguration;
                    if (logConfig?.logDriver === "awslogs") {
                        const logGroup = logConfig.options?.["awslogs-group"];
                        const awslogsStreamPrefix = logConfig.options?.["awslogs-stream-prefix"];

                        // ECS log streams follow the pattern: {awslogs-stream-prefix}/{container-name}/{task-id}
                        // So we need to construct the full prefix including the container name
                        const fullStreamPrefix = awslogsStreamPrefix && container.name
                            ? `${awslogsStreamPrefix}/${container.name}`
                            : awslogsStreamPrefix;

                        if (logGroup && fullStreamPrefix) {
                            // Apply container filter if specified
                            if (options?.containerFilterPatterns && options.containerFilterPatterns.length > 0) {
                                const matchesFilter = options.containerFilterPatterns.some(
                                    (pattern) => fullStreamPrefix.startsWith(pattern),
                                );
                                if (!matchesFilter) {
                                    continue; // Skip this container
                                }
                            }

                            services.push({
                                serviceName: svc.serviceName || "unknown",
                                containerName: container.name,
                                logGroup,
                                logStreamPrefix: fullStreamPrefix,
                            });
                        }
                    }
                }
            } catch {
                // Skip this service if we can't get task definition
                continue;
            }
        }

        return services;
    } catch (error) {
        console.warn(`Could not discover ECS services: ${(error as Error).message}`);
        return [];
    }
}
