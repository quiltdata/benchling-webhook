import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * S3 bucket configuration
 */
export interface S3BucketConfig {
    bucketName: string;
    region: string;
}

/**
 * S3 bucket validation result
 */
export interface S3ValidationResult {
    hasAccess: boolean;
    isConfigured: boolean;
    hasWritePermission?: boolean;
    hasReadPermission?: boolean;
    errors: string[];
}

/**
 * S3 bucket access validator
 *
 * Validates S3 bucket access and permissions required for the webhook integration.
 */
export class S3BucketValidator {
    /**
     * Valid AWS region patterns
     */
    private static readonly VALID_REGIONS = /^(us|eu|ap|sa|ca|me|af|cn|us-gov)-(north|south|east|west|central|northeast|southeast|southwest|northwest)-\d+$/;

    /**
     * Validate S3 bucket access and permissions
     *
     * @param config - S3 bucket configuration
     * @returns Validation result with access status and errors
     */
    public static async validate(config: S3BucketConfig): Promise<S3ValidationResult> {
        const errors: string[] = [];

        // Validate bucket name format
        if (!S3BucketValidator.validateBucketName(config.bucketName)) {
            errors.push("Invalid bucket name format");
            return {
                hasAccess: false,
                isConfigured: false,
                errors,
            };
        }

        // Validate region format
        if (!S3BucketValidator.validateRegion(config.region)) {
            errors.push("Invalid AWS region");
            return {
                hasAccess: false,
                isConfigured: false,
                errors,
            };
        }

        // Create S3 client
        const s3Client = new S3Client({ region: config.region });

        try {
            // Check if bucket exists
            const bucketExists = await S3BucketValidator.checkBucketExists(
                config.bucketName,
                config.region,
                s3Client,
            );

            if (!bucketExists) {
                errors.push("Bucket does not exist");
                return {
                    hasAccess: false,
                    isConfigured: false,
                    errors,
                };
            }

            // Test write permissions
            const hasWritePermission = await S3BucketValidator.testWritePermission(
                config.bucketName,
                s3Client,
            );

            if (!hasWritePermission) {
                errors.push("Insufficient write permissions");
                return {
                    hasAccess: false,
                    isConfigured: false,
                    hasWritePermission: false,
                    errors,
                };
            }

            // Test read permissions
            const hasReadPermission = await S3BucketValidator.testReadPermission(
                config.bucketName,
                s3Client,
            );

            return {
                hasAccess: true,
                isConfigured: true,
                hasWritePermission,
                hasReadPermission,
                errors: [],
            };
        } catch (error) {
            if (error instanceof Error) {
                const errorName = (error as {name?: string}).name || "";

                if (errorName === "NoSuchBucket") {
                    errors.push("Bucket does not exist");
                } else if (errorName === "AccessDenied" || errorName === "Forbidden") {
                    errors.push("Insufficient write permissions");
                } else {
                    errors.push(`Validation error: ${error.message}`);
                }
            }

            return {
                hasAccess: false,
                isConfigured: false,
                errors,
            };
        }
    }

    /**
     * Validate S3 bucket name format
     *
     * @param bucketName - Bucket name to validate
     * @returns True if bucket name is valid
     */
    public static validateBucketName(bucketName: string): boolean {
        if (!bucketName || bucketName.trim() === "") {
            return false;
        }

        // S3 bucket naming rules:
        // - 3-63 characters
        // - lowercase letters, numbers, hyphens, dots
        // - must start and end with letter or number
        const bucketRegex = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

        // Reject names with uppercase (invalid for S3)
        if (bucketName !== bucketName.toLowerCase()) {
            return false;
        }

        return bucketRegex.test(bucketName);
    }

    /**
     * Validate AWS region format
     *
     * @param region - AWS region to validate
     * @returns True if region format is valid
     */
    public static validateRegion(region: string): boolean {
        if (!region || region.trim() === "") {
            return false;
        }

        return S3BucketValidator.VALID_REGIONS.test(region);
    }

    /**
     * Check if S3 bucket exists
     *
     * @param bucketName - Name of the bucket
     * @param region - AWS region
     * @param s3Client - Optional S3 client instance
     * @returns True if bucket exists
     */
    public static async checkBucketExists(
        bucketName: string,
        region: string,
        s3Client?: S3Client,
    ): Promise<boolean> {
        const client = s3Client || new S3Client({ region });

        try {
            const command = new HeadBucketCommand({ Bucket: bucketName });
            await client.send(command);
            return true;
        } catch (error) {
            const errorName = (error as {name?: string}).name || "";
            if (errorName === "NoSuchBucket" || errorName === "NotFound") {
                return false;
            }
            // For other errors (like AccessDenied), bucket exists but we can't access it
            throw error;
        }
    }

    /**
     * Test write permissions on S3 bucket
     *
     * @param bucketName - Name of the bucket
     * @param s3Client - S3 client instance
     * @returns True if write permission is granted
     */
    private static async testWritePermission(
        bucketName: string,
        s3Client: S3Client,
    ): Promise<boolean> {
        const testKey = `.benchling-webhook-test-${Date.now()}`;

        try {
            // Attempt to write a test object
            const putCommand = new PutObjectCommand({
                Bucket: bucketName,
                Key: testKey,
                Body: "test",
            });
            await s3Client.send(putCommand);

            // Clean up test object
            const deleteCommand = new DeleteObjectCommand({
                Bucket: bucketName,
                Key: testKey,
            });
            await s3Client.send(deleteCommand);

            return true;
        } catch (error) {
            const errorName = (error as {name?: string}).name || "";
            if (errorName === "AccessDenied" || errorName === "Forbidden") {
                return false;
            }
            throw error;
        }
    }

    /**
     * Test read permissions on S3 bucket
     *
     * @param bucketName - Name of the bucket
     * @param s3Client - S3 client instance
     * @returns True if read permission is granted
     */
    private static async testReadPermission(
        bucketName: string,
        s3Client: S3Client,
    ): Promise<boolean> {
        const testKey = `.benchling-webhook-test-${Date.now()}`;

        try {
            // First, write a test object
            const putCommand = new PutObjectCommand({
                Bucket: bucketName,
                Key: testKey,
                Body: "test",
            });
            await s3Client.send(putCommand);

            // Attempt to read the test object
            const getCommand = new GetObjectCommand({
                Bucket: bucketName,
                Key: testKey,
            });
            await s3Client.send(getCommand);

            // Clean up test object
            const deleteCommand = new DeleteObjectCommand({
                Bucket: bucketName,
                Key: testKey,
            });
            await s3Client.send(deleteCommand);

            return true;
        } catch (error) {
            const errorName = (error as {name?: string}).name || "";
            if (errorName === "AccessDenied" || errorName === "Forbidden") {
                return false;
            }
            // If we can't read, still try to clean up
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: testKey,
                });
                await s3Client.send(deleteCommand);
            } catch {
                // Ignore cleanup errors
            }
            throw error;
        }
    }
}
