# Phase 1 Design: Secret Structure Standardization and Validation

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Phase**: DECO - Design (Phase 1)
**Date**: 2025-10-30

## Phase Overview

Establish the canonical secret JSON structure and comprehensive validation framework without changing any deployment behavior. This phase creates the foundation for all subsequent phases by defining data structures, validation logic, and error handling patterns.

## Design Goals

1. Define TypeScript interfaces for Benchling secrets
2. Create validation functions with comprehensive error messages
3. Establish format detection logic (ARN vs JSON)
4. Maintain 100% backward compatibility
5. Achieve >90% test coverage for validation logic

## Technical Design

### 1. Secret Structure Definition

#### File: `lib/utils/secrets.ts` (NEW)

Create new module for secret-related types and utilities.

**Interface: BenchlingSecretData**

```typescript
/**
 * Benchling secret structure stored in AWS Secrets Manager
 */
export interface BenchlingSecretData {
  /** Benchling OAuth client ID */
  client_id: string;

  /** Benchling OAuth client secret */
  client_secret: string;

  /** Benchling tenant name (e.g., "company" for company.benchling.com) */
  tenant: string;

  /** Benchling app definition ID (optional for backward compatibility) */
  app_definition_id?: string;

  /** Custom Benchling API URL (optional, defaults to https://{tenant}.benchling.com) */
  api_url?: string;
}
```

**Type: BenchlingSecretsInput**

```typescript
/**
 * Accepted formats for BENCHLING_SECRETS parameter
 * Can be either a Secret ARN or JSON string
 */
export type BenchlingSecretsInput = string;

/**
 * Parsed and validated secret configuration
 */
export interface BenchlingSecretsConfig {
  /** The input format detected */
  format: "arn" | "json";

  /** If format is "arn", the validated ARN */
  arn?: string;

  /** If format is "json", the validated secret data */
  data?: BenchlingSecretData;

  /** Original input value (for error messages) */
  original: string;
}
```

### 2. Format Detection Logic

#### Function: `detectSecretsFormat(input: string): "arn" | "json"`

**Purpose**: Determine if input is an ARN or JSON string

**Algorithm**:
```typescript
export function detectSecretsFormat(input: string): "arn" | "json" {
  // Trim whitespace
  const trimmed = input.trim();

  // Check if starts with ARN prefix
  if (trimmed.startsWith("arn:aws:secretsmanager:")) {
    return "arn";
  }

  // Check if starts with { (JSON object)
  if (trimmed.startsWith("{")) {
    return "json";
  }

  // Default to JSON and let validation catch errors
  return "json";
}
```

**Edge Cases**:
- Empty string → JSON format, validation will fail
- Malformed ARN → ARN format, validation will fail
- Non-JSON string → JSON format, parse will fail with clear error

### 3. ARN Validation Logic

#### Function: `validateSecretArn(arn: string): ValidationResult`

**Purpose**: Validate AWS Secrets Manager ARN format

**ARN Format**:
```
arn:aws:secretsmanager:region:account:secret:name
```

**Validation Rules**:
1. Must start with `arn:aws:secretsmanager:`
2. Must have region (can be any valid AWS region)
3. Must have account ID (12 digits)
4. Must have secret name (non-empty)

**Implementation**:
```typescript
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

export function validateSecretArn(arn: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Check ARN format using regex
  const arnPattern = /^arn:aws:secretsmanager:([a-z0-9-]+):(\d{12}):secret:(.+)$/;
  const match = arn.match(arnPattern);

  if (!match) {
    errors.push({
      field: "arn",
      message: "Invalid AWS Secrets Manager ARN format",
      suggestion: "Expected format: arn:aws:secretsmanager:region:account:secret:name"
    });
    return { valid: false, errors, warnings };
  }

  const [, region, accountId, secretName] = match;

  // Validate region (basic check)
  if (!region || region.length === 0) {
    errors.push({
      field: "region",
      message: "ARN missing AWS region",
      suggestion: "Ensure ARN includes a valid AWS region (e.g., us-east-1)"
    });
  }

  // Validate account ID (12 digits)
  if (accountId.length !== 12) {
    errors.push({
      field: "account",
      message: "Invalid AWS account ID in ARN",
      suggestion: "Account ID must be exactly 12 digits"
    });
  }

  // Validate secret name
  if (!secretName || secretName.length === 0) {
    errors.push({
      field: "secret",
      message: "ARN missing secret name",
      suggestion: "Ensure ARN includes the secret name"
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
```

### 4. JSON Validation Logic

#### Function: `validateSecretData(data: unknown): ValidationResult`

**Purpose**: Validate secret data structure and field values

**Validation Rules**:

1. **Structure**: Must be a plain object
2. **Required Fields**: `client_id`, `client_secret`, `tenant`
3. **Optional Fields**: `app_definition_id`, `api_url`
4. **Field Types**: All values must be strings
5. **Field Values**:
   - No empty strings for required fields
   - `tenant` must be alphanumeric with hyphens
   - `api_url` must be valid URL if provided

**Implementation**:
```typescript
export function validateSecretData(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Check if data is an object
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({
      field: "data",
      message: "Secret data must be a JSON object",
      suggestion: "Expected format: {\"client_id\": \"...\", \"client_secret\": \"...\", \"tenant\": \"...\"}"
    });
    return { valid: false, errors, warnings };
  }

  const secretData = data as Record<string, unknown>;

  // Required fields
  const requiredFields: Array<keyof BenchlingSecretData> = [
    "client_id",
    "client_secret",
    "tenant"
  ];

  for (const field of requiredFields) {
    if (!(field in secretData)) {
      errors.push({
        field,
        message: `Missing required field: ${field}`,
        suggestion: `Add "${field}" to your secret configuration`
      });
    } else if (typeof secretData[field] !== "string") {
      errors.push({
        field,
        message: `Field ${field} must be a string`,
        suggestion: `Change ${field} value to a string`
      });
    } else if ((secretData[field] as string).trim() === "") {
      errors.push({
        field,
        message: `Field ${field} cannot be empty`,
        suggestion: `Provide a non-empty value for ${field}`
      });
    }
  }

  // Optional fields type checking
  const optionalFields: Array<keyof BenchlingSecretData> = [
    "app_definition_id",
    "api_url"
  ];

  for (const field of optionalFields) {
    if (field in secretData && typeof secretData[field] !== "string") {
      errors.push({
        field,
        message: `Field ${field} must be a string`,
        suggestion: `Change ${field} value to a string or remove it`
      });
    }
  }

  // Validate tenant format (alphanumeric and hyphens)
  if (secretData.tenant && typeof secretData.tenant === "string") {
    const tenantPattern = /^[a-z0-9-]+$/i;
    if (!tenantPattern.test(secretData.tenant)) {
      errors.push({
        field: "tenant",
        message: "Invalid tenant format",
        suggestion: "Tenant must contain only letters, numbers, and hyphens"
      });
    }
  }

  // Validate api_url if provided
  if (secretData.api_url && typeof secretData.api_url === "string") {
    try {
      new URL(secretData.api_url);
    } catch {
      errors.push({
        field: "api_url",
        message: "Invalid URL format for api_url",
        suggestion: "Provide a valid URL (e.g., https://company.benchling.com)"
      });
    }
  }

  // Check for unknown fields (warning only)
  const knownFields = new Set([...requiredFields, ...optionalFields]);
  for (const field in secretData) {
    if (!knownFields.has(field as keyof BenchlingSecretData)) {
      warnings.push(`Unknown field "${field}" will be ignored`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
```

### 5. Parsing and Validation Pipeline

#### Function: `parseAndValidateSecrets(input: string): BenchlingSecretsConfig`

**Purpose**: Main entry point for secret validation

**Flow**:
```
Input String
    ↓
Detect Format (ARN or JSON)
    ↓
Format-Specific Validation
    ↓
Return BenchlingSecretsConfig or throw Error
```

**Implementation**:
```typescript
export function parseAndValidateSecrets(input: string): BenchlingSecretsConfig {
  // Detect format
  const format = detectSecretsFormat(input);

  if (format === "arn") {
    // Validate ARN
    const validation = validateSecretArn(input);

    if (!validation.valid) {
      throw new SecretsValidationError("Invalid secret ARN", validation.errors, validation.warnings);
    }

    return {
      format: "arn",
      arn: input.trim(),
      original: input
    };
  } else {
    // Parse JSON
    let data: unknown;
    try {
      data = JSON.parse(input);
    } catch (error) {
      throw new SecretsValidationError("Invalid JSON in secret data", [
        {
          field: "json",
          message: `JSON parse error: ${(error as Error).message}`,
          suggestion: "Ensure the secret data is valid JSON"
        }
      ], []);
    }

    // Validate structure
    const validation = validateSecretData(data);

    if (!validation.valid) {
      throw new SecretsValidationError("Invalid secret data structure", validation.errors, validation.warnings);
    }

    return {
      format: "json",
      data: data as BenchlingSecretData,
      original: input
    };
  }
}
```

### 6. Custom Error Class

#### Class: `SecretsValidationError`

**Purpose**: Structured error for validation failures

**Implementation**:
```typescript
export class SecretsValidationError extends Error {
  public readonly errors: ValidationError[];
  public readonly warnings: string[];

  constructor(message: string, errors: ValidationError[], warnings: string[]) {
    super(message);
    this.name = "SecretsValidationError";
    this.errors = errors;
    this.warnings = warnings;

    // Maintain proper stack trace (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SecretsValidationError);
    }
  }

  /**
   * Format errors for CLI display
   */
  public formatForCLI(): string {
    const lines: string[] = [this.message, ""];

    if (this.errors.length > 0) {
      lines.push("Errors:");
      for (const error of this.errors) {
        lines.push(`  × ${error.field}: ${error.message}`);
        if (error.suggestion) {
          lines.push(`    → ${error.suggestion}`);
        }
      }
      lines.push("");
    }

    if (this.warnings.length > 0) {
      lines.push("Warnings:");
      for (const warning of this.warnings) {
        lines.push(`  ⚠ ${warning}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
```

### 7. Integration with Existing Config System

#### File: `lib/utils/config.ts` (MODIFY)

Add support for `BENCHLING_SECRETS` to existing config interface:

```typescript
export interface Config {
  // ... existing fields ...

  // NEW: Unified secrets configuration
  benchlingSecrets?: string;
}

export interface ConfigOptions {
  // ... existing fields ...

  // NEW: CLI option for unified secrets
  benchlingSecrets?: string;
}
```

Update `loadConfigSync` to include new field:

```typescript
export function loadConfigSync(options: ConfigOptions = {}): Partial<Config> {
  // ... existing logic ...

  const config: Partial<Config> = {
    // ... existing fields ...

    // NEW: Unified secrets (priority: CLI > env > .env)
    benchlingSecrets: options.benchlingSecrets || envVars.BENCHLING_SECRETS,
  };

  // ... rest of function ...
}
```

**Important**: Do NOT change validation logic in config.ts yet. That comes in Phase 2.

### 8. File Structure

```
lib/
  utils/
    secrets.ts          (NEW) - Secret types and validation
    secrets.test.ts     (NEW) - Comprehensive tests
    config.ts           (MODIFY) - Add benchlingSecrets field
    config.test.ts      (MODIFY) - Add tests for new field
```

## Testing Strategy

### Unit Tests: `lib/utils/secrets.test.ts`

#### Test Suite 1: Format Detection

```typescript
describe("detectSecretsFormat", () => {
  it("detects ARN format", () => {
    const input = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret";
    expect(detectSecretsFormat(input)).toBe("arn");
  });

  it("detects JSON format", () => {
    const input = '{"client_id": "abc"}';
    expect(detectSecretsFormat(input)).toBe("json");
  });

  it("handles whitespace in ARN", () => {
    const input = "  arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret  ";
    expect(detectSecretsFormat(input)).toBe("arn");
  });

  it("handles whitespace in JSON", () => {
    const input = '  {"client_id": "abc"}  ';
    expect(detectSecretsFormat(input)).toBe("json");
  });

  it("defaults to JSON for ambiguous input", () => {
    const input = "not-json-not-arn";
    expect(detectSecretsFormat(input)).toBe("json");
  });
});
```

#### Test Suite 2: ARN Validation

```typescript
describe("validateSecretArn", () => {
  it("validates correct ARN", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/credentials";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects ARN with wrong service", () => {
    const arn = "arn:aws:s3:::my-bucket";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("rejects ARN with invalid account ID", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:invalid:secret:name";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "account")).toBe(true);
  });

  it("rejects ARN with missing secret name", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(false);
  });

  it("provides helpful error messages", () => {
    const arn = "not-an-arn";
    const result = validateSecretArn(arn);
    expect(result.errors[0].suggestion).toContain("Expected format");
  });
});
```

#### Test Suite 3: Secret Data Validation

```typescript
describe("validateSecretData", () => {
  it("validates correct secret data", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "company"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates with optional fields", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "company",
      app_definition_id: "app789"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(true);
  });

  it("rejects missing required field", () => {
    const data = {
      client_id: "abc123",
      tenant: "company"
      // missing client_secret
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "client_secret")).toBe(true);
  });

  it("rejects empty required field", () => {
    const data = {
      client_id: "",
      client_secret: "secret456",
      tenant: "company"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
  });

  it("rejects invalid tenant format", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "company@invalid!"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "tenant")).toBe(true);
  });

  it("rejects invalid api_url", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "company",
      api_url: "not-a-url"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "api_url")).toBe(true);
  });

  it("warns about unknown fields", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "company",
      unknown_field: "value"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unknown_field");
  });

  it("rejects non-object data", () => {
    const result = validateSecretData("not an object");
    expect(result.valid).toBe(false);
  });

  it("rejects array data", () => {
    const result = validateSecretData([1, 2, 3]);
    expect(result.valid).toBe(false);
  });
});
```

#### Test Suite 4: Parse and Validate Pipeline

```typescript
describe("parseAndValidateSecrets", () => {
  it("parses and validates ARN", () => {
    const input = "arn:aws:secretsmanager:us-east-1:123456789012:secret:name";
    const config = parseAndValidateSecrets(input);
    expect(config.format).toBe("arn");
    expect(config.arn).toBe(input.trim());
  });

  it("parses and validates JSON", () => {
    const input = '{"client_id":"abc","client_secret":"secret","tenant":"company"}';
    const config = parseAndValidateSecrets(input);
    expect(config.format).toBe("json");
    expect(config.data).toEqual({
      client_id: "abc",
      client_secret: "secret",
      tenant: "company"
    });
  });

  it("throws SecretsValidationError for invalid ARN", () => {
    const input = "arn:aws:s3:::bucket";
    expect(() => parseAndValidateSecrets(input)).toThrow(SecretsValidationError);
  });

  it("throws SecretsValidationError for invalid JSON", () => {
    const input = '{"invalid json';
    expect(() => parseAndValidateSecrets(input)).toThrow(SecretsValidationError);
  });

  it("throws SecretsValidationError for invalid data", () => {
    const input = '{"client_id":"abc"}'; // missing required fields
    expect(() => parseAndValidateSecrets(input)).toThrow(SecretsValidationError);
  });
});
```

#### Test Suite 5: Error Formatting

```typescript
describe("SecretsValidationError", () => {
  it("formats errors for CLI", () => {
    const errors: ValidationError[] = [
      { field: "client_id", message: "Missing required field", suggestion: "Add client_id" }
    ];
    const warnings = ["Unknown field 'extra'"];
    const error = new SecretsValidationError("Validation failed", errors, warnings);

    const formatted = error.formatForCLI();
    expect(formatted).toContain("Validation failed");
    expect(formatted).toContain("client_id");
    expect(formatted).toContain("Add client_id");
    expect(formatted).toContain("Unknown field");
  });
});
```

### Integration Tests: Config System

Test that new field integrates with existing config loading:

```typescript
describe("Config with benchlingSecrets", () => {
  it("loads benchlingSecrets from environment variable", () => {
    process.env.BENCHLING_SECRETS = "arn:aws:secretsmanager:us-east-1:123456789012:secret:name";
    const config = loadConfigSync({});
    expect(config.benchlingSecrets).toBe(process.env.BENCHLING_SECRETS);
  });

  it("CLI option overrides environment variable", () => {
    process.env.BENCHLING_SECRETS = "env-value";
    const config = loadConfigSync({ benchlingSecrets: "cli-value" });
    expect(config.benchlingSecrets).toBe("cli-value");
  });
});
```

### Edge Case Testing

```typescript
describe("Edge cases", () => {
  it("handles very long secret names in ARN", () => {
    const longName = "a".repeat(1000);
    const arn = `arn:aws:secretsmanager:us-east-1:123456789012:secret:${longName}`;
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(true);
  });

  it("handles unicode in secret data", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "company",
      app_definition_id: "🎉emoji"
    };
    const result = validateSecretData(data);
    // Should pass validation (Benchling may reject, but we validate structure)
    expect(result.valid).toBe(true);
  });

  it("handles very large JSON objects", () => {
    const data = {
      client_id: "a".repeat(10000),
      client_secret: "b".repeat(10000),
      tenant: "company"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(true);
  });
});
```

## Documentation

### Code Comments

Every function must have JSDoc comments:
- Purpose
- Parameters with types
- Return value with type
- Example usage
- Error conditions

### README Section

Add new section to project README:

```markdown
## Secrets Configuration

The Benchling Webhook supports two formats for configuring Benchling credentials:

### Format 1: Secret ARN (Recommended)

Provide the ARN of an existing AWS Secrets Manager secret:

\`\`\`bash
export BENCHLING_SECRETS="arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret"
\`\`\`

### Format 2: JSON Object

Provide credentials as JSON:

\`\`\`json
{
  "client_id": "your-client-id",
  "client_secret": "your-client-secret",
  "tenant": "your-tenant"
}
\`\`\`

See [Secret Format Reference](./docs/secrets.md) for complete documentation.
```

## Success Criteria Validation

- [ ] All TypeScript interfaces defined with JSDoc
- [ ] Format detection function implemented and tested
- [ ] ARN validation function with comprehensive tests (>90% coverage)
- [ ] JSON validation function with comprehensive tests (>90% coverage)
- [ ] Parse and validate pipeline implemented
- [ ] Custom error class with CLI formatting
- [ ] Integration with existing config system (no breaking changes)
- [ ] Unit tests cover all edge cases
- [ ] Code documentation complete
- [ ] README updated with secret format overview

## Risk Mitigation

**Risk**: Validation is too strict, rejects valid secrets
**Mitigation**: Warnings instead of errors for non-critical issues, comprehensive testing

**Risk**: Validation is too loose, accepts invalid secrets
**Mitigation**: Validate all required fields, test with invalid inputs

**Risk**: Performance impact from validation
**Mitigation**: Validation runs once at startup, no runtime overhead

## Next Steps

After Phase 1 completes:
1. Review and merge PR for Phase 1
2. Create Phase 2 design document (CLI parameter addition)
3. Begin Phase 2 implementation

---

**Design Complete**: Ready for episodes breakdown (Step 5b).
