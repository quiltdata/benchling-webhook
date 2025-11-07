#!/usr/bin/env ts-node
/**
 * List CloudFormation stacks that are Quilt catalog deployments
 *
 * Quilt stacks are identified by having a "QuiltWebHost" output parameter.
 * This script efficiently fetches all stacks and filters them client-side.
 */

import {
    findAllQuiltStacks,
    isQuiltStack,
    listAllStacks,
    QuiltStack,
} from "../lib/utils/stack-inference";

/**
 * Find all Quilt stacks in a region with optional verbose output
 */
async function findQuiltStacks(region: string, verbose = false): Promise<QuiltStack[]> {
    if (verbose) {
        console.log(`Searching for Quilt stacks in ${region}...`);
        console.log();
    }

    // Get all stacks
    const allStacks = listAllStacks(region);
    if (verbose) {
        console.log(`Found ${allStacks.length} total stacks`);

        // Show progress for each stack
        for (const stackSummary of allStacks) {
            process.stdout.write(`  Checking ${stackSummary.StackName}...`);
            if (isQuiltStack(region, stackSummary.StackName)) {
                console.log(" ✓ Quilt stack");
            } else {
                console.log(" (not Quilt)");
            }
        }
    }

    // Use the utility function to get all Quilt stacks
    return findAllQuiltStacks(region, false);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const region = args.find(arg => arg.startsWith("--region="))?.split("=")[1] || "us-east-1";
    const verbose = args.includes("--verbose") || args.includes("-v");
    const json = args.includes("--json");

    if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage: ts-node scripts/list-quilt-stacks.ts [options]

Options:
  --region=REGION    AWS region to search (default: us-east-1)
  --verbose, -v      Show detailed progress
  --json             Output results as JSON
  --help, -h         Show this help message

Examples:
  ts-node scripts/list-quilt-stacks.ts --region=us-east-1
  ts-node scripts/list-quilt-stacks.ts --region=us-east-2 --verbose
  ts-node scripts/list-quilt-stacks.ts --json
`);
        process.exit(0);
    }

    try {
        const quiltStacks = await findQuiltStacks(region, verbose);

        if (json) {
            console.log(JSON.stringify(quiltStacks, null, 2));
        } else {
            if (verbose) {
                console.log();
            }
            console.log(`Found ${quiltStacks.length} Quilt stack(s) in ${region}:`);
            console.log();

            for (const stack of quiltStacks) {
                console.log(`  • ${stack.StackName} (${stack.StackStatus})`);

                const quiltWebHost = stack.Outputs?.find(o => o.OutputKey === "QuiltWebHost");
                if (quiltWebHost) {
                    console.log(`    QuiltWebHost: ${quiltWebHost.OutputValue}`);
                }

                const queueUrl = stack.Outputs?.find(o => o.OutputKey === "PackagerQueueUrl");
                if (queueUrl) {
                    console.log(`    Queue: ${queueUrl.OutputValue}`);
                }
                console.log();
            }
        }
    } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

export { findQuiltStacks };
