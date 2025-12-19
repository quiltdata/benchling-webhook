#!/usr/bin/env node
/**
 * Send a test event to the deployed Benchling webhook endpoint
 * Usage: npx ts-node scripts/send-event.ts [event-name] [--profile <profile>]
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { XDGConfig } from "../lib/xdg-config";
import { getStackName } from "../lib/types/config";

// Parse command line arguments
const args = process.argv.slice(2);
const profileIndex = args.indexOf("--profile");
const profile = profileIndex !== -1 ? args[profileIndex + 1] : "default";

// Get stack name from profile
const xdg = new XDGConfig();
let STACK_NAME: string;
try {
    const config = xdg.readProfile(profile);
    STACK_NAME = getStackName(profile, config.deployment?.stackName);
    console.log(`Using profile: ${profile}`);
    console.log(`Stack name: ${STACK_NAME}`);
} catch (_error) {
    console.error(`Error: Could not read profile "${profile}"`);
    console.error("Run 'npm run setup' to create a profile first.");
    process.exit(1);
}

// Validate required environment variables
if (!process.env.CDK_DEFAULT_REGION && !process.env.AWS_REGION) {
    console.error("Error: AWS_REGION or CDK_DEFAULT_REGION environment variable not set");
    console.error("Please set AWS_REGION in your environment");
    process.exit(1);
}

const AWS_REGION: string = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION!;

interface StackOutput {
    OutputKey: string;
    OutputValue: string;
    Description?: string;
    ExportName?: string;
}

interface EventMessage {
    type?: string;
}

interface TestEvent {
    message?: EventMessage;
}

function getStackOutputs(): StackOutput[] {
    try {
        const output = execSync(
            `aws cloudformation describe-stacks --stack-name ${STACK_NAME} --region ${AWS_REGION} --query 'Stacks[0].Outputs' --output json`,
            { encoding: "utf-8" },
        );
        return JSON.parse(output) as StackOutput[];
    } catch (error: unknown) {
        console.error(`Error: Could not get stack outputs for ${STACK_NAME}`);
        console.error("Make sure the stack is deployed and AWS credentials are configured.");
        if (error instanceof Error) {
            console.error(`Details: ${error.message}`);
        }
        process.exit(1);
    }
}

function getWebhookEndpoint(outputs: StackOutput[]): string {
    const endpoint = outputs.find((o) => o.OutputKey === "WebhookEndpoint");
    if (!endpoint) {
        console.error("Error: Could not find WebhookEndpoint in stack outputs");
        process.exit(1);
    }
    return endpoint.OutputValue;
}

function listTestEvents(): void {
    const eventsDir = path.join(__dirname, "..", "test-events");
    const files = fs.readdirSync(eventsDir).filter((f: string) => f.endsWith(".json"));

    console.log("Available test events:");
    files.forEach((file: string) => {
        console.log(`  - ${file.replace(".json", "")}`);
    });
}

function loadTestEvent(eventName: string): string {
    const eventsDir = path.join(__dirname, "..", "test-events");

    // Add .json extension if not present
    let eventFileName = eventName;
    if (!eventFileName.endsWith(".json")) {
        eventFileName = `${eventFileName}.json`;
    }

    const eventPath = path.join(eventsDir, eventFileName);

    if (!fs.existsSync(eventPath)) {
        console.error(`Error: Test event file not found: ${eventPath}`);
        console.error("");
        listTestEvents();
        process.exit(1);
    }

    return fs.readFileSync(eventPath, "utf-8");
}

function sendEvent(endpoint: string, eventData: string, eventName: string, dryRun: boolean = false): void {
    // Determine the endpoint path based on event type
    const event = JSON.parse(eventData) as TestEvent;
    let urlPath = "/";

    if (event.message?.type) {
        const type = event.message.type;
        if (type.includes("canvas")) {
            urlPath = "/canvas";
        } else if (type.includes("entry")) {
            urlPath = "/entry";
        } else if (type.includes("app")) {
            urlPath = "/app";
        }
    }

    const url = endpoint.replace(/\/$/, "") + urlPath;

    console.log("=".repeat(80));
    console.log("Sending Test Event");
    console.log("=".repeat(80));
    console.log(`Event:    ${eventName}`);
    console.log(`Type:     ${event.message?.type || "unknown"}`);
    console.log(`Endpoint: ${url}`);
    console.log("=".repeat(80));
    console.log("");

    if (dryRun) {
        console.log("DRY RUN - Would send the following payload:");
        console.log(JSON.stringify(JSON.parse(eventData), null, 2));
        return;
    }

    // Create a temporary file for the event data
    const tmpFile = `/tmp/benchling-event-${Date.now()}.json`;
    fs.writeFileSync(tmpFile, eventData);

    try {
        console.log("Sending request...");
        const command = `curl -X POST "${url}" \\
            -H "Content-Type: application/json" \\
            -H "webhook-id: msg_test_${Date.now()}" \\
            -H "webhook-timestamp: ${Math.floor(Date.now() / 1000)}" \\
            -H "webhook-signature: v1,test_signature" \\
            --data @${tmpFile} \\
            -w "\\n\\nHTTP Status: %{http_code}\\n" \\
            -v`;

        console.log("");
        execSync(command, { stdio: "inherit", shell: "/bin/bash" });
        console.log("");
        console.log("=".repeat(80));
        console.log("Event sent successfully!");
        console.log("Check logs with: npm run logs");
        console.log("=".repeat(80));
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("\nError sending event:", errorMessage);
        process.exit(1);
    } finally {
        // Clean up temp file
        if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
        }
    }
}

function printHelp(): void {
    console.log("Usage: npm run event [event-name] [options]");
    console.log("");
    console.log("Arguments:");
    console.log("  event-name         Name of test event file (without .json extension)");
    console.log("                     Defaults to 'canvas-created' if not specified");
    console.log("");
    console.log("Options:");
    console.log("  --list, -l         List available test events");
    console.log("  --dry-run, -d      Show what would be sent without actually sending");
    console.log("  --help, -h         Show this help message");
    console.log("");
    console.log("Examples:");
    console.log("  npm run event                          # Send canvas-created.json (default)");
    console.log("  npm run event canvas-created           # Send canvas-created.json event");
    console.log("  npm run event entry-updated            # Send entry-updated.json event");
    console.log("  npm run event -- --list                # List all available events");
    console.log("  npm run event canvas-created -- --dry-run   # Preview without sending");
    console.log("");
    console.log("After sending an event, check the logs:");
    console.log("  npm run logs");
}

function main(): void {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
        printHelp();
        process.exit(0);
    }

    if (args.includes("--list") || args.includes("-l")) {
        listTestEvents();
        process.exit(0);
    }

    const dryRun = args.includes("--dry-run") || args.includes("-d");
    const eventName = args.find((arg: string) => !arg.startsWith("-")) || "canvas-created";

    // If using default event, notify the user
    if (!args.find((arg: string) => !arg.startsWith("-"))) {
        console.log("No event specified, using default: canvas-created\n");
    }

    // Get webhook endpoint from stack outputs
    const outputs = getStackOutputs();
    const endpoint = getWebhookEndpoint(outputs);

    // Load test event
    const eventData = loadTestEvent(eventName);

    // Send event
    sendEvent(endpoint, eventData, eventName, dryRun);
}

if (require.main === module) {
    try {
        main();
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Error:", errorMessage);
        process.exit(1);
    }
}
