/**
 * Tests for Configuration Type Definitions (Episode 1)
 *
 * Tests the QuiltConfig interface updates for service environment variables.
 */

import { QuiltConfig } from "../../lib/types/config";

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
});
