/**
 * AWS Provider using AWS CLI via execSync
 *
 * This is the default implementation that maintains backward compatibility
 * with the original hardcoded execSync calls.
 */

import { execSync } from "child_process";
import { IAwsProvider, StackDetails } from "../interfaces/aws-provider";

export class ExecSyncAwsProvider implements IAwsProvider {
    async findStackByResource(region: string, resourceId: string): Promise<string | null> {
        try {
            const result = execSync(
                `aws cloudformation describe-stack-resources --region ${region} --physical-resource-id "${resourceId}" --query "StackResources[0].StackName" --output text 2>/dev/null`,
                { encoding: "utf-8" },
            );
            const stackName = result.trim();
            return stackName && stackName !== "None" ? stackName : null;
        } catch {
            return null;
        }
    }

    async getStackDetails(region: string, stackName: string): Promise<StackDetails> {
        try {
            const outputsResult = execSync(
                `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Outputs" --output json`,
                { encoding: "utf-8" },
            );

            const paramsResult = execSync(
                `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Parameters" --output json`,
                { encoding: "utf-8" },
            );

            return {
                outputs: JSON.parse(outputsResult) || [],
                parameters: JSON.parse(paramsResult) || [],
            };
        } catch (error) {
            console.error(
                `Warning: Could not get stack details: ${(error as Error).message}`,
            );
            return { outputs: [], parameters: [] };
        }
    }

    async getAccountId(): Promise<string | null> {
        try {
            const result = execSync("aws sts get-caller-identity --query Account --output text", {
                encoding: "utf-8",
            });
            return result.trim();
        } catch {
            return null;
        }
    }
}
