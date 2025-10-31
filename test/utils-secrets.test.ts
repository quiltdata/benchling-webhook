import { BenchlingSecretData, BenchlingSecretsConfig, BenchlingSecretsInput, detectSecretsFormat, validateSecretArn } from "../lib/utils/secrets";

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
});
