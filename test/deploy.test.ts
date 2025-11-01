import { maskArn } from "../lib/utils/config";

describe("maskArn", () => {

    it("should mask account ID in valid ARN", () => {
        const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret";
        const masked = maskArn(arn);
        expect(masked).toBe("arn:aws:secretsmanager:us-east-1:****9012:secret:my-secret");
    });

    it("should show last 4 digits of account ID", () => {
        const arn = "arn:aws:secretsmanager:eu-west-1:987654321098:secret:test";
        const masked = maskArn(arn);
        expect(masked).toContain("****1098");
    });

    it("should preserve region in ARN", () => {
        const arn = "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:name";
        const masked = maskArn(arn);
        expect(masked).toContain("ap-southeast-2");
    });

    it("should preserve secret name in ARN", () => {
        const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-credentials";
        const masked = maskArn(arn);
        expect(masked).toContain("benchling-credentials");
    });

    it("should return input unchanged for invalid ARN format", () => {
        const invalid = "not-an-arn";
        const masked = maskArn(invalid);
        expect(masked).toBe(invalid);
    });

    it("should handle empty string gracefully", () => {
        const masked = maskArn("");
        expect(masked).toBe("");
    });

    it("should handle malformed ARN gracefully", () => {
        const malformed = "arn:aws:s3:::bucket-name";
        const masked = maskArn(malformed);
        expect(masked).toBe(malformed);
    });

    it("masked format should match expected pattern", () => {
        const arn = "arn:aws:secretsmanager:us-west-2:111122223333:secret:test-secret";
        const masked = maskArn(arn);
        expect(masked).toMatch(/^arn:aws:secretsmanager:[^:]+:\*{4}\d{4}:secret:.+$/);
    });

    it("should handle ARN with version suffix", () => {
        const arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:name-AbCdEf";
        const masked = maskArn(arn);
        expect(masked).toContain("****9012");
        expect(masked).toContain("name-AbCdEf");
    });

    it("should mask different account IDs correctly", () => {
        const arn1 = "arn:aws:secretsmanager:us-east-1:000000000001:secret:test";
        const arn2 = "arn:aws:secretsmanager:us-east-1:999999999999:secret:test";
        const masked1 = maskArn(arn1);
        const masked2 = maskArn(arn2);
        expect(masked1).toContain("****0001");
        expect(masked2).toContain("****9999");
    });
});
