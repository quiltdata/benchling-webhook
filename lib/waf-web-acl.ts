import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface WafWebAclProps {
    /**
     * Comma-separated list of allowed IP addresses/CIDR blocks
     *
     * Empty string means no IP filtering (discovery mode - COUNT all requests).
     * Non-empty string enables IP filtering (security mode - BLOCK unknown IPs).
     *
     * @example "192.168.1.0/24,10.0.0.0/8"
     * @default ""
     */
    readonly ipAllowList?: string;
}

/**
 * WAF Web ACL for Benchling webhook IP filtering
 *
 * Provides defense-in-depth security at AWS edge with two rules:
 * 1. Health check exception - Always allow /health, /health/ready, /health/live
 * 2. IP allowlist - Allow requests from configured IP ranges
 *
 * **Automatic Mode Selection:**
 * - Empty IP allowlist → COUNT mode (discovery phase - logs requests but doesn't block)
 * - Non-empty IP allowlist → BLOCK mode (security phase - blocks unknown IPs)
 *
 * This allows customers to deploy initially without knowing Benchling IPs,
 * discover them from CloudWatch logs, then add them to enable blocking mode.
 */
export class WafWebAcl extends Construct {
    public readonly webAcl: wafv2.CfnWebACL;
    public readonly ipSet: wafv2.CfnIPSet;
    public readonly logGroup: logs.ILogGroup;

    constructor(scope: Construct, id: string, props: WafWebAclProps = {}) {
        super(scope, id);

        // Parse IP allowlist with CIDR notation normalization
        const ipAllowList = this.parseIpAllowList(props.ipAllowList || "");

        // Automatic mode selection based on IP allowlist
        // - Empty allowlist: Allow mode (discovery - logs all requests, no blocking)
        // - Has IPs: Block mode (security - blocks unknown IPs)
        const isDiscoveryMode = ipAllowList.length === 0;
        const mode = isDiscoveryMode ? "Allow" : "Block";

        console.log(
            `WAF mode: ${mode} (${isDiscoveryMode ? "discovery - no IPs configured, all traffic allowed" : `security - ${ipAllowList.length} IP ranges configured`})`,
        );

        // Create IP Set for allowlist
        this.ipSet = new wafv2.CfnIPSet(this, "IPSet", {
            name: "BenchlingWebhookIPSet",
            scope: "REGIONAL",
            ipAddressVersion: "IPV4",
            addresses: ipAllowList,
            description: "Allowed IP addresses for Benchling webhooks",
        });

        // CloudWatch log group for WAF logs
        this.logGroup = new logs.LogGroup(this, "WafLogGroup", {
            logGroupName: "/aws/waf/benchling-webhook",
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create Web ACL with two rules
        // Default action: Allow (discovery mode) or Block (security mode)
        const defaultActionConfig: wafv2.CfnWebACL.DefaultActionProperty = isDiscoveryMode
            ? { allow: {} }
            : { block: {} };

        this.webAcl = new wafv2.CfnWebACL(this, "WebACL", {
            name: "BenchlingWebhookWebACL",
            scope: "REGIONAL",
            defaultAction: defaultActionConfig,
            description:
                "WAF for Benchling webhook IP filtering with automatic discovery mode. " +
                `Mode: ${mode} - ${isDiscoveryMode ? "empty allowlist, all traffic allowed" : `${ipAllowList.length} IPs configured`}`,
            rules: [
                // Rule 1: Health check exception (Priority 10)
                // Always allow health check endpoints regardless of IP
                {
                    name: "HealthCheckException",
                    priority: 10,
                    statement: {
                        orStatement: {
                            statements: [
                                {
                                    byteMatchStatement: {
                                        fieldToMatch: { uriPath: {} },
                                        positionalConstraint: "EXACTLY",
                                        searchString: "/health",
                                        textTransformations: [{ priority: 0, type: "NONE" }],
                                    },
                                },
                                {
                                    byteMatchStatement: {
                                        fieldToMatch: { uriPath: {} },
                                        positionalConstraint: "EXACTLY",
                                        searchString: "/health/ready",
                                        textTransformations: [{ priority: 0, type: "NONE" }],
                                    },
                                },
                                {
                                    byteMatchStatement: {
                                        fieldToMatch: { uriPath: {} },
                                        positionalConstraint: "EXACTLY",
                                        searchString: "/health/live",
                                        textTransformations: [{ priority: 0, type: "NONE" }],
                                    },
                                },
                            ],
                        },
                    },
                    action: { allow: {} },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: "HealthCheckException",
                    },
                },

                // Rule 2: IP allowlist (Priority 20)
                // Allow requests from configured IP ranges
                // Note: When IP allowlist is empty, this rule matches no IPs,
                // so all non-health requests fall through to default action (COUNT or BLOCK)
                {
                    name: "IPAllowlist",
                    priority: 20,
                    statement: {
                        ipSetReferenceStatement: {
                            arn: this.ipSet.attrArn,
                        },
                    },
                    action: { allow: {} },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: "IPAllowlist",
                    },
                },
            ],
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "BenchlingWebhookWebACL",
            },
        });

        // Configure WAF logging to CloudWatch
        new wafv2.CfnLoggingConfiguration(this, "WafLogging", {
            resourceArn: this.webAcl.attrArn,
            logDestinationConfigs: [this.logGroup.logGroupArn],
        });
    }

    /**
     * Parse IP allowlist string into array of CIDR blocks
     *
     * - Splits by comma
     * - Trims whitespace
     * - Adds /32 suffix if not present
     * - Filters out empty entries
     *
     * @param allowList Comma-separated list of IPs/CIDR blocks
     * @returns Array of CIDR blocks
     *
     * @example
     * parseIpAllowList("192.168.1.0/24, 10.0.0.1") → ["192.168.1.0/24", "10.0.0.1/32"]
     */
    private parseIpAllowList(allowList: string): string[] {
        return allowList
            .split(",")
            .map((ip) => ip.trim())
            .filter((ip) => ip.length > 0)
            .map((ip) => {
                // Ensure CIDR notation (add /32 if not specified)
                return ip.includes("/") ? ip : `${ip}/32`;
            });
    }
}
