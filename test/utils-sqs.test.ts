import { isQueueUrl } from "../lib/utils/sqs";

describe("sqs utilities", () => {
    describe("isQueueUrl", () => {
        it("should return true for valid SQS queue URLs", () => {
            expect(isQueueUrl("https://sqs.us-east-1.amazonaws.com/123456789012/my-queue")).toBe(true);
            expect(isQueueUrl("https://sqs.eu-west-2.amazonaws.com/987654321098/test-queue")).toBe(true);
            expect(isQueueUrl("https://sqs.ap-southeast-1.amazonaws.com/111111111111/prod-queue")).toBe(true);
        });

        it("should return false for invalid URLs", () => {
            expect(isQueueUrl("invalid-url")).toBe(false);
            expect(isQueueUrl("http://example.com")).toBe(false);
            expect(isQueueUrl("https://example.com/path")).toBe(false);
        });

        it("should return false for null or undefined", () => {
            expect(isQueueUrl(null)).toBe(false);
            expect(isQueueUrl(undefined)).toBe(false);
        });

        it("should return false for empty string", () => {
            expect(isQueueUrl("")).toBe(false);
        });

        it("should handle URLs with whitespace", () => {
            expect(isQueueUrl("  https://sqs.us-east-1.amazonaws.com/123456789012/my-queue  ")).toBe(true);
            expect(isQueueUrl("  invalid-url  ")).toBe(false);
        });

        it("should return false for malformed SQS URLs", () => {
            expect(isQueueUrl("https://sqs.us-east-1.amazonaws.com/")).toBe(false);
            expect(isQueueUrl("https://sqs.us-east-1.amazonaws.com/notanumber/queue")).toBe(false);
            expect(isQueueUrl("https://s3.us-east-1.amazonaws.com/123456789012/queue")).toBe(false);
        });
    });
});
