/**
 * Profile configuration builders for setup wizard flows.
 *
 * @module wizard/profile-config-builder
 */

import { ProfileConfig } from "../types/config";
import { BenchlingSecretDetails, ParameterCollectionResult, StackQueryResult } from "./types";
import packageJson from "../../package.json";

interface ConfigFromParametersInput {
    stackQuery: StackQueryResult;
    parameters: ParameterCollectionResult;
    catalogDns: string;
    integratedStack: boolean;
    benchlingSecretArn?: string;
}

interface ConfigFromExistingInput {
    stackQuery: StackQueryResult;
    existingConfig?: ProfileConfig | null;
    secretDetails?: BenchlingSecretDetails | null;
    catalogDns: string;
    integratedStack: boolean;
    benchlingSecretArn?: string;
}

function createMetadata(existingConfig?: ProfileConfig | null): ProfileConfig["_metadata"] {
    const now = new Date().toISOString();
    return {
        version: packageJson.version,
        createdAt: existingConfig?._metadata?.createdAt || now,
        updatedAt: now,
        source: "wizard",
    };
}

function applyDiscoveredResources(config: ProfileConfig, stackQuery: StackQueryResult): void {
    if (stackQuery.athenaUserWorkgroup) {
        config.quilt.athenaUserWorkgroup = stackQuery.athenaUserWorkgroup;
    }
    if (stackQuery.bucketWritePolicyArn) {
        config.quilt.bucketWritePolicyArn = stackQuery.bucketWritePolicyArn;
    }
    if (stackQuery.athenaUserPolicyArn) {
        config.quilt.athenaUserPolicyArn = stackQuery.athenaUserPolicyArn;
    }
}

/**
 * Build profile config from collected parameters.
 */
export function buildProfileConfigFromParameters(input: ConfigFromParametersInput): ProfileConfig {
    const { stackQuery, parameters, benchlingSecretArn, catalogDns, integratedStack } = input;

    const config: ProfileConfig = {
        quilt: {
            stackArn: stackQuery.stackArn,
            catalog: catalogDns,
            database: stackQuery.database,
            queueUrl: stackQuery.queueUrl,
            region: stackQuery.region,
        },
        benchling: {
            tenant: parameters.benchling.tenant,
            clientId: parameters.benchling.clientId,
            clientSecret: parameters.benchling.clientSecret,
            appDefinitionId: parameters.benchling.appDefinitionId,
            ...(benchlingSecretArn ? { secretArn: benchlingSecretArn } : {}),
        },
        packages: {
            bucket: parameters.packages.bucket,
            prefix: parameters.packages.prefix,
            metadataKey: parameters.packages.metadataKey,
        },
        deployment: {
            region: parameters.deployment.region,
            account: parameters.deployment.account,
            vpc: parameters.deployment.vpc,
        },
        integratedStack,
        logging: {
            level: parameters.logging.level,
        },
        security: {
            enableVerification: parameters.security.enableVerification,
            webhookAllowList: parameters.security.webhookAllowList,
        },
        _metadata: createMetadata(),
    };

    applyDiscoveredResources(config, stackQuery);

    return config;
}

/**
 * Build profile config from existing config or secret details (no prompts).
 */
export function buildProfileConfigFromExisting(input: ConfigFromExistingInput): ProfileConfig {
    const { stackQuery, existingConfig, secretDetails, benchlingSecretArn, catalogDns, integratedStack } = input;

    const benchling = {
        tenant: existingConfig?.benchling?.tenant ?? secretDetails?.tenant,
        clientId: existingConfig?.benchling?.clientId ?? secretDetails?.clientId,
        clientSecret: existingConfig?.benchling?.clientSecret ?? secretDetails?.clientSecret,
        appDefinitionId: existingConfig?.benchling?.appDefinitionId ?? secretDetails?.appDefinitionId,
        secretArn: benchlingSecretArn ?? existingConfig?.benchling?.secretArn,
    };

    const packages = {
        bucket: existingConfig?.packages?.bucket ?? secretDetails?.userBucket,
        prefix: existingConfig?.packages?.prefix ?? secretDetails?.pkgPrefix ?? "benchling",
        metadataKey: existingConfig?.packages?.metadataKey ?? secretDetails?.pkgKey ?? "experiment_id",
    };

    if (!benchling.tenant || !benchling.clientId || !benchling.clientSecret || !benchling.appDefinitionId) {
        throw new Error("Missing Benchling credentials in existing configuration or secret");
    }

    if (!packages.bucket) {
        throw new Error("Missing package bucket in existing configuration or secret");
    }

    const vpcFromStack = stackQuery.discoveredVpc?.isValid
        ? {
            vpcId: stackQuery.discoveredVpc.vpcId,
            privateSubnetIds: stackQuery.discoveredVpc.privateSubnetIds,
            publicSubnetIds: stackQuery.discoveredVpc.publicSubnetIds,
            availabilityZones: stackQuery.discoveredVpc.availabilityZones,
            vpcCidrBlock: stackQuery.discoveredVpc.cidrBlock,
        }
        : undefined;

    const benchlingConfig = {
        tenant: benchling.tenant!,
        clientId: benchling.clientId!,
        clientSecret: benchling.clientSecret!,
        appDefinitionId: benchling.appDefinitionId!,
        secretArn: benchling.secretArn,
    };

    const packagesConfig = {
        bucket: packages.bucket!,
        prefix: packages.prefix,
        metadataKey: packages.metadataKey,
    };

    const config: ProfileConfig = {
        quilt: {
            stackArn: stackQuery.stackArn,
            catalog: catalogDns,
            database: stackQuery.database,
            queueUrl: stackQuery.queueUrl,
            region: stackQuery.region,
            athenaUserWorkgroup: existingConfig?.quilt?.athenaUserWorkgroup,
            bucketWritePolicyArn: existingConfig?.quilt?.bucketWritePolicyArn,
            athenaUserPolicyArn: existingConfig?.quilt?.athenaUserPolicyArn,
        },
        benchling: benchlingConfig,
        packages: packagesConfig,
        deployment: {
            region: stackQuery.region,
            account: stackQuery.account,
            vpc: vpcFromStack ?? existingConfig?.deployment?.vpc,
            imageTag: existingConfig?.deployment?.imageTag,
        },
        integratedStack,
        logging: {
            level: (existingConfig?.logging?.level ||
                secretDetails?.logLevel ||
                "INFO") as "DEBUG" | "INFO" | "WARNING" | "ERROR",
        },
        security: {
            enableVerification: existingConfig?.security?.enableVerification ??
                secretDetails?.enableVerification ??
                true,
            webhookAllowList: existingConfig?.security?.webhookAllowList ??
                secretDetails?.webhookAllowList ??
                "",
        },
        _metadata: createMetadata(existingConfig),
    };

    if (benchlingSecretArn) {
        config.benchling.secretArn = benchlingSecretArn;
    }

    applyDiscoveredResources(config, stackQuery);

    return config;
}
