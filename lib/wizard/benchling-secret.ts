/**
 * Benchling secret helpers for setup wizard context display.
 *
 * @module wizard/benchling-secret
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { BenchlingSecretDetails } from "./types";

interface SecretDetailsOptions {
    secretArn: string;
    region: string;
    awsProfile?: string;
}

function parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    return undefined;
}

function normalizeString(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    return undefined;
}

/**
 * Retrieve and parse Benchling secret payload for context display.
 */
export async function fetchBenchlingSecretDetails(
    options: SecretDetailsOptions,
): Promise<BenchlingSecretDetails | null> {
    const { secretArn, region, awsProfile } = options;

    if (!secretArn) {
        return null;
    }

    const clientConfig: { region: string; credentials?: AwsCredentialIdentityProvider } = { region };
    if (awsProfile) {
        clientConfig.credentials = fromIni({ profile: awsProfile });
    }

    const client = new SecretsManagerClient(clientConfig);

    try {
        const command = new GetSecretValueCommand({ SecretId: secretArn });
        const response = await client.send(command);
        const secretString = response.SecretString;

        if (!secretString) {
            return null;
        }

        const payload = JSON.parse(secretString) as Record<string, unknown>;

        return {
            tenant: normalizeString(payload.tenant),
            clientId: normalizeString(payload.client_id ?? payload.clientId),
            clientSecret: normalizeString(payload.client_secret ?? payload.clientSecret),
            appDefinitionId: normalizeString(payload.app_definition_id ?? payload.appDefinitionId),
            userBucket: normalizeString(payload.user_bucket ?? payload.userBucket),
            pkgPrefix: normalizeString(payload.pkg_prefix ?? payload.pkgPrefix),
            pkgKey: normalizeString(payload.pkg_key ?? payload.pkgKey),
            logLevel: normalizeString(payload.log_level ?? payload.logLevel),
            webhookAllowList: normalizeString(payload.webhook_allow_list ?? payload.webhookAllowList),
            enableVerification: parseBoolean(payload.enable_webhook_verification ?? payload.enableWebhookVerification),
        };
    } catch {
        return null;
    }
}
