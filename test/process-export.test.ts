import { handler } from "../lib/lambda/__mocks__/process-export";
import { ProcessExportEvent } from "../lib/types";

describe("process-export handler", () => {
    it("should return mock response", async () => {
        const mockEvent: ProcessExportEvent = {
            downloadURL: "https://example.com/test.txt",
            packageName: "test-package",
            registry: "test-registry"
        };

        const result = await handler(mockEvent);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({
            message: "Test mock"
        });
    });
});
