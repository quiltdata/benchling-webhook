#!/usr/bin/env node
/**
 * Configuration Health Check Command
 *
 * Post-setup validation that checks:
 * - Configuration file integrity
 * - Secrets synchronization status
 * - Deployment configuration
 *
 * @module commands/health-check
 */

import { XDGConfig } from "../../lib/xdg-config";
import { DerivedConfig, DeploymentConfig, ProfileName } from "../../lib/types/config";
import { existsSync, statSync } from "fs";
import { SecretsManagerClient, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import chalk from "chalk";

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
 * Options for health check command
 */
interface HealthCheckOptions {
    profile?: ProfileName;
    json?: boolean;
}

/**
 * Checks XDG configuration file integrity
 */
async function checkXDGIntegrity(xdgConfig: XDGConfig, profile: ProfileName): Promise<HealthCheckResult> {
    try {
        const paths = xdgConfig.getProfilePaths(profile);

        // Check if profile directory exists
        const profileDir = xdgConfig.getProfileDir(profile);
        if (!existsSync(profileDir)) {
            return {
                check: "xdg-integrity",
                status: "fail",
                message: "Profile directory does not exist",
                details: { profileDir, profile },
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
                details: { ...files, profile, recommendation: "Run setup wizard to create configuration" },
            };
        }

        // Try to read and validate existing configs
        if (files.userConfig) {
            try {
                xdgConfig.readProfileConfig("user", profile);
            } catch (error) {
                return {
                    check: "xdg-integrity",
                    status: "fail",
                    message: `User config validation failed: ${(error as Error).message}`,
                    details: { profile, error: (error as Error).message },
                };
            }
        }

        if (files.derivedConfig) {
            try {
                xdgConfig.readProfileConfig("derived", profile);
            } catch (error) {
                return {
                    check: "xdg-integrity",
                    status: "fail",
                    message: `Derived config validation failed: ${(error as Error).message}`,
                    details: { profile, error: (error as Error).message },
                };
            }
        }

        return {
            check: "xdg-integrity",
            status: "pass",
            message: "XDG configuration integrity verified",
            details: { ...files, profile },
        };
    } catch (error) {
        return {
            check: "xdg-integrity",
            status: "fail",
            message: `Integrity check failed: ${(error as Error).message}`,
            details: { error: (error as Error).message },
        };
    }
}

/**
 * Checks if local config and remote secrets are in sync
 */
async function checkSecretsSync(xdgConfig: XDGConfig, profile: ProfileName): Promise<HealthCheckResult> {
    try {
        const paths = xdgConfig.getProfilePaths(profile);

        // Check if user config exists
        if (!existsSync(paths.userConfig)) {
            return {
                check: "secrets-sync",
                status: "warn",
                message: "No user configuration found",
                details: { profile, recommendation: "Run setup wizard first" },
            };
        }

        // Load derived config to get secret ARN
        const derivedConfig = xdgConfig.readProfileConfig("derived", profile) as DerivedConfig;

        if (!derivedConfig.benchlingSecretArn) {
            return {
                check: "secrets-sync",
                status: "warn",
                message: "No secrets configured",
                details: { profile, recommendation: "Run 'benchling-webhook sync-secrets' to sync secrets" },
            };
        }

        // Get local config modification time
        const userConfigStats = statSync(paths.userConfig);
        const localModifiedAt = userConfigStats.mtime;

        // Get remote secret modification time
        const region = derivedConfig.cdkRegion || "us-east-1";
        const clientConfig: { region: string; credentials?: unknown } = { region };

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
                details: { secretArn: derivedConfig.benchlingSecretArn },
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
                    recommendation: "Run 'benchling-webhook sync-secrets --force' to sync changes",
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
            details: { error: (error as Error).message },
        };
    }
}

/**
 * Checks deployment configuration
 */
async function checkDeploymentConfig(xdgConfig: XDGConfig, profile: ProfileName): Promise<HealthCheckResult> {
    try {
        const paths = xdgConfig.getProfilePaths(profile);

        if (!existsSync(paths.deployConfig)) {
            return {
                check: "deployment-config",
                status: "warn",
                message: "No deployment configuration found",
                details: {
                    profile,
                    recommendation: "Run 'benchling-webhook deploy' to deploy the stack",
                },
            };
        }

        const deployConfig = xdgConfig.readProfileConfig("deploy", profile) as DeploymentConfig;

        // Check for webhook endpoint
        if (!deployConfig.webhookEndpoint && !deployConfig.webhookUrl) {
            return {
                check: "deployment-config",
                status: "warn",
                message: "Webhook endpoint not configured",
                details: { profile },
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
            details: { error: (error as Error).message },
        };
    }
}

/**
 * Runs all health checks
 */
export async function runHealthChecks(profile: ProfileName = "default"): Promise<HealthStatus> {
    const xdgConfig = new XDGConfig();
    const checks: HealthCheckResult[] = [];

    // Run all checks in parallel
    const results = await Promise.all([
        checkXDGIntegrity(xdgConfig, profile),
        checkSecretsSync(xdgConfig, profile),
        checkDeploymentConfig(xdgConfig, profile),
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

    return {
        overall,
        checks,
        timestamp: new Date().toISOString(),
        profile,
    };
}

/**
 * Formats health status for console output
 */
function formatHealthStatus(status: HealthStatus): string {
    const lines: string[] = [];

    lines.push("╔═══════════════════════════════════════════════════════════╗");
    lines.push("║   Configuration Health Check                              ║");
    lines.push("╚═══════════════════════════════════════════════════════════╝");
    lines.push("");
    lines.push(`Profile: ${status.profile}`);
    lines.push(`Timestamp: ${status.timestamp}`);

    const overallColor =
        status.overall === "healthy" ? chalk.green : status.overall === "degraded" ? chalk.yellow : chalk.red;
    lines.push(`Overall Status: ${overallColor(status.overall.toUpperCase())}`);
    lines.push("");
    lines.push("Checks:");

    for (const check of status.checks) {
        const icon = check.status === "pass" ? chalk.green("✓") : check.status === "warn" ? chalk.yellow("⚠") : chalk.red("❌");
        lines.push(`  ${icon} ${check.check}: ${check.message}`);

        if (check.details) {
            Object.entries(check.details).forEach(([key, value]) => {
                if (key !== "error" && key !== "recommendation") {
                    lines.push(`    ${chalk.dim(`${key}: ${value}`)}`);
                }
            });

            if (check.details.recommendation) {
                lines.push(`    ${chalk.cyan(`→ ${check.details.recommendation}`)}`);
            }
        }

        lines.push("");
    }

    return lines.join("\n");
}

/**
 * Health check command handler
 */
export async function healthCheckCommand(options: HealthCheckOptions = {}): Promise<void> {
    const { profile = "default", json = false } = options;

    const status = await runHealthChecks(profile);

    if (json) {
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
