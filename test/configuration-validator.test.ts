import { ConfigurationValidator } from "../lib/configuration-validator";
import { BenchlingAuthValidator } from "../lib/benchling-auth-validator";
import { S3BucketValidator } from "../lib/s3-bucket-validator";

// Mock the validators
jest.mock("../lib/benchling-auth-validator");
jest.mock("../lib/s3-bucket-validator");

describe("ConfigurationValidator", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("validate", () => {
        it("should validate complete configuration", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "valid-client-id",
                benchlingClientSecret: "valid-secret",
                benchlingAppDefinitionId: "app-id",
                quiltUserBucket: "test-bucket",
                quiltRegion: "us-west-2",
            };

            // Mock successful validations
            (BenchlingAuthValidator.validate as jest.Mock).mockResolvedValue({
                isValid: true,
                hasRequiredPermissions: true,
                errors: [],
            });
            (S3BucketValidator.validate as jest.Mock).mockResolvedValue({
                hasAccess: true,
                isConfigured: true,
                errors: [],
            });

            // Act
            const result = await ConfigurationValidator.validate(config);

            // Assert
            expect(result.isValid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should fail validation with multiple errors", async () => {
            // Arrange
            const config = {
                catalogUrl: "",
                benchlingTenant: "",
                benchlingClientId: "invalid-client",
                benchlingClientSecret: "secret",
                quiltUserBucket: "inaccessible-bucket",
                quiltRegion: "us-west-2",
            };

            // Mock validation failures
            (BenchlingAuthValidator.validate as jest.Mock).mockResolvedValue({
                isValid: false,
                errors: ["Invalid Benchling tenant"],
            });
            (S3BucketValidator.validate as jest.Mock).mockResolvedValue({
                hasAccess: false,
                errors: ["S3 bucket access denied"],
            });

            // Act
            const result = await ConfigurationValidator.validate(config);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors).toContain("Invalid catalog URL");
            expect(result.errors).toContain("S3 bucket access denied");
            // Check that missing fields error is present
            expect(result.errors.some(err => err.includes("Missing required fields"))).toBe(true);
        });

        it("should validate catalog URL format", async () => {
            // Arrange
            const config = {
                catalogUrl: "invalid-url",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "secret",
                benchlingAppDefinitionId: "app-id",
                quiltUserBucket: "bucket",
                quiltRegion: "us-west-2",
            };

            // Mock successful other validations
            (BenchlingAuthValidator.validate as jest.Mock).mockResolvedValue({
                isValid: true,
                errors: [],
            });
            (S3BucketValidator.validate as jest.Mock).mockResolvedValue({
                hasAccess: true,
                errors: [],
            });

            // Act
            const result = await ConfigurationValidator.validate(config);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain("Invalid catalog URL");
        });

        it("should check required fields are present", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                // Missing required Benchling fields
            };

            // Act
            const result = await ConfigurationValidator.validate(config);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("should aggregate errors from multiple validators", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "secret",
                benchlingAppDefinitionId: "app-id",
                quiltUserBucket: "bucket",
                quiltRegion: "us-west-2",
            };

            // Mock multiple validation failures
            (BenchlingAuthValidator.validate as jest.Mock).mockResolvedValue({
                isValid: false,
                errors: ["Benchling error 1", "Benchling error 2"],
            });
            (S3BucketValidator.validate as jest.Mock).mockResolvedValue({
                hasAccess: false,
                errors: ["S3 error 1"],
            });

            // Act
            const result = await ConfigurationValidator.validate(config);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors).toHaveLength(3);
            expect(result.errors).toContain("Benchling error 1");
            expect(result.errors).toContain("Benchling error 2");
            expect(result.errors).toContain("S3 error 1");
        });

        it("should include warnings from validators", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "secret",
                benchlingAppDefinitionId: "app-id",
                quiltUserBucket: "bucket",
                quiltRegion: "us-west-2",
            };

            // Mock validation with warnings
            (BenchlingAuthValidator.validate as jest.Mock).mockResolvedValue({
                isValid: true,
                hasRequiredPermissions: false,
                errors: [],
                warnings: ["Missing some permissions"],
            });
            (S3BucketValidator.validate as jest.Mock).mockResolvedValue({
                hasAccess: true,
                errors: [],
            });

            // Act
            const result = await ConfigurationValidator.validate(config);

            // Assert
            expect(result.isValid).toBe(true);
            expect(result.warnings).toContain("Missing some permissions");
        });

        it("should support partial configuration validation", async () => {
            // Arrange
            const partialConfig = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
            };

            // Act
            const result = await ConfigurationValidator.validate(partialConfig, {
                skipBenchlingValidation: true,
                skipS3Validation: true,
            });

            // Assert
            expect(result.isValid).toBe(false); // Missing required fields
        });

        it("should handle validation exceptions gracefully", async () => {
            // Arrange
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "test-tenant",
                benchlingClientId: "client-id",
                benchlingClientSecret: "secret",
                benchlingAppDefinitionId: "app-id",
                quiltUserBucket: "bucket",
                quiltRegion: "us-west-2",
            };

            // Mock validation exception
            (BenchlingAuthValidator.validate as jest.Mock).mockRejectedValue(
                new Error("Network error")
            );
            (S3BucketValidator.validate as jest.Mock).mockResolvedValue({
                hasAccess: true,
                errors: [],
            });

            // Act
            const result = await ConfigurationValidator.validate(config);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain("Benchling validation failed: Network error");
        });
    });

    describe("validateCatalogUrl", () => {
        it("should validate catalog URL format", () => {
            expect(ConfigurationValidator.validateCatalogUrl("https://quilt.example.com")).toBe(true);
            expect(ConfigurationValidator.validateCatalogUrl("http://localhost:3000")).toBe(true);
            expect(ConfigurationValidator.validateCatalogUrl("")).toBe(false);
            expect(ConfigurationValidator.validateCatalogUrl("not-a-url")).toBe(false);
        });
    });

    describe("checkRequiredFields", () => {
        it("should identify missing required fields", () => {
            const config = {
                catalogUrl: "https://quilt.example.com",
            };

            const missing = ConfigurationValidator.checkRequiredFields(config);
            expect(missing.length).toBeGreaterThan(0);
            expect(missing).toContain("benchlingTenant");
        });

        it("should return empty array when all fields present", () => {
            const config = {
                catalogUrl: "https://quilt.example.com",
                benchlingTenant: "tenant",
                benchlingClientId: "id",
                benchlingClientSecret: "secret",
                benchlingAppDefinitionId: "app-id",
                quiltUserBucket: "bucket",
                quiltRegion: "region",
            };

            const missing = ConfigurationValidator.checkRequiredFields(config);
            expect(missing).toEqual([]);
        });
    });
});
