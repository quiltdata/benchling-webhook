#!/usr/bin/env node
/**
 * Configuration Health Checks
 *
 * Validates:
 * - XDG configuration integrity
 * - Secrets accessibility
 * - Benchling credential freshness
 * - AWS resource connectivity
 *
 * @module scripts/config-health-check
 */

import { XDGConfig } from "../lib/xdg-config";
import { UserConfig, DerivedConfig, DeploymentConfig, ProfileName } from "../lib/types/config";
import { existsSync, statSync } from "fs";
import { validateSecretsAccess } from "./sync-secrets";
import { ConfigLogger, LogLevel } from "../lib/config-logger";
import * as https from "https";
import { SecretsManagerClient, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";

/**
 * Health check result
 */
interface HealthCheckResult {
    check: string;
    status: "pass" | "fail" | "warn";
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Overall health status
 */
interface HealthStatus {
    overall: "healthy" | "degraded" | "unhealthy";
    checks: HealthCheckResult[];
    timestamp: string;
    profile: ProfileName;
}

/**
 * Configuration health checker
 */
export class ConfigHealthChecker {
    private logger: ConfigLogger;
    private xdgConfig: XDGConfig;
    private profile: ProfileName;

    constructor(profile: ProfileName = "default") {
        this.logger = new ConfigLogger({ minLogLevel: LogLevel.INFO });
        this.xdgConfig = new XDGConfig();
        this.profile = profile;
    }

    /**
     * Checks XDG configuration file integrity
     *
     * @returns Health check result
     */
    public async checkXDGIntegrity(): Promise<HealthCheckResult> {
        try {
            const paths = this.xdgConfig.getProfilePaths(this.profile);

            // Check if profile directory exists
            const profileDir = this.xdgConfig.getProfileDir(this.profile);
            if (!existsSync(profileDir)) {
                return {
                    check: "xdg-integrity",
                    status: "fail",
                    message: "Profile directory does not exist",
                    details: {
                        profileDir,
                        profile: this.profile,
                    },
                };
            }

            // Check for configuration files
            const files = {
                userConfig: existsSync(paths.userConfig),
                derivedConfig: existsSync(paths.derivedConfig),
                deployConfig: existsSync(paths.deployConfig),
            };

            // At least user or derived config should exist
            if (!files.userConfig && !files.derivedConfig) {
                return {
                    check: "xdg-integrity",
                    status: "warn",
                    message: "No configuration files found",
                    details: {
                        ...files,
                        profile: this.profile,
                    },
                };
            }

            // Try to read and validate existing configs
            if (files.userConfig) {
                try {
                    this.xdgConfig.readProfileConfig("user", this.profile);
                } catch (error) {
                    return {
                        check: "xdg-integrity",
                        status: "fail",
                        message: `User config validation failed: ${(error as Error).message}`,
                        details: {
                            profile: this.profile,
                            error: (error as Error).message,
                        },
                    };
                }
            }

            if (files.derivedConfig) {
                try {
                    this.xdgConfig.readProfileConfig("derived", this.profile);
                } catch (error) {
                    return {
                        check: "xdg-integrity",
                        status: "fail",
                        message: `Derived config validation failed: ${(error as Error).message}`,
                        details: {
                            profile: this.profile,
                            error: (error as Error).message,
                        },
                    };
                }
            }

            return {
                check: "xdg-integrity",
                status: "pass",
                message: "XDG configuration integrity verified",
                details: {
                    ...files,
                    profile: this.profile,
                },
            };
        } catch (error) {
            return {
                check: "xdg-integrity",
                status: "fail",
                message: `Integrity check failed: ${(error as Error).message}`,
                details: {
                    error: (error as Error).message,
                },
            };
        }
    }

    /**
     * Checks AWS Secrets Manager accessibility
     *
     * @returns Health check result
     */
    public async checkSecretsAccess(): Promise<HealthCheckResult> {
        try {
            // Load derived config to get secret ARN
            const derivedConfig = this.xdgConfig.readProfileConfig("derived", this.profile) as DerivedConfig;

            if (!derivedConfig.benchlingSecretArn) {
                return {
                    check: "secrets-access",
                    status: "warn",
                    message: "No secrets configured",
                    details: {
                        profile: this.profile,
                        recommendation: "Run sync-secrets to configure AWS Secrets Manager",
                    },
                };
            }

            // Validate secrets accessibility
            const isAccessible = await validateSecretsAccess({
                profile: this.profile,
                region: derivedConfig.cdkRegion || "us-east-1",
                awsProfile: derivedConfig.awsProfile,
            });

            if (isAccessible) {
                return {
                    check: "secrets-access",
                    status: "pass",
                    message: "Secrets accessible",
                    details: {
                        secretArn: derivedConfig.benchlingSecretArn,
                        profile: this.profile,
                    },
                };
            } else {
                return {
                    check: "secrets-access",
                    status: "fail",
                    message: "Secrets not accessible",
                    details: {
                        secretArn: derivedConfig.benchlingSecretArn,
                        profile: this.profile,
                        recommendation: "Check AWS credentials and IAM permissions",
                    },
                };
            }
        } catch (error) {
            return {
                check: "secrets-access",
                status: "fail",
                message: `Secrets access check failed: ${(error as Error).message}`,
                details: {
                    error: (error as Error).message,
                },
            };
        }
    }

    /**
     * Checks Benchling credential freshness
     *
     * @returns Health check result
     */
    public async checkBenchlingCredentials(): Promise<HealthCheckResult> {
        try {
            const userConfig = this.xdgConfig.readProfileConfig("user", this.profile) as UserConfig;

            if (!userConfig.benchlingTenant) {
                return {
                    check: "benchling-credentials",
                    status: "warn",
                    message: "No Benchling tenant configured",
                    details: {
                        profile: this.profile,
                    },
                };
            }

            // Check tenant accessibility
            const tenantUrl = `https://${userConfig.benchlingTenant}.benchling.com`;

            return new Promise((resolve) => {
                https
                    .get(tenantUrl, { timeout: 5000 }, (res) => {
                        if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
                            resolve({
                                check: "benchling-credentials",
                                status: "pass",
                                message: "Benchling tenant accessible",
                                details: {
                                    tenant: userConfig.benchlingTenant,
                                    tenantUrl,
                                },
                            });
                        } else {
                            resolve({
                                check: "benchling-credentials",
                                status: "warn",
                                message: `Tenant returned status ${res.statusCode}`,
                                details: {
                                    tenant: userConfig.benchlingTenant,
                                    statusCode: res.statusCode,
                                },
                            });
                        }
                    })
                    .on("error", (error) => {
                        resolve({
                            check: "benchling-credentials",
                            status: "fail",
                            message: `Tenant not accessible: ${error.message}`,
                            details: {
                                tenant: userConfig.benchlingTenant,
                                error: error.message,
                            },
                        });
                    });
            });
        } catch (error) {
            return {
                check: "benchling-credentials",
                status: "fail",
                message: `Credential check failed: ${(error as Error).message}`,
                details: {
                    error: (error as Error).message,
                },
            };
        }
    }

    /**
     * Checks Quilt catalog configuration
     *
     * @returns Health check result
     */
    public async checkQuiltCatalog(): Promise<HealthCheckResult> {
        try {
            const userConfig = this.xdgConfig.readProfileConfig("user", this.profile) as UserConfig;

            const catalogUrl = userConfig.quiltCatalog;

            if (!catalogUrl) {
                return {
                    check: "quilt-catalog",
                    status: "warn",
                    message: "No Quilt catalog configured",
                    details: {
                        profile: this.profile,
                        recommendation: "Run npm run setup:infer or npm run setup",
                    },
                };
            }

            // Verify required Quilt configuration fields are present
            const missingFields: string[] = [];

            if (!userConfig.quiltStackArn) {
                missingFields.push("quiltStackArn");
            }

            if (!userConfig.benchlingPkgBucket && !userConfig.quiltUserBucket) {
                missingFields.push("benchlingPkgBucket or quiltUserBucket");
            }

            if (missingFields.length > 0) {
                return {
                    check: "quilt-catalog",
                    status: "warn",
                    message: `Incomplete Quilt configuration: missing ${missingFields.join(", ")}`,
                    details: {
                        catalogUrl,
                        missingFields,
                        recommendation: "Run npm run setup:infer to complete configuration",
                    },
                };
            }

            return {
                check: "quilt-catalog",
                status: "pass",
                message: "Quilt catalog configured",
                details: {
                    catalogUrl,
                    stackArn: userConfig.quiltStackArn,
                    bucket: userConfig.benchlingPkgBucket || userConfig.quiltUserBucket,
                },
            };
        } catch (error) {
            return {
                check: "quilt-catalog",
                status: "fail",
                message: `Catalog check failed: ${(error as Error).message}`,
                details: {
                    error: (error as Error).message,
                },
            };
        }
    }

    /**
     * Checks if local config and remote secrets are in sync
     *
     * @returns Health check result
     */
    public async checkSecretsSync(): Promise<HealthCheckResult> {
        try {
            const paths = this.xdgConfig.getProfilePaths(this.profile);

            // Check if user config exists
            if (!existsSync(paths.userConfig)) {
                return {
                    check: "secrets-sync",
                    status: "warn",
                    message: "No user configuration found",
                    details: {
                        profile: this.profile,
                    },
                };
            }

            // Load derived config to get secret ARN
            const derivedConfig = this.xdgConfig.readProfileConfig("derived", this.profile) as DerivedConfig;

            if (!derivedConfig.benchlingSecretArn) {
                return {
                    check: "secrets-sync",
                    status: "warn",
                    message: "No secrets configured",
                    details: {
                        profile: this.profile,
                        recommendation: "Run npm run setup:sync-secrets to sync secrets",
                    },
                };
            }

            // Get local config modification time
            const userConfigStats = statSync(paths.userConfig);
            const localModifiedAt = userConfigStats.mtime;

            // Get remote secret modification time
            const region = derivedConfig.cdkRegion || "us-east-1";
            const clientConfig: { region: string; credentials?: any } = { region };

            if (derivedConfig.awsProfile) {
                const { fromIni } = await import("@aws-sdk/credential-providers");
                clientConfig.credentials = fromIni({ profile: derivedConfig.awsProfile });
            }

            const client = new SecretsManagerClient(clientConfig);
            const command = new DescribeSecretCommand({ SecretId: derivedConfig.benchlingSecretArn });
            const secretMetadata = await client.send(command);

            if (!secretMetadata.LastChangedDate) {
                return {
                    check: "secrets-sync",
                    status: "warn",
                    message: "Cannot determine secret modification time",
                    details: {
                        secretArn: derivedConfig.benchlingSecretArn,
                    },
                };
            }

            const remoteModifiedAt = secretMetadata.LastChangedDate;

            // Compare times (allow 1 second tolerance for filesystem precision)
            const timeDiffMs = Math.abs(localModifiedAt.getTime() - remoteModifiedAt.getTime());
            const timeDiffSeconds = Math.floor(timeDiffMs / 1000);

            if (localModifiedAt > remoteModifiedAt && timeDiffMs > 1000) {
                // Local is newer - secrets need to be synced
                const ageMinutes = Math.floor(timeDiffMs / (1000 * 60));
                const ageHours = Math.floor(ageMinutes / 60);
                const ageDays = Math.floor(ageHours / 24);

                let ageDescription;
                if (ageDays > 0) {
                    ageDescription = `${ageDays} day${ageDays > 1 ? "s" : ""}`;
                } else if (ageHours > 0) {
                    ageDescription = `${ageHours} hour${ageHours > 1 ? "s" : ""}`;
                } else {
                    ageDescription = `${ageMinutes} minute${ageMinutes > 1 ? "s" : ""}`;
                }

                return {
                    check: "secrets-sync",
                    status: "warn",
                    message: `Local config is ${ageDescription} newer than remote secrets`,
                    details: {
                        localModifiedAt: localModifiedAt.toISOString(),
                        remoteModifiedAt: remoteModifiedAt.toISOString(),
                        timeDiffSeconds,
                        recommendation: "Run npm run setup:sync-secrets --force to sync changes",
                    },
                };
            }

            return {
                check: "secrets-sync",
                status: "pass",
                message: "Local config and remote secrets are in sync",
                details: {
                    localModifiedAt: localModifiedAt.toISOString(),
                    remoteModifiedAt: remoteModifiedAt.toISOString(),
                    timeDiffSeconds,
                },
            };
        } catch (error) {
            return {
                check: "secrets-sync",
                status: "fail",
                message: `Sync check failed: ${(error as Error).message}`,
                details: {
                    error: (error as Error).message,
                },
            };
        }
    }

    /**
     * Checks deployment configuration
     *
     * @returns Health check result
     */
    public async checkDeploymentConfig(): Promise<HealthCheckResult> {
        try {
            const paths = this.xdgConfig.getProfilePaths(this.profile);

            if (!existsSync(paths.deployConfig)) {
                return {
                    check: "deployment-config",
                    status: "warn",
                    message: "No deployment configuration found",
                    details: {
                        profile: this.profile,
                        recommendation: "Deploy the stack to generate deployment configuration",
                    },
                };
            }

            const deployConfig = this.xdgConfig.readProfileConfig("deploy", this.profile) as DeploymentConfig;

            // Check for webhook endpoint
            if (!deployConfig.webhookEndpoint && !deployConfig.webhookUrl) {
                return {
                    check: "deployment-config",
                    status: "warn",
                    message: "Webhook endpoint not configured",
                    details: {
                        profile: this.profile,
                    },
                };
            }

            // Check deployment age
            if (deployConfig.deployedAt) {
                const deployedDate = new Date(deployConfig.deployedAt);
                const ageInDays = (Date.now() - deployedDate.getTime()) / (1000 * 60 * 60 * 24);

                if (ageInDays > 30) {
                    return {
                        check: "deployment-config",
                        status: "warn",
                        message: `Deployment is ${Math.floor(ageInDays)} days old`,
                        details: {
                            deployedAt: deployConfig.deployedAt,
                            ageInDays: Math.floor(ageInDays),
                            recommendation: "Consider updating deployment",
                        },
                    };
                }
            }

            return {
                check: "deployment-config",
                status: "pass",
                message: "Deployment configuration valid",
                details: {
                    webhookEndpoint: deployConfig.webhookEndpoint || deployConfig.webhookUrl,
                    deployedAt: deployConfig.deployedAt,
                    stackArn: deployConfig.stackArn,
                },
            };
        } catch (error) {
            return {
                check: "deployment-config",
                status: "fail",
                message: `Deployment check failed: ${(error as Error).message}`,
                details: {
                    error: (error as Error).message,
                },
            };
        }
    }

    /**
     * Runs all health checks
     *
     * @returns Complete health status
     */
    public async runAllChecks(): Promise<HealthStatus> {
        this.logger.info("health-check", `Running health checks for profile: ${this.profile}`);

        const checks: HealthCheckResult[] = [];

        // Run all checks in parallel
        const results = await Promise.all([
            this.checkXDGIntegrity(),
            this.checkSecretsAccess(),
            this.checkSecretsSync(),
            this.checkBenchlingCredentials(),
            this.checkQuiltCatalog(),
            this.checkDeploymentConfig(),
        ]);

        checks.push(...results);

        // Determine overall status
        const failCount = checks.filter((c) => c.status === "fail").length;
        const warnCount = checks.filter((c) => c.status === "warn").length;

        let overall: "healthy" | "degraded" | "unhealthy";
        if (failCount > 0) {
            overall = "unhealthy";
        } else if (warnCount > 0) {
            overall = "degraded";
        } else {
            overall = "healthy";
        }

        const status: HealthStatus = {
            overall,
            checks,
            timestamp: new Date().toISOString(),
            profile: this.profile,
        };

        this.logger.info("health-check", `Health check completed: ${overall}`, {
            failCount,
            warnCount,
            passCount: checks.filter((c) => c.status === "pass").length,
        });

        return status;
    }
}

/**
 * Formats health status for console output
 *
 * @param status - Health status
 * @returns Formatted string
 */
function formatHealthStatus(status: HealthStatus): string {
    const lines: string[] = [];

    lines.push("╔═══════════════════════════════════════════════════════════╗");
    lines.push("║   Configuration Health Check                              ║");
    lines.push("╚═══════════════════════════════════════════════════════════╝");
    lines.push("");
    lines.push(`Profile: ${status.profile}`);
    lines.push(`Timestamp: ${status.timestamp}`);
    lines.push(`Overall Status: ${status.overall.toUpperCase()}`);
    lines.push("");
    lines.push("Checks:");

    for (const check of status.checks) {
        const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "❌";
        lines.push(`  ${icon} ${check.check}: ${check.message}`);

        if (check.details) {
            Object.entries(check.details).forEach(([key, value]) => {
                if (key !== "error" && key !== "recommendation") {
                    lines.push(`    ${key}: ${value}`);
                }
            });

            if (check.details.recommendation) {
                lines.push(`    → ${check.details.recommendation}`);
            }
        }

        lines.push("");
    }

    return lines.join("\n");
}

/**
 * Main execution for CLI usage
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    let profile: ProfileName = "default";
    let outputFormat: "text" | "json" = "text";

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--profile" && i + 1 < args.length) {
            profile = args[i + 1];
            i++;
        } else if (args[i] === "--json") {
            outputFormat = "json";
        } else if (args[i] === "--help") {
            console.log("Usage: config-health-check [options]");
            console.log("\nOptions:");
            console.log("  --profile <name>   Configuration profile (default: default)");
            console.log("  --json             Output in JSON format");
            console.log("  --help             Show this help message");
            process.exit(0);
        }
    }

    const checker = new ConfigHealthChecker(profile);
    const status = await checker.runAllChecks();

    if (outputFormat === "json") {
        console.log(JSON.stringify(status, null, 2));
    } else {
        console.log(formatHealthStatus(status));
    }

    // Exit with appropriate code
    if (status.overall === "unhealthy") {
        process.exit(1);
    } else if (status.overall === "degraded") {
        process.exit(2);
    } else {
        process.exit(0);
    }
}

// Run main if executed directly
if (require.main === module) {
    main().catch((error) => {
        console.error("Error:", error.message);
        process.exit(1);
    });
}

export type { HealthStatus, HealthCheckResult };
