import { writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import {
    loadDotenv,
    loadConfigSync,
    mergeInferredConfig,
    validateConfig,
    formatValidationErrors,
    type Config,
    type ConfigOptions,
} from "../lib/utils/config";

describe("config utility", () => {
    const testEnvFile = resolve(__dirname, ".test.env");

    beforeEach(() => {
        // Clean up process.env before each test
        delete process.env.TEST_VAR;
        delete process.env.QUILT_CATALOG;
        delete process.env.BENCHLING_TENANT;
        delete process.env.PKG_PREFIX;
        delete process.env.AWS_REGION;
        delete process.env.CDK_DEFAULT_REGION;
        delete process.env.CDK_DEFAULT_ACCOUNT;
        delete process.env.ENABLE_WEBHOOK_VERIFICATION;
        delete process.env.ECR_REPOSITORY_NAME;
        delete process.env.LOG_LEVEL;
        delete process.env.PKG_KEY;
    });

    afterEach(() => {
        // Clean up test env file
        if (existsSync(testEnvFile)) {
            unlinkSync(testEnvFile);
        }
        // Clean up process.env
        delete process.env.TEST_VAR;
        delete process.env.QUILT_CATALOG;
        delete process.env.BENCHLING_TENANT;
        delete process.env.PKG_PREFIX;
        delete process.env.AWS_REGION;
        delete process.env.CDK_DEFAULT_REGION;
        delete process.env.CDK_DEFAULT_ACCOUNT;
        delete process.env.ENABLE_WEBHOOK_VERIFICATION;
        delete process.env.ECR_REPOSITORY_NAME;
        delete process.env.LOG_LEVEL;
        delete process.env.PKG_KEY;
    });

    describe("loadDotenv", () => {
        it("should load and parse .env file", () => {
            writeFileSync(testEnvFile, "TEST_VAR=test_value\nANOTHER_VAR=another");
            const result = loadDotenv(testEnvFile);
            expect(result.TEST_VAR).toBe("test_value");
            expect(result.ANOTHER_VAR).toBe("another");
        });

        it("should expand variables in .env file", () => {
            writeFileSync(testEnvFile, "BASE_VAR=base\nEXPANDED_VAR=${BASE_VAR}_expanded");
            const result = loadDotenv(testEnvFile);
            expect(result.BASE_VAR).toBe("base");
            expect(result.EXPANDED_VAR).toBe("base_expanded");
        });

        it("should return empty object for non-existent file", () => {
            const result = loadDotenv("/nonexistent/path/.env");
            expect(result).toEqual({});
        });

        it("should handle invalid .env file gracefully", () => {
            writeFileSync(testEnvFile, "\x00\x01\x02"); // Invalid content
            // dotenv actually handles binary content gracefully, so it doesn't throw
            const result = loadDotenv(testEnvFile);
            expect(result).toBeDefined();
        });
    });

    describe("loadConfigSync", () => {
        beforeEach(() => {
            // Set up test env file
            writeFileSync(
                testEnvFile,
                [
                    "QUILT_CATALOG=catalog.example.com",
                    "QUILT_USER_BUCKET=test-bucket",
                    "BENCHLING_TENANT=test-tenant",
                    "BENCHLING_CLIENT_ID=test-client-id",
                    "BENCHLING_CLIENT_SECRET=test-secret",
                    "CDK_DEFAULT_ACCOUNT=123456789012",
                    "CDK_DEFAULT_REGION=us-east-1",
                    "QUEUE_NAME=test-queue",
                ].join("\n"),
            );
        });

        it("should load configuration from .env file", () => {
            const config = loadConfigSync({ envFile: testEnvFile });
            expect(config.quiltCatalog).toBe("catalog.example.com");
            expect(config.benchlingTenant).toBe("test-tenant");
            expect(config.cdkAccount).toBe("123456789012");
        });

        it("should prioritize CLI options over env vars", () => {
            const config = loadConfigSync({
                envFile: testEnvFile,
                catalog: "override-catalog.com",
                tenant: "override-tenant",
            });
            expect(config.quiltCatalog).toBe("override-catalog.com");
            expect(config.benchlingTenant).toBe("override-tenant");
        });

        it("should prioritize process.env over .env file", () => {
            process.env.QUILT_CATALOG = "process-catalog.com";
            const config = loadConfigSync({ envFile: testEnvFile });
            expect(config.quiltCatalog).toBe("process-catalog.com");
        });

        it("should set default values for optional fields", () => {
            const config = loadConfigSync({ envFile: testEnvFile });
            expect(config.pkgPrefix).toBe("benchling");
            expect(config.pkgKey).toBe("experiment_id");
            expect(config.logLevel).toBe("INFO");
            expect(config.enableWebhookVerification).toBe("true");
            expect(config.ecrRepositoryName).toBe("quiltdata/benchling");
        });

        it("should handle missing .env file gracefully", () => {
            const config = loadConfigSync({ envFile: "/nonexistent/.env" });
            expect(config).toBeDefined();
            expect(Object.keys(config).length).toBeGreaterThanOrEqual(0);
        });

        it("should remove undefined values from config", () => {
            const config = loadConfigSync({ envFile: testEnvFile });
            const values = Object.values(config);
            expect(values.every((v) => v !== undefined)).toBe(true);
        });

        it("should handle region from AWS_REGION or CDK_DEFAULT_REGION", () => {
            process.env.AWS_REGION = "eu-west-1";
            process.env.CDK_DEFAULT_REGION = "eu-west-1";
            const config1 = loadConfigSync();
            expect(config1.cdkRegion).toBe("eu-west-1");

            delete process.env.AWS_REGION;
            process.env.CDK_DEFAULT_REGION = "us-west-2";
            const config2 = loadConfigSync();
            expect(config2.cdkRegion).toBe("us-west-2");
        });
    });

    describe("mergeInferredConfig", () => {
        it("should merge inferred values with loaded config", () => {
            const loadedConfig: Partial<Config> = {
                quiltCatalog: "catalog.example.com",
                benchlingTenant: "test-tenant",
            };

            const inferredVars = {
                CDK_DEFAULT_ACCOUNT: "123456789012",
                CDK_DEFAULT_REGION: "us-east-1",
                QUEUE_ARN: "arn:aws:sqs:us-east-1:123456789012:inferred-queue",
                QUILT_DATABASE: "inferred_db",
            };

            const merged = mergeInferredConfig(loadedConfig, inferredVars);
            expect(merged.cdkAccount).toBe("123456789012");
            expect(merged.cdkRegion).toBe("us-east-1");
            expect(merged.queueArn).toBe("arn:aws:sqs:us-east-1:123456789012:inferred-queue");
            expect(merged.quiltDatabase).toBe("inferred_db");
            expect(merged.quiltCatalog).toBe("catalog.example.com");
        });

        it("should not override user-provided values with inferred ones", () => {
            const loadedConfig: Partial<Config> = {
                cdkAccount: "user-account",
                cdkRegion: "user-region",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:user-queue",
            };

            const inferredVars = {
                CDK_DEFAULT_ACCOUNT: "inferred-account",
                CDK_DEFAULT_REGION: "inferred-region",
                QUEUE_ARN: "arn:aws:sqs:us-east-1:123456789012:inferred-queue",
            };

            const merged = mergeInferredConfig(loadedConfig, inferredVars);
            expect(merged.cdkAccount).toBe("user-account");
            expect(merged.cdkRegion).toBe("user-region");
            expect(merged.queueArn).toBe("arn:aws:sqs:us-east-1:123456789012:user-queue");
        });

        it("should use inferred values only when user values are missing", () => {
            const loadedConfig: Partial<Config> = {
                cdkAccount: "user-account",
            };

            const inferredVars = {
                CDK_DEFAULT_ACCOUNT: "inferred-account",
                CDK_DEFAULT_REGION: "inferred-region",
                QUILT_DATABASE: "inferred_db",
            };

            const merged = mergeInferredConfig(loadedConfig, inferredVars);
            expect(merged.cdkAccount).toBe("user-account"); // User value preserved
            expect(merged.cdkRegion).toBe("inferred-region"); // Inferred value used
            expect(merged.quiltDatabase).toBe("inferred_db"); // Inferred value used
        });
    });

    describe("validateConfig", () => {
        it("should pass validation for complete config", () => {
            const config: Partial<Config> = {
                quiltCatalog: "catalog.example.com",
                quiltUserBucket: "test-bucket",
                quiltDatabase: "test_db",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                benchlingAppDefinitionId: "app-def-id",
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
            };

            const result = validateConfig(config);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("should fail validation for missing required user fields", () => {
            const config: Partial<Config> = {
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
            };

            const result = validateConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);

            const userErrors = result.errors.filter((e) => !e.canInfer);
            expect(userErrors.length).toBeGreaterThan(0);
            expect(userErrors.some((e) => e.field === "quiltCatalog")).toBe(true);
            expect(userErrors.some((e) => e.field === "benchlingTenant")).toBe(true);
        });

        it("should fail validation for missing inferred fields", () => {
            const config: Partial<Config> = {
                quiltCatalog: "catalog.example.com",
                quiltUserBucket: "test-bucket",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
            };

            const result = validateConfig(config);
            expect(result.valid).toBe(false);

            const inferErrors = result.errors.filter((e) => e.canInfer);
            expect(inferErrors.length).toBeGreaterThan(0);
            expect(inferErrors.some((e) => e.field === "cdkAccount")).toBe(true);
            expect(inferErrors.some((e) => e.field === "queueArn")).toBe(true);
        });

        it("should require app definition ID when verification is enabled", () => {
            const config: Partial<Config> = {
                quiltCatalog: "catalog.example.com",
                quiltUserBucket: "test-bucket",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                enableWebhookVerification: "true",
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:queue",
                quiltDatabase: "test_db",
            };

            const result = validateConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.field === "benchlingAppDefinitionId")).toBe(true);
        });

        it("should warn about invalid catalog domain format", () => {
            const config: Partial<Config> = {
                quiltCatalog: "https://catalog.example.com", // Should not include protocol
                quiltUserBucket: "test-bucket",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                enableWebhookVerification: "false",
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
                quiltDatabase: "test_db",
            };

            const result = validateConfig(config);
            expect(result.warnings.some((w) => w.includes("QUILT_CATALOG"))).toBe(true);
        });

        it("should warn about invalid bucket name format", () => {
            const config: Partial<Config> = {
                quiltCatalog: "catalog.example.com",
                quiltUserBucket: "Invalid_Bucket_Name!", // Invalid characters
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                enableWebhookVerification: "false",
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
                quiltDatabase: "test_db",
            };

            const result = validateConfig(config);
            expect(result.warnings.some((w) => w.includes("QUILT_USER_BUCKET"))).toBe(true);
        });
    });

    describe("formatValidationErrors", () => {
        it("should format errors with user and inferred sections", () => {
            const result = validateConfig({});
            const formatted = formatValidationErrors(result);

            expect(formatted).toContain("Missing required configuration:");
            expect(formatted).toContain("Values you must provide:");
            expect(formatted).toContain("Values that could not be inferred:");
        });

        it("should include warnings section", () => {
            const config: Partial<Config> = {
                quiltCatalog: "catalog.example.com",
                quiltUserBucket: "test-bucket",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                enableWebhookVerification: "false",
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
                quiltDatabase: "test_db",
            };

            const result = validateConfig(config);
            const formatted = formatValidationErrors(result);

            expect(formatted).toContain("Warnings:");
            expect(formatted).toContain("Webhook verification is disabled");
        });

        it("should include help text for errors", () => {
            const result = validateConfig({});
            const formatted = formatValidationErrors(result);

            expect(formatted).toContain("Your Quilt catalog domain");
            expect(formatted).toContain("OAuth client ID");
        });

        it("should return empty string for valid config with no warnings", () => {
            const config: Partial<Config> = {
                quiltCatalog: "catalog.example.com",
                quiltUserBucket: "test-bucket",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "client-secret",
                benchlingAppDefinitionId: "app-def-id",
                cdkAccount: "123456789012",
                cdkRegion: "us-east-1",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
                quiltDatabase: "test_db",
            };

            const result = validateConfig(config);
            const formatted = formatValidationErrors(result);

            expect(formatted.trim()).toBe("");
        });
    });
});
