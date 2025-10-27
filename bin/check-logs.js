#!/usr/bin/env node
/**
 * Check CloudWatch logs for the deployed Benchling webhook ECS service
 * Uses CloudFormation stack outputs to find the correct log group
 */

require("dotenv/config");
const { execSync } = require("child_process");

const STACK_NAME = "BenchlingWebhookStack";

// Validate required environment variables
if (!process.env.CDK_DEFAULT_REGION) {
    console.error("Error: CDK_DEFAULT_REGION is not set in .env file");
    console.error("Please set CDK_DEFAULT_REGION in your .env file");
    process.exit(1);
}

const AWS_REGION = process.env.CDK_DEFAULT_REGION;

function getStackOutputs() {
    try {
        const output = execSync(
            `aws cloudformation describe-stacks --stack-name ${STACK_NAME} --region ${AWS_REGION} --query 'Stacks[0].Outputs' --output json`,
            { encoding: "utf-8" },
        );
        return JSON.parse(output);
    } catch (error) {
        console.error(`Error: Could not get stack outputs for ${STACK_NAME}`);
        console.error("Make sure the stack is deployed and AWS credentials are configured.");
        process.exit(1);
    }
}

function getLogGroupFromOutputs(outputs, logType) {
    let outputKey;
    if (logType === "ecs") {
        outputKey = "EcsLogGroup";
    } else if (logType === "api") {
        outputKey = "ApiGatewayLogGroup";
    } else if (logType === "api-exec") {
        outputKey = "ApiGatewayExecutionLogGroup";
    }

    const logGroupOutput = outputs.find((o) => o.OutputKey === outputKey);

    if (!logGroupOutput) {
        console.error(`Error: Could not find ${outputKey} in stack outputs`);
        console.error("Make sure the stack has been deployed with the latest changes.");
        process.exit(1);
    }

    return logGroupOutput.OutputValue;
}

function printStackInfo(outputs, logGroup, logType) {
    console.log("=".repeat(80));
    console.log("Benchling Webhook Stack Information");
    console.log("=".repeat(80));

    const clusterName = outputs.find((o) => o.OutputKey === "FargateServiceClusterNameCD3B109F");
    const serviceName = outputs.find((o) => o.OutputKey === "FargateServiceServiceName24CFD869");
    const webhookEndpoint = outputs.find((o) => o.OutputKey === "WebhookEndpoint");
    const version = outputs.find((o) => o.OutputKey === "StackVersion");
    const ecsLogGroup = outputs.find((o) => o.OutputKey === "EcsLogGroup");
    const apiLogGroup = outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup");
    const apiExecLogGroup = outputs.find((o) => o.OutputKey === "ApiGatewayExecutionLogGroup");
    const albDns = outputs.find((o) => o.OutputKey === "LoadBalancerDNS");

    if (clusterName) console.log(`Cluster:   ${clusterName.OutputValue}`);
    if (serviceName) console.log(`Service:   ${serviceName.OutputValue}`);
    if (webhookEndpoint) console.log(`Endpoint:  ${webhookEndpoint.OutputValue}`);
    if (albDns) console.log(`ALB DNS:   ${albDns.OutputValue}`);
    if (version) console.log(`Version:   ${version.OutputValue}`);

    console.log("");
    console.log("Log Groups:");
    if (ecsLogGroup) console.log(`  ECS:         ${ecsLogGroup.OutputValue}${logType === "ecs" ? " (viewing)" : ""}`);
    if (apiLogGroup) console.log(`  API Access:  ${apiLogGroup.OutputValue}${logType === "api" ? " (viewing)" : ""}`);
    if (apiExecLogGroup) console.log(`  API Exec:    ${apiExecLogGroup.OutputValue}${logType === "api-exec" ? " (viewing)" : ""}`);

    console.log("=".repeat(80));
    console.log("");
}

function main() {
    const args = process.argv.slice(2);
    const logType = args.find((arg) => arg.startsWith("--type="))?.split("=")[1] || "all";
    const filterPattern = args.find((arg) => arg.startsWith("--filter="))?.split("=")[1];
    const since = args.find((arg) => arg.startsWith("--since="))?.split("=")[1] || "5m";
    const follow = args.includes("--follow") || args.includes("-f");
    const tail = args.find((arg) => arg.startsWith("--tail="))?.split("=")[1] || "100";

    // Validate log type
    if (!["ecs", "api", "api-exec", "all"].includes(logType)) {
        console.error("Error: --type must be 'ecs', 'api', 'api-exec', or 'all'");
        process.exit(1);
    }

    // Get stack outputs
    const outputs = getStackOutputs();

    // Handle 'all' type - show all three log groups
    if (logType === "all") {
        printStackInfo(outputs, null, "all");
        console.log("Showing logs from all sources (most recent first):\n");

        const logGroupDefs = [
            { type: "ECS", group: outputs.find((o) => o.OutputKey === "EcsLogGroup")?.OutputValue },
            { type: "API-Access", group: outputs.find((o) => o.OutputKey === "ApiGatewayLogGroup")?.OutputValue },
            { type: "API-Exec", group: outputs.find((o) => o.OutputKey === "ApiGatewayExecutionLogGroup")?.OutputValue },
        ];

        // Warn about missing log groups
        const missingGroups = logGroupDefs.filter(lg => !lg.group);
        if (missingGroups.length > 0) {
            console.log("⚠️  WARNING: Some log groups are not available in stack outputs:");
            missingGroups.forEach(({ type }) => {
                console.log(`   - ${type}: Stack output not found (may need to redeploy stack)`);
            });
            console.log("");
        }

        const logGroups = logGroupDefs.filter(lg => lg.group);

        for (const { type, group } of logGroups) {
            console.log(`\n${"=".repeat(80)}`);
            console.log(`${type}: ${group}`);
            console.log("=".repeat(80));

            let command = `aws logs tail "${group}"`;
            command += ` --region ${AWS_REGION}`;
            command += ` --since ${since}`;
            command += ` --format short`;
            if (filterPattern) {
                command += ` --filter-pattern "${filterPattern}"`;
            }
            command += ` 2>&1 | tail -${tail}`;

            try {
                const output = execSync(command, { encoding: "utf-8", shell: "/bin/bash" });
                if (output.trim()) {
                    console.log(output);
                } else {
                    console.log(`(No logs in the last ${since})`);
                }
            } catch (error) {
                console.log(`Error reading ${type} logs: ${error.message}`);
            }
        }
        return;
    }

    const logGroup = getLogGroupFromOutputs(outputs, logType);
    printStackInfo(outputs, logGroup, logType);

    // Build AWS logs command
    let command = `aws logs tail ${logGroup}`;
    command += ` --region ${AWS_REGION}`;
    command += ` --since ${since}`;
    command += ` --format short`;

    if (filterPattern) {
        command += ` --filter-pattern "${filterPattern}"`;
    }

    if (follow) {
        command += " --follow";
        console.log("Following logs (Press Ctrl+C to stop)...\n");
    } else {
        command += ` | tail -${tail}`;
        console.log(`Showing last ${tail} log entries from the past ${since}...\n`);
    }

    // Execute logs command
    try {
        execSync(command, { stdio: "inherit" });
    } catch (error) {
        if (error.status !== 130) {
            // Ignore Ctrl+C exit (status 130)
            console.error("\nError fetching logs. Make sure:");
            console.error("1. The stack is deployed");
            console.error("2. AWS CLI is configured with proper credentials");
            console.error("3. You have CloudWatch Logs read permissions");
            process.exit(1);
        }
    }
}

function printHelp() {
    console.log("Usage: npm run logs [options]");
    console.log("");
    console.log("Options:");
    console.log("  --type=TYPE        Log group to view (default: all)");
    console.log("                     all      = All logs (ECS, API Access, API Execution)");
    console.log("                     ecs      = ECS container logs (application logs)");
    console.log("                     api      = API Gateway access logs (requests/responses)");
    console.log("                     api-exec = API Gateway execution logs (detailed debugging)");
    console.log("  --since=TIME       Time period to fetch logs (default: 5m)");
    console.log("                     Examples: 1h, 30m, 2d, 5m");
    console.log("  --filter=PATTERN   Filter logs by pattern");
    console.log("                     Examples: --filter=ERROR, --filter=canvas, --filter=500");
    console.log("  --follow, -f       Follow log output (like tail -f, not available with --type=all)");
    console.log("  --tail=N           Show last N lines (default: 100, only without --follow)");
    console.log("  --help, -h         Show this help message");
    console.log("");
    console.log("Examples:");
    console.log("  npm run logs                                   # View all logs from past 5 min");
    console.log("  npm run logs -- --type=ecs                     # View only ECS logs");
    console.log("  npm run logs -- --type=api-exec                # View API Gateway execution logs");
    console.log("  npm run logs -- --since=1h                     # Last hour of all logs");
    console.log("  npm run logs -- --filter=ERROR                 # Filter for errors in all logs");
    console.log("  npm run logs -- --type=api-exec --filter=500   # API Gateway execution errors");
    console.log("  npm run logs -- --type=ecs --follow            # Follow ECS logs");
    console.log("  npm run logs -- --type=api-exec --since=10m    # Last 10 min of execution logs");
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        printHelp();
        process.exit(0);
    }

    try {
        main();
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}
