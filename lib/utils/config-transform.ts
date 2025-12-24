/**
 * Configuration Transformation Utilities
 *
 * Transforms ProfileConfig (XDG user configuration) into StackConfig (minimal CDK interface).
 * This module implements the separation between user-facing configuration and infrastructure needs.
 *
 * **Key principles:**
 * - ProfileConfig contains ALL configuration (wizard, deployment, runtime)
 * - StackConfig contains ONLY infrastructure-related fields
 * - Transformation is one-way: ProfileConfig → StackConfig
 * - Validation ensures required fields are present
 *
 * @module utils/config-transform
 * @version 0.10.0
 */

import type { ProfileConfig, ValidationResult } from "../types/config";
import type { StackConfig } from "../types/stack-config";

/**
 * Transform ProfileConfig to StackConfig
 *
 * Extracts only the fields required by the CDK stack infrastructure from the full ProfileConfig.
 * This creates a clean separation between user configuration and infrastructure needs.
 *
 * **Transformation logic:**
 * - Benchling: Only secretArn (credentials stored in secret)
 * - Quilt: Service endpoints (catalog, database, queueUrl, region, writeRoleArn)
 * - Deployment: Infrastructure settings (region, imageTag, vpc, stackName)
 * - Security: Optional IP allowlist
 *
 * **Excluded fields:**
 * - benchling.tenant, clientId, appDefinitionId (read from secret at runtime)
 * - packages.* (passed as environment variables)
 * - logging.* (passed as environment variables)
 * - _metadata, _inherits (wizard metadata)
 *
 * @param profile - Full profile configuration from XDG
 * @returns Minimal stack configuration for CDK
 * @throws Error if required fields are missing
 *
 * @example
 * ```typescript
 * const profile = XDGConfig.readProfile("default");
 * const stackConfig = profileToStackConfig(profile);
 * createStack(stackConfig); // Pass to CDK stack
 * ```
 */
export function profileToStackConfig(profile: ProfileConfig): StackConfig {
    // Validate required fields first
    const validation = validateStackConfig(profile);
    if (!validation.isValid) {
        const errors = validation.errors.join("\n  - ");
        throw new Error(`Invalid profile configuration for stack deployment:\n  - ${errors}`);
    }

    // Build minimal StackConfig with only required fields
    const stackConfig: StackConfig = {
        benchling: {
            secretArn: profile.benchling.secretArn!,
        },
        quilt: {
            catalog: profile.quilt.catalog,
            database: profile.quilt.database,
            queueUrl: profile.quilt.queueUrl,
            region: profile.quilt.region,
        },
        deployment: {
            region: profile.deployment.region,
        },
    };

    // Add optional fields if present

    // Quilt write role ARN (for S3 access)
    if (profile.quilt.writeRoleArn) {
        stackConfig.quilt.writeRoleArn = profile.quilt.writeRoleArn;
    }

    // Deployment image tag
    if (profile.deployment.imageTag) {
        stackConfig.deployment.imageTag = profile.deployment.imageTag;
    }

    // VPC configuration
    if (profile.deployment.vpc) {
        stackConfig.deployment.vpc = profile.deployment.vpc;
    }

    // Stack name
    if (profile.deployment.stackName) {
        stackConfig.deployment.stackName = profile.deployment.stackName;
    }

    // Security configuration
    if (profile.security?.webhookAllowList) {
        stackConfig.security = {
            webhookAllowList: profile.security.webhookAllowList,
        };
    }

    return stackConfig;
}

/**
 * Validate ProfileConfig for stack deployment
 *
 * Checks that all required fields for CDK stack creation are present and valid.
 * This validation is run before transformation to provide clear error messages.
 *
 * **Required fields:**
 * - benchling.secretArn (secret must exist in AWS Secrets Manager)
 * - quilt.catalog (catalog domain)
 * - quilt.database (Athena database name)
 * - quilt.queueUrl (SQS queue URL)
 * - quilt.region (AWS region)
 * - deployment.region (deployment region)
 *
 * **Optional fields:**
 * - quilt.writeRoleArn (IAM role for S3 access)
 * - deployment.imageTag (defaults to "latest")
 * - deployment.vpc (defaults to creating new VPC)
 * - deployment.stackName (auto-generated from profile name)
 * - security.webhookAllowList (defaults to no IP filtering)
 *
 * @param config - Profile configuration to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const profile = XDGConfig.readProfile("default");
 * const result = validateStackConfig(profile);
 *
 * if (!result.isValid) {
 *   console.error("Configuration errors:");
 *   result.errors.forEach(err => console.error(`  - ${err}`));
 *   process.exit(1);
 * }
 *
 * if (result.warnings && result.warnings.length > 0) {
 *   console.warn("Configuration warnings:");
 *   result.warnings.forEach(warn => console.warn(`  - ${warn}`));
 * }
 * ```
 */
export function validateStackConfig(config: ProfileConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required Benchling fields
    if (!config.benchling) {
        errors.push("Missing 'benchling' configuration section");
    } else {
        if (!config.benchling.secretArn) {
            errors.push("Missing 'benchling.secretArn' - run 'npm run setup:sync-secrets' to create secret");
        } else if (!config.benchling.secretArn.startsWith("arn:aws:secretsmanager:")) {
            errors.push(`Invalid 'benchling.secretArn' format: ${config.benchling.secretArn}`);
        }
    }

    // Validate required Quilt fields
    if (!config.quilt) {
        errors.push("Missing 'quilt' configuration section");
    } else {
        if (!config.quilt.catalog) {
            errors.push("Missing 'quilt.catalog' - run 'npm run setup' to configure");
        }
        if (!config.quilt.database) {
            errors.push("Missing 'quilt.database' - run 'npm run setup' to configure");
        }
        if (!config.quilt.queueUrl) {
            errors.push("Missing 'quilt.queueUrl' - run 'npm run setup' to configure");
        } else if (!config.quilt.queueUrl.startsWith("https://sqs.")) {
            errors.push(`Invalid 'quilt.queueUrl' format: ${config.quilt.queueUrl}`);
        }
        if (!config.quilt.region) {
            errors.push("Missing 'quilt.region' - run 'npm run setup' to configure");
        }

        // Optional but recommended fields
        if (!config.quilt.writeRoleArn) {
            warnings.push("Missing 'quilt.writeRoleArn' - S3 write operations may fail");
        } else if (!config.quilt.writeRoleArn.startsWith("arn:aws:iam::")) {
            errors.push(`Invalid 'quilt.writeRoleArn' format: ${config.quilt.writeRoleArn}`);
        }
    }

    // Validate required deployment fields
    if (!config.deployment) {
        errors.push("Missing 'deployment' configuration section");
    } else {
        if (!config.deployment.region) {
            errors.push("Missing 'deployment.region' - run 'npm run setup' to configure");
        }

        // Validate VPC configuration if present
        if (config.deployment.vpc) {
            const vpc = config.deployment.vpc;

            if (vpc.vpcId) {
                // If VPC ID is specified, validate required subnet fields
                if (!vpc.privateSubnetIds || vpc.privateSubnetIds.length < 2) {
                    errors.push("VPC configuration requires at least 2 private subnets in different AZs");
                }
                if (!vpc.availabilityZones || vpc.availabilityZones.length < 2) {
                    errors.push("VPC configuration requires at least 2 availability zones");
                }
                if (!vpc.vpcCidrBlock) {
                    warnings.push("Missing 'deployment.vpc.vpcCidrBlock' - CDK synthesis may fail");
                }
            }
        }
    }

    // Validate security configuration if present
    if (config.security?.webhookAllowList) {
        const allowList = config.security.webhookAllowList.trim();
        if (allowList.length > 0) {
            // Basic validation: check for valid CIDR blocks
            const cidrs = allowList.split(",").map(s => s.trim());
            for (const cidr of cidrs) {
                if (!isValidCidr(cidr)) {
                    errors.push(`Invalid CIDR block in webhookAllowList: ${cidr}`);
                }
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}

/**
 * Validate CIDR block format
 *
 * Checks if a string is a valid IPv4 CIDR block (e.g., "192.168.1.0/24")
 * or a single IP address (e.g., "192.168.1.1")
 *
 * @param cidr - CIDR block string to validate
 * @returns True if valid, false otherwise
 *
 * @internal
 */
function isValidCidr(cidr: string): boolean {
    // Simple regex for IPv4 CIDR validation
    // Format: xxx.xxx.xxx.xxx/yy or xxx.xxx.xxx.xxx
    const cidrPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

    if (!cidrPattern.test(cidr)) {
        return false;
    }

    // Validate IP octets (0-255)
    const parts = cidr.split("/");
    const ip = parts[0];
    const octets = ip.split(".");

    for (const octet of octets) {
        const num = parseInt(octet, 10);
        if (num < 0 || num > 255) {
            return false;
        }
    }

    // Validate CIDR prefix (0-32)
    if (parts.length === 2) {
        const prefix = parseInt(parts[1], 10);
        if (prefix < 0 || prefix > 32) {
            return false;
        }
    }

    return true;
}
