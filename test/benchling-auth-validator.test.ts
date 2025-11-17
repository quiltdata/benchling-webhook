import { BenchlingAuthValidator } from "../lib/benchling-auth-validator";

// Mock HTTP requests
jest.mock("https", () => ({
    request: jest.fn(),
}));

import * as https from "https";

describe("BenchlingAuthValidator", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("validate", () => {
        it("should validate Benchling credentials successfully", async () => {
            // Arrange
            const credentials = {
                tenant: "test-tenant",
                clientId: "valid-client-id",
                clientSecret: "valid-secret",
            };

            // Mock successful authentication response
            mockHttpsRequest(200, { access_token: "test-token" });

            // Act
            const result = await BenchlingAuthValidator.validate(credentials);

            // Assert
            expect(result.isValid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should detect invalid Benchling credentials", async () => {
            // Arrange
            const credentials = {
                tenant: "test-tenant",
                clientId: "invalid-client-id",
                clientSecret: "wrong-secret",
            };

            // Mock authentication failure
            mockHttpsRequest(401, { error: "invalid_client" });

            // Act
            const result = await BenchlingAuthValidator.validate(credentials);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain("Invalid client credentials");
        });

        it("should validate tenant exists", async () => {
            // Arrange
            const credentials = {
                tenant: "nonexistent-tenant",
                clientId: "client-id",
                clientSecret: "secret",
            };

            // Mock tenant not found
            mockHttpsRequest(404, { error: "tenant_not_found" });

            // Act
            const result = await BenchlingAuthValidator.validate(credentials);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain("Tenant not found");
        });

        it("should validate tenant and app permissions", async () => {
            // Arrange
            const credentials = {
                tenant: "test-tenant",
                clientId: "limited-permissions-client",
                clientSecret: "secret",
            };

            // Mock successful auth but limited permissions
            mockHttpsRequest(200, { access_token: "test-token", scope: "read" });

            // Act
            const result = await BenchlingAuthValidator.validate(credentials);

            // Assert
            expect(result.hasRequiredPermissions).toBe(false);
            expect(result.warnings).toContain("Missing required permissions");
        });

        it("should handle network errors gracefully", async () => {
            // Arrange
            const credentials = {
                tenant: "test-tenant",
                clientId: "client-id",
                clientSecret: "secret",
            };

            // Mock network error
            mockHttpsRequestError(new Error("Network error"));

            // Act
            const result = await BenchlingAuthValidator.validate(credentials);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain("Network error during validation");
        });

        it("should validate OAuth scopes", async () => {
            // Arrange
            const credentials = {
                tenant: "test-tenant",
                clientId: "client-id",
                clientSecret: "secret",
            };

            // Mock successful auth with full permissions
            mockHttpsRequest(200, {
                access_token: "test-token",
                scope: "read write admin",
            });

            // Act
            const result = await BenchlingAuthValidator.validate(credentials);

            // Assert
            expect(result.hasRequiredPermissions).toBe(true);
        });
    });

    describe("validateTenant", () => {
        it("should validate tenant format", async () => {
            expect(await BenchlingAuthValidator.validateTenant("valid-tenant")).toBe(true);
            expect(await BenchlingAuthValidator.validateTenant("")).toBe(false);
            expect(await BenchlingAuthValidator.validateTenant("invalid tenant")).toBe(false);
        });
    });

    describe("validateCredentials", () => {
        it("should validate complete credentials", () => {
            const validCredentials = {
                tenant: "test-tenant",
                clientId: "client-id",
                clientSecret: "client-secret",
            };

            expect(BenchlingAuthValidator.validateCredentials(validCredentials)).toBe(true);
        });

        it("should reject incomplete credentials", () => {
            const incompleteCredentials = {
                tenant: "test-tenant",
                clientId: "",
                clientSecret: "secret",
            };

            expect(BenchlingAuthValidator.validateCredentials(incompleteCredentials)).toBe(false);
        });
    });
});

/**
 * Mock HTTPS request helper
 */
function mockHttpsRequest(statusCode: number, responseBody: Record<string, unknown>): void {
    const mockHttps = jest.mocked(https);
    mockHttps.request.mockImplementation((options: unknown, callback: (res: unknown) => void) => {
        const mockResponse = {
            statusCode,
            on: jest.fn((event: string, handler: (data: Buffer) => void) => {
                if (event === "data") {
                    handler(Buffer.from(JSON.stringify(responseBody)));
                }
                if (event === "end") {
                    handler(Buffer.from(""));
                }
            }),
        };
        callback(mockResponse);
        return {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn(),
        };
    });
}

/**
 * Mock HTTPS request error helper
 */
function mockHttpsRequestError(error: Error): void {
    const mockHttps = jest.mocked(https);
    mockHttps.request.mockImplementation(() => {
        return {
            on: jest.fn((event: string, handler: (err: Error) => void) => {
                if (event === "error") {
                    handler(error);
                }
            }),
            write: jest.fn(),
            end: jest.fn(),
        };
    });
}
