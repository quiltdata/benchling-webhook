import { S3BucketValidator } from "../lib/s3-bucket-validator";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";

// Create mock client
const mockS3 = mockClient(S3Client);

describe("S3BucketValidator", () => {
    beforeEach(() => {
        mockS3.reset();
    });

    describe("validate", () => {
        it("should validate S3 bucket access successfully", async () => {
            // Arrange
            const config = {
                bucketName: "valid-test-bucket",
                region: "us-west-2",
            };

            // Mock successful bucket access
            mockS3.resolves({});

            // Act
            const result = await S3BucketValidator.validate(config);

            // Assert
            expect(result.hasAccess).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should detect insufficient S3 bucket permissions", async () => {
            // Arrange
            const config = {
                bucketName: "restricted-bucket",
                region: "us-east-1",
            };

            // Mock permission denied
            const error = new Error("Access Denied") as Error & { name: string };
            error.name = "AccessDenied";
            mockS3.rejects(error);

            // Act
            const result = await S3BucketValidator.validate(config);

            // Assert
            expect(result.hasAccess).toBe(false);
            expect(result.errors).toContain("Insufficient write permissions");
        });

        it("should detect nonexistent bucket", async () => {
            // Arrange
            const config = {
                bucketName: "nonexistent-bucket",
                region: "us-east-1",
            };

            // Mock bucket not found
            const error = new Error("NoSuchBucket") as Error & { name: string };
            error.name = "NoSuchBucket";
            mockS3.rejects(error);

            // Act
            const result = await S3BucketValidator.validate(config);

            // Assert
            expect(result.hasAccess).toBe(false);
            expect(result.errors).toContain("Bucket does not exist");
        });

        it("should validate bucket configuration", async () => {
            // Arrange
            const config = {
                bucketName: "test-bucket",
                region: "us-west-2",
            };

            // Mock successful head bucket and test write
            mockS3.resolves({});

            // Act
            const result = await S3BucketValidator.validate(config);

            // Assert
            expect(result.isConfigured).toBe(true);
        });

        it("should test write permissions", async () => {
            // Arrange
            const config = {
                bucketName: "test-bucket",
                region: "us-west-2",
            };

            // Mock successful write
            mockS3.resolves({});

            // Act
            const result = await S3BucketValidator.validate(config);

            // Assert
            expect(result.hasWritePermission).toBe(true);
        });

        it("should test read permissions", async () => {
            // Arrange
            const config = {
                bucketName: "test-bucket",
                region: "us-west-2",
            };

            // Mock successful read
            mockS3.resolves({});

            // Act
            const result = await S3BucketValidator.validate(config);

            // Assert
            expect(result.hasReadPermission).toBe(true);
        });

        it("should handle network errors gracefully", async () => {
            // Arrange
            const config = {
                bucketName: "test-bucket",
                region: "us-west-2",
            };

            // Mock network error
            const error = new Error("Network timeout");
            mockS3.rejects(error);

            // Act
            const result = await S3BucketValidator.validate(config);

            // Assert
            expect(result.hasAccess).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe("validateBucketName", () => {
        it("should validate bucket name format", () => {
            expect(S3BucketValidator.validateBucketName("valid-bucket-name")).toBe(true);
            expect(S3BucketValidator.validateBucketName("my-bucket-123")).toBe(true);
            expect(S3BucketValidator.validateBucketName("")).toBe(false);
            expect(S3BucketValidator.validateBucketName("Invalid_Bucket")).toBe(false);
            expect(S3BucketValidator.validateBucketName("bucket.name")).toBe(true);
        });
    });

    describe("validateRegion", () => {
        it("should validate AWS region format", () => {
            expect(S3BucketValidator.validateRegion("us-east-1")).toBe(true);
            expect(S3BucketValidator.validateRegion("eu-west-2")).toBe(true);
            expect(S3BucketValidator.validateRegion("")).toBe(false);
            expect(S3BucketValidator.validateRegion("invalid-region")).toBe(false);
        });
    });

    describe("checkBucketExists", () => {
        it("should check if bucket exists", async () => {
            // Mock successful head bucket
            mockS3.resolves({});

            const exists = await S3BucketValidator.checkBucketExists("test-bucket", "us-west-2");
            expect(exists).toBe(true);
        });

        it("should return false for nonexistent bucket", async () => {
            // Mock bucket not found
            const error = new Error("NoSuchBucket") as Error & { name: string };
            error.name = "NoSuchBucket";
            mockS3.rejects(error);

            const exists = await S3BucketValidator.checkBucketExists("nonexistent-bucket", "us-west-2");
            expect(exists).toBe(false);
        });
    });
});
