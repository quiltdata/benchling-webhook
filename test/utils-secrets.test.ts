import { BenchlingSecretData, BenchlingSecretsConfig, BenchlingSecretsInput, detectSecretsFormat, validateSecretArn, validateSecretData } from "../lib/utils/secrets";

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
      // The whole ARN fails to match because account ID is not 12 digits
      expect(result.errors.some((e) => e.field === "arn")).toBe(true);
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

  describe("validateSecretData", () => {
    it("validates correct secret data", () => {
      const data = {
        client_id: "abc123",
        client_secret: "secret456",
        tenant: "company",
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
        api_url: "https://company.benchling.com",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(true);
    });

    it("rejects missing client_id", () => {
      const data = {
        client_secret: "secret456",
        tenant: "company",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "client_id")).toBe(true);
    });

    it("rejects missing client_secret", () => {
      const data = {
        client_id: "abc123",
        tenant: "company",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "client_secret")).toBe(true);
    });

    it("rejects missing tenant", () => {
      const data = {
        client_id: "abc123",
        client_secret: "secret456",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "tenant")).toBe(true);
    });

    it("rejects empty client_id", () => {
      const data = {
        client_id: "",
        client_secret: "secret456",
        tenant: "company",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
    });

    it("rejects whitespace-only fields", () => {
      const data = {
        client_id: "   ",
        client_secret: "secret456",
        tenant: "company",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
    });

    it("rejects non-string client_id", () => {
      const data = {
        client_id: 123,
        client_secret: "secret456",
        tenant: "company",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
    });

    it("rejects invalid tenant format", () => {
      const data = {
        client_id: "abc123",
        client_secret: "secret456",
        tenant: "company@invalid!",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "tenant")).toBe(true);
    });

    it("accepts valid tenant with hyphens", () => {
      const data = {
        client_id: "abc123",
        client_secret: "secret456",
        tenant: "my-company-123",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(true);
    });

    it("rejects invalid api_url", () => {
      const data = {
        client_id: "abc123",
        client_secret: "secret456",
        tenant: "company",
        api_url: "not-a-url",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "api_url")).toBe(true);
    });

    it("accepts valid api_url", () => {
      const data = {
        client_id: "abc123",
        client_secret: "secret456",
        tenant: "company",
        api_url: "https://company.benchling.com",
      };
      const result = validateSecretData(data);
      expect(result.valid).toBe(true);
    });

    it("warns about unknown fields", () => {
      const data = {
        client_id: "abc123",
        client_secret: "secret456",
        tenant: "company",
        unknown_field: "value",
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
});
