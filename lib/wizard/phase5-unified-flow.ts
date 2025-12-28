/**
 * Phase 5: Unified Flow Decision
 *
 * Displays discovery context and selects the setup path.
 *
 * @module wizard/phase5-unified-flow
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { fetchBenchlingSecretDetails } from "./benchling-secret";
import { BenchlingSecretDetails, UnifiedFlowDecisionInput, UnifiedFlowDecisionResult } from "./types";

function maskValue(value: string | undefined): string {
    if (!value) return "(unknown)";
    if (value.length <= 6) {
        return `${value.slice(0, 2)}***`;
    }
    return `${value.slice(0, 4)}...${value.slice(-3)}`;
}

async function confirmPrompt(message: string, defaultValue: boolean, yes: boolean): Promise<boolean> {
    if (yes) {
        return defaultValue;
    }

    const { confirmed } = await inquirer.prompt([
        {
            type: "confirm",
            name: "confirmed",
            message,
            default: defaultValue,
        },
    ]);

    return confirmed;
}

function getStackName(stackArn: string): string {
    const match = stackArn.match(/stack\/([^/]+)\//);
    return match ? match[1] : stackArn;
}

function resolveBenchlingSummary(
    existingConfig?: UnifiedFlowDecisionInput["existingConfig"],
    secretDetails?: BenchlingSecretDetails | null,
): { tenant?: string; clientId?: string; appDefinitionId?: string } {
    return {
        tenant: existingConfig?.benchling?.tenant ?? secretDetails?.tenant,
        clientId: existingConfig?.benchling?.clientId ?? secretDetails?.clientId,
        appDefinitionId: existingConfig?.benchling?.appDefinitionId ?? secretDetails?.appDefinitionId,
    };
}

function resolveHasStandaloneDeployment(input: UnifiedFlowDecisionInput): boolean {
    if (input.existingConfig?.integratedStack === false) {
        return true;
    }

    try {
        const deployments = input.configStorage.getDeployments(input.profile);
        return Object.keys(deployments.active).length > 0;
    } catch {
        return false;
    }
}

function formatIntegrationStatus(status: boolean | undefined): string {
    if (status === true) return "enabled";
    if (status === false) return "disabled";
    return "not available";
}

/**
 * Unified flow decision entry point.
 */
export async function runUnifiedFlowDecision(
    input: UnifiedFlowDecisionInput,
): Promise<UnifiedFlowDecisionResult> {
    const { stackQuery, existingConfig, configStorage, profile, yes = false, awsProfile } = input;

    const stackName = getStackName(stackQuery.stackArn);
    const benchlingSecretArn = stackQuery.benchlingSecretArn || existingConfig?.benchling?.secretArn;
    const hasStandaloneDeployment = resolveHasStandaloneDeployment({ ...input, configStorage, profile });

    const secretDetails = benchlingSecretArn
        ? await fetchBenchlingSecretDetails({
            secretArn: benchlingSecretArn,
            region: stackQuery.region,
            awsProfile,
        })
        : null;

    const benchlingSummary = resolveBenchlingSummary(existingConfig, secretDetails);

    // Determine flow FIRST before displaying context
    const integrationEnabled = stackQuery.benchlingIntegrationEnabled;
    const hasBenchlingSecret = Boolean(benchlingSecretArn);

    let flow: UnifiedFlowDecisionResult["flow"];
    // Priority: Current stack state > standalone deployment detection
    // If the stack has integration enabled/disabled, that takes precedence over local config
    if (integrationEnabled === true && hasBenchlingSecret) {
        flow = "integration-running";
    } else if (integrationEnabled === false) {
        flow = "integration-disabled";
    } else if (integrationEnabled === undefined && hasStandaloneDeployment) {
        // Only treat as standalone if integration is NOT available in stack
        flow = "standalone-existing";
    } else {
        flow = "integration-missing";
    }

    console.log(chalk.bold("Context"));
    console.log(chalk.dim("─".repeat(70)));
    console.log(chalk.green(`✓ Quilt Stack: ${stackName}`));
    console.log(chalk.dim(`  Region: ${stackQuery.region}`));
    console.log(chalk.dim(`  Account: ${stackQuery.account}`));
    console.log("");

    // Determine deployment mode for display
    const isIntegratedMode = flow === "integration-running" || flow === "integration-disabled";

    if (isIntegratedMode) {
        console.log(chalk.bold.cyan("🔗 Deployment Mode: INTEGRATED"));
        console.log(chalk.dim("  Webhook runs within the Quilt stack (no separate deployment)\n"));
    } else {
        console.log(chalk.bold.yellow("📦 Deployment Mode: STANDALONE"));
        console.log(chalk.dim("  Webhook runs as separate infrastructure\n"));
    }

    console.log(chalk.bold("Integration Status"));
    console.log(chalk.dim(`  Integration: ${formatIntegrationStatus(stackQuery.benchlingIntegrationEnabled)}`));

    if (benchlingSecretArn) {
        console.log(chalk.dim(`  Secret: ${benchlingSecretArn}`));
        console.log(chalk.dim(`  Tenant: ${benchlingSummary.tenant ?? "(unknown)"}`));
        console.log(chalk.dim(`  Client ID: ${maskValue(benchlingSummary.clientId)}`));
        console.log(chalk.dim(`  App Definition ID: ${maskValue(benchlingSummary.appDefinitionId)}`));
    } else {
        console.log(chalk.dim("  Secret: (not found)"));
    }

    if (stackQuery.athenaUserWorkgroup) {
        console.log(chalk.dim(`  Workgroup: ${stackQuery.athenaUserWorkgroup}`));
    }

    console.log("");

    if (flow === "integration-running") {
        // Offer disable integration as first option when running
        const disableIntegration = await confirmPrompt(
            "Disable integrated webhook? (destroys webhook resources, re-run wizard to recreate)",
            false,
            yes,
        );
        if (disableIntegration) {
            return { action: "disable-integration", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
        }

        const updateCredentials = await confirmPrompt("Update Benchling credentials?", true, yes);
        if (updateCredentials) {
            return { action: "update-integration-secret", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
        }

        const reviewOnly = await confirmPrompt("Review config without changes?", true, yes);
        if (reviewOnly) {
            return { action: "review-only", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
        }

        const switchStandalone = await confirmPrompt("Switch to standalone?", false, yes);
        if (switchStandalone) {
            return { action: "switch-standalone", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
        }

        return { action: "exit", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
    }

    if (flow === "integration-disabled") {
        const enableIntegration = await confirmPrompt("Enable integrated webhook in Quilt?", true, yes);
        if (enableIntegration) {
            return { action: "enable-integration", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
        }

        console.log(chalk.yellow("Switching to standalone deployment..."));
        return { action: "deploy-standalone", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
    }

    if (flow === "integration-missing") {
        console.log(chalk.yellow("Your Quilt stack doesn't support integrated webhooks. Will deploy as standalone infrastructure."));
        const deployStandalone = await confirmPrompt("Deploy standalone webhook?", true, yes);
        if (deployStandalone) {
            return { action: "deploy-standalone", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
        }

        return { action: "exit", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
    }

    const updateRedeploy = await confirmPrompt("Update credentials and redeploy?", true, yes);
    if (updateRedeploy) {
        return { action: "update-standalone-redeploy", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
    }

    const updateSecretOnly = await confirmPrompt("Update secret only (no redeploy)?", true, yes);
    if (updateSecretOnly) {
        return { action: "update-standalone-secret", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
    }

    const reviewOnly = await confirmPrompt("Review config only?", true, yes);
    if (reviewOnly) {
        return { action: "review-only", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
    }

    return { action: "exit", flow, benchlingSecretArn, secretDetails, hasStandaloneDeployment };
}
