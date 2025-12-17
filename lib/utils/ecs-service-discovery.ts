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
    logGroup?: string;
    logStreamPrefix?: string;
}

export interface APIGatewayLogInfo {
    apiId: string;
    apiName: string;
    accessLogGroup?: string;
    executionLogGroup?: string;
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
 * @returns Array of ECS service information
 */
export async function discoverECSServices(
    stackName: string,
    region: string,
    awsProfile?: string,
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
        const services: ECSServiceInfo[] = [];

        for (const svc of servicesResponse.services || []) {
            let logGroup: string | undefined;
            let logStreamPrefix: string | undefined;

            const taskDefArn = svc.deployments?.[0]?.taskDefinition;
            if (taskDefArn) {
                try {
                    const taskDefCommand = new DescribeTaskDefinitionCommand({
                        taskDefinition: taskDefArn,
                    });
                    const taskDefResponse = await ecsClient.send(taskDefCommand);

                    const logConfig = taskDefResponse.taskDefinition?.containerDefinitions?.[0]?.logConfiguration;
                    if (logConfig?.logDriver === "awslogs") {
                        logGroup = logConfig.options?.["awslogs-group"];
                        logStreamPrefix = logConfig.options?.["awslogs-stream-prefix"];
                    }
                } catch {
                    // Skip log group if we can't get task definition
                }
            }

            services.push({
                serviceName: svc.serviceName || "unknown",
                logGroup,
                logStreamPrefix,
            });
        }

        return services;
    } catch (error) {
        console.warn(`Could not discover ECS services: ${(error as Error).message}`);
        return [];
    }
}

/**
 * Discover API Gateway APIs (both REST v1 and HTTP v2) in a CloudFormation stack and their log groups
 *
 * @param stackNameOrArn - CloudFormation stack name or ARN
 * @param region - AWS region
 * @param awsProfile - Optional AWS profile name
 * @returns Array of API Gateway log information
 */
export async function discoverAPIGatewayLogs(
    stackNameOrArn: string,
    region: string,
    awsProfile?: string,
): Promise<APIGatewayLogInfo[]> {
    try {
        const { CloudFormationClient, DescribeStackResourcesCommand } = await import("@aws-sdk/client-cloudformation");
        const { ApiGatewayV2Client, GetStageCommand: GetStageV2Command, GetApiCommand: GetApiV2Command } = await import("@aws-sdk/client-apigatewayv2");
        const { APIGatewayClient, GetStageCommand: GetStageV1Command, GetRestApiCommand } = await import("@aws-sdk/client-api-gateway");

        // Configure AWS SDK clients
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            const { fromIni: fromIniImport } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIniImport({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);
        const apigwV2Client = new ApiGatewayV2Client(clientConfig);
        const apigwV1Client = new APIGatewayClient(clientConfig);

        // Find API Gateway resources in stack (accepts both ARN and name)
        const resourcesCommand = new DescribeStackResourcesCommand({
            StackName: stackNameOrArn,
        });
        const resourcesResponse = await cfClient.send(resourcesCommand);

        // Find both REST API v1 and HTTP API v2 resources
        const restApis = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::ApiGateway::RestApi",
        ) || [];

        const httpApis = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::ApiGatewayV2::Api",
        ) || [];

        if (restApis.length === 0 && httpApis.length === 0) {
            return [];
        }

        const apiInfos: APIGatewayLogInfo[] = [];

        // Process REST API v1 resources
        for (const apiResource of restApis) {
            const apiId = apiResource.PhysicalResourceId;
            if (!apiId) continue;

            try {
                // Get API name
                const apiCommand = new GetRestApiCommand({ restApiId: apiId });
                const apiResponse = await apigwV1Client.send(apiCommand);
                const apiName = apiResponse.name || apiId;

                // Find stages for this REST API
                const stageResources = resourcesResponse.StackResources?.filter(
                    (r) => r.ResourceType === "AWS::ApiGateway::Stage" &&
                           r.PhysicalResourceId?.includes(apiId),
                ) || [];

                let accessLogGroup: string | undefined;
                let executionLogGroup: string | undefined;

                // Check each stage for log configuration
                for (const stageResource of stageResources) {
                    // For REST API, stage name is the logical resource ID or extracted from physical ID
                    const stageName = stageResource.PhysicalResourceId?.split("/").pop();
                    if (!stageName) continue;

                    try {
                        const stageCommand = new GetStageV1Command({
                            restApiId: apiId,
                            stageName: stageName,
                        });
                        const stageResponse = await apigwV1Client.send(stageCommand);

                        // Access logs
                        if (stageResponse.accessLogSettings?.destinationArn) {
                            const logGroupMatch = stageResponse.accessLogSettings.destinationArn.match(
                                /log-group:([^:]+)/,
                            );
                            if (logGroupMatch) {
                                accessLogGroup = logGroupMatch[1];
                            }
                        }

                        // Execution logs (CloudWatch Logs for REST API)
                        if (stageResponse.methodSettings?.["*/*"]?.loggingLevel) {
                            // REST API execution logs use this pattern
                            executionLogGroup = `API-Gateway-Execution-Logs_${apiId}/${stageName}`;
                        }
                    } catch {
                        // Skip this stage if we can't get its configuration
                        continue;
                    }
                }

                if (accessLogGroup || executionLogGroup) {
                    apiInfos.push({
                        apiId,
                        apiName,
                        accessLogGroup,
                        executionLogGroup,
                    });
                }
            } catch {
                // Skip this API if we can't get its details
                continue;
            }
        }

        // Process HTTP API v2 resources
        for (const apiResource of httpApis) {
            const apiId = apiResource.PhysicalResourceId;
            if (!apiId) continue;

            try {
                // Get API name
                const apiCommand = new GetApiV2Command({ ApiId: apiId });
                const apiResponse = await apigwV2Client.send(apiCommand);
                const apiName = apiResponse.Name || apiId;

                // Find stages for this HTTP API
                // Note: For HTTP API v2, stage PhysicalResourceId is just the stage name (e.g., "$default", "prod")
                // We need to try all stages since we can't filter by API ID
                const stageResources = resourcesResponse.StackResources?.filter(
                    (r) => r.ResourceType === "AWS::ApiGatewayV2::Stage",
                ) || [];

                let accessLogGroup: string | undefined;
                let executionLogGroup: string | undefined;

                // Check each stage for log configuration
                for (const stageResource of stageResources) {
                    // For HTTP API v2, the PhysicalResourceId is just the stage name
                    const stageName = stageResource.PhysicalResourceId;
                    if (!stageName) continue;

                    try {
                        const stageCommand = new GetStageV2Command({
                            ApiId: apiId,
                            StageName: stageName,
                        });
                        const stageResponse = await apigwV2Client.send(stageCommand);

                        // Access logs
                        if (stageResponse.AccessLogSettings?.DestinationArn) {
                            // ARN format: arn:aws:logs:region:account:log-group:log-group-name
                            // or arn:aws:logs:region:account:log-group:log-group-name:*
                            const destinationArn = stageResponse.AccessLogSettings.DestinationArn;
                            const logGroupMatch = destinationArn.match(/log-group:([^:*]+)/);
                            if (logGroupMatch) {
                                accessLogGroup = logGroupMatch[1];
                            }
                        }

                        // Execution logs (if detailed metrics are enabled)
                        if (stageResponse.DefaultRouteSettings?.DetailedMetricsEnabled) {
                            // HTTP API v2 execution logs are automatically created with pattern
                            executionLogGroup = `API-Gateway-Execution-Logs_${apiId}/${stageName}`;
                        }

                        // If we found logs for this stage, we can stop checking other stages
                        if (accessLogGroup || executionLogGroup) {
                            break;
                        }
                    } catch (stageError) {
                        // This stage might belong to a different API, continue trying others
                        continue;
                    }
                }

                if (accessLogGroup || executionLogGroup) {
                    apiInfos.push({
                        apiId,
                        apiName,
                        accessLogGroup,
                        executionLogGroup,
                    });
                }
            } catch {
                // Skip this API if we can't get its details
                continue;
            }
        }

        return apiInfos;
    } catch (error) {
        console.warn(`Could not discover API Gateway logs: ${(error as Error).message}`);
        return [];
    }
}

/**
 * Discover API Gateway log groups from a CloudFormation stack (simplified version for logs command)
 *
 * @param stackNameOrArn - CloudFormation stack name or ARN
 * @param region - AWS region
 * @param awsProfile - Optional AWS profile name
 * @returns Map of log types to log group names
 */
export async function discoverAPIGatewayLogGroups(
    stackNameOrArn: string,
    region: string,
    awsProfile?: string,
): Promise<Record<string, string>> {
    const apiInfos = await discoverAPIGatewayLogs(stackNameOrArn, region, awsProfile);

    const logGroups: Record<string, string> = {};

    for (const apiInfo of apiInfos) {
        if (apiInfo.accessLogGroup) {
            logGroups["api-gateway-access"] = apiInfo.accessLogGroup;
        }
        if (apiInfo.executionLogGroup) {
            logGroups["api-gateway-execution"] = apiInfo.executionLogGroup;
        }
    }

    // Fallback: Also search for log groups directly by logical ID patterns
    // This handles cases where log groups are created separately and not discoverable via stage settings
    if (Object.keys(logGroups).length === 0) {
        const directLogGroups = await discoverLogGroupsDirectly(stackNameOrArn, region, awsProfile);
        Object.assign(logGroups, directLogGroups);
    }

    return logGroups;
}

/**
 * Restart all ECS services in a CloudFormation stack to pick up updated secrets
 *
 * @param stackNameOrArn - CloudFormation stack name or ARN
 * @param region - AWS region
 * @param awsProfile - Optional AWS profile name
 * @returns Array of restarted service names
 */
export async function restartECSServices(
    stackNameOrArn: string,
    region: string,
    awsProfile?: string,
): Promise<string[]> {
    try {
        const { CloudFormationClient, DescribeStackResourcesCommand } = await import("@aws-sdk/client-cloudformation");
        const { ECSClient, DescribeServicesCommand, UpdateServiceCommand } = await import("@aws-sdk/client-ecs");

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
            StackName: stackNameOrArn,
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
        const clusterName = clusterResource?.PhysicalResourceId;

        if (!clusterName) {
            console.warn("Could not find ECS cluster in stack");
            return [];
        }

        // Get service ARNs
        const serviceArns = ecsServiceResources
            .map((s) => s.PhysicalResourceId)
            .filter((arn): arn is string => !!arn);

        if (serviceArns.length === 0) {
            return [];
        }

        // Describe all services to get their names
        const servicesCommand = new DescribeServicesCommand({
            cluster: clusterName,
            services: serviceArns,
        });
        const servicesResponse = await ecsClient.send(servicesCommand);

        const restartedServices: string[] = [];

        // Restart each service
        for (const svc of servicesResponse.services || []) {
            if (!svc.serviceName) continue;

            try {
                await ecsClient.send(new UpdateServiceCommand({
                    cluster: clusterName,
                    service: svc.serviceName,
                    forceNewDeployment: true,
                }));
                restartedServices.push(svc.serviceName);
            } catch (error) {
                console.warn(`Failed to restart service ${svc.serviceName}: ${(error as Error).message}`);
            }
        }

        return restartedServices;
    } catch (error) {
        console.warn(`Could not restart ECS services: ${(error as Error).message}`);
        return [];
    }
}

/**
 * Discover log groups directly from CloudFormation stack resources
 * This is a fallback for integrated stacks where log groups are created separately
 *
 * @param stackNameOrArn - CloudFormation stack name or ARN
 * @param region - AWS region
 * @param awsProfile - Optional AWS profile name
 * @returns Map of log types to log group names
 */
async function discoverLogGroupsDirectly(
    stackNameOrArn: string,
    region: string,
    awsProfile?: string,
): Promise<Record<string, string>> {
    try {
        const { CloudFormationClient, DescribeStackResourcesCommand } = await import("@aws-sdk/client-cloudformation");

        // Configure AWS SDK client
        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            const { fromIni: fromIniImport } = await import("@aws-sdk/credential-providers");
            clientConfig.credentials = fromIniImport({ profile: awsProfile });
        }

        const cfClient = new CloudFormationClient(clientConfig);

        // Get all stack resources
        const resourcesCommand = new DescribeStackResourcesCommand({
            StackName: stackNameOrArn,
        });
        const resourcesResponse = await cfClient.send(resourcesCommand);

        // Find log group resources
        const logGroupResources = resourcesResponse.StackResources?.filter(
            (r) => r.ResourceType === "AWS::Logs::LogGroup",
        ) || [];

        const logGroups: Record<string, string> = {};

        // Match log groups by logical ID patterns
        for (const resource of logGroupResources) {
            const logicalId = resource.LogicalResourceId || "";
            const physicalId = resource.PhysicalResourceId;

            if (!physicalId) continue;

            // Match API Gateway access log patterns
            if (logicalId.match(/Api.*Log/i) || logicalId.match(/Benchling.*Log/i) || physicalId.match(/api.*access/i)) {
                logGroups["api-gateway-access"] = physicalId;
            }
            // Match API Gateway execution log patterns
            else if (logicalId.match(/Execution.*Log/i) || physicalId.match(/execution/i)) {
                logGroups["api-gateway-execution"] = physicalId;
            }
        }

        return logGroups;
    } catch (error) {
        console.warn(`Could not discover log groups directly: ${(error as Error).message}`);
        return {};
    }
}
