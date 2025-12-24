/**
 * Service Resolver for Deployment-Time Configuration
 *
 * Resolves Quilt service endpoints from CloudFormation stack outputs at deployment time.
 * These values are then passed as explicit environment variables to the container,
 * eliminating the need for runtime CloudFormation API calls.
 *
 * **Breaking Change (v0.9.0)**: Replaces runtime config-resolver with deployment-time resolution.
 *
 * @module utils/service-resolver
 * @version 1.0.0
 */

import {
    CloudFormationClient,
    DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

/**
 * Resolved Quilt service endpoints
 */
export interface QuiltServices {
    /**
     * SQS queue URL for package creation jobs
     * @example "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-packager-queue"
     */
    packagerQueueUrl: string;

    /**
     * Athena/Glue database name for catalog metadata
     * @example "quilt_catalog"
     */
    athenaUserDatabase: string;

    /**
     * Quilt catalog domain (without protocol or trailing slash)
     * @example "quilt.example.com"
     */
    quiltWebHost: string;

    /**
     * Athena workgroup for user queries (optional, from Quilt stack discovery)
     * @example "quilt-user-workgroup"
     */
    athenaUserWorkgroup?: string;

    /**
     * S3 bucket for Athena query results (optional, from Quilt stack discovery)
     * @example "aws-athena-query-results-123456789012-us-east-1"
     */
    athenaResultsBucket?: string;
}

/**
 * Options for service resolution
 */
export interface ServiceResolverOptions {
    /**
     * CloudFormation stack ARN
     */
    stackArn: string;

    /**
     * Mock CloudFormation client for testing
     */
    mockCloudFormation?: CloudFormationClient;
}

/**
 * Parsed CloudFormation stack ARN
 */
export interface ParsedStackArn {
    region: string;
    account: string;
    stackName: string;
    stackId: string;
}

/**
 * Custom error for service resolution failures
 */
export class ServiceResolverError extends Error {
    constructor(
        message: string,
        public readonly suggestion?: string,
        public readonly details?: string,
    ) {
        super(message);
        this.name = "ServiceResolverError";

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ServiceResolverError);
        }
    }

    format(): string {
        let output = `❌ Service Resolution Error: ${this.message}`;

        if (this.suggestion) {
            output += `\n   💡 ${this.suggestion}`;
        }

        if (this.details) {
            output += `\n   📝 ${this.details}`;
        }

        return output;
    }
}

/**
 * Parse CloudFormation stack ARN into components
 *
 * @param arn - CloudFormation stack ARN
 * @returns Parsed ARN components
 * @throws ServiceResolverError if ARN is invalid
 *
 * @example
 * parseStackArn('arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc-123')
 * // Returns: { region: 'us-east-1', account: '123456789012', stackName: 'QuiltStack', stackId: 'abc-123' }
 */
export function parseStackArn(arn: string): ParsedStackArn {
    const pattern =
        /^arn:aws:cloudformation:([a-z0-9-]+):(\d{12}):stack\/([^/]+)\/(.+)$/;
    const match = arn.match(pattern);

    if (!match) {
        throw new ServiceResolverError(
            `Invalid CloudFormation stack ARN format: ${arn}`,
            "Stack ARN should match pattern: arn:aws:cloudformation:REGION:ACCOUNT:stack/STACK_NAME/STACK_ID",
        );
    }

    return {
        region: match[1],
        account: match[2],
        stackName: match[3],
        stackId: match[4],
    };
}

/**
 * Normalize catalog URL to hostname only
 *
 * Removes protocol prefix (http:// or https://) and trailing slashes.
 *
 * @param url - Catalog URL or hostname
 * @returns Normalized hostname
 *
 * @example
 * normalizeCatalogUrl('https://quilt.example.com/') // Returns: 'quilt.example.com'
 * normalizeCatalogUrl('quilt.example.com') // Returns: 'quilt.example.com'
 */
export function normalizeCatalogUrl(url: string): string {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Validate SQS queue URL format
 *
 * @param url - SQS queue URL
 * @returns true if valid
 * @throws ServiceResolverError if invalid
 */
export function validateQueueUrl(url: string): boolean {
    const pattern =
        /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/.+$/;

    if (!pattern.test(url)) {
        throw new ServiceResolverError(
            `Invalid SQS queue URL format: ${url}`,
            "Queue URL should match pattern: https://sqs.REGION.amazonaws.com/ACCOUNT/QUEUE_NAME",
        );
    }

    return true;
}

/**
 * Resolve Quilt service endpoints from CloudFormation stack outputs
 *
 * Queries the CloudFormation stack at deployment time to extract service endpoints.
 * These are then passed as explicit environment variables to the container.
 *
 * **Required Stack Outputs**:
 * - `PackagerQueueUrl`: SQS queue URL for package creation
 * - `UserAthenaDatabaseName`: Athena database name for catalog
 * - `QuiltWebHost`: Quilt catalog web host (e.g., catalog.example.com)
 *
 * **Optional Stack Outputs**:
 * - `UserAthenaWorkgroupName`: Athena workgroup for user queries
 * - `AthenaResultsBucketName`: S3 bucket for Athena query results
 *
 * @param options - Service resolver options
 * @returns Resolved service endpoints
 * @throws ServiceResolverError if required outputs are missing or invalid
 *
 * @example
 * const services = await resolveQuiltServices({
 *   stackArn: 'arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/id'
 * });
 * // Returns:
 * // {
 * //   packagerQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/quilt-queue',
 * //   athenaUserDatabase: 'quilt_catalog',
 * //   quiltWebHost: 'quilt.example.com',
 * //   athenaUserWorkgroup: 'quilt-user-workgroup' (optional),
 * //   athenaResultsBucket: 'aws-athena-query-results-...' (optional)
 * // }
 */
export async function resolveQuiltServices(
    options: ServiceResolverOptions,
): Promise<QuiltServices> {
    // Step 1: Parse stack ARN
    const parsed = parseStackArn(options.stackArn);

    // Step 2: Create CloudFormation client
    const cfnClient =
        options.mockCloudFormation ||
        new CloudFormationClient({ region: parsed.region });

    // Step 3: Query stack outputs
    const command = new DescribeStacksCommand({
        StackName: options.stackArn,
    });

    let response;
    try {
        response = await cfnClient.send(command);
    } catch (error) {
        throw new ServiceResolverError(
            `Failed to describe CloudFormation stack: ${options.stackArn}`,
            "Verify the stack ARN is correct and your AWS credentials have cloudformation:DescribeStacks permission",
            error instanceof Error ? error.message : String(error),
        );
    }

    if (!response.Stacks || response.Stacks.length === 0) {
        throw new ServiceResolverError(
            `CloudFormation stack not found: ${options.stackArn}`,
            "Verify the stack exists and has not been deleted",
        );
    }

    const stack = response.Stacks[0];
    const outputs: Record<string, string> = {};

    if (stack.Outputs) {
        for (const output of stack.Outputs) {
            if (output.OutputKey && output.OutputValue) {
                outputs[output.OutputKey] = output.OutputValue;
            }
        }
    }

    // Step 4: Extract and validate required services
    const packagerQueueUrl = outputs.PackagerQueueUrl;
    if (!packagerQueueUrl) {
        throw new ServiceResolverError(
            "Required stack output 'PackagerQueueUrl' not found",
            "Verify the Quilt CloudFormation stack includes PackagerQueueUrl output",
            `Available outputs: ${Object.keys(outputs).join(", ")}`,
        );
    }

    validateQueueUrl(packagerQueueUrl);

    const athenaUserDatabase = outputs.UserAthenaDatabaseName;
    if (!athenaUserDatabase) {
        throw new ServiceResolverError(
            "Required stack output 'UserAthenaDatabaseName' not found",
            "Verify the Quilt CloudFormation stack includes UserAthenaDatabaseName output",
            `Available outputs: ${Object.keys(outputs).join(", ")}`,
        );
    }

    // Step 5: Resolve catalog URL from QuiltWebHost output
    if (!outputs.QuiltWebHost) {
        throw new ServiceResolverError(
            "No QuiltWebHost output found",
            "Quilt stack must provide QuiltWebHost output",
            `Available outputs: ${Object.keys(outputs).join(", ")}`,
        );
    }

    const quiltWebHost = normalizeCatalogUrl(outputs.QuiltWebHost);

    // Step 6: Extract optional Athena resources (NEW - from Quilt stack discovery)
    const athenaUserWorkgroup = outputs.UserAthenaWorkgroupName;
    const athenaResultsBucket = outputs.AthenaResultsBucketName;

    return {
        packagerQueueUrl,
        athenaUserDatabase,
        quiltWebHost,
        ...(athenaUserWorkgroup && { athenaUserWorkgroup }),
        ...(athenaResultsBucket && { athenaResultsBucket }),
    };
}
