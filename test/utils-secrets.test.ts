import { BenchlingSecretData, BenchlingSecretsConfig, BenchlingSecretsInput, detectSecretsFormat } from "../lib/utils/secrets";

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
});
