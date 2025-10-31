import { BenchlingSecretData, BenchlingSecretsConfig, BenchlingSecretsInput } from "../lib/utils/secrets";

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
