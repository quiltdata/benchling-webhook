/**
 * Tests for Configuration Type Definitions (Episode 1)
 *
 * Tests the QuiltConfig interface updates for service environment variables.
 */

import Ajv from "ajv";
import { ProfileConfigSchema, QuiltConfig } from "../../lib/types/config";

describe("QuiltConfig", () => {
    test("stackArn is optional for explicit service configuration", () => {
        // Test that config can be created without stackArn when services are explicit
        const config: QuiltConfig = {
            catalog: "quilt.example.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
            region: "us-east-1",
            // stackArn not provided - should be optional
        };
        expect(config).toBeDefined();
        expect(config.catalog).toBe("quilt.example.com");
        expect(config.queueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/queue");
    });

    test("stackArn can still be provided for backward compatibility", () => {
        const config: QuiltConfig = {
            stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack/abc-123",
            catalog: "quilt.example.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
            region: "us-east-1",
        };
        expect(config).toBeDefined();
        expect(config.stackArn).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack/abc-123");
    });

    test("athenaUserWorkgroup is optional", () => {
        const config: QuiltConfig = {
            catalog: "quilt.example.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
            region: "us-east-1",
        };
        expect(config).toBeDefined();
        expect(config.database).toBe("quilt_db");
    });

    test("athenaUserWorkgroup can be provided when available", () => {
        const config: QuiltConfig = {
            catalog: "quilt.example.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
            region: "us-east-1",
            athenaUserWorkgroup: "quilt-workgroup",
        };
        expect(config).toBeDefined();
        expect(config.athenaUserWorkgroup).toBe("quilt-workgroup");
    });

    test("icebergDatabase can be provided for bucketless Iceberg search", () => {
        const config: QuiltConfig = {
            catalog: "quilt.example.com",
            database: "quilt_db",
            queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
            region: "us-east-1",
            icebergDatabase: "iceberg_db",
        };
        expect(config.icebergDatabase).toBe("iceberg_db");
    });

    test("profile schema accepts optional icebergDatabase", () => {
        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile(ProfileConfigSchema);
        const valid = validate({
            quilt: {
                catalog: "quilt.example.com",
                database: "quilt_db",
                queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
                region: "us-east-1",
                icebergDatabase: "iceberg_db",
            },
            benchling: {
                tenant: "test-tenant",
                clientId: "client_123",
                appDefinitionId: "app_123",
            },
            packages: {
                prefix: "benchling",
                metadataKey: "experiment_id",
            },
            deployment: {
                region: "us-east-1",
            },
            _metadata: {
                version: "0.19.0",
                createdAt: "2026-07-06T00:00:00Z",
                updatedAt: "2026-07-06T00:00:00Z",
                source: "wizard",
            },
        });

        expect(validate.errors).toBeNull();
        expect(valid).toBe(true);
    });
});
