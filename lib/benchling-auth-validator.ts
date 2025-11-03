import * as https from "https";

/**
 * Benchling credentials for authentication
 */
export interface BenchlingCredentials {
    tenant: string;
    clientId: string;
    clientSecret: string;
}

/**
 * Validation result from Benchling authentication
 */
export interface ValidationResult {
    isValid: boolean;
    hasRequiredPermissions?: boolean;
    errors: string[];
    warnings?: string[];
}

/**
 * OAuth token response from Benchling
 */
interface TokenResponse {
    access_token?: string;
    scope?: string;
    error?: string;
}

/**
 * Benchling authentication validator
 *
 * Validates Benchling credentials by attempting OAuth authentication
 * and checking required permissions.
 */
export class BenchlingAuthValidator {
    /**
     * Required OAuth scopes for the webhook integration
     */
    private static readonly REQUIRED_SCOPES = ["read", "write"];

    /**
     * Validate Benchling credentials
     *
     * @param credentials - Benchling credentials to validate
     * @returns Validation result with errors and warnings
     */
    public static async validate(credentials: BenchlingCredentials): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Basic credential validation
        if (!BenchlingAuthValidator.validateCredentials(credentials)) {
            errors.push("Invalid credentials: missing required fields");
            return {
                isValid: false,
                errors,
                warnings,
            };
        }

        // Validate tenant format
        if (!(await BenchlingAuthValidator.validateTenant(credentials.tenant))) {
            errors.push("Invalid tenant format");
            return {
                isValid: false,
                errors,
                warnings,
            };
        }

        // Attempt OAuth authentication
        try {
            const tokenResponse = await BenchlingAuthValidator.authenticate(credentials);

            if (!tokenResponse.access_token) {
                if (tokenResponse.error === "invalid_client") {
                    errors.push("Invalid client credentials");
                } else {
                    errors.push("Authentication failed");
                }
                return {
                    isValid: false,
                    errors,
                    warnings,
                };
            }

            // Check OAuth scopes
            const hasPermissions = BenchlingAuthValidator.checkPermissions(tokenResponse.scope || "");
            if (!hasPermissions) {
                warnings.push("Missing required permissions");
            }

            return {
                isValid: true,
                hasRequiredPermissions: hasPermissions,
                errors: [],
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes("404") || error.message.includes("tenant_not_found")) {
                    errors.push("Tenant not found");
                } else {
                    errors.push("Network error during validation");
                }
            }
            return {
                isValid: false,
                errors,
                warnings,
            };
        }
    }

    /**
     * Validate tenant format
     *
     * @param tenant - Benchling tenant name
     * @returns True if tenant format is valid
     */
    public static async validateTenant(tenant: string): Promise<boolean> {
        if (!tenant || tenant.trim() === "") {
            return false;
        }

        // Check for invalid characters (spaces, special chars)
        if (/\s/.test(tenant)) {
            return false;
        }

        return true;
    }

    /**
     * Validate credentials completeness
     *
     * @param credentials - Credentials to validate
     * @returns True if all required fields are present
     */
    public static validateCredentials(credentials: BenchlingCredentials): boolean {
        return !!(
            credentials.tenant &&
            credentials.clientId &&
            credentials.clientSecret &&
            credentials.tenant.trim() !== "" &&
            credentials.clientId.trim() !== "" &&
            credentials.clientSecret.trim() !== ""
        );
    }

    /**
     * Authenticate with Benchling OAuth API
     *
     * @param credentials - Benchling credentials
     * @returns Token response from Benchling
     */
    private static async authenticate(credentials: BenchlingCredentials): Promise<TokenResponse> {
        const { tenant, clientId, clientSecret } = credentials;

        return new Promise((resolve, reject) => {
            const authString = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
            const postData = "grant_type=client_credentials";

            const options = {
                hostname: `${tenant}.benchling.com`,
                port: 443,
                path: "/api/v2/token",
                method: "POST",
                headers: {
                    "Authorization": `Basic ${authString}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = "";

                res.on("data", (chunk: Buffer) => {
                    data += chunk.toString();
                });

                res.on("end", () => {
                    if (res.statusCode === 404) {
                        reject(new Error("404: Tenant not found"));
                        return;
                    }

                    try {
                        const response = JSON.parse(data) as TokenResponse;
                        if (res.statusCode === 401) {
                            response.error = "invalid_client";
                        }
                        resolve(response);
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on("error", (error: Error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Check if OAuth scopes include required permissions
     *
     * @param scope - OAuth scope string
     * @returns True if all required scopes are present
     */
    private static checkPermissions(scope: string): boolean {
        const scopes = scope.toLowerCase().split(" ");
        return BenchlingAuthValidator.REQUIRED_SCOPES.every((requiredScope) =>
            scopes.includes(requiredScope),
        );
    }
}
