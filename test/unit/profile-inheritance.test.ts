/**
 * Unit tests for Profile Inheritance (v0.7.0)
 *
 * Tests profile inheritance with deep merge behavior and circular detection.
 */

import { XDGConfig } from "../../lib/xdg-config";
import { ProfileConfig } from "../../lib/types/config";
import { mkdirSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Profile Inheritance", () => {
    let testBaseDir: string;
    let xdg: XDGConfig;

    beforeEach(() => {
        // Create temporary test directory for each test
        testBaseDir = join(tmpdir(), `xdg-inherit-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
        mkdirSync(testBaseDir, { recursive: true });
        xdg = new XDGConfig(testBaseDir);
    });

    afterEach(() => {
        // Clean up test directory after each test
        if (existsSync(testBaseDir)) {
            rmSync(testBaseDir, { recursive: true, force: true });
        }
    });

    describe("simple inheritance", () => {
        it("should inherit from base profile using _inherits field", () => {
            // Create default (base) profile
            const defaultConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "default_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/default-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "default-tenant",
                    clientId: "default-client",
                    appDefinitionId: "default-app",
                },
                packages: {
                    bucket: "default-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "stable",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("default", defaultConfig);

            // Create dev profile that inherits from default
            const devConfig: ProfileConfig = {
                _inherits: "default",
                benchling: {
                    tenant: "default-tenant",
                    clientId: "default-client",
                    appDefinitionId: "dev-app-override",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "default_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/default-queue",
                    region: "us-east-1",
                },
                packages: {
                    bucket: "default-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("dev", devConfig);

            // Read with inheritance
            const resolved = xdg.readProfileWithInheritance("dev");

            // Should have all fields from default
            expect(resolved.benchling.tenant).toBe("default-tenant");
            expect(resolved.packages.bucket).toBe("default-packages");

            // Should have overridden fields from dev
            expect(resolved.benchling.appDefinitionId).toBe("dev-app-override");
            expect(resolved.deployment.imageTag).toBe("latest");

            // Should not include _inherits in final result
            expect(resolved._inherits).toBeUndefined();
        });

        it("should use explicit base profile parameter", () => {
            const baseConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "base-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("base", baseConfig);

            const childConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "child-client-override",
                    appDefinitionId: "base-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("child", childConfig);

            const resolved = xdg.readProfileWithInheritance("child", "base");

            expect(resolved.benchling.tenant).toBe("base-tenant");
            expect(resolved.benchling.clientId).toBe("child-client-override");
        });

        it("should return profile as-is when no inheritance specified", () => {
            const standaloneConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "standalone_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/standalone-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "standalone-tenant",
                    clientId: "standalone-client",
                    appDefinitionId: "standalone-app",
                },
                packages: {
                    bucket: "standalone-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("standalone", standaloneConfig);

            const resolved = xdg.readProfileWithInheritance("standalone");

            expect(resolved).toEqual(standaloneConfig);
        });
    });

    describe("deep merge behavior", () => {
        it("should deep merge nested objects correctly", () => {
            const baseConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "base-app",
                    testEntryId: "base-test-entry",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "base-prefix",
                    metadataKey: "base-key",
                },
                deployment: {
                    region: "us-east-1",
                    account: "123456789012",
                },
                logging: {
                    level: "INFO",
                },
                security: {
                    webhookAllowList: "192.168.1.0/24",
                    enableVerification: true,
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("base", baseConfig);

            const childConfig: ProfileConfig = {
                _inherits: "base",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "child-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "child-prefix",
                    metadataKey: "base-key",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                logging: {
                    level: "DEBUG",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("child", childConfig);

            const resolved = xdg.readProfileWithInheritance("child");

            // Base fields should be preserved
            expect(resolved.benchling.tenant).toBe("base-tenant");
            expect(resolved.benchling.clientId).toBe("base-client");
            expect(resolved.benchling.testEntryId).toBe("base-test-entry");
            expect(resolved.deployment.account).toBe("123456789012");
            expect(resolved.security?.webhookAllowList).toBe("192.168.1.0/24");
            expect(resolved.security?.enableVerification).toBe(true);

            // Overridden fields should use child values
            expect(resolved.benchling.appDefinitionId).toBe("child-app");
            expect(resolved.packages.prefix).toBe("child-prefix");
            expect(resolved.deployment.imageTag).toBe("latest");
            expect(resolved.logging?.level).toBe("DEBUG");
        });

        it("should override entire optional sections when specified", () => {
            const baseConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "base-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                security: {
                    webhookAllowList: "192.168.1.0/24",
                    enableVerification: true,
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("base", baseConfig);

            const childConfig: ProfileConfig = {
                _inherits: "base",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "base-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                security: {
                    webhookAllowList: "10.0.0.0/8",
                    enableVerification: false,
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("child", childConfig);

            const resolved = xdg.readProfileWithInheritance("child");

            expect(resolved.security?.webhookAllowList).toBe("10.0.0.0/8");
            expect(resolved.security?.enableVerification).toBe(false);
        });
    });

    describe("circular inheritance detection", () => {
        it("should detect direct circular inheritance (A -> A)", () => {
            const circularConfig: ProfileConfig = {
                _inherits: "circular",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("circular", circularConfig);

            expect(() => xdg.readProfileWithInheritance("circular")).toThrow(/Circular inheritance detected/);
        });

        it("should detect two-level circular inheritance (A -> B -> A)", () => {
            const profileA: ProfileConfig = {
                _inherits: "profileB",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            const profileB: ProfileConfig = {
                _inherits: "profileA",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("profileA", profileA);
            xdg.writeProfile("profileB", profileB);

            expect(() => xdg.readProfileWithInheritance("profileA")).toThrow(/Circular inheritance detected/);
            expect(() => xdg.readProfileWithInheritance("profileB")).toThrow(/Circular inheritance detected/);
        });

        it("should detect multi-level circular inheritance (A -> B -> C -> A)", () => {
            const profileA: ProfileConfig = {
                _inherits: "profileB",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            const profileB: ProfileConfig = {
                _inherits: "profileC",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            const profileC: ProfileConfig = {
                _inherits: "profileA",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "test_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "test-tenant",
                    clientId: "test-client",
                    appDefinitionId: "test-app",
                },
                packages: {
                    bucket: "test-packages",
                    prefix: "benchling",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("profileA", profileA);
            xdg.writeProfile("profileB", profileB);
            xdg.writeProfile("profileC", profileC);

            expect(() => xdg.readProfileWithInheritance("profileA")).toThrow(/Circular inheritance detected/);
        });
    });

    describe("inheritance chain", () => {
        it("should support multi-level inheritance chain without cycles", () => {
            // Base profile
            const baseConfig: ProfileConfig = {
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "base-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "base",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "stable",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T10:00:00Z",
                    updatedAt: "2025-11-04T10:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("base", baseConfig);

            // Dev inherits from base
            const devConfig: ProfileConfig = {
                _inherits: "base",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "dev-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "dev",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "latest",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T11:00:00Z",
                    updatedAt: "2025-11-04T11:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("dev", devConfig);

            // Staging inherits from dev
            const stagingConfig: ProfileConfig = {
                _inherits: "dev",
                quilt: {
                    stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc",
                    catalog: "https://quilt.example.com",
                    database: "base_db",
                    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/base-queue",
                    region: "us-east-1",
                },
                benchling: {
                    tenant: "base-tenant",
                    clientId: "base-client",
                    appDefinitionId: "staging-app",
                },
                packages: {
                    bucket: "base-packages",
                    prefix: "staging",
                    metadataKey: "experiment_id",
                },
                deployment: {
                    region: "us-east-1",
                    imageTag: "rc",
                },
                _metadata: {
                    version: "0.7.0",
                    createdAt: "2025-11-04T12:00:00Z",
                    updatedAt: "2025-11-04T12:00:00Z",
                    source: "wizard",
                },
            };

            xdg.writeProfile("staging", stagingConfig);

            const resolved = xdg.readProfileWithInheritance("staging");

            // Should inherit from base through dev
            expect(resolved.benchling.tenant).toBe("base-tenant");

            // Should use staging overrides
            expect(resolved.benchling.appDefinitionId).toBe("staging-app");
            expect(resolved.packages.prefix).toBe("staging");
            expect(resolved.deployment.imageTag).toBe("rc");
        });
    });
});
