/**
 * Stack polling helpers for setup wizard flow.
 *
 * @module wizard/stack-waiter
 */

import chalk from "chalk";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromIni } from "@aws-sdk/credential-providers";

interface StackPollOptions {
    stackArn: string;
    region: string;
    awsProfile?: string;
    timeoutMs?: number;
    intervalMs?: number;
}

const TERMINAL_STATUSES = new Set([
    "CREATE_COMPLETE",
    "UPDATE_COMPLETE",
    "UPDATE_ROLLBACK_COMPLETE",
    "ROLLBACK_COMPLETE",
    "CREATE_FAILED",
    "UPDATE_FAILED",
]);

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll stack status until it reaches a terminal state or times out.
 */
export async function pollStackStatus(options: StackPollOptions): Promise<void> {
    const { stackArn, region, awsProfile, timeoutMs = 5 * 60 * 1000, intervalMs = 15000 } = options;

    const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
    if (awsProfile) {
        clientConfig.credentials = fromIni({ profile: awsProfile });
    }
    const client = new CloudFormationClient(clientConfig);

    const startedAt = Date.now();
    let lastStatus: string | undefined;

    while (Date.now() - startedAt < timeoutMs) {
        const response = await client.send(new DescribeStacksCommand({ StackName: stackArn }));
        const stack = response.Stacks?.[0];
        const status = stack?.StackStatus;

        if (status && status !== lastStatus) {
            console.log(chalk.dim(`  Stack status: ${status}`));
            lastStatus = status;
        }

        if (status && TERMINAL_STATUSES.has(status)) {
            return;
        }

        await sleep(intervalMs);
    }

    console.warn(chalk.yellow("⚠️  Timed out waiting for stack update to complete"));
}

/**
 * Wait for Benchling secret ARN to appear in stack outputs.
 */
export async function waitForBenchlingSecretArn(options: StackPollOptions): Promise<string> {
    const { stackArn, region, awsProfile, timeoutMs = 5 * 60 * 1000, intervalMs = 15000 } = options;

    const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = { region };
    if (awsProfile) {
        clientConfig.credentials = fromIni({ profile: awsProfile });
    }
    const client = new CloudFormationClient(clientConfig);

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const response = await client.send(new DescribeStacksCommand({ StackName: stackArn }));
        const stack = response.Stacks?.[0];
        const outputs = stack?.Outputs || [];
        const secretArn = outputs.find((output) =>
            ["BenchlingSecretArn", "BenchlingClientSecretArn", "SecretArn"].includes(output.OutputKey || ""),
        )?.OutputValue;

        if (secretArn) {
            return secretArn;
        }

        await sleep(intervalMs);
    }

    throw new Error("Timed out waiting for BenchlingSecret creation");
}
