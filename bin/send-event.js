#!/usr/bin/env node
/**
 * Send a test event to the deployed Benchling webhook endpoint
 */

require("dotenv/config");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

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

function getWebhookEndpoint(outputs) {
    const endpoint = outputs.find((o) => o.OutputKey === "WebhookEndpoint");
    if (!endpoint) {
        console.error("Error: Could not find WebhookEndpoint in stack outputs");
        process.exit(1);
    }
    return endpoint.OutputValue;
}

function listTestEvents() {
    const eventsDir = path.join(__dirname, "..", "test-events");
    const files = fs.readdirSync(eventsDir).filter(f => f.endsWith(".json"));

    console.log("Available test events:");
    files.forEach(file => {
        console.log(`  - ${file.replace(".json", "")}`);
    });
}

function loadTestEvent(eventName) {
    const eventsDir = path.join(__dirname, "..", "test-events");

    // Add .json extension if not present
    if (!eventName.endsWith(".json")) {
        eventName = `${eventName}.json`;
    }

    const eventPath = path.join(eventsDir, eventName);

    if (!fs.existsSync(eventPath)) {
        console.error(`Error: Test event file not found: ${eventPath}`);
        console.error("");
        listTestEvents();
        process.exit(1);
    }

    return fs.readFileSync(eventPath, "utf-8");
}

function sendEvent(endpoint, eventData, eventName, dryRun = false) {
    // Determine the endpoint path based on event type
    const event = JSON.parse(eventData);
    let path = "/";

    if (event.message?.type) {
        const type = event.message.type;
        if (type.includes("canvas")) {
            path = "/canvas";
        } else if (type.includes("entry")) {
            path = "/entry";
        } else if (type.includes("app")) {
            path = "/app";
        }
    }

    const url = endpoint.replace(/\/$/, "") + path;

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
    } catch (error) {
        console.error("\nError sending event:", error.message);
        process.exit(1);
    } finally {
        // Clean up temp file
        if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
        }
    }
}

function printHelp() {
    console.log("Usage: npm run event [event-name] [options]");
    console.log("");
    console.log("Arguments:");
    console.log("  event-name         Name of test event file (without .json extension)");
    console.log("");
    console.log("Options:");
    console.log("  --list, -l         List available test events");
    console.log("  --dry-run, -d      Show what would be sent without actually sending");
    console.log("  --help, -h         Show this help message");
    console.log("");
    console.log("Examples:");
    console.log("  npm run event canvas-created          # Send canvas-created.json event");
    console.log("  npm run event entry-updated            # Send entry-updated.json event");
    console.log("  npm run event -- --list                # List all available events");
    console.log("  npm run event canvas-created -- --dry-run   # Preview without sending");
    console.log("");
    console.log("After sending an event, check the logs:");
    console.log("  npm run logs");
}

function main() {
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
    const eventName = args.find(arg => !arg.startsWith("-"));

    if (!eventName) {
        console.error("Error: No event name provided\n");
        listTestEvents();
        console.log("");
        console.log("Usage: npm run event <event-name>");
        console.log("   or: npm run event -- --list");
        process.exit(1);
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
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}
