# Phase 1 Episodes: Secret Structure Standardization and Validation

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Phase**: DECO - Episodes (Phase 1)
**Date**: 2025-10-30

## Episode Overview

This document breaks Phase 1 into atomic, testable, committable change units. Each episode follows TDD (Test-Driven Development): write failing test, implement minimal code to pass, refactor while keeping tests green.

## Episode Sequencing

```
Episode 1: Project structure and type definitions
    ↓
Episode 2: Format detection
    ↓
Episode 3: ARN validation
    ↓
Episode 4: Secret data validation
    ↓
Episode 5: Parse and validate pipeline
    ↓
Episode 6: Custom error class
    ↓
Episode 7: Config system integration
    ↓
Episode 8: Documentation
```

---

## Episode 1: Create secrets module with type definitions

### Objective
Create new `lib/utils/secrets.ts` file with TypeScript interfaces and basic exports.

### Test First (RED)

**File**: `lib/utils/secrets.test.ts`

```typescript
import { BenchlingSecretData, BenchlingSecretsConfig, BenchlingSecretsInput } from "./secrets";

describe("secrets module", () => {
  describe("type definitions", () => {
    it("exports BenchlingSecretData interface", () => {
      const data: BenchlingSecretData = {
        client_id: "test",
        client_secret: "secret",
        tenant: "company"
      };
      expect(data.client_id).toBe("test");
    });

    it("exports BenchlingSecretsConfig interface", () => {
      const config: BenchlingSecretsConfig = {
        format: "arn",
        arn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:name",
        original: "arn:aws:secretsmanager:us-east-1:123456789012:secret:name"
      };
      expect(config.format).toBe("arn");
    });
  });
});
```

**Run**: `npm test -- secrets.test.ts`
**Expected**: Test fails (module doesn't exist)

### Implement (GREEN)

**File**: `lib/utils/secrets.ts`

```typescript
/**
 * Benchling Secrets Management
 *
 * This module provides types, validation, and utilities for managing
 * Benchling API credentials in AWS Secrets Manager.
 */

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

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}
```

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests pass

### Refactor (GREEN)

- Add JSDoc comments (already done above)
- Ensure consistent formatting
- Run `npm run lint`

### Commit

```
feat(secrets): add secret type definitions for unified secrets management

- Add BenchlingSecretData interface for secret structure
- Add BenchlingSecretsConfig for parsed configuration
- Add ValidationResult and ValidationError types
- Foundation for issue #156 secrets manager

Relates to #156
```

---

## Episode 2: Implement format detection

### Objective
Implement `detectSecretsFormat()` function to distinguish ARN from JSON input.

### Test First (RED)

**File**: `lib/utils/secrets.test.ts` (ADD)

```typescript
import { detectSecretsFormat } from "./secrets";

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

  it("handles empty string", () => {
    const input = "";
    expect(detectSecretsFormat(input)).toBe("json");
  });
});
```

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests fail (function doesn't exist)

### Implement (GREEN)

**File**: `lib/utils/secrets.ts` (ADD)

```typescript
/**
 * Detect whether input is an ARN or JSON string
 *
 * @param input - The BENCHLING_SECRETS input value
 * @returns "arn" if input looks like an ARN, "json" otherwise
 *
 * @example
 * detectSecretsFormat("arn:aws:secretsmanager:...") // returns "arn"
 * detectSecretsFormat('{"client_id":"..."}') // returns "json"
 */
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

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests pass

### Refactor (GREEN)

- Function is simple, no refactoring needed
- Verify JSDoc is complete
- Run `npm run lint`

### Commit

```
feat(secrets): add format detection for ARN vs JSON

- Implement detectSecretsFormat() function
- Detects ARN by prefix matching
- Defaults to JSON for ambiguous inputs
- Comprehensive tests for all input formats

Relates to #156
```

---

## Episode 3: Implement ARN validation

### Objective
Implement `validateSecretArn()` function with comprehensive ARN format checking.

### Test First (RED)

**File**: `lib/utils/secrets.test.ts` (ADD)

```typescript
import { validateSecretArn } from "./secrets";

describe("validateSecretArn", () => {
  it("validates correct ARN", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/credentials";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates ARN with different regions", () => {
    const arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:name";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(true);
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

  it("rejects ARN with short account ID", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:12345:secret:name";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(false);
  });

  it("rejects ARN with missing secret name", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(false);
  });

  it("rejects completely invalid ARN", () => {
    const arn = "not-an-arn";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(false);
  });

  it("provides helpful error messages", () => {
    const arn = "not-an-arn";
    const result = validateSecretArn(arn);
    expect(result.errors[0].suggestion).toContain("Expected format");
  });

  it("handles ARN with version suffix", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:name-AbCdEf";
    const result = validateSecretArn(arn);
    expect(result.valid).toBe(true);
  });
});
```

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests fail (function doesn't exist)

### Implement (GREEN)

**File**: `lib/utils/secrets.ts` (ADD)

```typescript
/**
 * Validate AWS Secrets Manager ARN format
 *
 * @param arn - The ARN string to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * validateSecretArn("arn:aws:secretsmanager:us-east-1:123456789012:secret:name")
 * // returns { valid: true, errors: [], warnings: [] }
 */
export function validateSecretArn(arn: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Check ARN format using regex
  // Pattern: arn:aws:secretsmanager:region:account:secret:name
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

  // Validate region (basic check - not empty)
  if (!region || region.length === 0) {
    errors.push({
      field: "region",
      message: "ARN missing AWS region",
      suggestion: "Ensure ARN includes a valid AWS region (e.g., us-east-1)"
    });
  }

  // Validate account ID (must be exactly 12 digits)
  if (accountId.length !== 12) {
    errors.push({
      field: "account",
      message: "Invalid AWS account ID in ARN",
      suggestion: "Account ID must be exactly 12 digits"
    });
  }

  // Validate secret name (not empty)
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

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests pass

### Refactor (GREEN)

- Extract ARN pattern to constant for reusability
- Consider if region validation should be more specific (list of valid regions)
- Decision: Keep simple for now, AWS SDK will validate actual region
- Run `npm run lint`

### Commit

```
feat(secrets): add ARN validation with comprehensive error handling

- Implement validateSecretArn() function
- Validate ARN format with regex matching
- Check region, account ID, and secret name components
- Provide actionable error messages and suggestions
- Tests cover valid and invalid ARN formats

Relates to #156
```

---

## Episode 4: Implement secret data validation

### Objective
Implement `validateSecretData()` function to validate JSON secret structure and field values.

### Test First (RED)

**File**: `lib/utils/secrets.test.ts` (ADD)

```typescript
import { validateSecretData } from "./secrets";

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
      app_definition_id: "app789",
      api_url: "https://company.benchling.com"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(true);
  });

  it("rejects missing client_id", () => {
    const data = {
      client_secret: "secret456",
      tenant: "company"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "client_id")).toBe(true);
  });

  it("rejects missing client_secret", () => {
    const data = {
      client_id: "abc123",
      tenant: "company"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "client_secret")).toBe(true);
  });

  it("rejects missing tenant", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "tenant")).toBe(true);
  });

  it("rejects empty client_id", () => {
    const data = {
      client_id: "",
      client_secret: "secret456",
      tenant: "company"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
  });

  it("rejects whitespace-only fields", () => {
    const data = {
      client_id: "   ",
      client_secret: "secret456",
      tenant: "company"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(false);
  });

  it("rejects non-string client_id", () => {
    const data = {
      client_id: 123,
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

  it("accepts valid tenant with hyphens", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "my-company-123"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(true);
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

  it("accepts valid api_url", () => {
    const data = {
      client_id: "abc123",
      client_secret: "secret456",
      tenant: "company",
      api_url: "https://company.benchling.com"
    };
    const result = validateSecretData(data);
    expect(result.valid).toBe(true);
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

  it("rejects null data", () => {
    const result = validateSecretData(null);
    expect(result.valid).toBe(false);
  });

  it("rejects array data", () => {
    const result = validateSecretData([1, 2, 3]);
    expect(result.valid).toBe(false);
  });
});
```

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests fail (function doesn't exist)

### Implement (GREEN)

**File**: `lib/utils/secrets.ts` (ADD)

```typescript
/**
 * Validate secret data structure and field values
 *
 * @param data - The secret data object to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * validateSecretData({ client_id: "abc", client_secret: "secret", tenant: "company" })
 * // returns { valid: true, errors: [], warnings: [] }
 */
export function validateSecretData(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Check if data is an object
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({
      field: "data",
      message: "Secret data must be a JSON object",
      suggestion: 'Expected format: {"client_id": "...", "client_secret": "...", "tenant": "..."}'
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

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests pass

### Refactor (GREEN)

- Extract field lists to constants
- Consider helper function for string validation
- Keep implementation straightforward for now
- Run `npm run lint`

### Commit

```
feat(secrets): add secret data validation with field checking

- Implement validateSecretData() function
- Validate required fields: client_id, client_secret, tenant
- Support optional fields: app_definition_id, api_url
- Validate field types and values
- Warn about unknown fields for forward compatibility
- Comprehensive tests for all validation rules

Relates to #156
```

---

## Episode 5: Implement parse and validate pipeline

### Objective
Implement `parseAndValidateSecrets()` function to orchestrate format detection, parsing, and validation.

### Test First (RED)

**File**: `lib/utils/secrets.test.ts` (ADD)

```typescript
import { parseAndValidateSecrets, SecretsValidationError } from "./secrets";

describe("parseAndValidateSecrets", () => {
  it("parses and validates ARN", () => {
    const input = "arn:aws:secretsmanager:us-east-1:123456789012:secret:name";
    const config = parseAndValidateSecrets(input);
    expect(config.format).toBe("arn");
    expect(config.arn).toBe(input);
    expect(config.data).toBeUndefined();
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
    expect(config.arn).toBeUndefined();
  });

  it("preserves original input", () => {
    const input = "arn:aws:secretsmanager:us-east-1:123456789012:secret:name";
    const config = parseAndValidateSecrets(input);
    expect(config.original).toBe(input);
  });

  it("throws SecretsValidationError for invalid ARN", () => {
    const input = "arn:aws:s3:::bucket";
    expect(() => parseAndValidateSecrets(input)).toThrow(SecretsValidationError);
  });

  it("throws SecretsValidationError for invalid JSON syntax", () => {
    const input = '{"invalid json';
    expect(() => parseAndValidateSecrets(input)).toThrow(SecretsValidationError);
  });

  it("throws SecretsValidationError for invalid JSON structure", () => {
    const input = '{"client_id":"abc"}'; // missing required fields
    expect(() => parseAndValidateSecrets(input)).toThrow(SecretsValidationError);
  });

  it("includes validation errors in thrown error", () => {
    const input = '{"client_id":"abc"}';
    try {
      parseAndValidateSecrets(input);
      fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretsValidationError);
      expect((error as SecretsValidationError).errors.length).toBeGreaterThan(0);
    }
  });
});
```

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests fail (functions don't exist)

### Implement (GREEN)

**File**: `lib/utils/secrets.ts` (ADD)

First, implement the custom error class:

```typescript
/**
 * Custom error class for secrets validation failures
 */
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

Then, implement the main parsing function:

```typescript
/**
 * Parse and validate BENCHLING_SECRETS input
 *
 * This is the main entry point for secret validation. It detects the format
 * (ARN or JSON), performs appropriate validation, and returns a structured
 * configuration object.
 *
 * @param input - The BENCHLING_SECRETS input string
 * @returns Parsed and validated configuration
 * @throws SecretsValidationError if validation fails
 *
 * @example
 * // Parse ARN
 * const config = parseAndValidateSecrets("arn:aws:secretsmanager:...")
 * console.log(config.format) // "arn"
 *
 * @example
 * // Parse JSON
 * const config = parseAndValidateSecrets('{"client_id":"...","client_secret":"...","tenant":"..."}')
 * console.log(config.format) // "json"
 */
export function parseAndValidateSecrets(input: string): BenchlingSecretsConfig {
  // Detect format
  const format = detectSecretsFormat(input);

  if (format === "arn") {
    // Validate ARN
    const validation = validateSecretArn(input);

    if (!validation.valid) {
      throw new SecretsValidationError(
        "Invalid secret ARN",
        validation.errors,
        validation.warnings
      );
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
      throw new SecretsValidationError(
        "Invalid JSON in secret data",
        [
          {
            field: "json",
            message: `JSON parse error: ${(error as Error).message}`,
            suggestion: "Ensure the secret data is valid JSON"
          }
        ],
        []
      );
    }

    // Validate structure
    const validation = validateSecretData(data);

    if (!validation.valid) {
      throw new SecretsValidationError(
        "Invalid secret data structure",
        validation.errors,
        validation.warnings
      );
    }

    return {
      format: "json",
      data: data as BenchlingSecretData,
      original: input
    };
  }
}
```

**Run**: `npm test -- secrets.test.ts`
**Expected**: Tests pass

### Refactor (GREEN)

- Function is well-structured
- Error handling is comprehensive
- JSDoc is complete
- Run `npm run lint`

### Commit

```
feat(secrets): add parse and validate pipeline with custom error class

- Implement parseAndValidateSecrets() orchestration function
- Implement SecretsValidationError with CLI formatting
- Integrate format detection, parsing, and validation
- Provide structured errors with actionable suggestions
- Comprehensive tests for all error paths

Relates to #156
```

---

## Episode 6: Integrate with config system

### Objective
Add `benchlingSecrets` field to existing config interfaces and loading logic without changing validation behavior.

### Test First (RED)

**File**: `lib/utils/config.test.ts` (MODIFY/ADD)

```typescript
describe("Config with benchlingSecrets", () => {
  beforeEach(() => {
    // Clean environment
    delete process.env.BENCHLING_SECRETS;
  });

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

  it("returns undefined when not provided", () => {
    const config = loadConfigSync({});
    expect(config.benchlingSecrets).toBeUndefined();
  });

  it("existing config fields still work", () => {
    const config = loadConfigSync({
      catalog: "test.quiltdata.com",
      tenant: "test-tenant"
    });
    expect(config.quiltCatalog).toBe("test.quiltdata.com");
    expect(config.benchlingTenant).toBe("test-tenant");
  });
});
```

**Run**: `npm test -- config.test.ts`
**Expected**: Tests fail (field doesn't exist in interfaces)

### Implement (GREEN)

**File**: `lib/utils/config.ts` (MODIFY)

Add to `Config` interface:

```typescript
export interface Config {
  // Quilt
  quiltCatalog: string;
  quiltUserBucket: string;
  quiltDatabase: string;

  // Benchling
  benchlingTenant: string;
  benchlingClientId: string;
  benchlingClientSecret: string;
  benchlingAppDefinitionId: string;

  // NEW: Unified secrets configuration (ARN or JSON)
  benchlingSecrets?: string;

  // ... rest of interface ...
}
```

Add to `ConfigOptions` interface:

```typescript
export interface ConfigOptions {
  envFile?: string;
  catalog?: string;
  bucket?: string;
  tenant?: string;
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  profile?: string;
  region?: string;
  imageTag?: string;

  // NEW: Unified secrets option
  benchlingSecrets?: string;
}
```

Update `loadConfigSync` function:

```typescript
export function loadConfigSync(options: ConfigOptions = {}): Partial<Config> {
  // 1. Load .env file
  const envFile = options.envFile || ".env";
  const dotenvVars = existsSync(envFile) ? loadDotenv(envFile) : {};

  // 2. Merge with process.env
  const envVars = { ...dotenvVars, ...process.env };

  // 3. Try to get catalog from quilt3 config as fallback
  const quilt3Catalog = getQuilt3Catalog();

  // 4. Build config with CLI options taking priority
  const config: Partial<Config> = {
    // Quilt
    quiltCatalog: options.catalog || envVars.QUILT_CATALOG || quilt3Catalog,
    quiltUserBucket: options.bucket || envVars.QUILT_USER_BUCKET,
    quiltDatabase: envVars.QUILT_DATABASE,

    // Benchling
    benchlingTenant: options.tenant || envVars.BENCHLING_TENANT,
    benchlingClientId: options.clientId || envVars.BENCHLING_CLIENT_ID,
    benchlingClientSecret: options.clientSecret || envVars.BENCHLING_CLIENT_SECRET,
    benchlingAppDefinitionId: options.appId || envVars.BENCHLING_APP_DEFINITION_ID,

    // NEW: Unified secrets (priority: CLI > env > .env)
    benchlingSecrets: options.benchlingSecrets || envVars.BENCHLING_SECRETS,

    // AWS
    cdkAccount: envVars.CDK_DEFAULT_ACCOUNT,
    cdkRegion: options.region || envVars.CDK_DEFAULT_REGION || envVars.AWS_REGION,
    awsProfile: options.profile || envVars.AWS_PROFILE,

    // ... rest of config ...
  };

  // Remove undefined values
  return Object.fromEntries(
    Object.entries(config).filter(([, v]) => v !== undefined),
  ) as Partial<Config>;
}
```

**Run**: `npm test -- config.test.ts`
**Expected**: Tests pass

### Refactor (GREEN)

- Add JSDoc comment for new fields
- Ensure consistent ordering in interfaces
- Run `npm run lint`

### Commit

```
feat(secrets): integrate benchlingSecrets field with config system

- Add benchlingSecrets to Config and ConfigOptions interfaces
- Update loadConfigSync to load from CLI, env, and .env file
- Maintain priority: CLI > environment variable > .env
- Backward compatible with existing configuration
- Tests verify integration and priority

Relates to #156
```

---

## Episode 7: Add comprehensive documentation

### Objective
Document the secrets module with examples, usage patterns, and integration guides.

### Implementation

**File**: `lib/utils/secrets.ts` (MODIFY)

Add comprehensive module documentation at the top:

```typescript
/**
 * Benchling Secrets Management
 *
 * This module provides types, validation, and utilities for managing
 * Benchling API credentials in AWS Secrets Manager.
 *
 * ## Supported Formats
 *
 * ### ARN Format
 * Provide the ARN of an existing AWS Secrets Manager secret:
 * ```
 * arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/credentials
 * ```
 *
 * ### JSON Format
 * Provide credentials as a JSON object:
 * ```json
 * {
 *   "client_id": "your-client-id",
 *   "client_secret": "your-client-secret",
 *   "tenant": "your-tenant",
 *   "app_definition_id": "optional-app-id",
 *   "api_url": "https://optional-api-url.com"
 * }
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { parseAndValidateSecrets } from './secrets';
 *
 * // Parse and validate ARN
 * const arnConfig = parseAndValidateSecrets(
 *   'arn:aws:secretsmanager:us-east-1:123456789012:secret:name'
 * );
 * console.log(arnConfig.format); // "arn"
 * console.log(arnConfig.arn); // the validated ARN
 *
 * // Parse and validate JSON
 * const jsonConfig = parseAndValidateSecrets(
 *   '{"client_id":"abc","client_secret":"secret","tenant":"company"}'
 * );
 * console.log(jsonConfig.format); // "json"
 * console.log(jsonConfig.data); // the validated secret data
 *
 * // Handle validation errors
 * try {
 *   parseAndValidateSecrets('invalid');
 * } catch (error) {
 *   if (error instanceof SecretsValidationError) {
 *     console.error(error.formatForCLI());
 *   }
 * }
 * ```
 *
 * @module secrets
 */
```

**File**: `spec/156-secrets-manager/README.md` (NEW)

```markdown
# Secrets Management - Issue #156

## Overview

This specification implements unified secrets management for Benchling Webhook deployments,
supporting three deployment scenarios with a single configuration parameter.

## Phase 1: Secret Structure and Validation (COMPLETE)

**Status**: ✅ Complete
**Files Added**:
- `lib/utils/secrets.ts` - Secret types and validation functions
- `lib/utils/secrets.test.ts` - Comprehensive test suite

**Files Modified**:
- `lib/utils/config.ts` - Added `benchlingSecrets` field

### Key Features

1. **Format Detection**: Automatically distinguish ARN vs JSON input
2. **ARN Validation**: Validate AWS Secrets Manager ARN format
3. **Data Validation**: Validate JSON structure and field values
4. **Error Handling**: Structured errors with actionable suggestions
5. **Config Integration**: Seamless integration with existing config system

### Usage

```typescript
import { parseAndValidateSecrets } from './lib/utils/secrets';

// Validate ARN
const arnConfig = parseAndValidateSecrets(
  'arn:aws:secretsmanager:us-east-1:123456789012:secret:name'
);

// Validate JSON
const jsonConfig = parseAndValidateSecrets(
  '{"client_id":"...","client_secret":"...","tenant":"..."}'
);
```

## Next Phases

- **Phase 2**: CLI Parameter Addition
- **Phase 3**: CDK Secret Handling Refactoring
- **Phase 4**: Inline Secrets Support
- **Phase 5**: Quilt Stack Integration
- **Phase 6**: Container Runtime Fallback
- **Phase 7**: Documentation
- **Phase 8**: Deprecation and Cleanup

## Testing

```bash
# Run secrets module tests
npm test -- secrets.test.ts

# Run config integration tests
npm test -- config.test.ts

# Run all tests
npm test
```

## Documentation

- [Phase 1 Design](./05-phase1-design.md)
- [Phase 1 Episodes](./06-phase1-episodes.md)
- [Phase 1 Checklist](./07-phase1-checklist.md)
```

### Commit

```
docs(secrets): add comprehensive documentation for secrets module

- Add module-level documentation with examples
- Document both ARN and JSON formats
- Provide usage examples for all functions
- Create Phase 1 README summarizing implementation
- Link to design and episode documents

Relates to #156
```

---

## Episode 8: Final verification and cleanup

### Objective
Verify all tests pass, linting is clean, and coverage meets requirements.

### Tasks

1. **Run full test suite**:
   ```bash
   npm test
   ```
   Expected: All tests pass, no failures

2. **Check test coverage**:
   ```bash
   npm run test -- --coverage secrets.test.ts
   ```
   Expected: >90% coverage for secrets module

3. **Run linter**:
   ```bash
   npm run lint
   ```
   Expected: No errors or warnings

4. **Run type checker**:
   ```bash
   npm run typecheck
   ```
   Expected: No type errors

5. **Verify exports**:
   Create test file `test-exports.ts`:
   ```typescript
   import {
     BenchlingSecretData,
     BenchlingSecretsConfig,
     BenchlingSecretsInput,
     ValidationResult,
     ValidationError,
     detectSecretsFormat,
     validateSecretArn,
     validateSecretData,
     parseAndValidateSecrets,
     SecretsValidationError
   } from './lib/utils/secrets';

   console.log('All exports available');
   ```

   Run: `npx ts-node test-exports.ts`
   Expected: "All exports available"
   Clean up test file after verification

### Commit

```
chore(secrets): verify phase 1 implementation complete

- All tests passing with >90% coverage
- Linting clean with no errors
- Type checking passes
- All exports verified
- Phase 1 complete and ready for review

Relates to #156
```

---

## Episode Summary

| Episode | Description | Complexity | Status |
|---------|-------------|------------|--------|
| 1 | Type definitions | Low | ✅ |
| 2 | Format detection | Low | ✅ |
| 3 | ARN validation | Medium | ✅ |
| 4 | Data validation | High | ✅ |
| 5 | Parse pipeline | Medium | ✅ |
| 6 | Config integration | Low | ✅ |
| 7 | Documentation | Low | ✅ |
| 8 | Verification | Low | ✅ |

**Total Episodes**: 8
**Estimated Time**: 1-2 days
**Test Coverage Target**: >90%

---

## Next Steps

After Phase 1 episodes complete:
1. Create Phase 1 checklist document (Step 5c)
2. Execute Phase 1 checklist with dedicated agents (Step 5d)
3. Review and merge Phase 1 PR
4. Begin Phase 2 design document

**Phase 1 Episodes Complete** ✅
