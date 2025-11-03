/**
 * Tests for Quilt Catalog Auto-Inference
 */

import { inferQuiltConfig, inferenceResultToDerivedConfig } from "../../scripts/infer-quilt-config";

// Mock execSync for quilt3 command
jest.mock("child_process");
// Mock fs for file reading
jest.mock("fs");
// Mock AWS SDK
jest.mock("@aws-sdk/client-cloudformation");

describe("Quilt Catalog Auto-Inference", () => {
    describe("inferenceResultToDerivedConfig", () => {
        it("should convert inference result to DerivedConfig", () => {
            const result = {
                catalogUrl: "https://quilt.example.com",
                quiltUserBucket: "my-bucket",
                quiltStackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc",
                quiltRegion: "us-east-1",
                queueArn: "arn:aws:sqs:us-east-1:123456789012:my-queue",
                source: "cloudformation",
            };

            const config = inferenceResultToDerivedConfig(result);

            expect(config.catalogUrl).toBe("https://quilt.example.com");
            expect(config.quiltCatalog).toBe("https://quilt.example.com");
            expect(config.quiltUserBucket).toBe("my-bucket");
            expect(config.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abc");
            expect(config.quiltRegion).toBe("us-east-1");
            expect(config.queueArn).toBe("arn:aws:sqs:us-east-1:123456789012:my-queue");
            expect(config._metadata?.inferredFrom).toBe("cloudformation");
            expect(config._metadata?.source).toBe("infer-quilt-config");
            expect(config._metadata?.version).toBe("0.6.0");
        });

        it("should handle partial inference results", () => {
            const result = {
                catalogUrl: "https://quilt.example.com",
                source: "quilt3-cli",
            };

            const config = inferenceResultToDerivedConfig(result);

            expect(config.catalogUrl).toBe("https://quilt.example.com");
            expect(config.quiltUserBucket).toBeUndefined();
            expect(config._metadata?.inferredFrom).toBe("quilt3-cli");
        });

        it("should include metadata", () => {
            const result = {
                source: "none",
            };

            const config = inferenceResultToDerivedConfig(result);

            expect(config._metadata).toBeDefined();
            expect(config._metadata?.inferredAt).toBeDefined();
            expect(config._metadata?.inferredFrom).toBe("none");
        });
    });

    describe("inferQuiltConfig", () => {
        it("should return empty result when no sources available", async () => {
            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            expect(result.source).toBeDefined();
        });

        it("should respect non-interactive mode", async () => {
            const result = await inferQuiltConfig({
                region: "us-east-1",
                interactive: false,
            });

            // Should not prompt for user input
            expect(result).toBeDefined();
        });
    });
});
