/**
 * Integration tests for XDG Launch pure functions
 *
 * These tests verify the pure transformation and validation functions
 * using mock configuration data.
 *
 * NOTE: This test uses mock ProfileConfig objects to ensure consistent
 * test behavior regardless of local configuration state.
 */

import { buildEnvVars, validateConfig, filterSecrets } from "../../bin/xdg-launch";
import { extractQuiltResources, buildInferredConfig } from "../../lib/utils/stack-inference";
import { ProfileConfig } from "../../lib/types/config";
import { StackResourceMap, DiscoveredQuiltResources } from "../../lib/utils/stack-inference";
import { createMockConfig } from "../helpers/test-config";

describe("XDG Launch Pure Functions - Integration", () => {
    let mockConfig: ProfileConfig;

    beforeAll(() => {
        // Use mock config instead of loading real profile
        mockConfig = createMockConfig({
            quilt: {
                catalog: "https://quilt.example.com",
                database: "test_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                region: "us-east-1",
            },
            benchling: {
                tenant: "test-tenant",
                clientId: "test-client",
                secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret",
                appDefinitionId: "app_test123",
            },
            packages: {
                bucket: "test-packages",
                prefix: "benchling",
                metadataKey: "experiment_id",
            },
            deployment: {
                region: "us-east-1",
                account: "123456789012",
            },
            logging: {
                level: "INFO",
            },
            security: {
                enableVerification: true,
            },
        });
        console.log(`\n  Using mock config for pure function testing\n`);
    });

    describe("buildEnvVars()", () => {
        it("should produce valid environment variables from mock config in native mode", () => {
            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // Verify required Quilt service variables
            expect(envVars.QUILT_WEB_HOST).toBe(mockConfig.quilt.catalog);
            expect(envVars.ATHENA_USER_DATABASE).toBe(mockConfig.quilt.database);
            expect(envVars.PACKAGER_SQS_URL).toBe(mockConfig.quilt.queueUrl);
            expect(envVars.AWS_REGION).toBe(mockConfig.quilt.region || mockConfig.deployment.region);
            expect(envVars.AWS_DEFAULT_REGION).toBe(mockConfig.quilt.region || mockConfig.deployment.region);

            // Verify Benchling configuration
            // Note: In v0.8.0+, only BenchlingSecret (secret name) is set, not ARN or tenant
            // Tenant and credentials are fetched from Secrets Manager at runtime
            expect(envVars.BenchlingSecret).toBeTruthy();
            expect(typeof envVars.BenchlingSecret).toBe("string");

            // Package configuration comes from Secrets Manager, NOT environment variables

            // Verify native mode-specific variables
            expect(envVars.APP_ENV).toBe("development");
            expect(envVars.LOG_LEVEL).toBe(mockConfig.logging?.level || "DEBUG");

            // Verify security configuration
            expect(envVars.ENABLE_WEBHOOK_VERIFICATION).toBe(
                String(mockConfig.security?.enableVerification !== false)
            );
        });

        it("should produce valid environment variables from mock config in docker mode", () => {
            const envVars = buildEnvVars(mockConfig, "docker", {
                mode: "docker",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // Docker production mode should have production settings
            expect(envVars.APP_ENV).toBe("production");
            expect(envVars.LOG_LEVEL).toBe(mockConfig.logging?.level || "INFO");
            expect(envVars.FLASK_DEBUG).toBeUndefined();

            // Security should be enabled in production
            expect(envVars.ENABLE_WEBHOOK_VERIFICATION).toBe(
                String(mockConfig.security?.enableVerification !== false)
            );
        });

        it("should produce valid environment variables from mock config in docker-dev mode", () => {
            const envVars = buildEnvVars(mockConfig, "docker-dev", {
                mode: "docker-dev",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // Docker dev mode should have development settings
            expect(envVars.APP_ENV).toBe("development");
            expect(envVars.LOG_LEVEL).toBe(mockConfig.logging?.level || "DEBUG");

            // Webhook verification should be disabled in docker-dev for easier testing
            expect(envVars.ENABLE_WEBHOOK_VERIFICATION).toBe("false");
        });

        it("should set test mode flag when --test is enabled", () => {
            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: true,
                noSecret: false,
            });

            expect(envVars.BENCHLING_TEST_MODE).toBe("true");
        });

        it("should handle optional Athena configuration gracefully", () => {
            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // Athena user workgroup should default to "primary"
            expect(envVars).toHaveProperty("ATHENA_USER_WORKGROUP");
            if (!mockConfig.quilt.athenaUserWorkgroup) {
                expect(envVars.ATHENA_USER_WORKGROUP).toBe("primary");
            }
        });

        it("should preserve existing process.env variables", () => {
            const originalPath = process.env.PATH;

            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            expect(envVars.PATH).toBe(originalPath);
        });
    });

    describe("validateConfig()", () => {
        it("should succeed with valid mock config configuration", () => {
            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // Should not throw
            expect(() => validateConfig(envVars, "default")).not.toThrow();
        });

        it("should detect missing required fields", () => {
            const incompleteVars = {
                QUILT_WEB_HOST: "example.com",
                // Missing other required fields
            };

            expect(() => validateConfig(incompleteVars, "default")).toThrow(/Missing required configuration/);
        });

        it("should validate SQS URL format", () => {
            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // Replace with invalid URL
            const invalidVars = {
                ...envVars,
                PACKAGER_SQS_URL: "not-a-valid-url",
            };

            expect(() => validateConfig(invalidVars, "default")).toThrow(/Invalid SQS URL format/);
        });

        it("should validate BenchlingSecret is present", () => {
            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // BenchlingSecret should always be present
            expect(envVars.BenchlingSecret).toBeTruthy();

            // Validate that missing BenchlingSecret is caught
            const invalidVars = {
                ...envVars,
                BenchlingSecret: "",
            };

            expect(() => validateConfig(invalidVars, "default")).toThrow(/Missing required configuration.*BenchlingSecret/s);
        });

        it("should provide helpful error messages with profile path", () => {
            const incompleteVars = {
                QUILT_WEB_HOST: "example.com",
            };

            try {
                validateConfig(incompleteVars, "default");
                fail("Should have thrown an error");
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain("~/.config/benchling-webhook/default/config.json");
                expect(message).toContain("npm run setup -- --profile default");
            }
        });
    });

    describe("filterSecrets()", () => {
        it("should mask environment variables containing SECRET", () => {
            const envVars = {
                BenchlingSecret: "benchling-webhook-prod",
                QUILT_WEB_HOST: "example.quiltdata.com",
                MY_SECRET_KEY: "should-be-hidden",
            };

            const filtered = filterSecrets(envVars);

            expect(filtered.BenchlingSecret).toBe("***REDACTED***");
            expect(filtered.MY_SECRET_KEY).toBe("***REDACTED***");
            expect(filtered.QUILT_WEB_HOST).toBe("example.quiltdata.com");
        });

        it("should mask environment variables containing PASSWORD", () => {
            const envVars = {
                DATABASE_PASSWORD: "should-be-hidden",
                ADMIN_PASSWORD_HASH: "also-hidden",
                QUILT_DATABASE: "should-be-visible",
            };

            const filtered = filterSecrets(envVars);

            expect(filtered.DATABASE_PASSWORD).toBe("***REDACTED***");
            expect(filtered.ADMIN_PASSWORD_HASH).toBe("***REDACTED***");
            expect(filtered.QUILT_DATABASE).toBe("should-be-visible");
        });

        it("should mask environment variables containing TOKEN", () => {
            const envVars = {
                API_TOKEN: "should-be-hidden",
                ACCESS_TOKEN_SECRET: "also-hidden",
                TOKEN_EXPIRY: "should-be-hidden",
                AWS_REGION: "us-east-1",
            };

            const filtered = filterSecrets(envVars);

            expect(filtered.API_TOKEN).toBe("***REDACTED***");
            expect(filtered.ACCESS_TOKEN_SECRET).toBe("***REDACTED***");
            expect(filtered.TOKEN_EXPIRY).toBe("***REDACTED***");
            expect(filtered.AWS_REGION).toBe("us-east-1");
        });

        it("should perform case-insensitive matching", () => {
            const envVars = {
                BenchlingSecret: "should-be-hidden",
                benchling_secret: "should-be-hidden", // lowercase matches due to case-insensitive check
                MY_API_TOKEN: "should-be-hidden",
                my_api_token: "should-be-hidden", // lowercase matches due to case-insensitive check
                MyPasswordValue: "should-be-hidden",
            };

            const filtered = filterSecrets(envVars);

            // All variations should be masked (case-insensitive)
            expect(filtered.BenchlingSecret).toBe("***REDACTED***");
            expect(filtered.benchling_secret).toBe("***REDACTED***");
            expect(filtered.MY_API_TOKEN).toBe("***REDACTED***");
            expect(filtered.my_api_token).toBe("***REDACTED***");
            expect(filtered.MyPasswordValue).toBe("***REDACTED***");
        });

        it("should not modify non-sensitive variables", () => {
            const envVars = {
                QUILT_WEB_HOST: "example.quiltdata.com",
                AWS_REGION: "us-east-1",
                APP_ENV: "development",
                PORT: "5001",
            };

            const filtered = filterSecrets(envVars);

            expect(filtered).toEqual(envVars);
        });
    });

    describe("extractQuiltResources()", () => {
        it("should extract all target resources when present", () => {
            const mockResources: StackResourceMap = {
                BenchlingAthenaWorkgroup: {
                    physicalResourceId: "my-user-workgroup",
                    resourceType: "AWS::Athena::WorkGroup",
                    resourceStatus: "CREATE_COMPLETE",
                },
                UserAthenaNonManagedRolePolicy: {
                    physicalResourceId: "my-user-policy-ABCDEF",
                    resourceType: "AWS::IAM::Policy",
                    resourceStatus: "CREATE_COMPLETE",
                },
            };

            const discovered: DiscoveredQuiltResources = extractQuiltResources(mockResources);

            expect(discovered.athenaUserWorkgroup).toBe("my-user-workgroup");
            expect(discovered.athenaUserPolicyArn).toBe("my-user-policy-ABCDEF");
        });

        it("should handle empty resource map gracefully", () => {
            const discovered: DiscoveredQuiltResources = extractQuiltResources({});

            expect(discovered).toBeDefined();
            expect(discovered.athenaUserWorkgroup).toBeUndefined();
            expect(discovered.athenaUserPolicyArn).toBeUndefined();
        });

        it("should ignore unrelated resources", () => {
            const mockResources: StackResourceMap = {
                BenchlingAthenaWorkgroup: {
                    physicalResourceId: "my-workgroup",
                    resourceType: "AWS::Athena::WorkGroup",
                    resourceStatus: "CREATE_COMPLETE",
                },
                SomeOtherResource: {
                    physicalResourceId: "other-resource-id",
                    resourceType: "AWS::Lambda::Function",
                    resourceStatus: "CREATE_COMPLETE",
                },
                AnotherUnrelatedResource: {
                    physicalResourceId: "unrelated-id",
                    resourceType: "AWS::DynamoDB::Table",
                    resourceStatus: "CREATE_COMPLETE",
                },
            };

            const discovered: DiscoveredQuiltResources = extractQuiltResources(mockResources);

            // Should only extract the target resource
            expect(discovered.athenaUserWorkgroup).toBe("my-workgroup");
            expect(Object.keys(discovered).length).toBe(1);
        });
    });

    describe("buildInferredConfig()", () => {
        it("should build inferred configuration from stack details", () => {
            const mockStackConfig = {
                region: "us-east-1",
                apiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
                analyticsBucket: "quilt-analytics",
                serviceBucket: "quilt-service",
                stackVersion: "1.2.3",
            };

            const stackDetails = {
                outputs: [
                    { OutputKey: "UserAthenaDatabaseName", OutputValue: "quilt_catalog_db" },
                    { OutputKey: "PackagerQueueUrl", OutputValue: "https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue" },
                ],
                parameters: [],
            };

            const inferred = buildInferredConfig(
                mockStackConfig,
                "quilt-stack",
                stackDetails,
                "us-east-1",
                "123456789012",
                "https://example.quiltdata.com"
            );

            expect(inferred.CDK_DEFAULT_ACCOUNT).toBe("123456789012");
            expect(inferred.CDK_DEFAULT_REGION).toBe("us-east-1");
            expect(inferred.AWS_REGION).toBe("us-east-1");
            expect(inferred.QUILT_CATALOG).toBe("example.quiltdata.com");
            expect(inferred.QUILT_DATABASE).toBe("quilt_catalog_db");
            expect(inferred.QUEUE_URL).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/packager-queue");
        });

        it("should handle missing stack outputs gracefully", () => {
            const mockStackConfig = {
                region: "us-west-2",
                apiGatewayEndpoint: "https://xyz789.execute-api.us-west-2.amazonaws.com/prod",
                analyticsBucket: "quilt-analytics",
                serviceBucket: "quilt-service",
            };

            const stackDetails = {
                outputs: [],
                parameters: [],
            };

            const inferred = buildInferredConfig(
                mockStackConfig,
                null,
                stackDetails,
                "us-west-2",
                null,
                "https://catalog.example.com"
            );

            expect(inferred.AWS_REGION).toBe("us-west-2");
            expect(inferred.QUILT_CATALOG).toBe("catalog.example.com");
            // Database should be inferred from catalog name
            expect(inferred.QUILT_DATABASE).toContain("catalog_example_com");
        });

        it("should be a pure function (no side effects)", () => {
            const mockStackConfig = {
                region: "eu-west-1",
                apiGatewayEndpoint: "https://api.example.com",
                analyticsBucket: "analytics",
                serviceBucket: "service",
            };

            const stackDetails = {
                outputs: [{ OutputKey: "UserAthenaDatabaseName", OutputValue: "test_db" }],
                parameters: [],
            };

            const result1 = buildInferredConfig(
                mockStackConfig,
                "stack-1",
                stackDetails,
                "eu-west-1",
                "999999999999",
                "https://test.example.com"
            );

            const result2 = buildInferredConfig(
                mockStackConfig,
                "stack-1",
                stackDetails,
                "eu-west-1",
                "999999999999",
                "https://test.example.com"
            );

            expect(result1).toEqual(result2);
        });
    });

    describe("End-to-End Integration", () => {
        it("should transform mock config through complete pipeline", () => {
            // 1. Build environment variables from profile
            const envVars = buildEnvVars(mockConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            });

            // 2. Validate configuration
            expect(() => validateConfig(envVars, "default")).not.toThrow();

            // 3. Filter secrets for logging
            const filtered = filterSecrets(envVars);

            // 4. Verify secrets are masked
            if (envVars.BenchlingSecret) {
                expect(filtered.BenchlingSecret).toBe("***REDACTED***");
            }

            // 5. Verify non-secrets are preserved
            expect(filtered.QUILT_WEB_HOST).toBe(envVars.QUILT_WEB_HOST);
            expect(filtered.AWS_REGION).toBe(envVars.AWS_REGION);
        });

        it("should produce consistent results across multiple invocations", () => {
            const options = {
                mode: "docker" as const,
                profile: "default",
                verbose: false,
                test: false,
                noSecret: false,
            };

            const result1 = buildEnvVars(mockConfig, "docker", options);
            const result2 = buildEnvVars(mockConfig, "docker", options);

            expect(result1).toEqual(result2);
        });
    });
});
