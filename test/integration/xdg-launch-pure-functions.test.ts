/**
 * Integration tests for XDG Launch pure functions
 *
 * These tests verify the pure transformation and validation functions
 * using the real default profile configuration.
 *
 * Requirements:
 * - Default profile configured at ~/.config/benchling-webhook/default/config.json
 * - Run: npm run setup (if not already done)
 */

import { buildEnvVars, validateConfig, filterSecrets } from "../../bin/xdg-launch";
import { extractQuiltResources, buildInferredConfig } from "../../lib/utils/stack-inference";
import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig } from "../../lib/types/config";
import { StackResourceMap, DiscoveredQuiltResources } from "../../lib/utils/stack-inference";

describe("XDG Launch Pure Functions - Integration", () => {
    let defaultConfig: ProfileConfig;

    beforeAll(() => {
        const xdg = new XDGConfig();

        try {
            if (!xdg.profileExists("default")) {
                throw new Error(
                    "Default profile not found. Run: npm run setup"
                );
            }

            defaultConfig = xdg.readProfile("default");
            console.log(`\n  Using profile: default\n`);
        } catch (error) {
            throw new Error(
                `Failed to load default profile: ${(error as Error).message}\n\n` +
                "Setup required:\n" +
                "  1. Run: npm run setup\n" +
                "  2. Complete the configuration wizard\n"
            );
        }
    });

    describe("buildEnvVars()", () => {
        it("should produce valid environment variables from default profile in native mode", () => {
            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
            });

            // Verify required Quilt service variables
            expect(envVars.QUILT_WEB_HOST).toBe(defaultConfig.quilt.catalog);
            expect(envVars.ATHENA_USER_DATABASE).toBe(defaultConfig.quilt.database);
            expect(envVars.PACKAGER_SQS_URL).toBe(defaultConfig.quilt.queueUrl);
            expect(envVars.AWS_REGION).toBe(defaultConfig.quilt.region || defaultConfig.deployment.region);
            expect(envVars.AWS_DEFAULT_REGION).toBe(defaultConfig.quilt.region || defaultConfig.deployment.region);

            // Verify Benchling configuration
            expect(envVars.BENCHLING_TENANT).toBe(defaultConfig.benchling.tenant);
            expect(envVars.BENCHLING_SECRET_ARN).toBe(defaultConfig.benchling.secretArn || "");

            // Verify package storage configuration
            expect(envVars.PACKAGE_BUCKET).toBe(defaultConfig.packages.bucket);
            expect(envVars.PACKAGE_PREFIX).toBe(defaultConfig.packages.prefix);
            expect(envVars.PACKAGE_METADATA_KEY).toBe(defaultConfig.packages.metadataKey);

            // Verify native mode-specific variables
            expect(envVars.FLASK_ENV).toBe("development");
            expect(envVars.FLASK_DEBUG).toBe("true");
            expect(envVars.LOG_LEVEL).toBe(defaultConfig.logging?.level || "DEBUG");

            // Verify security configuration
            expect(envVars.ENABLE_WEBHOOK_VERIFICATION).toBe(
                String(defaultConfig.security?.enableVerification !== false)
            );
        });

        it("should produce valid environment variables from default profile in docker mode", () => {
            const envVars = buildEnvVars(defaultConfig, "docker", {
                mode: "docker",
                profile: "default",
                verbose: false,
                test: false,
            });

            // Docker production mode should have production settings
            expect(envVars.FLASK_ENV).toBe("production");
            expect(envVars.LOG_LEVEL).toBe(defaultConfig.logging?.level || "INFO");
            expect(envVars.FLASK_DEBUG).toBeUndefined();

            // Security should be enabled in production
            expect(envVars.ENABLE_WEBHOOK_VERIFICATION).toBe(
                String(defaultConfig.security?.enableVerification !== false)
            );
        });

        it("should produce valid environment variables from default profile in docker-dev mode", () => {
            const envVars = buildEnvVars(defaultConfig, "docker-dev", {
                mode: "docker-dev",
                profile: "default",
                verbose: false,
                test: false,
            });

            // Docker dev mode should have development settings
            expect(envVars.FLASK_ENV).toBe("development");
            expect(envVars.FLASK_DEBUG).toBe("true");
            expect(envVars.LOG_LEVEL).toBe(defaultConfig.logging?.level || "DEBUG");

            // Webhook verification should be disabled in docker-dev for easier testing
            expect(envVars.ENABLE_WEBHOOK_VERIFICATION).toBe("false");
        });

        it("should set test mode flag when --test is enabled", () => {
            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: true,
            });

            expect(envVars.BENCHLING_TEST_MODE).toBe("true");
        });

        it("should handle optional Iceberg resources gracefully", () => {
            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
            });

            // Iceberg resources are optional
            expect(envVars).toHaveProperty("ICEBERG_DATABASE");
            expect(envVars).toHaveProperty("ICEBERG_WORKGROUP");

            // Should be empty string if not configured
            if (!defaultConfig.quilt.icebergDatabase) {
                expect(envVars.ICEBERG_DATABASE).toBe("");
            }
            if (!defaultConfig.quilt.icebergWorkgroup) {
                expect(envVars.ICEBERG_WORKGROUP).toBe("");
            }
        });

        it("should preserve existing process.env variables", () => {
            const originalPath = process.env.PATH;

            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
            });

            expect(envVars.PATH).toBe(originalPath);
        });
    });

    describe("validateConfig()", () => {
        it("should succeed with valid default profile configuration", () => {
            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
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
            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
            });

            // Replace with invalid URL
            const invalidVars = {
                ...envVars,
                PACKAGER_SQS_URL: "not-a-valid-url",
            };

            expect(() => validateConfig(invalidVars, "default")).toThrow(/Invalid SQS URL format/);
        });

        it("should validate Secrets Manager ARN format if present", () => {
            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
            });

            // Replace with invalid ARN (only if BENCHLING_SECRET_ARN is set)
            if (envVars.BENCHLING_SECRET_ARN) {
                const invalidVars = {
                    ...envVars,
                    BENCHLING_SECRET_ARN: "not-a-valid-arn",
                };

                expect(() => validateConfig(invalidVars, "default")).toThrow(/Invalid Secrets Manager ARN/);
            }
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
                BENCHLING_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123:secret:foo",
                QUILT_WEB_HOST: "example.quiltdata.com",
                MY_SECRET_KEY: "should-be-hidden",
            };

            const filtered = filterSecrets(envVars);

            expect(filtered.BENCHLING_SECRET_ARN).toBe("***REDACTED***");
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
                BENCHLING_SECRET_ARN: "should-be-hidden",
                benchling_secret_arn: "should-be-hidden", // lowercase matches due to case-insensitive check
                MY_API_TOKEN: "should-be-hidden",
                my_api_token: "should-be-hidden", // lowercase matches due to case-insensitive check
                MyPasswordValue: "should-be-hidden",
            };

            const filtered = filterSecrets(envVars);

            // All variations should be masked (case-insensitive)
            expect(filtered.BENCHLING_SECRET_ARN).toBe("***REDACTED***");
            expect(filtered.benchling_secret_arn).toBe("***REDACTED***");
            expect(filtered.MY_API_TOKEN).toBe("***REDACTED***");
            expect(filtered.my_api_token).toBe("***REDACTED***");
            expect(filtered.MyPasswordValue).toBe("***REDACTED***");
        });

        it("should not modify non-sensitive variables", () => {
            const envVars = {
                QUILT_WEB_HOST: "example.quiltdata.com",
                AWS_REGION: "us-east-1",
                FLASK_ENV: "development",
                PORT: "5001",
            };

            const filtered = filterSecrets(envVars);

            expect(filtered).toEqual(envVars);
        });
    });

    describe("extractQuiltResources()", () => {
        it("should extract all target resources when present", () => {
            const mockResources: StackResourceMap = {
                UserAthenaNonManagedRoleWorkgroup: {
                    physicalResourceId: "my-user-workgroup",
                    resourceType: "AWS::Athena::WorkGroup",
                    resourceStatus: "CREATE_COMPLETE",
                },
                UserAthenaNonManagedRolePolicy: {
                    physicalResourceId: "my-user-policy-ABCDEF",
                    resourceType: "AWS::IAM::Policy",
                    resourceStatus: "CREATE_COMPLETE",
                },
                IcebergWorkGroup: {
                    physicalResourceId: "my-iceberg-workgroup",
                    resourceType: "AWS::Athena::WorkGroup",
                    resourceStatus: "CREATE_COMPLETE",
                },
                IcebergDatabase: {
                    physicalResourceId: "iceberg-catalog-db",
                    resourceType: "AWS::Glue::Database",
                    resourceStatus: "CREATE_COMPLETE",
                },
                UserAthenaResultsBucket: {
                    physicalResourceId: "athena-results-bucket-xyz",
                    resourceType: "AWS::S3::Bucket",
                    resourceStatus: "CREATE_COMPLETE",
                },
                UserAthenaResultsBucketPolicy: {
                    physicalResourceId: "athena-results-policy-xyz",
                    resourceType: "AWS::S3::BucketPolicy",
                    resourceStatus: "CREATE_COMPLETE",
                },
            };

            const discovered: DiscoveredQuiltResources = extractQuiltResources(mockResources);

            expect(discovered.athenaUserWorkgroup).toBe("my-user-workgroup");
            expect(discovered.athenaUserPolicy).toBe("my-user-policy-ABCDEF");
            expect(discovered.icebergWorkgroup).toBe("my-iceberg-workgroup");
            expect(discovered.icebergDatabase).toBe("iceberg-catalog-db");
            expect(discovered.athenaResultsBucket).toBe("athena-results-bucket-xyz");
            expect(discovered.athenaResultsBucketPolicy).toBe("athena-results-policy-xyz");
        });

        it("should handle partial resource sets gracefully", () => {
            const mockResources: StackResourceMap = {
                UserAthenaNonManagedRoleWorkgroup: {
                    physicalResourceId: "my-workgroup",
                    resourceType: "AWS::Athena::WorkGroup",
                    resourceStatus: "CREATE_COMPLETE",
                },
                // Iceberg resources not present
            };

            const discovered: DiscoveredQuiltResources = extractQuiltResources(mockResources);

            expect(discovered.athenaUserWorkgroup).toBe("my-workgroup");
            expect(discovered.icebergWorkgroup).toBeUndefined();
            expect(discovered.icebergDatabase).toBeUndefined();
        });

        it("should handle empty resource map gracefully", () => {
            const discovered: DiscoveredQuiltResources = extractQuiltResources({});

            expect(discovered).toBeDefined();
            expect(discovered.athenaUserWorkgroup).toBeUndefined();
            expect(discovered.athenaUserPolicy).toBeUndefined();
            expect(discovered.icebergWorkgroup).toBeUndefined();
            expect(discovered.icebergDatabase).toBeUndefined();
            expect(discovered.athenaResultsBucket).toBeUndefined();
            expect(discovered.athenaResultsBucketPolicy).toBeUndefined();
        });

        it("should ignore unrelated resources", () => {
            const mockResources: StackResourceMap = {
                UserAthenaNonManagedRoleWorkgroup: {
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

        it("should be a pure function (same input produces same output)", () => {
            const mockResources: StackResourceMap = {
                IcebergDatabase: {
                    physicalResourceId: "iceberg-db",
                    resourceType: "AWS::Glue::Database",
                    resourceStatus: "CREATE_COMPLETE",
                },
            };

            const result1 = extractQuiltResources(mockResources);
            const result2 = extractQuiltResources(mockResources);

            expect(result1).toEqual(result2);
        });
    });

    describe("buildInferredConfig()", () => {
        it("should build inferred configuration from stack details", () => {
            const mockConfig = {
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
                mockConfig,
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
            const mockConfig = {
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
                mockConfig,
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
            const mockConfig = {
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
                mockConfig,
                "stack-1",
                stackDetails,
                "eu-west-1",
                "999999999999",
                "https://test.example.com"
            );

            const result2 = buildInferredConfig(
                mockConfig,
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
        it("should transform default profile through complete pipeline", () => {
            // 1. Build environment variables from profile
            const envVars = buildEnvVars(defaultConfig, "native", {
                mode: "native",
                profile: "default",
                verbose: false,
                test: false,
            });

            // 2. Validate configuration
            expect(() => validateConfig(envVars, "default")).not.toThrow();

            // 3. Filter secrets for logging
            const filtered = filterSecrets(envVars);

            // 4. Verify secrets are masked
            if (envVars.BENCHLING_SECRET_ARN) {
                expect(filtered.BENCHLING_SECRET_ARN).toBe("***REDACTED***");
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
            };

            const result1 = buildEnvVars(defaultConfig, "docker", options);
            const result2 = buildEnvVars(defaultConfig, "docker", options);

            expect(result1).toEqual(result2);
        });
    });
});
