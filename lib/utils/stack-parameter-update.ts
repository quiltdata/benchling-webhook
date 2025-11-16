/**
 * CloudFormation stack parameter update utility
 *
 * Provides safe parameter updates with UsePreviousValue for all other parameters
 *
 * @module utils/stack-parameter-update
 */

import { CloudFormationClient, UpdateStackCommand, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromIni } from "@aws-sdk/credential-providers";
import chalk from "chalk";

export interface StackParameterUpdateOptions {
    stackArn: string;
    region: string;
    parameterKey: string;
    parameterValue: string;
    awsProfile?: string;
}

export interface StackParameterUpdateResult {
    success: boolean;
    stackId?: string;
    error?: string;
}

/**
 * Updates a single CloudFormation stack parameter while preserving all others
 *
 * @param options - Update options
 * @returns Update result
 */
export async function updateStackParameter(
    options: StackParameterUpdateOptions,
): Promise<StackParameterUpdateResult> {
    const { stackArn, region, parameterKey, parameterValue, awsProfile } = options;

    try {
        // Extract stack name from ARN
        // ARN format: arn:aws:cloudformation:REGION:ACCOUNT:stack/STACK_NAME/STACK_ID
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

        // Get current stack parameters
        const describeCommand = new DescribeStacksCommand({
            StackName: stackName,
        });
        const describeResponse = await client.send(describeCommand);
        const stack = describeResponse.Stacks?.[0];

        if (!stack) {
            throw new Error(`Stack not found: ${stackName}`);
        }

        const currentParameters = stack.Parameters || [];

        // Build parameter list: update target parameter, preserve all others
        const parameters = currentParameters.map((param) => {
            if (param.ParameterKey === parameterKey) {
                return {
                    ParameterKey: parameterKey,
                    ParameterValue: parameterValue,
                };
            } else {
                return {
                    ParameterKey: param.ParameterKey!,
                    UsePreviousValue: true,
                };
            }
        });

        // Update stack
        const updateCommand = new UpdateStackCommand({
            StackName: stackName,
            Parameters: parameters,
            UsePreviousTemplate: true, // CRITICAL: Don't change template
            Capabilities: stack.Capabilities, // Preserve capabilities
        });

        const updateResponse = await client.send(updateCommand);

        return {
            success: true,
            stackId: updateResponse.StackId,
        };
    } catch (error) {
        const err = error as Error;
        // CloudFormation returns specific error if no updates are needed
        if (err.message?.includes("No updates are to be performed")) {
            return {
                success: true, // Not really an error
            };
        }
        return {
            success: false,
            error: err.message,
        };
    }
}

/**
 * Gets current value of a stack parameter
 *
 * @param stackArn - Stack ARN
 * @param region - AWS region
 * @param parameterKey - Parameter key to query
 * @param awsProfile - Optional AWS profile
 * @returns Parameter value or undefined if not found
 */
export async function getStackParameter(
    stackArn: string,
    region: string,
    parameterKey: string,
    awsProfile?: string,
): Promise<string | undefined> {
    try {
        const stackNameMatch = stackArn.match(/stack\/([^/]+)\//);
        if (!stackNameMatch) {
            throw new Error(`Invalid stack ARN format: ${stackArn}`);
        }
        const stackName = stackNameMatch[1];

        const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
        if (awsProfile) {
            clientConfig.credentials = fromIni({ profile: awsProfile });
        }
        const client = new CloudFormationClient(clientConfig);

        const describeCommand = new DescribeStacksCommand({
            StackName: stackName,
        });
        const describeResponse = await client.send(describeCommand);
        const stack = describeResponse.Stacks?.[0];

        if (!stack) {
            return undefined;
        }

        const param = stack.Parameters?.find((p) => p.ParameterKey === parameterKey);
        return param?.ParameterValue;
    } catch (error) {
        console.warn(chalk.yellow(`Warning: Could not get parameter ${parameterKey}: ${(error as Error).message}`));
        return undefined;
    }
}
