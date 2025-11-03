import { QuiltConfigResolver } from "../lib/quilt-config-resolver";

describe("QuiltConfigResolver", () => {
    describe("resolve", () => {
        // Skip this test in CI as quilt3 CLI won't be available
        const testFn = process.env.CI ? it.skip : it;
        testFn("should infer configuration from quilt3 CLI", async () => {
            const result = await QuiltConfigResolver.resolve();

            // Expect at least these fields if quilt3 is configured
            if (result) {
                expect(result).toHaveProperty("catalogUrl");
                expect(typeof result.catalogUrl).toBe("string");
            }
        });

        it("should throw error if quilt3 config is not available", async () => {
            // Mock the CLI to return empty or error
            const resolver = new QuiltConfigResolver();
            await expect(resolver.resolveWithCommand("invalid-command-xyz"))
                .rejects.toThrow();
        });

        it("should support manual override of inferred configuration", async () => {
            const manualConfig = {
                catalogUrl: "https://custom.quilt.com",
                userBucket: "override-bucket",
            };

            const result = await QuiltConfigResolver.resolve(manualConfig);
            expect(result.catalogUrl).toBe("https://custom.quilt.com");
            expect(result.userBucket).toBe("override-bucket");
        });

        it("should parse quilt3 config output correctly", async () => {
            const resolver = new QuiltConfigResolver();
            const mockOutput = "https://quilt.example.com";

            const result = resolver.parseQuilt3Config(mockOutput);
            expect(result.catalogUrl).toBe("quilt.example.com");
        });

        it("should handle URL with protocol in quilt3 config", async () => {
            const resolver = new QuiltConfigResolver();
            const mockOutput = "https://nightly.quilttest.com";

            const result = resolver.parseQuilt3Config(mockOutput);
            expect(result.catalogUrl).toBe("nightly.quilttest.com");
        });

        it("should handle URL without protocol", async () => {
            const resolver = new QuiltConfigResolver();
            const mockOutput = "catalog.example.com";

            const result = resolver.parseQuilt3Config(mockOutput);
            expect(result.catalogUrl).toBe("catalog.example.com");
        });
    });
});
